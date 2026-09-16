import { Link, NavLink, Outlet } from 'react-router-dom';
import { useHealth, useMeta, useReviewQueue } from '../api/hooks.js';

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
  const meta = useMeta();
  const health = useHealth();
  const reviewQueue = useReviewQueue('needs_review');

  const openCount = reviewQueue.data?.openCount ?? 0;
  const online = health.isSuccess;

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
