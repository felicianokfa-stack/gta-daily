import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { RUN_STATUS } from "@/lib/labels";
import { formatTimestamp } from "@/core/transcript";
import { getMedia, listClipCandidates, listDrafts, listMediaRuns, type DraftListItem } from "@/orchestrator/queries";
import type { ClipCandidateRow } from "@/orchestrator/types";
import { Badge, Card, Empty, PageHeader, formatDate } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { SimulatedBanner } from "@/components/simulated-banner";
import { analyzeMediaAction, produceClipAction, setClipStatusAction } from "../../../actions";

export const dynamic = "force-dynamic";

const CLIP_STATUS = {
  sugerido: { label: "Sugerido", tone: "neutral" },
  selecionado: { label: "Selecionado", tone: "success" },
  descartado: { label: "Descartado", tone: "neutral" },
} as const;

function ClipCard({ clip, mediaId, drafts }: { clip: ClipCandidateRow; mediaId: string; drafts: DraftListItem[] }) {
  const status = CLIP_STATUS[clip.status];
  return (
    <li className="py-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{clip.title}</p>
          <p className="text-xs text-muted">
            {formatTimestamp(Number(clip.start_s))}–{formatTimestamp(Number(clip.end_s))} ({clip.start_s}s–{clip.end_s}s) · trechos{" "}
            {clip.segment_ids.join(", ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge title="Interesse editorial estimado (não é probabilidade de viralizar)">Pontuação {clip.score}/100</Badge>
          <Badge tone={status.tone}>{status.label}</Badge>
          {clip.simulated && <Badge tone="warning">Simulado</Badge>}
        </div>
      </div>
      <p className="mt-2">{clip.justification}</p>
      <p className="mt-1 text-xs text-muted">Motivo da pontuação: {clip.score_reason}</p>
      {clip.risks.length > 0 && <p className="mt-1 text-xs text-muted">Riscos: {clip.risks.join(" · ")}</p>}
      {drafts.length > 0 && (
        <p className="mt-2 text-xs">
          Rascunhos:{" "}
          {drafts.map((d) => (
            <Link key={d.id} href={`/cortes/${d.id}`} className="mr-2 underline underline-offset-2">
              {formatDate(d.created_at)} ({d.status.replace("_", " ")})
            </Link>
          ))}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {clip.status === "selecionado" && (
          <ActionButton
            action={produceClipAction.bind(null, mediaId, clip.id)}
            label="Produzir roteiro e versões"
            pendingLabel="Criando produção…"
          />
        )}
        {clip.status !== "selecionado" && (
          <ActionButton action={setClipStatusAction.bind(null, mediaId, clip.id, "selecionado")} label="Selecionar corte" variant="secondary" />
        )}
        {clip.status !== "descartado" && (
          <ActionButton action={setClipStatusAction.bind(null, mediaId, clip.id, "descartado")} label="Descartar" variant="secondary" />
        )}
        {clip.status !== "sugerido" && (
          <ActionButton action={setClipStatusAction.bind(null, mediaId, clip.id, "sugerido")} label="Voltar a sugerido" variant="secondary" />
        )}
      </div>
    </li>
  );
}

export default async function MaterialPage({ params }: PageProps<"/biblioteca/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sql = await getDb();
  const media = await getMedia(sql, user.id, id);
  if (!media) notFound();
  const [clips, runs, drafts] = await Promise.all([
    listClipCandidates(sql, user.id, id),
    listMediaRuns(sql, user.id, id),
    listDrafts(sql, user.id, { mediaId: id }),
  ]);
  const metadata = Object.entries(media.metadata ?? {}).filter(([, v]) => typeof v === "string" && v.trim() !== "");

  return (
    <>
      <PageHeader
        title={media.title}
        description={`Projeto ${media.project_name} · ${formatTimestamp(media.duration_seconds)} · criado em ${formatDate(media.created_at)}`}
        actions={<ActionButton action={analyzeMediaAction.bind(null, media.id)} label="Analisar material" pendingLabel="Criando análise…" />}
      />
      {(media.is_sample || clips.some((c) => c.simulated)) && (
        <SimulatedBanner detail="Este material é um exemplo fictício e/ou há cortes vindos do modo de demonstração. Nada aqui é conteúdo real." />
      )}
      <div className="grid gap-6">
        <Card title="Cortes candidatos">
          {clips.length === 0 ? (
            <Empty>Nenhum corte ainda. Clique em “Analisar material”, e depois em “Processar fila agora” na página da execução.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {clips.map((c) => (
                <ClipCard key={c.id} clip={c} mediaId={media.id} drafts={drafts.filter((d) => d.clip_id === c.id)} />
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">
            A pontuação é o interesse editorial estimado pelo agente a partir da transcrição. Não é probabilidade de viralizar nem promessa de resultado.
          </p>
        </Card>

        <Card title="Análises deste material">
          {runs.length === 0 ? (
            <Empty>Ainda não houve análise.</Empty>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {runs.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <Link href={`/execucoes/${r.id}`} className="hover:underline">
                    Execução de {formatDate(r.created_at)}
                  </Link>
                  <Badge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Material">
          <dl className="mb-4 grid gap-x-6 gap-y-1 text-xs md:grid-cols-2">
            <div>
              <dt className="text-muted">Autorização declarada</dt>
              <dd>{media.usage_rights.basis}</dd>
            </div>
            {media.url && (
              <div>
                <dt className="text-muted">Link (referência, nada foi baixado)</dt>
                <dd className="truncate">
                  <a href={media.url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">
                    {media.url}
                  </a>
                </dd>
              </div>
            )}
            {metadata.map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted">{k}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
          </dl>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Transcrição ({media.transcript.length} trechos)</summary>
            <ol className="mt-3 space-y-1.5 text-xs">
              {media.transcript.map((s) => (
                <li key={s.id}>
                  <span className="mr-2 text-muted">
                    [{s.id}] {formatTimestamp(s.start_s)}–{formatTimestamp(s.end_s)}
                  </span>
                  {s.text}
                </li>
              ))}
            </ol>
          </details>
        </Card>
      </div>
    </>
  );
}
