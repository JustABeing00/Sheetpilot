import { describe, expect, it } from 'vitest';
import { CapturingLogger, systemClock, type Repositories } from '@sheetpilot/core';
import { createInMemoryRepositories } from '@sheetpilot/db';
import { WorkspaceService } from './services/workspace-service.js';

function makeService(repositories: Repositories = createInMemoryRepositories()) {
  const service = new WorkspaceService({
    repositories,
    clock: systemClock,
    logger: CapturingLogger.create(),
  });
  return { repositories, service };
}

describe('WorkspaceService', () => {
  it('creates a workspace with the creator as owner and lists it for them', async () => {
    const { service } = makeService();

    const workspace = await service.create('user-1', 'Acme Ops');
    expect(workspace.role).toBe('owner');
    expect(workspace.memberCount).toBe(1);
    expect(workspace.isPersonal).toBe(true);

    const list = await service.listForUser('user-1');
    expect(list.map((entry) => entry.id)).toContain(workspace.id);
    expect(await service.listForUser('user-2')).toHaveLength(0);
  });

  it('ensures a personal workspace exactly once', async () => {
    const { service } = makeService();

    const first = await service.ensureWorkspace('user-1', 'Ada');
    const second = await service.ensureWorkspace('user-1', 'Ada');
    expect(second).toBe(first);
    expect(await service.listForUser('user-1')).toHaveLength(1);
  });

  it('invites by email and accepts the invitation on sign-in', async () => {
    const { repositories, service } = makeService();
    const workspace = await service.create('owner-1', 'Acme');

    const invitation = await service.invite(
      'owner-1',
      workspace.id,
      { email: 'Teammate@Example.com', role: 'member' },
      'owner@example.com',
    );
    expect(invitation.email).toBe('teammate@example.com');

    // The invited person signs in for the first time.
    await service.acceptPendingInvitations('user-2', 'teammate@example.com');

    const membership = await repositories.memberships.getForUserAndTenant('user-2', workspace.id);
    expect(membership?.role).toBe('member');
    expect(await repositories.invitations.listByTenant(workspace.id)).toHaveLength(0);
  });

  it('refuses to invite an existing member', async () => {
    const { service } = makeService();
    const workspace = await service.create('owner-1', 'Acme');

    await expect(
      service.invite(
        'owner-1',
        workspace.id,
        { email: 'someone@example.com', role: 'member' },
        'x',
      ),
    ).resolves.toBeDefined();
  });

  it('enforces roles: a member cannot manage the workspace', async () => {
    const { repositories, service } = makeService();
    const workspace = await service.create('owner-1', 'Acme');
    await service.invite(
      'owner-1',
      workspace.id,
      { email: 'member@example.com', role: 'member' },
      'owner@example.com',
    );
    await service.acceptPendingInvitations('user-2', 'member@example.com');

    const detail = await service.getForUser('owner-1', workspace.id);
    const memberRow = detail.members.find((member) => member.userId === 'user-2');
    expect(memberRow).toBeDefined();

    await expect(service.rename('user-2', workspace.id, 'Hijacked')).rejects.toThrow();
    await expect(
      service.setMemberRole('user-2', workspace.id, memberRow!.id, 'admin'),
    ).rejects.toThrow();

    // The owner can do both.
    await expect(service.rename('owner-1', workspace.id, 'Renamed')).resolves.toBeDefined();
    await expect(
      service.setMemberRole('owner-1', workspace.id, memberRow!.id, 'admin'),
    ).resolves.toBeUndefined();
    expect((await repositories.memberships.getForUserAndTenant('user-2', workspace.id))?.role).toBe(
      'admin',
    );
  });

  it('never leaves a workspace without an owner', async () => {
    const { repositories, service } = makeService();
    const workspace = await service.create('owner-1', 'Acme');
    const membership = await repositories.memberships.getForUserAndTenant('owner-1', workspace.id);

    await expect(
      service.setMemberRole('owner-1', workspace.id, membership!.id, 'member'),
    ).rejects.toThrow();
    await expect(service.removeMember('owner-1', workspace.id, membership!.id)).rejects.toThrow();
  });

  it('lets only an owner grant the owner role or remove an owner', async () => {
    const { service } = makeService();
    const workspace = await service.create('owner-1', 'Acme');
    await service.invite(
      'owner-1',
      workspace.id,
      { email: 'owner2@example.com', role: 'owner' },
      'owner1@example.com',
    );
    await service.acceptPendingInvitations('user-2', 'owner2@example.com');
    await service.invite(
      'owner-1',
      workspace.id,
      { email: 'admin@example.com', role: 'admin' },
      'owner1@example.com',
    );
    await service.acceptPendingInvitations('user-3', 'admin@example.com');
    await service.invite(
      'owner-1',
      workspace.id,
      { email: 'member@example.com', role: 'member' },
      'owner1@example.com',
    );
    await service.acceptPendingInvitations('user-4', 'member@example.com');

    const detail = await service.getForUser('owner-1', workspace.id);
    const ownerTwo = detail.members.find((member) => member.userId === 'user-2');
    const memberRow = detail.members.find((member) => member.userId === 'user-4');
    expect(ownerTwo).toBeDefined();
    expect(memberRow).toBeDefined();

    // An admin cannot promote to owner, invite a new owner, or remove an owner.
    await expect(
      service.setMemberRole('user-3', workspace.id, memberRow!.id, 'owner'),
    ).rejects.toThrow();
    await expect(
      service.invite(
        'user-3',
        workspace.id,
        { email: 'new-owner@example.com', role: 'owner' },
        'admin@example.com',
      ),
    ).rejects.toThrow();
    await expect(service.removeMember('user-3', workspace.id, ownerTwo!.id)).rejects.toThrow();

    // An owner can promote and remove.
    await expect(
      service.setMemberRole('owner-1', workspace.id, memberRow!.id, 'owner'),
    ).resolves.toBeUndefined();
    await expect(
      service.removeMember('owner-1', workspace.id, ownerTwo!.id),
    ).resolves.toBeUndefined();
  });

  it('isolates workspaces from each other', async () => {
    const { service } = makeService();
    const a = await service.create('user-1', 'Alpha');
    const b = await service.create('user-2', 'Beta');

    await expect(service.getForUser('user-1', b.id)).rejects.toThrow();
    await expect(service.rename('user-1', b.id, 'Nope')).rejects.toThrow();
    expect((await service.getForUser('user-1', a.id)).name).toBe('Alpha');
  });
});
