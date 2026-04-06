import { promises as fsp } from "node:fs";
import { join, relative, sep } from "node:path";

export type LintFindingType =
  | "orphan_page"
  | "dangling_link"
  | "missing_frontmatter"
  | "stale_source"
  | "unrecorded_contradiction";

export interface LintFinding {
  type: LintFindingType;
  page: string; // vault-relative
  message: string;
  detail?: Record<string, unknown>;
}

export interface RunLintOptions {
  vaultPath: string;
  /** Only consider pages updated within this many days. 0 = no filter. */
  recentDays?: number;
  /** Stale-source threshold in days for findStaleSources. Default 90. */
  staleDays?: number;
  /** Now reference for tests. Default Date.now(). */
  now?: number;
}

interface PageRecord {
  /** vault-relative path with forward slashes */
  rel: string;
  abs: string;
  text: string;
  updatedAt: number;
  frontmatter: Record<string, string> | null;
  type: "entity" | "concept" | "source" | "synthesis" | "query" | null;
}

const REQUIRED_FIELDS_BY_TYPE: Record<NonNullable<PageRecord["type"]>, string[]> = {
  entity: ["type", "created", "updated"],
  concept: ["type", "created", "updated"],
  source: ["type", "source_path", "ingested_at"],
  synthesis: ["type", "updated"],
  query: ["type", "question", "asked_at"],
};

/**
 * Walk vault/wiki and collect all .md files. Read text and parse frontmatter.
 */
async function collectWikiPages(vaultPath: string): Promise<PageRecord[]> {
  const wikiRoot = join(vaultPath, "wiki");
  const out: PageRecord[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: import("fs").Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        const text = await fsp.readFile(full, "utf8").catch(() => "");
        const stat = await fsp.stat(full);
        const fm = parseFrontmatter(text);
        const t = (fm?.type ?? null) as PageRecord["type"];
        const rel = relative(vaultPath, full).split(sep).join("/");
        out.push({
          rel,
          abs: full,
          text,
          updatedAt: stat.mtimeMs,
          frontmatter: fm,
          type: REQUIRED_FIELDS_BY_TYPE[t as NonNullable<PageRecord["type"]>] ? t : null,
        });
      }
    }
  }

  await walk(wikiRoot);
  return out;
}

/**
 * Parse a YAML-ish frontmatter block at the top of a file. We do not need
 * full YAML — just `key: value` pairs in the leading `--- ... ---` block.
 * Returns null if no frontmatter is present.
 */
export function parseFrontmatter(text: string): Record<string, string> | null {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  const block = text.slice(3, end).trim();
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Extract `[[wikilinks]]` (and `[[wikilinks|alias]]`) from a page body.
 * Returns the link target without the alias.
 */
export function extractWikilinks(text: string): string[] {
  const re = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const target = (m[1] ?? "").trim();
    if (target) out.push(target);
  }
  return out;
}

/**
 * Normalize a wikilink target to the form we use as an "id":
 *   - strip leading wiki/
 *   - strip trailing .md
 */
function normalizeLinkTarget(t: string): string {
  let s = t;
  if (s.startsWith("wiki/")) s = s.slice("wiki/".length);
  if (s.endsWith(".md")) s = s.slice(0, -3);
  return s;
}

function pageId(rel: string): string {
  let s = rel;
  if (s.startsWith("wiki/")) s = s.slice("wiki/".length);
  if (s.endsWith(".md")) s = s.slice(0, -3);
  return s;
}

/**
 * Run all lint checks against a vault. Returns flat list of findings.
 *
 * Each check is also exported individually for unit testing.
 */
export async function runLint(opts: RunLintOptions): Promise<LintFinding[]> {
  const pages = await collectWikiPages(opts.vaultPath);
  const filtered =
    opts.recentDays && opts.recentDays > 0
      ? pages.filter(
          (p) => p.updatedAt >= (opts.now ?? Date.now()) - opts.recentDays! * 86400_000,
        )
      : pages;
  return [
    ...findOrphanPages(filtered, pages),
    ...findDanglingLinks(filtered, pages),
    ...findMissingFrontmatter(filtered),
    ...findStaleSources(pages, opts.staleDays ?? 90, opts.now ?? Date.now()),
    ...(await findUnrecordedContradictions(opts.vaultPath, pages)),
  ];
}

