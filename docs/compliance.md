# Compliance posture and decisions

This document records the compliance-relevant decisions made for SheetPilot, the sub-processor list,
and the known gaps. It complements `docs/legal/*` (templates) and `docs/deployment.md` (operations).

## Data residency (decided)

**Decision: one region per deployment. No cross-region replication of customer data by default.**

- The deployment region is chosen when the stack is provisioned and must be the same for the Render
  Postgres database, the API service and the worker (they share `DATABASE_URL` and the persistent
  disk). Render sets this with the `region:` field on the database and services; `render.yaml` does
  not pin a region so the operator makes the choice deliberately.
- **Recommended defaults:** `frankfurt` (EU) when EEA/UK data is involved, `oregon` (US) otherwise.
- **Object storage:** create the Cloudflare R2 bucket with a location hint in the same jurisdiction
  (EU jurisdiction for EU data). R2 is S3-compatible and stores all uploads/artifacts when
  `STORAGE_DRIVER=s3`.
- **Changing region later** is a migration, not a setting: provision the new region, restore a
  `pg_dump` there, copy the R2 objects, then cut over. Plan a maintenance window; there is no
  automatic multi-region failover.
- **Necessary out-of-region processing:** Stripe (payments, US), Resend (email, US), and the optional
  AI provider (only when `AI_PROVIDER` is configured). AI classification can be left disabled, and
  `AI_EXCLUDED_FIELDS` keeps sensitive columns out of prompts. Transfers are covered by SCCs per the
  DPA; verify each provider's region before signing enterprise deals.

## Sub-processors

| Provider | Purpose | Data | Region |
| --- | --- | --- | --- |
| Render | API, worker, Postgres, disk | All customer data | Deployment region |
| Cloudflare | Static site, `/api` proxy, R2 | All customer data (proxied), files in R2 | Deployment jurisdiction (R2) |
| Resend | Magic-link and invitation email | Email address, message content | US |
| Stripe | Payments | Billing identifiers; card data stays with Stripe | US |
| AI provider (optional) | Classification suggestions | Redacted row excerpts only when enabled | Provider-dependent |

Update this table and `docs/legal/privacy-policy.md` before adding a provider.

## Internationalization (decided)

**Decision: the product UI is English-only for now.** Rationale: no confirmed non-English customer,
and a half-done i18n layer costs more than it returns.

- UI strings live inline in their components; API errors return stable machine codes
  (`validation_error`, `quota_exceeded`, ...) so a future client can localize messages without
  changing the server.
- Dates/numbers already use the runtime locale via `Intl`/`toLocaleString`.
- Revisit triggers: (a) a signed customer requires another language, (b) >10% of support volume is
  language-related. Then adopt a catalog-based framework (e.g. `react-i18next`) with the existing
  components as the source of keys, and translate the legal pages in parallel.

## Application controls

- **Tenant isolation:** every tenant-scoped read/write is filtered by `tenantId` in the repositories;
  cross-tenant access returns 404 to avoid confirming existence (`apps/api/src/tenancy-isolation.test.ts`).
- **Roles:** owner/admin/member; only owners can grant ownership or remove owners.
- **Data deletion:** runs and datasets have delete endpoints; the deletion service cascades to
  decisions, review items/history, artifacts, snapshots and stored objects (`deletion.test.ts`).
  Workspace/account closure is a documented manual operator procedure for now (see gaps).
- **Retention:** optional sweep expires uploads (`RETENTION_UPLOAD_TTL_HOURS`); artifacts persist
  until explicitly deleted.
- **Uploads:** MIME/extension validation, size limits, xlsx decompression-bomb checks, formula
  execution disabled, path containment in local storage.
- **Auth:** Auth.js sessions (JWT, httpOnly cookie), optional `x-api-key` between Worker and API;
  `AUTH_ENABLED=false` for private single-tenant installs.
- **Observability:** `x-request-id` correlation, structured request logs, `/healthz` + `/readyz`.

## Known gaps / next steps

1. **Workspace deletion API + DSAR tooling.** Deleting a workspace (and a user account) end to end is
   currently an operator runbook (`docs/deployment.md` restore section shows the manual steps). Add
   owner-initiated workspace deletion with the same cascade as run deletion.
2. **Cookie consent.** Only a session cookie is set; no analytics or marketing cookies. Add a banner
   only if tracking is introduced.
3. **Audit log export.** Review decisions are audited per run; a workspace-wide audit export is not
   built yet.
4. **Penetration test and SOC 2.** Not started; required for larger enterprise deals. The controls
   above are the evidence base.
5. **DPA automation.** Sub-processor notices and DSAR workflows are manual; document the runbook when
   the first enterprise contract requires them.
