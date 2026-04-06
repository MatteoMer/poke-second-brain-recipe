import type { FastifyInstance } from "fastify";
import type { JobRepo } from "../queue/repo.js";

export function registerReindex(
  app: FastifyInstance,
  deps: { repo: JobRepo; preHandler: unknown },
): void {
  app.post("/reindex", { preHandler: deps.preHandler as never }, async (_req, reply) => {
    const { id } = deps.repo.enqueue("reindex", {});
    return reply.code(202).send({ jobId: id, status: "queued" });
  });
}
