import { useEffect, useMemo, useState } from 'react';
import {
  ruleOperatorSchema,
  type ConditionNode,
  type Rule,
  type RuleAction,
  type RuleCondition,
  type RuleConditionScope,
  type RuleOperator,
  type RuleValidationIssue,
} from '@sheetpilot/core';
import {
  useCreateRuleSet,
  useRuleSet,
  useRuleSets,
  useUpdateRuleSet,
  useValidateRuleSet,
  useWorkflows,
} from '../api/hooks.js';
import { ApiError } from '../api/client.js';
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../components/ui.js';
import {
  CONDITION_SCOPE_LABELS,
  OPERATORS_WITHOUT_VALUE,
  OPERATORS_WITH_LIST_VALUE,
  OPERATOR_LABELS,
} from '../lib/rules.js';

const OPERATORS = ruleOperatorSchema.options;
const SCOPES: RuleConditionScope[] = ['latest', 'any_event', 'all_events'];

function newLeaf(): RuleCondition {
  return {
    field: 'description',
    operator: 'contains',
    value: '',
    caseSensitive: false,
    scope: 'latest',
  };
}

function newGroup(): ConditionNode {
  return { mode: 'any', conditions: [newLeaf()] };
}

function valueToInput(condition: RuleCondition): string {
  if (Array.isArray(condition.value)) {
    return condition.value.join(', ');
  }
  return condition.value === null || condition.value === undefined ? '' : String(condition.value);
}

