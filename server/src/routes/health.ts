import { existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { VaultFileLock } from "../queue/lock.js";

const VERSION = "0.1.0";

export function registerHealth(
  app: FastifyInstance,
  deps: { config: Config; fileLock: VaultFileLock },
): void {
  app.get("/health", async () => {
    let dbOk = false;
    try {
      // The db client is on the fastify instance via decorator (set in index.ts).
      const db = (app as unknown as { db: { prepare: (sql: string) => { get: () => unknown } } }).db;
      db.prepare("SELECT 1").get();
      dbOk = true;
    } catch {
      dbOk = false;
    }
    return {
      ok: true,
      vault: existsSync(deps.config.VAULT_PATH),
      db: dbOk,
      lockHeld: deps.fileLock.isHeld(),
      version: VERSION,
    };
  });
}
