import { z } from 'zod';
import { membershipRoleSchema } from '../domain/tenancy.js';

export const workspaceDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  role: membershipRoleSchema,
  memberCount: z.number().int().nonnegative(),
  isPersonal: z.boolean(),
  createdAt: z.string(),
});
export type WorkspaceDto = z.infer<typeof workspaceDtoSchema>;

export const workspaceListResponseSchema = z.object({ items: z.array(workspaceDtoSchema) });

export const workspaceMemberDtoSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  role: membershipRoleSchema,
  isSelf: z.boolean(),
  createdAt: z.string(),
});
export type WorkspaceMemberDto = z.infer<typeof workspaceMemberDtoSchema>;

export const workspaceDetailDtoSchema = workspaceDtoSchema.extend({
  members: z.array(workspaceMemberDtoSchema),
});
export type WorkspaceDetailDto = z.infer<typeof workspaceDetailDtoSchema>;

export const createWorkspaceRequestSchema = z.object({
  name: z.string().min(1).max(80),
});
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

export const updateWorkspaceRequestSchema = z.object({
  name: z.string().min(1).max(80),
});
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequestSchema>;

export const updateMemberRoleRequestSchema = z.object({
  role: membershipRoleSchema,
});
export type UpdateMemberRoleRequest = z.infer<typeof updateMemberRoleRequestSchema>;

export const createInvitationRequestSchema = z.object({
  email: z.string().email(),
  role: membershipRoleSchema.default('member'),
});
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;

export const invitationDtoSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: membershipRoleSchema,
  expiresAt: z.string(),
  invitedBy: z.string().nullable(),
});
export type InvitationDto = z.infer<typeof invitationDtoSchema>;

export const invitationListResponseSchema = z.object({ items: z.array(invitationDtoSchema) });
