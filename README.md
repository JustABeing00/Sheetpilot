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
versioned configuration can start a run and be reused. A reusable **matching engine**
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
  web/                 React + Vite single-page app (dashboard, datasets, setup, runs, review queue, workflows)
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

Open http://localhost:5173, go to **New run**, upload
`samples/account-faults/primary_accounts.csv` and `samples/account-faults/fault_events.csv`, and start
the run. You should get 10 output rows, 2 auto-approved accounts, 7 review items and 3 artifacts
(CSV, XLSX, review queue CSV).

To inspect a file first, open **Datasets**, upload `samples/account-faults/fault_events.csv`, and read the
detected sheets, columns, inferred types and validation warnings; the row preview is paged.

For the guided path, open **Setup**: upload both sample files under **Datasets**, then assign them to the
primary/events roles, map the account/date/description columns (the page suggests defaults and validates
as you go), save the configuration, and click **Continue to processing**.

No configuration is required: the API defaults to in-memory repositories and local file storage.
Copy `.env.example` to `.env` to change ports, storage, Postgres, logging or AI settings.

### Verify without the UI

```bash
npm run dev:api                        # terminal 1
npm run smoke                          # terminal 2: uploads samples, runs the workflow, checks artifacts
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run API and web app together |
| `npm run build` | Build the API bundle and the web app |
| `npm run typecheck` | TypeScript strict typecheck for every workspace |
| `npm run lint` | ESLint (type-aware) across the monorepo |
| `npm run format` / `format:check` | Prettier write / verify |
| `npm test` / `test:watch` | Vitest unit + integration tests |
| `npm run smoke` | End-to-end smoke test against a running API |
| `npm run benchmark -w @sheetpilot/matching-engine` | Synthetic primary↔event join benchmark (10k–250k entities) |
| `npm run db:generate` | Generate SQL migrations from the Drizzle schema |
| `npm run db:push` | Push the schema to a Postgres database (development) |

## Environment

All variables are validated at startup by `@sheetpilot/config` and documented in [`.env.example`](./.env.example).
Never commit a real `.env` file — `.gitignore` excludes it.

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `API_HOST` / `API_PORT` | `127.0.0.1` / `4000` | API bind address |
| `LOG_LEVEL` / `LOG_PRETTY` | `info` / `false` | Structured JSON logs; pretty logs require `pino-pretty` |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated list |
| `REPOSITORY_DRIVER` | `memory` | `memory` (dev/test) or `postgres` (requires `DATABASE_URL`) |
| `DATABASE_URL` | – | Required when `REPOSITORY_DRIVER=postgres` |
| `STORAGE_DRIVER` / `STORAGE_LOCAL_DIR` | `local` / `.data/storage` | Uploaded files and generated artifacts |
| `MAX_UPLOAD_MB` | `50` | Upload limit enforced by the API |
| `DATASET_SAMPLE_ROWS` | `10` | Sample rows persisted/returned in a dataset preview |
| `DATASET_MAX_SCAN_ROWS` | `200000` | Hard cap on rows read during dataset inspection |
| `AI_PROVIDER` | `noop` | `noop` (sends nothing) or `openai` (requires `OPENAI_API_KEY` and `AI_MODEL`) |
| `AI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible endpoint (point at a gateway/local model) |
| `AI_TIMEOUT_MS` / `AI_MAX_ATTEMPTS` | `15000` / `2` | Per-request deadline and bounded retries (retryable failures only) |
| `AI_EXCLUDED_FIELDS` | – | Comma-separated field names that must never be sent to a provider |

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
explicitly enabled. Provider failures degrade to a review reason, never a wrong result. Scheduling,
authentication and multi-tenancy are deliberately deferred — see [`progress.md`](./progress.md) §15 for the
prioritized next steps.
