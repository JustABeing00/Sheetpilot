# What Has Been Done — Project Handoff

> Purpose: the complete record of the SheetPilot build. All planned phases (A–K) are implemented,
> verified and committed. Written: 2026-09-19. Branch: `main`. Repo: SheetPilot (Excel workflow
> automation SaaS).

## 0. Current state

- **Working tree is clean.**
- **HEAD at the time of writing:** `cc5381d` — "Phase K: legal templates, compliance, residency and
  i18n decisions" (this handoff file is the next commit).
- **Verification (run 2026-09-19, all green):**
  - `npm run format:check` — clean
  - `npm run lint` — clean
  - `npm run typecheck` — clean (all workspaces incl. `@sheetpilot/web`)
  - `npm test` — **47 files / 376 tests passing**
  - `npm run build` — clean (API bundle + web `dist/`)
  - `npm audit --omit=dev` — **0 vulnerabilities** (4 moderate dev-only advisories in drizzle-kit's
    esbuild chain; `npm audit fix --force` would downgrade drizzle-kit and is not applied)
  - `npm run e2e` — **3 Playwright tests passing** (app shell, auth-disabled workspace notice,
    upload → run → review → export download)
  - Production bundle smoke: `node apps/api/dist/index.js` served `/healthz`, `/readyz`,
    `/api/v1/meta`; `npm run smoke` passed end to end against it
  - `npx wrangler deploy --dry-run` (apps/web) — Worker + 35 assets upload cleanly
- **Migrations:** `0000`–`0010` present in `packages/db/drizzle/` (latest: `0010_panoramic_gamma_corps`
  adds `tenants.plan`).

## 1. Project snapshot

- **Product:** SheetPilot — spreadsheet-workflow automation (upload → inspect → map → match/group →
  latest event → rules → AI assist → human review queue → export). Monorepo: `apps/api` (Fastify),
  `apps/web` (React + Vite SPA), `packages/*` (`core`, `config`, `db`, `file-processing`,
  `matching-engine`, `rule-engine`, `ai`, `workflow-engine`).
- **Production topology (locked):** Cloudflare Worker (static assets + `/api` proxy injecting
  `x-api-key`) + Render API + Render Postgres 16 + disk (R2 for multi-instance) + Render worker.
- **Auth (locked):** Auth.js (`@auth/core`) inside Fastify, Drizzle adapter, JWT sessions, magic link
  (Resend) + Google + GitHub. `AUTH_ENABLED=false` by default.

## 2. Locked design decisions (unchanged)

1. Tenant = organization; solo users get a personal org (`personalTenantName`).
2. Enforcement in code, not RLS; cross-tenant access returns 404.
3. Single shared-secret service key for Worker↔API trust; user identity from the session.
4. `AUTH_ENABLED=false` by default; auth/tenant behavior is additive and opt-in.
5. Memory driver bootstraps a tenant (`BOOTSTRAP_TENANT_NAME`) so the suite stays fixture-free.
6. Runs execute via a durable queue (in-memory or Postgres) drained by a dispatcher in-process or in
   the dedicated worker.
7. Object storage behind `FileStorage` (`S3FileStorage` for R2); local disk default.
8. Forward-only migrations, applied once at deploy; never from two processes at once.
9. Checkpoints per phase with verify-then-commit discipline.
10. **New:** quotas are opt-in (`QUOTAS_ENFORCED=false` default); plans are stored on the tenant and
    changed by the Stripe webhook (metadata contract) or an operator.
11. **New:** active workspace is remembered in a membership-validated `sp_workspace` cookie.

## 3. Phase-by-phase status

| Phase | Status | Commit | Notes |
|---|---|---|---|
| A — Hygiene | ✅ | `ddf1360` | prettier, uuid advisory removed, prod-smoke workflow |
| B — Auth.js backend | ✅ | `ddf1360` | users/accounts/sessions/tenants/memberships, migration 0006 |
| B UI — login/gating | ✅ | `549a2f8` | AuthGate, LoginPage, `authEnabled` on `/meta` |
| C — Tenant isolation | ✅ | `357ed73` | `tenantId` across entities, migration 0007, isolation suite |
| E — Delete/erasure | ✅ | `23f0c6d` | cascade deletion + routes + tests |
| G — S3/R2 storage | ✅ | `23f0c6d` | `S3FileStorage`, `STORAGE_DRIVER=s3` |
| H — Observability | ✅ | `e355f92` | `x-request-id`, structured request logs |
| I — Backups/DR docs | ✅ | `e355f92` | RPO/RTO, restore drill in `docs/deployment.md` |
| F — Durable queue + worker | ✅ | `0670b13` | jobs table + migration 0008, dispatcher, `--worker` |
| D — Workspace/member API | ✅ | `e858ea1` | 9 endpoints, `WorkspaceService`, invitations, migration 0009; owner protection hardened |
| D — Active workspace | ✅ | `4b0acaa` | `POST /workspaces/:id/activate`, `sp_workspace` cookie, migration-free |
| D — Workspace UI | ✅ | `6d1e06f` | switcher in AppShell, `/workspace` settings page (rename, members, invites, create dialog) |
| J — Restart/recovery + load | ✅ | `79460cb` | in-memory queue `recoverStale` parity, crash/restart tests, 10k-account/30k-event XLSX load guard |
| Fix — run detail refresh | ✅ | `0d40527` | run-scoped queries refresh when a run finishes |
| J — Playwright E2E | ✅ | `55faefe` | 3 browser tests incl. upload→run→review→export download |
| K — Plans/quotas/metering | ✅ | `b2ba3f8` | plans in core, `tenants.plan` + migration 0010, `QuotaService`, enforcement hooks, `GET /api/v1/usage`, UI card |
| K — Stripe billing | ✅ | `1417fdc` | signature-verified webhook, plan sync, `docs/billing.md` |
| K — Emails | ✅ | `678f39b` | `EmailSender` port, Resend sender + log fallback, invitation email, `docs/email.md` |
| K — Legal/compliance | ✅ | `cc5381d` | privacy/ToS/DPA templates, `docs/compliance.md` (residency + i18n decisions) |

