import Database, { type Database as DB } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { runMigrations } from "./migrations.js";

export type { DB };

/**
 * Open the SQLite database, ensure parent directory exists, set pragmas,
 * and run migrations. Synchronous because better-sqlite3 is synchronous.
 */
export function openDatabase(dbPath: string): DB {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  runMigrations(db);
  return db;
}
