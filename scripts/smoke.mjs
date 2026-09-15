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

  const resolved = await request(`/api/v1/review-items/${reviewItems.items[0].id}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'accepted', note: 'smoke test' }),
  });
  console.log(`review item   : ${resolved.entityKey} -> ${resolved.status}`);

  console.log('\nSmoke test passed.');
  console.log(`Sample output (first 3 lines):\n${rows.slice(0, 3).join('\n')}`);
}

main().catch((error) => {
  console.error('\nSmoke test FAILED:', error.message);
  process.exitCode = 1;
});
