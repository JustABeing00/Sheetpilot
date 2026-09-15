# SheetPilot — Project Progress

> **How to use this file.** This is the canonical handoff between coding sessions. Read §16 before touching
> code, then §15 for the exact work that should happen next. **Update this file at the end of every session**
> and keep the section structure intact. Never claim something is complete unless it exists, runs, and was
> verified (state the verification command in §9/§13). Never write secrets here.

**Last updated:** 2026-09-15 (session 1 — foundation)
**Repository:** local working copy at `D:\deepseekmodeltestingforexcelproj` (git initialized, no commits yet)
**Product name:** SheetPilot (working name, package scope `@sheetpilot/*`; easily renamed)

---

## 1. Product

SheetPilot automates recurring spreadsheet workflows. The user uploads the files they already use
(Excel/CSV), and the platform matches, groups and classifies records with explainable rules, generates the
completed output file, and asks a human to review only the unusual cases.

**Initial use case — account fault triage.** File A is a list of accounts with columns to fill in. File B
contains fault reports where the same account can appear many times. Today a person filters file B per
account, reads all fault descriptions, picks the latest fault, applies standardized classifications and
types four columns by hand. SheetPilot does that automatically and leaves ambiguous accounts for review.

## 2. Current Objective

**Session 1 objective: a production-quality foundation.** Architecture, repository structure, typed
contracts, deterministic rule engine, file processing, workflow engine, persistence strategy, API, UI shell
and one fully working end-to-end workflow — verified by tests and a smoke run. **Status: achieved** (see §8).

## 3. Product Vision

A reusable SaaS platform for recurring spreadsheet workflows:

1. file ingestion (upload, later: watched folders, email, SFTP, scheduled pulls)
2. schema detection and column mapping
3. joining/matching/grouping
4. latest-record selection
5. rule-based deterministic transformations (first-class, versioned rules)
6. AI-assisted classification for uncertain cases only
7. confidence scoring and review routing
8. exception/review queues with human feedback
9. Excel/CSV export (and later write-back to other systems)
10. reusable saved workflows, and eventually scheduling/automated ingestion

Guardrails: deterministic where possible; AI assists rather than overrides; every decision traceable;
human in the loop; business rules are data, not UI code; do not over-engineer enterprise features before the
core workflow is excellent.

## 4. Technology Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Frontend | React 19.3, Vite 8.3, React Router 7, TanStack Query 5, plain CSS tokens | No UI framework; typed API client parses responses with zod contracts |
| Backend | Node.js 22+ (developed on 24.6), TypeScript 5.x strict, Fastify 5.12 | `@fastify/multipart` uploads, `@fastify/cors`, pino logs |
| Validation/contracts | zod 4.6 (`@sheetpilot/core`) | Same schemas used by API and web |
| Database | Postgres 16 via Drizzle ORM 0.45 + drizzle-kit; in-memory repositories by default | SQL migrations generated; no live Postgres verified yet |
| File processing | `csv-parse` / `csv-stringify` (streaming), `exceljs` (buffered) | Behind `TabularReader`/`TabularWriter` async generator interfaces |
| Storage | `LocalFileStorage` (disk) and `InMemoryFileStorage` behind the `FileStorage` port | S3 later |
| Rules | Custom DSL in `@sheetpilot/rule-engine` | priority → specificity → id winner selection, explanation templates |
| AI | `ClassificationProvider` port + `NoopClassificationProvider` + policy function | Real provider intentionally not implemented yet |
| Tests | Vitest 5 (unit + integration + API E2E via `app.inject`) | 86 tests, 12 files, all green |
| Monorepo | npm workspaces (`apps/*`, `packages/*`), internal packages expose TypeScript source | Bundled by tsup (API) and Vite (web) |
| CI | GitHub Actions workflow at `.github/workflows/ci.yml` | lint → typecheck → test → build (not yet run on GitHub) |

