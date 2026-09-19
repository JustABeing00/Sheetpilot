import { useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from '../api/auth.js';
import { useHealth, useMeta, useReviewQueue, useSession } from '../api/hooks.js';
import { useScrollReveal } from '../lib/useScrollReveal.js';

const navigation = [
  { to: '/dashboard', label: 'Dashboard', end: true },
  { to: '/saved-workflows', label: 'Saved workflows' },
  { to: '/datasets', label: 'Datasets' },
  { to: '/setup', label: 'Setup' },
  { to: '/runs', label: 'Runs' },
  { to: '/review', label: 'Review queue' },
  { to: '/rules', label: 'Rules' },
  { to: '/workflows', label: 'Workflow types' },
];

export function AppShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const meta = useMeta();
  const health = useHealth();
  const reviewQueue = useReviewQueue('needs_review');
  const session = useSession();

  const openCount = reviewQueue.data?.openCount ?? 0;
  const online = health.isSuccess;
  const authEnabled = meta.data?.capabilities.authEnabled === true;
  const user = session.data?.user ?? null;

  useScrollReveal(pathname);

  const handleSignOut = async () => {
    await signOut(`${window.location.origin}/login`);
    queryClient.clear();
    void navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <aside className="sidebar">
        <Link className="sidebar-brand" to="/dashboard">
          <span className="brand-mark" aria-hidden="true">
            SP
          </span>
          <span>
            <strong>SheetPilot</strong>
            <span className="brand-subtitle">Recurring spreadsheet workflows</span>
          </span>
        </Link>

        <nav className="sidebar-nav" aria-label="Primary">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              <span>{item.label}</span>
              {item.to === '/review' && openCount > 0 ? (
                <span className="nav-count" aria-label={`${openCount} waiting for review`}>
                  {openCount}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          {authEnabled && user ? (
            <div className="sidebar-account">
              <span className="sidebar-account-name" title={user.email ?? undefined}>
                {user.name ?? user.email ?? 'Signed in'}
              </span>
              <button
                type="button"
                className="button button-ghost small"
                onClick={() => void handleSignOut()}
              >
                Sign out
              </button>
            </div>
          ) : null}
          <div className="status-line" role="status">
            <span className={online ? 'dot dot-online' : 'dot dot-offline'} aria-hidden="true" />
            {online ? 'API connected' : 'API unreachable'}
          </div>
          <dl className="meta-list">
            <div>
              <dt>Environment</dt>
              <dd>{meta.data?.environment ?? '—'}</dd>
            </div>
            <div>
              <dt>Data store</dt>
              <dd>{meta.data?.repositoryDriver ?? '—'}</dd>
            </div>
            <div>
              <dt>Storage</dt>
              <dd>{meta.data?.storageDriver ?? '—'}</dd>
            </div>
            <div>
              <dt>AI provider</dt>
              <dd>
                {meta.data?.aiProvider === 'noop' ? 'disabled' : (meta.data?.aiProvider ?? '—')}
              </dd>
            </div>
          </dl>
        </div>
      </aside>

      <main id="main" className="content">
        <Outlet />
      </main>
    </div>
  );
}
