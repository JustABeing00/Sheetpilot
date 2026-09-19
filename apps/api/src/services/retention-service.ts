import type { Clock, FileStorage, Logger, Repositories } from '@sheetpilot/core';

export interface RetentionServiceDeps {
  storage: FileStorage;
  repositories: Repositories;
  clock: Clock;
  logger: Logger;
  /** How long an unreferenced upload may live before the sweeper may delete it. */
  uploadTtlMs: number;
  /** How often the recurring sweep runs. */
  sweepIntervalMs: number;
}

export interface RetentionSweepResult {
  scanned: number;
  removed: number;
  kept: number;
  removedKeys: string[];
}

const UPLOAD_PREFIX = 'uploads/';

/**
 * Deletes upload objects that no `FileAsset` references and that are older than the configured TTL.
 * This reclaims space from interrupted ingestions and from datasets that were never wired into a
 * configuration. Deliverables (`runs/…`) are never swept: they are the user's report.
 *
 * In the default in-memory repository mode a restart forgets every `FileAsset`, so a sweep can only
 * ever remove objects past the TTL — recent uploads are always kept.
 */
export class RetentionService {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: RetentionServiceDeps) {}

  async sweep(): Promise<RetentionSweepResult> {
    const objects = await this.deps.storage.list(UPLOAD_PREFIX);
    const files = await this.deps.repositories.files.list(1_000_000);
    const referenced = new Set(files.map((file) => file.storageKey));
    const now = this.deps.clock.now().getTime();

    let removed = 0;
    let kept = 0;
    const removedKeys: string[] = [];

    for (const object of objects) {
      const expired = now - object.modifiedAt.getTime() >= this.deps.uploadTtlMs;
      if (referenced.has(object.key) || !expired) {
        kept += 1;
        continue;
      }
      try {
        await this.deps.storage.remove(object.key);
        removed += 1;
        removedKeys.push(object.key);
      } catch (error) {
        kept += 1;
        this.deps.logger.warn(
          { storageKey: object.key, err: error },
          'retention sweep failed to remove',
        );
      }
    }

    if (removed > 0) {
      this.deps.logger.info(
        { removed, scanned: objects.length },
        'retention sweep removed uploads',
      );
    }

    return { scanned: objects.length, removed, kept, removedKeys };
  }

  /** Starts the recurring sweep. The timer is unref'd so it never keeps the process alive. */
  start(): void {
    if (this.timer || this.deps.uploadTtlMs <= 0) {
      return;
    }
    this.timer = setInterval(
      () => {
        void this.sweep().catch((error: unknown) => {
          this.deps.logger.warn({ err: error }, 'scheduled retention sweep failed');
        });
      },
      Math.max(60_000, this.deps.sweepIntervalMs),
    );
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
