import { pino, type Logger } from "pino";
import type { Config } from "./config.js";

export function makeLogger(config: Config): Logger {
  const isDev = config.NODE_ENV === "development";
  return pino({
    level: config.LOG_LEVEL,
    base: { svc: "llm-wiki-api" },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(isDev
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss.l" },
          },
        }
      : {}),
  });
}

export type { Logger };
