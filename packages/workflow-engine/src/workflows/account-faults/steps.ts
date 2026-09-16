import {
  NotFoundError,
  ProcessingError,
  type ClassificationProvider,
  type ClassificationSuggestion,
  type FileAsset,
  type FileRepository,
  type FileStorage,
  type OutputValue,
  type ReviewReason,
  type ReviewSeverity,
  type RuleEvaluation,
  type RuleSet,
} from '@sheetpilot/core';
import {
  createTabularReader,
  normalizeKey,
  normalizeText,
  parseTimestamp,
  readAllRows,
  type Row,
  type TableData,
} from '@sheetpilot/file-processing';
import { applyActions, evaluateRules, type AppliedAction } from '@sheetpilot/rule-engine';
import { decideAiUsage } from '@sheetpilot/ai';
import { errorMessage } from '../../engine.js';
import type { NewDecisionRecord, NewReviewItem, StepDefinition } from '../../types.js';
import { ACCOUNT_FAULT_TAXONOMY } from './rules.js';
import {
  ACCOUNT_FAULT_BUSINESS_COLUMNS,
  ACCOUNT_FAULT_SYSTEM_COLUMNS,
  REVIEW_REASON_LABELS,
  REVIEW_REASON_ORDER,
  REVIEW_REASON_SEVERITY,
  type AccountFaultState,
  type EarlierFaultEvidence,
  type EntityDecision,
  type EventRecord,
  type PrimaryRecord,
} from './types.js';

export interface AccountFaultDeps {
  files: FileRepository;
  storage: FileStorage;
  classifier: ClassificationProvider;
}

const SEVERITY_RANK: Record<ReviewSeverity, number> = { info: 0, warning: 1, critical: 2 };

function maxSeverity(reasons: ReviewReason[]): ReviewSeverity {
  let result: ReviewSeverity = 'info';
  for (const reason of reasons) {
    const severity = REVIEW_REASON_SEVERITY[reason];
    if (SEVERITY_RANK[severity] > SEVERITY_RANK[result]) {
      result = severity;
    }
  }
  return result;
}

async function readAssetTable(
  deps: AccountFaultDeps,
  fileId: string,
  label: string,
): Promise<{ asset: FileAsset; table: TableData }> {
  const asset = await deps.files.getById(fileId);
  if (!asset) {
    throw new NotFoundError(`${label} file`, fileId);
  }
  const stream = await deps.storage.getStream(asset.storageKey);
  const table = await readAllRows(createTabularReader(asset.format), stream);
  return { asset, table };
}

function requireColumn(asset: FileAsset, columns: string[], column: string, role: string): void {
  if (!columns.includes(column)) {
    throw new ProcessingError(
      `File "${asset.originalName}" has no ${role} column "${column}". Available columns: ${columns.join(', ')}`,
      { file: asset.originalName, expectedColumn: column, availableColumns: columns },
    );
  }
}

export function createLoadPrimaryStep(deps: AccountFaultDeps): StepDefinition<AccountFaultState> {
  return {
    id: 'load-primary',
    name: 'Load primary records',
    async run(_ctx, state) {
      const { asset, table } = await readAssetTable(deps, state.input.primaryFileId, 'Primary');
      const column = state.config.primaryAccountColumn;
      requireColumn(asset, table.columns, column, 'account');

      const primaries: PrimaryRecord[] = [];
      let withoutAccount = 0;

      table.rows.forEach((row, index) => {
        const account = normalizeKey(row[column]);
        if (account.length === 0) {
          withoutAccount += 1;
          return;
        }
        primaries.push({
          rowIndex: index + 2,
          account,
          accountRaw: normalizeText(row[column]),
          row,
        });
      });

      return {
        state: {
          primaries,
          primaryColumns: table.columns,
          primaryRowsWithoutAccount: withoutAccount,
        },
        metrics: {
          rows: table.rows.length,
          primaryRecords: primaries.length,
          rowsWithoutAccount: withoutAccount,
        },
      };
    },
  };
}

