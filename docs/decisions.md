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

## ADR-010 — Ingestion produces a persisted, bounded dataset profile

**Decision.** Uploading a file and inspecting its structure are a single operation
(`DatasetService.ingest`), which validates the upload, stores it under a generated internal id and
persists a `DatasetProfile`: sheet names, columns with inferred types, emptiness/uniqueness statistics,
likely date/identifier flags, a bounded set of sample rows and validation warnings. Full rows are never
persisted or sent to the browser; they stay in object storage and are paged on demand through
`GET /api/v1/datasets/:id/rows` (and re-analysed per sheet through
`GET /api/v1/datasets/:id/analysis`).

**Why.** The first real product capability is "what did the system detect?", and later stages (mapping,
matching, classification) need a normalized structural representation. Persisting the profile makes that
representation reusable and auditable, while paging keeps the browser and the API memory-bounded
regardless of file size.

**Consequences.** Every upload creates two linked records (the `FileAsset` used by runs and the
`DatasetProfile` used for inspection). Inspection reads the source once with a hard
`DATASET_MAX_SCAN_ROWS` cap, so for very large files `rowCount` is a lower bound and `truncated` is set.
Uniqueness tracking is additionally capped, so `uniqueCount` can be approximate on huge columns. Legacy
`.xls` is rejected with guidance. The reader contract gained `describe()` (sheets + headers) so the
inspection logic is format-agnostic and a streaming/DuckDB implementation can replace it later behind
the same `TabularReader` interface.

## ADR-011 — Workflow configuration is a persisted, declared domain object

**Decision.** A workflow declares its mapping requirements as data
(`WorkflowConfigurationDefinition`: dataset roles + semantic column roles + scalar options). A user then
creates a `WorkflowConfiguration` that assigns datasets to roles and real detected columns to semantic
column roles; it is validated by a pure function in `@sheetpilot/core` and persisted through a
`WorkflowConfigurationRepository` (in-memory and Postgres). Starting a run resolves the configuration into
concrete file ids and workflow config keys through the workflow's `resolveRunInput`.

**Why.** The product must let a nontechnical Excel user say "this column is the account number, this one is
the fault date" once and reuse it every day. Hardcoding "File 1"/"File 2" or column keys in React would make
every new workflow a UI rewrite and hide business configuration in components. Roles-as-data keeps the UI
generic, the validation shared between API and (via the validation endpoint) the browser, and the mapping
auditable and versioned.

**Consequences.** Configurations reference dataset ids and column *names*; reusing a setup for a new daily
file means re-pointing the dataset assignments (column names usually stay the same). Saving a configuration
increments a `version` but does not keep historical snapshots yet (backlog). `resolveRunInput` is optional
on a workflow, so a workflow without declared roles can still run the legacy way. Ambiguous or atypical
mappings (for example a date column used as an identifier) block saving until the user explicitly confirms
them; confirmations are stored on the mapping. Validation is structural + semantic only — it does not scan
all rows, so it uses the bounded `DatasetProfile` and sample values.

**Alternatives considered.** Inline config fields in the workflow definition (rejected: status quo, no
reuse/versioning). Letting the UI own the role/mapping shapes (rejected: layer violation and duplicated
validation). A dedicated `@sheetpilot/config-engine` package (deferred: `core` already holds the domain and
the validation is pure, so a package would add boilerplate without a boundary).

## ADR-012 — Matching, grouping and latest-event selection is a standalone engine

**Decision.** Primary↔event joining is implemented once, in a new example-agnostic package
`@sheetpilot/matching-engine`, not inside a workflow. `matchRecords(input, options)` takes two arrays of
already-loaded records plus accessor functions (`primaryKey`, `eventKey`, `eventTimestamp`), normalizes
identifiers, groups events under their entity, orders each entity's complete history deterministically,
selects the latest event and returns `MatchedEntity[]` + orphan events + aggregate `MatchStats`.
`normalizeIdentifier` reports every transformation it applies and keeps dangerous merges (separator
removal, leading-zero stripping) off by default and flagged when enabled. The account-faults workflow's
`group-events` step delegates to it and maps the result back to its own `AccountGroup` type.

