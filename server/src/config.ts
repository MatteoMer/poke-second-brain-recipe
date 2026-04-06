import { z } from "zod";
import "dotenv/config";

const Schema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("127.0.0.1"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  VAULT_PATH: z.string().min(1),
  DB_PATH: z.string().min(1),
  INVARIANTS_FILE: z.string().min(1),

  API_TOKEN: z.string().min(16, "API_TOKEN must be at least 16 chars"),

  CLAUDE_BIN: z.string().min(1).default("claude"),
  JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  MAX_SOURCE_BYTES: z.coerce.number().int().positive().default(262_144),
  DISALLOWED_TOOLS: z
    .string()
    .default("WebSearch,WebFetch")
    .transform((s) =>
      s
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    ),
});

export type Config = z.infer<typeof Schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`invalid environment:\n  ${issues}`);
  }
  return parsed.data;
}
