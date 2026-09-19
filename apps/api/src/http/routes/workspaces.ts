import {
  createInvitationRequestSchema,
  createWorkspaceRequestSchema,
  ForbiddenError,
  invitationDtoSchema,
  invitationListResponseSchema,
  planUsageDtoSchema,
  updateMemberRoleRequestSchema,
  updateWorkspaceRequestSchema,
  workspaceDetailDtoSchema,
  workspaceListResponseSchema,
  type Invitation,
} from '@sheetpilot/core';
import type { FastifyInstance } from 'fastify';
import type { AppContainer } from '../../container.js';
import { setActiveWorkspace } from '../../auth/workspace-cookie.js';
import { actorOf, parseOrThrow, tenantOf } from '../http-utils.js';

function toInvitationDto(invitation: Invitation) {
  return invitationDtoSchema.parse({
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    invitedBy: invitation.invitedBy,
    expiresAt: invitation.expiresAt.toISOString(),
  });
}

function requireUser(container: AppContainer, request: { authUser?: { id: string } }): string {
  if (!container.auth.enabled) {
    throw new ForbiddenError(
      'Workspace management is only available when authentication is enabled.',
    );
  }
  const userId = request.authUser?.id;
  if (!userId) {
    throw new ForbiddenError('Sign in to manage workspaces.');
  }
  return userId;
}

export function registerWorkspaceRoutes(app: FastifyInstance, container: AppContainer): void {
  app.get('/api/v1/workspaces', async (request) => {
    const userId = requireUser(container, request);
    const items = await container.workspaceService.listForUser(userId);
    return workspaceListResponseSchema.parse({ items });
  });

  app.post('/api/v1/workspaces', async (request, reply) => {
    const userId = requireUser(container, request);
    const body = parseOrThrow(createWorkspaceRequestSchema, request.body, 'workspace');
    const workspace = await container.workspaceService.create(userId, body.name);
    reply.status(201);
    return workspace;
  });

  app.get('/api/v1/usage', async (request) => {
    requireUser(container, request);
    const tenantId = tenantOf(request);
    if (!tenantId) {
      throw new ForbiddenError('No active workspace.');
    }
    return planUsageDtoSchema.parse(await container.quotaService.snapshot(tenantId));
  });

  app.get('/api/v1/workspaces/current', async (request) => {
    const userId = requireUser(container, request);
    const tenantId = tenantOf(request);
    if (!tenantId) {
      throw new ForbiddenError('No active workspace.');
    }
    return workspaceDetailDtoSchema.parse(
      await container.workspaceService.getForUser(userId, tenantId),
    );
  });

  app.post('/api/v1/workspaces/:workspaceId/activate', async (request, reply) => {
    const userId = requireUser(container, request);
    const { workspaceId } = request.params as { workspaceId: string };
    await container.workspaceService.activate(userId, workspaceId);
    setActiveWorkspace(reply, workspaceId, container.config.isProduction);
    reply.status(204);
    return null;
  });

  app.put('/api/v1/workspaces/current', async (request) => {
    const userId = requireUser(container, request);
    const tenantId = tenantOf(request);
    if (!tenantId) {
      throw new ForbiddenError('No active workspace.');
    }
    const body = parseOrThrow(updateWorkspaceRequestSchema, request.body, 'workspace update');
    return container.workspaceService.rename(userId, tenantId, body.name);
  });

  app.put('/api/v1/workspaces/current/members/:membershipId', async (request, reply) => {
    const userId = requireUser(container, request);
    const tenantId = tenantOf(request);
    if (!tenantId) {
      throw new ForbiddenError('No active workspace.');
    }
    const { membershipId } = request.params as { membershipId: string };
    const body = parseOrThrow(updateMemberRoleRequestSchema, request.body, 'member role update');
    await container.workspaceService.setMemberRole(userId, tenantId, membershipId, body.role);
    reply.status(204);
    return null;
  });

  app.delete('/api/v1/workspaces/current/members/:membershipId', async (request, reply) => {
    const userId = requireUser(container, request);
    const tenantId = tenantOf(request);
    if (!tenantId) {
      throw new ForbiddenError('No active workspace.');
    }
    const { membershipId } = request.params as { membershipId: string };
    await container.workspaceService.removeMember(userId, tenantId, membershipId);
    reply.status(204);
    return null;
  });

  app.get('/api/v1/workspaces/current/invitations', async (request) => {
    const userId = requireUser(container, request);
    const tenantId = tenantOf(request);
    if (!tenantId) {
      throw new ForbiddenError('No active workspace.');
    }
    const invitations = await container.workspaceService.listInvitations(userId, tenantId);
    return invitationListResponseSchema.parse({ items: invitations.map(toInvitationDto) });
  });

  app.post('/api/v1/workspaces/current/invitations', async (request, reply) => {
    const userId = requireUser(container, request);
    const tenantId = tenantOf(request);
    if (!tenantId) {
      throw new ForbiddenError('No active workspace.');
    }
    const body = parseOrThrow(createInvitationRequestSchema, request.body, 'invitation');
    const invitation = await container.workspaceService.invite(
      userId,
      tenantId,
      body,
      actorOf(request) ?? userId,
    );
    reply.status(201);
    return toInvitationDto(invitation);
  });

  app.delete('/api/v1/workspaces/current/invitations/:invitationId', async (request, reply) => {
    const userId = requireUser(container, request);
    const tenantId = tenantOf(request);
    if (!tenantId) {
      throw new ForbiddenError('No active workspace.');
    }
    const { invitationId } = request.params as { invitationId: string };
    await container.workspaceService.revokeInvitation(userId, tenantId, invitationId);
    reply.status(204);
    return null;
  });
}
