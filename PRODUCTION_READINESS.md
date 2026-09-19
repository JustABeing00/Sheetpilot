# SheetPilot — Production Readiness Review

**Document type:** final pre-production audit (session 12)
**Product version:** `0.1.0`
**Date:** 2026-09-17
**Reviewed by:** automated engineering/QA/security/product audit
**Scope:** the full repository at `D:\ExcelProjectByDeepseek`

---

## 0. Verdict (read this first)

**Not production-ready as a multi-user, internet-facing SaaS. Ready for a controlled
single-tenant pilot on a trusted network.**

SheetPilot is a genuinely complete, well-architected and well-tested workflow product. The
end-to-end journey works (upload → inspect → map → configure → match → group → latest event → rules →
AI assist → review → approval → export), the review loop is auditable, exports are validated, and
every run is reproducible from an immutable snapshot. During this audit the full suite passed and the
production smoke test ran green end to end.

That said, four hard blockers stop this from being called production-ready, and they are all
**operational/durability** rather than pipeline logic:

1. **Persistence is not verified.** The default repository driver is `memory`; data is lost on
   restart. The Postgres adapter type-checks and migrations exist but has **never run against a live
   database** in this environment. This session fixed two real Postgres-only correctness bugs found
   by code inspection, but they remain unverified against a real server.
2. **Migrations are not applied by the application.** `REPOSITORY_DRIVER=postgres` requires an
   operator to run `npm run db:migrate` first; a fresh database otherwise fails at startup.
3. **No authentication or tenancy.** The optional `API_KEY` is a single shared secret with no user
   identity, authorization, revocation or tenant isolation. `resolvedBy` on every review decision is
   always `null`.
4. **Runs execute in-process with no durable queue.** Runs do not survive a restart (they are marked
   failed on the next boot), and more than one API instance is not a supported topology.

If the intended deployment is **one operator, one API process, a trusted network, and either a
throwaway dataset or an accepted restart-loss window**, the product can be piloted today. Otherwise
work through §8 first.

---

## 1. What works (verified this session)

All of the following was exercised by the automated suite and/or the production smoke test:

| Capability | Status | Evidence |
| --- | --- | --- |
| CSV/XLSX upload, sanitisation, size/mime/magic-byte validation, ZIP-bomb guard | Works | `packages/file-processing/src/{upload,archive,security}.test.ts`, smoke |
| Dataset inspection (types, emptiness, uniqueness, samples, warnings, leading-zero detection) | Works | `inspection.test.ts`, audit ingestion tests |
| Column mapping + pure configuration validation (errors block, confirmations) | Works | `workflow-config.test.ts`, `workflow-configuration.test.ts` |
| Matching/grouping/latest-event engine (deterministic, million-event scale) | Works | `matching-engine` tests + benchmark (1M events ≈ 2.7 s) |
| Deterministic rule engine (scoped conditions, conflicts, no-match, low confidence) | Works | `rule-engine.test.ts` (21) |
| Rule management API (validate, version, one active set) | Works | `rule-set.test.ts` |
| AI assist layer (policy gate, redaction, timeout/retry, strict validation, never overrides a rule) | Works | `ai.test.ts` (35), `ai-classification.test.ts` |
| Review queue (filters, counts, enriched evidence, keyboard workflow, append-only audit) | Works | `review.test.ts`, `review` domain tests |
| Review resolution rewrites the export (`__ReviewStatus` → APPROVED/OVERRIDDEN) | Works | smoke, `review.test.ts` |
| Output generation: primary-order rows, true blanks, type preservation, XLSX `Summary` sheet | Works | `export.test.ts`, `output.test.ts` |
| Export validation re-reads every artifact before the run succeeds | Works | `export.test.ts`, smoke |
| Reproducibility: immutable per-run `RunSnapshot`, execution uses it | Works | `workflow-journey.test.ts`, `run-snapshot.test.ts` |
| Saved workflows + "Run again" (rebind by column name, prepare preview) | Works | `saved-workflow.test.ts`, smoke |
| API security boundary (optional key, rate limit, headers, body limits, error hygiene) | Works | `security.test.ts` |
| Reliability guards (run-once, stale-run recovery, in-process idempotency) | Works | `security.test.ts` |
| Web product surface (landing, dashboard, lazy routes, a11y, responsive, toasts/dialogs) | Works (unit-tested; see §5) | `status.test.ts`, `format.test.ts`, build |
| Edge cases: empty/header-only/duplicate-column/unicode files, duplicate IDs, identical timestamps, missing events, missing configured column, missing-rule, interrupted/duplicate runs | Works | new `apps/api/src/audit.test.ts` (8) |

