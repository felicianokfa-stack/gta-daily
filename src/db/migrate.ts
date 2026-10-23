import fs from "node:fs/promises";
import path from "node:path";
import type { Sql } from "./sql";

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const AUTH_STUB = path.join(ROOT, "supabase", "local", "auth_stub.sql");

/**
 * Aplica o stub de auth e as migrations no banco LOCAL (PGlite).
 * No Supabase real, as mesmas migrations são aplicadas pelo Supabase (CLI/MCP), sem o stub.
 */
export async function migrateLocal(sql: Sql): Promise<string[]> {
  await sql.exec(await fs.readFile(AUTH_STUB, "utf8"));
  await sql.query(`create schema if not exists local_meta`);
  await sql.query(
    `create table if not exists local_meta.migrations (name text primary key, applied_at timestamptz not null default now())`,
  );
  const applied = new Set(
    (await sql.query<{ name: string }>(`select name from local_meta.migrations`)).map((r) => r.name),
  );
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const text = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    await sql.transaction(async (tx) => {
      await tx.exec(text);
      await tx.query(`insert into local_meta.migrations (name) values ($1)`, [file]);
    });
    ran.push(file);
  }
  return ran;
}
