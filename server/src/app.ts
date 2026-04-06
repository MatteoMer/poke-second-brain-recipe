import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import sensible from "@fastify/sensible";
import rateLimit from "@fastify/rate-limit";
import type { Logger } from "pino";
import type { Config } from "./config.js";
import type { DB } from "./db/client.js";
import { JobRepo } from "./queue/repo.js";
import { VaultFileLock } from "./queue/lock.js";
import { Worker, type JobDispatcher } from "./queue/worker.js";
import { makeAuthHook } from "./auth.js";
import { registerHealth } from "./routes/health.js";
import { registerIngest } from "./routes/ingest.js";
import { registerQuery } from "./routes/query.js";
import { registerLint } from "./routes/lint.js";
import { registerJobs } from "./routes/jobs.js";
import { registerReindex } from "./routes/reindex.js";
import { registerSearch } from "./routes/search.js";

export interface AppDeps {
  config: Config;
  logger: Logger;
  db: DB;
  dispatcher: JobDispatcher;
}

export interface AppHandle {
  app: FastifyInstance;
  worker: Worker;
  fileLock: VaultFileLock;
  repo: JobRepo;
  close(): Promise<void>;
}

/**
 * Build the Fastify instance, wire routes, start the worker. The caller is
 * responsible for `app.listen()`. This shape lets tests construct the app
 * without binding a port.
 */
export async function buildApp(deps: AppDeps): Promise<AppHandle> {
  const { config, logger, db, dispatcher } = deps;

  const repo = new JobRepo(db);
  const orphaned = repo.sweepOrphaned(config.JOB_TIMEOUT_MS);
  if (orphaned > 0) logger.warn({ orphaned }, "swept orphaned jobs");

  const fileLock = new VaultFileLock(config.VAULT_PATH);

  const worker = new Worker({ config, repo, dispatcher, logger, fileLock });

  const app: FastifyInstance = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    disableRequestLogging: false,
    trustProxy: false,
  });

  // Decorate so health route can introspect the db.
  (app as unknown as { db: DB }).db = db;

  await app.register(sensible);
  await app.register(rateLimit, {
    max: 60,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.headers.authorization ?? req.ip,
  });

  const auth = makeAuthHook(config.API_TOKEN);

  registerHealth(app, { config, fileLock });
  registerIngest(app, { config, repo, preHandler: auth });
  registerQuery(app, { repo, preHandler: auth });
  registerLint(app, { repo, preHandler: auth });
  registerJobs(app, { repo, preHandler: auth });
  registerReindex(app, { repo, preHandler: auth });
  registerSearch(app, { config, preHandler: auth });

  worker.start();

  return {
    app,
    worker,
    fileLock,
    repo,
    async close() {
      await worker.stop();
      await app.close();
      try {
        await fileLock.releaseLock();
      } catch {
        /* ignore */
      }
      db.close();
    },
  };
}