**Why.** "Match the account, collect every fault, pick the latest" is the core processing primitive the
whole product is built on, and it is needed by every future workflow. Leaving it intertwined with the
account-faults classification both duplicated logic and made the join untestable in isolation. Keeping it
generic means a new workflow gets a tested, deterministic join for free, and the difficult cases (missing,
equal and invalid timestamps, orphans, duplicates, identifier formatting) are specified and verified in
one place. Identifier normalization was made explicit and reported because silently merging identifiers is
a correctness risk for financial/operational data: the engine must be able to say *what* it changed and
never do a risky transformation unless a configuration opts in.

**Consequences.** `matching-engine` depends on `file-processing` for the canonical `normalizeKey` /
`parseTimestamp` helpers so matching stays consistent with ingestion; `workflow-engine` depends on it. The
engine operates on in-memory arrays (a single O(P + E + Σ eᵢ log eᵢ) pass) so very large files still need a
chunked loader behind the same contract. Engine issues are computed but the workflow still derives its own
review reasons in `classify`, so wiring them together is future work. Default normalization is byte-for-byte
`normalizeKey`, which keeps the sample results unchanged.

**Alternatives considered.** Keeping grouping inside `workflow-engine` (rejected: not reusable, harder to
test the edge cases). Putting the engine in `file-processing` (rejected: that package is about IO/format
handling, not record semantics). Using a third-party fuzzy-match library (rejected: opaque, and the product
requires explainable, deterministic matching).

## ADR-013 — Rules are data, evaluated deterministically, and managed through a validated, versioned API

**Decision.** Business classification rules are structured data (`Rule`/`RuleSet`, zod-validated in `core`),
never executable code. `@sheetpilot/rule-engine` evaluates a rule set against a context and returns a rich
`RuleEvaluation`: the winning rule and priority, the confidence, a rendered explanation, the full list of
matched rules, the **resulting values** the winner would set, the flattened **conditions evaluated** (with
the actual value seen and whether it matched), and any **conflicts**. Conditions carry a `scope`
(`latest` / `any_event` / `all_events`) so a rule can assert over the entity's whole history, not just the
latest record. The evaluation is a first-class decision: `status` is `matched` or `no_match`, and
`needsReview`/`reviewReasons` encode the three cases a deterministic engine must never guess about — no rule
matched (`no_rule_match`), equally-ranked rules disagreed (`rule_conflict`), or confidence is below the
configured threshold (`low_confidence`). Rules with different priorities are an intended fallback hierarchy,
so only same-priority disagreement is a conflict; the winner is still chosen deterministically (priority →
specificity → rule id) and reported for traceability. `apps/api` exposes a `RuleSetService` and
`GET/POST/PUT /api/v1/rule-sets` plus `POST /api/v1/rule-sets/validate`; every save is re-validated with the
same pure validator and bumped to a new version, and keeping a single active set per workflow means a run
always resolves exactly one source of truth. `RunService` loads the active persisted rule set and passes it
into the run input, so UI edits take effect on the next run without a restart.

**Why.** The initial workflow's value (and the product's "trust" goal) rests on standardized, auditable
classification. Rules as data can be validated before they run, versioned, diffed, edited by non-technical
users, and later suggested by AI without the AI ever becoming the source of truth. Returning conditions,
resulting values and conflicts from the engine — rather than recomputing them in the UI or workflow — keeps
explainability consistent across the API, the output file and the review queue.

**Consequences.** `rule-engine` stays UI- and workflow-agnostic: it only knows `RuleContext` (an open
record, optionally containing an `events` history array). History scopes read fields from that array, so the
workflow is responsible for passing normalized history (it does, in `buildRuleContext`). The persisted
`rule_sets` table gained a `listByWorkflowSlug` query but no new columns; conflicts are detected among
same-priority matches; duplicate condition signatures with lower priority are reported as warnings by the
validator. The in-code default rule set is still the seed and the test fixture; management is additive.

**Alternatives considered.** Executing rules as JavaScript (rejected: unsafe, unauditable, untestable).
A generic expression language (rejected as premature: the operator set plus nested all/any groups covers the
use case and is far easier for non-technical users to reason about). Letting runs read rules straight from
the registry's in-code set (rejected: makes rule editing impossible without a redeploy). Using lowest
priority number as the winner (rejected: higher number = more specific/intentional, matching the existing
priority ordering).