export function createLoadEventsStep(deps: AccountFaultDeps): StepDefinition<AccountFaultState> {
  return {
    id: 'load-events',
    name: 'Load fault events',
    async run(_ctx, state) {
      const { asset, table } = await readAssetTable(deps, state.input.eventsFileId, 'Events');
      const accountColumn = state.config.eventsAccountColumn;
      const timestampColumn = state.config.eventsTimestampColumn;
      const descriptionColumn = state.config.eventsDescriptionColumn;

      requireColumn(asset, table.columns, accountColumn, 'account');
      requireColumn(asset, table.columns, timestampColumn, 'timestamp');
      requireColumn(asset, table.columns, descriptionColumn, 'description');

      const events: EventRecord[] = [];
      let withoutAccount = 0;
      let withoutTimestamp = 0;

      table.rows.forEach((row, index) => {
        const account = normalizeKey(row[accountColumn]);
        if (account.length === 0) {
          withoutAccount += 1;
          return;
        }
        const timestampRaw = normalizeText(row[timestampColumn]);
        const occurredAt = parseTimestamp(row[timestampColumn], {
          dayFirst: state.config.dayFirstDates,
        });
        if (occurredAt === null && timestampRaw.length > 0) {
          withoutTimestamp += 1;
        }
        events.push({
          rowIndex: index + 2,
          account,
          accountRaw: normalizeText(row[accountColumn]),
          occurredAt,
          occurredAtRaw: timestampRaw,
          description: normalizeText(row[descriptionColumn]),
          row,
        });
      });

      return {
        state: { events, eventsWithoutTimestamp: withoutTimestamp },
        metrics: {
          rows: table.rows.length,
          events: events.length,
          rowsWithoutAccount: withoutAccount,
          unparsedTimestamps: withoutTimestamp,
        },
      };
    },
  };
}

export function createGroupEventsStep(): StepDefinition<AccountFaultState> {
  return {
    id: 'group-events',
    name: 'Group events by account',
    run: (_ctx, state) => {
      const byAccount = new Map<
        string,
        { account: string; primaries: PrimaryRecord[]; events: EventRecord[] }
      >();

      for (const primary of state.primaries) {
        let group = byAccount.get(primary.account);
        if (!group) {
          group = { account: primary.account, primaries: [], events: [] };
          byAccount.set(primary.account, group);
        }
        group.primaries.push(primary);
      }

      const orphanAccounts = new Set<string>();
      for (const event of state.events) {
        const group = byAccount.get(event.account);
        if (group) {
          group.events.push(event);
        } else {
          orphanAccounts.add(event.account);
        }
      }

      const groups = [...byAccount.values()];

      return Promise.resolve({
        state: { groups, orphanEventAccounts: orphanAccounts.size },
        metrics: {
          accounts: groups.length,
          accountsWithEvents: groups.filter((group) => group.events.length > 0).length,
          orphanEventAccounts: orphanAccounts.size,
        },
      });
    },
  };
}

function sortEventsDescending(events: EventRecord[]): EventRecord[] {
  return [...events].sort((left, right) => {
    const leftTime = left.occurredAt?.getTime() ?? null;
    const rightTime = right.occurredAt?.getTime() ?? null;
    if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    if (leftTime !== null && rightTime === null) {
      return -1;
    }
    if (leftTime === null && rightTime !== null) {
      return 1;
    }
    return right.rowIndex - left.rowIndex;
  });
}

function detectLatestTie(sorted: EventRecord[]): boolean {
  const [first, second] = sorted;
  if (!first?.occurredAt || !second?.occurredAt) {
    return false;
  }
  return first.occurredAt.getTime() === second.occurredAt.getTime();
}

export function buildRuleContext(
  account: string,
  latest: EventRecord,
  faultCount: number,
): Record<string, unknown> {
  return {
    ...latest.row,
    account,
    accountRaw: latest.accountRaw,
    description: normalizeText(latest.description),
    faultCount,
    occurredAt: latest.occurredAt?.toISOString() ?? '',
  };
}

