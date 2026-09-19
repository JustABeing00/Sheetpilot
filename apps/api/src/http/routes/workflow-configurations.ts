import {
  configurationValidationResponseSchema,
  createWorkflowConfigurationRequestSchema,
  updateWorkflowConfigurationRequestSchema,
  validateWorkflowConfigurationRequestSchema,
  workflowConfigurationDtoSchema,
  workflowConfigurationListResponseSchema,
} from '@sheetpilot/core';
import type { FastifyInstance } from 'fastify';
import type { AppContainer } from '../../container.js';
import { toWorkflowConfigurationDto, toWorkflowConfigurationSummaryDto } from '../dto.js';
import { clampLimit, parseOffset, parseOrThrow, tenantOf } from '../http-utils.js';

export function registerWorkflowConfigurationRoutes(
  app: FastifyInstance,
  container: AppContainer,
): void {
  app.get('/api/v1/workflow-configurations', async (request) => {
    const query = request.query as Record<string, unknown>;
    const workflowSlug =
      typeof query['workflowSlug'] === 'string' && query['workflowSlug'].length > 0
        ? query['workflowSlug']
        : undefined;
    const configurations = await container.workflowConfigurationService.list(
      workflowSlug,
      clampLimit(query['limit'], 100),
      parseOffset(query['offset']),
      tenantOf(request),
    );
    return workflowConfigurationListResponseSchema.parse({
      items: configurations.map(toWorkflowConfigurationSummaryDto),
    });
  });

  app.post('/api/v1/workflow-configurations', async (request, reply) => {
    const body = parseOrThrow(
      createWorkflowConfigurationRequestSchema,
      request.body,
      'workflow configuration',
    );
    const configuration = await container.workflowConfigurationService.create(
      body,
      tenantOf(request),
    );
    reply.status(201);
    return workflowConfigurationDtoSchema.parse(toWorkflowConfigurationDto(configuration));
  });

  app.post('/api/v1/workflow-configurations/validate', async (request) => {
    const body = parseOrThrow(
      validateWorkflowConfigurationRequestSchema,
      request.body,
      'workflow configuration validation request',
    );
    const result = await container.workflowConfigurationService.validate(body, tenantOf(request));
    return configurationValidationResponseSchema.parse(result);
  });

  app.get('/api/v1/workflow-configurations/:id', async (request) => {
    const { id } = request.params as { id: string };
    const configuration = await container.workflowConfigurationService.getById(
      id,
      tenantOf(request),
    );
    return workflowConfigurationDtoSchema.parse(toWorkflowConfigurationDto(configuration));
  });

  app.put('/api/v1/workflow-configurations/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = parseOrThrow(
      updateWorkflowConfigurationRequestSchema,
      request.body,
      'workflow configuration update',
    );
    const configuration = await container.workflowConfigurationService.update(
      id,
      body,
      tenantOf(request),
    );
    return workflowConfigurationDtoSchema.parse(toWorkflowConfigurationDto(configuration));
  });
}
