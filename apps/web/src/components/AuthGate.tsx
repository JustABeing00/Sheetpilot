import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useMeta, useSession } from '../api/hooks.js';
import { LoadingState } from './ui.js';

/**
 * Renders its children only when the caller is allowed in. When the deployment has authentication
 * disabled (local/dev or a single-tenant instance), it passes straight through so nothing changes.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const meta = useMeta();
  const session = useSession();

  const checking =
    meta.isPending || (meta.data?.capabilities.authEnabled === true && session.isPending);

  if (checking) {
    return (
      <div className="page">
        <LoadingState label="Checking your session…" />
      </div>
    );
  }

  if (meta.data && !meta.data.capabilities.authEnabled) {
    return <>{children}</>;
  }

  if (!session.data) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
