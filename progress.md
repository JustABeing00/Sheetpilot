# SheetPilot — Project Progress

> **How to use this file.** This is the canonical handoff between coding sessions. Read §16 before touching
> code, then §15 for the exact work that should happen next. **Update this file at the end of every session**
> and keep the section structure intact. Never claim something is complete unless it exists, runs, and was
> verified (state the verification command in §9/§13). Never write secrets here.

**Last updated:** 2026-09-16 (product session 5 — AI-assisted classification layer)
**Repository:** local working copy at `D:\ExcelProjectBydeepseek` (git initialized)
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

**Product session 5 objective: the AI-assisted classification layer.** AI is now an optional,
policy-gated **assistant** behind a provider-neutral port, not a decision-maker. `@sheetpilot/ai` owns the
provider contract (`ClassificationProvider`), a strict structured result contract, an
`AiClassificationService` (policy gate → redaction → timeout → bounded retries → strict schema validation →
normalized failure), a deterministic-first merge (`resolveAssistedDecision`), and an OpenAI-compatible
adapter whose `fetch`/base URL/model are all injectable. Providers receive only a bounded, structured
request (entity key, latest event, capped history, classification targets, evaluated rule summaries) and
must return a validated JSON object (`proposedCode`, `reasoning`, `confidence`, `ambiguity[]`,
`missingInformation[]`). **AI can never override a matched rule**: it may corroborate a weak rule or supply
values only when no rule matched, is recorded as `decisionSource: ai_suggested`, and is routed to review
unless auto-approval is explicitly enabled. Failures (timeout, rate limit, invalid credentials, malformed,
unexpected class) become review reasons, never a failed run. Provenance is persisted in the decision log
and a new `__DecisionSource` output column. **Status: achieved** (see §8, verified in §9).

**Next (product session 6):** the human review loop. See §15: the AI layer now produces suggestions and
provenance, so the review queue should surface them richly (deterministic vs AI-suggested vs overridden),
support fast filtering/bulk actions and preserve a full audit trail of what automation decided, why, and
what the human changed. Durability (Postgres verification, review→artifact regeneration) remains open.

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
| File processing | `csv-parse` / `csv-stringify` (streaming), `exceljs` (buffered) | Behind `TabularReader`/`TabularWriter` async generator interfaces; readers also expose `describe()` for sheets+headers |
| Dataset inspection | `inspectDataset` in `@sheetpilot/file-processing` | Bounded one-pass scan → `DatasetProfile` (types, emptiness, uniqueness, samples, warnings); persisted via `DatasetRepository` |
| Workflow configuration | `@sheetpilot/core` domain + `WorkflowConfigurationService` (API) | Roles-as-data (`WorkflowConfigurationDefinition`), pure validation, persisted/versioned `WorkflowConfiguration`, workflow-specific `resolveRunInput` |
| Record matching | `@sheetpilot/matching-engine` (new) | Generic primary↔event join: reported identifier normalization, deterministic latest-event selection, full event history, join statistics; consumed by the account-faults workflow |
| Storage | `LocalFileStorage` (disk) and `InMemoryFileStorage` behind the `FileStorage` port | S3 later |
| Rules | Custom DSL in `@sheetpilot/rule-engine` | Data-only rules (zod-validated); priority → specificity → id winner selection; `latest`/`any_event`/`all_events` condition scopes; decision metadata (resulting values, conditions evaluated, conflicts, no-match/low-confidence review flags); explanation templates |
| Rule management | `RuleSetService` + `/api/v1/rule-sets` + Rules UI page | Validated before save (`validateRuleSet`), versioned on every save, one active set per workflow, resolved per run |
| AI | `@sheetpilot/ai` — provider port + orchestration | `ClassificationProvider` port; `AiClassificationService` (policy gate, redaction, timeout, bounded retries, strict zod validation, normalized outcomes); `resolveAssistedDecision` (deterministic-first merge); `OpenAiClassificationProvider` (configurable base URL/model, injectable `fetch`); `NoopClassificationProvider` is the safe default (sends nothing) |
| AI safety | Policy, redaction and provenance | Only consulted per `AiPolicy`; never overrides a matched rule; a bounded structured request (no raw rows); `AI_EXCLUDED_FIELDS` redaction; failures become review reasons (`ai_failed`/`ai_low_confidence`/`ai_ambiguous`/`ai_proposed_alternative`); `decisionSource` + full AI outcome persisted and exposed via DTOs; `__DecisionSource` output column |
| Tests | Vitest 5 (unit + integration + API E2E via `app.inject`) | 209 tests, 21 files, all green |
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
                              step traces, role/mapping              storage drivers)
                              definitions + resolveRunInput)
                                          │                                   │
                                          ├──▶ matching-engine (primary↔event join,
                                          │      identifier normalization, latest event)
                                          ├──▶ rule-engine (deterministic rules, explanations)
                                          ├──▶ ai (policy gate + ClassificationProvider port +
                                          │      AiClassificationService + deterministic-first resolve)
                                          ▼
                                  core (domain, schemas, ports)  ◀── db (Drizzle schema + repos)
