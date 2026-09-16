import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '../components/AppShell.js';
import { DashboardPage } from '../pages/DashboardPage.js';
import { DatasetDetailPage } from '../pages/DatasetDetailPage.js';
import { DatasetsPage } from '../pages/DatasetsPage.js';
import { NewRunPage } from '../pages/NewRunPage.js';
import { NotFoundPage } from '../pages/NotFoundPage.js';
import { ReviewQueuePage } from '../pages/ReviewQueuePage.js';
import { RulesPage } from '../pages/RulesPage.js';
import { RunDetailPage } from '../pages/RunDetailPage.js';
import { RunSavedWorkflowPage } from '../pages/RunSavedWorkflowPage.js';
import { RunsPage } from '../pages/RunsPage.js';
import { SavedWorkflowDetailPage } from '../pages/SavedWorkflowDetailPage.js';
import { SavedWorkflowsPage } from '../pages/SavedWorkflowsPage.js';
import { SetupPage } from '../pages/SetupPage.js';
import { WorkflowDetailPage } from '../pages/WorkflowDetailPage.js';
import { WorkflowsPage } from '../pages/WorkflowsPage.js';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'runs', element: <RunsPage /> },
      { path: 'runs/new', element: <NewRunPage /> },
      { path: 'runs/:runId', element: <RunDetailPage /> },
      { path: 'saved-workflows', element: <SavedWorkflowsPage /> },
      { path: 'saved-workflows/:savedWorkflowId', element: <SavedWorkflowDetailPage /> },
      { path: 'saved-workflows/:savedWorkflowId/run', element: <RunSavedWorkflowPage /> },
      { path: 'datasets', element: <DatasetsPage /> },
      { path: 'datasets/:datasetId', element: <DatasetDetailPage /> },
      { path: 'setup', element: <SetupPage /> },
      { path: 'setup/:configurationId', element: <SetupPage /> },
      { path: 'review', element: <ReviewQueuePage /> },
      { path: 'rules', element: <RulesPage /> },
      { path: 'workflows', element: <WorkflowsPage /> },
      { path: 'workflows/:slug', element: <WorkflowDetailPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
