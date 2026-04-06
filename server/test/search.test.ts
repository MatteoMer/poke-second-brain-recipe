import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchWiki } from "../src/search/index.js";

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "llm-wiki-search-"));
  mkdirSync(join(root, "wiki/entities"), { recursive: true });
  mkdirSync(join(root, "wiki/concepts"), { recursive: true });
  return root;
}

describe("searchWiki", () => {
  it("returns hits scored higher when filename matches", async () => {
    const root = fixture();
    writeFileSync(join(root, "wiki/entities/banana.md"), "# Banana\nyellow fruit\n");
    writeFileSync(join(root, "wiki/concepts/fruit.md"), "# Fruit\nbanana is one\n");

    const hits = await searchWiki({ vaultPath: root, query: "banana" });
    expect(hits.length).toBe(2);
    // filename match should win
    expect(hits[0]?.path).toBe("wiki/entities/banana.md");
  });

  it("filters by type subdirectory", async () => {
    const root = fixture();
    writeFileSync(join(root, "wiki/entities/x.md"), "# x apple\n");
    writeFileSync(join(root, "wiki/concepts/y.md"), "# y apple\n");

    const hits = await searchWiki({ vaultPath: root, query: "apple", type: "concepts" });
    expect(hits.length).toBe(1);
    expect(hits[0]?.path).toBe("wiki/concepts/y.md");
  });

  it("returns empty for empty query", async () => {
    const root = fixture();
    writeFileSync(join(root, "wiki/entities/x.md"), "# x\n");
    const hits = await searchWiki({ vaultPath: root, query: "   " });
    expect(hits).toEqual([]);
  });
});
