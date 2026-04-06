import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractWikilinks,
  parseFrontmatter,
  runLint,
} from "../src/lint/checks.js";

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "llm-wiki-lint-"));
  const wiki = join(root, "wiki");
  mkdirSync(join(wiki, "entities"), { recursive: true });
  mkdirSync(join(wiki, "concepts"), { recursive: true });
  mkdirSync(join(wiki, "sources"), { recursive: true });
  mkdirSync(join(wiki, "syntheses"), { recursive: true });
  return root;
}

describe("parseFrontmatter", () => {
  it("parses simple key:value frontmatter", () => {
    const text = "---\ntype: entity\ncreated: 2026-04-07\n---\n# body\n";
    const fm = parseFrontmatter(text);
    expect(fm).toEqual({ type: "entity", created: "2026-04-07" });
  });
  it("returns null when no frontmatter", () => {
    expect(parseFrontmatter("# hello")).toBeNull();
  });
});

describe("extractWikilinks", () => {
  it("extracts simple wikilinks", () => {
    const links = extractWikilinks("see [[wiki/entities/foo]] and [[concept-bar]]");
    expect(links).toEqual(["wiki/entities/foo", "concept-bar"]);
  });
  it("handles aliases and headers", () => {
    const links = extractWikilinks("[[wiki/entities/foo|Foo Corp]] [[bar#heading|Bar]]");
    expect(links).toEqual(["wiki/entities/foo", "bar"]);
  });
});

describe("runLint", () => {
  it("flags orphan entity pages", async () => {
    const root = fixture();
    writeFileSync(
      join(root, "wiki/entities/orphan.md"),
      "---\ntype: entity\ncreated: 2026-04-07\nupdated: 2026-04-07\n---\n# orphan\n",
    );
    writeFileSync(
      join(root, "wiki/entities/linked.md"),
      "---\ntype: entity\ncreated: 2026-04-07\nupdated: 2026-04-07\n---\n# linked\n",
    );
    writeFileSync(
      join(root, "wiki/concepts/index.md"),
      "---\ntype: concept\ncreated: 2026-04-07\nupdated: 2026-04-07\n---\nsee [[entities/linked]]\n",
    );

    const findings = await runLint({ vaultPath: root });
    const orphans = findings.filter((f) => f.type === "orphan_page").map((f) => f.page);
    expect(orphans).toContain("wiki/entities/orphan.md");
    expect(orphans).not.toContain("wiki/entities/linked.md");
  });

  it("flags dangling links", async () => {
    const root = fixture();
    writeFileSync(
      join(root, "wiki/entities/foo.md"),
      "---\ntype: entity\ncreated: 2026-04-07\nupdated: 2026-04-07\n---\nsee [[entities/missing]]\n",
    );
    const findings = await runLint({ vaultPath: root });
    const dangling = findings.filter((f) => f.type === "dangling_link");
    expect(dangling.length).toBe(1);
    expect(dangling[0]?.page).toBe("wiki/entities/foo.md");
  });

  it("flags missing frontmatter fields", async () => {
    const root = fixture();
    writeFileSync(
      join(root, "wiki/entities/incomplete.md"),
      "---\ntype: entity\n---\n# x\n",
    );
    const findings = await runLint({ vaultPath: root });
    const mf = findings.filter((f) => f.type === "missing_frontmatter");
    expect(mf.length).toBe(1);
    expect((mf[0]?.detail?.missing as string[]).sort()).toEqual(["created", "updated"]);
  });

  it("flags stale sources", async () => {
    const root = fixture();
    const stale = join(root, "wiki/sources/2026-01-01-old.md");
    writeFileSync(
      stale,
      "---\ntype: source\nsource_path: raw/inbox/old.md\ningested_at: 2026-01-01T00:00:00Z\n---\n# old\n",
    );
    const oldTime = (Date.now() - 100 * 86400_000) / 1000;
    utimesSync(stale, oldTime, oldTime);

    const findings = await runLint({ vaultPath: root, staleDays: 90 });
    const stales = findings.filter((f) => f.type === "stale_source");
    expect(stales.length).toBe(1);
  });

  it("flags unrecorded contradictions", async () => {
    const root = fixture();
    writeFileSync(
      join(root, "wiki/entities/conflicted.md"),
      "---\ntype: entity\ncreated: 2026-04-07\nupdated: 2026-04-07\n---\n> [!warning] Contradiction\n> stuff\n",
    );
    // No contradictions ledger present.
    const findings = await runLint({ vaultPath: root });
    const uc = findings.filter((f) => f.type === "unrecorded_contradiction");
    expect(uc.length).toBe(1);
  });

  it("does NOT flag recorded contradictions", async () => {
    const root = fixture();
    writeFileSync(
      join(root, "wiki/entities/conflicted.md"),
      "---\ntype: entity\ncreated: 2026-04-07\nupdated: 2026-04-07\n---\n> [!warning] Contradiction\n> stuff\n",
    );
    writeFileSync(
      join(root, "wiki/syntheses/contradictions.md"),
      "---\ntype: synthesis\nupdated: 2026-04-07\n---\n- [[entities/conflicted]] noted\n",
    );
    const findings = await runLint({ vaultPath: root });
    const uc = findings.filter((f) => f.type === "unrecorded_contradiction");
    expect(uc.length).toBe(0);
  });
});