```

Dependency rule: inner layers never import outer layers; `web` only consumes `core` DTO schemas.
`matching-engine` depends only on `file-processing` (reusing its canonical identifier/timestamp helpers);
`workflow-engine` depends on it. Ingestion lifecycle: `POST /api/v1/datasets` (or `/files`) →
`DatasetService.ingest` validates the upload, stores it, runs bounded `inspectDataset`, persists
`FileAsset` + `DatasetProfile` → the UI reads the profile and pages rows via
`GET /api/v1/datasets/:id/rows`.
Configuration lifecycle: a workflow declares dataset roles + semantic column roles → the Setup UI assigns
datasets and maps columns against `DatasetProfile.columns` → `POST /api/v1/workflow-configurations/validate`
returns structural/semantic issues (from `validateWorkflowConfiguration` in `core`) plus a resolved-config
preview → saving persists a versioned `WorkflowConfiguration` →
`POST /api/v1/runs { configurationId }` resolves it through `RegisteredWorkflow.resolveRunInput` into file
ids + config keys.
Run lifecycle: `POST /files` → `POST /runs` (202, queued) → background `RunService.execute` →
step traces + artifacts + decision log + review items → run `succeeded`.
Matching lifecycle: the workflow's load steps produce raw primary/event records → the `group-events` step
calls `matchRecords` (`@sheetpilot/matching-engine`), which normalizes identifiers, joins events to
entities, orders each entity's complete event history latest-first and returns the entities plus join
statistics → classification consumes the grouped representation.
Rule lifecycle: rules are stored as versioned data in `rule_sets` (seeded from the workflow's in-code
default) → the Rules UI/SDK validates a candidate set (`validateRuleSet`) and saves it via
`POST/PUT /api/v1/rule-sets`, which bumps the version and makes it the single active set for the workflow →
`RunService` loads the active set and passes it into the run → `evaluateRules` returns a full
`RuleEvaluation` (winner, conditions evaluated, resulting values, conflicts, no-match/low-confidence review
flags) that the workflow persists as decision evidence.
AI lifecycle: the `classify` step builds a bounded `AiClassificationRequest` (entity key, latest event,
capped history, classification targets + implied values, evaluated rule summaries; never the raw row) →
`AiClassificationService.assist` applies the policy gate, redacts excluded fields, calls the provider with a
timeout and bounded retries, strictly validates the result and normalizes every failure into an
`AiAssistOutcome` → `resolveAssistedDecision` merges it with the deterministic result without ever replacing
a matched rule → the resolved source/values/confidence plus the full AI provenance are persisted in the
decision record (`decisionSource`, `aiAssisted`, evidence `ai.outcome`) and surfaced through decision/review
DTOs and the `__DecisionSource` output column.

## 6. Repository Structure

```
apps/
  api/src/
    index.ts               bootstrap (env → container → server → graceful shutdown)
    container.ts           composition root; seeds workflow + rule set into the repositories
    server.ts              Fastify factory, CORS, multipart, error mapping, 404 handler
    logger.ts              pino logger
    services/file-service.ts   thin compatibility wrapper (delegates upload to DatasetService)
    services/dataset-service.ts  validate → store → inspect → persist; paged row reads
    services/workflow-configuration-service.ts  validate + persist configurations; resolve runs from a configuration
    services/rule-set-service.ts  validate + version + activate rule sets; one active set per workflow
    services/run-service.ts    run creation/execution, step persistence, artifacts, review resolution; injects the active rule set
    http/dto.ts            entity → DTO serializers
    http/http-utils.ts     zod parse helper, limit/offset, multipart field extraction
    http/routes/*.ts       health, meta, workflows, workflow-configurations, rule-sets, files, datasets, runs, review-items, artifacts
    fixtures.ts            reads the sample CSVs for tests
    server.test.ts         API integration + E2E test (upload → run → artifacts → review resolve)
  web/src/
    api/client.ts          typed fetch, zod response parsing, ApiError
    api/hooks.ts           TanStack Query hooks for every endpoint
    app/router.tsx         routes: /, /runs, /runs/new, /runs/:id, /review, /workflows, /workflows/:slug, /datasets, /datasets/:id, /setup, /setup/:configurationId
    components/AppShell.tsx        sidebar shell, API status, open-review counter
    components/ui.tsx              Card, Badge, StatCard, EmptyState, LoadingState, ErrorState, Field, KeyValue
    components/ReviewItemCard.tsx  evidence view + accept/override/dismiss controls
    pages/*.tsx            Dashboard, Datasets, DatasetDetail, Setup, Runs, RunDetail, NewRun, Workflows, WorkflowDetail, ReviewQueue, Rules, NotFound
    lib/format.ts, lib/rules.ts, lib/status.ts, lib/datasets.ts, lib/configurations.ts   formatting, condition descriptions, badge tones, dataset column/flag helpers, mapping suggestions
    styles/app.css         design tokens + component styles (light professional theme)
packages/
  core/src/
    domain/enums.ts        RunStatus, ReviewReason, AiPolicy, file/artifact formats …
    domain/entities.ts     Workflow, FileAsset, WorkflowRun, StepRun, DecisionRecord, ReviewItem, Artifact…
    domain/dataset.ts      DatasetProfile/Analysis/Column/Warning schemas, DatasetSummary
    domain/workflow-config.ts  dataset/column role definitions, WorkflowConfiguration, validateWorkflowConfiguration
    domain/rules.ts        Rule, ConditionGroup, RuleAction (with condition scope), RuleSet, RuleEvaluation
                           (decision status, resulting values, evaluated conditions, conflicts, review reasons), validation issues
    domain/ai.ts           AI decision contract: consult reasons, decision source, ambiguity flags, failure
                           kinds, structured request/result/outcome schemas, target + event + rule summaries
    api/contracts.ts       HTTP request/response schemas shared with the web app
    ports/                 repositories, datasets, workflow-configurations, file-storage, classification, logger, clock
    errors.ts              AppError hierarchy + zod error formatting + public error body
  config/src/schema.ts     zod env schema, .env discovery, fail-fast validation
  file-processing/src/
    table.ts, normalize.ts (keys, timestamps, Excel serials), inference.ts (column type detection)
    inspection.ts          bounded one-pass dataset analysis (types, emptiness, uniqueness, samples, warnings)
    upload.ts              untrusted-filename sanitisation + extension/mime/size/magic validation
    readers/               csv (streaming), xlsx (buffered), shared TabularReader with describe()/sheets
    writers/               csv, xlsx, buffer collection
    storage/               local-file-storage (traversal-safe), memory-file-storage
    registry.ts            format detection + reader/writer factories
  matching-engine/src/
    types.ts               public contract: normalized identifiers, MatchedPrimary/Event/Entity, MatchStats, MatchResult
    normalize.ts           normalizeIdentifier (trim/collapse/case + opt-in dangerous steps) and renderCellText
    match.ts               matchRecords (join + grouping + deterministic latest), compareEventsLatestFirst
    scripts/benchmark.mts  synthetic benchmark (10k–250k entities) for performance observations
  rule-engine/src/         conditions.ts (scope-aware evaluation + condition trace), evaluate.ts (deterministic
                           winner + decision metadata + conflicts), actions.ts, template.ts, validate.ts (semantic validation)
  ai/src/                  types (core), errors.ts (AiProviderError), parse.ts (strict JSON/schema),
                           redact.ts (field/entity-handle redaction), resilience.ts (timeout/backoff),
                           service.ts (AiClassificationService), resolve.ts (deterministic-first merge),
                           noop-provider.ts, openai-provider.ts, policy.ts, factory.ts
  workflow-engine/src/
    engine.ts              executeWorkflow (ordered steps, state merge, traces, cancel handling)
    registry.ts            WorkflowRegistry, RegisteredWorkflow (configuration definition + resolveRunInput), createDefaultWorkflowRegistry
    workflows/account-faults/  types.ts (config/state/columns), configuration.ts (roles, resolveRunInput, preview),
                               rules.ts (taxonomy + 7 rules), steps.ts (5 steps; group-events delegates to matching-engine),
                               workflow.ts (program + registered workflow)
  db/src/
    schema/tables.ts       workflows, rule_sets, files, datasets, workflow_configurations, runs, run_steps, run_decisions, review_items, artifacts
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
| `DatasetProfile` | Normalized structural view of an uploaded file (the pre-mapping representation) | sheetNames/sheetName, rowCount (+exact/truncated), scanLimit, columns[] (type, empty/unique counts, samples, duplicate/date/identifier flags), sampleRows, warnings, fileId |
| `WorkflowConfigurationDefinition` | What a workflow needs mapped (declared as data) | datasetRoles[] (key, label, required, multiple), columnRoles[] (key, datasetRole, semantic, required, multiple, configKey), options[] |
| `WorkflowConfiguration` | A saved, versioned setup: which datasets play which roles and which real columns fill semantic roles | workflowSlug/version, name, version, assignments[] (role→datasetId), mappings[] (role→datasetId→column, confirmed), options |
| `WorkflowRun` | One execution of a workflow | status, workflowSlug/version, file ids, configurationId, config, stats, error, timestamps |
| `StepRun` | One pipeline step of a run | stepId, order, status, durationMs, metrics, error |
| `DecisionRecord` | Per-entity explainability record | entityKey, matchedRuleIds, aiAssisted, decisionSource (`deterministic`/`ai_suggested`/`none`), confidence, reviewReasons, outputValues, evidence (rule trace + AI outcome/provenance) |
| `ReviewItem` | A case for human review | entityKey, reason, severity, status, title, detail, suggestedValues, evidence, resolution |
| `Artifact` | Generated output file | kind (output_csv/output_xlsx/review_queue_csv), format, fileName, storageKey, sizeBytes |
| `RuleSet` / `Rule` | Versioned business rules | priority, when (all/any condition tree), then (set/set_if_empty), confidence, explanationTemplate |
| `MatchedEntity<TPrimary, TEvent>` | In-memory (not persisted) result of the matching engine: one entity with its complete, latest-first event history | key, rawKeys[], primaries[], events[], latest, issues[], counts |

Important enums: `RunStatus = queued|running|succeeded|failed|canceled`;
`ReviewReason = no_events|no_rule_match|rule_conflict|low_confidence|ambiguous_latest_timestamp|conflicting_fault_history|unparsed_timestamp|duplicate_primary_key|ai_low_confidence|ai_ambiguous|ai_proposed_alternative|ai_failed`;
`AiPolicy = never|on_no_rule_match|on_low_confidence|always`;
`DecisionSource = deterministic|ai_suggested|none`;
`AiFailureKind = timeout|rate_limited|invalid_credentials|unavailable|provider_error|malformed_response|unexpected_classification`;
`MatchIssueCode = no_events|duplicate_primary|ambiguous_latest_timestamp|unparsed_timestamp|no_valid_timestamp|identifier_transformed`.

Account-fault-triage specifics: 4 business columns (`RootCause`, `FaultCategory`, `RecommendedAction`,
`Priority`), optional `__`-prefixed system columns (fault count, latest fault time, matched rules,
decision source, confidence, review status, review reasons, explanation), 7 default rules over a 7-option
taxonomy (each taxonomy target carries the output values it implies so an accepted AI proposal maps onto
the same columns as a rule action).

## 8. Completed

### Product session 5 — AI-assisted classification layer (2026-09-16)

- [x] `@sheetpilot/core`:
  - new `domain/ai.ts` — the provider-neutral AI contract: `AiConsultReason`, `DecisionSource`,
    `AiAmbiguityFlag`, `AiFailureKind`, `AiEventSummary`, `AiRuleSummary`, `AiClassificationTarget`
    (taxonomy option + implied output `values`), structured `AiClassificationRequest` (entity key, latest
    event, bounded history, targets, evaluated rule summaries, hints, redacted fields), strictly validated
    `AiClassificationResult` (`proposedCode`, `proposedLabel`, `confidence`, `reasoning`, `ambiguity`,
    `missingInformation`) and the non-throwing `AiAssistOutcome` union
    (`not_consulted`/`disabled`/`skipped`/`no_suggestion`/`suggested`/`failed`), plus display labels.
  - `ports/classification.ts` rewritten to the real provider port (`id`, `displayName`, `model`,
    `isAvailable`, `classify(request, signal)`), replacing the ad-hoc `text`/`suggestions` shape.
  - `decisionRecordSchema` gained `decisionSource`; `decisionSourceSchema` added to enums; four AI review
    reasons added (`ai_low_confidence`, `ai_ambiguous`, `ai_proposed_alternative`, `ai_failed`); review and
    decision DTOs now expose `ai` (the validated outcome) and `decisionSource`.
- [x] `@sheetpilot/ai` rewritten into a real layer:
  - `errors.ts` (`AiProviderError` with `kind`/`retryable`; `toAiProviderError`), `parse.ts` (balanced-JSON
    extraction + strict zod validation, unknown keys stripped, out-of-range confidence rejected),
    `redact.ts` (`excludedFields`, `redactEntityKey`, `latestEventOnly`), `resilience.ts`
    (`withTimeout`, `sleep`).
  - `service.ts` — `AiClassificationService.assist()`: policy gate (`decideAiUsage`), redaction, provider
    call with a hard timeout and bounded retries (retryable only: timeout/rate-limit/5xx/network), strict
    validation, unknown-code detection (`unexpected_classification`) and normalized `failed` outcomes.
    **It never throws into the pipeline** (only rethrows on run cancellation).
  - `resolve.ts` — `resolveAssistedDecision`: the single deterministic-first merge. Confident rule → kept,
    AI may only raise `ai_proposed_alternative`; weak rule → kept, AI can corroborate (raise confidence when
    `aiAutoApprove`); no rule → AI may supply values (`ai_suggested`) but is routed to review unless
    `aiAutoApprove` and confident and unambiguous.
  - `openai-provider.ts` — OpenAI-compatible adapter with configurable base URL/model, injectable `fetch`,
    JSON-object response format, a prompt-injection-aware system prompt and HTTP/network → `AiFailureKind`
    mapping (401/403 credentials, 429 rate limit, 408 timeout, 5xx provider error, bad body malformed).
  - `noop-provider.ts` reports `isAvailable() === false` (nothing is ever sent); `factory.ts` builds the
    configured provider and requires `OPENAI_API_KEY`+`AI_MODEL` for `openai`; `policy.ts` reason type now
    aliases the core `AiConsultReason`.
- [x] `@sheetpilot/workflow-engine`: the account-faults taxonomy now carries the output values each target
  implies; `classify` builds the bounded request (descriptions/timestamps only, **never the raw row**),
  calls the AI service, merges via `resolveAssistedDecision`, merges AI review reasons, records
  `decisionSource` + the full AI block (outcome, provider, model, agreement, applied, redacted fields) in
  decision evidence, and writes the `__DecisionSource` output column. Config gained `aiMinConfidence`
  (default 0.85) and `aiAutoApprove` (default **false**). The default (noop) path is byte-for-byte
  unchanged.
- [x] `@sheetpilot/config`: `AI_BASE_URL`, `AI_TIMEOUT_MS` (15000), `AI_MAX_ATTEMPTS` (2),
  `AI_EXCLUDED_FIELDS`; `AppConfig.ai` exposes them and the container threads them into the provider
  factory and the workflow's AI options.
- [x] `@sheetpilot/db`: `run_decisions.decision_source` column (default `deterministic`), Postgres/memory
  mapping, generated migration `0003_eager_dagger.sql`.
- [x] `apps/api`: decision/review DTOs expose `decisionSource` and the validated AI outcome;
  `createContainer` accepts a classifier override (used by tests).
- [x] `apps/web`: the review card renders the AI proposal, reasoning, confidence, ambiguity flags, missing
  information and failure reasons; the run decision log shows the decision source.
- [x] Tests: +30 (209 total, 21 files) — `packages/ai/src/ai.test.ts` rewritten (31 tests: policy, factory,
  JSON/schema parsing, redaction, resolution across all branches, service policy/disabled/skip/retry/
  exhaustion/malformed/timeout, OpenAI adapter with a mocked `fetch`), `account-faults.test.ts` +5 (AI
  auto-approval, never-override, low-confidence review, provider failure, data minimisation) and new
  `apps/api/src/ai-classification.test.ts` (an injected mock provider end to end through the HTTP API).
- [x] `scripts/smoke.mjs` now also asserts deterministic vs not-consulted vs disabled AI provenance and the
  `__DecisionSource` column.
- [x] Docs: ADR-014, `docs/architecture.md` (AI lifecycle + abstractions), README, `.env.example`, this file.

### Product session 4 — Rule engine & rule management (2026-09-16)

- [x] `@sheetpilot/core` (`domain/rules.ts`): conditions gained a **`scope`** (`latest` default, `any_event`,
      `all_events`) with UX labels; `RuleEvaluation` became a first-class decision contract carrying
      `winnerPriority`, `status` (`matched`/`no_match`), `needsReview`, `reviewReasons`
      (`no_rule_match`/`rule_conflict`/`low_confidence`), `resultingValues`, the flattened `conditions`
      trace (`expected`, `actual`, `matched`), `matchedRules` summaries and typed `conflicts` (with values).
      Added `EvaluatedCondition`, `RuleMatchSummary`, `RuleConflict`, `RuleValidationIssue` schemas.
- [x] `@sheetpilot/rule-engine`:
  - `conditions.ts` — `evaluateConditionDetail` / `evaluateConditionsDetailed` honour the condition scope
    (history scopes read the field from every entry of `context.events`; `any_event` = some, `all_events` =
    non-empty and every) and return an ordered trace of every leaf inspected. `evaluateCondition(s)` stay as
    boolean wrappers; `findMatchedTerm` unchanged.
  - `evaluate.ts` — `evaluateRules(rules, context, options)` returns the winner (priority ↓, specificity ↓,
    id ↑) plus the full metadata above. `minConfidence` drives `low_confidence`; `reviewOnNoMatch` /
    `reviewOnConflict` (default true) drive the review flags. Conflicts are same-priority disagreement (the
    intended fallback hierarchy is not a conflict) and the winner is still reported deterministically.
  - `validate.ts` — errors for missing/empty values, empty lists, invalid regex and conflicting actions
    inside one rule; warnings for empty search text, non-numeric comparisons, shared priorities, duplicate
    condition signatures that can never win, and missing explanation templates.
- [x] `@sheetpilot/workflow-engine`: the account-faults `buildRuleContext` now also passes the **full event
      history** (`events`) so history-scoped rules work; `createState` accepts an optional per-run `ruleSet`;
      `classify` calls the engine with `minConfidence` and records the whole `RuleEvaluation` (rule status,
      needs review, evaluated conditions, matched rules, resulting values) into decision evidence. The
      default in-code rule set is unchanged, so the canonical sample results are identical.
- [x] `@sheetpilot/db`: `RuleSetRepository.listByWorkflowSlug` added to the port and both adapters;
      `storedRuleSetSchema` unchanged (no schema migration needed).
- [x] `apps/api`: new `RuleSetService` (list/get/validate/create/update with versioning and single-active
      enforcement), routes `GET/POST /api/v1/rule-sets`, `POST /api/v1/rule-sets/validate`,
      `GET/PUT /api/v1/rule-sets/:id`, DTO mappers, container wiring, and `InvalidRuleSetError` (422
      `invalid_rule_set`). `RunService.execute` now loads the active persisted rule set and injects it into
      the run input, so rule edits apply to the next run.
- [x] `apps/web`: new **Rules** page — workflow + rule-set picker, per-rule editor (name, priority,
      confidence, enabled, recursive all/any condition builder with scope/operator/value/case-sensitivity,
      output-action builder, explanation template, tags), inline validation issues, "Save new version" and
      "Save as a new rule set"; router + nav entries; `lib/rules.ts` operator/scope labels; CSS.
- [x] Tests: +16 (179 total, 20 files) — `packages/rule-engine/src/rule-engine.test.ts` rewritten (21 tests:
      history scopes, decision metadata, resulting values, no-match/conflict/low-confidence, semantic
      validation), `account-faults.test.ts` +2 (per-run rule set with `any_event` scope; no-match evidence),
      and `apps/api/src/rule-set.test.ts` (7 API tests: list/validate/invalid-save/create-deactivate/update
      version/run-uses-active-set/404).
- [x] `scripts/smoke.mjs` now also lists, validates (valid + invalid), and saves a rule set end to end.
- [x] Docs: ADR-013, `docs/architecture.md` (rule management & evaluation lifecycle, abstractions), README,
      this file.

### Product session 3 — Matching, grouping & latest-event engine (2026-09-16)

- [x] New package **`@sheetpilot/matching-engine`** (depends only on `@sheetpilot/file-processing` for the
      canonical identifier/timestamp helpers):
  - `types.ts` — the generic public contract: `IdentifierNormalizationOptions`,
    `NormalizedIdentifier`, `IdentifierTransformation`, `MatchRecordsInput/Options`,
    `MatchedPrimary`/`MatchedEvent`/`MatchedEntity`, `MatchStats`, `MatchResult` and
    `MATCH_ISSUE_CODES`.
  - `normalize.ts` — `normalizeIdentifier(value, options)` derives a comparison key from any cell-like
    value. **Pipeline (documented + reported):** non-breaking space → trim → collapse whitespace →
    (opt-in) strip separators → (opt-in) strip leading zeros → upper case. Default options reproduce
    `normalizeKey` from `file-processing` exactly. Every step that actually changed the value is returned
    as a transformation code; the two steps that can merge genuinely distinct identifiers
    (`strip-separators`, `strip-leading-zeros`) are **off by default and flagged `dangerous`**, and an
    entity touched by one gets the `identifier_transformed` issue. Numbers, booleans and dates are never
    text-mangled (`coerce-number` is reported for numbers).
  - `match.ts` — `matchRecords(input, options)`:
    - **Data structures:** one `Map<normalizedKey, MutableEntity>` for O(1) lookup, an ordered
      `entities[]` for first-seen deterministic order, a `Set` per entity for distinct `rawKeys`, and an
      `orphans[]` list. No input array is mutated.
    - **Algorithm:** (1) normalize + index every primary key, merging duplicates into one entity; (2)
      normalize every event key, parse its timestamp, attach it to its entity or to `orphans`; (3) per
      entity, order the complete history with `compareEventsLatestFirst` and derive issues/counts; (4)
      compute the aggregate `MatchStats`.
    - **Deterministic latest selection** (`compareEventsLatestFirst`): valid timestamps descending; a
      valid timestamp always beats an unparseable/missing one; all ties (including equal timestamps and
      all-invalid/all-missing histories) break on **higher source row first** (later row wins), so the
      result never depends on array or map iteration order.
    - **Edge-case semantics:** missing timestamps → status `missing`, cannot beat a real date; equal
      latest timestamps → `ambiguous_latest_timestamp` (later row still chosen deterministically);
      unparseable timestamps → `unparsed_timestamp`; an entity with no valid timestamp at all →
      `no_valid_timestamp` and the latest is chosen by source order; duplicate primary rows →
      `duplicate_primary` (critical) while keeping every row; blank identifiers are skipped and counted,
      never silently matched.
    - **Statistics:** `primaryRecords`, `eventRecords`, `primaryRecordsWithoutKey`,
      `eventRecordsWithoutKey`, `eventsWithKey`, `entities`, `matchedEntities`, `unmatchedEntities`,
      `duplicatePrimaryEntities`, `entitiesWithOneEvent`, `entitiesWithMultipleEvents`,
      `orphanEventRecords`, `orphanEventEntities`, `malformedTimestamps`, `missingTimestamps`,
      `ambiguousLatestEntities`, `identifierTransformedEntities`.
    - **Complexity:** O(P + E + Σ eᵢ log eᵢ) time and O(P + E) memory (P primaries, E events, eᵢ events per
      entity); the join itself is a single linear pass.
- [x] `@sheetpilot/workflow-engine`: the account-faults `load-primary`/`load-events` steps now normalize
      through `normalizeIdentifier`, and `group-events` delegates the entire join/latest/statistics work to
      `matchRecords`, mapping the generic result back to `AccountGroup` (unchanged downstream behaviour; the
      classify/build-output steps are untouched).
- [x] Tests: +35 (163 total, 19 files) — `packages/matching-engine/src/normalize.test.ts` (15) and
      `match.test.ts` (20, including a 2,000-entity × 5-event dataset).
- [x] Benchmark: `packages/matching-engine/scripts/benchmark.mts` (synthetic). Measured on this machine
      (Windows, Node 24): 30k events **163 ms** (184k events/s), 150k events **461 ms** (325k events/s),
      500k events **1.2 s** (407k events/s), 1,000k events **2.7 s** (368k events/s) — linear, no
      orphan/matching anomalies.
- [x] Docs: ADR-012, `docs/architecture.md`, README, this file.

### Product session 2 — Column mapping & workflow configuration (2026-09-16)

- [x] `@sheetpilot/core`: new `domain/workflow-config.ts` — `DatasetRoleDefinition`,
      `ColumnRoleDefinition`, `WorkflowConfigurationDefinition`, `ColumnMapping`, `DatasetAssignment`,
      `WorkflowConfiguration(+Summary)`, `configurationIssue*` schemas, and the pure
      `validateWorkflowConfiguration` (structural + semantic checks: missing roles/columns, unknown
      datasets/columns, empty columns, incompatible identifiers, unparseable timestamps, duplicate
      assignments, ambiguous mappings, required/invalid options). `looksLikeTimestamp` mirrors the
      accepted timestamp shapes for compatibility checks. New `WorkflowConfigurationRepository` port
      (added to `Repositories`), new `InvalidConfigurationError` (422 `invalid_configuration`),
      `WorkflowRun.configurationId`, and new API contracts (`workflowConfigurationDtoSchema`,
      create/update/validate request schemas, validation response with `resolvedConfig` preview);
      `workflowDetailDtoSchema` now carries the workflow's `configuration` definition.
- [x] `@sheetpilot/workflow-engine`: `RegisteredWorkflow` gained `configuration` and optional
      `resolveRunInput`; the account-faults workflow declares its roles/options in
      `workflows/account-faults/configuration.ts` and resolves a saved configuration into
      `{ primaryFileId, eventsFileId, config }` (mapping semantic roles to `primaryAccountColumn`,
      `eventsAccountColumn`, `eventsTimestampColumn`, `eventsDescriptionColumn`, `primaryOutputColumns`).
      The build-output step honours a mapped output-column selection (empty = all primary columns).
- [x] `@sheetpilot/db`: new `workflow_configurations` table (11 columns, indexed by workflow slug) plus
      `runs.configuration_id`; generated migration `drizzle/0002_slow_colonel_america.sql`; in-memory and
      Postgres workflow-configuration repositories.
- [x] `apps/api`: `WorkflowConfigurationService` (create/update with re-validation and version bumps,
      list/get, validate with resolved-config preview, `buildRunInput`), routes
      `GET/POST /api/v1/workflow-configurations`, `POST /api/v1/workflow-configurations/validate`,
      `GET/PUT /api/v1/workflow-configurations/:id`; `POST /api/v1/runs` now accepts `configurationId`;
      DTO mappers + container wiring.
- [x] `apps/web`: new **Setup** page (workflow picker → assign datasets to roles → map columns with
      detected-column pickers, type/flag hints and sample values → options → live debounced validation
      with confirmable warnings and a resolved-config preview → save → continue to processing); router +
      nav entries; `lib/configurations.ts` suggestion/tone helpers; CSS.
- [x] Tests: +16 (128 total, 17 files) — `packages/core/src/domain/workflow-config.test.ts` (10) and
      `apps/api/src/workflow-configuration.test.ts` (6 API tests, including create/list/version and a run
      started from a configuration).
- [x] Docs: ADR-011, `docs/architecture.md` (configuration lifecycle + abstractions), `scripts/smoke.mjs`
      (now validates, saves and runs an account-faults configuration end to end), this file.

### Product session 1 — File ingestion & dataset inspection (2026-09-16)

- [x] `@sheetpilot/core`: `DatasetProfile`/`DatasetAnalysis`/`DatasetColumn`/`DatasetWarning` zod schemas
      (new `domain/dataset.ts`), `DatasetRepository` port (new `ports/datasets.ts`, added to `Repositories`),
      dataset HTTP DTOs (`datasetDtoSchema`, `datasetSummaryDtoSchema`, `datasetRowsResponseSchema`,
      `datasetAnalysisResponseSchema`, `datasetListResponseSchema`), and new error types
      `InvalidFileError` (400), `CorruptFileError` (422), `EmptyDatasetError` (422), `OversizedFileError` (413).
- [x] `@sheetpilot/file-processing`: `TabularReader` gained `describe()` (sheet names + raw headers in
      source order, duplicates preserved) implemented for CSV and XLSX; new `inspection.ts` performs a
      single bounded streaming pass and derives inferred column types (`string|number|boolean|date|empty|mixed`),
      empty/unique counts and ratios, sample values, sample rows, duplicate-column detection, likely
      date/time and identifier flags, and validation warnings; new `upload.ts` sanitises untrusted
      filenames, allowlists extensions/content types, enforces the size limit and checks magic bytes
      (PK zip for XLSX, NUL-free for delimited text).
- [x] `@sheetpilot/db`: new `datasets` table (18 columns, indexed by `file_id`) with generated migration
      `drizzle/0001_pretty_dorian_gray.sql`; full in-memory and Postgres dataset repositories.
- [x] `apps/api`: `DatasetService` (validate → store → inspect → persist; `analyze` and paged `readRows`),
      new routes `POST/GET /api/v1/datasets`, `GET /api/v1/datasets/:id`, `GET /api/v1/datasets/:id/analysis`,
      `GET /api/v1/datasets/:id/rows`, dataset DTO mappers, container wiring; `POST /api/v1/files` now
      delegates to `DatasetService` (same response shape); multipart size-limit errors map to a clean
      413 `payload_too_large` body.
- [x] `apps/web`: new **Datasets** page (upload + ingested list) and **Dataset detail** page (original
      filename vs internal dataset id, stat cards, warnings, sheet selector, column analysis table,
      paginated row preview); nav + router entries; `lib/datasets.ts` helpers; CSS.
- [x] Tests: +26 (112 total, 15 files) — `packages/file-processing/src/inspection.test.ts` (9),
      `packages/file-processing/src/upload.test.ts` (11), `apps/api/src/dataset.test.ts` (6 API tests).
- [x] Docs: ADR-010, `docs/architecture.md` (ingestion lifecycle, new abstractions/extensions),
      `.env.example`, README, this file.
- [x] Environment repair: the workspace `node_modules/@sheetpilot/*` links pointed at the previous repo
      path (the project folder was moved); `npm install` relinked them so typecheck/tests/build resolve
      the current source.

### Foundation (2026-09-15)

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
| Types | `npm run typecheck` | clean across all 10 workspaces |
| Lint | `npm run lint` | clean |
| Tests | `npm test` | 21 files / 209 tests passed |
| Build | `npm run build` | API bundle (`apps/api/dist/index.js`) + web assets (`apps/web/dist`) |
| Production smoke | start `node apps/api/dist/index.js` then `npm run smoke` | run succeeded, 3 artifacts, 7 review items, 9 decision records, review resolution OK; deterministic vs not-consulted vs disabled AI provenance asserted; then datasets validated → configuration saved → configured run succeeded (9 accounts, 7 review items); `__DecisionSource` present in the output CSV |
| Matching engine | `npm run benchmark -w @sheetpilot/matching-engine` | 1,000,000 events joined + grouped + latest-selected in 2.7 s (368k events/s); unit suite covers normalization, one-to-many, orphans, duplicates, ties, missing/invalid timestamps |
| Dev servers | `npm run dev` (or the two dev scripts) | API on 4000, Vite on 5173, `/api` proxy verified with `curl`/`Invoke-WebRequest` |
| Datasets (API) | `npm run dev:api` then `POST /api/v1/datasets` (multipart) + `GET .../rows` | CSV inspected (10 rows, typed columns, warnings), rows paged with `limit`/`offset` |
| Configurations (API) | `POST /api/v1/workflow-configurations/validate`, create, then `POST /api/v1/runs { configurationId }` | validation returns issues + resolved config; saved config version bumps; configured run succeeds and records `configurationId` |
| Rule management (API) | start the API, then `GET /api/v1/rule-sets`, `POST .../validate` (valid + invalid regex), `POST /api/v1/rule-sets`, run and read `/runs/:id/decisions` | seeded active set listed (7 rules); invalid regex fails validation; save bumps version and deactivates the previous set; a run resolves the active set and applies it |
| AI layer (unit) | `npx vitest run packages/ai` | 31 tests: policy, factory, JSON/schema parsing, redaction, all resolution branches, service timeout/retry/exhaustion/malformed/disabled, OpenAI adapter with a mocked `fetch` (no live calls) |
| AI layer (API E2E) | `npx vitest run apps/api/src/ai-classification.test.ts` | an injected mock provider produces a persisted `ai_suggested` decision (provenance + values), and the auto-approved account is absent from the review queue |
| Migrations | `npm run db:generate` | `0000_lying_jigsaw.sql` (8 tables, incl. `rule_sets`) + `0001_pretty_dorian_gray.sql` (`datasets`) + `0002_slow_colonel_america.sql` (`workflow_configurations`, `runs.configuration_id`) + `0003_eager_dagger.sql` (`run_decisions.decision_source`) |

Working end to end: upload datasets (CSV/XLSX) → inspect sheets/columns/types/warnings and preview rows
in the **Datasets** UI → **Setup**: assign datasets to roles, map the account/timestamp/description/output
columns with live validation (errors block, ambiguous mappings need confirmation), save a reusable
versioned configuration, and continue to processing → background run executes the deterministic
classification (latest-fault selection) → (optional, policy-gated) AI assistance for uncertain cases behind
a provider abstraction, never overriding a matched rule and always recorded with provenance → output
CSV/XLSX + review queue CSV → decision log (deterministic vs AI-suggested + AI outcome) → review queue with
accept/override/dismiss → review counters. The legacy path (upload via `/files`, start a run with explicit
file ids and the config form) still works.

Sample run results (canonical `samples/account-faults` files with the default noop provider): 9 accounts,
13 events, 10 output rows, 2 auto-approved, 7 review items (conflicting history, no events, no rule match,
low confidence, duplicate primary key, ambiguous timestamps), 1 orphan event account ignored and counted.
No AI is consulted by the default provider; the AI tests inject a mock provider to exercise the assisted
paths.

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
4. **The OpenAI provider requires credentials and is unverified live.** `AI_PROVIDER=openai` fails fast at
   startup unless `OPENAI_API_KEY` and `AI_MODEL` are set (see §12 for the privacy implications); the
   default `noop` provider reports itself unavailable and sends nothing.
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
13. **Dataset inspection is bounded, so counts can be approximate.** The scan stops at
    `DATASET_MAX_SCAN_ROWS` (default 200,000); past that `rowCount` is a lower bound and the profile sets
    `truncated: true` (surfaced as a `truncated_scan` warning and a `+` in the UI). `uniqueCount` is
    approximate when a column has more than 5,000 distinct values within the scanned rows.
14. **XLSX inspection parses the workbook per operation** (sheet list + headers, then rows; re-analysis
    parses again). Fine for operational files, not for very large workbooks — the `TabularReader`/
    `inspectDataset` seam is the intended replacement point (streaming reader or DuckDB).
15. **Uploads are buffered in memory server-side** (`file.toBuffer()` in the routes) up to
    `MAX_UPLOAD_MB`; rows are not buffered, but streaming the upload straight to object storage is a
    later optimization. The browser never receives full datasets (rows are paged).
16. **Legacy `.xls`/`.xlsb` are rejected** with guidance to save as `.xlsx`/`.csv`. `ExcelJS` cannot read
    the legacy binary format; this is intentional rather than silent corruption.
17. **Two ingest endpoints.** `POST /api/v1/files` returns the legacy `FileAssetDto` (used by the run
    wizard) and `POST /api/v1/datasets` returns the rich `DatasetDto`; both create a `FileAsset` and a
    `DatasetProfile`. Session 2 should build column mapping on the dataset profile and may deprecate the
    `/files` route for new UI.
18. **Configurations are versioned, not snapshotted.** Saving (create or update) increments `version`, but
    previous versions are overwritten — there is no immutable history yet. Update is additive: it keeps
    the id and replaces the row.
19. **Configurations reference dataset ids, not re-detected columns.** Reusing a setup for a new daily file
    means editing the configuration to re-point the dataset assignments; if the new file's column names
    differ, the mappings must be updated too (validation will flag the old names as `unknown_column`).
20. **Configuration validation is structural + sample-based, not a full scan.** It uses the bounded
    `DatasetProfile` (types, flags, sample values) and the `looksLikeTimestamp` heuristic in `core`, not the
    authoritative parser in `file-processing`. It catches obvious mistakes and requires confirmation for
    atypical mappings but does not prove every row parses.
21. **`secondary`/optional roles are modelled but unused.** The configuration model supports non-required
    and multi-value roles, but the setup UI currently uses only the account-faults single-dataset roles and
    a multi-value output-columns role; multi-dataset-per-role selection is not wired.
22. **The matching engine runs on fully loaded arrays.** `matchRecords` itself is a single linear pass and
    handles millions of events (see §9), but the workflow still loads both files with `readAllRows`, so
    memory scales with the file. A streaming/chunked loader can be added behind the same contract later.
23. **Engine issues are not yet part of the review routing.** `matchRecords` computes
    `ambiguous_latest_timestamp`, `unparsed_timestamp`, `no_valid_timestamp`, `duplicate_primary`,
    `no_events` and `identifier_transformed`, but the account-faults workflow still derives its own
    `ReviewReason`s in the `classify` step. Wiring engine issues directly into review reasons is a
    follow-up.
24. **Dangerous identifier normalization is opt-in but not exposed.** `stripSeparators`/`stripLeadingZeros`
    are off by default and nothing in the API/UI sets them yet, so no configuration can currently merge
    identifiers that differ by punctuation or leading zeros.
25. **The engine preserves duplicate events.** Identical event rows are never deduplicated (they can be
    legitimate repeated reports); callers that need deduplication must do it before calling `matchRecords`.
26. **Rule-set versions are overwritten, not snapshotted.** Saving bumps `version` but replaces the row (the
    same behaviour configurations have); there is no immutable rule history yet, and a run stores only the
    resolved rules indirectly (through the active set + decision evidence).
27. **History-scoped rules build an in-memory history array per entity.** `buildRuleContext` passes the full
    event history for `any_event`/`all_events` conditions; this scales with the loaded file (the join itself
    is still linear).
28. **Rule validation is semantic, not a proof.** It catches missing values, bad regex, conflicting actions
    and unreachable duplicates, but it cannot prove that overlapping rule sets are logically exclusive, and
    different-priority overlaps are intentional fallbacks rather than errors.
29. **The Rules UI does not know the workflow's output schema.** Output fields are free text, so a typo in an
    action field is not flagged until it reaches the output (the `__`-prefixed and business columns are
    conventions, not a validated vocabulary).
30. **Single active set is enforced by the service, not the database.** `RuleSetService` deactivates siblings
    on save and `getActiveByWorkflowSlug` returns the first active row; direct DB writes could still create
    two active sets.
31. **AI suggestions cannot yet be converted into rules.** The policy seam and evidence exist, but the Rules
    UI has no "accept a suggestion as a rule" flow (deliberately, per the AI-assists-never-overrides rule).
32. **The AI layer is untested against a live model.** All tests inject a mock provider / mocked `fetch`;
    the OpenAI adapter's request shape and failure mapping are covered, but real latency, token limits,
    model-specific JSON quirks and cost are unverified. There is no token/cost accounting or caching.
33. **AI context is bounded but not token-budgeted.** The request includes the latest event plus up to
    `maxEvidenceFaults` history entries; there is no per-provider token estimate or truncation beyond that.
34. **AI-sourced values are all-or-nothing.** An accepted target writes every value its taxonomy `values`
    defines; there is no per-field AI fill or "AI fills only the gaps in a partial rule result".
35. **Redaction is field-name based.** `AI_EXCLUDED_FIELDS` matches field names exactly (no regex/paths), the
    default request already excludes raw rows, and `redactEntityKey` replaces the key with `[redacted]`
    rather than a stable pseudonym, so it is not usable for correlating suggestions across calls.
36. **Decision provenance is not queryable.** `decisionSource` and the AI outcome are persisted, but there is
    no endpoint/UI filter for "show only AI-assisted" or "show AI failures"; the run decision table shows
    the source column only.
37. **AI corroboration of a weak rule is not surfaced in the output.** When AI agrees with a below-threshold
    rule and auto-approval raises its confidence, the output looks identical to a confidently matched rule
    except for `__DecisionSource` staying `deterministic`; the agreement is only in the decision evidence.
38. **The `openai` provider is selected by env only.** There is no per-workflow or per-configuration provider
    choice, and no way to A/B or shadow-evaluate a model; `AI_PROVIDER` is global.

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
- ADR-010 ingestion produces a persisted, bounded dataset profile; rows stay in storage and are paged.
- ADR-011 a workflow declares its mapping requirements as data; configurations are validated in `core` and
  persisted/versioned, and runs resolve them through the workflow's `resolveRunInput`.
- ADR-012 matching/grouping/latest-event selection is a standalone, example-agnostic engine; identifier
  normalization reports every transformation and only performs dangerous merges when explicitly opted in.
- ADR-013 rules are data, evaluated deterministically (full decision metadata, scoped conditions, no-match/
  conflict/low-confidence review flags), and managed through a validated, versioned API with one active set
  per workflow resolved per run.
- ADR-014 AI is an optional, policy-gated assistant behind a provider port; it receives a bounded structured
  request, must return a strictly validated structured result, never overrides a matched rule, records full
  provenance (`decisionSource`), and degrades every failure to a review reason rather than a wrong result.

Additional decisions made during implementation:

- Internal packages expose `src/index.ts` via `exports`; nothing pre-builds, so no build ordering issues.
- The API bundle **must** externalize its real runtime dependencies. `exceljs`, `csv-parse`,
  `csv-stringify`, `drizzle-orm`, `postgres`, `zod` and `pino` are declared in `apps/api/package.json`
  specifically so tsup keeps them external — do not remove them or the bundled CJS code will crash.
- Leading-zero numeric strings are inferred as `string` (identifiers such as account numbers), never `number`.
- Deterministic tie-breaks everywhere: rules by priority → specificity → id; latest fault by timestamp →
  later source row.
- `WorkflowOutputs` is the engine↔service contract, so `RunService` never knows workflow specifics.
- The AI request is built from descriptions/timestamps only; the provider never receives a raw source row.
  A provider is a thin transport adapter (one `classify` call); policy, redaction, timeout, retries and
  validation live in the provider-neutral service, so a new model is a new adapter, not a new pipeline.
- AI-sourced results are possible only when no rule matched; a matched rule is never replaced. `aiAutoApprove`
  defaults to **false**, so an AI suggestion is recorded and routed to review unless an operator opts in.
- AI failures are modelled as data (`AiAssistOutcome.failed`) so the run succeeds and the case is reviewable;
  cancellation is the only AI error allowed to propagate.

## 12. Security

Implemented:

- **Secrets** are never in source. `.env` is git-ignored, `.env.example` documents variables without values;
  config validation fails fast on missing cross-field requirements.
- **Path traversal protection** in `LocalFileStorage` (rejects `..`, normalizes separators) and uploaded
  file names are reduced to their basename via `path.basename`.
- **Upload limits** enforced by `@fastify/multipart` (`MAX_UPLOAD_MB`) and a 2 MB JSON body limit.
  Oversized uploads return a clean `413 payload_too_large` body.
- **Upload validation before storage** (`validateUpload`): extension allowlist, declared content-type
  allowlist, size limit, filename sanitisation (basename + control-character stripping), and magic-byte
  checks (PK zip signature for XLSX, NUL-free for delimited text). Uploaded content is only ever parsed
  by `csv-parse`/`exceljs`; it is never executed, and storage keys are generated from internal UUIDs.
- **CSV/Excel formula injection guard** — strings starting with `= + - @` are written as plain text (rich
  text run) in XLSX.
- **Strict validation** at every boundary: zod for HTTP bodies, workflow inputs, workflow config (strict
  object → unknown keys rejected), rule sets and file metadata.
- **Error hygiene** — internal errors are logged, clients receive `{ error: { code, message } }` only;
  `isAppError` distinguishes safe errors from unexpected ones.
- **Logging** never includes file contents; logs carry ids, sizes, counts.
- **AI is off by default.** `AI_PROVIDER=noop` (`isAvailable() === false`) means no record data leaves the
  process; a consultation happens only when `aiPolicy` says so *and* a configured provider is available.
- **Data minimisation.** A request carries only the entity handle, the latest event, a bounded history of
  `description`/`occurredAt` summaries, the classification targets and evaluated rule summaries — never the
  raw source row. `AI_EXCLUDED_FIELDS` removes named fields inside the service before any provider call.
- **Untrusted model output.** Responses are extracted as a JSON object and strictly validated with zod
  (unknown keys stripped, confidence range enforced); the proposed class must be one of the configured
  targets, otherwise it is rejected. User content is labelled as untrusted data in the system prompt to
  reduce prompt-injection risk, and a model reply can never execute code or change configuration.
- **Failure isolation and secret hygiene.** Provider errors (timeout/rate limit/credentials/malformed) become
  reviewable outcomes; `OPENAI_API_KEY` comes from the environment, is never logged, and only appears in the
  `Authorization` header of the outbound request. Bounded retries/timeouts prevent a slow provider stalling a
  run.

Not yet implemented (risks acknowledged):

- No authentication/authorization, no tenant isolation, no audit trail of who resolved a review item
  (`resolvedBy` is always `null`), no rate limiting, no malware scanning of uploads, no TLS termination
  (deploy behind a reverse proxy), CORS origins must be set explicitly in production, and files are stored
  unencrypted on local disk.
- **AI privacy is a deployment responsibility.** With `AI_PROVIDER=openai` (or any non-`noop` base URL),
  event descriptions are sent to a third party (or an operator-chosen gateway). There is no DPA/zero-retention
  guarantee, no per-tenant or per-dataset routing, no in-repo local model, and no cost/token budget. Free-text
  descriptions are the classification signal and may themselves contain PII; field-name redaction cannot
  remove PII that lives inside the description. Treat exporting to an AI provider as a data-processing
  decision, not a default.

## 13. Testing

**Status: 209 tests / 21 files passing (`npm test`).** Coverage by area:

| Area | File | What it proves |
| --- | --- | --- |
| Domain schemas | `packages/core/src/domain/rules.test.ts` | defaults, nested groups, validation errors |
| Env config | `packages/config/src/schema.test.ts` | defaults, coercion, cross-field failures |
| Normalization/parsing | `packages/file-processing/src/normalize.test.ts` | keys, ISO/slash/Excel timestamps, invalid input |
| Identifier normalization | `packages/matching-engine/src/normalize.test.ts` | blank/whitespace/NBSP handling, case folding + opt-out, number↔numeric-string unification, boolean/date safety, opt-in dangerous separator/leading-zero stripping (and flagging), `normalizeKey` parity, idempotency |
| Matching engine | `packages/matching-engine/src/match.test.ts` | one-to-many grouping, full history order, zero-event entities, orphan events, duplicate primaries, timestamp ties, invalid/missing timestamps, numeric/whitespace identifiers, blank-key skipping, dangerous-normalization merging, `rowIndexBase`, first-seen entity order, `dayFirst`/custom parsers, aggregate stats, 2,000-entity dataset |
| CSV | `packages/file-processing/src/csv.test.ts` | quoted delimiters, embedded newlines, BOM, limits, round-trip writing |
| XLSX | `packages/file-processing/src/xlsx.test.ts` | type round-trip (string/number/boolean/date/null), formula-injection guard, empty sheets |
| Inference/detection | `packages/file-processing/src/inference.test.ts` | column typing, nullability, format sniffing, reader/writer factories |
| Dataset inspection | `packages/file-processing/src/inspection.test.ts` | types, empties, dates, identifiers, leading zeros, duplicate columns, mixed types, scan truncation, empty/headerless errors, multi-sheet XLSX, corrupt workbook |
| Upload validation | `packages/file-processing/src/upload.test.ts` | filename sanitisation, extension/content-type/size/magic-byte rejections |
| Dataset API | `apps/api/src/dataset.test.ts` | ingest + list + detail, row paging, re-analysis, traversal-safe names, 415/422/404/413 error states |
| Configuration validation | `packages/core/src/domain/workflow-config.test.ts` | missing roles/columns, unknown datasets/columns, date-as-identifier and non-date-timestamp confirmation flow, empty columns, required/invalid options, duplicate assignments |
| Configuration API | `apps/api/src/workflow-configuration.test.ts` | workflow definition exposed to UI, validate incomplete/complete + resolved preview, invalid save rejected (422), create/list/get/update version bump, run started from a configuration records `configurationId` |
| Rules | `packages/rule-engine/src/rule-engine.test.ts` | operators (15), case/numeric/date coercions, membership/emptiness, safe regex, `latest`/`any_event`/`all_events` scopes, decision metadata (resulting values, evaluated conditions, matched rules, status), deterministic tie-breaks, same-priority conflicts + `rule_conflict`, no-match/`no_rule_match`, low-confidence threshold, `applyActions` semantics, validation (duplicates, missing values, bad regex, conflicting actions, shared priorities, unreachable duplicates) |
| Rule management API | `apps/api/src/rule-set.test.ts` | list seeded active set, validate (valid + blocking errors), refuse invalid save (422 `invalid_rule_set`), create + deactivate previous, update version bump, run resolves and applies the active set, 404 |
| AI layer | `packages/ai/src/ai.test.ts` | policy reasons, factory (noop default, openai requires key+model), noop result, balanced-JSON/schema parsing (prose + fences accepted; missing/malformed JSON and out-of-range confidence rejected; unknown keys stripped), redaction (excluded fields, entity key, latest-only), resolution (confident rule wins, AI never overrides, auto-approve gating, low-confidence/ambiguous flags, AI failure), service (not-consulted/disabled/skipped, suggested values, unknown class, redaction before provider, rate-limit retry then success, attempt-budget exhaustion, no retry on malformed, timeout of a hanging provider), OpenAI adapter with a mocked `fetch` (body shape/`response_format`, 401/429/malformed mapping) |
| Workflow (AI) | `packages/workflow-engine/.../account-faults.test.ts` | +5 AI scenarios: confident AI proposal auto-approved only when no rule matched, AI can never override a confident rule (`ai_proposed_alternative`), low-confidence AI routes to review, provider failure keeps the run succeeding (`ai_failed`), and the request contains no raw row (bounded, non-identifying data) |
| AI API | `apps/api/src/ai-classification.test.ts` | injected mock provider end to end through the HTTP API: a persisted `ai_suggested` decision with `decisionSource`, values and validated AI outcome, and the auto-approved account absent from the review queue |
| Engine | `packages/workflow-engine/src/engine.test.ts` | step ordering, state merge, metrics, failure short-circuit, cancellation |
| Workflow | `packages/workflow-engine/.../account-faults.test.ts` | full classification output, latest fault, review reasons, stats, evidence, per-run rule set with history-scoped conditions, no-match decision evidence |
| API | `apps/api/src/server.test.ts` | health, meta, workflows, uploads, 415, run E2E, artifacts download, decisions, review resolve, 404/400/409 |
| UI helpers | `apps/web/src/lib/format.test.ts` | formatting utilities |

Missing (recommended next): Postgres repository integration tests (behind a `DATABASE_URL` gate, now
including `datasets`, `workflow_configurations` and `run_decisions.decision_source`), rule engine
property/fuzz tests, a load test for large CSV/`DATASET_MAX_SCAN_ROWS` inspection, Playwright browser tests
for the datasets/setup/new-run/review flows, configuration-resolution tests for multi-dataset roles, and
coverage reporting in CI. For the matching engine: a randomized/property test asserting that the latest
selection is invariant under input shuffling, and a very-large-file (streaming) test once the loader is
chunked. For the rule engine: a randomized/property test asserting the winner is invariant under rule
shuffling, a golden test over the default account-faults rule set, and a Playwright test for the Rules editor
(validate → save → run uses it). For the AI layer: an adapter contract test suite run against a local
mock/hosted endpoint behind a gate, prompt-injection fixtures, and a test that redaction is applied for every
request shape (including the history array).

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
`STORAGE_LOCAL_DIR` (.data/storage), `MAX_UPLOAD_MB` (50), `DATASET_SAMPLE_ROWS` (10),
`DATASET_MAX_SCAN_ROWS` (200000), `AI_PROVIDER` (noop), `OPENAI_API_KEY` (empty),
`AI_MODEL` (empty), `AI_BASE_URL` (https://api.openai.com/v1), `AI_TIMEOUT_MS` (15000),
`AI_MAX_ATTEMPTS` (2), `AI_EXCLUDED_FIELDS` (empty). Web: `VITE_API_BASE_URL` (empty → Vite dev proxy to the
API), `VITE_API_TARGET` (proxy target, default `http://127.0.0.1:4000`).

Local data lives in `.data/` (git-ignored): `storage/` for uploads/artifacts, log files from manual runs.
Postgres for later verification: `docker compose up -d postgres` (user/password/db all `sheetpilot`).

## 15. Next Session — exact recommended work

**Product session 6: the review queue & human-in-the-loop** (queue `06-session.md`). The AI layer now produces
suggestions and provenance, so the review loop is the natural next slice. Recommended order:

1. **Human review system.** Make the review queue the product's differentiator: show, per item, the entity,
   latest event, relevant history, the deterministic rule result, the AI suggestion (when present), the
   confidence, the exact reason it was flagged, the applicable rules, and the current status
   (`AUTO_RESOLVED`/`NEEDS_REVIEW`/`APPROVED`/`OVERRIDDEN`/`ERROR`). Support open → understand → see evidence
   → accept / override → save → next, as fast as possible, with filtering (needs review, unresolved,
   conflicts, low confidence, processing errors) and human overrides tracked separately from automated
   decisions (audit what automation decided, why, what the human changed, and when).
2. **Review → artifact regeneration.** Resolving a review item records the decision but does not rewrite the
   output CSV/XLSX. Apply resolutions to the output rows and regenerate the artifacts
   (`RunService`/artifact writer) so the exported file matches the reviewed result.
3. **Verify Postgres.** `docker compose up -d postgres`, run the migrations (`0000`–`0003`), and exercise the
   API against `REPOSITORY_DRIVER=postgres`. Add gated repository integration tests (including
   `rule_sets` `listByWorkflowSlug`/`getActiveByWorkflowSlug` and `run_decisions.decision_source`).
4. **Rule-management follow-ups:** immutable rule-set version snapshots, validate action fields against the
   workflow's declared output columns, an "accept an AI suggestion as a rule" flow, and import/export JSON.
5. **Configuration follow-ups:** immutable version snapshots, a "reuse for a new daily file" flow that
   re-points assignments while keeping column mappings, and deprecating the legacy `/files` wizard.
6. **AI follow-ups:** expose `decisionSource` filtering in the review/UI, per-configuration provider choice,
   token/cost accounting, prompt-injection fixtures and an adapter contract test against a local endpoint.
7. Then: scheduling/watched-folder ingestion, exposing identifier normalization options through configuration,
   streaming/chunking the loader, and route-level code splitting for the web bundle.

**Definition of done for the next session:** the chosen priority item is implemented, has tests, docs
(`docs/decisions.md` if architectural), all four verification commands pass (`lint`, `typecheck`, `test`,
`build`) plus `npm run smoke` for API-affecting changes, and this file is updated with real results.

## 16. Important Context

- **Verification-first culture.** Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`
  before declaring anything done. `progress.md` must reflect reality, not intentions.
- **Layer boundaries are load-bearing.** `core` must not import other packages; `workflow-engine` must not
  import Fastify/React; `web` must not import Node-only packages (`file-processing`, `matching-engine`,
  `db`, `workflow-engine`). New cross-layer values go through `core` contracts/ports.
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
- **AI never overrides a rule.** `packages/ai/src/resolve.ts` (`resolveAssistedDecision`) is the single merge
  point and `packages/ai/src/service.ts` is the single orchestration point (policy, redaction, timeout,
  retries, validation). A provider is a thin `classify` adapter only. Keep the strict result schema in
  `packages/core/src/domain/ai.ts` as the contract; never accept free-form model prose, never send raw rows
  (build requests from `description`/`occurredAt`), and never let a provider error fail a run — return an
  `AiAssistOutcome`. New AI review reasons must be added to the `ReviewReason` enum and the workflow's
  label/severity/order maps. Tests must inject a mock provider; ordinary `npm test` must never hit the
  network. The taxonomy target `values` are what an accepted AI proposal writes, so keep them in sync with
  the corresponding rule actions.
- **Review status vocabulary:** `open`, `resolved_accepted`, `resolved_overridden`, `dismissed`.
  `__ReviewStatus` in output files is `AUTO_APPROVED` or `REVIEW_REQUIRED`; `__DecisionSource` is
  `deterministic` or `ai_suggested` (or empty/`none` when nothing produced values).
- **Roadmap guardrail:** don't add enterprise features (SSO, billing, complex RBAC) before the core
  workflow, review loop and Postgres durability are excellent.
- **Dataset ingestion is the front door.** All uploads flow through
  `apps/api/src/services/dataset-service.ts` → `packages/file-processing/src/inspectDataset` → a persisted
  `DatasetProfile`. Rows live only in object storage and are paged via `DatasetService.readRows`; never
  read a whole dataset into the API response or the browser. `DatasetProfile.columns` (types, emptiness,
  `likelyDate`, `likelyIdentifier`) is what the Setup mapping UI suggests defaults from.
- **Workflow configuration is data.** Roles and semantic column roles live in the workflow's
  `configuration` definition (`packages/workflow-engine/src/workflows/account-faults/configuration.ts`);
  never hardcode dataset/column names in React. Validation is the pure
  `validateWorkflowConfiguration` in `packages/core/src/domain/workflow-config.ts` (errors block,
  confirmable issues are errors until `mapping.confirmed`), reused by
  `WorkflowConfigurationService`. A run from a configuration goes through `RegisteredWorkflow.resolveRunInput`;
  if you add a workflow, declare its roles and a resolver or the run endpoints cannot use configurations.
- **Upload validation lives in `packages/file-processing/src/upload.ts`.** It sanitises filenames and
  enforces extension/content-type/size/magic-byte rules; add new formats there and in
  `TabularReader.describe`/`read`, not in route handlers.
- **Matching is the reusable join engine.** `packages/matching-engine/src/match.ts` owns
  primary↔event joining, grouping, deterministic latest-event selection and join statistics; never
  re-implement grouping/latest logic inside a workflow. Feed it raw records via accessors, then map
  `MatchedEntity` to the workflow's own types. `normalizeIdentifier` is the single normalization path and
  its default options must stay byte-for-byte equal to `normalizeKey` in `file-processing`; dangerous
  steps (`stripSeparators`, `stripLeadingZeros`) stay opt-in and are reported. Latest-selection ties always
  break on the later source row — keep `compareEventsLatestFirst` as the one comparator.
- **Environment note:** this working copy was moved from `D:\deepseekmodeltestingforexcelproj` to
  `D:\ExcelProjectBydeepseek`; the workspace `node_modules/@sheetpilot/*` links had to be relinked with
  `npm install`. If module resolution fails after moving the repo again, re-run `npm install`.
- **Files a new agent should read first:** this file → `docs/architecture.md` →
  `packages/core/src/domain/entities.ts` + `packages/core/src/domain/dataset.ts` +
  `packages/core/src/domain/workflow-config.ts` + `packages/core/src/domain/ai.ts` →
  `packages/file-processing/src/inspection.ts` →
  `packages/matching-engine/src/{types,normalize,match}.ts` →
  `packages/ai/src/{service,resolve,redact,openai-provider}.ts` →
  `apps/api/src/services/dataset-service.ts` →
  `apps/api/src/services/workflow-configuration-service.ts` →
  `packages/workflow-engine/src/workflows/account-faults/{types,steps,configuration}.ts` →
  `apps/api/src/services/run-service.ts`.

### Session log

| Session | Date | Summary |
| --- | --- | --- |
| Foundation | 2026-09-15 | Monorepo, core/domain/ports, config, file-processing, rule engine, AI seam, workflow engine + account-fault-triage workflow, Drizzle schema + in-memory/Postgres repositories, Fastify API, React SPA, samples, smoke script, docs. Verified: lint/typecheck/86 tests/build/smoke/dev servers. |
| Product 1 | 2026-09-16 | File ingestion & dataset inspection: dataset domain + port + DTOs + errors, `TabularReader.describe()`, `inspectDataset` (types/emptiness/uniqueness/samples/warnings/flags), `validateUpload`, `datasets` table + migration + repositories, `DatasetService` + dataset API, Datasets upload/detail UI, +26 tests (112 total). Verified: lint/typecheck/112 tests/build. |
| Product 2 | 2026-09-16 | Column mapping & workflow configuration: roles-as-data, semantic column mapping + pure validation, persisted/versioned `WorkflowConfiguration` + repository + `workflow_configurations` table/migration, `WorkflowConfigurationService` + API, `resolveRunInput` (config keys from mapped columns), Setup wizard UI with live validation/confirmations, +16 tests (128 total). Verified: lint/typecheck/128 tests/build/smoke (incl. configuration flow). |
| Product 3 | 2026-09-16 | Reusable matching/grouping/latest-event engine: new `@sheetpilot/matching-engine` (reported identifier normalization with opt-in dangerous steps, primary↔event join, deterministic latest selection, full history, join statistics), account-faults `group-events` delegates to it, +35 tests (163 total), benchmark (1M events ≈ 2.7 s). Verified: lint/typecheck/163 tests/build/smoke. |
| Product 4 | 2026-09-16 | Rule engine & rule management: scoped conditions (`latest`/`any_event`/`all_events`) and full `RuleEvaluation` decision metadata, semantic `validateRuleSet` warnings/errors, `RuleSetService` + `/api/v1/rule-sets` (validated, versioned, one active set, resolved per run), Rules UI editor, +16 tests (179 total). Verified: lint/typecheck/179 tests/build/smoke. |
| Product 5 | 2026-09-16 | AI-assisted classification layer: provider-neutral `ClassificationProvider` + structured request/result/outcome contracts, `AiClassificationService` (policy gate, redaction, timeout, bounded retries, strict zod validation, normalized failures), deterministic-first `resolveAssistedDecision` (AI never overrides a rule; auto-approval off by default), OpenAI-compatible adapter, `decisionSource` + AI provenance persisted (migration `0003`), review-card AI panel + run decision source, `__DecisionSource` output column, +30 tests (209 total). Verified: lint/typecheck/209 tests/build/smoke. |
