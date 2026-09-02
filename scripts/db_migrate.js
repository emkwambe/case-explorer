#!/usr/bin/env node
// scripts/db_migrate.js — Apply SQL migrations in src/db/migrations in order (idempotent).
//   DATABASE_URL=postgres://... node scripts/db_migrate.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "src", "db", "migrations");

export async function migrate(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) { console.error("DATABASE_URL is not set"); process.exit(2); }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    const applied = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map(r => r.name));
    const files = fs.readdirSync(DIR).filter(f => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (applied.has(f)) { console.log(`skip    ${f}`); continue; }
      const sql = fs.readFileSync(path.join(DIR, f), "utf8");
      await client.query("BEGIN");
      try { await client.query(sql); await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]); await client.query("COMMIT"); console.log(`applied ${f}`); }
      catch (e) { await client.query("ROLLBACK"); throw e; }
    }
  } finally { await client.end(); }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) migrate().catch(e => { console.error(e.message); process.exit(1); });
