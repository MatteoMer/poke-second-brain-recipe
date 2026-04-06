import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../src/config.js";
import type { JobDispatcher } from "../src/queue/worker.js";
import type { JobRow, JobResult } from "../src/queue/types.js";

/**
 * Build a fresh temp vault skeleton on disk and return a Config that points
 * at it. Each test gets its own directory so vitest's serial single-fork
 * worker can still run multiple test files cleanly.
 */
export function makeTempVaultConfig(overrides: Partial<Config> = {}): Config {
  // realpathSync because on macOS tmpdir() lives under /var which is a symlink
  // to /private/var, and our path-escape check uses fs.realpath at runtime.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "llm-wiki-test-")));
  const vault = join(root, "vault");
  mkdirSync(join(vault, "raw/inbox"), { recursive: true });
  mkdirSync(join(vault, "raw/sources"), { recursive: true });
  mkdirSync(join(vault, "raw/assets"), { recursive: true });
  mkdirSync(join(vault, "wiki/entities"), { recursive: true });
  mkdirSync(join(vault, "wiki/concepts"), { recursive: true });
  mkdirSync(join(vault, "wiki/sources"), { recursive: true });
  mkdirSync(join(vault, "wiki/queries"), { recursive: true });
  mkdirSync(join(vault, "wiki/syntheses"), { recursive: true });
  writeFileSync(join(vault, "CLAUDE.md"), "# CLAUDE\nstub for tests\n");
  writeFileSync(join(vault, "index.md"), "# Index\n");
  writeFileSync(join(vault, "log.md"), "# Activity Log\n");

  const invariants = join(root, "invariants.txt");
  writeFileSync(invariants, "test invariants\n");

  return {
    PORT: 0,
    HOST: "127.0.0.1",
    NODE_ENV: "test",
    LOG_LEVEL: "fatal",
    VAULT_PATH: vault,
    DB_PATH: ":memory:",
    INVARIANTS_FILE: invariants,
    API_TOKEN: "test-token-1234567890abcdef",
    CLAUDE_BIN: "/usr/bin/false",
    JOB_TIMEOUT_MS: 5000,
    MAX_SOURCE_BYTES: 65536,
    DISALLOWED_TOOLS: ["WebSearch", "WebFetch"],
    ...overrides,
  };
}

/**
 * Fake dispatcher: appends a line to log.md to prove the worker invoked it,
 * records the order of jobs seen, and returns canned results. Optionally
 * sleeps before returning so we can test timeouts/concurrency.
 */
export class FakeDispatcher implements JobDispatcher {
  public seen: string[] = [];
  public sleepMs = 0;
  public failNext = false;
  public abortable = true;

  constructor(private vaultPath: string) {}

  async dispatch(job: JobRow, signal: AbortSignal): Promise<{ result: JobResult; sessionId: string | null }> {
    this.seen.push(job.id);
    const logPath = join(this.vaultPath, "log.md");
    const { appendFileSync } = await import("node:fs");
    appendFileSync(logPath, `## [${new Date().toISOString()}] ${job.type} | ${job.id} | fake\n`);

    if (this.sleepMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, this.sleepMs);
        if (this.abortable) {
          signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("aborted"));
          });
        }
      });
    }
    if (this.failNext) {
      this.failNext = false;
      throw new Error("synthetic failure");
    }
    return {
      result: { text: `ok ${job.id}`, rawJson: { fake: true } },
      sessionId: `sess-${job.id}`,
    };
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