## 5. Architecture

Full detail in [`docs/architecture.md`](./docs/architecture.md). Summary:

```
apps/web            React SPA  ──typed HTTP contracts──▶  apps/api (Fastify)
                                                            │
                                          ┌─────────────────┴─────────────────┐
                                          ▼                                   ▼
                              workflow-engine (programs,             file-processing (CSV/XLSX,
                              step traces)                           storage drivers)
                                          │                                   │
                                          ├──▶ rule-engine (deterministic rules, explanations)
                                          ├──▶ ai (policy + ClassificationProvider port)
                                          ▼
                                  core (domain, schemas, ports)  ◀── db (Drizzle schema + repos)
```

Dependency rule: inner layers never import outer layers; `web` only consumes `core` DTO schemas.
Run lifecycle: `POST /files` → `POST /runs` (202, queued) → background `RunService.execute` →
step traces + artifacts + decision log + review items → run `succeeded`.

## 6. Repository Structure

```
apps/
  api/src/
    index.ts               bootstrap (env → container → server → graceful shutdown)
    container.ts           composition root; seeds workflow + rule set into the repositories
    server.ts              Fastify factory, CORS, multipart, error mapping, 404 handler
    logger.ts              pino logger
    services/file-service.ts   upload validation, format detection, metadata (rows, columns)
    services/run-service.ts    run creation/execution, step persistence, artifacts, review resolution
    http/dto.ts            entity → DTO serializers
    http/http-utils.ts     zod parse helper, limit/offset, multipart field extraction
    http/routes/*.ts       health, meta, workflows, files, runs, review-items, artifacts
    fixtures.ts            reads the sample CSVs for tests
    server.test.ts         API integration + E2E test (upload → run → artifacts → review resolve)
  web/src/
    api/client.ts          typed fetch, zod response parsing, ApiError
    api/hooks.ts           TanStack Query hooks for every endpoint
    app/router.tsx         routes: /, /runs, /runs/new, /runs/:id, /review, /workflows, /workflows/:slug
    components/AppShell.tsx        sidebar shell, API status, open-review counter
    components/ui.tsx              Card, Badge, StatCard, EmptyState, LoadingState, ErrorState, Field, KeyValue
    components/ReviewItemCard.tsx  evidence view + accept/override/dismiss controls
    pages/*.tsx            Dashboard, Runs, RunDetail, NewRun, Workflows, WorkflowDetail, ReviewQueue, NotFound
    lib/format.ts, lib/rules.ts, lib/status.ts   formatting, condition descriptions, badge tones
    styles/app.css         design tokens + component styles (light professional theme)
packages/
  core/src/
    domain/enums.ts        RunStatus, ReviewReason, AiPolicy, file/artifact formats …
    domain/entities.ts     Workflow, FileAsset, WorkflowRun, StepRun, DecisionRecord, ReviewItem, Artifact…
    domain/rules.ts        Rule, ConditionGroup, RuleAction, RuleSet, RuleEvaluation
    api/contracts.ts       HTTP request/response schemas shared with the web app
    ports/                 repositories, file-storage, classification, logger, clock
    errors.ts              AppError hierarchy + zod error formatting + public error body
  config/src/schema.ts     zod env schema, .env discovery, fail-fast validation
  file-processing/src/
    table.ts, normalize.ts (keys, timestamps, Excel serials), inference.ts (column type detection)
    readers/               csv (streaming), xlsx (buffered), shared TabularReader
    writers/               csv, xlsx, buffer collection
    storage/               local-file-storage (traversal-safe), memory-file-storage
    registry.ts            format detection + reader/writer factories
  rule-engine/src/         conditions.ts, evaluate.ts, actions.ts, template.ts, validate.ts
  ai/src/                  noop-provider.ts, policy.ts, factory.ts
  workflow-engine/src/
    engine.ts              executeWorkflow (ordered steps, state merge, traces, cancel handling)
    registry.ts            WorkflowRegistry, RegisteredWorkflow, createDefaultWorkflowRegistry
    workflows/account-faults/  types.ts (config/state/columns), rules.ts (taxonomy + 7 rules),
                               steps.ts (5 steps), workflow.ts (program + registered workflow)
  db/src/
    schema/tables.ts       workflows, rule_sets, files, runs, run_steps, run_decisions, review_items, artifacts
    client.ts, migrations.ts, scripts/migrate.ts
    repositories/memory/   full in-memory implementation of every port (used by default + tests)
    repositories/postgres/ Drizzle implementation (type-checks; NOT yet run against a live database)
    drizzle/               generated migration 0000_lying_jigsaw.sql + snapshot
samples/account-faults/    canonical demo CSVs + README with expected outcomes (used by tests + smoke)
scripts/smoke.mjs          end-to-end smoke test against a running API
docs/architecture.md, docs/decisions.md   architecture deep dive and ADR log
```

