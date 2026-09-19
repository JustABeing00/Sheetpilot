#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const baseUrl = (process.env.SMOKE_API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
const apiKey = process.env.SMOKE_API_KEY;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const samplesDir = path.join(repoRoot, 'samples', 'account-faults');

async function request(pathname, init = {}) {
  const headers = new Headers(init.headers);
  if (apiKey) {
    headers.set('x-api-key', apiKey);
  }
  const response = await fetch(`${baseUrl}${pathname}`, { ...init, headers });
  const text = await response.text();
  let body = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${pathname} failed with ${response.status}: ${text}`);
  }
  return body;
}

async function uploadFile(kind, fileName) {
  const content = await readFile(path.join(samplesDir, fileName));
  const form = new FormData();
  form.set('kind', kind);
  form.set('file', new Blob([content], { type: 'text/csv' }), fileName);
  return request('/api/v1/files', { method: 'POST', body: form });
}

async function uploadDataset(kind, fileName) {
  const content = await readFile(path.join(samplesDir, fileName));
  const form = new FormData();
  form.set('kind', kind);
  form.set('file', new Blob([content], { type: 'text/csv' }), fileName);
  return request('/api/v1/datasets', { method: 'POST', body: form });
}

async function waitForRun(runId, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await request(`/api/v1/runs/${runId}`);
    if (run.status === 'succeeded' || run.status === 'failed') {
      return run;
    }
    if (Date.now() > deadline) {
      throw new Error(`Run ${runId} did not finish within ${timeoutMs}ms (status: ${run.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function main() {
  const health = await request('/healthz');
  console.log(`health        : ${health.status} (${health.name} v${health.version})`);

  const meta = await request('/api/v1/meta');
  console.log(
    `runtime       : repo=${meta.repositoryDriver} storage=${meta.storageDriver} ai=${meta.aiProvider}`,
  );

  const primary = await uploadFile('primary', 'primary_accounts.csv');
  const events = await uploadFile('events', 'fault_events.csv');
  console.log(`uploaded      : primary ${primary.rowCount} rows, events ${events.rowCount} rows`);

  const run = await request('/api/v1/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowSlug: 'account-fault-triage',
      primaryFileId: primary.id,
      eventsFileId: events.id,
    }),
  });
  console.log(`run created   : ${run.id} (${run.status})`);

  const finished = await waitForRun(run.id);
  console.log(`run finished  : ${finished.status} in ${finished.steps.length} steps`);
  assert(finished.status === 'succeeded', `run status was ${finished.status}`);
  assert(finished.stats.accounts === 9, `expected 9 accounts, got ${finished.stats.accounts}`);
  assert(
    finished.stats.reviewAccounts === 7,
    `expected 7 accounts needing review, got ${finished.stats.reviewAccounts}`,
  );

  const artifacts = await request(`/api/v1/runs/${finished.id}/artifacts`);
  console.log(`artifacts     : ${artifacts.items.map((item) => item.kind).join(', ')}`);
  assert(artifacts.items.length === 3, `expected 3 artifacts, got ${artifacts.items.length}`);

  const outputCsv = artifacts.items.find((item) => item.kind === 'output_csv');
  const download = await fetch(`${baseUrl}${outputCsv.downloadUrl}`);
  assert(download.ok, `artifact download failed with ${download.status}`);
  const csv = await download.text();
  const rows = csv.trim().split('\n');
  assert(rows[0].includes('RootCause'), 'output CSV must contain the RootCause column');
  assert(csv.includes('Power Loss'), 'output CSV must contain the Power Loss classification');
  assert(csv.includes('REVIEW_REQUIRED'), 'output CSV must flag accounts needing review');

  const reviewItems = await request(`/api/v1/runs/${finished.id}/review-items`);
  const decisions = await request(`/api/v1/runs/${finished.id}/decisions`);
  console.log(
    `review queue  : ${reviewItems.items.length} items, decision log: ${decisions.total} records`,
  );

  const matchedDecision = decisions.items.find((item) => item.entityKey === '1001');
  assert(
    matchedDecision?.decisionSource === 'deterministic',
    'a matched rule must be recorded as a deterministic decision',
  );
  assert(
    matchedDecision?.ai?.status === 'not_consulted',
    'AI must not be consulted when the rules were sufficient',
  );
  const unmatchedDecision = decisions.items.find((item) => item.entityKey === '1004');
  assert(
    unmatchedDecision?.ai?.status === 'disabled',
    'with AI_PROVIDER=noop the AI layer must report itself disabled and send nothing',
  );
  assert(
    csv.includes('__DecisionSource'),
    'output CSV must carry the decision-source provenance column',
  );

  const resolved = await request(`/api/v1/review-items/${reviewItems.items[0].id}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'accepted', note: 'smoke test' }),
  });
  console.log(`review item   : ${resolved.entityKey} -> ${resolved.status}`);

  // Workflow configuration layer: datasets -> roles -> column mapping -> validation -> run.
  const primaryDataset = await uploadDataset('primary', 'primary_accounts.csv');
  const eventsDataset = await uploadDataset('events', 'fault_events.csv');
  console.log(
    `datasets      : primary ${primaryDataset.id} (${primaryDataset.columns.length} cols), events ${eventsDataset.id} (${eventsDataset.columns.length} cols)`,
  );

  const mappingPayload = {
    workflowSlug: 'account-fault-triage',
    assignments: [
      { role: 'primary', datasetId: primaryDataset.id, sheetName: null },
      { role: 'events', datasetId: eventsDataset.id, sheetName: null },
    ],
    mappings: [
      {
        role: 'primaryEntityKey',
        datasetId: primaryDataset.id,
        sheetName: null,
        column: 'Account Number',
        confirmed: false,
      },
      {
        role: 'eventsEntityKey',
        datasetId: eventsDataset.id,
        sheetName: null,
        column: 'Account Number',
        confirmed: false,
      },
      {
        role: 'eventsTimestamp',
        datasetId: eventsDataset.id,
        sheetName: null,
        column: 'Fault Date',
        confirmed: false,
      },
      {
        role: 'eventsDescription',
        datasetId: eventsDataset.id,
        sheetName: null,
        column: 'Fault Description',
        confirmed: false,
      },
    ],
    options: { reviewBelowConfidence: 0.8, includeSystemColumns: true },
  };

  const validation = await request('/api/v1/workflow-configurations/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(mappingPayload),
  });
  assert(
    validation.valid,
    `configuration must validate, issues: ${JSON.stringify(validation.issues)}`,
  );
  assert(
    validation.resolvedConfig?.primaryAccountColumn === 'Account Number',
    'validation must resolve the primary account column',
  );
  console.log(
    `validation    : valid, resolved primaryAccountColumn=${validation.resolvedConfig.primaryAccountColumn}`,
  );

  const configuration = await request('/api/v1/workflow-configurations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...mappingPayload,
      name: 'Smoke configuration',
      description: 'Created by scripts/smoke.mjs',
    }),
  });
  console.log(`configuration : ${configuration.id} (v${configuration.version})`);

  const configuredRun = await request('/api/v1/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ configurationId: configuration.id }),
  });
  const configuredFinished = await waitForRun(configuredRun.id);
  assert(
    configuredFinished.status === 'succeeded',
    `configuration run status was ${configuredFinished.status}`,
  );
  assert(
    configuredFinished.configurationId === configuration.id,
    'run must reference the configuration it was started from',
  );
  assert(
    configuredFinished.stats.accounts === 9,
    `expected 9 accounts from the configured run, got ${configuredFinished.stats.accounts}`,
  );
  console.log(
    `configured run: ${configuredFinished.status}, ${configuredFinished.stats.accounts} accounts, ${configuredFinished.reviewItemCount} review items`,
  );

  // Reproducibility: a run freezes the exact setup + rule versions it used, so later edits cannot
  // retroactively change a historical run.
  assert(configuredFinished.snapshot, 'a run must expose a frozen snapshot of its inputs');
  assert(
    configuredFinished.snapshot.configurationVersion === configuration.version,
    'the run snapshot must record the configuration version that was used',
  );
  assert(
    configuredFinished.snapshot.ruleCount >= 1,
    'the run snapshot must record the rule set that was used',
  );
  const snapshot = await request(`/api/v1/runs/${configuredFinished.id}/snapshot`);
  assert(snapshot.configuration, 'the full snapshot must include the frozen configuration');
  assert(snapshot.ruleSet, 'the full snapshot must include the frozen rule set');
  console.log(
    `snapshot      : config v${snapshot.configuration.version} (${snapshot.configuration.name}), rules v${snapshot.ruleSet.version} (${snapshot.ruleSet.rules.length} rules)`,
  );

  // Saved workflows: the returning-user dashboard, then "run again" on a new day's files.
  const savedList = await request('/api/v1/saved-workflows');
  const saved = savedList.items.find((item) => item.id === configuration.id);
  assert(saved, 'the saved configuration must appear as a saved workflow');
  assert(saved.lastRun, 'a saved workflow that has run must report its latest run');
  assert(
    saved.lastRun.recordsProcessed === 9,
    `saved workflow must report 9 records processed, got ${saved.lastRun.recordsProcessed}`,
  );
  assert(
    saved.lastRun.reviewItemCount === 7,
    `saved workflow must report 7 review items, got ${saved.lastRun.reviewItemCount}`,
  );
  assert(
    saved.lastRun.exportStatus === 'pending_review',
    `a run with open exceptions must report pending_review, got ${saved.lastRun.exportStatus}`,
  );
  console.log(
    `saved wf      : ${saved.name} (config v${saved.configurationVersion}), last run ${saved.lastRun.status}, ${saved.lastRun.recordsProcessed} records, ${saved.lastRun.openReviewItemCount} open`,
  );

  const day2Primary = await uploadDataset('primary', 'primary_accounts.csv');
  const day2Events = await uploadDataset('events', 'fault_events.csv');
  const day2Assignments = [
    { role: 'primary', datasetId: day2Primary.id, sheetName: null },
    { role: 'events', datasetId: day2Events.id, sheetName: null },
  ];
  const prepared = await request(`/api/v1/saved-workflows/${configuration.id}/prepare`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assignments: day2Assignments }),
  });
  assert(
    prepared.valid,
    `rebinding to new files must validate: ${JSON.stringify(prepared.issues)}`,
  );
  assert(
    prepared.plan.carried.length === 4 && prepared.plan.dropped.length === 0,
    'every remembered column mapping must be carried onto the new files',
  );
  assert(
    prepared.resolvedConfig?.primaryAccountColumn === 'Account Number',
    'the preview must resolve the mapped columns onto the new files',
  );

  const againRun = await request(`/api/v1/saved-workflows/${configuration.id}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assignments: day2Assignments, saveConfiguration: true }),
  });
  const againFinished = await waitForRun(againRun.id);
  assert(againFinished.status === 'succeeded', `run-again status was ${againFinished.status}`);
  assert(
    againFinished.snapshot?.configurationVersion === configuration.version + 1,
    'saving the re-pointed mapping must record the new configuration version on the run',
  );
  console.log(
    `run again     : carried ${prepared.plan.carried.length} mappings onto new files, saved config v${againFinished.snapshot.configurationVersion}`,
  );

  // Human review loop: filter presets with counts, an append-only audit trail and output regeneration.
  const reviewFilter = await request(
    `/api/v1/review-items?filter=needs_review&runId=${configuredFinished.id}`,
  );
  assert(
    reviewFilter.counts.needsReview >= reviewFilter.items.length,
    'review queue must report per-filter counts',
  );
  const overrideTarget = reviewFilter.items.find(
    (item) => Object.keys(item.suggestedValues).length > 0,
  );
  assert(overrideTarget, 'expected a review item with suggested values');

  const overridden = await request(`/api/v1/review-items/${overrideTarget.id}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'overridden',
      values: { RootCause: 'Smoke Override' },
      note: 'smoke override',
    }),
  });
  assert(overridden.state === 'OVERRIDDEN', `expected OVERRIDDEN, got ${overridden.state}`);

  const history = await request(`/api/v1/review-items/${overrideTarget.id}/history`);
  assert(history.items.length === 1, 'a resolution must append exactly one audit entry');
  assert(
    history.items[0].changedFields.includes('RootCause'),
    'the audit entry must record which fields the human changed',
  );

  const configuredArtifacts = await request(`/api/v1/runs/${configuredFinished.id}/artifacts`);
  const configuredCsvArtifact = configuredArtifacts.items.find(
    (item) => item.kind === 'output_csv',
  );
  const configuredCsv = await (
    await fetch(`${baseUrl}${configuredCsvArtifact.downloadUrl}`)
  ).text();
  assert(
    configuredCsv.includes('Smoke Override'),
    'the regenerated output must reflect the human override',
  );
  console.log(
    `review        : ${reviewFilter.items.length} needs-review, ${overrideTarget.entityKey} -> OVERRIDDEN, output regenerated, ${history.items.length} audit entry`,
  );

  // Output generation: a live export summary in front of validated Excel/CSV deliverables.
  const exportStatus = await request(`/api/v1/runs/${configuredFinished.id}/export`);
  assert(exportStatus.summary, 'export status must include a summary');
  assert(
    exportStatus.summary.totalRecords === 9,
    `export summary must count 9 records, got ${exportStatus.summary.totalRecords}`,
  );
  assert(
    exportStatus.summary.outputRows === 10,
    `export summary must count 10 output rows, got ${exportStatus.summary.outputRows}`,
  );
  assert(
    exportStatus.summary.reviewed >= 1,
    'a resolved review item must be counted as reviewed in the export summary',
  );
  assert(
    exportStatus.validation?.validated === true,
    'generated files must be validated before the run is marked successful',
  );
  assert(
    exportStatus.validation.rowCount === 10,
    `validated row count must match the output, got ${exportStatus.validation?.rowCount}`,
  );
  assert(
    exportStatus.artifacts.some((artifact) => artifact.kind === 'output_xlsx'),
    'Excel (.xlsx) is the primary export format and must be produced',
  );
  console.log(
    `export        : ${exportStatus.status}, ${exportStatus.summary.outputRows} rows validated, reviewed=${exportStatus.summary.reviewed}, unresolved=${exportStatus.summary.unresolved}`,
  );

  // Rule management: rules are data, validated before saving and versioned on save.
  const ruleSets = await request('/api/v1/rule-sets?workflowSlug=account-fault-triage');
  assert(ruleSets.items.length >= 1, 'expected at least one seeded rule set');
  const activeRuleSet = ruleSets.items.find((item) => item.active);
  assert(activeRuleSet, 'expected a seeded active rule set');
  console.log(
    `rule sets     : ${ruleSets.items.length} set(s), active=${activeRuleSet.slug} (${activeRuleSet.ruleCount} rules)`,
  );

  const sentinelRules = [
    {
      id: 'smoke-sentinel',
      name: 'Smoke sentinel',
      priority: 999,
      when: {
        mode: 'any',
        conditions: [{ field: 'description', operator: 'contains', value: 'no power' }],
      },
      then: [
        { field: 'RootCause', value: 'Smoke Sentinel' },
        { field: 'FaultCategory', value: 'Power' },
        { field: 'RecommendedAction', value: 'smoke' },
        { field: 'Priority', value: 'P1' },
      ],
      confidence: 0.9,
      explanationTemplate: 'Sentinel matched "{matchedTerm}".',
    },
  ];

  const ruleValidation = await request('/api/v1/rule-sets/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workflowSlug: 'account-fault-triage', rules: sentinelRules }),
  });
  assert(ruleValidation.valid, 'sentinel rule set must validate');

  const badRuleValidation = await request('/api/v1/rule-sets/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowSlug: 'account-fault-triage',
      rules: [
        {
          id: 'smoke-bad-regex',
          name: 'Bad regex',
          when: { conditions: [{ field: 'description', operator: 'matches_regex', value: '([' }] },
          then: [{ field: 'RootCause', value: 'x' }],
        },
      ],
    }),
  });
  assert(!badRuleValidation.valid, 'invalid regex must fail rule validation');
  console.log(
    `rule validate : valid=${ruleValidation.valid}, bad-regex valid=${badRuleValidation.valid}`,
  );

  const savedRuleSet = await request('/api/v1/rule-sets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowSlug: 'account-fault-triage',
      name: 'Smoke rule set',
      rules: sentinelRules,
    }),
  });
  assert(savedRuleSet.active, 'a newly saved rule set is active by default');
  console.log(`rule set saved: ${savedRuleSet.slug} v${savedRuleSet.version}`);

  console.log('\nSmoke test passed.');
  console.log(`Sample output (first 3 lines):\n${rows.slice(0, 3).join('\n')}`);
}

main().catch((error) => {
  console.error('\nSmoke test FAILED:', error.message);
  process.exitCode = 1;
});