## ADR-014 — AI assists behind a provider abstraction and never overrides a deterministic rule

**Decision.** Model-based classification lives behind a single provider port
(`ClassificationProvider`: `id`, `displayName`, `model`, `isAvailable()`, `classify(request, signal)`), and
all orchestration is provider-neutral (`AiClassificationService`). A provider receives only a bounded,
structured `AiClassificationRequest` (entity key, latest event, bounded event history, classification
targets, already-evaluated rule summaries, hints) and must return a strictly `zod`-validated
`AiClassificationResult` (`proposedCode`, `proposedLabel`, `confidence`, `reasoning`, `ambiguity[]`,
`missingInformation[]`). Free-form prose is never accepted: responses are extracted from their JSON object
and schema-checked, unknown keys are stripped, and a proposed code outside the configured targets is a hard
`unexpected_classification` failure. The decision pipeline is explicit and one-directional:

```
deterministic rules → if confident: accept (AI may only raise a disagreement for review)
                    → else AI may assist (policy-gated)
                    → confidence/ambiguity evaluation
                    → automatic result (only if aiAutoApprove) or human review
```

`resolveAssistedDecision` is the single place that combines the two: a matched rule is **never** replaced by
AI, AI can only corroborate a weak rule (raising confidence when auto-approval is enabled) or supply values
when no rule matched. AI-sourced values are labelled `decisionSource: ai_suggested`, recorded in decision
evidence and the `__DecisionSource` output column, and by default (`aiAutoApprove: false`) are always routed
to a human. The policy (`never` / `on_no_rule_match` / `on_low_confidence` / `always`), provider, model,
base URL, timeout, attempts and excluded fields are configuration, not code.

**Why.** The product's trust proposition is that classifications are deterministic and explainable, so AI
must be an assistant with a hard, testable ceiling. A provider abstraction keeps the model replaceable
(OpenAI today, a local/gateway model later, a mock in tests) and prevents vendor lock-in and live calls in
CI. Strict validation is required because model output is untrusted input: a hallucinated class or a
malformed response must degrade to "needs review", never to a wrong silent classification. Recording
`deterministic` vs `ai_suggested` vs a later human resolution keeps the provenance of every output value
auditable.

**Consequences.** Provider failures, timeouts, rate limits, invalid credentials, malformed responses and
unexpected classes are normalized into a non-throwing `AiAssistOutcome` (`not_consulted` / `disabled` /
`skipped` / `no_suggestion` / `suggested` / `failed`); a failing AI layer can never fail a run. Retries are
bounded and only applied to retryable failures (timeout, rate limit, 5xx, network). Data minimisation is
structural: the request is built from descriptions/timestamps only (never the raw row) and an
`AI_EXCLUDED_FIELDS` redaction pass runs inside the service before the provider sees anything. The
`run_decisions` table gained a `decision_source` column (migration `0003`) and decision/review DTOs expose
the validated outcome. Tests inject a mock provider, so ordinary `npm test` never makes a network call.
Trade-offs accepted: an AI-sourced auto-approval is off by default (more review, less automation); the
taxonomy now carries the output values each target implies so an accepted proposal maps onto the same
columns as a rule action; and "AI suggests a new rule" remains future work.

**Alternatives considered.** A single hard-coded OpenAI call inside the classify step (rejected:
untestable, vendor-locked, leaks data). Letting AI overwrite low-confidence rules (rejected: violates the
deterministic-first product promise). Trusting the model to return a value per output column (rejected:
output shape becomes model-dependent; choosing a taxonomy target and mapping it is auditable). Reusing the
rule engine as the AI output contract (rejected: rules are a different, richer abstraction; a small
purpose-built result schema is easier to validate and evolve).

## ADR-015 — Human review is a first-class, audited state machine over immutable automation records

