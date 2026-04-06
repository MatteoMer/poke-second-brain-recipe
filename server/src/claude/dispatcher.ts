import type { Config } from "../config.js";
import type { JobDispatcher } from "../queue/worker.js";
import type { IngestInput, JobResult, JobRow, LintInput, QueryInput } from "../queue/types.js";
import { buildIngestPrompt, buildLintPrompt, buildQueryPrompt, buildReindexPrompt } from "./prompts.js";
import { runClaude, type ClaudeRunResult } from "./runner.js";

/**
 * The "real" dispatcher that turns a JobRow into a Claude invocation.
 *
 * The runner function is injected so tests can swap in a fake. The default
 * is `runClaude` from runner.ts.
 */
export class ClaudeDispatcher implements JobDispatcher {
  constructor(
    private config: Config,
    private runner: (input: Parameters<typeof runClaude>[0]) => Promise<ClaudeRunResult> = runClaude,
  ) {}

  async dispatch(job: JobRow, signal: AbortSignal): Promise<{ result: JobResult; sessionId: string | null }> {
    const promptText = this.buildPrompt(job);
    const out = await this.runner({
      promptText,
      invariantsFile: this.config.INVARIANTS_FILE,
      cwd: this.config.VAULT_PATH,
      timeoutMs: this.config.JOB_TIMEOUT_MS,
      disallowedTools: this.config.DISALLOWED_TOOLS,
      abortSignal: signal,
      claudeBin: this.config.CLAUDE_BIN,
    });
    return {
      result: { text: out.resultText, rawJson: out.rawJson },
      sessionId: out.sessionId,
    };
  }

  private buildPrompt(job: JobRow): string {
    switch (job.type) {
      case "ingest":
        return buildIngestPrompt(job.input as IngestInput, job.id);
      case "query":
        return buildQueryPrompt(job.input as QueryInput, job.id);
      case "lint":
        return buildLintPrompt(job.input as LintInput, job.id);
      case "reindex":
        return buildReindexPrompt(job.id);
      default: {
        const exhaustive: never = job.type;
        throw new Error(`unknown job type: ${String(exhaustive)}`);
      }
    }
  }
}
