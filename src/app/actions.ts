"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { requireUser, authMode } from "@/lib/auth";
import { getOrchestrator } from "@/lib/orchestrator";
import { PROVIDER_IDS } from "@/connectors/ai/ids";
import { testGeminiConnection } from "@/connectors/ai/gemini";
import { testOllamaConnection } from "@/connectors/ai/ollama";
import { describeProviders } from "@/connectors/ai/status";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TranscriptParseError } from "@/core/transcript";
import {
  createMedia,
  createProject,
  createSampleMedia,
  decideDraft,
  getMedia,
  NewProjectInput,
  setClipStatus,
} from "@/orchestrator/queries";
import { InvalidStateError, NotFoundError } from "@/orchestrator/engine";
import { runAndSettle } from "@/orchestrator/auto-run";

export interface ActionState {
  ok: boolean;
  message: string;
}

function failure(error: unknown): ActionState {
  if (error instanceof z.ZodError) return { ok: false, message: error.issues.map((i) => i.message).join(" · ") };
  if (error instanceof NotFoundError || error instanceof InvalidStateError || error instanceof TranscriptParseError) {
    return { ok: false, message: error.message };
  }
  console.error(error);
  return { ok: false, message: "Erro inesperado. Veja os logs do servidor." };
}

export async function createProjectAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const data = NewProjectInput.parse({
      name: form.get("name"),
      niche: form.get("niche"),
      audience: form.get("audience") ?? "",
      language: form.get("language") || "pt-BR",
      platforms: form.getAll("platforms"),
      monthly_budget_usd: form.get("monthly_budget_usd") || 0,
    });
    await createProject(await getDb(), user.id, data);
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/projetos");
  return { ok: true, message: "Projeto criado." };
}

const NewRun = z.object({
  projectId: z.uuid("Escolha um projeto"),
  topic: z.string().trim().min(3, "Descreva o tema (mínimo 3 caracteres)").max(500),
  goal: z.string().trim().max(500).default(""),
  idempotencyKey: z.string().min(8).max(100),
});

export async function createRunAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  let runId: string;
  try {
    const data = NewRun.parse({
      projectId: form.get("projectId"),
      topic: form.get("topic"),
      goal: form.get("goal") ?? "",
      idempotencyKey: form.get("idempotencyKey") || randomUUID(),
    });
    const orch = await getOrchestrator();
    const { run } = await orch.createRun({
      userId: user.id,
      projectId: data.projectId,
      pipeline: "pesquisa_verificacao",
      goal: data.goal,
      input: { topic: data.topic, goal: data.goal },
      idempotencyKey: data.idempotencyKey,
    });
    runId = run.id;
  } catch (error) {
    return failure(error);
  }
  redirect(`/execucoes/${runId}`);
}

export async function cancelRunAction(runId: string): Promise<ActionState> {
  const user = await requireUser();
  try {
    await (await getOrchestrator()).cancelRun(user.id, runId);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/execucoes/${runId}`);
  return { ok: true, message: "Execução cancelada." };
}

export async function retryTaskAction(runId: string, taskId: string): Promise<ActionState> {
  const user = await requireUser();
  try {
    await (await getOrchestrator()).retryTask(user.id, taskId);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/execucoes/${runId}`);
  return { ok: true, message: "Nova tentativa enfileirada." };
}

const OpportunityDecision = z.enum(["nova", "pronta_para_estrategia", "descartada"]);