## 7. Domain Model

| Entity | Purpose | Key fields |
| --- | --- | --- |
| `Workflow` | A registered workflow definition | slug, name, version, steps, configFields |
| `FileAsset` | An uploaded input file | kind (primary/events/generic), format, size, checksum, rowCount, columnNames, storageKey |
| `WorkflowRun` | One execution of a workflow | status, workflowSlug/version, file ids, config, stats, error, timestamps |
| `StepRun` | One pipeline step of a run | stepId, order, status, durationMs, metrics, error |
| `DecisionRecord` | Per-entity explainability record | entityKey, matchedRuleIds, aiAssisted, confidence, reviewReasons, outputValues, evidence |
| `ReviewItem` | A case for human review | entityKey, reason, severity, status, title, detail, suggestedValues, evidence, resolution |
| `Artifact` | Generated output file | kind (output_csv/output_xlsx/review_queue_csv), format, fileName, storageKey, sizeBytes |
| `RuleSet` / `Rule` | Versioned business rules | priority, when (all/any condition tree), then (set/set_if_empty), confidence, explanationTemplate |

Important enums: `RunStatus = queued|running|succeeded|failed|canceled`;
`ReviewReason = no_events|no_rule_match|rule_conflict|low_confidence|ambiguous_latest_timestamp|conflicting_fault_history|unparsed_timestamp|duplicate_primary_key`;
`AiPolicy = never|on_no_rule_match|on_low_confidence|always`.

Account-fault-triage specifics: 4 business columns (`RootCause`, `FaultCategory`, `RecommendedAction`,
`Priority`), optional `__`-prefixed system columns (fault count, latest fault time, matched rules,
confidence, review status, review reasons, explanation), 7 default rules over a 7-option taxonomy.

## 8. Completed (session 1)

- [x] Monorepo scaffolding: npm workspaces, strict TypeScript base config, ESLint 9 (type-aware flat
      config), Prettier, EditorConfig, `.gitignore`, `.env.example`, docker-compose for Postgres.
- [x] `@sheetpilot/core`: domain entities, enums, rule DSL, API contracts, ports, error hierarchy,
      logging/clock ports, zod validation helpers.
- [x] `@sheetpilot/config`: fail-fast env validation (postgres/AI cross-field rules), `.env` discovery.
- [x] `@sheetpilot/file-processing`: streaming CSV reader, buffered XLSX reader/writer, CSV writer, format
      detection (extension + content sniffing), column type inference (leading-zero identifiers stay
      strings), key/timestamp normalization (ISO, slash formats, Excel serials), local + in-memory storage.
- [x] `@sheetpilot/rule-engine`: condition evaluation (15 operators, nested all/any), deterministic
      winner selection, conflict reporting, action application (`set`/`set_if_empty`), explanation
      templates, rule set validation.
