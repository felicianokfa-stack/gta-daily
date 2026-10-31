export type StepState = "feito" | "atual" | "pendente";

export interface StepItem {
  title: string;
  hint: string;
  state: StepState;
}

/** Passo a passo do fluxo da Central de Conteúdo: mostra onde o usuário está e o que fazer agora. */
export function Stepper({ steps }: { steps: StepItem[] }) {
  return (
    <ol className="mb-6 grid gap-2 md:grid-cols-5" aria-label="Passo a passo">
      {steps.map((s, i) => {
        const tone =
          s.state === "feito"
            ? "border-emerald-500/40 bg-emerald-500/5"
            : s.state === "atual"
              ? "border-foreground bg-card"
              : "border-border opacity-70";
        return (
          <li key={s.title} className={`rounded-lg border p-3 text-xs ${tone}`} aria-current={s.state === "atual" ? "step" : undefined}>
            <p className="font-medium">
              {s.state === "feito" ? "✓" : i + 1}. {s.title}
            </p>
            <p className="mt-1 text-muted">{s.hint}</p>
          </li>
        );
      })}
    </ol>
  );
}

export const FLOW_TITLES = ["Material", "Analisar", "Escolher corte", "Produzir", "Decidir"] as const;
