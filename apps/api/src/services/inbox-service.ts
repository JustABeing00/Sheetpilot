import { mkdir, readdir, readFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Clock, Logger, Repositories } from '@sheetpilot/core';
import type { DatasetService } from './dataset-service.js';
import type { SavedWorkflowService } from './saved-workflow-service.js';

export interface InboxServiceDeps {
  dir: string;
  configurationId: string;
  primaryPattern: string;
  eventsPattern: string;
  pollIntervalMs: number;
  settleMs: number;
  datasetService: DatasetService;
  savedWorkflowService: SavedWorkflowService;
  repositories: Repositories;
  clock: Clock;
  logger: Logger;
}

export interface InboxSweepResult {
  jobsProcessed: number;
  jobsFailed: number;
  runIds: string[];
}

const DONE_DIR = '_processed';
const FAILED_DIR = '_failed';
const RUN_TIMEOUT_MS = 10 * 60 * 1000;

function mimeForFile(fileName: string): string {
  switch (path.extname(fileName).toLowerCase()) {
    case '.csv':
      return 'text/csv';
    case '.tsv':
      return 'text/tab-separated-values';
    case '.txt':
      return 'text/plain';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.xlsm':
      return 'application/vnd.ms-excel.sheet.macroEnabled.12';
    default:
      return 'application/octet-stream';
  }
}

/** Minimal glob: only `*` is special, which is all the role patterns need (e.g. `primary.*`). */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Watch a folder so a recurring user can drop a day's files and get a run without touching the UI.
 *
 * Layout expected by the watcher:
 *   <INBOX_DIR>/<job>/primary.xlsx   (matched by INBOX_PRIMARY_PATTERN)
 *   <INBOX_DIR>/<job>/events.xlsx    (matched by INBOX_EVENTS_PATTERN)
 *
 * Each `<job>` directory is uploaded as two datasets, run through the configured saved workflow, and
 * then moved to `_processed/` (or `_failed/`) so it is never run twice.
 */
export class InboxService {
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;
  /** Last observed size+mtime per file, used to wait until a copy has finished before reading it. */
  private readonly signatures = new Map<string, string>();

  constructor(private readonly deps: InboxServiceDeps) {}

  async start(): Promise<void> {
    const { dir, configurationId, logger } = this.deps;
    const configuration =
      await this.deps.repositories.workflowConfigurations.getById(configurationId);
    if (!configuration) {
      logger.error(
        { configurationId },
        'inbox watcher disabled: INBOX_CONFIGURATION_ID does not match a saved workflow',
      );
      return;
    }

    await mkdir(path.join(dir, DONE_DIR), { recursive: true });
    await mkdir(path.join(dir, FAILED_DIR), { recursive: true });

    await this.sweep().catch((error) => {
      logger.warn({ err: error }, 'initial inbox sweep failed');
    });

    this.timer = setInterval(() => {
      void this.sweep().catch((error) => {
        logger.warn({ err: error }, 'inbox sweep failed');
      });
    }, this.deps.pollIntervalMs);
    // Do not keep the process alive only for the watcher.
    this.timer.unref?.();

    logger.info(
      { dir, configurationId, pollIntervalMs: this.deps.pollIntervalMs },
      'inbox watcher started',
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One full pass over the inbox. Exposed for tests and for an on-demand sweep. */
  async sweep(): Promise<InboxSweepResult> {
    if (this.sweeping) {
      return { jobsProcessed: 0, jobsFailed: 0, runIds: [] };
    }
    this.sweeping = true;
    const result: InboxSweepResult = { jobsProcessed: 0, jobsFailed: 0, runIds: [] };
    try {
      const entries = await readdir(this.deps.dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('_')) {
          continue;
        }
        const jobDir = path.join(this.deps.dir, entry.name);
        const files = await readdir(jobDir);
        const primaryName = files.find((file) => globToRegExp(this.deps.primaryPattern).test(file));
        const eventsName = files.find((file) => globToRegExp(this.deps.eventsPattern).test(file));
        if (!primaryName || !eventsName) {
          continue;
        }
        // Observe both files before deciding, so a copy that has not settled does not stop the other
        // file from being tracked and the job still becomes eligible on the next sweep.
        const primarySettled = await this.isSettled(path.join(jobDir, primaryName));
        const eventsSettled = await this.isSettled(path.join(jobDir, eventsName));
        if (!primarySettled || !eventsSettled) {
          continue;
        }

        try {
          const runId = await this.processJob(
            entry.name,
            path.join(jobDir, primaryName),
            path.join(jobDir, eventsName),
          );
          result.jobsProcessed += 1;
          result.runIds.push(runId);
          await this.archive(entry.name, DONE_DIR);
        } catch (error) {
          result.jobsFailed += 1;
          this.deps.logger.error(
            { job: entry.name, err: error instanceof Error ? error.message : String(error) },
            'inbox job failed',
          );
          await this.archive(entry.name, FAILED_DIR);
        }
      }
    } finally {
      this.sweeping = false;
    }
    return result;
  }

  private async isSettled(filePath: string): Promise<boolean> {
    const info = await stat(filePath);
    const signature = `${info.size}:${info.mtimeMs}`;
    const previous = this.signatures.get(filePath);
    this.signatures.set(filePath, signature);
    if (previous !== signature) {
      return false;
    }
    return Date.now() - info.mtimeMs >= this.deps.settleMs;
  }

  private async processJob(
    jobName: string,
    primaryPath: string,
    eventsPath: string,
  ): Promise<string> {
    const primary = await this.ingest('primary', primaryPath);
    const events = await this.ingest('events', eventsPath);

    const run = await this.deps.savedWorkflowService.run(this.deps.configurationId, {
      assignments: [
        { role: 'primary', datasetId: primary.id, sheetName: null },
        { role: 'events', datasetId: events.id, sheetName: null },
      ],
      config: {},
      saveConfiguration: false,
    });

    const finished = await this.waitForRun(run.id);
    if (finished.status !== 'succeeded') {
      throw new Error(`run ${run.id} ${finished.status}: ${finished.error ?? 'unknown error'}`);
    }

    this.deps.logger.info(
      { job: jobName, runId: run.id, primary: primary.id, events: events.id },
      'inbox job processed',
    );
    return run.id;
  }

  private async ingest(kind: 'primary' | 'events', filePath: string) {
    const content = await readFile(filePath);
    const originalName = path.basename(filePath);
    const { dataset } = await this.deps.datasetService.ingest({
      kind,
      originalName,
      mimeType: mimeForFile(originalName),
      content,
    });
    return dataset;
  }

  private async waitForRun(runId: string) {
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    for (;;) {
      const run = await this.deps.repositories.runs.getById(runId);
      if (run && (run.status === 'succeeded' || run.status === 'failed')) {
        return run;
      }
      if (Date.now() > deadline) {
        throw new Error(`run ${runId} did not finish in time`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  private async archive(jobName: string, target: string): Promise<void> {
    const timestamp = this.deps.clock.now().toISOString().replace(/[:.]/g, '-');
    const destination = path.join(this.deps.dir, target, `${jobName}-${timestamp}`);
    await rename(path.join(this.deps.dir, jobName), destination);
  }
}
