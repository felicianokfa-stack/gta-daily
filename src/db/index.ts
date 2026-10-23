import { mkdirSync } from "node:fs";
import path from "node:path";
import { createPgliteSql } from "./pglite";
import { createPostgresSql } from "./postgres";
import { migrateLocal } from "./migrate";
import type { Sql } from "./sql";

export type DbMode = "postgres" | "pglite";

export function dbMode(): DbMode {
  return process.env.DATABASE_URL ? "postgres" : "pglite";
}

const globalForDb = globalThis as unknown as { __gtaDb?: Promise<Sql> };

/**
 * Conexão do servidor/worker (credencial de serviço; a checagem de dono é feita no código).
 * - Com DATABASE_URL: Postgres do Supabase.
 * - Sem DATABASE_URL (só fora de produção): PGlite em `.data/pglite`, migrado automaticamente.
 */
export function getDb(): Promise<Sql> {
  if (!globalForDb.__gtaDb) {
    globalForDb.__gtaDb = (async () => {
      const url = process.env.DATABASE_URL;
      if (url) return createPostgresSql(url);
      if (process.env.NODE_ENV === "production") {
        throw new Error("DATABASE_URL não configurada. Em produção o banco local não é permitido.");
      }
      const dir = path.join(process.cwd(), ".data", "pglite");
      mkdirSync(dir, { recursive: true });
      const { sql } = await createPgliteSql(dir);
      await migrateLocal(sql);
      return sql;
    })();
  }
  return globalForDb.__gtaDb;
}
