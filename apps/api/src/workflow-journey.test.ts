import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CapturingLogger,
  configurationValidationResponseSchema,
  datasetDtoSchema,
  decisionListResponseSchema,
  exportStatusResponseSchema,
  reviewItemDtoSchema,
  ruleSetDtoSchema,
  ruleSetListResponseSchema,
  runDtoSchema,
  runSnapshotDtoSchema,
  workflowConfigurationDtoSchema,
  type DatasetDto,
  type RunDto,
} from '@sheetpilot/core';
import { InMemoryFileStorage } from '@sheetpilot/file-processing';
import { loadConfig } from '@sheetpilot/config';
import { createContainer, type AppContainer } from './container.js';
import { buildServer } from './server.js';
import { SERVICE_SITES_CSV, SITE_FAULTS_CSV } from './fixtures.js';

const WORKFLOW = 'account-fault-triage';

function multipartPayload(
  parts: Array<{ name: string; value: string; filename?: string; contentType?: string }>,
): { payload: Buffer; contentType: string } {
  const boundary = '----sheetpilot-journey-boundary';
  const chunks: string[] = [];
  for (const part of parts) {
    chunks.push(`--${boundary}\r\n`);
    chunks.push(
      part.filename
        ? `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`
        : `Content-Disposition: form-data; name="${part.name}"\r\n`,
    );
    if (part.contentType) {
      chunks.push(`Content-Type: ${part.contentType}\r\n`);
    }
    chunks.push('\r\n');
    chunks.push(part.value);
    chunks.push('\r\n');
  }
  chunks.push(`--${boundary}--\r\n`);
  return {
    payload: Buffer.from(chunks.join(''), 'utf8'),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function uploadDataset(
  app: FastifyInstance,
  kind: string,
  filename: string,
  content: string,
): Promise<DatasetDto> {
  const { payload, contentType } = multipartPayload([
    { name: 'kind', value: kind },
    { name: 'file', filename, value: content, contentType: 'text/csv' },
  ]);
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/datasets',
    payload,
    headers: { 'content-type': contentType },
  });
  expect(response.statusCode).toBe(201);
  return datasetDtoSchema.parse(response.json());
}

