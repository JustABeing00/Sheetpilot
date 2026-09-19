# SheetPilot

SheetPilot turns recurring Excel/CSV operational workflows into repeatable, explainable pipelines:

> upload daily files → inspect what was detected → map columns to workflow roles once → match & group
> records → select the latest record → apply deterministic rules → generate the completed output →
> review only the unusual cases.

Uploaded files are ingested into a normalized, persisted **dataset profile** (sheets, columns, inferred
types, emptiness/uniqueness, samples and validation warnings); rows stay in object storage and are paged
on demand, so no stage loads a whole dataset into browser memory. A **workflow configuration** then
assigns datasets to declared roles and maps semantic columns (entity id, timestamp, description, output
columns) to real columns, with validation and explicit confirmation for ambiguous mappings; the saved,
versioned configuration becomes a reusable **saved workflow**. A reusable **matching engine**
(`@sheetpilot/matching-engine`) joins primary records to their events on a normalized identifier, keeps the
complete event history and selects the latest event deterministically, reporting every join anomaly.

The first workflow implemented is **account fault triage**: a primary file lists accounts with columns
that need to be filled in, an events file contains fault reports (the same account may appear many
times), and the system selects the latest fault per account, classifies it with versioned business
rules, fills four output columns, and routes ambiguous cases to a human review queue.

## Product principles

- **Deterministic first** – rules are first-class, versioned objects; AI never silently overrides them.
- **Explainable** – every automated decision records the matched rule, evidence, confidence and review reasons.
- **Human in the loop** – only unusual/ambiguous cases leave the pipeline; every review action is recorded.
- **Reusable engine** – workflows are pluggable programs, not hardcoded scripts.

See [`progress.md`](./progress.md) for the canonical project state and [`docs/architecture.md`](./docs/architecture.md)
for the architecture deep dive.

## Repository layout

```
apps/
  api/                 Fastify HTTP API (application layer, composition root, services, routes)
  web/                 React + Vite single-page app (landing page + dashboard, saved workflows, datasets, setup, runs, review queue, rules)
packages/
  core/                Domain model, zod schemas, API contracts, ports (zero runtime deps except zod)
  config/              Typed environment loading/validation (fail-fast, no secrets in code)
  file-processing/     CSV/XLSX readers & writers, schema inference, dataset inspection, upload validation, storage drivers
  matching-engine/     Reusable primary↔event matching: identifier normalization, grouping, deterministic latest event
  rule-engine/         Rule DSL evaluation, deterministic winner selection, explanations, validation
  ai/                  ClassificationProvider port + OpenAI adapter, AI service (policy, redaction, retries), deterministic-first resolution
  workflow-engine/     Workflow program runner + the account-fault-triage workflow (roles, mapping resolver)
  db/                  Drizzle (Postgres) schema + migrations, in-memory and Postgres repositories
samples/account-faults Canonical demo files and expected outcomes (used by tests and smoke script)
scripts/smoke.mjs      End-to-end smoke test against a running API
```

## Quickstart

Requirements: Node.js >= 22 (developed on Node 24) and npm 10+.

```bash
npm install                 # install all workspaces

npm run dev                 # API on http://127.0.0.1:4000 + web on http://127.0.0.1:5173
# or run them separately
npm run dev:api
npm run dev:web
```

Open http://localhost:5173 for the **landing page** (an overview of the product and the five-stage
journey), then **Open the app** to reach the dashboard. From there, go to **New run**, upload
`samples/account-faults/primary_accounts.csv` and `samples/account-faults/fault_events.csv`, and start
the run. You should get 10 output rows, 2 auto-approved accounts, 7 review items and 3 artifacts
(CSV, XLSX, review queue CSV).

To inspect a file first, open **Datasets**, upload `samples/account-faults/fault_events.csv`, and read the
detected sheets, columns, inferred types and validation warnings; the row preview is paged.

For the guided path, open **Setup**: upload both sample files under **Datasets**, then assign them to the
primary/events roles, map the account/date/description columns (the page suggests defaults and validates
as you go), save the configuration, and click **Continue to processing**.

Once a setup is saved it appears under **Saved workflows**. To process a new day's data, open the saved
workflow and click **Run again**: attach the new files, and the remembered column mapping is carried onto
them by name (anything that could not be carried is reported). The run freezes its own setup and rule
versions, so past reports never change.

No configuration is required: the API defaults to in-memory repositories and local file storage.
Copy `.env.example` to `.env` to change ports, storage, Postgres, logging or AI settings.

