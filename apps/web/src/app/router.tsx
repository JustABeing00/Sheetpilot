import { lazy, Suspense, type ComponentType } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '../components/AppShell.js';
import { AuthGate } from '../components/AuthGate.js';
import { RouteError } from '../components/RouteError.js';
import { LoadingState } from '../components/ui.js';
import { LandingPage } from '../pages/LandingPage.js';
import { LoginPage } from '../pages/LoginPage.js';

/**
 * Pages are code-split per route: the landing page and app shell load immediately, and each screen is
 * fetched on first visit. The fallback keeps the layout stable while a chunk loads.
 */
function page(loader: () => Promise<{ default: ComponentType }>) {
  const Component = lazy(loader);
  return (
    <Suspense
      fallback={
        <div className="page">
          <LoadingState label="Loading…" />
        </div>
      }
    >
      <Component />
    </Suspense>
  );
}

export const router = createBrowserRouter([
  { path: '/', element: <LandingPage />, errorElement: <RouteError /> },
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  {
    element: (
      <AuthGate>
        <AppShell />
      </AuthGate>
    ),
    errorElement: <RouteError />,
    children: [
      {
        path: 'dashboard',
        element: page(() =>
          import('../pages/DashboardPage.js').then((m) => ({ default: m.DashboardPage })),
        ),
      },
      {
        path: 'runs',
        element: page(() => import('../pages/RunsPage.js').then((m) => ({ default: m.RunsPage }))),
      },
      {
        path: 'runs/new',
        element: page(() =>
          import('../pages/NewRunPage.js').then((m) => ({ default: m.NewRunPage })),
        ),
      },
      {
        path: 'runs/:runId',
        element: page(() =>
          import('../pages/RunDetailPage.js').then((m) => ({ default: m.RunDetailPage })),
        ),
      },
      {
        path: 'saved-workflows',
        element: page(() =>
          import('../pages/SavedWorkflowsPage.js').then((m) => ({ default: m.SavedWorkflowsPage })),
        ),
      },
      {
        path: 'saved-workflows/:savedWorkflowId',
        element: page(() =>
          import('../pages/SavedWorkflowDetailPage.js').then((m) => ({
            default: m.SavedWorkflowDetailPage,
          })),
        ),
      },
      {
        path: 'saved-workflows/:savedWorkflowId/run',
        element: page(() =>
          import('../pages/RunSavedWorkflowPage.js').then((m) => ({
            default: m.RunSavedWorkflowPage,
          })),
        ),
      },
      {
        path: 'datasets',
        element: page(() =>
          import('../pages/DatasetsPage.js').then((m) => ({ default: m.DatasetsPage })),
        ),
      },
      {
        path: 'datasets/:datasetId',
        element: page(() =>
          import('../pages/DatasetDetailPage.js').then((m) => ({ default: m.DatasetDetailPage })),
        ),
      },
      {
        path: 'setup',
        element: page(() =>
          import('../pages/SetupPage.js').then((m) => ({ default: m.SetupPage })),
        ),
      },
      {
        path: 'setup/:configurationId',
        element: page(() =>
          import('../pages/SetupPage.js').then((m) => ({ default: m.SetupPage })),
        ),
      },
      {
        path: 'review',
        element: page(() =>
          import('../pages/ReviewQueuePage.js').then((m) => ({ default: m.ReviewQueuePage })),
        ),
      },
      {
        path: 'rules',
        element: page(() =>
          import('../pages/RulesPage.js').then((m) => ({ default: m.RulesPage })),
        ),
      },
      {
        path: 'workflows',
        element: page(() =>
          import('../pages/WorkflowsPage.js').then((m) => ({ default: m.WorkflowsPage })),
        ),
      },
      {
        path: 'workflows/:slug',
        element: page(() =>
          import('../pages/WorkflowDetailPage.js').then((m) => ({ default: m.WorkflowDetailPage })),
        ),
      },
      {
        path: '*',
        element: page(() =>
          import('../pages/NotFoundPage.js').then((m) => ({ default: m.NotFoundPage })),
        ),
      },
    ],
  },
]);
