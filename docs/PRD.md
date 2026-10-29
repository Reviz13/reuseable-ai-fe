# PRD: NEXUS, a Reusable AI Assistant (POS Pilot)

| | |
|---|---|
| Product | NEXUS: an embeddable AI assistant for internal apps |
| Pilot | Hitachi POS, demo outlet "Kopi Tepi" (`kopi-tepi-01`) |
| Status | Pilot built; waiting on compliance and the real POS endpoint |
| Date | 29 October 2026 |
| Related | [ARCHITECTURE.md](ARCHITECTURE.md), [design spec](superpowers/specs/2026-10-27-reusable-ai-microfrontend-design.md), [screenshots](screenshots/README.md), [feature deck](slides/NEXUS-features.pdf) |

## 1. Problem

The company runs several internal applications: POS, Core Banking and ERP/HRIS. Users of each one ask the same kinds of questions again and again, for example "how do I refund a transaction?" or "what was my profit this week?". The answers are spread across SOP documents and reports.

- Every team that wants an AI assistant would build its own. That means duplicated work, inconsistent security, and no shared audit trail.
- Generic chatbots are not acceptable for business numbers. A model that writes a profit figure can get it wrong, and a wrong number in front of an outlet owner damages trust.

## 2. Goal

Build **one** assistant that any internal app can embed with a single script tag. Each app ("tenant") gets its own isolated knowledge, tools, persona and avatar.

POS is the first tenant. In the POS pilot, NEXUS:

1. Answers questions about POS operation from knowledge that admins manage, and cites its sources.
2. Reports profit for a period through one read-only tool. Only the outlet owner may see it.
3. Shows a character avatar whose expression follows the state of the conversation.

The assistant never writes to an application database. Business numbers always come from the application's own backend, never from the model.

## 3. Users and personas

| Persona | Where | Needs |
|---|---|---|
| **Outlet owner** | Inside the POS (cashier screen, sales dashboard) | Quick profit and sales answers without opening reports; how-to answers. |
| **Cashier** | Inside the POS | How-to answers for daily tasks (shift, payment, refund, printer). Must **not** see profit. |
| **Knowledge admin** | Admin Studio | Uploads and updates SOPs and FAQs, configures the persona and avatar, reviews knowledge gaps, feedback and the audit log. |
| **Host app team** | Their app's codebase | Embeds the widget, signs user tokens, and exposes a read-only report endpoint. |
| **Compliance / security** | Audit log, configuration | Evidence of who asked what, and assurance that data and roles are isolated. |

## 4. User stories

### End users (widget)

| ID | Story | Acceptance |
|---|---|---|
| U1 | As an owner, I ask "Profit this week?" and get the exact figure. | The sales, COGS and profit figures equal the POS report for the resolved period (Monday-start week, outlet time zone). If some items have no COGS, a note says how many. |
| U2 | As an owner, I ask for any supported period: today, yesterday, this/last week, this/last month, or a custom range (e.g. "Profit on September 30?"). | Dates are resolved in code. A custom range is at most 92 days and never in the future; otherwise NEXUS asks the user to rephrase. |
| U3 | As a cashier, I ask for profit and am refused politely. | The reply is "Only the owner can view profit." The avatar shows `sad`, and the refusal is audited with `outcome=forbidden`. |
| U4 | As any user, I ask a how-to question and get an answer with citations. | The answer is grounded in active knowledge chunks, and a citation chip names the document. |
| U5 | As any user, I ask something the knowledge does not cover. | NEXUS says it does not know and suggests support. A knowledge gap is recorded for admins. |
| U6 | As any user, I rate an answer with 👍/👎. | The rating is stored, and 👎 answers show up in Studio Insights. |
| U7 | As any user, I move the assistant to the corner I prefer. | Dragging snaps to the nearest of 4 corners. The choice persists per app, and the panel never covers the host sidebar. |
| U8 | As any user, I see the assistant's state at a glance. | The avatar moves through idle → thinking → talking → happy/sad. Motion respects `prefers-reduced-motion`. |
| U9 | As a mobile user, I can use the assistant on a phone. | The panel fits a 390 px viewport. |

### Admins (Studio)

| ID | Story | Acceptance |
|---|---|---|
| A1 | As an admin, I sign in to Studio. | Supabase email/password. Users not listed in `admins` for the app are signed out. |
| A2 | As an admin, I upload an SOP (PDF/DOCX/MD/TXT) or type an FAQ entry. | Ingestion runs asynchronously (processing → ready/failed). Once ready, the new version answers questions with no redeploy. |
| A3 | As an admin, I roll back a document to an earlier version. | Activation is one update. Retrieval uses only the active version. |
| A4 | As an admin, I configure the assistant. | Name, persona prompt, language, LLM adapter/model and fallback, `min_score`, accent colour, allowed origins, and the five avatar frames with a live preview. |
| A5 | As an admin, I review insights. | Knowledge gaps (which I can mark resolved), 👎 feedback with the message, and an audit log filterable by action, outcome and date. |

### Host app teams

