"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Atualiza a página periodicamente enquanto houver trabalho em andamento. */
export function AutoRefresh({ active, intervalMs = 4000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);
  return active ? <span className="text-xs text-muted">Atualizando automaticamente…</span> : null;
}