function rootCauseForEvent(
  rules: RuleSet,
  account: string,
  event: EventRecord,
  faultCount: number,
): string | null {
  const result = evaluateRules(rules.rules, buildRuleContext(account, event, faultCount));
  if (!result.winner) {
    return null;
  }
  const action = result.winner.then.find((entry) => entry.field === 'RootCause');
  if (!action || action.value === null) {
    return null;
  }
  return String(action.value);
}

function emptyEvaluation(): RuleEvaluation {
  return {
    matchedRuleIds: [],
    winnerRuleId: null,
    confidence: 0,
    explanation: '',
    conflicts: [],
    evaluatedRuleCount: 0,
  };
}

export function createClassifyStep(deps: AccountFaultDeps): StepDefinition<AccountFaultState> {
  return {
    id: 'classify',
    name: 'Select latest fault and apply classification rules',
    async run(ctx, state) {
      const decisions: EntityDecision[] = [];

      for (const group of state.groups) {
        const sorted = sortEventsDescending(group.events);
        const latest = sorted[0] ?? null;
        const reviewReasons: ReviewReason[] = [];

        if (group.primaries.length > 1) {
          reviewReasons.push('duplicate_primary_key');
        }
        if (group.events.length === 0) {
          reviewReasons.push('no_events');
        }
        if (detectLatestTie(sorted)) {
          reviewReasons.push('ambiguous_latest_timestamp');
        }
        if (latest && latest.occurredAt === null && group.events.length > 1) {
          reviewReasons.push('unparsed_timestamp');
        }

        let evaluation = emptyEvaluation();
        let matchedTerm: string | null = null;
        let outputValues: Record<string, OutputValue> = {};
        let appliedActions: AppliedAction[] = [];

        if (latest) {
          const result = evaluateRules(
            state.rules.rules,
            buildRuleContext(group.account, latest, group.events.length),
          );
          evaluation = result.evaluation;
          matchedTerm = result.matched[0]?.matchedTerm ?? null;
          if (result.winner) {
            const applied = applyActions(result.winner.then, {}, { ruleId: result.winner.id });
            outputValues = applied.values;
            appliedActions = applied.applied;
          }
        }

        if (evaluation.conflicts.length > 0) {
          reviewReasons.push('rule_conflict');
        }
        if (latest && !evaluation.winnerRuleId) {
          reviewReasons.push('no_rule_match');
        }
        if (evaluation.winnerRuleId && evaluation.confidence < state.config.reviewBelowConfidence) {
          reviewReasons.push('low_confidence');
        }

        const latestRootCause = outputValues['RootCause'];
        const latestRootCauseLabel =
          latestRootCause === undefined || latestRootCause === null
            ? null
            : String(latestRootCause);

        if (latestRootCauseLabel !== null) {
          const conflicting = sorted
            .slice(1)
            .map((event) =>
              rootCauseForEvent(state.rules, group.account, event, group.events.length),
            )
            .filter(
              (rootCause): rootCause is string =>
                rootCause !== null && rootCause !== latestRootCauseLabel,
            );
          if (conflicting.length > 0) {
            reviewReasons.push('conflicting_fault_history');
          }
        }

        const aiDecision = decideAiUsage(state.config.aiPolicy, {
          ruleEvaluation: evaluation,
          confidenceThreshold: state.config.reviewBelowConfidence,
        });

        let aiConsulted = false;
        let suggestions: ClassificationSuggestion[] = [];

        if (aiDecision.shouldConsult && latest && deps.classifier.isAvailable()) {
          aiConsulted = true;
          try {
            suggestions = await deps.classifier.classify(
              {
                text: normalizeText(latest.description),
                accountKey: group.account,
                taxonomy: ACCOUNT_FAULT_TAXONOMY,
                hints: { faultCount: String(group.events.length) },
              },
              ctx.signal,
            );
          } catch (error) {
            ctx.logger.warn(
              { err: errorMessage(error), account: group.account },
              'AI classification provider failed; continuing without suggestions',
            );
          }
        }

        const earlierFaults: EarlierFaultEvidence[] = sorted
          .slice(1, 1 + state.config.maxEvidenceFaults)
          .map((event) => ({
            rowIndex: event.rowIndex,
            occurredAt: event.occurredAt?.toISOString() ?? null,
            description: event.description,
            rootCause: rootCauseForEvent(state.rules, group.account, event, group.events.length),
          }));

        const uniqueReasons = [...new Set(reviewReasons)];

        decisions.push({
          account: group.account,
          faultCount: group.events.length,
          latestFault: latest
            ? {
                rowIndex: latest.rowIndex,
                occurredAt: latest.occurredAt?.toISOString() ?? null,
                description: latest.description,
              }
            : null,
          earlierFaults,
          matchedRuleIds: evaluation.matchedRuleIds,
          matchedTerm,
          explanation: evaluation.explanation,
          conflicts: evaluation.conflicts,
          appliedActions,
          outputValues,
          confidence: evaluation.winnerRuleId ? evaluation.confidence : 0,
          ai: {
            consulted: aiConsulted,
            reason: aiDecision.shouldConsult ? aiDecision.reason : null,
            providerId: deps.classifier.id,
            suggestions,
          },
          reviewReasons: uniqueReasons,
          severity: uniqueReasons.length > 0 ? maxSeverity(uniqueReasons) : null,
        });
      }

      return {
        state: { decisions },
        metrics: {
          accounts: decisions.length,
          accountsWithRuleMatch: decisions.filter((decision) => decision.matchedRuleIds.length > 0)
            .length,
          accountsFlaggedForReview: decisions.filter(
            (decision) => decision.reviewReasons.length > 0,
          ).length,
          aiConsultedAccounts: decisions.filter((decision) => decision.ai.consulted).length,
        },
      };
    },
  };
}

