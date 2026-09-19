import {
  createRuleSetRequestSchema,
  ruleSetDtoSchema,
  ruleSetListResponseSchema,
  ruleSetValidationResponseSchema,
  updateRuleSetRequestSchema,
  validateRuleSetRequestSchema,
} from '@sheetpilot/core';
import type { FastifyInstance } from 'fastify';
import type { AppContainer } from '../../container.js';
import { toRuleSetDto, toRuleSetSummaryDto } from '../dto.js';
import { parseOrThrow, tenantOf } from '../http-utils.js';

export function registerRuleSetRoutes(app: FastifyInstance, container: AppContainer): void {
  app.get('/api/v1/rule-sets', async (request) => {
    const query = request.query as Record<string, unknown>;
    const workflowSlug =
      typeof query['workflowSlug'] === 'string' && query['workflowSlug'].length > 0
        ? query['workflowSlug']
        : undefined;
    const ruleSets = await container.ruleSetService.list(workflowSlug, tenantOf(request));
    return ruleSetListResponseSchema.parse({
      items: ruleSets.map(toRuleSetSummaryDto),
    });
  });

  app.post('/api/v1/rule-sets/validate', async (request) => {
    const body = parseOrThrow(
      validateRuleSetRequestSchema,
      request.body,
      'rule set validation request',
    );
    return ruleSetValidationResponseSchema.parse(await container.ruleSetService.validate(body));
  });

  app.post('/api/v1/rule-sets', async (request, reply) => {
    const body = parseOrThrow(createRuleSetRequestSchema, request.body, 'rule set');
    const ruleSet = await container.ruleSetService.create(body, tenantOf(request));
    reply.status(201);
    return ruleSetDtoSchema.parse(toRuleSetDto(ruleSet));
  });

  app.get('/api/v1/rule-sets/:id', async (request) => {
    const { id } = request.params as { id: string };
    const ruleSet = await container.ruleSetService.getById(id, tenantOf(request));
    return ruleSetDtoSchema.parse(toRuleSetDto(ruleSet));
  });

  app.put('/api/v1/rule-sets/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = parseOrThrow(updateRuleSetRequestSchema, request.body, 'rule set update');
    const ruleSet = await container.ruleSetService.update(id, body, tenantOf(request));
    return ruleSetDtoSchema.parse(toRuleSetDto(ruleSet));
  });
}
