import type { AppId, AvatarState, JwtClaims, SseEvent } from "@ai/contracts";
import type { AuditWriter } from "../audit.js";
import { copyFor, type Copy } from "../copy.js";
import type { AdapterName } from "../llm/gateway.js";
import type { LlmAdapter, LlmMessage, LlmToolCall } from "../llm/types.js";
import { isProfitContext, mentionsCurrency, mentionsProfit, parseGuardrailAmounts } from "../money.js";
import { applyProfitGuardrail, type LabeledReport } from "../profit/guardrail.js";
import type { PosAdapter } from "../profit/posAdapter.js";
import type { RetrievedChunk } from "../rag/retriever.js";
import { toJsonSchema, toolsFor, type ToolDef } from "../tools/registry.js";
import { buildSystemPrompt } from "./prompt.js";
import { StreamSentinel } from "./sentinel.js";

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
 * Drops leading assistant rows and merges consecutive same-role rows with a blank line, so that
 * user rows left by aborted turns never produce shapes strict providers reject.
 */
export function normalizeHistory(messages: { role: "user" | "assistant"; content: string }[]): LlmMessage[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of messages) {
    if (out.length === 0 && m.role === "assistant") continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content = `${last.content}\n\n${m.content}`;
    else out.push({ role: m.role, content: m.content });
  }
  return out;
}

/**
 * Amounts the retrieved knowledge itself states (menu prices, promo thresholds). Parsed with candidates
 * on, so every number form the guardrail could find in an answer is covered.
 */
function knowledgeAmounts(chunks: RetrievedChunk[]): Set<number> {
  const values = new Set<number>();
  for (const c of chunks) {
    for (const a of parseGuardrailAmounts(c.content, { profitContext: true })) {
      if (!Number.isNaN(a.value)) values.add(a.value);
    }
  }
  return values;
}

/** The user's calendar date in their time zone, YYYY-MM-DD. */
function localDate(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function failureCopy(toolCalls: ToolCallRecord[], copy: Copy): string {
  const codes = toolCalls.filter((t) => t.name === "get_profit" && !t.ok).map((t) => t.code);
  if (codes.includes("FORBIDDEN")) return copy.FORBIDDEN;
  if (codes.includes("UPSTREAM_ERROR")) return copy.UPSTREAM;
  return copy.NO_DATA;
}

/**
 * Runs one chat turn. Resolves null when `signal` aborts (no `done`, nothing to persist).
 * Ruling 25: live text goes through a currency sentinel; text after a currency marker or after any
 * tool call is held and guardrailed once at turn end (against successful get_profit results, or
 * replaced by fixed copy when there are none) and emitted as one token.
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
  let text = "";
  const emitText = (t: string) => {
    if (!t) return;
    setState("talking");
    text += t;
    emit({ type: "token", text: t });
  };
  const sentinel = new StreamSentinel(emitText);

  setState("thinking");
  // One query: min_score 0 so the best score is known for knowledge_gaps; relevance is filtered here.
  const retrieved = await deps.retrieve(assistant.app, input.message, RETRIEVAL_K, 0);
  if (signal.aborted) return null;
  const topScore = retrieved.length ? Math.max(...retrieved.map((c) => c.score)) : null;
  const relevant = retrieved.filter((c) => c.score >= assistant.min_score);

  const tools = deps.tools ?? toolsFor(assistant.app);
  const copy = copyFor(assistant.language);
  const system = buildSystemPrompt(assistant, relevant, relevant.length > 0, {
    date: localDate(deps.now(), claims.tz),
    tz: claims.tz,
  });
  const messages: LlmMessage[] = normalizeHistory([
    ...(input.history as { role: "user" | "assistant"; content: string }[]),
    { role: "user", content: input.message },
  ]);
  const toolCalls: ToolCallRecord[] = [];
  const profitResults: LabeledReport[] = [];
  let guardrailReplaced = false;
  let noDataReplaced = false;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const calls: LlmToolCall[] = [];
      for await (const chunk of deps.llm.stream({
        model: assistant.llm_model,
        system,
        messages,
        tools: tools.map(toJsonSchema),
        signal,
      })) {
        if (signal.aborted) return null;
        if (chunk.type === "text") sentinel.push(chunk.text);
        else if (chunk.type === "tool_call") {
          calls.push(chunk.call);
        }
      }
      if (signal.aborted) return null;

      if (calls.length === 0) {
        sentinel.flush();
        break;
      }
      // No flush: a held tail ("Profit R", "9.999.000 ") may continue after the tool call, so it
      // joins the held text and is guardrailed together with everything after it.
      sentinel.startBuffering();

      messages.push({ role: "assistant", tool_calls: calls });
      for (const call of calls) {
        const result = await runTool(deps, tools, call, claims, signal, emit, setState, copy);
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

  // Replacement copy is a new paragraph when text already streamed, never glued to the preamble.
  const emitReplacement = (copy: string) => emitText(text.trim() ? `\n\n${copy}` : copy);
  const held = sentinel.held;
  // Rulings 29(a)/31: uncovered grouped numbers are candidate amounts in profit-context turns: a
  // get_profit call, or a profit word in this message, the previous user message, or the answer.
  const previousUser = [...(input.history as { role: string; content: string }[])].reverse().find((m) => m.role === "user");
  const profitContext =
    isProfitContext(input.message, toolCalls.some((t) => t.name === "get_profit")) ||
    mentionsProfit(previousUser?.content) ||
    mentionsProfit(held);
  // Spec 4.5: a refused (FORBIDDEN) or unreachable (UPSTREAM_ERROR) profit lookup always ends with its
  // fixed copy, whatever the model wrote after it; small models pick the wrong line or say nothing.
  const hardFailure =
    profitResults.length === 0 &&
    toolCalls.some((t) => t.name === "get_profit" && (t.code === "FORBIDDEN" || t.code === "UPSTREAM_ERROR"));
  if (hardFailure) {
    guardrailReplaced = held.trim() !== "";
    noDataReplaced = true;
    emitReplacement(failureCopy(toolCalls, copy));
  } else if (held) {
    if (profitResults.length > 0) {
      const g = applyProfitGuardrail(held, profitResults, undefined, copy);
      guardrailReplaced = g.replaced;
      if (g.replaced) emitReplacement(g.text);
      else emitText(g.text);
    } else {
      const amounts = parseGuardrailAmounts(held, { profitContext: profitContext || mentionsCurrency(held) });
      // Outside profit context and without tool calls, an amount the relevant docs state verbatim is
      // grounded (a price, a promo threshold); anything else, or any unparsed form, still fails closed.
      const known = !profitContext && toolCalls.length === 0 ? knowledgeAmounts(relevant) : new Set<number>();
      if (amounts.some((a) => !known.has(a.value))) {
        guardrailReplaced = noDataReplaced = true;
        emitReplacement(failureCopy(toolCalls, copy));
      } else {
        emitText(held);
      }
    }
  }
  const empty = text.trim() === "";
  if (empty) emitReplacement(copy.EMPTY);

  const notFound = text.includes(copy.NOT_FOUND);
  const citations = toolCalls.length === 0 && !notFound ? citationsFrom(relevant) : [];
  for (const c of citations) emit({ type: "citation", ...c });

  const avatarFinal: AvatarState =
    toolCalls.some((t) => !t.ok) || notFound || noDataReplaced || empty
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
  copy: Copy,
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
        result = await tool.run(args.data, { claims, now: deps.now(), signal, audit: deps.audit, pos: deps.pos, copy });
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
