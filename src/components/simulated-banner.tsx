/** Aviso fixo para qualquer tela que mostre resultados do modo de demonstração. */
export function SimulatedBanner({ detail }: { detail?: string }) {
  return (
    <div
      role="note"
      className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100"
    >
      <p className="font-semibold">Modo de demonstração — resultado simulado</p>
      <p className="mt-0.5 text-xs">
        {detail ??
          "Estes dados são fictícios, gerados sem consultar nenhuma fonte ou IA real. Não use como informação, fonte verificada ou conteúdo publicável."}
      </p>
    </div>
  );
}