export function findOrphanPages(scope: PageRecord[], universe: PageRecord[]): LintFinding[] {
  // Build set of incoming links across the universe.
  const incoming = new Set<string>();
  for (const p of universe) {
    for (const link of extractWikilinks(p.text)) {
      incoming.add(normalizeLinkTarget(link));
    }
  }
  const findings: LintFinding[] = [];
  for (const p of scope) {
    // Sources, queries, lint reports, and the contradictions ledger are
    // legitimately allowed to be unlinked.
    if (p.type === "source" || p.type === "query" || p.type === "synthesis") continue;
    const id = pageId(p.rel);
    if (!incoming.has(id)) {
      findings.push({
        type: "orphan_page",
        page: p.rel,
        message: `no inbound wikilinks to ${id}`,
      });
    }
  }
  return findings;
}

export function findDanglingLinks(scope: PageRecord[], universe: PageRecord[]): LintFinding[] {
  const ids = new Set(universe.map((p) => pageId(p.rel)));
  const findings: LintFinding[] = [];
  for (const p of scope) {
    for (const raw of extractWikilinks(p.text)) {
      const target = normalizeLinkTarget(raw);
      if (!ids.has(target)) {
        findings.push({
          type: "dangling_link",
          page: p.rel,
          message: `links to nonexistent page: ${raw}`,
          detail: { target },
        });
      }
    }
  }
  return findings;
}

export function findMissingFrontmatter(scope: PageRecord[]): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const p of scope) {
    if (!p.type) {
      findings.push({
        type: "missing_frontmatter",
        page: p.rel,
        message: "no recognizable frontmatter or unknown type",
      });
      continue;
    }
    const required = REQUIRED_FIELDS_BY_TYPE[p.type];
    const missing = required.filter((k) => !p.frontmatter?.[k]);
    if (missing.length > 0) {
      findings.push({
        type: "missing_frontmatter",
        page: p.rel,
        message: `missing required fields: ${missing.join(", ")}`,
        detail: { missing, type: p.type },
      });
    }
  }
  return findings;
}

export function findStaleSources(
  pages: PageRecord[],
  staleDays: number,
  now: number,
): LintFinding[] {
  const findings: LintFinding[] = [];
  const cutoff = now - staleDays * 86400_000;
  for (const p of pages) {
    if (p.type !== "source") continue;
    if (p.updatedAt < cutoff) {
      findings.push({
        type: "stale_source",
        page: p.rel,
        message: `source not touched in ${staleDays}+ days`,
        detail: { ageDays: Math.floor((now - p.updatedAt) / 86400_000) },
      });
    }
  }
  return findings;
}

/**
 * Find pages with `> [!warning] Contradiction` callouts whose page id is not
 * referenced from wiki/syntheses/contradictions.md.
 */
export async function findUnrecordedContradictions(
  vaultPath: string,
  pages: PageRecord[],
): Promise<LintFinding[]> {
  const ledgerPath = join(vaultPath, "wiki/syntheses/contradictions.md");
  let ledger = "";
  try {
    ledger = await fsp.readFile(ledgerPath, "utf8");
  } catch {
    ledger = "";
  }
  const ledgerLinks = new Set(extractWikilinks(ledger).map(normalizeLinkTarget));

  const findings: LintFinding[] = [];
  for (const p of pages) {
    if (!/>\s*\[!warning\]\s*Contradiction/i.test(p.text)) continue;
    const id = pageId(p.rel);
    if (!ledgerLinks.has(id)) {
      findings.push({
        type: "unrecorded_contradiction",
        page: p.rel,
        message: "contradiction callout not recorded in contradictions ledger",
      });
    }
  }
  return findings;
}

// Re-export internal helpers for tests.
export type { PageRecord };
export { collectWikiPages };