- [x] `@sheetpilot/ai`: `ClassificationProvider` implementation contract, noop provider, AI policy engine.
- [x] `@sheetpilot/workflow-engine`: step/program contracts, sequential runner with state merge, step
      traces, failure short-circuit, cancellation handling, workflow registry, and the complete
      **account-fault-triage** workflow (5 steps, 7 rules, review routing).
- [x] `@sheetpilot/db`: Drizzle Postgres schema (8 tables + indexes), generated migration, database client,
      migration runner, full in-memory repositories, Postgres repositories (type-checked, unverified).
- [x] `apps/api`: Fastify server with 16 endpoints (health, meta, workflows, files, runs, decisions,
      review items, artifacts download), background run execution, artifact generation, review resolution,
      error mapping, CORS, upload limits, graceful shutdown.
- [x] `apps/web`: React SPA shell with sidebar routing, dashboard, runs list, run detail (steps, stats,
      artifacts, decision log, review queue), new-run wizard driven by workflow config metadata, workflow
      definition/rule viewer, global review queue, API status.
- [x] Tests: 86 passing across 12 files, including an API-level end-to-end test and a workflow-level
      classification test driven by the canonical sample files.
- [x] `scripts/smoke.mjs` end-to-end smoke test (verified against the production API bundle).
- [x] Documentation: README, `docs/architecture.md`, `docs/decisions.md` (ADR-001…009), this file, CI workflow.

## 9. Current State — what actually works

Verified commands in this environment (Node 24.6.0, npm 11.5.1, Windows):

| Verification | Command | Result |
| --- | --- | --- |
| Types | `npm run typecheck` | clean across all 9 workspaces |
| Lint | `npm run lint` | clean |
| Tests | `npm test` | 12 files / 86 tests passed |
| Build | `npm run build` | API bundle (`apps/api/dist/index.js`) + web assets (`apps/web/dist`) |
| Production smoke | start `node apps/api/dist/index.js` then `npm run smoke` | run succeeded, 3 artifacts, 7 review items, 9 decision records, review resolution OK |
| Dev servers | `npm run dev` (or the two dev scripts) | API on 4000, Vite on 5173, `/api` proxy verified with `curl`/`Invoke-WebRequest` |
| Migrations | `npm run db:generate` | generated `packages/db/drizzle/0000_lying_jigsaw.sql` for 8 tables |

Working end to end: upload CSV/XLSX → inspect metadata → start run (202, background execution) → step
traces → deterministic classification with the latest-fault selection → output CSV/XLSX + review queue CSV
→ decision log → review queue with accept/override/dismiss → review counters.

Sample run results (canonical `samples/account-faults` files): 9 accounts, 13 events, 10 output rows,
2 auto-approved, 7 review items (conflicting history, no events, no rule match, low confidence, duplicate
primary key, ambiguous timestamps), 1 orphan event account ignored and counted.

## 10. Known Issues / Limitations

1. **Postgres adapter is unverified** — the Drizzle repositories type-check and migrations generate, but no
   Postgres instance was available (no Docker in this environment). Verify before relying on it.
2. **In-memory mode is the default** — uploads/artifacts are on disk (`STORAGE_LOCAL_DIR`) but all metadata
   is lost on restart, and in-flight runs do not survive a restart.
3. **npm optional-dependency bug (Windows)** — `vitest` (rolldown) and Vite (lightningcss) failed until
   `@rolldown/binding-win32-x64-msvc` and `lightningcss-win32-x64-msvc` were installed explicitly as root
   dev dependencies. CI on Linux may need the equivalent (`@rolldown/binding-linux-x64-gnu`,
   `lightningcss-linux-x64-gnu`) or a fresh `npm install` without the lockfile. Do not delete these
   explicit bindings.
4. **AI provider not implemented** — `AI_PROVIDER=openai` intentionally throws a `ConfigurationError`
   at startup. `NoopClassificationProvider.isAvailable()` is false, so no AI calls are ever made today.
