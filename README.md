# Reusable AI assistant (POS pilot)

An embeddable AI assistant: a web component (`<ai-assistant>`) talks to a Fastify `ai-service`, which answers from uploaded knowledge (RAG) and, for the POS pilot, from the POS profit report through one tool (`get_profit`). Admins manage knowledge, persona and avatar in a Next.js Studio.

| Path | What |
|---|---|
| `apps/ai-service` | Fastify API: chat (SSE), guardrail, RAG, admin API, widget hosting. The only process with the Supabase service role key. |
| `apps/studio` | Next.js admin Studio (`/login`, `/admin/pos/...`) and the demo POS page (`/demo/pos`). Anon key only. |
| `apps/mock-pos` | Stand-in POS: signs end-user JWTs, serves JWKS and `GET /internal/reports/profit`. Dev and tests only. |
| `packages/widget` | The `<ai-assistant>` web component (Preact, shadow DOM, ≤ 60 KB gzipped). |
| `packages/contracts` | Zod schemas shared by all apps. |
| `supabase/` | Migrations and `seed.sql`. |
| `e2e/`, `evals/` | Playwright E2E and the POS eval set. |

Design spec: `docs/superpowers/specs/2026-10-27-reusable-ai-microfrontend-design.md`.

## Prerequisites

- Node 22 or newer.
- `corepack enable` (the repo pins `pnpm@9.15.0`; without corepack enabled, run `corepack pnpm@9.15.0 <cmd>`).
- No Docker is needed. Tests run on in-process PGlite; dev runs against a hosted Supabase project, or fully in-process with `LOCAL_MODE`.

```sh
corepack enable
pnpm install
```

## Setup