## 4. What exists now (operator view)

- **Workspaces:** list/create/rename, member roles with owner protection, invitations (7-day TTL,
  emailed, auto-accepted at sign-in), workspace switcher, plan & usage card.
- **Runs:** durable queue with retries, stale-lock recovery, cancel flag, in-process or dedicated
  worker, reproducibility snapshots, review queue, Excel/CSV export with validation.
- **Plans:** free (3 members / 25 datasets / 100 runs per month), pro (25 / 500 / 5,000), enterprise
  (unlimited). `402 quota_exceeded` when enforced.
- **Billing:** `POST /api/v1/billing/webhook` verifies Stripe signatures, maps
  `metadata.tenantId` + `metadata.plan`, downgrades on subscription deletion. No SDK, no card data.
- **Compliance:** retention sweep, cascade deletion, tenant isolation tests, request tracing,
  documented sub-processors and residency decision, DSAR/closure runbook gap noted.
- **Testing:** 376 unit/integration tests + 3 Playwright journeys + smoke script + large-XLSX load
  guard.

## 5. Canonical verification commands (run from repo root)

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
npm run e2e                                          # starts API + web servers itself
npx wrangler deploy --dry-run --outdir .wrangler-dist # from apps/web; delete .wrangler-dist after
```

## 6. Environment variables (complete list)

`PORT` · `API_HOST`/`API_PORT` · `LOG_LEVEL`/`LOG_PRETTY` · `CORS_ORIGIN` · `REPOSITORY_DRIVER` ·
`DATABASE_URL` · `DB_AUTO_MIGRATE` · `DB_MIGRATIONS_DIR` · `ALLOW_INSECURE` · `API_KEY` ·
`RATE_LIMIT_*` · `TRUST_PROXY` · `JSON_BODY_LIMIT_MB` · `MAX_UPLOAD_MB` · `MAX_XLSX_*` ·
`DATASET_*` · `RETENTION_*` · `STORAGE_DRIVER` · `STORAGE_LOCAL_DIR` · `S3_*` · `AI_*` ·
`RUN_DISPATCH_IN_PROCESS` · `RUN_WORKER_POLL_MS` · `RUN_MAX_ATTEMPTS` · `RUN_STALE_LOCK_MS` ·
`RUN_RETRY_DELAY_MS` · `AUTH_ENABLED` · `AUTH_SECRET` · `AUTH_URL` · `AUTH_TRUST_HOST` ·
`AUTH_GOOGLE_ID/SECRET` · `AUTH_GITHUB_ID/SECRET` · `AUTH_RESEND_KEY` · `AUTH_EMAIL_FROM` ·
`BOOTSTRAP_TENANT_NAME` · `INBOX_*` · `QUOTAS_ENFORCED` · `BILLING_PROVIDER` ·
`STRIPE_WEBHOOK_SECRET`. Documented in `.env.example`.

## 7. Known gaps / future work

1. **Workspace deletion API + DSAR tooling** — run/dataset deletion exists; closing a whole workspace
   or account is a manual operator procedure (`docs/compliance.md`).
2. **Postgres queue tests** — stale-lock recovery is covered against the in-memory queue; the SQL
   implementation needs a real Postgres integration test (no DB in CI yet).
3. **Stripe self-serve checkout** — the webhook and metadata contract are ready; an in-app "Upgrade"
   button that creates Checkout Sessions is not built.
4. **Cookie consent** — only a session cookie is set; revisit if analytics are added.
5. **Pen test / SOC 2** — not started.
6. **i18n** — English-only by decision; see `docs/compliance.md` for revisit triggers.
7. **Render region** — deliberately not pinned in `render.yaml`; choose the region per deployment
   (recommended `frankfurt` for EU) and keep Postgres/API/worker/R2 consistent.

## 8. Gotchas for the next agent

- PowerShell 5.1 shell: no `grep`; use `Select-String` or the Read/Grep tools.
- Drizzle workflow: edit `packages/db/src/schema/tables.ts`, `npm run db:generate`, commit SQL +
  `meta/` snapshot. Never run migrations from two processes at once.
- Playwright: Vite binds `localhost` (IPv6) — the config polls `http://localhost:5173`, not
  `127.0.0.1`. First run needs `npx playwright install chromium`. E2E uses in-memory repositories;
  each run starts fresh.
- Run-detail data is fetched while a run is queued; `RunDetailPage` refetches review items,
  decisions and artifacts when `finishedAt` appears. Keep that behavior when touching the page.
- `POST /runs/:id/cancel` sets a queue flag; only same-process work is aborted.
- Retried runs reset partial results via `prepareForExecution`; review `postgres-run-queue.ts`
  `fail`/`recoverStale` semantics before touching retries.
- The Stripe webhook needs the raw body; its content-type parser is scoped to the billing plugin and
  the route is exempt from the session guard (signature is the authentication).
- Billing plan changes come only from `metadata.tenantId` + `metadata.plan` on Stripe events; keep
  the metadata contract in sync with `docs/billing.md`.
- Web auth is cookie-based, same-origin through the Worker; downloads use `apiDownloadUrl` (plain
  anchor), everything else via `apiGet/apiPost/apiPut/apiSend` with `credentials: 'include'`.