| ID | Story | Acceptance |
|---|---|---|
| H1 | As a host team, I embed NEXUS with one script tag and a custom element. | `<ai-assistant app api position>`, a `getToken()` hook, `open()/close()/ask()`, and DOM events. Shadow DOM keeps styles isolated. |
| H2 | As a host team, I control identity and scope. | I sign an RS256 JWT carrying `outlet_id`, `role` and `tz`. NEXUS reads scope only from the verified token, never from the chat. |

## 5. Functional requirements

1. **Widget:** a single JS file built as a Web Component (Preact, Shadow DOM), at most 60 KB gzipped excluding images. It uses SSE streaming, renders sanitised markdown and citation chips, and offers suggestion chips when the panel is empty. It snaps to 4 corners. Host CSS variables (`--ai-inset-left/right/x/y`, `--ai-z`, `--ai-accent`) control its placement.
2. **Chat API:** `POST /v1/chat` streams `state`, `token`, `tool`, `citation`, `done` and `error` events. The model sees the last 10 messages of history.
3. **Profit tool `get_profit`:** the only parameters are `period`, `start_date` and `end_date`. It has a 5 s timeout with one retry, and every call is audited.
4. **Number guardrail:** every Rupiah amount in a profit answer must equal a figure from this turn's tool result. Otherwise the answer is replaced with a fixed template, and the event is logged as `guardrail_replaced`.
5. **RAG:**
   - Retrieval: local `multilingual-e5-small` embeddings (384-dim) and pgvector `match_chunks` over active versions of the caller's app only.
   - Chunking: about 500 tokens per chunk with an 80-token overlap, split on headings.
   - Below `min_score`, a question counts as "not found" and becomes a knowledge gap.
6. **Admin Studio:** login, knowledge (list/upload/FAQ/versions/activate/delete), assistant configuration and avatar, insights (gaps, feedback, audit).
7. **Language:** set per assistant (`en`, or Indonesian otherwise). It controls fixed copy, prompt rules and the number format (`Rp1,234,000` vs `Rp1.234.000`). The pilot assistant is English.
8. **Demo host:** `/demo/pos` in Studio contains:
   - a cashier screen
   - an owner sales dashboard (Today / 7 days / 30 days / custom range up to 92 days)
   - an Owner/Cashier role switch

## 6. Non-functional requirements

| Area | Requirement |
|---|---|
| Security | The Supabase service-role key exists only in ai-service. Studio holds only the anon key; the widget holds no keys. RLS is on for every table, with no policies. |
| Isolation | Tenants are separated by `app` in every query. A user token is accepted only when `iss == app`. CORS allows only each assistant's allowed origins. |
| Audit | `audit_log` is append-only: UPDATE, DELETE and TRUNCATE are revoked and blocked by triggers. Every tool call and every admin change is logged. |
| Abuse | 20 messages per minute per `(app, user)`. A message is at most 2,000 characters. |
| Prompt injection | Retrieved text is wrapped as delimited reference data. Tool scope comes only from the token. |
| Privacy | Documents are embedded locally, so they are not sent out for indexing. Conversations are kept 90 days. |
| Portability | LLM calls go through a gateway: `ClaudeAdapter` by default, `OpenAICompatAdapter` for Ollama/vLLM self-hosting. Switching is a config change. |
| Accessibility | Keyboard-usable widget and reduced-motion support. The dashboard chart offers a table view. |

## 7. Success metrics

| Metric | Target |
|---|---|
| Profit number accuracy (eval) | 100% |
| Expected refusals (cashier asks profit, out of scope, injection) | 100% |
| Overall eval pass rate (40-case `evals/pos.jsonl`) | ≥ 90% |
| Time for new knowledge to reach answers | Minutes after upload, with no redeploy |
| 👎 rate and knowledge-gap count | Tracked in Insights and trending down after admins fill the gaps |

## 8. Scope

**In scope (pilot):** the POS tenant; knowledge Q&A with citations; one profit tool; Admin Studio; mock POS; demo host page; unit, integration, E2E and eval suites.

**Out of scope:**
- Banking/ERP tenants
- Text-to-SQL
- URL crawling
- Any write action
- SSO for Studio
- Owners with multiple outlets

## 9. Dependencies and open questions

| Owner | Question |
|---|---|
| Compliance | Is an external LLM allowed? Which Supabase region is approved (dev runs in Sydney)? What retention applies to audit logs and conversations? Is vendor zero-data-retention required? |
| Compliance | Retention or redaction for `knowledge_gaps.question`, which outlives the 90-day purge. |
| POS team | Is the profit definition net of refunds/voids and discounts? Does it include or exclude VAT? How are items without COGS handled? Also needed: a staging endpoint implementing `GET /internal/reports/profit` and a JWKS. |
| Product | Which LLM to use in production once compliance answers. |

## 10. Release plan

1. **Pilot (done):** POS tenant against mock-pos, demo in Studio, eval ≥ 90%.
2. **POS staging:** swap mock-pos for the real POS endpoint and JWKS by config, then run the eval against staging data.
3. **POS production:** `NODE_ENV=production`, demo routes off, TLS proxy, region chosen by compliance.
4. **Next tenants:** Banking, then ERP. Each needs a new `assistants` row, its own knowledge and tools, and no widget change.
