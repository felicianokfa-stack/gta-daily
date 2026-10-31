import Link from "next/link";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatTimestamp } from "@/core/transcript";
import { listMedia, listProjects } from "@/orchestrator/queries";
import { Badge, Card, Empty, PageHeader, formatDate } from "@/components/ui";
import { MediaForm, SampleMediaForm } from "./media-forms";

export const dynamic = "force-dynamic";

const KIND_LABEL = { link: "Link + transcrição", transcricao: "Transcrição", exemplo: "Exemplo fictício" } as const;

export default async function BibliotecaPage() {
  const user = await requireUser();
  const sql = await getDb();
  const [projects, media] = await Promise.all([listProjects(sql, user.id), listMedia(sql, user.id)]);
  const options = projects.map((p) => ({ id: p.id, name: p.name }));

  return (
    <>
      <PageHeader
        title="Biblioteca"
        description="Materiais para análise: link como referência, metadados e transcrição com marcações de tempo. A plataforma não baixa nem republica vídeos."
      />
      {projects.length === 0 ? (
        <Empty>
          Crie um projeto em{" "}
          <Link href="/projetos" className="underline">
            Projetos
          </Link>{" "}
          para adicionar materiais.
        </Empty>
      ) : (
        <div className="grid gap-6">
          <Card title="Como funciona (5 passos)">
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li><strong>Material:</strong> cadastre um texto com tempos ou use o exemplo fictício abaixo.</li>
              <li><strong>Analisar:</strong> abra o material em “Seus materiais” e clique em “Analisar material”. O agente sugere cortes.</li>
              <li><strong>Escolher corte:</strong> na página do material, clique em “Selecionar corte” no que você preferir.</li>
              <li><strong>Produzir:</strong> clique em “Produzir roteiro e versões”. Cinco agentes montam um rascunho (não gera vídeo).</li>
              <li><strong>Decidir:</strong> no rascunho (menu Cortes) você aprova ou rejeita. Nada é publicado.</li>
            </ol>
            <p className="mt-3 text-xs text-muted">
              Os passos 2 e 4 rodam sozinhos e podem levar de alguns segundos a 1–2 minutos com IA real. O Instagram Carrossel (slides) não entra na produção de cortes.
            </p>
          </Card>
          <Card title="Testar com um material de exemplo">
            <p className="mb-3 text-sm text-muted">
              Adiciona um vídeo <strong>inventado</strong> (sem nenhum fato real) só para você testar a análise e os cortes.
            </p>
            <SampleMediaForm projects={options} />
          </Card>
          <Card title="Novo material">
            <MediaForm projects={options} />
          </Card>
          <Card title="Seus materiais">
            {media.length === 0 ? (
              <Empty>Nenhum material ainda.</Empty>
            ) : (
              <ul className="divide-y divide-border">
                {media.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                    <div className="min-w-0">
                      <Link href={`/biblioteca/${m.id}`} className="font-medium hover:underline">
                        {m.title}
                      </Link>
                      <p className="text-xs text-muted">
                        {m.project_name} · {formatTimestamp(m.duration_seconds)} · {m.transcript.length} trecho(s) · {m.analyses} análise(s) ·{" "}
                        {m.candidates} corte(s) · {formatDate(m.created_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Badge>{KIND_LABEL[m.kind]}</Badge>
                      {m.is_sample && <Badge tone="warning">Fictício</Badge>}
                      <Badge tone="success">Autorização declarada</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
