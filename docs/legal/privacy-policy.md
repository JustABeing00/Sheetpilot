# Privacy Policy (template)

> **Status: template.** This document is a starting point for legal review, not legal advice and not a
> published policy. Replace every `[PLACEHOLDER]` and have counsel review before publishing.

**Last updated:** [DATE]

## 1. Who we are

[LEGAL ENTITY NAME] ("SheetPilot", "we") operates the SheetPilot spreadsheet-workflow service at
[DOMAIN]. Contact: [PRIVACY CONTACT EMAIL]. Postal address: [ADDRESS].

## 2. Data we process

| Category | Examples | Why |
| --- | --- | --- |
| Account data | Name, email address, profile image, OAuth provider id | Sign-in, workspace membership |
| Workspace content | Uploaded spreadsheets and CSV files, generated reports, review decisions, saved configurations and rules | Provide the workflow automation service |
| Usage and metering | Workspace id, plan, counts of members/datasets/runs, timestamps | Quotas, billing, capacity planning |
| Operational logs | Request ids, IP address, route, status code, latency, error details | Security, debugging, abuse prevention |
| Billing records | Plan, Stripe customer/subscription identifiers (payment details are held by Stripe) | Billing and accounting |

Uploaded files can contain personal data of third parties. The customer (workspace owner) is the
controller of that content; we process it as a processor — see the Data Processing Addendum.

## 3. Legal bases (GDPR)

- **Contract** — account data, workspace content, billing records (Art. 6(1)(b)).
- **Legitimate interests** — security, abuse prevention, service reliability, aggregated usage
  (Art. 6(1)(f)).
- **Legal obligation** — tax and accounting records (Art. 6(1)(c)).
- **Consent** — where required (e.g. optional product emails); withdrawable at any time.

## 4. Sub-processors

| Provider | Purpose | Location |
| --- | --- | --- |
| Render | API hosting, Postgres database, persistent disk | Region chosen per deployment |
| Cloudflare | Static frontend + API proxy, R2 object storage | Global edge; R2 location per bucket |
| Resend | Transactional email (magic links, invitations) | United States |
| Stripe | Payment processing | United States |
| [AI PROVIDER] | Optional AI classification (disabled unless configured) | [REGION] |

The current list is maintained in `docs/compliance.md`.

## 5. Retention

- Uploaded files and generated artifacts: retained until the workspace deletes the run/dataset or the
  account is closed; an optional retention sweep can expire uploads automatically
  (`RETENTION_UPLOAD_TTL_HOURS`).
- Operational logs: [RETENTION PERIOD, e.g. 30 days].
- Billing records: as required by tax law.
- Deleted workspaces: content is deleted; encrypted backups roll off within [BACKUP WINDOW].

## 6. International transfers

Where data leaves the EEA/UK we rely on the European Commission Standard Contractual Clauses and, where
available, the UK Addendum, plus transfer impact assessments with each sub-processor.

## 7. Your rights

Access, rectification, erasure, restriction, portability, objection, and the right to lodge a
complaint with your supervisory authority. Contact [PRIVACY CONTACT EMAIL]. We respond within the
statutory period (normally 30 days).

## 8. Security

Encryption in transit (TLS), encryption at rest with the hosting and storage providers, tenant-scoped
access enforced in the application, role-based workspace permissions, single sign-on with Google and
GitHub or email magic links, rate limiting and request tracing. See `docs/compliance.md`.

## 9. Children

The service is not directed at children and we do not knowingly collect their data.

## 10. Changes

We will post updates at [DOMAIN]/privacy and, for material changes, notify workspace owners by email.
