import {
  InvalidConfigurationError,
  rebindConfiguration,
  validateWorkflowConfiguration,
  type Clock,
  type DatasetProfile,
  type Logger,
  type PrepareSavedWorkflowRunResponse,
  type RebindPlan,
  type Repositories,
  type ResolvedRunConfig,
  type RunSavedWorkflowRequest,
  type SavedWorkflowDetail,
  type SavedWorkflowLastRun,
  type SavedWorkflowSummary,
  type WorkflowConfiguration,
  type WorkflowRun,
} from '@sheetpilot/core';
import type { RegisteredWorkflow, WorkflowRegistry } from '@sheetpilot/workflow-engine';
import type { ExportService, RunExportStatus } from './export-service.js';
import type { RunService } from './run-service.js';
import type { WorkflowConfigurationService } from './workflow-configuration-service.js';

export interface SavedWorkflowServiceDeps {
  repositories: Repositories;
  registry: WorkflowRegistry;
  clock: Clock;
  logger: Logger;
  configurationService: WorkflowConfigurationService;
  runService: RunService;
  exportService: ExportService;
}

/** How many recent runs the dashboard inspects to find each saved workflow's latest run. */
const RUN_SCAN_LIMIT = 1000;

/**
 * The returning-user layer. A saved workflow is a named, reusable, versioned setup; this service
 * derives the dashboard (latest-run status, records processed, review count, export availability),
 * previews how a saved mapping carries onto a new day's files without any side effects, and starts a
 * new run — optionally saving the re-pointed mapping as a new version. Nothing here is stored twice:
 * the aggregate is a projection of configurations + runs + rule sets + the live export status.
 */
export class SavedWorkflowService {
  constructor(private readonly deps: SavedWorkflowServiceDeps) {}

  async list(limit = 200): Promise<SavedWorkflowSummary[]> {
    const [configurations, runs] = await Promise.all([
      this.deps.repositories.workflowConfigurations.list({ limit: 500 }),
      this.deps.repositories.runs.list({ limit: RUN_SCAN_LIMIT }),
    ]);
    const runsByConfigurationId = runsByConfiguration(runs);

    const summaries: SavedWorkflowSummary[] = [];
    for (const configuration of configurations.slice(0, limit)) {
      summaries.push(
        await this.summarise(configuration, runsByConfigurationId.get(configuration.id) ?? []),
      );
    }
    return summaries;
  }

  async getById(id: string): Promise<SavedWorkflowDetail> {
    const configuration = await this.deps.configurationService.getById(id);
    const runs = await this.deps.repositories.runs.list({ limit: RUN_SCAN_LIMIT });
    const configurationRuns = runsByConfiguration(runs).get(id) ?? [];
    const summary = await this.summarise(configuration, configurationRuns);

    const ruleSet = await this.deps.repositories.ruleSets.getActiveByWorkflowSlug(
      configuration.workflowSlug,
    );

    return {
      ...summary,
      configuration,
      ruleSetDefinition: ruleSet,
      recentRuns: await this.describeRuns(configurationRuns.slice(0, 20)),
    };
  }

  /**
   * Read-only preview of attaching a new day's files to a saved workflow: carries the remembered
   * column mappings by name, reports anything that could not be carried and returns the validation a
   * user must clear before running. Never writes.
   */
  async prepare(
    id: string,
    assignments: RunSavedWorkflowRequest['assignments'],
  ): Promise<PrepareSavedWorkflowRunResponse> {
    const configuration = await this.deps.configurationService.getById(id);
    const workflow = this.deps.registry.require(configuration.workflowSlug);
    const datasets = await this.deps.configurationService.loadDatasets(assignments, []);
    const plan = rebindConfiguration({ configuration, requested: assignments, datasets });

    const validation = validateWorkflowConfiguration({
      definition: workflow.configuration,
      configuration: {
        assignments: plan.assignments,
        mappings: plan.mappings,
        options: configuration.options,
      },
      datasets,
    });

    return {
      valid: validation.valid,
      issues: validation.issues,
      resolvedConfig: this.previewResolvedConfig(workflow, configuration, plan, datasets),
      plan,
    };
  }

  /**
   * The "Run again" flow: carry the saved mapping onto today's files, optionally persist it as a new
   * version, then create a run. The run still freezes its own snapshot, so reproducibility is
   * unaffected by whether the re-pointed mapping is saved.
   */
  async run(id: string, input: RunSavedWorkflowRequest): Promise<WorkflowRun> {
    const configuration = await this.deps.configurationService.getById(id);
    const workflow = this.deps.registry.require(configuration.workflowSlug);
    const datasets = await this.deps.configurationService.loadDatasets(input.assignments, []);
    const plan = rebindConfiguration({ configuration, requested: input.assignments, datasets });

    const validation = validateWorkflowConfiguration({
      definition: workflow.configuration,
      configuration: {
        assignments: plan.assignments,
        mappings: plan.mappings,
        options: configuration.options,
      },
      datasets,
    });
    if (!validation.valid) {
      throw new InvalidConfigurationError(
        'Attach files whose columns match the saved workflow before starting a run.',
        { issues: validation.issues },
      );
    }

    const effective = input.saveConfiguration
      ? await this.deps.configurationService.update(id, {
          assignments: plan.assignments,
          mappings: plan.mappings,
          ...(input.name ? { name: input.name } : {}),
        })
      : withRebind(configuration, plan);

    const resolved = this.resolveRunInput(workflow, effective, datasets);
    const run = await this.deps.runService.createRun({
      workflowSlug: workflow.slug,
      primaryFileId: resolved.primaryFileId,
      eventsFileId: resolved.eventsFileId,
      configurationId: id,
      // Freeze exactly what the run used — for a one-off re-point this differs from the saved row.
      configurationOverride: effective,
      config: { ...resolved.config, ...input.config },
    });

    this.deps.logger.info(
      {
        runId: run.id,
        configurationId: id,
        saved: input.saveConfiguration,
        carriedMappings: plan.mappings.length,
      },
      'saved workflow run started',
    );
    return run;
  }

