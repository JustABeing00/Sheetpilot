# Sample dataset: account fault triage

These are the canonical demo files for the `account-fault-triage` workflow and are used by the
automated tests (`apps/api/src/server.test.ts`, `packages/workflow-engine/.../account-faults.test.ts`).

`primary_accounts.csv` - primary records that need the four classification columns filled in
(`RootCause`, `FaultCategory`, `RecommendedAction`, `Priority`).

`fault_events.csv` - fault events. The same account can appear multiple times.

## Expected results

| Account | Scenario | Expected outcome |
| --- | --- | --- |
| 1001 | single fault, known signature | auto-approved, `Power Loss` |
| 1002 | sensor fault + later battery fault | review: `conflicting_fault_history` |
| 1003 | no fault events | review: `no_events` |
| 1004 | unknown wording | review: `no_rule_match` |
| 1005 | two consistent power faults | auto-approved (multiple faults are fine) |
| 1006 | generic fault wording | review: `low_confidence` |
| 1007 | two resets | review: `no_rule_match` (transient rule requires 1 fault) |
| 1008 | account appears twice in the primary file | review: `duplicate_primary_key` (critical) |
| 1009 | two faults share the latest timestamp | review: `ambiguous_latest_timestamp`, `conflicting_fault_history` |
| 9999 | fault event without a primary record | ignored, counted in `orphanEventAccounts` |