5. **Review resolutions do not regenerate artifacts** — resolving an item records the decision but the
   output CSV/XLSX is not rewritten yet (next session item).
6. **Cancellation is internal only** — `RunService.cancelRun` exists but is not exposed as an endpoint.
7. **XLSX reading/writing is buffered in memory** — fine for operational files, not for very large
   workbooks; the reader/writer interfaces already allow a streaming implementation later.
8. **No polling progress** — runs show step-level results only after completion; per-step progress events
   are not emitted yet.
9. **`duplicate_primary_key` rows still produce output rows** — both duplicate primary rows are written with
   the same classification and flagged `critical` for review (intentional: never silently drop input rows).
10. **No auth, no tenancy, no rate limiting** — the API is intended for local/trusted deployment only.
11. **Test fixtures depend on the `samples/` directory** — moving those files breaks
    `apps/api/src/fixtures.ts` and the account-faults test.
12. **Bundle size warnings** — the web bundle is ~480 KB (143 KB gzip) with everything included; consider
    route-level code splitting when the UI grows.

## 11. Technical Decisions

Recorded as ADRs in [`docs/decisions.md`](./docs/decisions.md):

- ADR-001 npm workspaces with TypeScript-source internal packages (bundled by consumers).
- ADR-002 Fastify API + React/Vite SPA instead of Next.js (long-running jobs, clear API boundary).
- ADR-003 rules are data, evaluated by a dedicated deterministic engine.
- ADR-004 Postgres via Drizzle with in-memory repositories as the default runtime adapter.
- ADR-005 runs execute in-process and asynchronously with step-level traces persisted.
- ADR-006 AI assists, never overrides deterministic results; policy-gated.
- ADR-007 rule-declared confidence + thresholds decide review routing.
- ADR-008 explainability is persisted (decision log + review evidence + `__` output columns).
- ADR-009 uploads validated on ingestion (format sniffing, row count, column names).

Additional decisions made during implementation:

- Internal packages expose `src/index.ts` via `exports`; nothing pre-builds, so no build ordering issues.
- The API bundle **must** externalize its real runtime dependencies. `exceljs`, `csv-parse`,
  `csv-stringify`, `drizzle-orm`, `postgres`, `zod` and `pino` are declared in `apps/api/package.json`
  specifically so tsup keeps them external — do not remove them or the bundled CJS code will crash.
- Leading-zero numeric strings are inferred as `string` (identifiers such as account numbers), never `number`.
- Deterministic tie-breaks everywhere: rules by priority → specificity → id; latest fault by timestamp →
  later source row.
- `WorkflowOutputs` is the engine↔service contract, so `RunService` never knows workflow specifics.

## 12. Security

Implemented:

- **Secrets** are never in source. `.env` is git-ignored, `.env.example` documents variables without values;
  config validation fails fast on missing cross-field requirements.
- **Path traversal protection** in `LocalFileStorage` (rejects `..`, normalizes separators) and uploaded
  file names are reduced to their basename via `path.basename`.
- **Upload limits** enforced by `@fastify/multipart` (`MAX_UPLOAD_MB`) and a 2 MB JSON body limit.
- **CSV/Excel formula injection guard** — strings starting with `= + - @` are written as plain text (rich
  text run) in XLSX.
- **Strict validation** at every boundary: zod for HTTP bodies, workflow inputs, workflow config (strict
  object → unknown keys rejected), rule sets and file metadata.
- **Error hygiene** — internal errors are logged, clients receive `{ error: { code, message } }` only;
  `isAppError` distinguishes safe errors from unexpected ones.
- **Logging** never includes file contents; logs carry ids, sizes, counts.

Not yet implemented (risks acknowledged):

- No authentication/authorization, no tenant isolation, no audit trail of who resolved a review item
  (`resolvedBy` is always `null`), no rate limiting, no malware scanning of uploads, no TLS termination
  (deploy behind a reverse proxy), CORS origins must be set explicitly in production, and files are stored
  unencrypted on local disk.

