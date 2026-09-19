import {
  canManageTenant,
  ConflictError,
  ForbiddenError,
  newId,
  NotFoundError,
  personalTenantName,
  tenantSlug,
  type Clock,
  type CreateInvitationRequest,
  type Logger,
  type Membership,
  type MembershipRole,
  type Repositories,
  type Tenant,
  type WorkspaceDetailDto,
  type WorkspaceDto,
  type WorkspaceMemberDto,
} from '@sheetpilot/core';
import type { QuotaService } from './quota-service.js';

export interface WorkspaceServiceDeps {
  repositories: Repositories;
  clock: Clock;
  logger: Logger;
  /** Plan-quota gate; omitted in unit tests and when enforcement is disabled. */
  quotas?: QuotaService;
}

/** How long an invitation stays valid. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Workspace (tenant) management: listing a user's workspaces, membership and role administration, and
 * email invitations. Invitations are accepted implicitly at sign-in — a user with a pending invitation
 * to a workspace joins it on their next request, so no separate accept screen is needed.
 */
export class WorkspaceService {
  constructor(private readonly deps: WorkspaceServiceDeps) {}

  async listForUser(userId: string): Promise<WorkspaceDto[]> {
    const tenants = await this.deps.repositories.tenants.listForUser(userId);
    const result: WorkspaceDto[] = [];
    for (const tenant of tenants) {
      result.push(await this.toDto(tenant, userId));
    }
    return result;
  }

  async getForUser(userId: string, tenantId: string): Promise<WorkspaceDetailDto> {
    const membership = await this.requireMembership(userId, tenantId);
    const tenant = await this.deps.repositories.tenants.getById(tenantId);
    if (!tenant) {
      throw new NotFoundError('Workspace', tenantId);
    }
    const memberships = await this.deps.repositories.memberships.listForTenant(tenantId);
    const members: WorkspaceMemberDto[] = [];
    for (const entry of memberships) {
      members.push(await this.toMemberDto(entry, userId));
    }
    return {
      ...(await this.toDto(tenant, userId)),
      role: membership.role,
      members,
    };
  }

  async create(userId: string, name: string): Promise<WorkspaceDto> {
    const base = tenantSlug(name);
    let slug = base;
    let suffix = 1;
    while (await this.deps.repositories.tenants.getBySlug(slug)) {
      suffix += 1;
      slug = `${base}-${suffix}`;
    }

    const now = this.deps.clock.now();
    const tenant = await this.deps.repositories.tenants.create({
      id: newId(),
      name,
      slug,
      plan: 'free',
      createdAt: now,
      updatedAt: now,
    });
    await this.deps.repositories.memberships.create({
      id: newId(),
      tenantId: tenant.id,
      userId,
      role: 'owner',
      createdAt: now,
      updatedAt: now,
    });

    this.deps.logger.info({ tenantId: tenant.id, userId }, 'workspace created');
    return this.toDto(tenant, userId);
  }

  async rename(userId: string, tenantId: string, name: string): Promise<WorkspaceDto> {
    await this.requireManager(userId, tenantId);
    const tenant = await this.deps.repositories.tenants.getById(tenantId);
    if (!tenant) {
      throw new NotFoundError('Workspace', tenantId);
    }
    const updated = await this.deps.repositories.tenants.update({
      ...tenant,
      name,
      updatedAt: this.deps.clock.now(),
    });
    return this.toDto(updated, userId);
  }

  async setMemberRole(
    actorId: string,
    tenantId: string,
    membershipId: string,
    role: MembershipRole,
  ): Promise<void> {
    const actor = await this.requireManager(actorId, tenantId);
    const target = await this.deps.repositories.memberships.listForTenant(tenantId);
    const membership = target.find((entry) => entry.id === membershipId);
    if (!membership) {
      throw new NotFoundError('Member', membershipId);
    }

    if (role === 'owner' && actor.role !== 'owner') {
      throw new ForbiddenError('Only an owner can grant the owner role.');
    }
    if (membership.role === 'owner' && role !== 'owner') {
      await this.assertNotLastOwner(tenantId, 'You cannot demote the last owner of a workspace.');
    }
    if (actor.role !== 'owner' && membership.role === 'owner') {
      throw new ForbiddenError('Only an owner can change another owner’s role.');
    }

    await this.deps.repositories.memberships.setRole(membershipId, role, this.deps.clock.now());
    this.deps.logger.info({ tenantId, membershipId, role }, 'member role updated');
  }

  async removeMember(actorId: string, tenantId: string, membershipId: string): Promise<void> {
    const actor = await this.requireManager(actorId, tenantId);
    const memberships = await this.deps.repositories.memberships.listForTenant(tenantId);
    const membership = memberships.find((entry) => entry.id === membershipId);
    if (!membership) {
      throw new NotFoundError('Member', membershipId);
    }
    if (membership.role === 'owner' && actor.role !== 'owner') {
      throw new ForbiddenError('Only an owner can remove another owner.');
    }
    if (membership.role === 'owner') {
      await this.assertNotLastOwner(tenantId, 'You cannot remove the last owner of a workspace.');
    }
    await this.deps.repositories.memberships.delete(membershipId);
    this.deps.logger.info({ tenantId, membershipId }, 'member removed');
  }

  async listInvitations(userId: string, tenantId: string) {
    await this.requireManager(userId, tenantId);
    return this.deps.repositories.invitations.listByTenant(tenantId);
  }

