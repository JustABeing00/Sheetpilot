import { useEffect, useState, type FormEvent } from 'react';
import type { InvitationDto, MembershipRole, WorkspaceMemberDto } from '@sheetpilot/core';
import {
  useActivateWorkspace,
  useCreateWorkspace,
  useCurrentWorkspace,
  useInvitations,
  useInviteMember,
  useMeta,
  useRemoveMember,
  useRenameWorkspace,
  useRevokeInvitation,
  useSession,
  useUpdateMemberRole,
} from '../api/hooks.js';
import { ApiError } from '../api/client.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { useToast } from '../components/toast-context.js';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
} from '../components/ui.js';
import { formatDateTime } from '../lib/format.js';

const ROLE_OPTIONS: MembershipRole[] = ['owner', 'admin', 'member'];
const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function WorkspaceSettingsPage() {
  const meta = useMeta();
  const session = useSession();
  const authEnabled = meta.data?.capabilities.authEnabled === true;
  const signedIn = authEnabled && Boolean(session.data);
  const current = useCurrentWorkspace(signedIn);
  const canManage = current.data?.role === 'owner' || current.data?.role === 'admin';
  const invitations = useInvitations(signedIn && canManage);
  const createWorkspace = useCreateWorkspace();
  const renameWorkspace = useRenameWorkspace();
  const updateMemberRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();
  const inviteMember = useInviteMember();
  const revokeInvitation = useRevokeInvitation();
  const activateWorkspace = useActivateWorkspace();
  const toast = useToast();

  const [name, setName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<MembershipRole>('member');
  const [pendingMember, setPendingMember] = useState<WorkspaceMemberDto | null>(null);
  const [pendingInvitation, setPendingInvitation] = useState<InvitationDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');

  useEffect(() => {
    if (current.data) {
      setName(current.data.name);
    }
  }, [current.data]);

  if (meta.isPending) {
    return (
      <div className="page">
        <LoadingState label="Loading workspaceâ€¦" />
      </div>
    );
  }

  if (!authEnabled) {
    return (
      <div className="page">
        <PageHeader title="Workspace" />
        <Card>
          <EmptyState
            title="Workspace management is unavailable"
            description="This deployment runs with authentication disabled and uses a single shared workspace. Set AUTH_ENABLED=true to manage workspaces, members and invitations."
          />
        </Card>
      </div>
    );
  }

  if (current.isPending) {
    return (
      <div className="page">
        <LoadingState label="Loading workspaceâ€¦" />
      </div>
    );
  }

  if (current.isError || !current.data) {
    return (
      <div className="page">
        <PageHeader title="Workspace settings" />
        <ErrorState error={current.error} onRetry={() => void current.refetch()} />
      </div>
    );
  }

  const detail = current.data;
  const members = detail.members;
  const owners = members.filter((member) => member.role === 'owner');
  const canGrantOwner = detail.role === 'owner';
  const renamed = name.trim().length > 0 && name.trim() !== detail.name;
  const invitationItems = invitations.data?.items ?? [];

  const handleRename = (event: FormEvent) => {
    event.preventDefault();
    if (!renamed) {
      return;
    }
    renameWorkspace.mutate(name.trim(), {
      onSuccess: () => toast.show('Workspace name updated.'),
      onError: (error) =>
        toast.show(messageOf(error, 'The workspace could not be renamed.'), 'danger'),
    });
  };

  const handleRoleChange = (member: WorkspaceMemberDto, role: MembershipRole) => {
    updateMemberRole.mutate(
      { membershipId: member.id, role },
      {
        onSuccess: () => toast.show(`${member.name ?? member.email ?? 'Member'} is now ${role}.`),
        onError: (error) =>
          toast.show(messageOf(error, 'The member role could not be updated.'), 'danger'),
      },
    );
  };

  const handleRemoveMember = () => {
    if (!pendingMember) {
      return;
    }
    removeMember.mutate(pendingMember.id, {
      onSuccess: () => {
        toast.show('Member removed from the workspace.');
        setPendingMember(null);
      },
      onError: (error) => {
        toast.show(messageOf(error, 'The member could not be removed.'), 'danger');
        setPendingMember(null);
      },
    });
  };

  const handleInvite = (event: FormEvent) => {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email) {
      return;
    }
    inviteMember.mutate(
      { email, role: inviteRole },
      {
        onSuccess: () => {
          toast.show(`Invitation sent to ${email}.`);
          setInviteEmail('');
          setInviteRole('member');
        },
        onError: (error) =>
          toast.show(messageOf(error, 'The invitation could not be sent.'), 'danger'),
      },
    );
  };

  const handleRevoke = () => {
    if (!pendingInvitation) {
      return;
    }
    revokeInvitation.mutate(pendingInvitation.id, {
      onSuccess: () => {
        toast.show('Invitation revoked.');
        setPendingInvitation(null);
      },
      onError: (error) => {
        toast.show(messageOf(error, 'The invitation could not be revoked.'), 'danger');
        setPendingInvitation(null);
      },
    });
  };

  const handleCreate = () => {
    const workspaceName = newWorkspaceName.trim();
    if (!workspaceName) {
      return;
    }
    createWorkspace.mutate(workspaceName, {
      onSuccess: (workspace) => {
        setCreating(false);
        setNewWorkspaceName('');
        toast.show(`Workspace â€œ${workspace.name}â€ created.`);
        activateWorkspace.mutate(workspace.id, {
          onError: (error) =>
            toast.show(messageOf(error, 'The new workspace could not be opened.'), 'danger'),
        });
      },
      onError: (error) =>
        toast.show(messageOf(error, 'The workspace could not be created.'), 'danger'),
    });
  };

  return (
    <div className="page">
      <PageHeader
        title="Workspace settings"
        description={`Rename â€œ${detail.name}â€, manage who belongs to it and invite teammates.`}
        actions={
          <button type="button" className="button" onClick={() => setCreating(true)}>
            + New workspace
          </button>
        }
      />

      {!canManage ? (
        <Alert tone="info" title="Read-only">
          You are a {ROLE_LABELS[detail.role]} of this workspace, so members and invitations can
          only be changed by an owner or admin.
        </Alert>
      ) : null}

      <Card
        title="Name"
        subtitle="The name is shown in the workspace switcher and on every page of this deployment."
      >
        <form className="workspace-form-row" onSubmit={handleRename}>
          <Field label="Workspace name" hint="Up to 80 characters.">
            <input
              className="input"
              value={name}
              maxLength={80}
              disabled={!canManage}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <button
            type="submit"
            className="button button-primary"
            disabled={!canManage || !renamed || renameWorkspace.isPending}
          >
            {renameWorkspace.isPending ? 'Savingâ€¦' : 'Save name'}
          </button>
        </form>
      </Card>

      <Card
        title="Members"
        subtitle={`${members.length} ${members.length === 1 ? 'person belongs' : 'people belong'} to this workspace.`}
      >
        <div className="table-scroll">
          <table className="table table-compact">
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Role</th>
                <th scope="col" className="table-actions">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const isLastOwner = member.role === 'owner' && owners.length === 1;
                const locked =
                  !canManage || isLastOwner || (member.role === 'owner' && !canGrantOwner);
                return (
                  <tr key={member.id}>
                    <td>
                      <div className="member-cell">
                        <span className="member-name">
                          {member.name ?? member.email ?? member.userId}
                        </span>
                        {member.name && member.email ? (
                          <span className="muted small">{member.email}</span>
                        ) : null}
                        {member.isSelf ? <Badge tone="info">You</Badge> : null}
                      </div>
                    </td>
                    <td>
                      <select
                        className="input member-role"
                        aria-label={`Role for ${member.name ?? member.email ?? member.userId}`}
                        value={member.role}
                        disabled={locked || updateMemberRole.isPending}
                        onChange={(event) =>
                          handleRoleChange(member, event.target.value as MembershipRole)
                        }
                      >
                        {ROLE_OPTIONS.map((role) => (
                          <option
                            key={role}
                            value={role}
                            disabled={role === 'owner' && !canGrantOwner}
                          >
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                      {isLastOwner ? (
                        <span className="field-hint">
                          The last owner cannot be removed or demoted.
                        </span>
                      ) : null}
                    </td>
                    <td className="table-actions">
                      <button
                        type="button"
                        className="button button-ghost small"
                        disabled={locked}
                        onClick={() => setPendingMember(member)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {canManage ? (
        <Card
          title="Invitations"
          subtitle="Invited teammates join automatically the next time they sign in with that email."
        >
          <form className="invite-form" onSubmit={handleInvite}>
            <Field label="Email">
              <input
                type="email"
                className="input"
                value={inviteEmail}
                required
                placeholder="teammate@example.com"
                onChange={(event) => setInviteEmail(event.target.value)}
              />
            </Field>
            <label className="field invite-role">
              <span className="field-label">Role</span>
              <select
                className="input"
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as MembershipRole)}
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role} disabled={role === 'owner' && !canGrantOwner}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="button button-primary"
              disabled={inviteMember.isPending || inviteEmail.trim().length === 0}
            >
              {inviteMember.isPending ? 'Sendingâ€¦' : 'Send invitation'}
            </button>
          </form>

          {invitations.isPending ? <LoadingState label="Loading invitationsâ€¦" /> : null}
          {invitations.isError ? (
            <ErrorState error={invitations.error} onRetry={() => void invitations.refetch()} />
          ) : null}
          {invitations.isSuccess && invitationItems.length === 0 ? (
            <EmptyState
              title="No pending invitations"
              description="Everyone with access is already a member."
            />
          ) : null}
          {invitationItems.length > 0 ? (
            <div className="table-scroll">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Expires</th>
                    <th scope="col" className="table-actions">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invitationItems.map((invitation) => (
                    <tr key={invitation.id}>
                      <td>{invitation.email}</td>
                      <td>
                        <Badge tone={invitation.role === 'owner' ? 'success' : 'neutral'}>
                          {ROLE_LABELS[invitation.role]}
                        </Badge>
                      </td>
                      <td className="muted small">{formatDateTime(invitation.expiresAt)}</td>
                      <td className="table-actions">
                        <button
                          type="button"
                          className="button button-ghost small"
                          onClick={() => setPendingInvitation(invitation)}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      ) : null}

      <ConfirmDialog
        open={pendingMember !== null}
        title={`Remove ${pendingMember?.name ?? pendingMember?.email ?? 'this member'}?`}
        description="They immediately lose access to this workspace and its data. You can invite them again later."
        confirmLabel="Remove member"
        busy={removeMember.isPending}
        onCancel={() => setPendingMember(null)}
        onConfirm={handleRemoveMember}
      />

      <ConfirmDialog
        open={pendingInvitation !== null}
        title={`Revoke the invitation for ${pendingInvitation?.email ?? 'this person'}?`}
        description="The invitation link stops working. You can send a new invitation at any time."
        confirmLabel="Revoke invitation"
        busy={revokeInvitation.isPending}
        onCancel={() => setPendingInvitation(null)}
        onConfirm={handleRevoke}
      />

      <ConfirmDialog
        open={creating}
        title="Create a workspace"
        description="You become its owner and can invite teammates afterwards."
        confirmLabel="Create workspace"
        tone="primary"
        busy={createWorkspace.isPending}
        confirmDisabled={newWorkspaceName.trim().length === 0}
        onCancel={() => {
          setCreating(false);
          setNewWorkspaceName('');
        }}
        onConfirm={handleCreate}
      >
        <Field label="Workspace name">
          <input
            className="input"
            value={newWorkspaceName}
            maxLength={80}
            placeholder="e.g. Acme Ops"
            onChange={(event) => setNewWorkspaceName(event.target.value)}
          />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
