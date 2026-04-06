import type { Logger } from "pino";
import type { Config } from "../config.js";
import type { JobRepo } from "./repo.js";
import type { JobRow, JobResult } from "./types.js";
import { AsyncMutex, VaultFileLock } from "./lock.js";

export interface JobDispatcher {
  /** Build a prompt + run claude for the given job. Throw on failure. */
  dispatch(job: JobRow, signal: AbortSignal): Promise<{ result: JobResult; sessionId: string | null }>;
}

export interface WorkerOptions {
  config: Config;
  repo: JobRepo;
  dispatcher: JobDispatcher;
  logger: Logger;
  fileLock: VaultFileLock;
}

/**
 * Single in-process worker. Polls the queue, processes one job at a time
 * under the in-process mutex AND the vault file lock.
 *
 * Lifecycle:
 *   - start() returns immediately; the loop runs in the background.
 *   - stop() flips the shutdown flag and resolves once the current job
 *     finishes (bounded by jobTimeoutMs).
 */
export class Worker {
  private mutex = new AsyncMutex();
  private shuttingDown = false;
  private currentAbort: AbortController | null = null;
  private loopPromise: Promise<void> | null = null;

  constructor(private opts: WorkerOptions) {}

  start(): void {
    if (this.loopPromise) return;
    this.loopPromise = this.loop().catch((e) => {
      this.opts.logger.error({ err: e }, "worker loop crashed");
    });
  }

  async stop(): Promise<void> {
    this.shuttingDown = true;
    this.currentAbort?.abort();
    if (this.loopPromise) await this.loopPromise;
  }

  private async loop(): Promise<void> {
    const { repo, dispatcher, logger, fileLock } = this.opts;
    while (!this.shuttingDown) {
      const release = await this.mutex.acquire();
      let job: JobRow | null = null;
      try {
        job = repo.claimNext();
        if (!job) {
          release();
          await this.sleep(500);
          continue;
        }

        const childLog = logger.child({ jobId: job.id, jobType: job.type });
        childLog.info("job started");

        try {
          await fileLock.acquire();
        } catch (e) {
          childLog.error({ err: e }, "could not acquire vault file lock; failing job");
          repo.markFailed(job.id, `vault_locked: ${(e as Error).message}`);
          release();
          continue;
        }

        const abort = new AbortController();
        this.currentAbort = abort;
        try {
          const { result, sessionId } = await dispatcher.dispatch(job, abort.signal);
          repo.markSucceeded(job.id, result, sessionId);
          childLog.info({ durationMs: Date.now() - (job.startedAt ?? Date.now()) }, "job succeeded");
        } catch (e) {
          const msg = summarizeError(e);
          repo.markFailed(job.id, msg);
          childLog.error({ err: e }, "job failed");
        } finally {
          this.currentAbort = null;
          await fileLock.releaseLock().catch((e) =>
            childLog.warn({ err: e }, "file lock release failed"),
          );
        }
      } finally {
        release();
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function summarizeError(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as { cause?: unknown }).cause;
    return cause ? `${e.message} (cause: ${String(cause)})` : e.message;
  }
  return String(e);
}
