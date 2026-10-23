import { listAgentRoles } from "@/agents/registry";
import { listConnectors } from "@/connectors/registry";
import { listPipelines } from "@/orchestrator/pipelines";
import { requireUser } from "@/lib/auth";
import { CONNECTOR_STATE, ROLE_LABEL } from "@/lib/labels";
import { Badge, Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AgentesPage() {
  await requireUser();
  const roles = listAgentRoles();
  const connectors = listConnectors();
  const pipelines = listPipelines();
  return (
    <>
      <PageHeader
        title="Agentes e conectores"
        description="Agentes de função são reutilizáveis entre nichos. Conectores mostram o estado real: nada aparece como conectado sem credencial."
      />
      <div className="grid gap-6">
        <Card title="Agentes de função">
          <ul className="divide-y divide-border text-sm">
            {roles.map((r) => (
              <li key={r.role} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="font-medium">{ROLE_LABEL[r.role] ?? r.role}</p>
                  {r.description && <p className="text-xs text-muted">{r.description}</p>}
                </div>
                {r.implemented ? <Badge tone="success">{r.version}</Badge> : <Badge>Previsto nos próximos blocos</Badge>}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Pipelines disponíveis">
          <ul className="text-sm">
            {pipelines.map((p) => (
              <li key={p.id}>
                <span className="font-medium">{p.name}</span>:{" "}
                <span className="text-muted">{p.steps.map((s) => ROLE_LABEL[s] ?? s).join(" → ")}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Matriz de conectores">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-2 font-medium">Conector</th>
                <th className="py-2 font-medium">Estado</th>
                <th className="py-2 font-medium">Observações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border align-top">
              {connectors.map((c) => (
                <tr key={c.id}>
                  <td className="py-2.5 pr-3">
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-muted">{c.purpose}</p>
                  </td>
                  <td className="py-2.5 pr-3">
                    <Badge tone={CONNECTOR_STATE[c.state].tone}>{CONNECTOR_STATE[c.state].label}</Badge>
                  </td>
                  <td className="py-2.5 text-xs text-muted">{c.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