## 13. Testing

**Status: 86 tests / 12 files passing (`npm test`).** Coverage by area:

| Area | File | What it proves |
| --- | --- | --- |
| Domain schemas | `packages/core/src/domain/rules.test.ts` | defaults, nested groups, validation errors |
| Env config | `packages/config/src/schema.test.ts` | defaults, coercion, cross-field failures |
| Normalization/parsing | `packages/file-processing/src/normalize.test.ts` | keys, ISO/slash/Excel timestamps, invalid input |
| CSV | `packages/file-processing/src/csv.test.ts` | quoted delimiters, embedded newlines, BOM, limits, round-trip writing |
| XLSX | `packages/file-processing/src/xlsx.test.ts` | type round-trip (string/number/boolean/date/null), formula-injection guard, empty sheets |
| Inference/detection | `packages/file-processing/src/inference.test.ts` | column typing, nullability, format sniffing, reader/writer factories |
| Rules | `packages/rule-engine/src/rule-engine.test.ts` | 15 operators, tie-breaks, conflicts, actions, validation |
| AI policy | `packages/ai/src/ai.test.ts` | policy decisions, noop provider, fail-fast factory |
| Engine | `packages/workflow-engine/src/engine.test.ts` | step ordering, state merge, metrics, failure short-circuit, cancellation |
| Workflow | `packages/workflow-engine/.../account-faults.test.ts` | full classification output, latest fault, review reasons, stats, evidence |
| API | `apps/api/src/server.test.ts` | health, meta, workflows, uploads, 415, run E2E, artifacts download, decisions, review resolve, 404/400/409 |
| UI helpers | `apps/web/src/lib/format.test.ts` | formatting utilities |

Missing (recommended next): Postgres repository integration tests (behind a `DATABASE_URL` gate), rule
engine property/fuzz tests, load test for large CSV uploads, Playwright browser test for the new-run flow,
and coverage reporting in CI.

## 14. Environment

Setup (no secrets in this file — copy `.env.example`):

```bash
npm install
cp .env.example .env        # optional: defaults work with no .env at all
npm run dev                 # API :4000, web :5173
```