function inputToValue(operator: RuleOperator, raw: string): RuleCondition['value'] {
  if (OPERATORS_WITH_LIST_VALUE.has(operator)) {
    return raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  if (OPERATORS_WITHOUT_VALUE.has(operator)) {
    return null;
  }
  return raw;
}

function ConditionEditor({
  node,
  onChange,
  onRemove,
}: {
  node: ConditionNode;
  onChange: (next: ConditionNode) => void;
  onRemove?: () => void;
}) {
  if ('mode' in node) {
    return (
      <div className="condition-group">
        <div className="condition-toolbar">
          <select
            className="input condition-mode"
            value={node.mode}
            onChange={(event) => onChange({ ...node, mode: event.target.value as 'all' | 'any' })}
          >
            <option value="all">Match ALL of</option>
            <option value="any">Match ANY of</option>
          </select>
          <button
            type="button"
            className="button button-ghost small"
            onClick={() => onChange({ ...node, conditions: [...node.conditions, newLeaf()] })}
          >
            + Condition
          </button>
          <button
            type="button"
            className="button button-ghost small"
            onClick={() => onChange({ ...node, conditions: [...node.conditions, newGroup()] })}
          >
            + Group
          </button>
          {onRemove ? (
            <button type="button" className="button button-ghost small" onClick={onRemove}>
              Remove group
            </button>
          ) : null}
        </div>
        <div className="condition-children">
          {node.conditions.map((child, index) => (
            <ConditionEditor
              key={index}
              node={child}
              onChange={(next) =>
                onChange({
                  ...node,
                  conditions: node.conditions.map((entry, position) =>
                    position === index ? next : entry,
                  ),
                })
              }
              onRemove={() =>
                onChange({
                  ...node,
                  conditions: node.conditions.filter((_entry, position) => position !== index),
                })
              }
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="condition-leaf">
      <input
        className="input condition-field"
        value={node.field}
        placeholder="field"
        onChange={(event) => onChange({ ...node, field: event.target.value })}
      />
      <select
        className="input condition-scope"
        value={node.scope}
        onChange={(event) => onChange({ ...node, scope: event.target.value as RuleConditionScope })}
      >
        {SCOPES.map((scope) => (
          <option key={scope} value={scope}>
            in {CONDITION_SCOPE_LABELS[scope]}
          </option>
        ))}
      </select>
      <select
        className="input condition-operator"
        value={node.operator}
        onChange={(event) => {
          const operator = event.target.value as RuleOperator;
          onChange({ ...node, operator, value: inputToValue(operator, valueToInput(node)) });
        }}
      >
        {OPERATORS.map((operator) => (
          <option key={operator} value={operator}>
            {OPERATOR_LABELS[operator]}
          </option>
        ))}
      </select>
      {OPERATORS_WITHOUT_VALUE.has(node.operator) ? null : (
        <input
          className="input condition-value"
          value={valueToInput(node)}
          placeholder={OPERATORS_WITH_LIST_VALUE.has(node.operator) ? 'a, b, c' : 'value'}
          onChange={(event) =>
            onChange({ ...node, value: inputToValue(node.operator, event.target.value) })
          }
        />
      )}
      <label className="checkbox-field compact">
        <input
          type="checkbox"
          checked={node.caseSensitive}
          onChange={(event) => onChange({ ...node, caseSensitive: event.target.checked })}
        />
        Case sensitive
      </label>
      {onRemove ? (
        <button type="button" className="button button-ghost small" onClick={onRemove}>
          Remove
        </button>
      ) : null}
    </div>
  );
}

function ActionsEditor({
  actions,
  onChange,
}: {
  actions: RuleAction[];
  onChange: (next: RuleAction[]) => void;
}) {
  return (
    <div className="action-list">
      {actions.map((action, index) => (
        <div key={index} className="action-row">
          <select
            className="input action-type"
            value={action.type}
            onChange={(event) =>
              onChange(
                actions.map((entry, position) =>
                  position === index
                    ? { ...entry, type: event.target.value as RuleAction['type'] }
                    : entry,
                ),
              )
            }
          >
            <option value="set">set</option>
            <option value="set_if_empty">set if empty</option>
          </select>
          <input
            className="input action-field"
            value={action.field}
            placeholder="output field"
            onChange={(event) =>
              onChange(
                actions.map((entry, position) =>
                  position === index ? { ...entry, field: event.target.value } : entry,
                ),
              )
            }
          />
          <span className="mono muted">=</span>
          <input
            className="input action-value"
            value={action.value === null || action.value === undefined ? '' : String(action.value)}
            placeholder="value"
            onChange={(event) =>
              onChange(
                actions.map((entry, position) =>
                  position === index ? { ...entry, value: event.target.value } : entry,
                ),
              )
            }
          />
          <button
            type="button"
            className="button button-ghost small"
            onClick={() => onChange(actions.filter((_entry, position) => position !== index))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button button-ghost small"
        onClick={() => onChange([...actions, { type: 'set', field: 'RootCause', value: '' }])}
      >
        + Output field
      </button>
    </div>
  );
}

function RuleEditor({
  rule,
  index,
  issues,
  onChange,
  onRemove,
}: {
  rule: Rule;
  index: number;
  issues: RuleValidationIssue[];
  onChange: (next: Rule) => void;
  onRemove: () => void;
}) {
  const ruleIssues = issues.filter((issue) => issue.ruleId === rule.id);
  return (
    <div className="rule-card">
      <div className="rule-card-header">
        <span className="step-index">{index + 1}</span>
        <input
          className="input rule-name"
          value={rule.name}
          aria-label="Rule name"
          onChange={(event) => onChange({ ...rule, name: event.target.value })}
        />
        <label className="checkbox-field compact">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(event) => onChange({ ...rule, enabled: event.target.checked })}
          />
          Enabled
        </label>
        <label className="inline-field">
          <span className="field-label">Priority</span>
          <input
            className="input priority"
            type="number"
            value={rule.priority}
            onChange={(event) => onChange({ ...rule, priority: Number(event.target.value) || 0 })}
          />
        </label>
        <label className="inline-field">
          <span className="field-label">Confidence</span>
          <input
            className="input confidence"
            type="number"
            step="0.05"
            min="0"
            max="1"
            value={rule.confidence}
            onChange={(event) => onChange({ ...rule, confidence: Number(event.target.value) || 0 })}
          />
        </label>
        <button type="button" className="button button-ghost small" onClick={onRemove}>
          Delete rule
        </button>
      </div>

      <div className="rule-id mono small muted">{rule.id}</div>

      <div className="field">
        <span className="field-label">When</span>
        <ConditionEditor node={rule.when} onChange={(when) => onChange({ ...rule, when })} />
      </div>

      <div className="field">
        <span className="field-label">Then set</span>
        <ActionsEditor actions={rule.then} onChange={(then) => onChange({ ...rule, then })} />
      </div>

      <div className="field-grid">
        <label className="field">
          <span className="field-label">Explanation shown to reviewers</span>
          <input
            className="input"
            value={rule.explanationTemplate}
            placeholder="e.g. Term {matchedTerm} indicates power loss"
            onChange={(event) => onChange({ ...rule, explanationTemplate: event.target.value })}
          />
          <span className="field-hint">
            Use {'{matchedTerm}'}, {'{ruleName}'} or any evaluated field name.
          </span>
        </label>
        <label className="field">
          <span className="field-label">Tags (comma separated)</span>
          <input
            className="input"
            value={rule.tags.join(', ')}
            onChange={(event) =>
              onChange({
                ...rule,
                tags: event.target.value
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter((tag) => tag.length > 0),
              })
            }
          />
        </label>
      </div>

      {ruleIssues.length > 0 ? (
        <ul className="issue-list">
          {ruleIssues.map((issue, position) => (
            <li
              key={position}
              className={issue.level === 'error' ? 'issue-error' : 'issue-warning'}
            >
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function RulesPage() {
  const workflows = useWorkflows();
  const [workflowSlug, setWorkflowSlug] = useState<string>('');
  const ruleSets = useRuleSets(workflowSlug || undefined);
  const [selectedId, setSelectedId] = useState<string>('');
  const ruleSet = useRuleSet(selectedId || undefined);

  const [draft, setDraft] = useState<Rule[]>([]);
  const [baseline, setBaseline] = useState<string>('[]');
  const [issues, setIssues] = useState<RuleValidationIssue[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const validateRuleSet = useValidateRuleSet();
  const updateRuleSet = useUpdateRuleSet();
  const createRuleSet = useCreateRuleSet();

  useEffect(() => {
    if (!workflowSlug && workflows.data?.items[0]) {
      setWorkflowSlug(workflows.data.items[0].slug);
    }
  }, [workflows.data, workflowSlug]);

  useEffect(() => {
    const items = ruleSets.data?.items ?? [];
    if (items.length === 0) {
      return;
    }
    if (!items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0]!.id);
    }
  }, [ruleSets.data, selectedId]);

  useEffect(() => {
    if (ruleSet.data) {
      setDraft(ruleSet.data.rules);
      setBaseline(JSON.stringify(ruleSet.data.rules));
      setIssues([]);
      setNotice(null);
    }
  }, [ruleSet.data]);

  const dirty = useMemo(() => JSON.stringify(draft) !== baseline, [draft, baseline]);
  const activeRuleSet = ruleSets.data?.items.find((item) => item.active);
  const selected = ruleSet.data;

  if (workflows.isLoading || ruleSets.isLoading) {
    return (
      <div className="page">
        <LoadingState label="Loading rules…" />
      </div>
    );
  }

  if (workflows.isError || ruleSets.isError) {
    return (
      <div className="page">
        <ErrorState
          error={workflows.error ?? ruleSets.error}
          onRetry={() => {
            void workflows.refetch();
            void ruleSets.refetch();
          }}
        />
      </div>
    );
  }

  const updateRule = (index: number, next: Rule) =>
    setDraft((current) => current.map((rule, position) => (position === index ? next : rule)));
  const removeRule = (index: number) =>
    setDraft((current) => current.filter((_rule, position) => position !== index));
  const addRule = () =>
    setDraft((current) => [
      ...current,
      {
        id: `custom-${Date.now()}`,
        name: 'New rule',
        description: '',
        enabled: true,
        priority: 50,
        when: newGroup(),
        then: [{ type: 'set', field: 'RootCause', value: '' }],
        confidence: 0.8,
        explanationTemplate: '',
        tags: [],
      },
    ]);

  const handleValidate = async () => {
    setNotice(null);
    try {
      const result = await validateRuleSet.mutateAsync({
        workflowSlug: selected?.workflowSlug ?? workflowSlug,
        rules: draft,
      });
      setIssues(result.issues);
      setNotice(result.valid ? 'No blocking errors found.' : 'Blocking errors found.');
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : 'Validation failed.');
    }
  };

  const handleSave = async () => {
    if (!selected) {
      return;
    }
    setNotice(null);
    try {
      const saved = await updateRuleSet.mutateAsync({
        id: selected.id,
        body: { rules: draft, active: true },
      });
      setDraft(saved.rules);
      setBaseline(JSON.stringify(saved.rules));
      setIssues([]);
      setNotice(`Saved as version ${saved.version} and set active.`);
    } catch (error) {
      if (error instanceof ApiError && Array.isArray(error.details)) {
        setIssues(error.details as RuleValidationIssue[]);
      }
      setNotice(error instanceof ApiError ? error.message : 'Save failed.');
    }
  };

  const handleCreateRuleSet = async () => {
    if (!workflowSlug) {
      return;
    }
    setNotice(null);
    try {
      const created = await createRuleSet.mutateAsync({
        workflowSlug,
        name: `Custom rules ${new Date().toLocaleDateString()}`,
        rules: draft,
        activate: true,
      });
      setSelectedId(created.id);
      setNotice(`Created a new active rule set (version ${created.version}).`);
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : 'Create failed.');
    }
  };

  const globalIssues = issues.filter((issue) => !issue.ruleId);

  return (
    <div className="page">
      <PageHeader
        title="Rules"
        description="Deterministic business rules. Everything here is data — no code — and is validated before it can be saved."
      />

      <Card title="Rule set" subtitle="One active rule set per workflow is used by every new run.">
        <div className="field-grid">
          <label className="field">
            <span className="field-label">Workflow</span>
            <select
              className="input"
              value={workflowSlug}
              onChange={(event) => {
                setWorkflowSlug(event.target.value);
                setSelectedId('');
              }}
            >
              {(workflows.data?.items ?? []).map((workflow) => (
                <option key={workflow.slug} value={workflow.slug}>
                  {workflow.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Rule set</span>
            <select
              className="input"
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {(ruleSets.data?.items ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · v{item.version}
                  {item.active ? ' (active)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-actions rule-summary">
          {activeRuleSet ? <Badge tone="success">Active: {activeRuleSet.name}</Badge> : null}
          {selected ? <span className="muted small">{selected.rules.length} rules</span> : null}
          {dirty ? <Badge tone="warning">Unsaved changes</Badge> : null}
          <button type="button" className="button" onClick={() => void handleValidate()}>
            Validate
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={!selected || !dirty || updateRuleSet.isPending}
            onClick={() => void handleSave()}
          >
            Save new version
          </button>
          <button
            type="button"
            className="button button-ghost"
            disabled={!workflowSlug || createRuleSet.isPending}
            onClick={() => void handleCreateRuleSet()}
          >
            Save as a new rule set
          </button>
        </div>
        {notice ? <p className="rule-notice small">{notice}</p> : null}
        {globalIssues.length > 0 ? (
          <ul className="issue-list">
            {globalIssues.map((issue, position) => (
              <li
                key={position}
                className={issue.level === 'error' ? 'issue-error' : 'issue-warning'}
              >
                {issue.message}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {ruleSet.isLoading ? <LoadingState label="Loading rule set…" /> : null}
      {ruleSet.isError ? (
        <ErrorState error={ruleSet.error} onRetry={() => void ruleSet.refetch()} />
      ) : null}

      {selected && draft.length === 0 ? (
        <Card>
          <EmptyState
            title="This rule set has no rules"
            description="Add a rule to classify records deterministically."
            action={
              <button type="button" className="button button-primary" onClick={addRule}>
                Add rule
              </button>
            }
          />
        </Card>
      ) : null}

      {draft.map((rule, index) => (
        <RuleEditor
          key={rule.id}
          rule={rule}
          index={index}
          issues={issues}
          onChange={(next) => updateRule(index, next)}
          onRemove={() => removeRule(index)}
        />
      ))}

      {selected ? (
        <div className="form-actions">
          <button type="button" className="button" onClick={addRule}>
            + Add rule
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={!dirty || updateRuleSet.isPending}
            onClick={() => void handleSave()}
          >
            Save new version
          </button>
        </div>
      ) : null}
    </div>
  );
}
