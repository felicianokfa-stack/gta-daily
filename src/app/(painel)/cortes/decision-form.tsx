"use client";

import { useActionState } from "react";
import { decideDraftAction, type ActionState } from "../../actions";
import { buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";

export function DecisionForm({ draftId, status, gatePassed }: { draftId: string; status: string; gatePassed: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(decideDraftAction, { ok: true, message: "" });
  return (
    <form action={action} className="grid gap-3 text-sm">
      <input type="hidden" name="draftId" value={draftId} />
      <label className="grid gap-1">
        Nota da decisão {status === "em_revisao" ? "(obrigatória para rejeitar)" : "(opcional)"}
        <textarea name="note" rows={2} maxLength={1000} className={inputClass} placeholder="Ex.: ajustar o gancho antes de gravar" />
      </label>
      {!gatePassed && status !== "aprovado" && (
        <label className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <input type="checkbox" name="force" className="mt-0.5" />
          <span>O portão de qualidade reprovou este rascunho. Marque para aprovar mesmo assim (a decisão fica registrada).</span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {status !== "aprovado" && (
          <button type="submit" name="intent" value="aprovado" disabled={pending} className={buttonClass}>
            Aprovar
          </button>
        )}
        {status !== "rejeitado" && (
          <button type="submit" name="intent" value="rejeitado" disabled={pending} className={secondaryButtonClass}>
            Rejeitar
          </button>
        )}
        {status !== "em_revisao" && (
          <button type="submit" name="intent" value="em_revisao" disabled={pending} className={secondaryButtonClass}>
            Reabrir para revisão
          </button>
        )}
        {state.message && (
          <p role="status" className={`text-xs ${state.ok ? "text-muted" : "text-rose-600 dark:text-rose-400"}`}>
            {state.message}
          </p>
        )}
      </div>
      <p className="text-xs text-muted">Aprovar só registra a sua decisão: a plataforma não publica nem gera arquivos de vídeo.</p>
    </form>
  );
}
