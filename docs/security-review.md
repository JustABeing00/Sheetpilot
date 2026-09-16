# SheetPilot — Repository-Wide Security Review

**Date:** 2026-09-17 · **Scope:** the whole repository at product session 10 (security, reliability &
production hardening). **Verdict:** meaningfully hardened versus the previous session and honest
about what is **not** solved. This is **not** a claim that SheetPilot is "secure"; it is a stated
boundary. The threat model is a **single-operator, local/trusted-network deployment** handling
untrusted *files*.

## 1. Trust boundaries

```
untrusted: uploaded file bytes + filenames + HTTP bodies + AI model output
        │
        ▼
  [validation seam]  ← the security-relevant boundary
        │
        ▼
trusted: process config (env), local disk storage, in-memory/Postgres metadata
        │
        ▼
  optional outbound: AI provider (only when explicitly configured)
```

The tool never executes uploaded content, never uses a user filename to build a path, and treats model
output as data to be validated.

## 2. What changed this session

| # | Area | Change |
| --- | --- | --- |
| 1 | File security | `sanitizeFileName` now also strips Windows-illegal characters, leading/trailing dots & spaces, bounds length to 120 chars and neutralises reserved device names (`CON`, `NUL`, `COM1`…). |
| 2 | File security | `LocalFileStorage.resolvePath` rejects absolute/drive-relative keys, NUL bytes, `.`/`..`/empty segments, and uses `path.resolve` + `path.relative` to **prove containment** inside the storage root (was a substring check on `..`). |
| 3 | File security | New `assertWorkbookArchiveSafe` reads the XLSX **ZIP central directory without inflating** and rejects archives whose declared uncompressed size (`MAX_XLSX_UNCOMPRESSED_MB`) or entry count (`MAX_XLSX_ENTRIES`) exceed limits — a decompression-bomb guard that runs before ExcelJS buffers the workbook. |
| 4 | File security | Ingestion deletes the stored object if any later step (inspection/persistence) fails, so rejected/corrupt uploads no longer accumulate. |
| 5 | File security | New `RetentionService` + `FileStorage.list` sweeps unreferenced uploads older than `RETENTION_UPLOAD_TTL_HOURS`; deliverables are never swept. |
| 6 | API security | Optional shared-secret auth: when `API_KEY` is set, every `/api/v1` route requires `x-api-key` (constant-time compare); `/healthz` stays open. |
| 7 | API security | In-process per-IP fixed-window rate limit (`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`), returns `429` + `Retry-After`. |
| 8 | API security | Conservative response headers on every reply (`x-content-type-options`, `x-frame-options`, `referrer-policy`, `cross-origin-opener-policy`, …); HSTS in production. |
| 9 | API security | Configurable JSON body limit (`JSON_BODY_LIMIT_MB`), multipart `fieldSize`/`parts` caps, `requestTimeout`, and `TRUST_PROXY` for correct client IPs behind a reverse proxy. |
| 10 | API security | 5xx error `details` are no longer sent to clients (logged instead); CORS credentials disabled. |
| 11 | Data security | pino redaction of `authorization`, `x-api-key`, `apiKey`, `password`, `token`, `OPENAI_API_KEY` and nested variants. |
| 12 | AI security | Added prompt-injection, prototype-pollution-key-stripping, history-redaction and a **real local-endpoint** adapter contract test (auth header only, bounded payload, untrusted-data labelling). |
| 13 | Reliability | `RunService.recoverStaleRuns()` fails runs stranded in `queued`/`running` by a previous process. |
| 14 | Reliability | Double-execution guard (marked synchronously before any await) plus a "only queued runs execute" check. |
| 15 | Reliability | `IdempotencyService`: `Idempotency-Key` on `POST /api/v1/runs` returns the original run on replay (in-process, 24 h, failures not cached). |
| 16 | Testing | 37 new tests (295 total): filename/path/archive/storage hardening, API auth/rate-limit/headers/error-hygiene/idempotency/recovery/cleanup, AI security. |

## 3. Findings

