import { promises as fsp } from "node:fs";
import { join, relative, sep } from "node:path";

export interface SearchHit {
  path: string; // vault-relative
  snippet: string;
  score: number;
}

export interface SearchOptions {
  vaultPath: string;
  query: string;
  /** Filter by category subdirectory under wiki/ (entities, concepts, etc). */
  type?: string;
  limit?: number;
}

/**
 * Naive case-insensitive substring search across wiki/**\/*.md.
 *
 * Score: filename matches dominate, body matches add 1 per occurrence (capped at 10).
 *
 * Intentionally simple. The interface is small so we can swap to qmd or
 * embeddings without touching callers.
 */
export async function searchWiki(opts: SearchOptions): Promise<SearchHit[]> {
  const q = opts.query.trim().toLowerCase();
  if (!q) return [];

  const root = join(opts.vaultPath, "wiki");
  const subroot = opts.type ? join(root, opts.type) : root;
  const limit = opts.limit ?? 20;

  const files: string[] = [];
  await walk(subroot, files);

  const hits: SearchHit[] = [];
  for (const abs of files) {
    const rel = relative(opts.vaultPath, abs).split(sep).join("/");
    const text = await fsp.readFile(abs, "utf8").catch(() => "");
    const lower = text.toLowerCase();
    const fileName = rel.toLowerCase();

    const filenameScore = fileName.includes(q) ? 50 : 0;
    let bodyHits = 0;
    let idx = lower.indexOf(q);
    while (idx !== -1 && bodyHits < 10) {
      bodyHits++;
      idx = lower.indexOf(q, idx + q.length);
    }
    const score = filenameScore + bodyHits;
    if (score === 0) continue;

    hits.push({ path: rel, snippet: makeSnippet(text, q), score });
  }

  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return hits.slice(0, limit);
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries: import("fs").Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, out);
    } else if (e.isFile() && e.name.endsWith(".md")) {
      out.push(full);
    }
  }
}

function makeSnippet(text: string, q: string): string {
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return text.slice(0, 160);
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + q.length + 100);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + text.slice(start, end).replace(/\s+/g, " ") + suffix;
}
