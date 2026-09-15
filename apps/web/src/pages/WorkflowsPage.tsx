import { Link } from 'react-router-dom';
import { useWorkflows } from '../api/hooks.js';
import { Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../components/ui.js';

export function WorkflowsPage() {
  const workflows = useWorkflows();

  return (
    <div className="page">
      <PageHeader
        title="Workflows"
        description="Workflow definitions and their first-class, versioned rule sets."
      />

      {workflows.isLoading ? <LoadingState label="Loading workflows…" /> : null}
      {workflows.isError ? (
        <ErrorState error={workflows.error} onRetry={() => void workflows.refetch()} />
      ) : null}
      {workflows.isSuccess && workflows.data.items.length === 0 ? (
        <EmptyState title="No workflows registered" />
      ) : null}

      <div className="workflow-grid">
        {workflows.data?.items.map((workflow) => (
          <Card key={workflow.slug} className="workflow-card">
            <div className="workflow-card-body">
              <h3>{workflow.name}</h3>
              <p className="muted">{workflow.description}</p>
              <div className="workflow-card-meta">
                <span className="mono small">v{workflow.version}</span>
                <span className="muted small">{workflow.steps.length} steps</span>
                <span className="muted small">{workflow.ruleCount} rules</span>
              </div>
              <Link className="button" to={`/workflows/${workflow.slug}`}>
                View definition
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
