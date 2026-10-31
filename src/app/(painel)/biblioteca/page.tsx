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