export async function decideOpportunityAction(opportunityId: string, status: string): Promise<ActionState> {
  const user = await requireUser();
  try {
    await (await getOrchestrator()).decideOpportunity(user.id, opportunityId, OpportunityDecision.parse(status));
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/oportunidades");
  revalidatePath("/");
  return { ok: true, message: "Decisão registrada." };
}

/** Processa as tarefas prontas do próprio usuário (equivale a uma rodada do worker). */
export async function processMyQueueAction(): Promise<ActionState> {
  const user = await requireUser();
  try {
    const results = await (await getOrchestrator()).drain(10, { ownerId: user.id });
    revalidatePath("/", "layout");
    if (results.length === 0) return { ok: true, message: "Nenhuma tarefa pronta na fila." };
    return { ok: true, message: `${results.length} etapa(s) processada(s): ${results.map((r) => r.outcome).join(", ")}.` };
  } catch (error) {
    return failure(error);
  }
}

const ProviderChoice = z.enum(PROVIDER_IDS);

/** Define o provedor de IA do projeto. Não altera projetos, fontes, roteiros nem histórico: só `settings.ai_provider`. */
export async function setProjectProviderAction(projectId: string, provider: string): Promise<ActionState> {
  const user = await requireUser();
  try {
    const id = ProviderChoice.parse(provider);
    const status = describeProviders().find((p) => p.id === id);
    if (status && !status.configured) {
      return { ok: false, message: `${status.label} ainda não está configurado: falta ${status.missing} no servidor/worker.` };
    }
    const sql = await getDb();
    const rows = await sql.query<{ id: string }>(
      `update content_projects
          set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('ai_provider', $3::text), updated_at = now()
        where id = $1 and owner_id = $2 returning id`,
      [projectId, user.id, id],
    );
    if (rows.length === 0) return { ok: false, message: "Projeto não encontrado." };
    await sql.query(
      `insert into audit_events (owner_id, project_id, actor, action, data) values ($1, $2, 'user', 'ai.provider_changed', $3::jsonb)`,
      [user.id, projectId, JSON.stringify({ provider: id })],
    );
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Provedor do projeto atualizado. Projetos, fontes e histórico não foram alterados." };
}

/** Testa a conexão de um provedor sem gerar conteúdo. A API paga (Anthropic) nunca é chamada por este teste. */
export async function testProviderConnectionAction(provider: string): Promise<ActionState> {
  const user = await requireUser();
  try {
    const id = ProviderChoice.parse(provider);
    let ok: boolean;
    let message: string;
    let models: string[] = [];
    if (id === "mock") {
      ok = true;
      message = "Demonstração não faz chamadas de rede: sempre disponível.";
    } else if (id === "gemini") {
      const r = await testGeminiConnection();
      ok = r.ok;
      models = r.models;
      message =
        r.message + (r.ok && r.models.length ? ` Modelos disponíveis para esta chave: ${r.models.join(", ")}.` : "");
    } else if (id === "ollama") {
      const r = await testOllamaConnection();
      ok = r.ok;
      message = r.message;
    } else {
      const present = describeProviders().find((p) => p.id === "anthropic")?.configured ?? false;
      ok = false;
      message = present
        ? "Credencial presente. O teste não chama a API paga da Anthropic para evitar qualquer cobrança."
        : "ANTHROPIC_API_KEY não configurada.";
    }
    await (await getDb()).query(
      `insert into audit_events (owner_id, actor, action, data) values ($1, 'user', 'ai.connection_test', $2::jsonb)`,
      [user.id, JSON.stringify({ provider: id, ok, message, models })],
    );
    revalidatePath("/configuracoes");
    return { ok, message };
  } catch (error) {
    return failure(error);
  }
}

const Credentials = z.object({
  email: z.email("E-mail inválido"),
  password: z.string().min(8, "A senha precisa de pelo menos 8 caracteres"),
});

export async function signInAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  if (authMode() === "local") redirect("/");
  const parsed = Credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return failure(parsed.error);
  const supabase = await createSupabaseServerClient();
  const intent = form.get("intent");
  const origin = (await headers()).get("origin");
  const { error } =
    intent === "signup"
      ? await supabase.auth.signUp({
          ...parsed.data,
          options: origin ? { emailRedirectTo: `${origin}/auth/callback` } : undefined,
        })
      : await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { ok: false, message: error.message };
  if (intent === "signup") return { ok: true, message: "Conta criada. Se o Supabase pedir, confirme o e-mail e depois entre." };
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  if (authMode() === "supabase") {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}

// ------------------------------------------------------------------ Central de Conteúdo

export async function createMediaAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const row = await createMedia(await getDb(), user.id, {
      projectId: String(form.get("projectId") ?? ""),
      kind: form.get("kind") === "link" ? "link" : "transcricao",
      title: String(form.get("title") ?? ""),
      url: String(form.get("url") ?? ""),
      duration: String(form.get("duration") ?? ""),
      transcript_text: String(form.get("transcript_text") ?? ""),
      notes: String(form.get("notes") ?? ""),
      authorized: form.get("authorized") === "on",
      authorization_basis: String(form.get("authorization_basis") ?? ""),
    });
    revalidatePath("/biblioteca");
    return { ok: true, message: `Material “${row.title}” salvo na biblioteca.` };
  } catch (error) {
    return failure(error);
  }
}