### Verify without the UI

```bash
npm run dev:api                        # terminal 1
npm run smoke                          # terminal 2: uploads samples, runs the workflow, checks artifacts
```

### Drop a file in a folder (no UI)

Set `INBOX_ENABLED=true`, point `INBOX_DIR` at a folder, and set `INBOX_CONFIGURATION_ID` to a saved
workflow's id (copy it from `/saved-workflows/<id>`). For each day, create a subfolder containing the
two files and the API runs the workflow automatically:

```
inbox/
  2026-09-19/
    primary.xlsx     # matched by INBOX_PRIMARY_PATTERN (default primary.*)
    events.xlsx      # matched by INBOX_EVENTS_PATTERN  (default events.*)
```

The watcher waits until each file stops changing (`INBOX_SETTLE_MS`), ingests it, carries the saved
column mapping onto the new files by name, runs the workflow, and moves the folder to
`inbox/_processed/` (or `inbox/_failed/`) so a job is never run twice. Exceptions then wait in the
Review queue exactly as with a manual run.

### Result columns and the fault summary

The account-fault workflow writes four business results. If your primary file already has its own
columns, map them in **Setup** under the four "Result column" roles, and the results are written into
your existing columns instead of new `RootCause`/`FaultCategory`/`RecommendedAction`/`Priority` ones.
The record identifier column is always kept in the output, so a human review decision can always be
written back into the generated file.

For accounts with several faults, the latest fault drives classification, and `__FaultSummary`
combines every distinct fault description (oldest first, ` | `-separated) into one column. The same
value is exposed to rules as `combinedDescription`, so a rule can match against the whole history.


## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run API and web app together |
| `npm run build` | Build the API bundle and the web app |
| `npm run start` | Run the built API bundle (`node apps/api/dist/index.js`) |
| `npm run typecheck` | TypeScript strict typecheck for every workspace |
| `npm run lint` | ESLint (type-aware) across the monorepo |
| `npm run format` / `format:check` | Prettier write / verify |
| `npm test` / `test:watch` | Vitest unit + integration tests |
| `npm run e2e` | Playwright browser journey (starts API + web itself; first run: `npx playwright install chromium`) |
| `npm run smoke` | End-to-end smoke test against a running API |
| `npm run benchmark -w @sheetpilot/matching-engine` | Synthetic primary↔event join benchmark (10k–250k entities) |
| `npm run db:generate` | Generate SQL migrations from the Drizzle schema |
| `npm run db:migrate` | Apply migrations (source, via `tsx`) |
| `npm run db:push` | Push the schema to a Postgres database (development) |

In a production install (no dev toolchain), apply migrations with
`node apps/api/dist/index.js --migrate`.

## Environment