**Verification commands (all green after the fixes in §6):**

| Command | Result |
| --- | --- |
| `npm run lint` | clean |
| `npm run typecheck` | clean (10 workspaces) |
| `npm test` | **34 files / 311 tests passed** (was 303; +8 audit tests) |
| `npm run build` | API bundle `apps/api/dist/index.js` (323 KB) + web assets; entry 44.6 KB / 11.8 KB gzip, no size warning |
| Production smoke (`node apps/api/dist/index.js` + `npm run smoke`) | Full journey green: run succeeded (5 steps, 3 artifacts, 7 review items, 9 decisions), configured run + frozen snapshot, run-again carried 4/4 mappings and saved config v2, review override regenerated the output, export `pending_review` with 10 validated rows, rule validate/save OK |

Sample outputs (canonical fixtures, default `noop` AI): 9 accounts, 13 events, 10 output rows, 2
auto-approved, 7 review items, 1 orphan event ignored. Second fixture set (`samples/field-service`):
7 records, 8 output rows, 2 auto-resolved, 5 review items.

---

## 2. Known limitations

Grouped by area. Items marked **[blocker]** are why §0 is not "production-ready".

### 2.1 Persistence & durability

- **[blocker] Postgres is unverified.** Repositories type-check and migrations generate
  (`0000`–`0005`), but no live database was exercised. See §6 for the two Postgres-only bugs fixed
  by inspection this session.
- **[blocker] `memory` is the default and is not durable.** Metadata is lost on restart; in-flight
  runs are marked failed on the next boot (`recoverStaleRuns`). Uploads/artifacts on local disk
  become orphaned from their metadata.
- **[blocker] Migrations are not run by the app.** `REPOSITORY_DRIVER=postgres` on a fresh database
  fails until `npm run db:migrate` is run. The bundled API cannot locate `packages/db/drizzle`, so
  auto-migration would need a build/deploy change.
- Several `list*` methods in the Postgres adapter still apply a default limit where the in-memory
  driver is unbounded (`datasets`, `workflowConfigurations`, `runs`, `reviewResolutions`). Current
  callers always pass a limit, so this is latent, but it is a parity trap (the two that did cause
  real bugs — decisions and review items — were fixed).
- Postgres `update` methods are partial writes (only the mutable subset) while the in-memory driver
  replaces the whole row, and `row!` non-null assertions would throw on a missing row. Correct for
  today's callers, but fragile.
- Cross-driver ordering differs (e.g. decisions ordered by `entityKey` in Postgres vs insertion
  order in memory; `ruleSets.list()` ordered by slug vs `updatedAt`). Not currently user-visible as
  incorrect, but it makes driver swaps subtly different.
- No delete/erasure flow anywhere. Retention only sweeps unreferenced `uploads/`; deliverables under
  `runs/` are never swept. GDPR-style erasure is a manual DB + filesystem operation.

### 2.2 Security

- **[blocker] No real auth/tenancy.** `API_KEY` (optional, off by default) is a single shared secret.
  There is no per-user identity, authorization, revocation or tenant isolation, and no audit of
  *who* resolved a review item (`resolvedBy` is always `null`).
