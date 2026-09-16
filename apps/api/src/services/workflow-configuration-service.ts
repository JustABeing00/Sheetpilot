import {
  InvalidConfigurationError,
  newId,
  NotFoundError,
  toWorkflowConfigurationSummary,
  validateWorkflowConfiguration,
  workflowConfigurationSchema,
  type ConfigurationValidation,
  type ConfigurationOptionValue,
  type CreateWorkflowConfigurationRequest,
  type DatasetAssignment,
  type DatasetProfile,
  type Logger,
  type Repositories,
  type ResolvedRunConfig,
  type UpdateWorkflowConfigurationRequest,
  type ValidateWorkflowConfigurationRequest,
  type WorkflowConfiguration,
  type WorkflowConfigurationSummary,
  type Clock,
} from '@sheetpilot/core';
import type { RegisteredWorkflow, WorkflowRegistry } from '@sheetpilot/workflow-engine';

export interface WorkflowConfigurationServiceDeps {
  repositories: Repositories;
  registry: WorkflowRegistry;
  clock: Clock;
  logger: Logger;
}

export interface ConfigurationValidationResult extends ConfigurationValidation {
  resolvedConfig: ResolvedRunConfig | null;
}

export interface BuiltRunInput {
  workflowSlug: string;
  primaryFileId: string;
  eventsFileId: string;
  configurationId: string;
  config: Record<string, unknown>;
}

/**
 * Application service for the workflow configuration layer: resolve the workflow's declared roles, load
 * the referenced dataset profiles, validate the mapping and persist/version the configuration. The actual
 * compatibility rules live in `@sheetpilot/core` (`validateWorkflowConfiguration`) so the same logic can
 * be exercised without the API.
 */
export class WorkflowConfigurationService {
  constructor(private readonly deps: WorkflowConfigurationServiceDeps) {}

  async list(
    workflowSlug?: string,
    limit = 100,
    offset = 0,
  ): Promise<WorkflowConfigurationSummary[]> {
    const configurations = await this.deps.repositories.workflowConfigurations.list({
      workflowSlug,
      limit,
      offset,
    });
    return configurations.map(toWorkflowConfigurationSummary);
  }

  async getById(id: string): Promise<WorkflowConfiguration> {
    const configuration = await this.deps.repositories.workflowConfigurations.getById(id);
    if (!configuration) {
      throw new NotFoundError('Workflow configuration', id);
    }
    return configuration;
  }

  async create(input: CreateWorkflowConfigurationRequest): Promise<WorkflowConfiguration> {
    const workflow = this.deps.registry.require(input.workflowSlug);
    const datasets = await this.loadDatasets(input.assignments, input.mappings);
    const validation = this.validateMapping(workflow, input, datasets);
    this.assertValid(validation);

    const now = this.deps.clock.now();
    const configuration = workflowConfigurationSchema.parse({
      id: newId(),
      workflowSlug: workflow.slug,
      workflowVersion: workflow.version,
      name: input.name,
      description: input.description,
      version: 1,
      assignments: input.assignments,
      mappings: input.mappings,
      options: input.options,
      createdAt: now,
      updatedAt: now,
    });

    const saved = await this.deps.repositories.workflowConfigurations.create(configuration);
    this.deps.logger.info(
      {
        configurationId: saved.id,
        workflowSlug: saved.workflowSlug,
        datasets: saved.assignments.length,
        mappings: saved.mappings.length,
      },
      'workflow configuration created',
    );
    return saved;
  }

  async update(
    id: string,
    input: UpdateWorkflowConfigurationRequest,
  ): Promise<WorkflowConfiguration> {
    const existing = await this.getById(id);
    const workflow = this.deps.registry.require(existing.workflowSlug);

    const merged = {
      assignments: input.assignments ?? existing.assignments,
      mappings: input.mappings ?? existing.mappings,
      options: input.options ?? existing.options,
    };
    const datasets = await this.loadDatasets(merged.assignments, merged.mappings);
    const validation = this.validateMapping(workflow, merged, datasets);
    this.assertValid(validation);

    const updated = workflowConfigurationSchema.parse({
      ...existing,
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      version: existing.version + 1,
      assignments: merged.assignments,
      mappings: merged.mappings,
      options: merged.options,
      updatedAt: this.deps.clock.now(),
    });

    const saved = await this.deps.repositories.workflowConfigurations.update(updated);
    this.deps.logger.info(
      { configurationId: saved.id, version: saved.version },
      'workflow configuration updated',
    );
    return saved;
  }

