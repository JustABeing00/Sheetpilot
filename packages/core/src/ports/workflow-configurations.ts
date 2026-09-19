import type { WorkflowConfiguration, WorkflowConfigurationId } from '../domain/workflow-config.js';

export interface WorkflowConfigurationListOptions {
  workflowSlug?: string;
  /** Restrict to one tenant. Omitted only for legacy/single-tenant (auth disabled) callers. */
  tenantId?: string | null;
  limit?: number;
  offset?: number;
}

export interface WorkflowConfigurationRepository {
  create(configuration: WorkflowConfiguration): Promise<WorkflowConfiguration>;
  update(configuration: WorkflowConfiguration): Promise<WorkflowConfiguration>;
  getById(id: WorkflowConfigurationId): Promise<WorkflowConfiguration | null>;
  list(options?: WorkflowConfigurationListOptions): Promise<WorkflowConfiguration[]>;
  delete(id: WorkflowConfigurationId): Promise<void>;
}