- Idempotency and rate limiting are **process-local** (reset on restart, not shared across instances).
- No TLS in-process; deployment must terminate TLS at a reverse proxy. CORS origins must be set
  explicitly in production. Files are stored unencrypted on local disk.
- ZIP-bomb guard is heuristic (skips ZIP64 size accounting); `MAX_UPLOAD_MB` is the backstop. No
  antivirus/malware scanning.
- No SSRF hardening of `AI_BASE_URL` (operator-controlled), no dependency/`npm audit` gate in CI, no
  container/OS hardening.
- AI privacy is a deployment decision: with a non-`noop` provider, event descriptions leave the
  process. There is no DPA/zero-retention guarantee, no per-tenant routing and no cost/token budget.
  Free-text descriptions may themselves contain PII (field-name redaction cannot remove that).

### 2.3 Scale & performance

- **Whole files are loaded into memory.** The matching engine itself is linear and benchmarked at 1M
  events ≈ 2.7 s, but `readAllRows` loads both files, `build-output` holds all rows, and the XLSX
  writer/reader buffer the whole workbook. Fine for operational spreadsheets; not for
  hundreds-of-MB workbooks.
- Review resolution **rewrites the entire output artifact** (re-reads, patches, rewrites, re-validates),
  and export validation re-reads each artifact once. O(file) per resolution.
- Queue `counts()` and `ExportService.status()` scan rows rather than using indexed aggregates.
- The dashboard scans up to 1,000 recent runs to find each saved workflow's latest run.
- Rate-limit buckets cap tracked clients at 10,000 and evict expired entries lazily.
- No caching and no background job queue; runs are `void`-dispatched in-process.

### 2.4 Product / UX (residual)

Session 11/12 polished the surface, but:
- The Rules editor's condition inputs still rely on visual context (limited explicit labels); the
  Rules UI does not know the workflow's output schema, so an action-field typo is not flagged.
- `RunProgress` is a derived view: steps are persisted only at completion, so the run page shows the
  declared pipeline plus a timer rather than true per-step streaming.
- The XLSX `Summary` sheet is an as-run snapshot; after human decisions it can lag the live
  `/export` summary (the live endpoint is authoritative).
- Toasts and client-side state are lost on reload (durability is not expected here).
- The landing page is hand-written product copy.

### 2.5 Testing

- Postgres is not covered by any integration test (no gated memory↔Postgres parity suite).
- The web UI has **no browser-level tests** (no Playwright/jsdom). Session 11/12 UX behaviours
  (router splitting, confirm dialogs, keyboard review, focus trap, error states) are manually verified
  and unit-tested only at the label-helper level.
- No property/fuzz tests for the rule engine / matching engine; no load test for large uploads; no
  coverage reporting in CI; no `npm audit` gate.

### 2.6 AI

- The OpenAI adapter is unverified against a live model (all tests inject a mock provider / mocked
  `fetch`). Real latency, token limits, model JSON quirks and cost are unknown; there is no token
  accounting or caching. The provider is global (`AI_PROVIDER`), not per configuration.

---

## 3. Important operational requirements

1. **One API process.** Runs execute in-process; a second replica's startup would mark the first
   instance's in-flight runs as failed. Do not scale the API horizontally until a durable job queue
   exists.
2. **Run migrations before first start** (Postgres mode): `npm run db:migrate` from the repo, then
   start the server. Re-run after every deploy that adds a migration.
3. **Persistent, single-writer storage.** `STORAGE_LOCAL_DIR` must be a durable volume that survives
   restarts and is writable by the API. Deliverables are never swept; monitor disk growth.
4. **Back up both** the Postgres database and the storage volume together — artifacts reference
   uploads by storage key and runs reference datasets by id.
5. **Set `API_KEY`** whenever the API is reachable beyond localhost, and put the app behind a reverse
   proxy that terminates TLS, sets `TRUST_PROXY=true`, and restricts access to a trusted network.
