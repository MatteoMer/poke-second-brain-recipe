import { isAbsolute, normalize, sep } from "node:path";

export class GuardError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "GuardError";
  }
}

/**
 * Validate a relative path supplied by an API caller. Throws GuardError on
 * any suspicious shape. Returns the normalized path on success.
 *
 * Rules:
 *   - non-empty
 *   - no null bytes
 *   - not absolute
 *   - no `..` segments
 *   - normalized form starts with `${requiredPrefix}/`
 */
export function sanitizeRelPath(input: string, requiredPrefix: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new GuardError("path is empty", "empty");
  }
  if (input.includes("\0")) {
    throw new GuardError("path contains null byte", "null_byte");
  }
  if (isAbsolute(input)) {
    throw new GuardError("path is absolute", "absolute");
  }
  const normalized = normalize(input);
  if (normalized.startsWith("..")) {
    throw new GuardError("path escapes vault", "escapes");
  }
  const segments = normalized.split(/[\\/]/);
  if (segments.includes("..")) {
    throw new GuardError("path contains ..", "dotdot");
  }
  const prefix = requiredPrefix.endsWith("/") ? requiredPrefix : `${requiredPrefix}/`;
  if (!normalized.startsWith(prefix) && normalized !== requiredPrefix) {
    throw new GuardError(`path must start with ${prefix}`, "wrong_prefix");
  }
  return normalized;
}

/**
 * Assert a resolved absolute path is inside `${vaultPath}/${subdir}/`.
 * Caller is responsible for fs.realpath()ing first if symlink-escape matters.
 */
export function assertUnder(absPath: string, vaultPath: string, subdir: string): void {
  const expected = vaultPath.endsWith(sep) ? `${vaultPath}${subdir}${sep}` : `${vaultPath}${sep}${subdir}${sep}`;
  if (!absPath.startsWith(expected)) {
    throw new GuardError(`path is not under ${subdir}/`, "outside_subdir");
  }
}

/**
 * Wrap a user-supplied string in a fenced code block, choosing a backtick
 * fence longer than the longest run of backticks already in the value so
 * the user cannot break out into instructions.
 *
 * Also strips ASCII control chars (except \n, \t) which can confuse the LLM.
 */
export function quoteAsCodeBlock(s: string): string {
  // Strip control chars except newline and tab.
  // eslint-disable-next-line no-control-regex
  const cleaned = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  // Find longest run of backticks in the cleaned text.
  const matches = cleaned.match(/`+/g) ?? [];
  let longest = 0;
  for (const m of matches) longest = Math.max(longest, m.length);
  const fenceLen = Math.max(3, longest + 1);
  const fence = "`".repeat(fenceLen);
  return `${fence}\n${cleaned}\n${fence}`;
}
