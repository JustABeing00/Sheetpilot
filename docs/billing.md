# Plans, quotas and billing

SheetPilot meters each workspace (tenant) against a commercial plan. Enforcement is **off by
default** (`QUOTAS_ENFORCED=false`) so self-hosted, single-tenant installs have no artificial
limits. Hosted deployments turn it on and let Stripe keep plans in sync.

## Plans

Plans are defined in code (`packages/core/src/domain/plans.ts`); a tenant stores only its plan id
(`tenants.plan`, migration `0010`). New workspaces always start on `free`.

| Plan       | Members | Datasets | Runs per month |
| ---------- | ------- | -------- | -------------- |
| `free`     | 3       | 25       | 100            |
| `pro`      | 25      | 500      | 5,000          |
| `enterprise` | unlimited | unlimited | unlimited   |

`null` in the limits object means unlimited.

## Enforcement

When `QUOTAS_ENFORCED=true`:

- creating an **invitation** checks the member limit (seats are consumed on invite, not on accept),
- uploading a **dataset** checks the dataset limit before the file is stored,
- creating a **run** checks the calendar-month run limit (UTC month).

A request over the limit fails with `402 quota_exceeded` and details
`{ plan, metric, limit, usage }`. All checks are tenant-scoped; one workspace can never consume
another's quota.

## Usage reporting

`GET /api/v1/usage` (requires a signed-in member) returns the plan, its limits, and live usage:

```json
{
  "plan": "free",
  "planName": "Free",
  "limits": { "maxMembers": 3, "maxDatasets": 25, "maxRunsPerMonth": 100 },
  "usage": { "members": 1, "datasets": 4, "runsThisMonth": 12 },
  "periodStart": "2026-09-01T00:00:00.000Z"
}
```

The workspace settings page renders this as a "Plan & usage" card.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `QUOTAS_ENFORCED` | `false` | Turn on the checks above. |
| `BILLING_PROVIDER` | `none` | `stripe` enables the webhook route. |
| `STRIPE_WEBHOOK_SECRET` | — | Required with `BILLING_PROVIDER=stripe` (`whsec_...`). |

## Stripe integration

There is deliberately **no Stripe SDK dependency**. The API exposes one webhook endpoint that
verifies the event signature and applies the plan from event metadata:

```
POST /api/v1/billing/webhook
```

### One-time setup

1. Create one Stripe Price per paid plan (e.g. "SheetPilot Pro monthly").
2. Configure a webhook endpoint pointing at `https://<your-origin>/api/v1/billing/webhook`
   (through the Cloudflare Worker, which injects the API key) with these events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
3. Copy the endpoint's signing secret into `STRIPE_WEBHOOK_SECRET` and set
   `BILLING_PROVIDER=stripe`, `QUOTAS_ENFORCED=true`.
4. Create Checkout Sessions from your billing surface (Stripe dashboard payment link, a future
   in-app checkout, or your own script) with:
   - `metadata.tenantId` = the workspace id,
   - `metadata.plan` = `pro` or `enterprise`.

   Subscription events carry the same metadata forward, so the webhook can map them back.

### Behaviour

- `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`
  → set the tenant's plan from `metadata.plan` (must be a known plan id).
- `customer.subscription.deleted` → reset the tenant to `free`.
- Anything else → acknowledged with `202` and ignored.
- Invalid signature, stale timestamp (over 5 minutes), malformed JSON, unknown tenant, or unknown
  plan → the event is rejected or ignored; no plan change is ever applied without a valid signature.

The endpoint is exempt from the session guard (Stripe cannot present a session cookie) but still sits
behind the Worker's API-key trust layer in production. It never stores payment details — only the
resulting plan on the tenant row.

### Local testing

```powershell
stripe listen --forward-to http://127.0.0.1:4000/api/v1/billing/webhook
stripe trigger checkout.session.completed
```

Set `STRIPE_WEBHOOK_SECRET` to the secret printed by `stripe listen`. Triggered events do not carry
`tenantId` metadata by default, so use `stripe trigger` with a fixture or send a signed curl payload
to exercise the plan change.

## Out of scope (for now)

Invoicing, proration, tax handling, per-seat quantities and dunning are handled in the Stripe
dashboard; the application only cares about the resulting plan. A self-serve upgrade button can be
added later by creating a Checkout Session with the metadata contract above.
