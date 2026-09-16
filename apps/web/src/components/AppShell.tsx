import { NavLink, Outlet } from 'react-router-dom';
import { useHealth, useMeta, useReviewQueue } from '../api/hooks.js';

const navigation = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/datasets', label: 'Datasets' },
  { to: '/runs/new', label: 'New run' },
  { to: '/runs', label: 'Runs' },
  { to: '/review', label: 'Review queue' },
  { to: '/workflows', label: 'Workflows' },
];

export function AppShell() {
  const meta = useMeta();
  const health = useHealth();
  const reviewQueue = useReviewQueue('open');

  const openCount = reviewQueue.data?.openCount ?? 0;
  const online = health.isSuccess;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">SP</span>
          <div>
            <strong>SheetPilot</strong>
            <span className="brand-subtitle">Recurring spreadsheet workflows</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              <span>{item.label}</span>
              {item.to === '/review' && openCount > 0 ? (
                <span className="nav-count">{openCount}</span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="status-line">
            <span className={online ? 'dot dot-online' : 'dot dot-offline'} />
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

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