**Decision.** Automation and human decisions are stored separately and never overwrite each other. A run
still writes immutable `DecisionRecord`s (what automation decided, why and with what confidence). A
`ReviewItem` is the mutable work item a human acts on, and every resolution appends an immutable
`ReviewResolutionLog` row capturing: the action, the previous status, the automation result (source,
confidence, matched rules, values), the suggested values, the human's applied values, exactly which fields
changed, the note, the reviewer and the timestamp. The human-facing **state** is derived, not stored:
`AUTO_RESOLVED` (no review item), `NEEDS_REVIEW` (open), `APPROVED` (accepted), `OVERRIDDEN`, `DISMISSED` and
`ERROR` (an assistive step such as AI failed). Reviewers act on exactly the cases that need attention:
`GET /api/v1/review-items` supports queue presets (`needs_review`, `unresolved`, `conflicts`,
`low_confidence`, `processing_errors`, `overridden`, `resolved`, `all`) plus `runId`/`reason`/`severity`
filtering and returns per-filter counts. Resolving an item also rewrites the generated `output_csv`/`output_xlsx`
so the exported file matches the reviewed decision, and the `__ReviewStatus` column becomes `APPROVED` or
`OVERRIDDEN`; the review-queue artifact is left untouched.

**Why.** The product promise is "automation handles the routine, humans see only the unusual" - which is only
credible if a reviewer can (a) see precisely why a case was flagged, (b) see the deterministic result and any
AI suggestion side by side, and (c) act in seconds without losing the history of what automation proposed.
Overwriting the decision record would destroy that history, so the audit log is append-only and the decision
record stays the immutable automation truth. Deriving the state from the persisted status keeps one vocabulary
shared by the API, the queue and the decision log instead of several drifting enums. Storing the audit trail
(and the `changedFields`) now is deliberate groundwork: a later session can mine human corrections to propose
rule improvements without re-running the pipeline.

**Consequences.** A new `review_resolutions` table (migration `0004`) and repository, plus
`ReviewItemRepository.counts()` and an `ArtifactRepository.update` for regeneration. `ReviewService` owns
resolution (previously in `RunService`); accepting without explicit values records the automation result
explicitly rather than an empty resolution. Regeneration patches output rows by matching the configured
`primaryAccountColumn` with the same normalization the pipeline uses, so it works for configured and legacy
runs that supplied the column; runs without that config keep the resolution but cannot patch the file (logged,
not silently wrong). Reviewers are still unauthenticated (`resolvedBy` is always `null`), and states remain
derived rather than a stored column to avoid a second source of truth.

**Alternatives considered.** Storing the state as a column on `review_items` (rejected: duplicates the status
and can drift). Letting a review resolution mutate the `DecisionRecord` (rejected: destroys the automation
audit trail). Re-running the whole workflow after each resolution (rejected: expensive and could change
unrelated rows; targeted patching is deterministic and cheap). Building a separate "review entries" table for
auto-resolved decisions (rejected as premature: the decision log already lists every account, and the queue
should only surface exceptions).

## ADR-016 - Output generation is a modular, validated, data-preserving export stage

**Decision.** Turning processed results into a deliverable is its own stage, not a side effect of the
workflow. `build-output` copies the primary source row, fills only the configured business columns, adds the
`__`-prefixed system columns and emits rows in the primary file's original order; missing values become true
blanks. `RunService` then streams each table into `FileStorage` (`writeTableToStorage`) instead of buffering
the whole file, and re-reads the stored artifact (`validateStoredTable`) to prove the columns and row count
before the run is marked successful - a mismatch throws `ExportValidationError` and fails the run. Excel
(`.xlsx`) is the primary deliverable and carries a leading `Summary` worksheet of `Metric | Value` rows; CSV
carries the same data sheet. The user-facing summary is derived live by `ExportService`
(`GET /api/v1/runs/:id/export`) by aggregating the immutable decision log and the current review items into
`ExportSummary` (`totalRecords`, `outputRows`, `autoResolved`, `humanApproved`, `overridden`, `dismissed`,
`reviewed`, `unresolved`, `errors`, `unmatched`), so it reflects human decisions made after the run.
Resolving an item rewrites the data sheet's `__ReviewStatus` to `APPROVED`/`OVERRIDDEN` even when the human
changed no values (a value-less accept of a no-events case is final, not `REVIEW_REQUIRED`) while preserving
the `Summary` sheet.

