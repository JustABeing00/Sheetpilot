import type { FastifyInstance } from 'fastify';
import type { AppContainer } from '../../container.js';
import { registerArtifactRoutes } from './artifacts.js';
import { registerDatasetRoutes } from './datasets.js';
import { registerFileRoutes } from './files.js';
import { registerHealthRoutes } from './health.js';
import { registerMetaRoutes } from './meta.js';
import { registerReviewItemRoutes } from './review-items.js';
import { registerRuleSetRoutes } from './rule-sets.js';
import { registerBillingRoutes } from './billing.js';
import { registerRunRoutes } from './runs.js';
import { registerSavedWorkflowRoutes } from './saved-workflows.js';
import { registerWorkflowConfigurationRoutes } from './workflow-configurations.js';
import { registerWorkflowRoutes } from './workflows.js';
import { registerWorkspaceRoutes } from './workspaces.js';

export function registerRoutes(
  app: FastifyInstance,
  container: AppContainer,
  options: { startedAt: number },
): void {
  registerHealthRoutes(app, {
    clock: container.clock,
    startedAt: options.startedAt,
    readiness: () => container.readiness(),
  });
  registerMetaRoutes(app, container);
  registerBillingRoutes(app, container);
  registerWorkspaceRoutes(app, container);
  registerWorkflowRoutes(app, container);
  registerWorkflowConfigurationRoutes(app, container);
  registerRuleSetRoutes(app, container);
  registerSavedWorkflowRoutes(app, container);
  registerFileRoutes(app, container);
  registerDatasetRoutes(app, container);
  registerRunRoutes(app, container);
  registerReviewItemRoutes(app, container);
  registerArtifactRoutes(app, container);
}
