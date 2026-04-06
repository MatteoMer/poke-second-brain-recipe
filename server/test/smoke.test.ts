import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pino } from "pino";
import { openDatabase } from "../src/db/client.js";
import { buildApp, type AppHandle } from "../src/app.js";
import { FakeDispatcher, makeTempVaultConfig, sleep } from "./helpers.js";

const silentLogger = pino({ level: "silent" });

async function bootstrap(overrides = {}) {
  const config = makeTempVaultConfig(overrides);
  const db = openDatabase(config.DB_PATH);
  const dispatcher = new FakeDispatcher(config.VAULT_PATH);
  const handle = await buildApp({ config, logger: silentLogger, db, dispatcher });
  return { config, handle, dispatcher };
}

async function pollJob(
  handle: AppHandle,
  jobId: string,
  predicate: (status: string) => boolean,
  timeoutMs = 5000,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await handle.app.inject({
      method: "GET",
      url: `/jobs/${jobId}`,
      headers: { authorization: "Bearer test-token-1234567890abcdef" },
    });
    if (res.statusCode === 200) {
      const body = res.json();
      if (predicate(body.status)) return body;
    }
    await sleep(50);
  }
  throw new Error(`job ${jobId} did not reach desired state in ${timeoutMs}ms`);
}

describe("smoke", () => {
  let handle: AppHandle;
  let config: ReturnType<typeof makeTempVaultConfig>;
  let dispatcher: FakeDispatcher;

  beforeEach(async () => {
    ({ handle, config, dispatcher } = await bootstrap());
  });

  afterEach(async () => {
    await handle.close();
  });

  it("rejects unauthenticated requests", async () => {
    const res = await handle.app.inject({ method: "POST", url: "/ingest", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("rejects wrong token", async () => {
    const res = await handle.app.inject({
      method: "POST",
      url: "/ingest",
      headers: { authorization: "Bearer wrong-token-zzzzzzzzzz" },
      payload: { sourceRelPath: "raw/inbox/foo.md" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("ingests a real source end-to-end via FakeDispatcher", async () => {
    const sourcePath = join(config.VAULT_PATH, "raw/inbox/2026-04-07-test.md");
    writeFileSync(sourcePath, "# test source\nhello world\n");

    const res = await handle.app.inject({
      method: "POST",
      url: "/ingest",
      headers: { authorization: "Bearer test-token-1234567890abcdef" },
      payload: { sourceRelPath: "raw/inbox/2026-04-07-test.md" },
    });
    expect(res.statusCode).toBe(202);
    const { jobId } = res.json();
    expect(jobId).toBeTypeOf("string");

    const final = await pollJob(handle, jobId, (s) => s === "succeeded" || s === "failed");
    expect(final.status).toBe("succeeded");
    expect(final.result).toBeTruthy();
    expect(final.sessionId).toBe(`sess-${jobId}`);

    const log = readFileSync(join(config.VAULT_PATH, "log.md"), "utf8");
    expect(log).toContain(`ingest | ${jobId}`);
  });

  it("rejects path traversal", async () => {
    const res = await handle.app.inject({
      method: "POST",
      url: "/ingest",
      headers: { authorization: "Bearer test-token-1234567890abcdef" },
      payload: { sourceRelPath: "raw/../../../etc/passwd" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects paths outside raw/", async () => {
    writeFileSync(join(config.VAULT_PATH, "wiki/entities/foo.md"), "# foo\n");
    const res = await handle.app.inject({
      method: "POST",
      url: "/ingest",
      headers: { authorization: "Bearer test-token-1234567890abcdef" },
      payload: { sourceRelPath: "wiki/entities/foo.md" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects sources larger than MAX_SOURCE_BYTES", async () => {
    const big = join(config.VAULT_PATH, "raw/inbox/big.md");
    writeFileSync(big, "x".repeat(70_000));
    const res = await handle.app.inject({
      method: "POST",
      url: "/ingest",
      headers: { authorization: "Bearer test-token-1234567890abcdef" },
      payload: { sourceRelPath: "raw/inbox/big.md" },
    });
    expect(res.statusCode).toBe(413);
  });

  it("processes parallel ingests serially in enqueue order", async () => {
    dispatcher.sleepMs = 50;
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(config.VAULT_PATH, `raw/inbox/p${i}.md`), `# p${i}\n`);
      const res = await handle.app.inject({
        method: "POST",
        url: "/ingest",
        headers: { authorization: "Bearer test-token-1234567890abcdef" },
        payload: { sourceRelPath: `raw/inbox/p${i}.md` },
      });
      expect(res.statusCode).toBe(202);
      ids.push(res.json().jobId);
    }
    // Wait for all to complete.
    for (const id of ids) {
      const final = await pollJob(handle, id, (s) => s === "succeeded" || s === "failed", 10_000);
      expect(final.status).toBe("succeeded");
    }
    expect(dispatcher.seen).toEqual(ids);
  });

  it("marks dispatcher failures as failed jobs", async () => {
    dispatcher.failNext = true;
    writeFileSync(join(config.VAULT_PATH, "raw/inbox/will-fail.md"), "# x\n");
    const res = await handle.app.inject({
      method: "POST",
      url: "/ingest",
      headers: { authorization: "Bearer test-token-1234567890abcdef" },
      payload: { sourceRelPath: "raw/inbox/will-fail.md" },
    });
    expect(res.statusCode).toBe(202);
    const final = await pollJob(handle, res.json().jobId, (s) => s === "failed");
    expect(final.status).toBe("failed");
    expect(final.errorText).toContain("synthetic failure");
  });

  it("/health reports vault and db ok", async () => {
    const res = await handle.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.vault).toBe(true);
    expect(body.db).toBe(true);
  });

  it("query route enqueues a query job", async () => {
    const res = await handle.app.inject({
      method: "POST",
      url: "/query",
      headers: { authorization: "Bearer test-token-1234567890abcdef" },
      payload: { question: "what is foo?", mode: "answer-only" },
    });
    expect(res.statusCode).toBe(202);
    const final = await pollJob(handle, res.json().jobId, (s) => s === "succeeded");
    expect(final.status).toBe("succeeded");
  });

  it("lint route enqueues a lint job", async () => {
    const res = await handle.app.inject({
      method: "POST",
      url: "/lint",
      headers: { authorization: "Bearer test-token-1234567890abcdef" },
      payload: { scope: "recent" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("reindex route enqueues a reindex job", async () => {
    const res = await handle.app.inject({
      method: "POST",
      url: "/reindex",
      headers: { authorization: "Bearer test-token-1234567890abcdef" },
    });
    expect(res.statusCode).toBe(202);
  });
});
