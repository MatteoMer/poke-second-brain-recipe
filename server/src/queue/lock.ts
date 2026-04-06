import { lock as ploLock, type LockOptions } from "proper-lockfile";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

/**
 * Promise-based mutex. Only one Node process exists, so this is the
 * primary correctness boundary against accidental concurrent job execution.
 *
 * Implementation: a chain of promises. acquire() returns a release function;
 * the next caller awaits the previous release.
 */
export class AsyncMutex {
  private chain: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.chain;
    this.chain = next;
    await previous;
    return release;
  }
}

/**
 * Advisory file lock on the vault, layered on top of the in-process mutex.
 * This catches the case where someone runs scripts/run-ingest.sh directly
 * while the API is also running, or accidentally starts a second server.
 *
 * Uses proper-lockfile, which writes a lockfile next to a real file. We
 * give it a sentinel `.llm-wiki.lock` file inside the vault.
 */
export class VaultFileLock {
  private release: (() => Promise<void>) | null = null;
  constructor(private vaultPath: string) {}

  private get sentinelPath(): string {
    return `${this.vaultPath}/.llm-wiki.lock`;
  }

  async acquire(): Promise<void> {
    if (this.release) {
      throw new Error("vault file lock already held by this process");
    }
    mkdirSync(this.vaultPath, { recursive: true });
    if (!existsSync(this.sentinelPath)) {
      writeFileSync(this.sentinelPath, "lock sentinel for llm-wiki worker\n");
    }
    const opts: LockOptions = {
      retries: 0,
      stale: 60_000,
    };
    this.release = await ploLock(this.sentinelPath, opts);
  }

  async releaseLock(): Promise<void> {
    if (!this.release) return;
    const r = this.release;
    this.release = null;
    await r();
  }

  isHeld(): boolean {
    return this.release !== null;
  }
}
