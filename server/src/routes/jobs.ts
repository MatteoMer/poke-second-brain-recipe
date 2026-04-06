import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { JobRepo } from "../queue/repo.js";

const Params = z.object({
  id: z.string().uuid(),
});

export function registerJobs(
  app: FastifyInstance,
  deps: { repo: JobRepo; preHandler: unknown },
): void {
  app.get("/jobs/:id", { preHandler: deps.preHandler as never }, async (req, reply) => {
    const parsed = Params.safeParse(req.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_id" });
    }
    const job = deps.repo.getById(parsed.data.id);
    if (!job) {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply.send(job);
  });
}
