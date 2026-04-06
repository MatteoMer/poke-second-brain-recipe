import type { Database as DB } from "better-sqlite3";

/**
 * Schema source of truth. Inlined as a string so tsc can ship it without
 * a separate file-copy build step.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS jobs (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('ingest','query','lint','reindex')),
  status       TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  input_json   TEXT NOT NULL,
  result_json  TEXT,
  error_text   TEXT,
  session_id   TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  started_at   INTEGER,
  finished_at  INTEGER,
  duration_ms  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);
`;

const CURRENT_VERSION = 1;

/**
 * Run any pending migrations. Idempotent: safe to call on every startup.
 *
 * Versioning is intentionally minimal — we have one table and one bump-when-shape-changes
 * counter. If the schema grows, add cases to the switch below.
 */
export function runMigrations(db: DB): void {
  db.exec(SCHEMA_SQL);

  const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as
    | { version: number }
    | undefined;
  const current = row?.version ?? 0;

  if (current === CURRENT_VERSION) return;

  const tx = db.transaction(() => {
    for (let v = current + 1; v <= CURRENT_VERSION; v++) {
      switch (v) {
        case 1:
          // v1 == initial schema, already created by SCHEMA_SQL above
          break;
        default:
          throw new Error(`unknown migration version: ${v}`);
      }
    }
    db.prepare("DELETE FROM schema_version").run();
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(CURRENT_VERSION);
  });
  tx();
}
