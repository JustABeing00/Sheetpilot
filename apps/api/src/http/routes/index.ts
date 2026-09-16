import type { FastifyInstance } from 'fastify';
import type { AppContainer } from '../../container.js';
import { registerArtifactRoutes } from './artifacts.js';
import { registerDatasetRoutes } from './datasets.js';
import { registerFileRoutes } from './files.js';
import { registerHealthRoutes } from './health.js';
import { registerMetaRoutes } from './meta.js';
import { registerReviewItemRoutes } from './review-items.js';
import { registerRuleSetRoutes } from './rule-sets.js';
import { registerRunRoutes } from './runs.js';
import { registerSavedWorkflowRoutes } from './saved-workflows.js';
import { registerWorkflowConfigurationRoutes } from './workflow-configurations.js';
import { registerWorkflowRoutes } from './workflows.js';

export function registerRoutes(
  app: FastifyInstance,
  container: AppContainer,
  options: { startedAt: number },
): void {
  registerHealthRoutes(app, { clock: container.clock, startedAt: options.startedAt });
  registerMetaRoutes(app, container);
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
