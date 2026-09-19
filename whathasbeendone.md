# What Has Been Done — Session Handoff

> Purpose: let a new session resume with zero missing context.
> Written: 2026-09-19. Branch: `main`. Repo: SheetPilot (Excel workflow automation SaaS).

## 0. Current state (verified this session)

- **Working tree is NOT clean.** It contains the complete **Phase D backend** (workspace/member management API + React Query hooks), finished and tested but **not yet committed**.
- **HEAD:** `0670b13` — "Phase F: durable run queue, dispatcher and dedicated worker".
- **Verification (run 2026-09-19, all green):**
  - `npm run format:check` — clean (I ran `prettier --write` on the 5 drifted files; formatting-only change)
  - `npm run lint` — clean
  - `npm run typecheck` — clean (all workspaces, incl. `@sheetpilot/web`)
  - `npm test` — **41 files / 346 tests, all passing** (incl. `workspace.test.ts`: 7 tests)
  - `npm run build` — clean (API bundle + web `dist/`)
  - `npm audit --omit=dev` — **0 vulnerabilities**
- **Migrations:** `0000`–`0009` present in `packages/db/drizzle/` (`0009_smiling_raider.sql` creates `invitations`; uncommitted).
- A pasted "garbled edit" transcript about duplicate imports in `apps/web/src/api/hooks.ts` / `client.ts` was investigated and is a **false alarm**: `hooks.ts` has exactly one `from './client.js'` import (line 50, includes `apiSend`); `client.ts` has exactly one `apiSend` definition (line 115); no duplicates exist.

## 1. Project snapshot

- **Product:** SheetPilot — spreadsheet-workflow automation (upload → inspect → map → match/group → latest event → rules → AI assist → human review queue → export). Monorepo: `apps/api` (Fastify), `apps/web` (React + Vite SPA), `packages/*` (`core`, `config`, `db`, `file-processing`, `matching-engine`, `rule-engine`, `ai`, `workflow-engine`).
- **Chosen production topology (locked):** Cloudflare Workers frontend (static assets + `/api` proxy that injects `x-api-key` server-side) + Render API service + Render Postgres 16 + persistent disk, moving to R2 object storage for multi-instance. See `docs/deployment.md`, `render.yaml`, `Dockerfile`, `apps/web/wrangler.jsonc`, `apps/web/worker/index.js`.
- **Auth choice (locked): Auth.js (`@auth/core`) mounted inside Fastify** (no separate auth service), Drizzle adapter, JWT sessions, providers = email magic link (Resend) + Google + GitHub. Rejected: Clerk (vendor lock-in/cost), separate auth service (extra infra).

## 2. Locked design decisions (do not re-litigate without cause)

1. **Tenant = organization; solo users get a personal org** (`personalTenantName`). Tenancy unit question resolved this way.
2. **Enforcement in code, not RLS:** every read/list/update/delete is scoped by `tenantId`; cross-tenant access returns **404** (never 403, to avoid confirming existence).
3. **Single shared-secret service key** remains as Worker↔API transport trust (`x-api-key`); user identity comes from the Auth.js session. These are two separate layers.
4. **`AUTH_ENABLED=false` by default** so local dev and the whole test suite run unchanged; all new auth/tenant behavior is additive and opt-in.
5. **Memory driver defaults to a bootstrap tenant** (`BOOTSTRAP_TENANT_NAME`, default `SheetPilot`) so the 300+ pre-existing tests stay green without fixtures.
6. **Runs execute via a durable queue** (`RunQueue` port; in-memory impl for dev/tests, Postgres impl for prod) drained by a `RunDispatcher` that runs in-process on the API and/or as a dedicated `--worker` process. In-process dispatch + immediate `kick()` on enqueue preserves the old latency/tests.
7. **Object storage behind the existing `FileStorage` port** (`S3FileStorage`; R2-compatible). Local disk remains the default.
8. **Forward-only migrations**, applied once at deploy (`npm run db:migrate` / `--migrate` bundle flag / `DB_AUTO_MIGRATE=true` single-instance only). Never from two processes at once.
9. **Checkpoints per phase, verify-then-commit discipline** (`format:check` + `lint` + `typecheck` + `test` + `build` + `npm audit --omit=dev` before each commit).

## 3. Phase-by-phase status