  async invite(
    userId: string,
    tenantId: string,
    input: CreateInvitationRequest,
    invitedBy: string,
  ) {
    const actor = await this.requireManager(userId, tenantId);
    if (input.role === 'owner' && actor.role !== 'owner') {
      throw new ForbiddenError('Only an owner can invite someone as an owner.');
    }
    await this.deps.quotas?.assertCanAddMember(tenantId);
    const email = input.email.trim().toLowerCase();

    const memberships = await this.deps.repositories.memberships.listForTenant(tenantId);
    const memberIds = new Set(memberships.map((entry) => entry.userId));
    const users = await this.deps.repositories.users.listByIds([...memberIds]);
    if (users.some((user) => user.email?.toLowerCase() === email)) {
      throw new ConflictError('That person is already a member of this workspace.');
    }

    const now = this.deps.clock.now();
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
    return this.deps.repositories.invitations.create({
      id: newId(),
      tenantId,
      email,
      role: input.role,
      invitedBy,
      acceptedAt: null,
      expiresAt,
      createdAt: now,
    });
  }

  async revokeInvitation(userId: string, tenantId: string, invitationId: string): Promise<void> {
    await this.requireManager(userId, tenantId);
    const invitation = await this.deps.repositories.invitations.getById(invitationId);
    if (!invitation || invitation.tenantId !== tenantId) {
      throw new NotFoundError('Invitation', invitationId);
    }
    await this.deps.repositories.invitations.delete(invitationId);
  }

  /**
   * Grants any pending invitations addressed to the user's email. Called on each authenticated request
   * (idempotent and cheap) so an invited teammate joins the workspace simply by signing in.
   */
  async acceptPendingInvitations(userId: string, email: string | null): Promise<void> {
    if (!email) {
      return;
    }
    const pending = await this.deps.repositories.invitations.listByEmail(email.toLowerCase());
    if (pending.length === 0) {
      return;
    }

    const now = this.deps.clock.now();
    for (const invitation of pending) {
      if (invitation.expiresAt.getTime() < now.getTime()) {
        await this.deps.repositories.invitations.delete(invitation.id);
        continue;
      }
      const existing = await this.deps.repositories.memberships.getForUserAndTenant(
        userId,
        invitation.tenantId,
      );
      if (!existing) {
        await this.deps.repositories.memberships.create({
          id: newId(),
          tenantId: invitation.tenantId,
          userId,
          role: invitation.role,
          createdAt: now,
          updatedAt: now,
        });
        this.deps.logger.info(
          { tenantId: invitation.tenantId, userId },
          'invitation accepted on sign-in',
        );
      }
      await this.deps.repositories.invitations.delete(invitation.id);
    }
  }

  /** Validates that the user may open the given workspace (404 when they are not a member). */
  async activate(userId: string, tenantId: string): Promise<void> {
    await this.requireMembership(userId, tenantId);
  }

  /**
   * Resolves the workspace a request should act in: the requested one when the user is still a member,
   * otherwise their default workspace (provisioning a personal one on first use).
   */
  async resolveActiveTenant(
    userId: string,
    requestedTenantId: string | null,
    label: string | null,
  ): Promise<string> {
    if (requestedTenantId) {
      const membership = await this.deps.repositories.memberships.getForUserAndTenant(
        userId,
        requestedTenantId,
      );
      if (membership) {
        return membership.tenantId;
      }
    }
    return this.ensureWorkspace(userId, label);
  }

  /** Ensures a user has at least one workspace (a personal one) and returns the active tenant id. */
  async ensureWorkspace(userId: string, label: string | null): Promise<string> {
    const existing = await this.deps.repositories.memberships.getDefaultForUser(userId);
    if (existing) {
      return existing.tenantId;
    }
    const tenant = await this.create(userId, personalTenantName(label));
    return tenant.id;
  }

  private async requireMembership(userId: string, tenantId: string): Promise<Membership> {
    const membership = await this.deps.repositories.memberships.getForUserAndTenant(
      userId,
      tenantId,
    );
    if (!membership) {
      throw new NotFoundError('Workspace', tenantId);
    }
    return membership;
  }

  private async requireManager(userId: string, tenantId: string): Promise<Membership> {
    const membership = await this.requireMembership(userId, tenantId);
    if (!canManageTenant(membership.role)) {
      throw new ForbiddenError('Only an owner or admin can manage this workspace.');
    }
    return membership;
  }

  private async assertNotLastOwner(tenantId: string, message: string): Promise<void> {
    const memberships = await this.deps.repositories.memberships.listForTenant(tenantId);
    const owners = memberships.filter((entry) => entry.role === 'owner');
    if (owners.length <= 1) {
      throw new ConflictError(message);
    }
  }

  private async toDto(tenant: Tenant, userId: string): Promise<WorkspaceDto> {
    const membership = await this.deps.repositories.memberships.getForUserAndTenant(
      userId,
      tenant.id,
    );
    const memberCount = await this.deps.repositories.memberships.countForTenant(tenant.id);
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      role: membership?.role ?? 'member',
      memberCount,
      isPersonal: memberCount === 1 && membership?.role === 'owner',
      createdAt: tenant.createdAt.toISOString(),
    };
  }

  private async toMemberDto(entry: Membership, selfId: string): Promise<WorkspaceMemberDto> {
    const user = await this.deps.repositories.users.getById(entry.userId);
    return {
      id: entry.id,
      userId: entry.userId,
      name: user?.name ?? null,
      email: user?.email ?? null,
      role: entry.role,
      isSelf: entry.userId === selfId,
      createdAt: entry.createdAt.toISOString(),
    };
  }
}
