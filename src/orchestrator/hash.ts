import { createHash } from "node:crypto";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, stable((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** Hash estável da entrada (sem notas de correção) para reaproveitar resultados válidos. */
export function inputHash(input: Record<string, unknown>): string {
  const { correction_notes: _ignored, ...rest } = input;
  return createHash("sha256").update(JSON.stringify(stable(rest))).digest("hex");
}
