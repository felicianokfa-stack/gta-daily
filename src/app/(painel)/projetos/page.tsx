import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { PLATFORM_LABEL } from "@/lib/labels";
import { getNiche, listNiches } from "@/core/niches";
import { listProjects } from "@/orchestrator/queries";
import { Badge, Card, Empty, PageHeader, formatDate } from "@/components/ui";
import { formatUsd } from "@/connectors/pricing";
import { ProjectForm } from "./project-form";

export const dynamic = "force-dynamic";

export default async function ProjetosPage() {
  const user = await requireUser();
  const projects = await listProjects(await getDb(), user.id);
  const niches = listNiches().map(({ id, name, default_audience }) => ({ id, name, default_audience }));
  return (
    <>
      <PageHeader
        title="Projetos"
        description="Cada projeto define nicho, público, idioma e plataformas. O nicho fornece o contexto que os agentes usam."
      />
      <div className="grid gap-6">
        <Card title="Novo projeto">
          <ProjectForm niches={niches} />
        </Card>
        <Card title="Seus projetos">
          {projects.length === 0 ? (
            <Empty>Nenhum projeto ainda.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {projects.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted">
                      Nicho {getNiche(p.niche).name} · {p.language} · orçamento{" "}
                      {p.settings?.monthly_budget_usd ? `${formatUsd(p.settings.monthly_budget_usd)}/mês` : "sem limite"} · criado em{" "}
                      {formatDate(p.created_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {p.platforms.map((pl) => (
                      <Badge key={pl}>{PLATFORM_LABEL[pl] ?? pl}</Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
