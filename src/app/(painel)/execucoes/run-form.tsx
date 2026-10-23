"use client";

import { useActionState, useState } from "react";
import { createRunAction, type ActionState } from "../../actions";
import { buttonClass, inputClass } from "@/components/ui";

export function RunForm({ projects }: { projects: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createRunAction, { ok: true, message: "" });
  // Chave de idempotência por formulário: clique duplo ou reenvio não cria execução duplicada.
  const [key] = useState(() => crypto.randomUUID());
  if (projects.length === 0) return <p className="text-sm text-muted">Crie um projeto antes de começar uma pesquisa.</p>;
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="idempotencyKey" value={key} />
      <div className="grid gap-4 md:grid-cols-3">
        <label className="grid gap-1 text-sm">
          Projeto
          <select name="projectId" className={inputClass}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          Tema a pesquisar
          <input name="topic" required minLength={3} maxLength={500} placeholder="Ex.: o que já foi confirmado sobre o lançamento do GTA VI" className={inputClass} />
        </label>
      </div>
      <label className="grid gap-1 text-sm">
        Objetivo editorial (opcional)
        <input name="goal" maxLength={500} placeholder="Ex.: carrossel explicando fatos vs rumores" className={inputClass} />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Criando…" : "Iniciar pesquisa e verificação"}
        </button>
        {state.message && !state.ok && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{state.message}</p>}
      </div>
      <p className="text-xs text-muted">
        Fluxo: Pesquisador (busca fontes reais) → Verificador (classifica fato, rumor, teoria…). Cada saída é validada antes de seguir.
      </p>
    </form>
  );
}