| Phase | Status | Commit / location | Notes |
|---|---|---|---|
| A — Hygiene (prettier, uuid, auth-aware smoke, prod-smoke workflow) | ✅ Done | part of `ddf1360` | uuid advisory genuinely eliminated: root `overrides` + hoisted `exceljs` (npm's workspace-override bug worked around); prod audit 0 vulns |
| B — Auth.js backend (mount, adapter, sessions, tenancy domain/repos, guard) | ✅ Done | `ddf1360` | Migration `0006` (`users`, `accounts`, `sessions`, `verification_tokens`, `tenants`, `memberships`). `resolvedBy` no longer hardcoded null in the resolve path |
| B UI — login page, session gating, account controls | ✅ Done | `549a2f8` | `AuthGate`, `LoginPage`, `useSession`, `authEnabled`/`authProviders` on `/meta`, cookie-credentialed API client |
| C — Tenant isolation (model → repos → services → routes + suite) | ✅ Done | `357ed73` | `tenantId` on 11 tenant-scoped entities + migration `0007`; per-tenant rule sets; isolation test suite (`tenancy-isolation.test.ts`) |
| E — Delete/erasure | ✅ Done | `23f0c6d` | Repository deletes, `DeletionService` cascade, `DELETE` run/dataset routes, `deletion.test.ts` |
| G — S3/R2 object storage | ✅ Done | `23f0c6d` | `S3FileStorage` (AWS SDK v3), `STORAGE_DRIVER=s3`, R2 config |
| H — Observability | ✅ Done | `e355f92` | `x-request-id` tracing + structured request logs |
| I — Backups/DR/migrations docs | ✅ Done | `e355f92` + `docs/deployment.md` | RPO/RTO, restore drill, object versioning |
| F — Durable queue + worker | ✅ Done | `0670b13` (HEAD) | `jobs` table + migration `0008` (`FOR UPDATE SKIP LOCKED` claims), dispatcher, `--worker` entry, Render `sheetpilot-worker`, `run-queue.test.ts` |
| D — Tenant/member backend (workspaces API) | ✅ Done, **UNCOMMITTED** | working tree (see §4) | 9 new endpoints, `WorkspaceService`, `workspace.test.ts` (7 tests, passing), migration `0009` |
| D — Tenant UI (switcher, members/invites pages, settings) | ⬜ Next | — | Start here after committing §4. Hooks already exist (see §5) |
| J — E2E / load / restart testing | ⬜ Not started | — | Playwright E2E, load test on large XLSX, restart-behavior tests |
| K — Compliance / billing / i18n | ⬜ Not started | — | Privacy/ToS/DPA, Stripe/plans, email templates, data-residency decision |

## 4. Uncommitted work: exact contents (Phase D backend)

**New files (untracked):**
- `apps/api/src/http/routes/workspaces.ts` — 9 endpoints: `GET /api/v1/workspaces`, `POST /api/v1/workspaces`, `GET|PUT /api/v1/workspaces/current`, `PUT|DELETE /api/v1/workspaces/current/members/:membershipId`, `GET|POST /api/v1/workspaces/current/invitations`, `DELETE /api/v1/workspaces/current/invitations/:invitationId`. All require auth + manager role for admin actions; last-owner demotion/removal is refused.
- `apps/api/src/services/workspace-service.ts` — `listForUser`, `getForUser`, `create`, `rename`, `setMemberRole`, `removeMember`, invitations CRUD, `acceptPendingInvitations` (join-on-sign-in), `ensureWorkspace`.
- `apps/api/src/workspace.test.ts` — 7 tests, all passing.
- `packages/core/src/api/workspaces.ts` — zod contracts + DTOs (`workspaceDtoSchema`, `workspaceDetailDtoSchema`, member/invitation schemas, create/update/invite request schemas).
- `packages/core/src/ports/identity.ts` — `UserRepository`, `InvitationRepository` ports.
- `packages/db/drizzle/0009_smiling_raider.sql` + `meta/0009_snapshot.json` — `invitations` table (FK → `tenants`, cascade; indexes on `tenant_id`, `email`).

**Modified (tracked) files:**
- `apps/api/src/container.ts` — wires `workspaceService`; `authenticate()` now accepts pending invitations and ensures a workspace (personal tenant fallback via `TenancyService`).
- `apps/api/src/http/routes/index.ts` — registers `registerWorkspaceRoutes`.
- `apps/web/src/api/client.ts` — added `apiSend()` (PUT/DELETE, credentials included) for 204-style actions; `apiDownloadUrl` retained for artifact downloads.
- `apps/web/src/api/hooks.ts` — added `useWorkspaces`, `useCurrentWorkspace`, `useCreateWorkspace`, `useRenameWorkspace`, `useUpdateMemberRole`, `useRemoveMember`, `useInvitations`, `useInviteMember`, `useRevokeInvitation`; added `workspaces`/`currentWorkspace` query keys; imports extended for the new schemas (no duplicates — verified).
- `packages/core/src/domain/tenancy.ts` — added `invitationSchema`/`Invitation`.
- `packages/core/src/errors.ts` — added `ForbiddenError` (403).
- `packages/core/src/index.ts` — exports `api/workspaces.js`, `ports/identity.js`.
- `packages/core/src/ports/repositories.ts` — `Repositories` gains `users` + `invitations`.
- `packages/db/src/schema/tables.ts` — `invitations` table definition.
- `packages/db/src/repositories/memory/index.ts` — `users` (no-op stubs: Auth.js needs Postgres; memory mode has no identities) + `invitations` (full in-memory impl).
- `packages/db/src/repositories/postgres/index.ts` — `users` + `invitations` implementations.
- `packages/db/drizzle/meta/_journal.json` — 0009 journal entry.

**How to land it:** review the diff (`git diff` + new files), run the §6 commands, then `git add -A && git commit -m "Phase D backend: workspace/member management API"`.

## 5. What's next (ordered checklist for the new session)

1. **Commit §4** after a final review + full verification (§6). Suggested message: `"Phase D backend: workspace/member management API"`.
2. **Phase D UI:** org/workspace switcher in `AppShell`, workspace settings page (rename, members table with role editor + remove, invitations list with invite form + revoke, create-workspace dialog) wired to the §5 hooks; show active workspace name; keep working with auth disabled (hooks take `enabled`, guard with `authEnabled` from `/meta`).
3. **Phase J:** Playwright signup→run→review→export E2E; large-XLSX load test; restart/resume behavior test for dispatcher + worker.
4. **Phase K:** legal/compliance docs, Stripe plans + metering hooks, quota enforcement per tenant, data-residency decision.
5. **Deploy verification:** Render Blueprint (`render.yaml`) + Cloudflare Worker (`wrangler.jsonc` + `apps/web/worker/index.js`); health `/healthz`, readiness `/readyz`; worker proxies `/api/*` and injects the key.

## 6. Canonical verification commands (run from repo root)

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
npx wrangler deploy --dry-run --outdir .wrangler-dist   # from apps/web; then delete .wrangler-dist
```

Current known-good results: format clean, lint clean, typecheck clean (all workspaces), **41 files / 346 tests passing**, build clean, prod audit **0 vulnerabilities**.

## 7. Environment variables added across phases

`PORT` · `DB_AUTO_MIGRATE` · `DB_MIGRATIONS_DIR` · `ALLOW_INSECURE` · `AUTH_ENABLED` · `AUTH_SECRET` · `AUTH_URL` · `AUTH_TRUST_HOST` · `AUTH_GOOGLE_ID/SECRET` · `AUTH_GITHUB_ID/SECRET` · `AUTH_RESEND_KEY` · `AUTH_EMAIL_FROM` · `BOOTSTRAP_TENANT_NAME` · `STORAGE_DRIVER` (`local`|`s3`) · `S3_BUCKET/REGION/ENDPOINT/ACCESS_KEY_ID/SECRET_ACCESS_KEY/FORCE_PATH_STYLE` · `RUN_DISPATCH_IN_PROCESS` · `RUN_WORKER_POLL_MS` · `RUN_MAX_ATTEMPTS` · `RUN_STALE_LOCK_MS` · `RUN_RETRY_DELAY_MS`. Documented in `.env.example` and `docs/deployment.md`.

## 8. Gotchas for the next agent

- PowerShell 5.1 shell: no `grep` — use `Select-String` or the Read/Grep tools.
- Drizzle migration workflow: edit `packages/db/src/schema/tables.ts`, then `npm run db:generate`; check the SQL + `meta/` snapshot into git. Never run migrations from two processes at once.
- `POST /runs/:id/cancel` sets a queue flag; the in-process controller aborts only same-process work.
- Retried runs are reset via `prepareForExecution` (partial results deleted) to avoid duplicates; review the queue `fail`/`recoverStale` semantics in `postgres-run-queue.ts` before touching retries.
- Web auth is cookie-based, same-origin through the Worker; downloads use `apiDownloadUrl` (plain anchor), everything else via `apiGet/apiPost/apiPut/apiSend` with `credentials: 'include'`.
- Do not re-add a second `from './client.js'` import in `hooks.ts` or a second `apiSend` in `client.ts` — both already exist exactly once (verified 2026-09-19).
