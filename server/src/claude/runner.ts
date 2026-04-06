import { execa, type ResultPromise } from "execa";

export class ClaudeRunError extends Error {
  constructor(
    message: string,
    public readonly detail: {
      stderr?: string;
      exitCode?: number | undefined;
      timedOut?: boolean;
      rawJson?: unknown;
    },
  ) {
    super(message);
    this.name = "ClaudeRunError";
  }
}

export interface ClaudeRunInput {
  promptText: string;
  invariantsFile: string;
  cwd: string;
  timeoutMs: number;
  disallowedTools: string[];
  abortSignal: AbortSignal;
  /** Override binary path; default is `claude` from PATH. */
  claudeBin?: string;
}

export interface ClaudeRunResult {
  /** The text returned in the final `result` field of the JSON output. */
  resultText: string;
  /** Session id from the JSON output, if present. */
  sessionId: string | null;
  /** Parsed JSON object verbatim. */
  rawJson: unknown;
}

/**
 * Shape of `claude -p --output-format json` output, captured by smoke check
 * against claude 2.1.81. Fields we care about:
 *
 *   {
 *     "type": "result",
 *     "subtype": "success",
 *     "is_error": false,
 *     "result": "...",
 *     "session_id": "uuid",
 *     "duration_ms": 1234,
 *     "num_turns": 3,
 *     "total_cost_usd": 0.0123,
 *     ...
 *   }
 *
 * On error, `is_error` is true and `result` contains the error message.
 * The CLI exits non-zero on error but still emits the JSON to stdout.
 */
interface ClaudeJsonOutput {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
}

/**
 * Run `claude -p` as a subprocess and parse its JSON output.
 *
 * Argv shape (verified against claude 2.1.81 — see notes in IMPLEMENTATION_PLAN
 * corrections section of the execution plan):
 *   - `--max-turns` does NOT exist in this CLI version. Jobs are bounded by
 *     the execa `timeout` only.
 *   - `--cwd` does NOT exist. Working directory is set on the child process.
 *   - `--append-system-prompt-file` exists but is hidden from --help.
 *   - `--no-session-persistence` keeps the host clean of per-job session files.
 *   - `--permission-mode acceptEdits` auto-accepts edits but still respects
 *     allowed/disallowed tools (unlike bypassPermissions).
 */
export async function runClaude(input: ClaudeRunInput): Promise<ClaudeRunResult> {
  const argv: string[] = [
    "-p",
    input.promptText,
    "--output-format",
    "json",
    "--append-system-prompt-file",
    input.invariantsFile,
    "--permission-mode",
    "acceptEdits",
    "--no-session-persistence",
    "--fallback-model",
    "sonnet",
  ];
  for (const tool of input.disallowedTools) {
    argv.push("--disallowedTools", tool);
  }

  const child: ResultPromise<{
    cwd: string;
    timeout: number;
    killSignal: "SIGTERM";
    forceKillAfterDelay: number;
    maxBuffer: number;
    reject: false;
  }> = execa(input.claudeBin ?? "claude", argv, {
    cwd: input.cwd,
    timeout: input.timeoutMs,
    killSignal: "SIGTERM",
    forceKillAfterDelay: 5_000,
    maxBuffer: 32 * 1024 * 1024,
    reject: false,
  });

  const onAbort = () => child.kill("SIGTERM");
  input.abortSignal.addEventListener("abort", onAbort);

  let stdout: string;
  let stderr: string;
  let exitCode: number | undefined;
  let timedOut: boolean;
  try {
    const result = await child;
    stdout = String(result.stdout ?? "");
    stderr = String(result.stderr ?? "");
    exitCode = result.exitCode;
    timedOut = Boolean(result.timedOut);
  } finally {
    input.abortSignal.removeEventListener("abort", onAbort);
  }

  // claude -p emits JSON on stdout even on error; try to parse first.
  let parsed: ClaudeJsonOutput | null = null;
  if (stdout.trim().length > 0) {
    try {
      parsed = JSON.parse(stdout) as ClaudeJsonOutput;
    } catch {
      // fall through; treated as a hard failure below
    }
  }

  if (timedOut) {
    throw new ClaudeRunError("claude timed out", { stderr, exitCode, timedOut, rawJson: parsed });
  }

  if (!parsed) {
    throw new ClaudeRunError(
      `claude exited ${exitCode} with unparseable output`,
      { stderr, exitCode, timedOut, rawJson: null },
    );
  }

  if (parsed.is_error === true) {
    throw new ClaudeRunError(`claude reported error: ${parsed.result ?? "unknown"}`, {
      stderr,
      exitCode,
      timedOut,
      rawJson: parsed,
    });
  }

  if (exitCode !== 0) {
    throw new ClaudeRunError(`claude exited ${exitCode}`, {
      stderr,
      exitCode,
      timedOut,
      rawJson: parsed,
    });
  }

  return {
    resultText: parsed.result ?? "",
    sessionId: parsed.session_id ?? null,
    rawJson: parsed,
  };
}
