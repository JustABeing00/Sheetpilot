# SheetPilot — Data & Privacy Notes

> This document describes, concretely, what SheetPilot stores, where, for how long, what it sends to
> external services, and what an operator must decide. It is written for the current build (single
> process, local disk storage, in-memory metadata by default, optional Postgres). It is **not** a
> legal compliance document; it is the factual basis an operator needs to complete their own privacy
> assessment (GDPR/UK GDPR, CCPA, internal policy).

## 1. Roles

SheetPilot runs inside **your** environment. You (the operator) are the data controller for anything
you upload; the software is a tool you run. SheetPilot does not operate a hosted service and does not
phone home. There is no telemetry, no analytics and no crash reporting to the vendor.

## 2. What is stored, and where

| Data | Where | Notes |
| --- | --- | --- |
| Uploaded files (primary/events CSV/XLSX) | Object storage on local disk (`STORAGE_LOCAL_DIR`, default `.data/storage/uploads/…`) | Stored byte-for-byte under an internal UUID key. The original filename is kept for display only. |
| Generated deliverables (output CSV/XLSX, review-queue CSV) | Object storage (`…/runs/<runId>/…`) | The final report and its review-queue companion. |
| Dataset profiles | Metadata store (in-memory by default, or Postgres) | Types, emptiness/uniqueness counts, sample values and rows (bounded), warnings. **Not** the full file. |
| Workflow configurations | Metadata store | Dataset ids + column mappings + options; no row data. |
| Runs, steps, snapshots | Metadata store | Status, timings, stats, and a frozen copy of the configuration + rule set used. |
| Decision records | Metadata store | Per-entity explainability: matched rules, output values, confidence, evidence. |
| Review items & resolution log | Metadata store | Human decisions, before/after values, notes, timestamps. `resolvedBy` is currently always null (no auth). |
| Logs | Process stdout/stderr (and any file you redirect them to) | Ids, sizes and counts. **Never** file contents. Credentials are redacted (see §6). |

In the default `REPOSITORY_DRIVER=memory` mode, **all metadata is lost on restart**; the files on
disk remain. With `REPOSITORY_DRIVER=postgres`, metadata persists in your database.

## 3. Temporary files, retention and deletion

- SheetPilot does **not** create temporary files on disk for parsing. Uploads are validated and, if
  rejected **before** storage (bad type/size/magic bytes), are never written. If a failure happens
  **after** storage (corrupt or empty file), the stored object is deleted immediately.
- A background **retention sweep** deletes upload objects that no dataset references and that are
  older than `RETENTION_UPLOAD_TTL_HOURS` (default 168 h = 7 days). This reclaims space from
  interrupted ingestion. It never touches deliverables under `runs/`.
- **Deliverables are kept indefinitely** until you delete them. There is currently **no delete API**;
  deletion is a filesystem/database operation:

  ```bash
  # Remove all stored objects (uploads + deliverables) for a local deployment:
  rm -rf .data/storage
  # Remove metadata: stop the process (memory) or drop/truncate the Postgres tables.
  ```

  Delete uploads first, then deliverables, then metadata, to avoid dangling references.

## 4. What is sent to AI providers

**By default nothing leaves the process.** `AI_PROVIDER=noop` reports itself unavailable, so no
classification request is ever transmitted.

When an operator configures a non-`noop` provider (e.g. `openai`, or any compatible `AI_BASE_URL`),
a request is sent **only** for an entity that the policy allows, and it carries a **bounded,
structured payload**:

- the entity handle (an account/site key),
- the latest event's timestamp and description,
- a bounded history of `description` / `occurredAt` summaries (capped by the workflow),
- the classification targets and their labels,
- short summaries of the rules that were evaluated.

It does **not** include the raw source row, other columns from the file, or the file itself. Field
names listed in `AI_EXCLUDED_FIELDS` are removed before the request is built.

**Important:** free-text fault descriptions are the classification signal and may themselves contain
personal data. Field-name redaction cannot remove PII that lives *inside* a description. With a
third-party provider there is no DPA, zero-retention or residency guarantee in this build. Treat
"export to an AI provider" as a data-processing decision for your organisation, not a default. To
avoid third parties entirely, point `AI_BASE_URL` at a gateway or a self-hosted model, or leave the
provider as `noop`.

Model responses are treated as untrusted input: they are parsed as a JSON object, strictly validated
against a schema, and can never change configuration or execute code. A failed or malformed response
becomes a review reason; it never fails the run and never replaces a deterministic rule.

## 5. Who can access the data

There is **no authentication or authorization in this build**. Anyone who can reach the API can read
and modify everything. Do not expose the API to an untrusted network. An optional API key can be set
(`API_KEY`) to require a shared secret on every `/api/v1` route, but it is a single shared credential,
not per-user access control, and there is no tenant isolation — every dataset is visible to every
caller.

## 6. Logs

Structured logs (pino) record identifiers, sizes, counts, statuses and error messages. They never
include file contents or row values. Credential-shaped fields (`authorization`, `x-api-key`,
`apiKey`, `password`, `token`, `OPENAI_API_KEY`) are redacted from every log line. Error responses to
clients contain a code and a safe message; internal details for 5xx responses are logged, not
returned.

## 7. Security controls relevant to privacy

- Uploads are validated (extension, declared type, size, magic bytes) before storage; the storage key
  is an internal UUID, so the user filename never influences a path. Storage paths are proven to stay
  inside the configured root.
- Workbook archives are checked for zip-bomb shape (entry count and declared expansion) before the
  workbook is opened.
- Files are stored **unencrypted** on local disk. Use full-disk/volume encryption and OS access
  controls, or mount an encrypted volume, if the data is sensitive.

## 8. Operator checklist

1. Decide whether uploaded data may be processed by an AI provider at all. If not, keep `AI_PROVIDER=noop`.
2. If using a provider: choose the endpoint and model, complete your DPA/retention assessment, and set
   `AI_EXCLUDED_FIELDS` for any field names that must never leave.
3. Set a retention TTL that matches your policy (or accept the default 7-day upload sweep) and schedule
   deletion of deliverables you no longer need.
4. Do not expose the API beyond a trusted network; if you must, terminate TLS at a reverse proxy and
   set `API_KEY`, `CORS_ORIGIN` and `TRUST_PROXY` accordingly.
5. Enable disk/database encryption and access controls.
6. Run the final cleanup (`rm -rf .data/storage`, drop the metadata tables) when a project is retired.

## 9. Known limitations (see `docs/security-review.md` for the full list)

- No per-user identity in the audit trail (`resolvedBy` is null).
- No data-deletion API; no per-dataset "right to erasure" workflow.
- No tenant isolation; one deployment is one trust boundary.
- Deliverables are retained until manually deleted.