function buildEvidence(decision: EntityDecision): Record<string, unknown> {
  return {
    faultCount: decision.faultCount,
    latestFault: decision.latestFault,
    earlierFaults: decision.earlierFaults,
    matchedRuleIds: decision.matchedRuleIds,
    matchedTerm: decision.matchedTerm,
    explanation: decision.explanation,
    conflicts: decision.conflicts,
    ai: decision.ai,
  };
}

function buildReviewItem(decision: EntityDecision): NewReviewItem {
  const primaryReason =
    REVIEW_REASON_ORDER.find((reason) => decision.reviewReasons.includes(reason)) ??
    decision.reviewReasons[0];
  if (!primaryReason) {
    throw new ProcessingError(
      `Review item requested for account '${decision.account}' without reasons`,
    );
  }

  const detailParts = decision.reviewReasons.map((reason) => REVIEW_REASON_LABELS[reason]);
  if (decision.explanation.length > 0) {
    detailParts.push(decision.explanation);
  }

  return {
    entityKey: decision.account,
    reason: primaryReason,
    severity: decision.severity ?? 'warning',
    title: REVIEW_REASON_LABELS[primaryReason],
    detail: detailParts.join(' | '),
    suggestedValues: decision.outputValues,
    evidence: { ...buildEvidence(decision), reasons: decision.reviewReasons },
  };
}

