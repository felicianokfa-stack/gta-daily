import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { Sql } from "./sql";

type Queryable = PGlite | Transaction;

function wrap(db: Queryable, root: PGlite): Sql {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
    async exec(script: string) {
      await db.exec(script);
    },
    async transaction<T>(fn: (tx: Sql) => Promise<T>) {
      // PGlite não aninha transações; dentro de uma transação reutilizamos a mesma.
      if (db !== root) return fn(wrap(db, root));
      return root.transaction((tx) => fn(wrap(tx, root)));
    },
    async close() {
      await root.close();
    },
  };
}

/** Banco Postgres embutido (WASM): desenvolvimento local e testes. `dataDir` omitido = memória. */
export async function createPgliteSql(dataDir?: string): Promise<{ sql: Sql; raw: PGlite }> {
  const raw = dataDir ? new PGlite(dataDir) : new PGlite();
  await raw.waitReady;
  return { sql: wrap(raw, raw), raw };
}
