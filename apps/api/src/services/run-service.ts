import {
  artifactSchema,
  decisionRecordSchema,
  isUnmatchedReviewReasons,
  newId,
  NotFoundError,
  outputRecordStateForReviewState,
  reviewItemSchema,
  reviewStateForItem,
  stepRunIds,
  stepRunSchema,
  summariseOutputRecords,
  workflowRunSchema,
  type Artifact,
  type ArtifactKind,
  type Clock,
  type ExportSummary,
  type FileStorage,
  type Logger,
  type Repositories,
  type TabularFormat,
  type WorkflowRun,
} from '@sheetpilot/core';
import {
  createTabularWriter,
  validateStoredTable,
  writeTableToStorage,
  type Row,
  type SummaryRow,
  type WriteSummary,
} from '@sheetpilot/file-processing';
import {
  createStepContext,
  type WorkflowRegistry,
  type WorkflowOutputs,
} from '@sheetpilot/workflow-engine';

export interface RunServiceDeps {
  repositories: Repositories;
  storage: FileStorage;
  registry: WorkflowRegistry;
  clock: Clock;
  logger: Logger;
}

export interface CreateRunInput {
  workflowSlug: string;
  primaryFileId: string;
  eventsFileId: string;
  configurationId?: string | null;
  config: Record<string, unknown>;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'Unknown error';
}