  async validate(
    input: ValidateWorkflowConfigurationRequest,
  ): Promise<ConfigurationValidationResult> {
    const workflow = this.deps.registry.require(input.workflowSlug);
    const datasets = await this.loadDatasets(input.assignments, input.mappings);
    const validation = this.validateMapping(workflow, input, datasets);

    let resolvedConfig: ResolvedRunConfig | null = null;
    if (workflow.resolveRunInput) {
      try {
        const preview = workflow.resolveRunInput({
          configuration: this.previewConfiguration(workflow, input),
          datasets,
        });
        resolvedConfig = preview.config as ResolvedRunConfig;
      } catch {
        resolvedConfig = null;
      }
    }

    return { ...validation, resolvedConfig };
  }

  /**
   * Resolves a saved configuration into the concrete run input, re-validating first so an invalid
   * configuration can never be started.
   */
  async buildRunInput(configurationId: string): Promise<BuiltRunInput> {
    const configuration = await this.getById(configurationId);
    const workflow = this.deps.registry.require(configuration.workflowSlug);
    if (!workflow.resolveRunInput) {
      throw new InvalidConfigurationError(
        `Workflow "${workflow.slug}" cannot be started from a configuration.`,
      );
    }

    const datasets = await this.loadDatasets(configuration.assignments, configuration.mappings);
    const validation = this.validateMapping(workflow, configuration, datasets);
    this.assertValid(validation);

    const resolved = workflow.resolveRunInput({ configuration, datasets });
    return {
      workflowSlug: workflow.slug,
      primaryFileId: resolved.primaryFileId,
      eventsFileId: resolved.eventsFileId,
      configurationId: configuration.id,
      config: resolved.config,
    };
  }

  private validateMapping(
    workflow: RegisteredWorkflow,
    configuration: {
      assignments: DatasetAssignment[];
      mappings: WorkflowConfiguration['mappings'];
      options: Record<string, ConfigurationOptionValue>;
    },
    datasets: DatasetProfile[],
  ): ConfigurationValidation {
    return validateWorkflowConfiguration({
      definition: workflow.configuration,
      configuration,
      datasets,
    });
  }

  private assertValid(validation: ConfigurationValidation): void {
    if (!validation.valid) {
      throw new InvalidConfigurationError(
        'The workflow configuration has validation errors that must be resolved before it can be saved.',
        { issues: validation.issues },
      );
    }
  }

  private previewConfiguration(
    workflow: RegisteredWorkflow,
    configuration: {
      assignments: DatasetAssignment[];
      mappings: WorkflowConfiguration['mappings'];
      options: Record<string, ConfigurationOptionValue>;
    },
  ): WorkflowConfiguration {
    const now = this.deps.clock.now();
    return {
      id: 'preview',
      workflowSlug: workflow.slug,
      workflowVersion: workflow.version,
      name: 'preview',
      description: '',
      version: 1,
      assignments: configuration.assignments,
      mappings: configuration.mappings,
      options: configuration.options,
      createdAt: now,
      updatedAt: now,
    };
  }

  async loadDatasets(
    assignments: DatasetAssignment[],
    mappings: WorkflowConfiguration['mappings'],
  ): Promise<DatasetProfile[]> {
    const ids = new Set<string>();
    for (const assignment of assignments) {
      ids.add(assignment.datasetId);
    }
    for (const mapping of mappings) {
      ids.add(mapping.datasetId);
    }

    const datasets: DatasetProfile[] = [];
    for (const id of ids) {
      const dataset = await this.deps.repositories.datasets.getById(id);
      if (dataset) {
        datasets.push(dataset);
      }
    }
    return datasets;
  }
}