All variables are validated at startup by `@sheetpilot/config` and documented in [`.env.example`](./.env.example).
Never commit a real `.env` file — `.gitignore` excludes it.

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `API_HOST` / `API_PORT` | `127.0.0.1` / `4000` | API bind address; precedence is `API_PORT`, then platform `PORT`, then 4000 |
| `LOG_LEVEL` / `LOG_PRETTY` | `info` / `false` | Structured JSON logs; pretty logs require `pino-pretty` |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated list |
| `REPOSITORY_DRIVER` | `memory` | `memory` (dev/test) or `postgres` (requires `DATABASE_URL`) |
| `DATABASE_URL` | – | Required when `REPOSITORY_DRIVER=postgres` |
| `DB_AUTO_MIGRATE` | `false` | Apply pending migrations at startup (single-instance only) |
| `DB_MIGRATIONS_DIR` | – | Explicit path to the Drizzle SQL folder (required when the API bundle cannot resolve it) |
| `STORAGE_DRIVER` / `STORAGE_LOCAL_DIR` | `local` / `.data/storage` | Uploaded files and generated artifacts |
| `MAX_UPLOAD_MB` | `50` | Upload limit enforced by the API |
| `JSON_BODY_LIMIT_MB` | `2` | JSON request-body limit for non-multipart endpoints |
| `MAX_XLSX_UNCOMPRESSED_MB` / `MAX_XLSX_ENTRIES` | `512` / `20000` | ZIP-bomb guard: a workbook whose declared contents exceed these is rejected |
| `RETENTION_UPLOAD_TTL_HOURS` / `RETENTION_SWEEP_INTERVAL_MINUTES` | `168` / `60` | Background deletion of unreferenced uploads (deliverables are kept) |
| `API_KEY` | *(empty)* | When set, every `/api/v1` route requires a matching `x-api-key` header; `/healthz` and `/readyz` stay open |
| `ALLOW_INSECURE` | `false` | Production refuses to boot with the memory driver and/or no `API_KEY` unless this is `true` |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `600` / `60000` | Per-IP fixed-window rate limit; `0` disables it |
| `TRUST_PROXY` | `false` | Set `true` only behind a trusted reverse proxy |
| `DATASET_SAMPLE_ROWS` | `10` | Sample rows persisted/returned in a dataset preview |
| `DATASET_MAX_SCAN_ROWS` | `200000` | Hard cap on rows read during dataset inspection |
| `AI_PROVIDER` | `noop` | `noop` (sends nothing) or `openai` (requires `OPENAI_API_KEY` and `AI_MODEL`) |
| `AI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible endpoint (point at a gateway/local model) |
| `AI_TIMEOUT_MS` / `AI_MAX_ATTEMPTS` | `15000` / `2` | Per-request deadline and bounded retries (retryable failures only) |
| `AI_EXCLUDED_FIELDS` | – | Comma-separated field names that must never be sent to a provider |
| `INBOX_ENABLED` | `false` | Watch a folder and auto-run a saved workflow on dropped files |
| `INBOX_DIR` | – | Required when `INBOX_ENABLED=true`; each job is a subdirectory with a primary and events file |
| `INBOX_CONFIGURATION_ID` | – | Required when `INBOX_ENABLED=true`; the saved workflow to run |
| `INBOX_PRIMARY_PATTERN` / `INBOX_EVENTS_PATTERN` | `primary.*` / `events.*` | File-name patterns per dataset role |
| `INBOX_POLL_INTERVAL_MS` / `INBOX_SETTLE_MS` | `15000` / `3000` | Scan cadence and how long a file must stop changing before it is read |

## Database

The Drizzle schema in `packages/db/src/schema/tables.ts` targets Postgres 16 (see `docker-compose.yml`).
Generate SQL without a database with `npm run db:generate`; the initial migration lives in
`packages/db/drizzle/`. The API runs against in-memory repositories by default so the product is usable
and testable without infrastructure.

## Status

This repository is the foundation: the workflow engine, file processing, matching engine, rule engine,
review queue, API and UI are implemented and tested end to end for the account fault triage workflow. File
ingestion includes production-quality validation and a dataset inspection/preview UI, the
column-mapping/workflow configuration layer lets a nontechnical user connect files and columns once and
reuse the setup, and the reusable matching engine performs the deterministic primary↔event join and
latest-event selection with reported identifier normalization. Rules are first-class, editable **data**: the
**Rules** page lets a non-technical user build conditions (over the latest record or the whole event history)
and output assignments, validate them, and save a new version that the next run picks up. AI is an optional,
policy-gated **assistant** behind a provider abstraction: it can only be consulted when deterministic rules
are insufficient, it can never override a matched rule, its output is strictly validated (proposed class,
reasoning, confidence, ambiguity/missing-information flags), and any AI suggestion is recorded with full
provenance (`decisionSource`, provider, model, agreement) and routed to review unless auto-approval is
explicitly enabled. Provider failures degrade to a review reason, never a wrong result. Human review is a
first-class, fast loop: the **Review queue** filters to only what needs attention (needs review, conflicts,
low confidence, processing errors, overridden), shows each case's latest event, full event history,
deterministic result, applicable rules, confidence and any AI suggestion side by side, and supports
accept/override/dismiss with keyboard shortcuts and next-item navigation. Every human decision is an
append-only audit entry (what automation proposed, what the human changed, when) and, for runs with a mapped
account column, is written back into the generated output so the export matches the reviewed result.

Output generation is a modular, validated stage: the generated **Excel (.xlsx)** (primary) and CSV preserve
the primary file's structure and original row order, overwrite only the configured output columns, keep
leading-zero account numbers and long numeric identifiers as text, and never turn blanks into `0`. Each run
carries a live **export summary** (`GET /api/v1/runs/:id/export`) — total records, auto-resolved, reviewed,
unresolved, errors and unmatched — plus a `Summary` worksheet in the workbook, and the generated files are
re-read and validated (columns + row count) before the run is marked successful. The run page shows the
export status and the download buttons, so the flow reads UPLOAD → CONFIGURE → PROCESS → REVIEW EXCEPTIONS →
EXPORT FINAL REPORT.

The end-to-end journey is now a single, resumable experience with a shared progress indicator across Setup,
Rules, Processing, Review and Export, and a run summary that links straight to the review queue and the
report. Runs are **reproducible**: each run freezes an immutable snapshot of the configuration and rule-set
versions it started with (`GET /api/v1/runs/:id/snapshot`), so editing a setup or the rules tomorrow changes
only future runs and never a historical report.

The product is now organized around **saved workflows** — the recurring unit a returning user comes back to.
The **Dashboard** and **Saved workflows** page show, per workflow, its last run, latest status, records
processed, review count and whether the report is ready, each with a direct **Run again** action. "Run again"
attaches a new day's files and carries the remembered mapping (by column name) onto them, reporting any
column that needs re-mapping, and can optionally update the saved mapping to point at the new files. A
saved workflow remembers its dataset roles, column mappings, matching/latest-record logic, rules and
output/review options; creating a new one from scratch is the existing Setup flow. Scheduling,
authentication and multi-tenancy are deliberately deferred — see [`progress.md`](./progress.md) §15 and
[`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md) for the prioritized next steps.

