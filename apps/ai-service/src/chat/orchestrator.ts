import type { AppId, AvatarState, JwtClaims, SseEvent } from "@ai/contracts";
import type { AuditWriter } from "../audit.js";
import { NOT_FOUND } from "../copy.js";
import type { AdapterName } from "../llm/gateway.js";
import type { LlmAdapter, LlmMessage, LlmToolCall } from "../llm/types.js";
import { applyProfitGuardrail, type LabeledReport } from "../profit/guardrail.js";
import type { PosAdapter } from "../profit/posAdapter.js";
import type { RetrievedChunk } from "../rag/retriever.js";
import { toJsonSchema, toolsFor, type ToolDef } from "../tools/registry.js";
import { buildSystemPrompt } from "./prompt.js";

export const RETRIEVAL_K = 6;
const MAX_ROUNDS = 3;
const INVALID_ARGS_MSG = "Argumen tool tidak valid. Minta pengguna menyebutkan periode dengan jelas.";

export interface AssistantRow {
  app: AppId;
  name: string;
  persona_prompt: string;
  language: string;
  llm_adapter: AdapterName;
  llm_model: string;
  fallback_adapter: AdapterName | null;
  min_score: number;
}

export type Retrieve = (app: AppId, question: string, k: number, minScore: number) => Promise<RetrievedChunk[]>;

export interface ChatDeps {
  llm: LlmAdapter;
  retrieve: Retrieve;
  pos: PosAdapter;
  audit: AuditWriter;
  now: () => Date;
  /** Defaults to toolsFor(assistant.app). */
  tools?: ToolDef[];
}

export interface ChatInput {
  assistant: AssistantRow;
  claims: JwtClaims;
  conversationId: string;
  message: string;
  history: LlmMessage[];
}

export type Citation = { document_id: string; title: string; heading?: string; version: number };
export type ToolCallRecord = { name: string; args: unknown; ok: boolean; code?: string };

export interface ChatResult {
  text: string;
  citations: Citation[];
  toolCalls: ToolCallRecord[];
  guardrailReplaced: boolean;
  avatarFinal: AvatarState;
  /** Best retrieval score regardless of min_score, or null when nothing was retrieved. */
  topScore: number | null;
}

type ToolOutcome = { ok: true; data: unknown } | { ok: false; code: string; message: string };

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (err instanceof Error && err.name === "AbortError");
}

function citationsFrom(chunks: RetrievedChunk[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of chunks) {
    if (seen.has(c.document_id)) continue;
    seen.add(c.document_id);
    out.push({ document_id: c.document_id, title: c.title, ...(c.heading ? { heading: c.heading } : {}), version: c.version });
  }
  return out;
}

/**
 * Runs one chat turn. Resolves null when `signal` aborts (no `done`, nothing to persist).
 * Text produced after any tool call in this turn is buffered and passed through the profit
 * guardrail before it is emitted as one token; text before any tool call streams live.
 */
