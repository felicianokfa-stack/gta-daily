"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { requireUser, authMode } from "@/lib/auth";
import { getOrchestrator } from "@/lib/orchestrator";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createProject, NewProjectInput } from "@/orchestrator/queries";
import { InvalidStateError, NotFoundError } from "@/orchestrator/engine";

export interface ActionState {
  ok: boolean;
  message: string;
}

function failure(error: unknown): ActionState {
  if (error instanceof z.ZodError) return { ok: false, message: error.issues.map((i) => i.message).join(" · ") };
  if (error instanceof NotFoundError || error instanceof InvalidStateError) return { ok: false, message: error.message };
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
  const { error } =
    intent === "signup"
      ? await supabase.auth.signUp(parsed.data)
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