The web app is a polished product surface rather than a data console. `/` is a landing page that explains the
product and the five-stage journey; the working app lives under `/dashboard`. Every screen is a real route
and is **code-split per route** (the entry shell and the framework libraries are separate, cacheable
chunks). The user always knows which step they are on — a shared Set up → Rules → Process → Review → Export
stepper appears on every stage — and what the system is doing: an in-flight run shows its expected pipeline
steps, an elapsed timer and a progress bar while it processes. All human-facing wording goes through one
label module, so internal tokens never reach the screen, and errors are rewritten into "what happened and
what to do next". Hard-to-undo actions (dismissing a review case, deleting a rule, replacing the active rule
set) require an explicit confirmation; everything else reports success through a transient toast. The review
workspace stays fast: filter chips with live counts, a keyboard cheat sheet (`?`), `a`/`o`/`d`/`j`/`k`
shortcuts, ARIA live announcements and the full automation/evidence/audit context. Accessibility and
performance are baseline: visible focus rings, a skip link, one `<main>` landmark, scrolling tables with
sticky headers, and a `prefers-reduced-motion` override.

## Production readiness

See [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md) for the full audit and
[`docs/deployment.md`](./docs/deployment.md) for the deployment runbook.

**Deployable topology:** the API ships as a Docker image for Render (with Postgres and a persistent
disk), and the SPA ships as a Cloudflare Worker (`wrangler deploy`) that serves the static build and
proxies `/api` to the API, injecting `x-api-key` server-side so the key never reaches the browser.
Migrations are applied by the image (`node apps/api/dist/index.js --migrate`) or at startup
(`DB_AUTO_MIGRATE=true`), `/readyz` proves database connectivity, and production refuses to boot with
the in-memory driver and/or no API key unless `ALLOW_INSECURE=true` is set deliberately.

**Still not production-ready as a multi-user, internet-facing SaaS.** The remaining blockers are
product/architecture, not packaging: there is no per-user identity or tenancy (only a single shared
secret), runs execute in a single process with no durable queue (so exactly one API instance is
supported), there is no delete/erasure flow, and the Postgres adapter is exercised by the CI Postgres
job rather than by a long-running production deployment. Suitable for a controlled single-tenant pilot.

## Security and privacy

Uploaded files are treated as untrusted input: filenames are sanitised (basename, illegal/reserved
characters, length), storage paths are proven to stay inside the storage root, uploads are validated
(extension, declared type, size, magic bytes), XLSX ZIP archives are checked for decompression-bomb shape
before parsing, and a rejected upload is deleted rather than left on disk. The API validates every body
with zod, returns only safe error codes/messages (5xx details are logged, never returned), can require a
shared `API_KEY`, applies a per-IP rate limit, sets conservative security headers, and redacts
credential-shaped fields from logs. Run creation supports an `Idempotency-Key`, runs execute at most once,
and runs interrupted by a restart are marked failed rather than left "processing".

This is a **local/trusted-deployment** build: without `API_KEY` it is unauthenticated, there is no
per-user authorization, tenant isolation or reviewer identity, and files are unencrypted on disk. See
[`docs/security-review.md`](./docs/security-review.md) for the repository-wide review and remaining risks,
and [`docs/privacy.md`](./docs/privacy.md) for exactly what is stored, what is sent to an AI provider, and
how long data lives.
