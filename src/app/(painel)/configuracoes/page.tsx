import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { CONNECTOR_STATE } from "@/lib/labels";
import { listConnectors } from "@/connectors/registry";
import { resolveProviderId } from "@/connectors/ai/factory";
import { PROVIDER_IDS, PROVIDER_LABEL, type ProviderId } from "@/connectors/ai/ids";
import { describeProviders } from "@/connectors/ai/status";
import { listProjects } from "@/orchestrator/queries";
import { Badge, Card, Empty, PageHeader, formatDate } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { setProjectProviderAction, testProviderConnectionAction } from "../../actions";

export const dynamic = "force-dynamic";

interface TestRow {
  data: { provider?: string; ok?: boolean; message?: string; models?: string[] };
  created_at: Date;
}

export default async function ConfiguracoesPage() {
  const user = await requireUser();
  const sql = await getDb();
  const [projects, tests] = await Promise.all([
    listProjects(sql, user.id),
    sql.query<TestRow>(
      `select data, created_at from audit_events where owner_id = $1 and action = 'ai.connection_test' order by id desc limit 40`,
      [user.id],
    ),
  ]);
  const providers = describeProviders();
  const lastTest = (id: ProviderId) => tests.find((t) => t.data.provider === id);
  const other = listConnectors().filter((c) => !c.id.startsWith("ia_") && c.id === "youtube");

  return (
    <>
      <PageHeader
        title="Configurações de IA e conectores"
        description="Escolha qual provedor de IA cada projeto usa. Trocar de provedor não altera projetos, fontes, roteiros nem histórico. Nenhuma chave aparece aqui: só se ela está configurada ou ausente."
      />
      <div className="grid gap-6">
        <Card title="Provedor por projeto">
          {projects.length === 0 ? (
            <Empty>Crie um projeto em Projetos para escolher o provedor de IA dele.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {projects.map((p) => {
                const own = typeof p.settings?.ai_provider === "string" ? resolveProviderId(p.settings) : null;
                const effective = resolveProviderId(p.settings);
                return (
                  <li key={p.id} className="py-3 text-sm">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      {effective ? (
                        <Badge tone={effective === "mock" ? "warning" : "info"}>
                          {PROVIDER_LABEL[effective]}
                          {own ? "" : " (padrão do servidor, AI_PROVIDER)"}
                        </Badge>
                      ) : (
                        <Badge tone="danger">Nenhum provedor escolhido</Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-start gap-2">
                      {PROVIDER_IDS.map((id) => (
                        <ActionButton
                          key={id}
                          action={setProjectProviderAction.bind(null, p.id, id)}
                          label={PROVIDER_LABEL[id]}
                          variant={effective === id ? "primary" : "secondary"}
                          pendingLabel="Salvando…"
                          confirm={
                            id === "anthropic"
                              ? "A API da Anthropic é paga e gera cobrança por uso. Ativar para este projeto?"
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">
            O provedor nunca muda sozinho: se um provedor falhar ou atingir o limite gratuito, a etapa fica em “Exige ação” e você decide se espera ou
            troca aqui (por exemplo, para o modo de demonstração).
          </p>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          {providers.map((p) => {
            const test = lastTest(p.id);
            return (
              <Card
                key={p.id}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {p.label}
                    <Badge tone={p.mode === "demonstracao" ? "warning" : "info"}>{p.mode === "demonstracao" ? "Demonstração" : "IA real"}</Badge>
                  </span>
                }
                actions={<ActionButton action={testProviderConnectionAction.bind(null, p.id)} label="Testar conexão" variant="secondary" pendingLabel="Testando…" />}
              >
                <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div>
                    <dt className="text-muted">Credencial</dt>
                    <dd>
                      {p.mode === "demonstracao" ? (
                        "Não precisa"
                      ) : p.configured ? (
                        <Badge tone="success">Configurada</Badge>
                      ) : (
                        <Badge tone="warning">Ausente ({p.missing})</Badge>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Modelo</dt>
                    <dd>{p.model ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Busca na web</dt>
                    <dd>{p.webSearch ? "Habilitada" : "Desabilitada"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Último teste</dt>
                    <dd>{test ? `${test.data.ok ? "ok" : "falhou"} em ${formatDate(test.created_at)}` : "nunca testado"}</dd>
                  </div>
                </dl>
                {test && !test.data.ok && test.data.message && <p className="mb-3 text-xs text-rose-600 dark:text-rose-400">{test.data.message}</p>}
                {test?.data.models && test.data.models.length > 0 && (
                  <p className="mb-3 text-xs text-muted">Modelos que esta chave pode usar: {test.data.models.join(", ")}</p>
                )}
                <ul className="ml-4 list-disc space-y-1 text-xs text-muted">
                  {p.limits.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>

        <Card title="Outras integrações (status separado)">
          <ul className="divide-y divide-border text-sm">
            {other.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                <div className="max-w-xl">
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-muted">{c.notes}</p>
                </div>
                <Badge tone={CONNECTOR_STATE[c.state].tone}>{CONNECTOR_STATE[c.state].label}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
