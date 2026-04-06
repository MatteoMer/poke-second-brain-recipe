import { loadConfig } from "./config.js";
import { makeLogger } from "./logger.js";
import { openDatabase } from "./db/client.js";
import { ClaudeDispatcher } from "./claude/dispatcher.js";
import { buildApp } from "./app.js";

async function main() {
  const config = loadConfig();
  const logger = makeLogger(config);
  logger.info({ port: config.PORT, vault: config.VAULT_PATH }, "starting llm-wiki-api");

  const db = openDatabase(config.DB_PATH);
  const dispatcher = new ClaudeDispatcher(config);
  const handle = await buildApp({ config, logger, db, dispatcher });

  await handle.app.listen({ port: config.PORT, host: config.HOST });
  logger.info({ url: `http://${config.HOST}:${config.PORT}` }, "listening");

  let shuttingDown = false;
  const shutdown = async (sig: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ sig }, "shutdown initiated");
    try {
      await handle.close();
      logger.info("shutdown complete");
      process.exit(0);
    } catch (e) {
      logger.error({ err: e }, "shutdown failed");
      process.exit(1);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("fatal:", e);
  process.exit(1);
});
