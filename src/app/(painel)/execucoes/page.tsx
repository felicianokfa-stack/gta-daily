import Link from "next/link";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { RUN_STATUS } from "@/lib/labels";
import { listProjects, listRuns } from "@/orchestrator/queries";
import { Badge, Card, Empty, PageHeader, formatDate } from "@/components/ui";
import { RunForm } from "./run-form";

export const dynamic = "force-dynamic";

export default async function ExecucoesPage() {
  const user = await requireUser();
  const sql = await getDb();
  const [projects, runs] = await Promise.all([listProjects(sql, user.id), listRuns(sql, user.id)]);
  return (
    <>
      <PageHeader title="Execuções" description="Cada execução passa pelas etapas do pipeline com estado salvo: sair da tela não perde nada." />
      <div className="grid gap-6">
        <div id="nova">
          <Card title="Nova pesquisa">
            <RunForm projects={projects.map(({ id, name }) => ({ id, name }))} />
          </Card>
        </div>
        <Card title="Histórico">
          {runs.length === 0 ? (
            <Empty>Nenhuma execução ainda.</Empty>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-2 font-medium">Tema</th>
                  <th className="py-2 font-medium">Projeto</th>
                  <th className="py-2 font-medium">Criada em</th>
                  <th className="py-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2.5 pr-3">
                      <Link href={`/execucoes/${r.id}`} className="hover:underline">
                        {String(r.input.topic ?? r.id)}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3 text-muted">{r.project_name}</td>
                    <td className="py-2.5 pr-3 text-muted">{formatDate(r.created_at)}</td>
                    <td className="py-2.5">
                      <Badge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
