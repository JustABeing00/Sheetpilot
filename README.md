# SheetPilot

SheetPilot turns recurring Excel/CSV operational workflows into repeatable, explainable pipelines:

> upload daily files → inspect what was detected → match & group records → select the latest record →
> apply deterministic rules → generate the completed output → review only the unusual cases.

Uploaded files are ingested into a normalized, persisted **dataset profile** (sheets, columns, inferred
types, emptiness/uniqueness, samples and validation warnings); rows stay in object storage and are paged
on demand, so no stage loads a whole dataset into browser memory.

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
  web/                 React + Vite single-page app (dashboard, runs, review queue, workflows)
packages/
  core/                Domain model, zod schemas, API contracts, ports (zero runtime deps except zod)
  config/              Typed environment loading/validation (fail-fast, no secrets in code)
  file-processing/     CSV/XLSX readers & writers, schema inference, dataset inspection, upload validation, storage drivers
  rule-engine/         Rule DSL evaluation, deterministic winner selection, explanations, validation
  ai/                  ClassificationProvider port implementation, AI policy, provider factory
  workflow-engine/     Workflow program runner + the account-fault-triage workflow
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
| `AI_PROVIDER` | `noop` | `noop` today; `openai` fails fast until the adapter is implemented |

## Database

The Drizzle schema in `packages/db/src/schema/tables.ts` targets Postgres 16 (see `docker-compose.yml`).
Generate SQL without a database with `npm run db:generate`; the initial migration lives in
`packages/db/drizzle/`. The API runs against in-memory repositories by default so the product is usable
and testable without infrastructure.

## Status

This repository is the foundation: the workflow engine, file processing, rule engine, review queue, API
and UI are implemented and tested end to end for the account fault triage workflow. File ingestion now
includes production-quality validation and a dataset inspection/preview UI. Scheduling, editable rules,
AI providers, authentication and multi-tenancy are deliberately deferred — see
[`progress.md`](./progress.md) §15 for the prioritized next steps.
