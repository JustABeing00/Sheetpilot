# Sample dataset: field-service site faults

A second, deliberately different set of representative files, used by the end-to-end workflow journey
test (`apps/api/src/workflow-journey.test.ts`). They exercise the configuration-driven path (upload →
map columns → save setup → process → review → export) with the same `account-fault-triage` workflow.

`service_sites.csv` — the primary file: one row per site, with the four business columns left blank for
the workflow to fill (`RootCause`, `FaultCategory`, `RecommendedAction`, `Priority`). Site references are
zero-padded identifiers that must survive the round trip as text.

`site_faults.csv` — the fault/event file. The same site can appear many times; timestamps use a
`YYYY-MM-DD HH:mm:ss` format rather than ISO.

## Expected results

| Site | Scenario | Expected outcome |
| --- | --- | --- |
| 00101 | single power fault | auto-resolved, `Power Loss` |
| 00102 | sensor fault, then a later battery fault | review: `conflicting_fault_history` |
| 00103 | no faults at all | review: `no_events` |
| 00104 | two faults share the latest timestamp | review: `ambiguous_latest_timestamp` |
| 00105 | appears twice in the primary file; consistent power faults | review: `duplicate_primary_key` (critical), one output row per primary row |
| 00106 | only generic fault wording | review: `low_confidence` |
| 00107 | single reset | auto-resolved, `Transient Fault` |
| 00999 | a fault with no matching site | ignored, counted as an orphan event |

Totals with the default rules: 7 records, 8 output rows, 2 auto-resolved, 5 needing review, 1 orphan.