Variables (defaults in parentheses): `NODE_ENV` (development), `API_HOST`/`API_PORT` (127.0.0.1/4000),
`LOG_LEVEL` (info), `LOG_PRETTY` (false), `CORS_ORIGIN` (http://localhost:5173),
`REPOSITORY_DRIVER` (memory) + `DATABASE_URL` (required for postgres), `STORAGE_DRIVER` (local) +
`STORAGE_LOCAL_DIR` (.data/storage), `MAX_UPLOAD_MB` (50), `AI_PROVIDER` (noop), `OPENAI_API_KEY` (empty),
`AI_MODEL` (empty). Web: `VITE_API_BASE_URL` (empty → Vite dev proxy to the API), `VITE_API_TARGET`
(proxy target, default `http://127.0.0.1:4000`).

Local data lives in `.data/` (git-ignored): `storage/` for uploads/artifacts, log files from manual runs.
Postgres for later verification: `docker compose up -d postgres` (user/password/db all `sheetpilot`).

## 15. Next Session — exact recommended work

**Priority 1 (recommended first): verify and harden the Postgres path.** Start `docker compose up -d postgres`,
run `npm run db:push`, then `REPOSITORY_DRIVER=postgres npm run dev:api` and repeat `npm run smoke`.
Fix whatever surfaces in `packages/db/src/repositories/postgres/index.ts` and add integration tests gated
by `process.env.DATABASE_URL` (skip when absent). Until this passes, do not claim Postgres support.

**Priority 2: make reviews affect the output.** After resolving review items, regenerate the run artifacts
from the recorded resolutions (recompute output rows for the affected entities, write a new artifact
version or overwrite with an incremented revision) and expose it via the existing artifacts endpoint.

**Priority 3: rule management.** `rule_sets` already persists rule sets; add CRUD endpoints
(validate with `validateRuleSet`), version bumps, and an active-rule-set selector per workflow, then a
read-only → editable rules screen in the web app.

**Priority 4: review queue ergonomics.** Filtering by reason/severity/workflow, pagination, bulk accept,
and surfacing AI suggestions in the UI when a provider exists.

**Priority 5: scheduling / automated ingestion.** A watched-folder or cron trigger that creates runs for
new files, plus notifications; keep it behind a feature flag and reuse `RunService.createRun`.

**Priority 6: real AI provider.** Implement an OpenAI `ClassificationProvider` with structured output,
wire it through `createClassificationProvider`, and keep the rule-first policy intact.

Also worth doing when convenient: cancellation endpoint, per-step progress events, route-level code
splitting in the web bundle, coverage reporting, and a Playwright test for the new-run wizard.

**Definition of done for the next session:** the chosen priority item is implemented, has tests, docs
(`docs/decisions.md` if architectural), all four verification commands pass (`lint`, `typecheck`, `test`,
`build`) plus `npm run smoke` for API-affecting changes, and this file is updated with real results.

## 16. Important Context

- **Verification-first culture.** Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`
  before declaring anything done. `progress.md` must reflect reality, not intentions.
- **Layer boundaries are load-bearing.** `core` must not import other packages; `workflow-engine` must not
  import Fastify/React; `web` must not import Node-only packages (`file-processing`, `db`, `workflow-engine`).
  New cross-layer values go through `core` contracts/ports.
- **Internal packages export TypeScript source** (`"exports": "./src/index.ts"`). Consumers (tsx, tsup,
  Vite, vitest) compile them. Created with npm workspaces — do not switch to pnpm without updating
  `package-lock.json` and every workspace script.
- **The API bundle externalizes runtime deps.** Anything a bundled workspace package imports at runtime must
  appear in `apps/api/package.json` dependencies (see ADR notes in §11).
- **Data heuristics matter.** `normalizeKey` upper-cases and collapses whitespace; `parseTimestamp`
  handles ISO, `YYYY/MM/DD`, `MM/DD/YYYY` (or day-first via config) and Excel serials; leading-zero numeric
  strings stay strings. Changing these changes classification results — update the sample expectations too.
- **Sample files are canonical fixtures.** `samples/account-faults/*.csv` are used by the API test and the
  workflow test, and their README documents expected outcomes. If behavior changes intentionally, update
  both the code and those expectations.
- **Rule changes are product changes.** `packages/workflow-engine/src/workflows/account-faults/rules.ts`
  is validated by zod at import time; the default rule set is versioned (`version: 1`). Bump the version
  when rules change materially and note it here.
- **Review status vocabulary:** `open`, `resolved_accepted`, `resolved_overridden`, `dismissed`.
  `__ReviewStatus` in output files is `AUTO_APPROVED` or `REVIEW_REQUIRED`.
- **Roadmap guardrail:** don't add enterprise features (SSO, billing, complex RBAC) before the core
  workflow, review loop and Postgres durability are excellent.
- **Files a new agent should read first:** this file → `docs/architecture.md` → `packages/core/src/domain/entities.ts`
  → `packages/workflow-engine/src/workflows/account-faults/{types,steps}.ts` → `apps/api/src/services/run-service.ts`.

### Session log

| Session | Date | Summary |
| --- | --- | --- |
| 1 | 2026-09-15 | Foundation: monorepo, core/domain/ports, config, file-processing, rule engine, AI seam, workflow engine + account-fault-triage workflow, Drizzle schema + in-memory/Postgres repositories, Fastify API, React SPA, samples, smoke script, docs. Verified: lint/typecheck/86 tests/build/smoke/dev servers. |
