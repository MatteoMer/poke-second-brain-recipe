import { describe, expect, it } from "vitest";
import { GuardError, sanitizeRelPath, quoteAsCodeBlock } from "../src/claude/guards.js";

describe("sanitizeRelPath", () => {
  it("accepts valid raw/ paths", () => {
    expect(sanitizeRelPath("raw/inbox/foo.md", "raw")).toBe("raw/inbox/foo.md");
  });
  it("rejects empty", () => {
    expect(() => sanitizeRelPath("", "raw")).toThrow(GuardError);
  });
  it("rejects null bytes", () => {
    expect(() => sanitizeRelPath("raw/foo\0.md", "raw")).toThrow(GuardError);
  });
  it("rejects absolute paths", () => {
    expect(() => sanitizeRelPath("/etc/passwd", "raw")).toThrow(GuardError);
  });
  it("rejects ..", () => {
    expect(() => sanitizeRelPath("raw/../etc/passwd", "raw")).toThrow(GuardError);
  });
  it("rejects wrong prefix", () => {
    expect(() => sanitizeRelPath("wiki/entities/foo.md", "raw")).toThrow(GuardError);
  });
});

describe("quoteAsCodeBlock", () => {
  it("wraps simple text in ``` fences", () => {
    expect(quoteAsCodeBlock("hello")).toBe("```\nhello\n```");
  });
  it("uses longer fences when text contains backtick runs", () => {
    const out = quoteAsCodeBlock("look at ``` this");
    expect(out.startsWith("````\n")).toBe(true);
    expect(out.endsWith("\n````")).toBe(true);
  });
  it("strips control characters except newline/tab", () => {
    const out = quoteAsCodeBlock("a\u0001b\nc\td");
    expect(out).toBe("```\nab\nc\td\n```");
  });
});
