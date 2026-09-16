import { useParams } from 'react-router-dom';
import { useWorkflow } from '../api/hooks.js';
import { Card, ErrorState, KeyValue, LoadingState, PageHeader } from '../components/ui.js';
import { formatCellValue } from '../lib/format.js';
import { describeCondition } from '../lib/rules.js';

export function WorkflowDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const workflow = useWorkflow(slug);

  if (workflow.isLoading) {
    return (
      <div className="page">
        <LoadingState label="Loading workflow…" />
      </div>
    );
  }

  if (workflow.isError || !workflow.data) {
    return (
      <div className="page">
        <ErrorState error={workflow.error} onRetry={() => void workflow.refetch()} />
      </div>
    );
  }

  const definition = workflow.data;

  return (
    <div className="page">
      <PageHeader
        title={definition.name}
        description={definition.description}
        actions={<span className="mono small">v{definition.version}</span>}
      />

      <Card title="Pipeline steps" subtitle="Deterministic stages executed in order">
        <ol className="step-list">
          {definition.steps.map((step, index) => (
            <li key={step.id}>
              <span className="step-index">{index + 1}</span>
              <div>
                <strong>{step.name}</strong>
                <div className="mono small muted">{step.id}</div>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Configuration options" subtitle="Exposed to every run of this workflow">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Label</th>
                <th>Kind</th>
                <th>Default</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {definition.configFields.map((field) => (
                <tr key={field.key}>
                  <td className="mono small">{field.key}</td>
                  <td>{field.label}</td>
                  <td>{field.kind}</td>
                  <td className="mono small">{formatCellValue(field.defaultValue)}</td>
                  <td className="small muted">{field.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title={`Rule set: ${definition.ruleSet.name}`}
        subtitle={`Version ${definition.ruleSet.version} · evaluated by priority, then specificity, then rule id`}
      >
        <div className="table-scroll">
          <table className="table table-rules">
            <thead>
              <tr>
                <th>Priority</th>
                <th>Rule</th>
                <th>When</th>
                <th>Then</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {definition.ruleSet.rules.map((rule) => (
                <tr key={rule.id}>
                  <td className="mono">{rule.priority}</td>
                  <td>
                    <strong>{rule.name}</strong>
                    <div className="mono small muted">{rule.id}</div>
                  </td>
                  <td className="small">{describeCondition(rule.when)}</td>
                  <td className="small">
                    {rule.then.map((action) => (
                      <div key={`${rule.id}-${action.field}`}>
                        <span className="mono">{action.field}</span> ={' '}
                        {formatCellValue(action.value)}
                      </div>
                    ))}
                  </td>
                  <td>{Math.round(rule.confidence * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Run configuration reference">
        <KeyValue
          items={[
            { label: 'Slug', value: <span className="mono">{definition.slug}</span> },
            { label: 'Steps', value: definition.steps.length },
            { label: 'Rules', value: definition.ruleSet.rules.length },
            {
              label: 'Rule set slug',
              value: <span className="mono">{definition.ruleSet.slug}</span>,
            },
          ]}
        />
      </Card>
    </div>
  );
}
