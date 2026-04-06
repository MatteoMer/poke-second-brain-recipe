import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import { searchWiki } from "../search/index.js";

const Query = z.object({
  q: z.string().min(1).max(200),
  type: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export function registerSearch(
  app: FastifyInstance,
  deps: { config: Config; preHandler: unknown },
): void {
  app.get("/search", { preHandler: deps.preHandler as never }, async (req, reply) => {
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", issues: parsed.error.issues });
    }
    const results = await searchWiki({
      vaultPath: deps.config.VAULT_PATH,
      query: parsed.data.q,
      type: parsed.data.type,
      limit: parsed.data.limit,
    });
    return reply.send({ results });
  });
}