Status legend: **Fixed** (control added), **Mitigated** (defended but not eliminated), **Open**
(acknowledged, not solved).

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| F-01 | High | No authentication/authorization; any reachable client can read/modify everything. | **Mitigated** — optional shared `API_KEY`; no per-user auth/tenancy. |
| F-02 | High | No tenant isolation; all datasets visible to all callers. | **Open** — single trust boundary by design. |
| F-03 | High | ZIP/decompression bomb in an uploaded `.xlsx` could exhaust memory before parsing. | **Fixed** — central-directory guard before ExcelJS. |
| F-04 | Medium | Path traversal via storage keys (only a `..` substring check). | **Fixed** — containment proof + absolute/drive rejection. |
| F-05 | Medium | Rejected/mid-failure uploads left orphaned objects on disk. | **Fixed** — cleanup on failure + retention sweep. |
| F-06 | Medium | No rate limiting; trivial request flooding / resource exhaustion. | **Fixed** — configurable per-IP limit. |
| F-07 | Medium | No request-idempotency; a retried `POST /runs` starts duplicate jobs. | **Fixed** — `Idempotency-Key` (in-process). |
| F-08 | Medium | Interrupted runs reported "processing" forever. | **Fixed** — startup recovery marks them failed. |
| F-09 | Medium | Credential-shaped data could reach logs via dependency objects. | **Fixed** — pino redaction paths. |
| F-10 | Medium | 5xx AppError `details` returned to clients (internal context exposure). | **Fixed** — dropped for 5xx, logged. |
| F-11 | Low | Uploaded filenames allowed Windows-reserved/illegal characters and unbounded length. | **Fixed** — hardened sanitiser. |
| F-12 | Low | No security headers; no HSTS. | **Fixed** — headers on every reply. |
| F-13 | Low | AI model output could carry unknown/prototype-polluting keys. | **Fixed** — strict schema strips unknowns. |
| F-14 | Low | Uploads buffered in memory up to `MAX_UPLOAD_MB` server-side. | **Open** — bounded by config; stream-to-storage is a later optimization. |
| F-15 | Low | Files stored unencrypted on local disk. | **Open** — deployment responsibility (disk encryption). |
| F-16 | Low | No malware/AV scanning of uploads. | **Open** — out of scope for this build. |
| F-17 | Low | No TLS termination in-process. | **Open** — deploy behind a reverse proxy. |
| F-18 | Low | Idempotency and rate-limit state are process-local (lost on restart, not shared across instances). | **Open** — accurate for single-process deployment. |
| F-19 | Low | No audit identity: `resolvedBy` is always null. | **Open** — needs auth. |
| F-20 | Low | AI provider is global (env-selected); no per-tenant routing / token budget. | **Open** — see `docs/privacy.md`. |
| F-21 | Info | Postgres adapters remain unverified against a live database. | **Open** — carry-over from earlier sessions. |

## 4. Attack/failure cases now covered by tests

- Traversal-shaped filenames and storage keys (`../`, `..\\`, absolute, drive-relative, NUL, empty).
- Windows reserved names, illegal characters, over-long names.
- Spoofed content type, non-zip `.xlsx`, binary disguised as CSV (pre-existing tests, still green).
- Zip-bomb and excessive-entry archives; malformed archives handled gracefully.
- Oversized uploads (`413`), header-only files (`422`) with no orphaned object left behind.
- Missing/wrong API key (`401`), health probe open, rate-limit exhaustion (`429` + `Retry-After`).
- Error bodies without stack traces; malformed JSON bodies.
- Replayed `Idempotency-Key` returns the same run and creates only one.
- Stale `running` run recovered to `failed`.
- Prompt injection, unknown/prototype keys in model output, history redaction, real local adapter
  transport (key only in the header, bounded payload, untrusted-data labelling).

## 5. Honest remaining risk

- **This build is for a trusted, single-operator environment.** With `API_KEY` unset (the default)
  it is unauthenticated. Even with it set, there is no per-user identity, no authorization, no tenant
  isolation and no revocation.
- **Idempotency and rate limiting do not survive a restart or span multiple instances.** They reduce
  accidental duplication and casual flooding, not a determined attacker.
- **The zip-bomb guard is heuristic.** It inspects declared sizes and skips ZIP64 size accounting when
  the per-entry sizes cannot be resolved; a crafted ZIP64 archive can still reach the parser. The
  upload size cap is the backstop.
- **The AI path is only as private as the endpoint you configure.** Free-text descriptions may contain
  PII that field-name redaction cannot remove. `noop` is the only zero-exposure setting.
- **Data at rest is unencrypted** and **deletion is manual** (no API). See `docs/privacy.md`.
- **Not covered:** SSRF hardening beyond the operator-controlled `AI_BASE_URL`, supply-chain/`npm audit`
  triage, container/OS hardening, and full Postgres verification.

## 6. Recommended next steps (priority order)

1. Per-user authentication + authorization and a real audit identity (`resolvedBy`).
2. Durable idempotency and job state (a real queue) so restarts and multiple API instances are safe.
3. A delete/erasure API with cascading cleanup of storage + metadata, and a configurable deliverable
   retention.
4. Stream uploads straight to storage (drop the in-memory buffer) and stream the loader.
5. `npm audit` in CI plus dependency-pinning policy; verify Postgres adapters.
6. Per-tenant AI routing, token/cost budget and `decisionSource` filtering.