**Why.** The product promise is a completed file a person can open and trust. That requires (a) the source
data to survive untouched apart from the columns the workflow owns, (b) no accidental type corruption
(leading-zero account numbers, long numeric identifiers, dates, blanks), (c) deterministic order so runs are
diffable, and (d) a clear statement of what is final versus still waiting on a human. Streaming the write
avoids holding several full copies of a large output in memory, and validating the written file closes the
loop between "the workflow finished" and "the deliverable is sound" - a corrupt export now fails loudly
instead of shipping.

**Consequences.** `ExportSummary`/`summariseOutputRecords` live in `core` so the workflow's as-run snapshot
and the API's live summary share one vocabulary and cannot drift; the XLSX writer gained an optional
`WriteSummary` leading sheet and the review-resolution rewrite preserves it. Validation re-reads the artifact
(one extra pass; XLSX re-parses the workbook - an accepted cost already documented for XLSX). The summary
sheet is an as-run snapshot while the endpoint is live, so a fully-resolved run's endpoint says `ready` while
the on-disk sheet still shows the original counts until the row is patched. Rows are streamed but the
workflow still loads the source with `readAllRows`; a chunked loader remains future work.

**Alternatives considered.** Buffer-and-concat (`writeTableToBuffer`) for the output file (rejected: holds
the chunk list and the concatenated copy at once). Recomputing the whole export after every review resolution
(rejected: expensive and can disturb unrelated rows; targeted patching plus a live summary is enough).
Storing the summary/status (rejected: two sources of truth; it is a pure function of decisions + items).
Putting the summary only in the UI (rejected: the deliverable should explain itself offline).


## ADR-017 - Every run freezes an immutable snapshot of its configuration and rule set

**Decision.** A run no longer reads its rules from the current active rule set at execution time. When a run
is created, `RunService.createRun` captures a write-once `RunSnapshot` that embeds the full saved
`WorkflowConfiguration` (its mappings and options) and the full active `StoredRuleSet` that were in force at
that moment, plus the workflow version and a `capturedAt` timestamp. The snapshot is stored in its own
`run_snapshots` table (one row per run, `run_id` unique) and is never updated. Execution evaluates the rules
from the snapshot; only legacy runs created before snapshots fall back to the active set. Every run DTO
carries a compact `snapshot` summary (configuration version/name, rule-set version/name, rule count) and
`GET /api/v1/runs/:id/snapshot` returns the full frozen payloads for audit. The end-to-end journey UI renders
this so a user can see exactly which versions produced a report.

**Why.** Configurations and rule sets are edited in place (a save bumps a `version` but replaces the row), so
without a snapshot, editing a mapping or a rule tomorrow would silently change what yesterday's run "would
have" produced - breaking reproducibility and auditability. A run is a historical fact and must be
reconstructible from its own inputs, independent of later edits. Rules are already data and review decisions
are already append-only; freezing the inputs closes the last hole in the audit story.

**Consequences.** One extra write on run creation and one small read per run fetch; the run list/detail DTOs
gain a nullable `snapshot` field (null only for pre-snapshot runs). New runs pick up later edits, so
"changing the rules only affects future runs" is now true by construction, not convention. The Postgres
adapter revives the embedded ISO timestamps when reading the JSON payloads back into the domain schema.
Snapshots are stored in full, so a future "diff this run against current rules" feature is a read away.
`workflow_configurations` and `rule_sets` remain mutable pointers; immutability lives on the run.

**Alternatives considered.** Making configuration/rule-set saves append-only version rows (rejected for now:
a larger migration and it changes ids/references everywhere; the run snapshot already guarantees
reproducibility and can be layered on top later). Storing the snapshot inside `runs.config` (rejected:
unvalidated, untyped, and it conflates the resolved run input with the frozen definitions). Resolving the
rule set at execution time only (rejected: a rule edit between queueing and execution would change the run).

## ADR-018 - A saved workflow is a reusable, re-pointable aggregate; the dashboard is derived

