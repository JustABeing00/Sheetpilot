# Data Processing Addendum (template)

> **Status: template.** This document is a starting point for legal review, not legal advice and not a
> published agreement. Replace every `[PLACEHOLDER]` and have counsel review before publishing.

This Data Processing Addendum ("DPA") forms part of the Terms of Service between [LEGAL ENTITY NAME]
("Processor") and the customer ("Controller") for the SheetPilot service.

## 1. Roles and scope

- The Controller determines the purposes and means of processing Customer Data (uploaded files,
  generated reports, configuration and review decisions).
- The Processor processes Customer Data only to provide, secure and support the Service, and only on
  documented instructions from the Controller (including configuration choices such as optional AI
  classification).
- Where the Controller is itself a processor, it warrants it has authority from its own controllers.

## 2. Processing details

| Item | Detail |
| --- | --- |
| Subject matter | Spreadsheet-workflow automation |
| Duration | For the term of the agreement |
| Nature and purpose | Ingest, match, classify, review, export, store and audit files |
| Data categories | Uploaded tabular data (may include personal data), account and workspace metadata |
| Data subjects | Controller's employees, customers or other individuals in the files |

## 3. Processor obligations

1. Process only on instructions; notify the Controller if an instruction appears unlawful.
2. Ensure personnel are bound by confidentiality.
3. Implement the technical and organizational measures in Annex A.
4. Assist with data-subject requests and DPIAs, taking into account the nature of processing.
5. Notify the Controller without undue delay (and within 72 hours where feasible) after becoming aware
   of a personal-data breach, with the information needed for the Controller's own notification.
6. Delete or return Customer Data at the end of the agreement, except where law requires retention.
7. Make available information necessary to demonstrate compliance and allow audits as agreed.

## 4. Sub-processors

The Controller grants general authorization for the sub-processors listed in `docs/compliance.md`. The
Processor will give notice of changes so the Controller can object, and imposes equivalent data
protection obligations on each sub-processor.

## 5. International transfers

Transfers outside the EEA/UK rely on the Standard Contractual Clauses (and UK Addendum where relevant),
supported by transfer impact assessments. The deployment region can be selected when the Service is
provisioned — see `docs/compliance.md`.

## 6. Security incidents

Security incidents are handled per `docs/deployment.md` (tracing via request ids, structured logs,
health/readiness probes, backups and restore drills). The Processor will cooperate with the Controller's
investigation and regulatory obligations.

## 7. Liability

Liability under this DPA is subject to the limitations in the Terms of Service.

## Annex A — Technical and organizational measures

- Encryption in transit (TLS) and at rest with the hosting/storage providers.
- Tenant isolation enforced in application code; every read/write is scoped to the caller's workspace.
- Role-based access (owner/admin/member); sessions signed and cookie-based; optional API-key trust
  layer between the edge proxy and the API.
- Rate limiting, request-size limits, spreadsheet decompression-bomb checks and formula-execution
  prevention.
- Retention controls and explicit delete endpoints (run, dataset, workspace cascade).
- Backups with documented RPO/RTO and a periodic restore drill (`docs/deployment.md`).
- Logging with request correlation; secrets supplied via environment variables, never in source.
