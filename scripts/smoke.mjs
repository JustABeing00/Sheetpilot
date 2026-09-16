#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const baseUrl = (process.env.SMOKE_API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const samplesDir = path.join(repoRoot, 'samples', 'account-faults');

async function request(pathname, init) {
  const response = await fetch(`${baseUrl}${pathname}`, init);
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
