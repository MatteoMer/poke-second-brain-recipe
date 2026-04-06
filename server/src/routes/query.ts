import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { JobRepo } from "../queue/repo.js";

const Body = z.object({
  question: z.string().min(1).max(4000),
  mode: z.enum(["answer-only", "file-back-into-wiki"]).default("answer-only"),
});

export function registerQuery(
  app: FastifyInstance,
  deps: { repo: JobRepo; preHandler: unknown },
): void {
  app.post("/query", { preHandler: deps.preHandler as never }, async (req, reply) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const { id } = deps.repo.enqueue("query", parsed.data);
    return reply.code(202).send({ jobId: id, status: "queued" });
  });
}
