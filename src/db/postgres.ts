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
 * O app sempre envia JSON já serializado (helper `json()`) para parâmetros `$n::jsonb`. O serializador padrão do
 * postgres.js aplica `JSON.stringify` também a strings, o que gravava um JSON *dentro* de um JSON (jsonb do tipo
 * string) e quebrava toda leitura. Aqui strings passam como estão e só objetos são serializados.
 * O PGlite (testes e modo local) não tem esse comportamento, por isso o contrato é testado à parte.
 */
export const POSTGRES_JSON_TYPE = {
  to: 114,
  from: [114, 3802],
  serialize: (x: unknown): string => (typeof x === "string" ? x : JSON.stringify(x)),
  parse: (x: string): unknown => JSON.parse(x),
};

/**
 * Postgres real (Supabase). Use a connection string do pooler do Supabase.
 * `prepare: false` é exigido pelo pooler em modo transação.
 */
export function createPostgresSql(url: string): Sql {
  const root = postgres(url, { prepare: false, max: 5, idle_timeout: 20, types: { json: POSTGRES_JSON_TYPE } });
  return wrap(root, root);
}
