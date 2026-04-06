import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { JobRepo } from "../queue/repo.js";

const Body = z.object({
  scope: z.enum(["all", "recent"]).default("recent"),
});

export function registerLint(
  app: FastifyInstance,
  deps: { repo: JobRepo; preHandler: unknown },
): void {
  app.post("/lint", { preHandler: deps.preHandler as never }, async (req, reply) => {
    const parsed = Body.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const { id } = deps.repo.enqueue("lint", parsed.data);
    return reply.code(202).send({ jobId: id, status: "queued" });
  });
}