6. **Set `CORS_ORIGIN`** to the exact deployed web origin (credentials are disabled).
7. **Startup recovery is by design:** any run left `queued`/`running` by a previous process is marked
   `failed` with an actionable message. Expect that after an unclean shutdown.
8. **Health probe:** `GET /healthz` (always unauthenticated) for load balancers/orchestrators.
9. **Retention:** uploads older than `RETENTION_UPLOAD_TTL_HOURS` and unreferenced are deleted
   periodically; deliverables are never deleted.
10. **Never commit secrets.** `.env` is git-ignored; credentials come from the environment.

---

## 4. Environment variables

Defaults in parentheses. Copy `.env.example`.

**Runtime:** `NODE_ENV` (development) · `API_HOST` (127.0.0.1) · `API_PORT` (4000) · `LOG_LEVEL`
(info) · `LOG_PRETTY` (false) · `CORS_ORIGIN` (http://localhost:5173)

**Persistence:** `REPOSITORY_DRIVER` (memory; set `postgres` for durability) · `DATABASE_URL`
(required for postgres) · `STORAGE_DRIVER` (local) · `STORAGE_LOCAL_DIR` (.data/storage)

**Limits / retention:** `MAX_UPLOAD_MB` (50) · `JSON_BODY_LIMIT_MB` (2) ·
`MAX_XLSX_UNCOMPRESSED_MB` (512) · `MAX_XLSX_ENTRIES` (20000) · `RETENTION_UPLOAD_TTL_HOURS` (168) ·
`RETENTION_SWEEP_INTERVAL_MINUTES` (60) · `DATASET_SAMPLE_ROWS` (10) · `DATASET_MAX_SCAN_ROWS`
(200000)

**API security:** `API_KEY` (empty = no auth) · `RATE_LIMIT_MAX` (600) · `RATE_LIMIT_WINDOW_MS`
(60000) · `TRUST_PROXY` (false)

**AI (optional):** `AI_PROVIDER` (noop) · `OPENAI_API_KEY` · `AI_MODEL` · `AI_BASE_URL`
(https://api.openai.com/v1) · `AI_TIMEOUT_MS` (15000) · `AI_MAX_ATTEMPTS` (2) · `AI_EXCLUDED_FIELDS`

**Web (build-time):** `VITE_API_BASE_URL` (empty → dev proxy) · `VITE_API_TARGET`
(http://127.0.0.1:4000)

---

## 5. Deployment requirements

- **Runtime:** Node.js ≥ 22.12 (developed/tested on 24.6), npm workspaces.
- **Build:** `npm ci && npm run build` → API bundle `apps/api/dist/index.js`, web assets
  `apps/web/dist/`.
- **API:** run `node apps/api/dist/index.js` as a long-lived process (systemd/PM2/supervisor). It
  externalizes its runtime dependencies (`exceljs`, `csv-parse`, `csv-stringify`, `drizzle-orm`,
  `postgres`, `zod`, `pino`), so `npm ci --omit=dev` in `apps/api` (or the repo) is required in
  production.
- **Web:** serve `apps/web/dist` as static files and proxy `/api` (and `/healthz`) to the API. The
  SPA uses client-side routing, so unknown paths must fall back to `index.html`.
- **Postgres (optional but recommended):** `docker compose up -d postgres` for a local instance;
  in production provide a managed Postgres 16 instance, set `DATABASE_URL`, then run
  `npm run db:migrate`.
- **Reverse proxy:** terminate TLS, forward `X-Forwarded-For`, set `TRUST_PROXY=true`, enforce a
  request-body limit consistent with `MAX_UPLOAD_MB`.
- **CI:** `.github/workflows/ci.yml` runs lint → typecheck → test → build on push/PR (not yet run on
  GitHub). Add a Postgres service + parity tests and an `npm audit` gate.

---

## 6. Defects found and fixed this session

These were concrete problems discovered during the audit and corrected (with tests where practical):

1. **Rule-set seeding overwrote operator rule sets on every restart** (`apps/api/src/container.ts`).
   `seedRegisteredWorkflows` unconditionally upserted the in-code default rule set over whatever was
   active for the workflow. With a persistent database this silently destroyed a customized or
   replaced active rule set on every API restart. Fixed to seed only when the workflow has **no**
   rule sets at all. Covered by a new regression test in `audit.test.ts`.
2. **Postgres silently truncated decisions and review items to 100 rows**
   (`packages/db/src/repositories/postgres/index.ts`). `decisions.listByRun` and
   `reviewItems.listByRun` applied a default `LIMIT 100` where the in-memory driver is unbounded.
   Because `ExportService.status()` and the run review-list route call them without a limit, a run
   with more than 100 records would under-count unresolved cases (possibly reporting the export
   `ready` with review items outstanding) and return a partial review list. Fixed to apply a limit
   only when one is provided, matching the in-memory driver.
3. **Non-deterministic active rule-set selection in Postgres.** `getActiveByWorkflowSlug` had no
   `ORDER BY`; added `updated_at DESC` so two rows can never race.
4. **Review queue keyboard shortcut could double-submit a resolution**
   (`apps/web/src/pages/ReviewQueuePage.tsx`). The `a`/`o`/`d` shortcuts bypassed the button
   `disabled` guard; now `submit` early-returns while a resolve is in flight.
5. **Setup page could block forever with a silent validation failure**
   (`apps/web/src/pages/SetupPage.tsx`). A failed validation request left the page on "Not checked
   yet" with the Save button disabled and no message. Now shows an error with a retry, and an empty
   workflow list renders an empty state instead of an infinite spinner. Dataset load failures are
   surfaced too.
6. **Run-again page hung on "Checking the mapping…"** when prepare failed
   (`apps/web/src/pages/RunSavedWorkflowPage.tsx`); now surfaces the error with a retry.
7. **Confirm dialog did not trap or restore focus** (`apps/web/src/components/ConfirmDialog.tsx`).
   Added Tab trapping, focus restoration, and `aria-describedby`.
8. **A failed lazy chunk / render throw produced a blank screen.** Added a route-level
   `errorElement` (`apps/web/src/components/RouteError.tsx`).
9. Smaller fixes: corrected the review filter ARIA pattern, labelled the "add output field" input,
   handled audit-history load errors, wrapped the last two unwrapped tables in `.table-scroll`,
   surfaced dataset-analysis and workflow-detail query errors, fixed a `minmax(320px, …)` overflow
   on very narrow viewports, and hid the landing brand mark from assistive tech.
10. **New audit test suite** `apps/api/src/audit.test.ts` (8 tests) covering zero-byte and
    header-only files, duplicate columns, leading-zero preservation, unicode/embedded commas,
    duplicate primary keys + identical timestamps + missing events, missing configured columns
    (fails fast with a helpful message), and the rule-set seeding regression.

Not fixed (documented above): Postgres default limits on the remaining list methods, cross-driver
ordering, partial updates and `row!` assertions in the Postgres adapter, auto-migrations, and the
Rules editor labelling gaps.

---

## 7. Security considerations

**Implemented (see `docs/security-review.md` for the full findings table and `docs/privacy.md` for
data handling):**

- Untrusted files validated at named seams: filename sanitisation, extension/content-type/size
  allowlists, magic-byte checks, and a ZIP central-directory decompression-bomb guard that runs
  before the workbook is buffered.
- Storage keys are internal UUIDs; `LocalFileStorage` proves every resolved path stays inside the
  root (rejects `..`, absolute/drive-relative paths, NUL, empty segments).
- Failed ingestion deletes its stored object; a retention sweep removes unreferenced uploads.
- Optional shared-secret API key (constant-time compare, `/healthz` exempt), per-IP fixed-window rate
  limit, conservative security headers (+HSTS in production), configurable body/multipart limits,
  CORS credentials disabled, `TRUST_PROXY`.
- 5xx `details` are logged but never returned; error bodies are `{ error: { code, message } }` only.
- pino redacts credential-shaped log fields; file contents are never logged.
- Runs execute at most once (in-flight marker set synchronously), restart-stranded runs are failed on
  boot, and `POST /runs` supports an in-process `Idempotency-Key`.
- AI is off by default (`noop` sends nothing); requests are bounded and carry no raw rows; excluded
  fields are redacted from the latest event and the history; model output is strictly validated;
  prompt-injection prose is ignored.
- Secrets are never in source; `.env` is git-ignored and `.env.example` documents variables without
  values.

**Must be handled at deployment:**

- TLS termination, network restriction, and (if the API is shared) an `API_KEY` at minimum.
- Treat configuring a non-`noop` AI provider as a data-processing decision.
- Files are unencrypted on disk; rely on volume/disk encryption.
- No per-user audit; do not present the review trail as identity-attributed evidence.

---

## 8. Scaling considerations

- **Current safe envelope:** a single API process, operational spreadsheets (tens of thousands of
  rows), a queue of hundreds of exceptions, one team.
- **The matching join is not the bottleneck;** the whole-file loads are. Before large files become
  normal, implement a chunked/streaming loader behind the existing `TabularReader` seam and a
  streaming XLSX writer.
- **Multiple API instances require:** a durable job queue (runs off the request path), durable
  idempotency, shared rate limiting, and object storage (S3) instead of local disk. Until then,
  affinity/single-instance is mandatory.
- **Database growth:** run snapshots duplicate the configuration and rule set per run, and review
  resolutions/output regeneration rewrite artifacts. Plan compaction and artifact lifecycle policies.
- **Query hot spots to index/aggregate first:** global review queue filters/counts, `runs.list`
  without a status, decisions by `(run_id, entity_key)`, and the dashboard's latest-run-per-workflow
  scan. The current Postgres schema covers the run-scoped reads but not the global queue.
- Add metrics/tracing (`/healthz` is the only probe today) and alerting on failed runs, queue depth
  and disk usage before scaling.

---

## 9. Recommended next steps (priority order)

1. **Verify Postgres for real.** Stand up the compose database, run migrations, and add a
   `DATABASE_URL`-gated memory↔Postgres parity suite (decisions/review items without a limit, counts,
   filters, rule-set queries, snapshot round-trips). Fix the remaining default-limit/ordering/update
   divergences it exposes.
2. **Make schema setup a deploy step.** Either run migrations automatically at startup (bundle the
   drizzle folder and resolve it robustly) or document/enforce `npm run db:migrate` in the deploy
   pipeline, with a startup schema check.
3. **Add authentication, per-user identity and tenancy.** At minimum per-user API keys with the
   reviewer identity recorded on `ReviewResolutionLog`; then authorization + tenant isolation.
4. **Add a browser test layer (Playwright)** for the review keyboard flow, confirmation dialogs,
   lazy routes, refresh-during-processing and the new error/empty states.
5. **Introduce a durable job queue** so runs survive restarts and the API can scale horizontally,
   with durable idempotency and shared rate limiting.
6. **Add a delete/erasure flow** (datasets, runs, artifacts) with cascade rules and confirmation.
7. **Validate the AI path live** (latency, token limits, JSON quirks) and add token/cost accounting,
   caching and a per-configuration provider choice.
8. **Add streaming loaders** and a streaming XLSX writer for large files; then a load test.
9. **Harden operations:** `npm audit`/dependency scanning and a Postgres service in CI, metrics and
   alerting, artifact lifecycle/compaction, and OS/container hardening.
10. **Close the product gaps:** feed human corrections back into rule suggestions, browsable
    configuration/rule-set version history and a "diff against current rules" view, and the Rules
    editor labelling/output-schema validation.

---

## 10. Audit method

- Read the full `progress.md` handoff, then reviewed the API services and routes, the core domain,
  the file-processing/upload/storage and security seams, the DB schema, migrations and both
  repository adapters, and the web pages/components.
- Ran `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- Ran the production smoke test against the built API bundle.
- Added and ran `apps/api/src/audit.test.ts` (8 edge-case tests).
- Two focused read-only audits were performed for the web surface and the persistence layer; their
  concrete findings are incorporated above and in §6.

**Test totals after this session:** 34 files / **311 tests**, all passing.

---

## 11. Session 13 — deployment readiness changes

This session did not change pipeline logic; it made the existing build deployable and closed
operational gaps. See [`docs/deployment.md`](./docs/deployment.md) for the runbook.

**Resolved**

- **Packaging exists now.** `Dockerfile` (multi-stage, pruned runtime), `.dockerignore`, `.nvmrc`, and
  a `render.yaml` Blueprint (web service + Postgres 16 + persistent disk + env).
- **Frontend is a Cloudflare Worker.** `apps/web/wrangler.jsonc` + `apps/web/worker/index.js` serve
  `dist/` as static assets with SPA fallback and proxy `/api`, `/healthz`, `/readyz` to the API,
  injecting `x-api-key` server-side. The shared secret is not shipped to the browser (this replaces
  the earlier "baked `VITE_API_KEY`" concern) and the browser stays same-origin (no CORS).
- **Migrations are runnable in production.** `node apps/api/dist/index.js --migrate` runs the bundled
  migrator with no TypeScript toolchain; `DB_AUTO_MIGRATE=true` applies them at startup; the folder is
  resolved from `DB_MIGRATIONS_DIR` (set by the image). Root `db:migrate`/`db:push` scripts added.
- **Health and safety guards.** `/readyz` proves Postgres connectivity (`/healthz` stays a liveness
  probe); both probes are unauthenticated. Production refuses to boot with the memory driver and/or no
  `API_KEY` unless `ALLOW_INSECURE=true`.
- **Platform portability.** `PORT` (Render/Heroku/Fly) is honored when `API_PORT` is unset; logs a
  warning when `ALLOW_INSECURE` is used in production.
- **Cross-platform install fixed.** The Windows-only `@rolldown`/`lightningcss` bindings moved from
  `devDependencies` to `optionalDependencies`, so `npm ci` works on Linux (CI and Docker) and still
  installs the bindings on Windows.
- **CI hardened.** `npm audit --omit=dev --audit-level=high` gate plus a Postgres 16 job that applies
  migrations and runs the end-to-end smoke test against a real database.
- **Production sourcemaps disabled** for both the API bundle and the web build.
- **Web hardening.** Favicon, `robots.txt`, `_headers` (CSP + baseline headers + immutable asset
  caching), and `/favicon.ico` redirect.

**Verified this session**

- `npm ci` → `npm run lint` → `npm run typecheck` → `npm run build` clean; `npm test` **36 files / 320
  tests** passing; `wrangler deploy --dry-run` accepts the Worker config; the production guard and the
  `--migrate` CLI fail fast with actionable messages; the built API served `/healthz` + `/readyz` and
  the full smoke test passed end to end.

**Still open (unchanged blockers)**

- No per-user identity/tenancy (single shared secret only), so not a multi-user SaaS.
- Single API instance: runs are in-process and there is no durable queue.
- Postgres is now exercised by CI, but not yet by a long-running production deployment.
- No delete/erasure flow; deliverables are never swept.
- One pre-existing (unreachable) moderate advisory: `uuid@8.3.2` via `exceljs` (exceljs uses `v4`
  only; the advisory covers `v3/v5/v6` with a caller-provided buffer). Accepted and tracked.
- Pre-existing `npm run format:check` drift in 12 unrelated files (CI does not gate on formatting).