async function waitForRun(app: FastifyInstance, runId: string): Promise<RunDto> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const run = runDtoSchema.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/runs/${runId}` })).json(),
    );
    if (run.status === 'succeeded' || run.status === 'failed') {
      return run;
    }
    if (Date.now() > deadline) {
      throw new Error(`Run ${runId} did not finish (last: ${run.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('end-to-end workflow journey', () => {
  let app: FastifyInstance;
  let container: AppContainer;
  let primary: DatasetDto;
  let events: DatasetDto;
  let configurationId: string;
  let run: RunDto;

  const configurationBody = () => ({
    workflowSlug: WORKFLOW,
    name: 'Field service sites',
    description: 'Monthly site fault triage',
    assignments: [
      { role: 'primary', datasetId: primary.id, sheetName: null },
      { role: 'events', datasetId: events.id, sheetName: null },
    ],
    mappings: [
      {
        role: 'primaryEntityKey',
        datasetId: primary.id,
        sheetName: null,
        column: 'Site Ref',
        confirmed: false,
      },
      ...['RootCause', 'FaultCategory', 'RecommendedAction', 'Priority'].map((column) => ({
        role: 'primaryOutputColumns',
        datasetId: primary.id,
        sheetName: null,
        column,
        confirmed: false,
      })),
      {
        role: 'eventsEntityKey',
        datasetId: events.id,
        sheetName: null,
        column: 'Site Ref',
        confirmed: false,
      },
      {
        role: 'eventsTimestamp',
        datasetId: events.id,
        sheetName: null,
        column: 'Reported At',
        confirmed: true,
      },
      {
        role: 'eventsDescription',
        datasetId: events.id,
        sheetName: null,
        column: 'Fault Notes',
        confirmed: false,
      },
    ],
    options: {},
  });

  beforeAll(async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      REPOSITORY_DRIVER: 'memory',
      LOG_LEVEL: 'silent',
    });
    container = await createContainer(config, CapturingLogger.create(), {
      storage: new InMemoryFileStorage(),
    });
    app = buildServer(container, { startedAt: Date.now() });
    await app.ready();

    primary = await uploadDataset(app, 'primary', 'service_sites.csv', SERVICE_SITES_CSV);
    events = await uploadDataset(app, 'events', 'site_faults.csv', SITE_FAULTS_CSV);
  });

  afterAll(async () => {
    await app.close();
    await container.close();
  });

  it('1. uploads both files and detects their structure', () => {
    expect(primary.originalName).toBe('service_sites.csv');
    expect(primary.columns.map((column) => column.name)).toContain('Site Ref');
    expect(primary.rowCount).toBe(8);
    expect(events.rowCount).toBe(10);
  });

  it('2. validates the column mapping before saving and previews the resolved config', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflow-configurations/validate',
      payload: configurationBody(),
    });
    expect(response.statusCode).toBe(200);
    const validation = configurationValidationResponseSchema.parse(response.json());
    expect(validation.valid).toBe(true);
    expect(validation.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
    expect(validation.resolvedConfig).toMatchObject({
      primaryAccountColumn: 'Site Ref',
      eventsAccountColumn: 'Site Ref',
      eventsTimestampColumn: 'Reported At',
      eventsDescriptionColumn: 'Fault Notes',
    });
  });

  it('3. saves a reusable, versioned configuration', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflow-configurations',
      payload: configurationBody(),
    });
    expect(response.statusCode).toBe(201);
    const configuration = workflowConfigurationDtoSchema.parse(response.json());
    expect(configuration.version).toBe(1);
    expect(configuration.workflowSlug).toBe(WORKFLOW);
    configurationId = configuration.id;
  });

  it('4. runs the saved configuration and freezes a reproducibility snapshot', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      payload: { configurationId, config: {} },
    });
    expect(created.statusCode).toBe(202);
    const queued = runDtoSchema.parse(created.json());
    run = await waitForRun(app, queued.id);
    expect(run.status).toBe('succeeded');
    expect(run.snapshot).not.toBeNull();
    expect(run.snapshot?.configurationId).toBe(configurationId);
    expect(run.snapshot?.configurationVersion).toBe(1);
    expect(run.snapshot?.configurationName).toBe('Field service sites');
    expect(run.snapshot?.ruleCount).toBe(7);

    const snapshot = runSnapshotDtoSchema.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/snapshot` })).json(),
    );
    expect(snapshot.configuration?.version).toBe(1);
    expect(snapshot.ruleSet?.rules).toHaveLength(7);
    expect(snapshot.ruleSet?.workflowSlug).toBe(WORKFLOW);
  });

  it('5. classifies every record and routes the unusual ones to review', async () => {
    const status = exportStatusResponseSchema.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/export` })).json(),
    );
    expect(status.status).toBe('pending_review');
    expect(status.summary.totalRecords).toBe(7);
    expect(status.summary.outputRows).toBe(8);
    expect(status.summary.autoResolved).toBe(2);
    expect(status.summary.unresolved).toBe(5);

    const decisions = decisionListResponseSchema.parse(
      (
        await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/decisions?limit=200` })
      ).json(),
    );
    const reasonsFor = (key: string) =>
      decisions.items.find((decision) => decision.entityKey === key)?.reviewReasons ?? [];

    expect(reasonsFor('00101')).toEqual([]);
    expect(reasonsFor('00102')).toContain('conflicting_fault_history');
    expect(reasonsFor('00103')).toContain('no_events');
    expect(reasonsFor('00104')).toContain('ambiguous_latest_timestamp');
    expect(reasonsFor('00105')).toContain('duplicate_primary_key');
    expect(reasonsFor('00106')).toContain('low_confidence');
    expect(reasonsFor('00107')).toEqual([]);
  });

  it('6. lets a person review every exception, then marks the report ready', async () => {
    const queue = (
      await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/review-items` })
    ).json<{ items: Array<{ id: string; entityKey: string }> }>();
    expect(queue.items).toHaveLength(5);

    for (const item of queue.items) {
      const isNoEvents = item.entityKey === '00103';
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/review-items/${item.id}/resolve`,
        payload: isNoEvents
          ? {
              action: 'overridden',
              values: {
                RootCause: 'Unspecified Fault',
                FaultCategory: 'Unknown',
                RecommendedAction: 'Manual triage required',
                Priority: 'P4',
              },
              note: 'No field reports; classify manually.',
            }
          : { action: 'accepted', note: 'Confirmed by operator.' },
      });
      expect(response.statusCode).toBe(200);
      const resolved = reviewItemDtoSchema.parse(response.json());
      expect(resolved.state).toBe(isNoEvents ? 'OVERRIDDEN' : 'APPROVED');
    }

    const status = exportStatusResponseSchema.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/export` })).json(),
    );
    expect(status.status).toBe('ready');
    expect(status.ready).toBe(true);
    expect(status.summary.unresolved).toBe(0);
    expect(status.summary.reviewed).toBe(5);
    expect(status.summary.overridden).toBe(1);
  });

  it('7. keeps a historical run unchanged when the setup and rules change later', async () => {
    const before = decisionListResponseSchema.parse(
      (
        await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/decisions?limit=200` })
      ).json(),
    );

    // Change the saved setup (version bump) ...
    const updated = await app.inject({
      method: 'PUT',
      url: `/api/v1/workflow-configurations/${configurationId}`,
      payload: { name: 'Field service sites (renamed)', description: 'Edited later' },
    });
    expect(updated.statusCode).toBe(200);
    expect(workflowConfigurationDtoSchema.parse(updated.json()).version).toBe(2);

    // ... and replace the active rule set with one that drops the generic fallback rule.
    const active = ruleSetListResponseSchema
      .parse(
        (
          await app.inject({ method: 'GET', url: `/api/v1/rule-sets?workflowSlug=${WORKFLOW}` })
        ).json(),
      )
      .items.find((ruleSet) => ruleSet.active);
    expect(active).toBeDefined();
    const activeDetail = ruleSetDtoSchema.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/rule-sets/${active!.id}` })).json(),
    );
    const replacement = await app.inject({
      method: 'POST',
      url: '/api/v1/rule-sets',
      payload: {
        workflowSlug: WORKFLOW,
        name: 'No generic fallback',
        rules: activeDetail.rules.filter((rule) => rule.id !== 'generic-fault'),
        activate: true,
      },
    });
    expect(replacement.statusCode).toBe(201);
    const newRuleSet = ruleSetDtoSchema.parse(replacement.json());
    expect(newRuleSet.id).not.toBe(active!.id);

    // The historical run must be untouched: identical decisions and the original frozen versions.
    const after = decisionListResponseSchema.parse(
      (
        await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/decisions?limit=200` })
      ).json(),
    );
    expect(after).toEqual(before);

    const snapshot = runSnapshotDtoSchema.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/snapshot` })).json(),
    );
    expect(snapshot.configuration?.version).toBe(1);
    expect(snapshot.configuration?.name).toBe('Field service sites');
    expect(snapshot.ruleSet?.id).toBe(active!.id);
    expect(snapshot.ruleSet?.rules.some((rule) => rule.id === 'generic-fault')).toBe(true);

    const refreshed = await waitForRun(app, run.id);
    expect(refreshed.snapshot?.configurationVersion).toBe(1);
    expect(refreshed.snapshot?.ruleSetId).toBe(active!.id);
  });

  it('8. applies the new rules only to new runs', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      payload: { configurationId, config: {} },
    });
    expect(created.statusCode).toBe(202);
    const nextRun = await waitForRun(app, runDtoSchema.parse(created.json()).id);
    expect(nextRun.status).toBe('succeeded');
    // The new run picks up the replacement rule set and the renamed setup.
    expect(nextRun.snapshot?.ruleSetId).not.toBe(run.snapshot?.ruleSetId);
    expect(nextRun.snapshot?.ruleCount).toBe(6);
    expect(nextRun.snapshot?.configurationName).toBe('Field service sites (renamed)');
    expect(nextRun.snapshot?.configurationVersion).toBe(2);

    const decisions = decisionListResponseSchema.parse(
      (
        await app.inject({ method: 'GET', url: `/api/v1/runs/${nextRun.id}/decisions?limit=200` })
      ).json(),
    );
    const generic = decisions.items.find((decision) => decision.entityKey === '00106');
    expect(generic?.reviewReasons).toContain('no_rule_match');
  });
});
