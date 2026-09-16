import { Link } from 'react-router-dom';
import { useSavedWorkflows } from '../api/hooks.js';
import { SavedWorkflowsTable } from '../components/SavedWorkflowsTable.js';
import { Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../components/ui.js';

export function SavedWorkflowsPage() {
  const savedWorkflows = useSavedWorkflows();
  const items = savedWorkflows.data?.items ?? [];

  return (
    <div className="page">
      <PageHeader
        title="Saved workflows"
        description="Reusable setups you can run again on a new day's files: the mapping, rules and options are remembered. Every run keeps its own frozen copy so past reports never change."
        actions={
          <Link className="button button-primary" to="/setup">
            New saved workflow
          </Link>
        }
      />

      {savedWorkflows.isLoading ? <LoadingState label="Loading saved workflows…" /> : null}
      {savedWorkflows.isError ? (
        <ErrorState error={savedWorkflows.error} onRetry={() => void savedWorkflows.refetch()} />
      ) : null}

      {savedWorkflows.isSuccess && items.length === 0 ? (
        <EmptyState
          title="No saved workflows yet"
          description="Set up a workflow once — choose the files, confirm the columns and the rules — then run it again whenever you have new data."
          action={
            <Link className="button button-primary" to="/setup">
              Create your first saved workflow
            </Link>
          }
        />
      ) : null}

      {items.length > 0 ? (
        <Card
          title="Your recurring workflows"
          subtitle="Latest run status, records processed, how many cases need a decision and whether the report is ready."
        >
          <SavedWorkflowsTable items={items} />
        </Card>
      ) : null}
    </div>
  );
}
