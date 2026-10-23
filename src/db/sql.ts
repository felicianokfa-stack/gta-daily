/** Interface mínima de acesso SQL usada pelo orquestrador e pelos repositórios. */
export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Executa um script com vários comandos (migrations). Sem parâmetros. */
  exec(script: string): Promise<void>;
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Serializa um valor para um parâmetro `$n::jsonb`. */
export function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}
