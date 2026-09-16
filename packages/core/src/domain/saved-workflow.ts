import { z } from 'zod';
import type { RunStatus } from './enums.js';
import type { DatasetProfile } from './dataset.js';
import type { ExportStatus } from './output.js';
import type { StoredRuleSet } from './rules.js';
import {
  columnMappingSchema,
  datasetAssignmentSchema,
  type WorkflowConfiguration,
} from './workflow-config.js';

/**
 * A saved workflow is the user-facing, reusable unit of work: a named, versioned setup built on a
 * registered workflow template. It remembers which datasets play which roles, how their columns map,
 * the active rules and the output/review options, and it can be re-pointed at a new day's files without
 * redoing the configuration. Runs always reference the exact saved version they started from.
 *
 * The aggregate below is derived on read (never stored); `rebindConfiguration` is the pure recipe that
 * carries a saved mapping onto a new set of files.
 */

export const rebindPlanSchema = z.object({
  assignments: z.array(datasetAssignmentSchema),
  mappings: z.array(columnMappingSchema),
  /** Mappings that could be carried onto the new file because a matching column name was found. */
  carried: z.array(z.object({ role: z.string(), column: z.string() })),
  /** Mappings that had to be dropped because the new file has no column with that name. */
  dropped: z.array(z.object({ role: z.string(), column: z.string(), reason: z.string() })),
  /** Which dataset role was re-pointed, from the previous file to the new one. */
  datasetChanges: z.array(
    z.object({
      role: z.string(),
      previousDatasetId: z.string().nullable(),
      datasetId: z.string(),
    }),
  ),
});
export type RebindPlan = z.infer<typeof rebindPlanSchema>;

export interface RebindConfigurationInput {
  configuration: WorkflowConfiguration;
  /** Dataset role → new dataset the user attached (only the roles they supplied are re-pointed). */
  requested: Array<{ role: string; datasetId: string; sheetName?: string | null }>;
  datasets: DatasetProfile[];
}

/**
 * Carries a saved workflow's mapping onto a new set of files. Column mappings are remembered by
 * **column name**: when the new file still has a column with the same name the mapping is carried,
 * otherwise it is dropped and reported so the UI can ask the user to re-map just that role. No
 * dataset/column names are ever hard-coded here — the same recipe works for any workflow.
 */
export function rebindConfiguration(input: RebindConfigurationInput): RebindPlan {
  const { configuration, requested } = input;
  const datasetById = new Map(input.datasets.map((dataset) => [dataset.id, dataset]));

  const requestedByRole = new Map(requested.map((entry) => [entry.role, entry]));

  const assignments = configuration.assignments.map((assignment) => {
    const next = requestedByRole.get(assignment.role);
    if (!next) {
      return assignment;
    }
    return {
      role: assignment.role,
      datasetId: next.datasetId,
      sheetName: next.sheetName ?? null,
    };
  });

  // Re-pointing a role may also re-point every mapping that referenced its previous dataset.
  const datasetRemap = new Map<string, string>();
  const sheetByDatasetId = new Map<string, string | null>();
  for (const assignment of assignments) {
    sheetByDatasetId.set(assignment.datasetId, assignment.sheetName);
  }
  for (const previous of configuration.assignments) {
    const next = requestedByRole.get(previous.role);
    if (next && next.datasetId !== previous.datasetId) {
      datasetRemap.set(previous.datasetId, next.datasetId);
    }
  }

  const carried: Array<{ role: string; column: string }> = [];
  const dropped: Array<{ role: string; column: string; reason: string }> = [];
  const mappings = configuration.mappings.flatMap((mapping) => {
    // A mapping on a dataset the user did not touch is kept verbatim; only a re-pointed mapping has
    // to prove that the new file still has a column with the remembered name.
    if (!datasetRemap.has(mapping.datasetId)) {
      carried.push({ role: mapping.role, column: mapping.column });
      return [mapping];
    }

    const datasetId = datasetRemap.get(mapping.datasetId)!;
    const dataset = datasetById.get(datasetId);
    const column = dataset?.columns.find((entry) => entry.name === mapping.column);

    if (dataset && column) {
      carried.push({ role: mapping.role, column: mapping.column });
      return [
        {
          role: mapping.role,
          datasetId,
          sheetName: sheetByDatasetId.get(datasetId) ?? null,
          column: mapping.column,
          // Re-pointing re-validates the mapping against the new file from scratch.
          confirmed: false,
        },
      ];
    }

    dropped.push({
      role: mapping.role,
      column: mapping.column,
      reason: dataset ? 'column_not_found' : 'dataset_not_found',
    });
    return [];
  });

  const datasetChanges = configuration.assignments.flatMap((previous) => {
    const next = requestedByRole.get(previous.role);
    if (!next || next.datasetId === previous.datasetId) {
      return [];
    }
    return [
      {
        role: previous.role,
        previousDatasetId: previous.datasetId,
        datasetId: next.datasetId,
      },
    ];
  });

  return rebindPlanSchema.parse({ assignments, mappings, carried, dropped, datasetChanges });
}

/** Compact rule-set reference shown on the saved-workflow dashboard. */
export interface SavedWorkflowRuleSetSummary {
  id: string;
  name: string;
  version: number;
  ruleCount: number;
  active: boolean;
}

/** The outcome of the most recent run of a saved workflow, in dashboard-friendly terms. */
export interface SavedWorkflowLastRun {
  id: string;
  status: RunStatus;
  createdAt: Date;
  finishedAt: Date | null;
  recordsProcessed: number;
  reviewItemCount: number;
  openReviewItemCount: number;
  exportStatus: ExportStatus;
  exportReady: boolean;
  exportMessage: string;
}

/**
 * A saved workflow as shown in the dashboard: the remembered recipe plus the latest-run outcome
 * (status, records processed, review count and whether the report is ready to download).
 */
export interface SavedWorkflowSummary {
  id: string;
  name: string;
  description: string;
  workflowSlug: string;
  workflowName: string;
  workflowVersion: number;
  configurationVersion: number;
  datasetCount: number;
  mappingCount: number;
  ruleSet: SavedWorkflowRuleSetSummary | null;
  lastRun: SavedWorkflowLastRun | null;
  runCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** The full saved workflow: the summary plus the complete mapping, rules and recent runs. */
export interface SavedWorkflowDetail extends SavedWorkflowSummary {
  configuration: WorkflowConfiguration;
  ruleSetDefinition: StoredRuleSet | null;
  recentRuns: SavedWorkflowLastRun[];
}
