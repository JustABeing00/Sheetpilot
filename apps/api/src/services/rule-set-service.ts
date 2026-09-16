import {
  InvalidRuleSetError,
  newId,
  NotFoundError,
  storedRuleSetSchema,
  type Clock,
  type CreateRuleSetRequest,
  type Logger,
  type Repositories,
  type RuleSetValidationResponse,
  type RuleValidationIssue,
  type StoredRuleSet,
  type UpdateRuleSetRequest,
  type ValidateRuleSetRequest,
} from '@sheetpilot/core';
import { validateRuleSet } from '@sheetpilot/rule-engine';
import type { WorkflowRegistry } from '@sheetpilot/workflow-engine';

export interface RuleSetServiceDeps {
  repositories: Repositories;
  registry: WorkflowRegistry;
  clock: Clock;
  logger: Logger;
}

/**
 * Application service for the rule-management layer. Rules are data: the service validates them with
 * the pure rule-engine validator (never trusting the UI), versions them on every save, and keeps a
 * single active rule set per workflow so a run always has one unambiguous source of truth.
 */
export class RuleSetService {
  constructor(private readonly deps: RuleSetServiceDeps) {}

  async list(workflowSlug?: string): Promise<StoredRuleSet[]> {
    return workflowSlug
      ? this.deps.repositories.ruleSets.listByWorkflowSlug(workflowSlug)
      : this.deps.repositories.ruleSets.list();
  }

  async getById(id: string): Promise<StoredRuleSet> {
    const ruleSet = await this.deps.repositories.ruleSets.getById(id);
    if (!ruleSet) {
      throw new NotFoundError('Rule set', id);
    }
    return ruleSet;
  }

  async getActiveForWorkflow(workflowSlug: string): Promise<StoredRuleSet | null> {
    return this.deps.repositories.ruleSets.getActiveByWorkflowSlug(workflowSlug);
  }

  validate(input: ValidateRuleSetRequest): Promise<RuleSetValidationResponse> {
    this.deps.registry.require(input.workflowSlug);
    const issues = validateRuleSet({ rules: input.rules });
    return Promise.resolve({ valid: !hasErrors(issues), issues });
  }

  async create(input: CreateRuleSetRequest): Promise<StoredRuleSet> {
    const workflow = this.deps.registry.require(input.workflowSlug);
    const issues = validateRuleSet({ rules: input.rules });
    this.assertValid(issues);

    const now = this.deps.clock.now();
    const ruleSet = storedRuleSetSchema.parse({
      id: newId(),
      slug: `${workflow.slug}-custom`,
      workflowSlug: workflow.slug,
      name: input.name,
      version: 1,
      active: input.activate,
      rules: input.rules,
      createdAt: now,
      updatedAt: now,
    });

    if (ruleSet.active) {
      await this.deactivateOthers(ruleSet.workflowSlug, ruleSet.id);
    }
    const saved = await this.deps.repositories.ruleSets.upsert(ruleSet);
    this.deps.logger.info(
      { ruleSetId: saved.id, workflowSlug: saved.workflowSlug, rules: saved.rules.length },
      'rule set created',
    );
    return saved;
  }

  async update(id: string, input: UpdateRuleSetRequest): Promise<StoredRuleSet> {
    const existing = await this.getById(id);
    const rules = input.rules ?? existing.rules;
    const issues = validateRuleSet({ rules });
    this.assertValid(issues);

    const active = input.active ?? existing.active;
    const updated = storedRuleSetSchema.parse({
      ...existing,
      name: input.name ?? existing.name,
      rules,
      active,
      version: existing.version + 1,
      updatedAt: this.deps.clock.now(),
    });

    if (updated.active) {
      await this.deactivateOthers(updated.workflowSlug, updated.id);
    }
    const saved = await this.deps.repositories.ruleSets.upsert(updated);
    this.deps.logger.info(
      { ruleSetId: saved.id, version: saved.version, active: saved.active },
      'rule set updated',
    );
    return saved;
  }

  private assertValid(issues: RuleValidationIssue[]): void {
    if (hasErrors(issues)) {
      throw new InvalidRuleSetError(
        'The rule set has validation errors that must be resolved before it can be saved.',
        { issues },
      );
    }
  }

  private async deactivateOthers(workflowSlug: string, keepId: string): Promise<void> {
    const siblings = await this.deps.repositories.ruleSets.listByWorkflowSlug(workflowSlug);
    for (const sibling of siblings) {
      if (sibling.id !== keepId && sibling.active) {
        await this.deps.repositories.ruleSets.upsert({
          ...sibling,
          active: false,
          updatedAt: this.deps.clock.now(),
        });
      }
    }
  }
}

function hasErrors(issues: RuleValidationIssue[]): boolean {
  return issues.some((issue) => issue.level === 'error');
}