export class RunService {
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly deps: RunServiceDeps) {}

  async createRun(input: CreateRunInput): Promise<WorkflowRun> {
    const workflow = this.deps.registry.require(input.workflowSlug);
    await this.requireFile(input.primaryFileId, 'Primary');
    await this.requireFile(input.eventsFileId, 'Events');

    const run = workflowRunSchema.parse({
      id: newId(),
      workflowId: `wf-${workflow.slug}`,
      workflowSlug: workflow.slug,
      workflowVersion: workflow.version,
      status: 'queued',
      primaryFileId: input.primaryFileId,
      eventsFileId: input.eventsFileId,
      configurationId: input.configurationId ?? null,
      config: input.config,
      stats: {},
      error: null,
      createdAt: this.deps.clock.now(),
      startedAt: null,
      finishedAt: null,
    });

    const created = await this.deps.repositories.runs.create(run);
    this.deps.logger.info(
      { runId: created.id, workflowSlug: created.workflowSlug },
      'run queued for execution',
    );
    void this.execute(created.id);
    return created;
  }

  async execute(runId: string): Promise<void> {
    const run = await this.deps.repositories.runs.getById(runId);
    if (!run) {
      this.deps.logger.warn({ runId }, 'run not found for execution');
      return;
    }

    const workflow = this.deps.registry.get(run.workflowSlug);
    if (!workflow) {
      await this.fail(run, `Workflow '${run.workflowSlug}' is not registered`);
      return;
    }

    const startedAt = this.deps.clock.now();
    await this.deps.repositories.runs.update({ ...run, status: 'running', startedAt });

    const controller = new AbortController();
    this.controllers.set(runId, controller);

    const ctx = createStepContext({
      runId,
      workflowSlug: workflow.slug,
      workflowVersion: workflow.version,
      logger: this.deps.logger.child({ runId, workflowSlug: workflow.slug }),
      clock: this.deps.clock,
      signal: controller.signal,
    });

    const runLogger = this.deps.logger.child({ runId });

    try {
      const activeRuleSet = await this.deps.repositories.ruleSets.getActiveByWorkflowSlug(
        run.workflowSlug,
      );

      const execution = await workflow.execute(
        {
          primaryFileId: run.primaryFileId,
          eventsFileId: run.eventsFileId,
          config: run.config,
          ...(activeRuleSet ? { ruleSet: activeRuleSet } : {}),
        },
        ctx,
      );

      await this.persistSteps(runId, execution.steps);

      if (execution.status === 'failed' || !execution.state) {
        await this.fail(run, execution.error?.message ?? 'Workflow execution failed', startedAt);
        return;
      }

      const exportStats = await this.persistResults(run, execution.state);

      await this.deps.repositories.runs.update({
        ...run,
        status: 'succeeded',
        stats: { ...execution.state.stats, ...exportStats },
        error: null,
        startedAt,
        finishedAt: this.deps.clock.now(),
      });

      runLogger.info({ stats: execution.state.stats }, 'run completed');
    } catch (error) {
      await this.fail(run, describeError(error), startedAt);
    } finally {
      this.controllers.delete(runId);
    }
  }

  cancelRun(runId: string): boolean {
    const controller = this.controllers.get(runId);
    if (!controller) {
      return false;
    }
    controller.abort();
    return true;
  }

  private async requireFile(fileId: string, label: string): Promise<void> {
    const file = await this.deps.repositories.files.getById(fileId);
    if (!file) {
      throw new NotFoundError(`${label} file`, fileId);
    }
  }

  private async fail(run: WorkflowRun, message: string, startedAt?: Date): Promise<void> {
    await this.deps.repositories.runs.update({
      ...run,
      status: 'failed',
      error: message,
      startedAt: startedAt ?? run.startedAt,
      finishedAt: this.deps.clock.now(),
    });
    this.deps.logger.error({ runId: run.id, err: message }, 'run failed');
  }

  private async persistSteps(
    runId: string,
    steps: Array<{
      stepId: string;
      name: string;
      order: number;
      status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
      startedAt: Date | null;
      finishedAt: Date | null;
      durationMs: number | null;
      metrics: Record<string, number>;
      error: string | null;
    }>,
  ): Promise<void> {
    const records = steps.map((step) =>
      stepRunSchema.parse({
        id: stepRunIds.forRun(runId, step.stepId),
        runId,
        stepId: step.stepId,
        name: step.name,
        order: step.order,
        status: step.status,
        startedAt: step.startedAt,
        finishedAt: step.finishedAt,
        durationMs: step.durationMs,
        metrics: step.metrics,
        error: step.error,
      }),
    );

    await this.deps.repositories.steps.createMany(records);
  }

  private async persistResults(
    run: WorkflowRun,
    outputs: WorkflowOutputs,
  ): Promise<Record<string, number>> {
    const now = this.deps.clock.now();

    // The export summary is embedded as a leading worksheet so the deliverable explains itself.
    // Human decisions arrive after the run, so this is the as-run snapshot; the live export status
    // endpoint recomputes it from the review items.
    const reviewByEntity = new Map(outputs.reviewItems.map((item) => [item.entityKey, item]));
    const summaryRows = exportSummarySheet(
      summariseOutputRecords(
        outputs.decisionRecords.map((record) => {
          const item = reviewByEntity.get(record.entityKey);
          return {
            state: outputRecordStateForReviewState(
              item ? reviewStateForItem({ status: 'open', reason: item.reason }) : 'AUTO_RESOLVED',
            ),
            unmatched: isUnmatchedReviewReasons(record.reviewReasons),
          };
        }),
        outputs.outputRows.length,
      ),
    );

    const { validation: csvValidation } = await this.writeArtifact(
      run,
      'output_csv',
      'csv',
      `${run.id}-output.csv`,
      outputs,
      summaryRows,
    );
    const { validation: xlsxValidation } = await this.writeArtifact(
      run,
      'output_xlsx',
      'xlsx',
      `${run.id}-output.xlsx`,
      outputs,
      summaryRows,
    );

    const reviewRows: Row[] = outputs.reviewItems.map((item) => ({
      Entity: item.entityKey,
      Reason: item.reason,
      Severity: item.severity,
      Title: item.title,
      SuggestedRootCause: item.suggestedValues['RootCause'] ?? '',
      SuggestedPriority: item.suggestedValues['Priority'] ?? '',
      Detail: item.detail,
    }));
    await this.writeArtifact(run, 'review_queue_csv', 'csv', `${run.id}-review-queue.csv`, {
      ...outputs,
      outputColumns: [
        'Entity',
        'Reason',
        'Severity',
        'Title',
        'SuggestedRootCause',
        'SuggestedPriority',
        'Detail',
      ],
      outputRows: reviewRows,
    });

    await this.deps.repositories.decisions.createMany(
      outputs.decisionRecords.map((record) =>
        decisionRecordSchema.parse({ ...record, id: newId(), runId: run.id, createdAt: now }),
      ),
    );

    await this.deps.repositories.reviewItems.createMany(
      outputs.reviewItems.map((item) =>
        reviewItemSchema.parse({
          ...item,
          id: newId(),
          runId: run.id,
          status: 'open',
          resolution: null,
          createdAt: now,
          resolvedAt: null,
        }),
      ),
    );

    this.deps.logger
      .child({ runId: run.id })
      .debug(
        { outputRows: outputs.outputRows.length, reviewItems: outputs.reviewItems.length },
        'run results persisted',
      );

    return {
      exportValidated: 1,
      exportValidatedRows: xlsxValidation.rowCount,
      exportValidatedColumns: xlsxValidation.columns.length,
      exportOutputRows: csvValidation.rowCount,
    };
  }

  /**
   * Streams the table straight into storage and then re-reads it to prove the file is structurally
   * sound. A validation failure propagates and fails the run rather than publishing a broken
   * deliverable.
   */
  private async writeArtifact(
    run: WorkflowRun,
    kind: ArtifactKind,
    format: TabularFormat,
    fileName: string,
    table: { outputColumns: string[]; outputRows: Row[] },
    summary?: WriteSummary,
  ): Promise<{ artifact: Artifact; validation: { columns: string[]; rowCount: number } }> {
    const writer = createTabularWriter(format);
    const storageKey = `runs/${run.id}/${fileName}`;
    const sheetName = 'Output';

    const { stored } = await writeTableToStorage(
      writer,
      table.outputRows,
      { columns: table.outputColumns, sheetName, ...(summary ? { summary } : {}) },
      this.deps.storage,
      storageKey,
    );

    const validation = await validateStoredTable(this.deps.storage, storageKey, {
      format,
      expectedColumns: table.outputColumns,
      expectedRowCount: table.outputRows.length,
      sheetName,
    });

    const artifact = artifactSchema.parse({
      id: newId(),
      runId: run.id,
      kind,
      format,
      fileName,
      storageKey: stored.key,
      sizeBytes: stored.sizeBytes,
      createdAt: this.deps.clock.now(),
    });

    return { artifact: await this.deps.repositories.artifacts.create(artifact), validation };
  }
}

function exportSummarySheet(summary: ExportSummary): WriteSummary {
  const rows: SummaryRow[] = [
    { label: 'Total records', value: summary.totalRecords },
    { label: 'Output rows', value: summary.outputRows },
    { label: 'Automatically resolved', value: summary.autoResolved },
    { label: 'Human approved', value: summary.humanApproved },
    { label: 'Human overridden', value: summary.overridden },
    { label: 'Dismissed', value: summary.dismissed },
    { label: 'Needs review', value: summary.unresolved },
    { label: 'Processing errors', value: summary.errors },
    { label: 'Unmatched (no events / no rule)', value: summary.unmatched },
  ];
  return { rows };
}
