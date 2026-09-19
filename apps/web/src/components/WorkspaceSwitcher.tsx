import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useActivateWorkspace,
  useCurrentWorkspace,
  useMeta,
  useSession,
  useWorkspaces,
} from '../api/hooks.js';
import { ApiError } from '../api/client.js';
import { useToast } from './toast-context.js';

/**
 * Sidebar control for moving between the workspaces a signed-in user belongs to. It renders nothing
 * when authentication is disabled, so single-tenant/local installs are unchanged.
 */
export function WorkspaceSwitcher() {
  const meta = useMeta();
  const session = useSession();
  const enabled = meta.data?.capabilities.authEnabled === true && Boolean(session.data);
  const workspaces = useWorkspaces(enabled);
  const current = useCurrentWorkspace(enabled);
  const activate = useActivateWorkspace();
  const toast = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Keep showing the chosen workspace until its data has actually loaded, so the select never blinks
  // back to the previous one while the switch is in flight.
  useEffect(() => {
    if (pendingId && (current.data?.id === pendingId || current.isError)) {
      setPendingId(null);
    }
  }, [pendingId, current.data, current.isError]);

  if (!enabled) {
    return null;
  }

  const items = workspaces.data?.items ?? [];
  const activeId = pendingId ?? current.data?.id ?? '';

  const handleChange = (workspaceId: string) => {
    const target = items.find((item) => item.id === workspaceId);
    setPendingId(workspaceId);
    activate.mutate(workspaceId, {
      onSuccess: () => toast.show(`Switched to ${target?.name ?? 'the selected workspace'}.`),
      onError: (error) => {
        setPendingId(null);
        toast.show(
          error instanceof ApiError ? error.message : 'The workspace could not be switched.',
          'danger',
        );
      },
    });
  };

  return (
    <div className="workspace-switcher">
      <label className="field">
        <span className="field-label">Workspace</span>
        <select
          className="input"
          value={activeId}
          disabled={activate.isPending || current.isLoading || items.length === 0}
          onChange={(event) => handleChange(event.target.value)}
        >
          {items.length === 0 ? <option value="">{current.data?.name ?? '—'}</option> : null}
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.isPersonal ? ' (personal)' : ''}
            </option>
          ))}
        </select>
      </label>
      <Link className="workspace-manage-link" to="/workspace">
        Manage workspace
      </Link>
    </div>
  );
}
