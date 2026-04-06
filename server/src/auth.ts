import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Constant-time bearer-token check. Token comes from config and is compared
 * against the `Authorization: Bearer <token>` header. No user accounts.
 */
export function makeAuthHook(expectedToken: string) {
  const expected = Buffer.from(expectedToken, "utf8");
  return async function authHook(req: FastifyRequest, reply: FastifyReply) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      reply.code(401).send({ error: "missing_authorization" });
      return reply;
    }
    const provided = Buffer.from(header.slice("Bearer ".length), "utf8");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      reply.code(401).send({ error: "invalid_token" });
      return reply;
    }
    return undefined;
  };
}
