import Link from "next/link";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { DRAFT_STATUS } from "@/lib/labels";
import { listDrafts } from "@/orchestrator/queries";
import { Badge, Card, Empty, PageHeader, formatDate } from "@/components/ui";
import { SimulatedBanner } from "@/components/simulated-banner";

export const dynamic = "force-dynamic";

export default async function CortesPage() {
  const user = await requireUser();
  const drafts = await listDrafts(await getDb(), user.id);
  return (
    <>
      <PageHeader
        title="Cortes em produção"
        description="Rascunhos com briefing, roteiro, plano de edição e versões por plataforma. Nada é publicado: cada um espera a sua decisão."
      />
      {drafts.some((d) => d.simulated) && <SimulatedBanner detail="Alguns rascunhos vieram do modo de demonstração (marcados como “Simulado”): são fictícios." />}
      <Card title="Histórico">
        {drafts.length === 0 ? (
          <Empty>
            Nenhum rascunho ainda. Na{" "}
            <Link href="/biblioteca" className="underline">
              Biblioteca
            </Link>
            , selecione um corte e clique em “Produzir roteiro e versões”.
          </Empty>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {drafts.map((d) => {
              const status = DRAFT_STATUS[d.status];
              return (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link href={`/cortes/${d.id}`} className="font-medium hover:underline">
                      {d.clip_title}
                    </Link>
                    <p className="text-xs text-muted">
                      {d.project_name} · {d.media_title} · {formatDate(d.created_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    <Badge tone={d.gate.passed ? "success" : "danger"}>{d.gate.passed ? "Portão ✓" : "Portão reprovado"}</Badge>
                    {d.simulated && <Badge tone="warning">Simulado</Badge>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
