import { timingSafeEqual } from "node:crypto";
import { getOrchestrator } from "@/lib/orchestrator";

// Uma rodada do worker para ambientes serverless (ex.: Vercel Cron).
// Protegida por CRON_SECRET; sem o segredo configurado a rota fica desativada.
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const orch = await getOrchestrator(`cron-${crypto.randomUUID().slice(0, 8)}`);
  const results = await orch.drain(Number(process.env.WORKER_TICK_MAX ?? 3));
  return Response.json({ processed: results.length, results });
}
