import postgres from "postgres";
import type { Sql } from "./sql";

type Client = postgres.Sql | postgres.TransactionSql;

function wrap(client: Client, root: postgres.Sql): Sql {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const rows = await client.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
      return rows as unknown as T[];
    },
    async exec(script: string) {
      await client.unsafe(script);
    },
    async transaction<T>(fn: (tx: Sql) => Promise<T>) {
      if (client !== root) return fn(wrap(client, root));
      return (await root.begin((tx) => fn(wrap(tx, root)))) as T;
    },
    async close() {
      await root.end({ timeout: 5 });
    },
  };
}

/**
 * Postgres real (Supabase). Use a connection string do pooler do Supabase.
 * `prepare: false` é exigido pelo pooler em modo transação.
 */
export function createPostgresSql(url: string): Sql {
  const root = postgres(url, { prepare: false, max: 5, idle_timeout: 20 });
  return wrap(root, root);
}
