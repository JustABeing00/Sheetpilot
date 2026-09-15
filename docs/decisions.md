# Technical decisions (ADRs)

Short, dated records of decisions that shape the codebase. New decisions should be appended, not rewritten.

## ADR-001 — Monorepo with npm workspaces, TypeScript-source internal packages

**Decision.** A single repository with `apps/*` and `packages/*`, managed by npm workspaces. Internal
packages expose `src/index.ts` directly through `exports` instead of prebuilt `dist` bundles.

**Why.** The API is bundled (tsup) and the web app is bundled (Vite), so nothing needs prebuilt JS. This
removes build-ordering friction, keeps cross-package type information exact, and makes "one command"
development possible. npm is used because it requires no extra tooling for contributors; pnpm would be
marginally faster but is not preinstalled.

**Consequences.** Packages are private and not independently publishable. Production builds always go
through a bundler. Type checking runs across package sources (slightly slower, more accurate).

## ADR-002 — Fastify API + React/Vite SPA instead of a single Next.js app

**Decision.** Separate the HTTP API (`apps/api`, Fastify) from the UI (`apps/web`, Vite + React Router).

**Why.** The product is an internal-tool-style SaaS with long-running background work (file processing)
and a clear API boundary. Fastify gives explicit control over multipart uploads, background jobs and
process lifecycle without serverless constraints, and the SPA stays a pure client of the documented API.
It also keeps the workflow engine a server-side library that can later be reused by a worker process.

**Consequences.** No SSR and no framework-level API routes; the API must be deployed alongside the static
frontend. In exchange, the run lifecycle (queued/running/succeeded) is a first-class server concept.

## ADR-003 — Business rules are data, evaluated by a dedicated rule engine

**Decision.** Rules live in `@sheetpilot/rule-engine` (types in `@sheetpilot/core`), are validated with
zod, and are evaluated deterministically: priority → specificity → rule id.

**Why.** The product principle is "rules are first-class objects, not buried in UI code". A small DSL
(`all`/`any` groups of leaf conditions with a fixed operator set and `set`/`set_if_empty` actions) is
expressive enough for the classification use case while remaining explainable and testable.

**Consequences.** Rule authors cannot run arbitrary code; new operators require engine changes. The
`rule_sets` table already exists for storing rule sets, so making them editable later is incremental.

## ADR-004 — Postgres via Drizzle, with in-memory repositories as the default runtime

**Decision.** Model persistence with Drizzle ORM against Postgres, generate SQL migrations with
drizzle-kit, and provide a complete in-memory implementation of the same repository ports.

**Why.** SQL-first migrations stay reviewable, and there is no code-generation step or engine binary.
The in-memory adapter keeps local development and CI dependency-free, and it is the adapter used by the
test suite, so the API's behavior is verified even without infrastructure.

**Consequences.** Two repository implementations must be kept in sync (interface-level tests mitigate
this). No Postgres instance was available in the initial environment, so the Postgres adapter is
type-checked and generated-by-schema but not yet exercised against a live database.

## ADR-005 — Runs execute in-process and asynchronously, with step-level traces

**Decision.** `POST /api/v1/runs` persists a queued run and returns 202; execution continues in the
background inside the API process. Steps, metrics, artifacts, decisions and review items are persisted
as the run progresses.

**Why.** The UX requires "drop files → refresh → review exceptions", and long file processing must not
block HTTP requests. Recording step executions from the first iteration makes the run inspectable and
gives a natural seam for moving execution to a worker later.

**Consequences.** Runs do not survive an API restart, and there is no cross-process queue yet. The run
state model (queued/running/succeeded/failed) already matches a future worker/queue design.

## ADR-006 — AI assists, never overrides; deterministic results always win

**Decision.** AI classification is optional, invoked only under an explicit policy
(`never`, `on_no_rule_match`, `on_low_confidence`, `always`), and its suggestions are recorded in the
decision evidence and review items rather than being written into the output automatically.

**Why.** The product must be reliable, explainable and auditable. A wrong silent AI override is worse
than a review task. The `ClassificationProvider` port plus the policy function keep the seam explicit.

**Consequences.** Until a real provider is implemented, unmatched accounts are simply reviewed. The
policy layer and contract are already tested, so adding OpenAI is additive.

## ADR-007 — Confidence is rule-declared, thresholds decide review routing

**Decision.** Each rule declares a confidence (0–1); accounts whose winning rule scores below
`reviewBelowConfidence` (default 0.8) are routed to review. Accounts without any matching rule always go
to review.

**Why.** It makes "which cases need a human" an explicit, tunable product decision instead of a hidden
heuristic, and it composes with the AI policy (`on_low_confidence`).

**Consequences.** Rule authors must think about confidence; the sample rule set uses 0.6–0.97 to
demonstrate automatic, low-confidence, and unmatched paths.

## ADR-008 — Explainability is persisted, not computed on demand

**Decision.** Each run writes `DecisionRecord`s (matched rule ids, confidence, review reasons, output
values, evidence) and each review item carries the same evidence, in addition to the `__`-prefixed
system columns in the output file.

**Why.** Traceability must survive after the run, including for exports handed to other people, and must
be queryable by the UI without re-running the engine.

**Consequences.** More rows are written per run (one per entity) and output files contain system columns;
`includeSystemColumns` can be turned off per run when a clean file is required.

## ADR-009 — Uploads are validated on ingestion and stored with metadata

**Decision.** On upload, the API detects the format from the extension plus content sniffing, stores the
original file, and records row count and column names on the `FileAsset`.

**Why.** Users need immediate feedback ("did it read my file?") and later stages need the column list for
mapping UI and error messages. Detection by content prevents silently treating an XLSX as CSV.

**Consequences.** Uploads are parsed once for preview and once for counting; large-file streaming
ingestion is a future optimization behind the same reader interface.
