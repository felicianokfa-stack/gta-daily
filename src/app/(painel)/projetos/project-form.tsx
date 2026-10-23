"use client";

import { useActionState } from "react";
import { createProjectAction, type ActionState } from "../../actions";
import { buttonClass, inputClass } from "@/components/ui";
import { PLATFORM_LABEL } from "@/lib/labels";

export function ProjectForm({ niches }: { niches: { id: string; name: string; default_audience: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createProjectAction, { ok: true, message: "" });
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <label className="grid gap-1 text-sm">
        Nome do projeto
        <input name="name" required maxLength={120} defaultValue="GTA DAILY" className={inputClass} />
      </label>
      <label className="grid gap-1 text-sm">
        Nicho
        <select name="niche" className={inputClass} defaultValue={niches[0]?.id}>
          {niches.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm md:col-span-2">
        Público-alvo
        <input name="audience" maxLength={500} placeholder={niches[0]?.default_audience} className={inputClass} />
      </label>
      <label className="grid gap-1 text-sm">
        Idioma
        <input name="language" defaultValue="pt-BR" maxLength={20} className={inputClass} />
      </label>
      <label className="grid gap-1 text-sm">
        Orçamento mensal de API (US$)
        <input name="monthly_budget_usd" type="number" min={0} step="0.01" defaultValue={20} className={inputClass} />
        <span className="text-xs text-muted">Ao atingir o valor estimado, as etapas param em “Exige ação”. Use 0 para sem limite.</span>
      </label>
      <fieldset className="grid gap-1 text-sm">
        <legend className="mb-1">Plataformas de destino</legend>
        <div className="flex flex-wrap gap-3">
          {Object.entries(PLATFORM_LABEL).map(([value, label]) => (
            <label key={value} className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" name="platforms" value={value} defaultChecked={value !== "youtube_shorts"} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex items-center gap-3 md:col-span-2">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Criando…" : "Criar projeto"}
        </button>
        {state.message && (
          <p role="status" className={`text-sm ${state.ok ? "text-muted" : "text-rose-600 dark:text-rose-400"}`}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