**Decision.** The user-facing unit is a **saved workflow**: a named, versioned `WorkflowConfiguration` built
on a registered workflow template. It remembers the dataset roles, the column mapping (by **column name**),
the active rules and the output/review options, and it can be re-pointed at a new day's files without
re-mapping. "Run again" carries the remembered mapping onto the chosen datasets through the pure
`rebindConfiguration` in `@sheetpilot/core`: a mapping is carried when the new file has a column with the
same name, otherwise it is dropped and reported so only that role needs re-mapping. Saving the re-pointed
mapping bumps the configuration version; running one-off without saving is allowed. `SavedWorkflowService`
derives the dashboard (latest run, status, records processed, review count, export availability) from
configurations + runs + rule sets + the live export status — none of it is stored a second time. A one-off
run freezes the exact (unpersisted) configuration it used through `RunService.createRun`'s
`configurationOverride`, so reproducibility holds whether or not the re-point was saved.

**Why.** The recurring use case ("put today's files somewhere, run the saved workflow, review the unusual
cases") fails if a returning user must re-map columns every day. Remembering the mapping by column name — the
one stable, human-meaningful fact across files — turns a multi-minute setup into attaching two files. Keeping
the aggregate derived avoids a new source of truth that could drift from the runs it describes.

**Consequences.** A daily file whose columns were renamed is reported (`column_not_found`) rather than
silently mis-mapped; the user fixes that role once. Re-pointing resets a mapping's `confirmed` flag so the
new file is re-validated. The dashboard's latest-run view reads recent runs (bounded scan) and the export
service derives status per saved workflow, so it is a read-heavy projection rather than an indexed aggregate
(fine for a single-user workload; revisit at scale). Configurations remain mutable pointers; the immutable
per-run snapshot (ADR-017) is still the audit record.

**Alternatives considered.** A separate `saved_workflows` table duplicating name/mappings/rules (rejected:
two sources of truth for the same setup). Retrieving the mapping by dataset id (rejected: new files have new
ids; it would force re-mapping). Requiring the re-point to be saved before running (rejected: a user may want
a one-off run without changing the saved setup; the run snapshot already makes the run reproducible).

## ADR-019 - Security and reliability controls are layered boundaries, not a security guarantee

**Decision.** Uploaded files, HTTP requests and AI model output are treated as untrusted at explicit
boundaries. Concretely: (1) filenames are reduced to a safe, bounded basename; storage keys are internal UUIDs
and `LocalFileStorage` proves every resolved path stays inside its root; (2) XLSX ZIP archives are inspected
(central directory only, no inflation) against a declared-expansion/entry-count ceiling before ExcelJS buffers
the workbook; (3) a stored object is deleted if ingestion fails after storage, and a retention sweep removes
unreferenced uploads past a TTL while never touching deliverables; (4) the API gains an **optional** shared
API key, a per-IP rate limit, conservative security headers and a configurable body/request limit, and 5xx
error details are logged rather than returned; (5) logs redact credential-shaped fields; (6) runs execute at
most once, interrupted runs are failed on startup, and `POST /runs` supports an in-process `Idempotency-Key`.
The controls are deliberately non-fatal when unconfigured, so local/trusted workflows and tests are unaffected.

**Why.** The product handles uploaded business files, and the previous build's guarantees were partly
conventional (a `..` substring check, "no auth needed because it runs locally"). Boundaries should be provable
and testable. Making the hardening explicit also produces an honest written boundary (see
`docs/security-review.md`) instead of an implicit claim of security.

**Consequences.** The deployment remains a **single trust boundary**: unless `API_KEY` is set the API is
unauthenticated, there is no per-user authorization or tenant isolation, and there is no `resolvedBy` audit
identity. Idempotency and rate-limit state are process-local, so they do not survive a restart or span
instances. The ZIP guard is heuristic and skips ZIP64 size accounting when sizes are unresolvable. Files stay
unencrypted on disk and deletion is manual. These limits are documented, not hidden; the mitigations reduce
accidental exposure and resource exhaustion, they do not make the system "secure" against a determined
attacker.

**Alternatives considered.** Requiring an API key always (rejected: breaks local development and the existing
smoke/test workflow for no real gain in a trusted environment). Adding `@fastify/rate-limit`/`@fastify/helmet`
(rejected for now: a small in-process implementation avoids new runtime dependencies in the externalized API
bundle; can be swapped later). A full AV/malware scanner (rejected: out of scope for this build; documented as
an open risk). Durable idempotency in Postgres (deferred: belongs with a real job queue).