function computeStats(state: AccountFaultState): Record<string, number> {
  const accounts = state.groups.length;
  const withEvents = state.groups.filter((group) => group.events.length > 0).length;
  const ruleMatched = state.decisions.filter(
    (decision) => decision.matchedRuleIds.length > 0,
  ).length;
  const autoApproved = state.decisions.filter(
    (decision) => decision.reviewReasons.length === 0,
  ).length;
  const duplicatePrimaries = state.groups.filter((group) => group.primaries.length > 1).length;
  const rate = (value: number, total: number): number =>
    total === 0 ? 0 : Number((value / total).toFixed(4));

  return {
    primaryRows: state.primaries.length,
    primaryRowsWithoutAccount: state.primaryRowsWithoutAccount,
    eventRows: state.events.length,
    eventsWithoutTimestamp: state.eventsWithoutTimestamp,
    accounts,
    accountsWithEvents: withEvents,
    accountsWithoutEvents: accounts - withEvents,
    duplicatePrimaryAccounts: duplicatePrimaries,
    orphanEventAccounts: state.orphanEventAccounts,
    ruleMatchedAccounts: ruleMatched,
    autoApprovedAccounts: autoApproved,
    reviewAccounts: state.decisions.length - autoApproved,
    aiConsultedAccounts: state.decisions.filter((decision) => decision.ai.consulted).length,
    ruleMatchRate: rate(ruleMatched, accounts),
    autoApprovalRate: rate(autoApproved, accounts),
    outputRows: state.outputRows.length,
  };
}

export function createBuildOutputStep(): StepDefinition<AccountFaultState> {
  return {
    id: 'build-output',
    name: 'Build output rows and review queue',
    run: (_ctx, state) => {
      const selectedPrimaryColumns =
        state.config.primaryOutputColumns.length > 0
          ? state.primaryColumns.filter((column) =>
              state.config.primaryOutputColumns.includes(column),
            )
          : state.primaryColumns;
      const businessColumns = ACCOUNT_FAULT_BUSINESS_COLUMNS.filter(
        (column) => !selectedPrimaryColumns.includes(column),
      );
      const systemColumns = state.config.includeSystemColumns
        ? [...ACCOUNT_FAULT_SYSTEM_COLUMNS]
        : [];
      const outputColumns = [...selectedPrimaryColumns, ...businessColumns, ...systemColumns];

      const decisionByAccount = new Map(
        state.decisions.map((decision) => [decision.account, decision]),
      );
      const outputRows: Row[] = [];
      const reviewItems: NewReviewItem[] = [];
      const decisionRecords: NewDecisionRecord[] = [];

      for (const group of state.groups) {
        const decision = decisionByAccount.get(group.account);
        if (!decision) {
          continue;
        }

        for (const primary of group.primaries) {
          const row: Row = { ...primary.row };
          for (const column of ACCOUNT_FAULT_BUSINESS_COLUMNS) {
            row[column] = decision.outputValues[column] ?? '';
          }
          if (state.config.includeSystemColumns) {
            row['__FaultCount'] = decision.faultCount;
            row['__LatestFaultAt'] = decision.latestFault?.occurredAt ?? '';
            row['__MatchedRules'] = decision.matchedRuleIds.join(', ');
            row['__DecisionConfidence'] = Number(decision.confidence.toFixed(2));
            row['__ReviewStatus'] =
              decision.reviewReasons.length > 0 ? 'REVIEW_REQUIRED' : 'AUTO_APPROVED';
            row['__ReviewReasons'] = decision.reviewReasons.join(', ');
            row['__Explanation'] = decision.explanation;
          }
          outputRows.push(row);
        }

        if (decision.reviewReasons.length > 0) {
          reviewItems.push(buildReviewItem(decision));
        }

        decisionRecords.push({
          entityKey: group.account,
          matchedRuleIds: decision.matchedRuleIds,
          aiAssisted: decision.ai.suggestions.length > 0,
          confidence: decision.confidence,
          reviewReasons: decision.reviewReasons,
          outputValues: decision.outputValues,
          evidence: buildEvidence(decision),
        });
      }

      const withRows: AccountFaultState = { ...state, outputRows };
      const stats = computeStats(withRows);

      return Promise.resolve({
        state: { outputColumns, outputRows, reviewItems, decisionRecords, stats },
        metrics: { outputRows: outputRows.length, reviewItems: reviewItems.length },
      });
    },
  };
}
