import type { WorkflowConfiguration, WorkflowConfigurationId } from '../domain/workflow-config.js';

export interface WorkflowConfigurationListOptions {
  workflowSlug?: string;
  limit?: number;
  offset?: number;
}

export interface WorkflowConfigurationRepository {
  create(configuration: WorkflowConfiguration): Promise<WorkflowConfiguration>;
  update(configuration: WorkflowConfiguration): Promise<WorkflowConfiguration>;
  getById(id: WorkflowConfigurationId): Promise<WorkflowConfiguration | null>;
  list(options?: WorkflowConfigurationListOptions): Promise<WorkflowConfiguration[]>;
}