export async function createSampleMediaAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const projectId = z.uuid("Escolha um projeto").parse(form.get("projectId"));
    await createSampleMedia(await getDb(), user.id, projectId);
    revalidatePath("/biblioteca");
    return { ok: true, message: "Material de exemplo (fictício) adicionado à biblioteca." };
  } catch (error) {
    return failure(error);
  }
}

/** Cria a análise e já a processa; se der certo volta ao material, senão abre a execução para ver o que houve. */
export async function analyzeMediaAction(mediaId: string): Promise<ActionState> {
  const user = await requireUser();
  let target: string;
  try {
    const sql = await getDb();
    const media = await getMedia(sql, user.id, mediaId);
    if (!media) return { ok: false, message: "Material não encontrado." };
    const orchestrator = await getOrchestrator();
    const { run } = await orchestrator.createRun({
      userId: user.id,
      projectId: media.project_id,
      pipeline: "analise_midia",
      input: { media_id: media.id },
      idempotencyKey: randomUUID(),
    });
    const settled = await runAndSettle(orchestrator, sql, user.id, run.id);
    target = settled.status === "succeeded" ? `/biblioteca/${mediaId}?analisado=1` : `/execucoes/${run.id}`;
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/biblioteca/${mediaId}`);
  redirect(target);
}

const ClipStatus = z.enum(["sugerido", "selecionado", "descartado"]);

export async function setClipStatusAction(mediaId: string, clipId: string, status: string): Promise<ActionState> {
  const user = await requireUser();
  try {
    await setClipStatus(await getDb(), user.id, clipId, ClipStatus.parse(status));
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/biblioteca/${mediaId}`);
  return { ok: true, message: "Corte atualizado." };
}

/** Cria a produção de um corte SELECIONADO e já a processa; se der certo abre o rascunho, senão a execução. */
export async function produceClipAction(mediaId: string, clipId: string): Promise<ActionState> {
  const user = await requireUser();
  let target: string;
  try {
    const sql = await getDb();
    const media = await getMedia(sql, user.id, mediaId);
    if (!media) return { ok: false, message: "Material não encontrado." };
    const orchestrator = await getOrchestrator();
    const { run } = await orchestrator.createRun({
      userId: user.id,
      projectId: media.project_id,
      pipeline: "producao_corte",
      input: { clip_id: clipId },
      idempotencyKey: randomUUID(),
    });
    const settled = await runAndSettle(orchestrator, sql, user.id, run.id);
    target = settled.draftId ? `/cortes/${settled.draftId}` : `/execucoes/${run.id}`;
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/biblioteca/${mediaId}`);
  revalidatePath("/cortes");
  redirect(target);
}

const DraftDecision = z.object({
  draftId: z.uuid(),
  intent: z.enum(["aprovado", "rejeitado", "em_revisao"]),
  note: z.string().max(1000).default(""),
  force: z.boolean().default(false),
});

/** Aprova, rejeita ou reabre um rascunho. Nada é publicado: é só a decisão registrada. */
export async function decideDraftAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const d = DraftDecision.parse({
      draftId: form.get("draftId"),
      intent: form.get("intent"),
      note: String(form.get("note") ?? ""),
      force: form.get("force") === "on",
    });
    await decideDraft(await getDb(), user.id, d.draftId, d.intent, { note: d.note, force: d.force });
    revalidatePath(`/cortes/${d.draftId}`);
    revalidatePath("/cortes");
    return {
      ok: true,
      message: d.intent === "aprovado" ? "Rascunho aprovado (nada foi publicado)." : d.intent === "rejeitado" ? "Rascunho rejeitado." : "Rascunho reaberto para revisão.",
    };
  } catch (error) {
    return failure(error);
  }
}
