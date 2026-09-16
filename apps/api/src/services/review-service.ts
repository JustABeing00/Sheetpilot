import {
  ConflictError,
  newId,
  NotFoundError,
  reviewAutomationFromEvidence,
  reviewItemSchema,
  reviewResolutionLogSchema,
  reviewStateForItem,
  changedFields,
  type Artifact,
  type Clock,
  type FileStorage,
  type Logger,
  type OutputValue,
  type Repositories,
  type ResolveReviewItemRequest,
  type ReviewAutomation,
  type ReviewItem,
  type ReviewResolutionLog,
  type WorkflowRun,
} from '@sheetpilot/core';
import {
  createTabularReader,
  createTabularWriter,
  normalizeKey,
  readAllRows,
  writeTableToBuffer,
  type Row,
} from '@sheetpilot/file-processing';

export interface ReviewServiceDeps {
  repositories: Repositories;
  storage: FileStorage;
  clock: Clock;
  logger: Logger;
}

export class ReviewService {
  constructor(private readonly deps: ReviewServiceDeps) {}

  /** Append-only history of what a human decided for an item and how it differed from automation. */
  async history(itemId: string): Promise<ReviewResolutionLog[]> {
    const item = await this.deps.repositories.reviewItems.getById(itemId);
    if (!item) {
      throw new NotFoundError('Review item', itemId);
    }
    return this.deps.repositories.reviewResolutions.listByItem(itemId);
  }

  async resolve(id: string, input: ResolveReviewItemRequest): Promise<ReviewItem> {
    const item = await this.deps.repositories.reviewItems.getById(id);
    if (!item) {
      throw new NotFoundError('Review item', id);
    }
    if (item.status !== 'open') {
      throw new ConflictError(`Review item '${id}' has already been resolved`);
    }

    const run = await this.deps.repositories.runs.getById(item.runId);
    const decision = (
      await this.deps.repositories.decisions.listByRun(item.runId, { limit: 1000 })
    ).find((record) => record.entityKey === item.entityKey);

    // The final values automation produced (the decision record is the source of truth; the item's
    // suggested values are the fallback for older rows).
    const automationValues: Record<string, OutputValue> =
      decision?.outputValues ?? item.suggestedValues;
    const automation: ReviewAutomation = {
      ...reviewAutomationFromEvidence(
        decision
          ? {
              ...item.evidence,
              confidence: decision.confidence,
              decisionSource: decision.decisionSource,
            }
          : item.evidence,
        automationValues,
      ),
      values: automationValues,
    };

    // Accepting an item without explicit values keeps the automation's result explicitly (rather
    // than recording an empty resolution).
    const appliedValues: Record<string, OutputValue> =
      input.action === 'dismissed'
        ? {}
        : input.action === 'accepted' && Object.keys(input.values).length === 0
          ? automationValues
          : input.values;

    const status =
      input.action === 'accepted'
        ? 'resolved_accepted'
        : input.action === 'overridden'
          ? 'resolved_overridden'
          : 'dismissed';

    const now = this.deps.clock.now();
    const updated = reviewItemSchema.parse({
      ...item,
      status,
      resolution: {
        action: input.action,
        values: appliedValues,
        note: input.note,
        resolvedBy: null,
      },
      resolvedAt: now,
    });

    const saved = await this.deps.repositories.reviewItems.update(updated);
    await this.deps.repositories.reviewResolutions.create(
      reviewResolutionLogSchema.parse({
        id: newId(),
        reviewItemId: item.id,
        runId: item.runId,
        entityKey: item.entityKey,
        action: input.action,
        previousStatus: item.status,
        resultingState: reviewStateForItem(saved),
        automation,
        suggestedValues: item.suggestedValues,
        appliedValues,
        changedFields: changedFields(automationValues, appliedValues),
        note: input.note,
        resolvedBy: null,
        createdAt: now,
      }),
    );

    if (run && Object.keys(appliedValues).length > 0 && input.action !== 'dismissed') {
      await this.applyToArtifacts(run, item.entityKey, appliedValues, reviewStateForItem(saved));
    }

    this.deps.logger.info(
      {
        reviewItemId: id,
        runId: item.runId,
        action: input.action,
        changedFields: changedFields(automationValues, appliedValues),
      },
      'review item resolved',
    );
    return saved;
  }

  /**
   * Rewrites the generated output so the exported file matches what the human confirmed. The
   * original uploads and the review queue artifact are untouched.
   */
  private async applyToArtifacts(
    run: WorkflowRun,
    entityKey: string,
    values: Record<string, OutputValue>,
    stateLabel: string,
  ): Promise<void> {
    const accountColumn =
      typeof run.config['primaryAccountColumn'] === 'string'
        ? run.config['primaryAccountColumn']
        : null;
    if (!accountColumn) {
      this.deps.logger.warn(
        { runId: run.id },
        'review resolution kept, but the run has no primary account column to patch output artifacts',
      );
      return;
    }

    const artifacts = await this.deps.repositories.artifacts.listByRun(run.id);
    const outputs = artifacts.filter(
      (artifact) => artifact.kind === 'output_csv' || artifact.kind === 'output_xlsx',
    );

    for (const artifact of outputs) {
      await this.patchArtifact(artifact, accountColumn, entityKey, values, stateLabel);
    }
  }

  private async patchArtifact(
    artifact: Artifact,
    accountColumn: string,
    entityKey: string,
    values: Record<string, OutputValue>,
    stateLabel: string,
  ): Promise<void> {
    const stream = await this.deps.storage.getStream(artifact.storageKey);
    const table = await readAllRows(createTabularReader(artifact.format), stream);

    let patched = false;
    const rows: Row[] = table.rows.map((row) => {
      if (normalizeKey(row[accountColumn]) !== entityKey) {
        return row;
      }
      patched = true;
      const next: Row = { ...row };
      for (const [field, value] of Object.entries(values)) {
        next[field] = value;
      }
      if ('__ReviewStatus' in next) {
        next['__ReviewStatus'] = stateLabel === 'APPROVED' ? 'APPROVED' : 'OVERRIDDEN';
      }
      return next;
    });

    if (!patched) {
      return;
    }

    const writer = createTabularWriter(artifact.format);
    const { buffer } = await writeTableToBuffer(writer, rows, {
      columns: table.columns,
      sheetName: 'Output',
    });
    const stored = await this.deps.storage.put(artifact.storageKey, buffer);
    await this.deps.repositories.artifacts.update({
      ...artifact,
      sizeBytes: stored.sizeBytes,
    });
  }
}