export async function runChat(
  deps: ChatDeps,
  input: ChatInput,
  emit: (e: SseEvent) => void,
  signal: AbortSignal,
): Promise<ChatResult | null> {
  const { assistant, claims } = input;
  let avatar: AvatarState | null = null;
  const setState = (s: AvatarState) => {
    if (avatar === s) return;
    avatar = s;
    emit({ type: "state", avatar: s });
  };
  const emitText = (t: string) => {
    if (!t) return;
    setState("talking");
    emit({ type: "token", text: t });
  };

  setState("thinking");
  // One query: min_score 0 so the best score is known for knowledge_gaps; relevance is filtered here.
  const retrieved = await deps.retrieve(assistant.app, input.message, RETRIEVAL_K, 0);
  if (signal.aborted) return null;
  const topScore = retrieved.length ? Math.max(...retrieved.map((c) => c.score)) : null;
  const relevant = retrieved.filter((c) => c.score >= assistant.min_score);

  const tools = deps.tools ?? toolsFor(assistant.app);
  const system = buildSystemPrompt(assistant, relevant, relevant.length > 0);
  const messages: LlmMessage[] = [...input.history, { role: "user", content: input.message }];
  const toolCalls: ToolCallRecord[] = [];
  const profitResults: LabeledReport[] = [];
  let text = "";
  let guardrailReplaced = false;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const afterTool = toolCalls.length > 0;
      let buffered = "";
      const calls: LlmToolCall[] = [];
      for await (const chunk of deps.llm.stream({
        model: assistant.llm_model,
        system,
        messages,
        tools: tools.map(toJsonSchema),
        signal,
      })) {
        if (signal.aborted) return null;
        if (chunk.type === "text") {
          if (afterTool) buffered += chunk.text;
          else {
            text += chunk.text;
            emitText(chunk.text);
          }
        } else if (chunk.type === "tool_call") {
          calls.push(chunk.call);
        }
      }
      if (signal.aborted) return null;

      if (afterTool && buffered) {
        const g = applyProfitGuardrail(buffered, profitResults);
        guardrailReplaced ||= g.replaced;
        text += g.text;
        emitText(g.text);
      }
      if (calls.length === 0) break;

      messages.push({ role: "assistant", tool_calls: calls });
      for (const call of calls) {
        const result = await runTool(deps, tools, call, claims, signal, emit, setState);
        if (result === null) return null;
        toolCalls.push({
          name: call.name,
          args: call.args,
          ok: result.ok,
          ...(result.ok ? {} : { code: result.code }),
        });
        if (result.ok && call.name === "get_profit") profitResults.push(result.data as LabeledReport);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
  } catch (err) {
    if (isAbort(err, signal)) return null;
    throw err;
  }

  const notFound = text.includes(NOT_FOUND);
  const citations = toolCalls.length === 0 && !notFound ? citationsFrom(relevant) : [];
  for (const c of citations) emit({ type: "citation", ...c });

  const avatarFinal: AvatarState =
    toolCalls.some((t) => !t.ok) || notFound
      ? "sad"
      : citations.length > 0 || toolCalls.some((t) => t.ok)
        ? "happy"
        : "idle";
  if (signal.aborted) return null;
  avatar = null; // the final state is always emitted
  setState(avatarFinal);

  return { text, citations, toolCalls, guardrailReplaced, avatarFinal, topScore };
}

async function runTool(
  deps: ChatDeps,
  tools: ToolDef[],
  call: LlmToolCall,
  claims: JwtClaims,
  signal: AbortSignal,
  emit: (e: SseEvent) => void,
  setState: (s: AvatarState) => void,
): Promise<ToolOutcome | null> {
  setState("thinking");
  emit({ type: "tool", name: call.name, status: "start" });
  const tool = tools.find((t) => t.name === call.name);
  let result: ToolOutcome;
  if (!tool) {
    result = { ok: false, code: "UNKNOWN_TOOL", message: `Tool ${call.name} tidak tersedia.` };
  } else {
    const args = tool.schema.safeParse(call.args);
    if (!args.success) {
      await deps.audit({
        app: claims.iss,
        actor_type: "end_user",
        actor_id: claims.sub,
        outlet_id: claims.outlet_id,
        action: `tool.${tool.name}`,
        params: call.args ?? null,
        outcome: "error",
        error_code: "INVALID_PERIOD",
        duration_ms: 0,
      });
      result = { ok: false, code: "INVALID_PERIOD", message: INVALID_ARGS_MSG };
    } else {
      try {
        result = await tool.run(args.data, { claims, now: deps.now(), signal, audit: deps.audit, pos: deps.pos });
      } catch (err) {
        if (isAbort(err, signal)) return null;
        throw err;
      }
    }
  }
  if (signal.aborted) return null;
  emit({ type: "tool", name: call.name, status: result.ok ? "ok" : "error" });
  return result;
}
