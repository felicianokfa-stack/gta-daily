"use client";

import { useActionState } from "react";
import { createMediaAction, createSampleMediaAction, type ActionState } from "../../actions";
import { buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";

type ProjectOption = { id: string; name: string };

function Status({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <p role="status" className={`text-sm ${state.ok ? "text-muted" : "text-rose-600 dark:text-rose-400"}`}>
      {state.message}
    </p>
  );
}

export function MediaForm({ projects }: { projects: ProjectOption[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createMediaAction, { ok: true, message: "" });
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <label className="grid gap-1 text-sm">
        Projeto
        <select name="projectId" required className={inputClass} defaultValue={projects[0]?.id}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        Tipo
        <select name="kind" className={inputClass} defaultValue="transcricao">
          <option value="transcricao">Transcrição (colada por você)</option>
          <option value="link">Link do vídeo + transcrição</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm md:col-span-2">
        Título
        <input name="title" required maxLength={200} className={inputClass} />
      </label>
      <label className="grid gap-1 text-sm">
        Link (opcional para “transcrição”)
        <input name="url" type="url" maxLength={2000} placeholder="https://…" className={inputClass} />
        <span className="text-xs text-muted">É só uma referência: a plataforma não baixa nem republica o vídeo.</span>
      </label>
      <label className="grid gap-1 text-sm">
        Duração total
        <input name="duration" required placeholder="2:30" className={inputClass} />
        <span className="text-xs text-muted">Formato mm:ss, h:mm:ss ou segundos.</span>
      </label>
      <label className="grid gap-1 text-sm md:col-span-2">
        Transcrição com marcações de tempo
        <textarea
          name="transcript_text"
          required
          rows={8}
          placeholder={"0:00 Primeira fala do vídeo\n0:12 Segunda fala\n0:30 Terceira fala"}
          className={`${inputClass} font-mono text-xs`}
        />
        <span className="text-xs text-muted">
          Uma linha por trecho, começando pelo tempo de início. O fim de cada trecho é o início do próximo; o último vai até a duração.
        </span>
      </label>
      <label className="grid gap-1 text-sm md:col-span-2">
        Observações (opcional)
        <input name="notes" maxLength={1000} className={inputClass} />
      </label>
      <fieldset className="grid gap-2 rounded-lg border border-border p-3 text-sm md:col-span-2">
        <legend className="px-1 text-xs text-muted">Autorização de uso (obrigatória)</legend>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="authorized" required className="mt-1" />
          <span>Declaro que tenho autorização para usar este material (é meu, ou tenho permissão do dono).</span>
        </label>
        <label className="grid gap-1">
          Em uma frase, qual é a base da autorização?
          <input name="authorization_basis" required minLength={3} maxLength={500} placeholder="Ex.: vídeo do meu próprio canal" className={inputClass} />
        </label>
        <span className="text-xs text-muted">
          Atenção: com a IA do Gemini no plano gratuito, o Google pode usar o texto enviado para melhorar seus produtos. Use só material que você pode compartilhar.
        </span>
      </fieldset>
      <div className="flex items-center gap-3 md:col-span-2">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Salvando…" : "Salvar na biblioteca"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function SampleMediaForm({ projects }: { projects: ProjectOption[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createSampleMediaAction, { ok: true, message: "" });
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-sm">
        Projeto
        <select name="projectId" required className={inputClass} defaultValue={projects[0]?.id}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending} className={secondaryButtonClass}>
        {pending ? "Adicionando…" : "Usar material de exemplo (fictício)"}
      </button>
      <Status state={state} />
    </form>
  );
}
