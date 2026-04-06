import { promises as fsp } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import type { JobRepo } from "../queue/repo.js";
import { GuardError, sanitizeRelPath, assertUnder } from "../claude/guards.js";

const Body = z.object({
  sourceRelPath: z.string().min(1).max(1024),
  focus: z.string().max(2000).optional(),
});

export function registerIngest(
  app: FastifyInstance,
  deps: { config: Config; repo: JobRepo; preHandler: unknown },
): void {
  app.post("/ingest", { preHandler: deps.preHandler as never }, async (req, reply) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const { sourceRelPath, focus } = parsed.data;

    let normalized: string;
    try {
      normalized = sanitizeRelPath(sourceRelPath, "raw");
    } catch (e) {
      if (e instanceof GuardError) {
        return reply.code(400).send({ error: "invalid_path", reason: e.code });
      }
      throw e;
    }

    const abs = resolve(deps.config.VAULT_PATH, normalized);
    let realAbs: string;
    try {
      realAbs = await fsp.realpath(abs);
    } catch {
      return reply.code(404).send({ error: "source_not_found", path: normalized });
    }
    try {
      assertUnder(realAbs, deps.config.VAULT_PATH, "raw");
    } catch (e) {
      if (e instanceof GuardError) {
        return reply.code(400).send({ error: "path_escapes_raw", reason: e.code });
      }
      throw e;
    }

    let stat;
    try {
      stat = await fsp.stat(realAbs);
    } catch {
      return reply.code(404).send({ error: "source_not_found", path: normalized });
    }
    if (!stat.isFile()) {
      return reply.code(400).send({ error: "source_not_file" });
    }
    if (stat.size > deps.config.MAX_SOURCE_BYTES) {
      return reply.code(413).send({ error: "source_too_large", size: stat.size });
    }

    const { id } = deps.repo.enqueue("ingest", { sourceRelPath: normalized, focus });
    return reply.code(202).send({ jobId: id, status: "queued" });
  });
}