  private resolveRunInput(
    workflow: RegisteredWorkflow,
    configuration: WorkflowConfiguration,
    datasets: DatasetProfile[],
  ): { primaryFileId: string; eventsFileId: string; config: Record<string, unknown> } {
    if (!workflow.resolveRunInput) {
      throw new InvalidConfigurationError(
        `Workflow "${workflow.slug}" cannot be started from a saved workflow.`,
      );
    }
    return workflow.resolveRunInput({ configuration, datasets });
  }

  private previewResolvedConfig(
    workflow: RegisteredWorkflow,
    configuration: WorkflowConfiguration,
    plan: RebindPlan,
    datasets: DatasetProfile[],
  ): ResolvedRunConfig | null {
    try {
      return this.resolveRunInput(workflow, withRebind(configuration, plan), datasets)
        .config as ResolvedRunConfig;
    } catch {
      return null;
    }
  }

  private async summarise(
    configuration: WorkflowConfiguration,
    runs: WorkflowRun[],
  ): Promise<SavedWorkflowSummary> {
    const workflow = this.deps.registry.get(configuration.workflowSlug);
    const ruleSet = await this.deps.repositories.ruleSets.getActiveByWorkflowSlug(
      configuration.workflowSlug,
    );

    const lastRun = runs[0] ? await this.describeRun(runs[0]) : null;

    return {
      id: configuration.id,
      name: configuration.name,
      description: configuration.description,
      workflowSlug: configuration.workflowSlug,
      workflowName: workflow?.name ?? configuration.workflowSlug,
      workflowVersion: configuration.workflowVersion,
      configurationVersion: configuration.version,
      datasetCount: configuration.assignments.length,
      mappingCount: configuration.mappings.length,
      ruleSet: ruleSet
        ? {
            id: ruleSet.id,
            name: ruleSet.name,
            version: ruleSet.version,
            ruleCount: ruleSet.rules.length,
            active: ruleSet.active,
          }
        : null,
      lastRun,
      runCount: runs.length,
      createdAt: configuration.createdAt,
      updatedAt: configuration.updatedAt,
    };
  }

  private async describeRuns(runs: WorkflowRun[]): Promise<SavedWorkflowLastRun[]> {
    const described: SavedWorkflowLastRun[] = [];
    for (const run of runs) {
      described.push(await this.describeRun(run));
    }
    return described;
  }

  private async describeRun(run: WorkflowRun): Promise<SavedWorkflowLastRun> {
    const [reviewItemCount, openReviewItemCount, exportStatus] = await Promise.all([
      this.deps.repositories.reviewItems.countByRun(run.id),
      this.deps.repositories.reviewItems.countOpenByRun(run.id),
      this.safeExportStatus(run),
    ]);

    return {
      id: run.id,
      status: run.status,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
      recordsProcessed: exportStatus.summary.totalRecords,
      reviewItemCount,
      openReviewItemCount,
      exportStatus: exportStatus.status,
      exportReady: exportStatus.ready,
      exportMessage: exportStatus.message,
    };
  }

  /**
   * The export status reads the decision log; a run that failed before persisting anything still has a
   * meaningful status, but any unexpected read is degraded to `unavailable` rather than failing the
   * whole dashboard.
   */
  private async safeExportStatus(run: WorkflowRun): Promise<RunExportStatus> {
    try {
      return await this.deps.exportService.status(run.id);
    } catch (error) {
      this.deps.logger.warn(
        { runId: run.id, err: error instanceof Error ? error.message : String(error) },
        'could not derive export status for a saved workflow run',
      );
      return {
        runId: run.id,
        status: 'unavailable',
        ready: false,
        message: 'The report status could not be determined.',
        summary: {
          totalRecords: 0,
          outputRows: 0,
          autoResolved: 0,
          humanApproved: 0,
          overridden: 0,
          dismissed: 0,
          reviewed: 0,
          unresolved: 0,
          errors: 0,
          unmatched: 0,
          byState: {},
        },
        artifacts: [],
        validation: null,
      };
    }
  }
}

function runsByConfiguration(runs: WorkflowRun[]): Map<string, WorkflowRun[]> {
  const grouped = new Map<string, WorkflowRun[]>();
  for (const run of runs) {
    if (!run.configurationId) {
      continue;
    }
    const list = grouped.get(run.configurationId) ?? [];
    list.push(run);
    grouped.set(run.configurationId, list);
  }
  return grouped;
}

/**
 * A lightweight copy of a saved configuration with the re-pointed assignments/mappings. It is only used
 * to preview/execute a run when the user chose not to persist the new mapping.
 */
function withRebind(configuration: WorkflowConfiguration, plan: RebindPlan): WorkflowConfiguration {
  return {
    ...configuration,
    assignments: plan.assignments,
    mappings: plan.mappings,
  };
}