Copy `.env.example` to `.env` at the repo root. `pnpm dev` loads this one file for all three apps.

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | ai-service | Use the Supabase **session pooler** URL (Dashboard, Connect, Session pooler). The direct `db.<ref>.supabase.co` host is IPv6-only. |
| `DATABASE_SSL_CA` | ai-service | Path to Supabase's CA certificate (Database settings, SSL configuration, Download). TLS is verified for every non-localhost host, and Supabase signs with its own CA, so set this. |
| `DATABASE_SSL` | ai-service | Optional escape hatch: `no-verify` (encrypt, skip certificate checks) or `disable` (no TLS). Leave empty. `sslmode` in the URL is ignored. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | ai-service | Service role key: ai-service only, never Studio or the widget. |
| `SUPABASE_ANON_KEY` | studio | Read at runtime from server env (no `NEXT_PUBLIC_` vars). |
| `PORT` | ai-service | 4000. |
| `MOCK_POS_PORT` | mock-pos | 4100. mock-pos never reads `PORT`. |
| `APP_ISSUERS` | ai-service | JSON map of app to JWKS URL, e.g. `{"pos":"http://localhost:4100/.well-known/jwks.json"}`. |
| `POS_BASE_URL` | ai-service | `http://localhost:4100` for mock-pos. |
| `POS_INTERNAL_KEY` | ai-service | **Must equal `INTERNAL_KEY`** (mock-pos). |
| `INTERNAL_KEY` | mock-pos | Shared secret for `/internal/reports/profit`. |
| `ANTHROPIC_API_KEY` | ai-service | Default adapter `claude`. Optional `OPENAI_COMPAT_BASE_URL` / `OPENAI_COMPAT_API_KEY` fallback. |
| `WIDGET_DIR` | ai-service | Built widget served at `/widget/v1/`. Default `../../packages/widget/dist`. |
| `AI_SERVICE_URL`, `MOCK_POS_URL` | studio | `http://localhost:4000`, `http://localhost:4100`. |
| `DEMO_ENABLED` | studio | `/api/demo-token` issues tokens to anyone. Off in production unless set to `1`. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | scripts | Dev admin for `pnpm seed:admin` / `pnpm seed:avatars`. Choose your own. |
| `NODE_ENV`, `LOCAL_MODE`, `LLM_FAKE_SCRIPT` | ai-service | See [LOCAL_MODE](#local_mode). |

**Escape `$` in values.** dotenv-cli expands variables (dotenv-expand), so a password such as `pa$word` must be written `pa\$word`, or `$word` is replaced by an empty string.

## Supabase

1. Create a project. The dev project is in ap-southeast-2, Sydney (Ruling 47); the production region is a compliance decision (spec §10).
2. Apply `supabase/migrations/0001` to `0005` in order (SQL editor or `supabase db push`), then run `supabase/seed.sql` (the `pos` assistant, allowed origin `http://localhost:3000`).
3. `pnpm seed:admin`: creates `SEED_ADMIN_EMAIL` through the Admin API and grants it the `pos` app in `admins` (merging with any apps it already has).
4. With `pnpm dev` running: `pnpm seed:avatars` uploads `assets/avatar/pos/*.webp` through the admin API.

RLS is enabled on every table with no policies; only ai-service (service role) reads or writes data. `audit_log` is append-only: UPDATE, DELETE and TRUNCATE are revoked and blocked by triggers.

## Run

```sh
pnpm dev
```

Builds the widget, then starts:

| App | URL |
|---|---|
| studio | http://localhost:3000. `/demo/pos` is the demo POS with the widget (switch owner/cashier). `/login` is the admin Studio. |
| ai-service | http://localhost:4000 (`/healthz`, `/widget/v1/ai-assistant.js`). |
| mock-pos | http://localhost:4100. |

Stop with Ctrl+C; ai-service closes its HTTP server and DB pool on SIGINT/SIGTERM. On start (not in LOCAL_MODE) it marks uploads that a restart cut off as failed (`interrupted`) and warms up the embedding model in the background.

## LOCAL_MODE

`LOCAL_MODE=1` runs ai-service without Supabase: an in-process PGlite database (migrations and seed applied at start), in-memory blob storage and a hash embedder instead of e5. `LLM_FAKE_SCRIPT=<path to json>` replaces the LLM with a scripted fake. The E2E suite uses both.

- Both are refused unless `NODE_ENV` is `development` or `test` (an unset `NODE_ENV` fails closed). Set `NODE_ENV=development`.
- Limits: admin routes are disabled (no Studio upload), data is lost on restart, retrieval quality is not representative (hash embedder), and nothing reaches Supabase Storage.

## Tests

| Command | What |
|---|---|
| `pnpm test` | Unit tests in every package. |
| `pnpm -F ai-service test:int` | ai-service DB integration tests on PGlite (migrations applied in-process). |
| `pnpm e2e:local` | Builds the widget, starts mock-pos, ai-service (`LOCAL_MODE`, fake LLM) and studio, then runs Playwright: owner profit and cashier refusal. The admin-upload spec is skipped. |
| `pnpm test:e2e` | Against a running `pnpm dev` stack. The admin-upload spec runs only when `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` are set. |
| `pnpm eval` | The 40-case POS eval against a running stack. Needs `ANTHROPIC_API_KEY` and an admin (`EVAL_ADMIN_EMAIL`/`EVAL_ADMIN_PASSWORD`, falling back to `SEED_ADMIN_*`) to upload `evals/knowledge` and read the audit log. Without an admin token, period checks are reported as unscored. |
| `pnpm test:evals` | Unit tests for the eval scorer. |
| `E5_SMOKE=1 pnpm -F ai-service test` | Also runs the real e5 embedder smoke test (downloads the model). |
| `pnpm typecheck` | `tsc` in every package plus `e2e/`, `evals/` and `scripts/`. |

## Embedding the widget

The host backend signs a 10-minute RS256 JWT (`iss` = app, `aud: "ai-platform"`, `sub`, `outlet_id`, `role`, `tz`, `exp`, `jti`) and serves its JWKS. Register the JWKS URL in `APP_ISSUERS` and the host page origin in the assistant's allowed origins (Studio, Assistant).

```html
<script src="https://<ai-service>/widget/v1/ai-assistant.js" defer></script>
<ai-assistant app="pos" api="https://<ai-service>" position="bottom-right"></ai-assistant>
<script>
  document.querySelector("ai-assistant").getToken =
    () => fetch("/pos/ai-token", { credentials: "include" }).then((r) => r.text());
</script>
```

Attributes `app`, `api`, `position`, `open`, `lang`; methods `open()`, `close()`, `ask(text)`; events `ai-open`, `ai-close`, `ai-message`, `ai-error`. See spec §8.

## Deploy notes

- Run ai-service and studio with `NODE_ENV=production`.
- Leave `DEMO_ENABLED` unset: `/api/demo-token` signs tokens for anyone.
- Never deploy `LOCAL_MODE`, `LLM_FAKE_SCRIPT` or mock-pos. The real POS must implement the spec §5.2 contract and its own JWKS.
- Terminate TLS in a proxy in front of ai-service. Fastify `trustProxy` is not enabled yet: enable it in `createApp` (`apps/ai-service/src/app.ts`) for the proxy's address so request IPs in logs are the client's. Rate limits key on `(app, sub)`, not IP.
- CORS (Ruling 46): `/v1/chat` and `/v1/feedback` allow the union of all assistants' allowed origins, because the app is only in the request body. The per-app JWT (`iss == app`) still gates access, so app A's origin can reach app B's chat only with a B-issued token.
- Database TLS: verified by default for remote hosts; provide `DATABASE_SSL_CA`.

## Known limitations

- The guardrail checks digits only. Number words ("sembilan juta") and Arabic-Indic or other non-ASCII digit systems are not checked.
- Profit context from history only looks at the latest previous user message; a follow-up two turns after a profit question is not treated as profit context.
- Residual risk: an answer that calls the POS `sales` figure "profit" passes, because both are genuine report figures.
- Knowledge answers that quote prices (`harga Rp25.000`) stop streaming at the price and are replaced with the NO_DATA copy (Ruling 25).
- In profit questions, unrelated grouped or 4+-digit numbers (`1.250 transaksi`, phone numbers) that are not a report figure force the template answer. Years 1900 to 2100 are exempt.
- The hosted dev project is in Sydney (ap-southeast-2), not Singapore as in spec §6 (Ruling 47).
- `knowledge_gaps.question` keeps end-user text beyond the 90-day conversation purge (spec §10).
