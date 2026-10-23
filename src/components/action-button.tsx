"use client";

import { useState, useTransition } from "react";
import { buttonClass, secondaryButtonClass } from "./ui";

interface Result {
  ok: boolean;
  message: string;
}

/** Botão que chama uma Server Action e mostra o resultado em texto. */
export function ActionButton({
  action,
  label,
  pendingLabel,
  variant = "primary",
  confirm,
}: {
  action: () => Promise<Result>;
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary";
  confirm?: string;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        className={variant === "primary" ? buttonClass : secondaryButtonClass}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => setResult(await action()));
        }}
      >
        {pending ? (pendingLabel ?? "Processando…") : label}
      </button>
      {result && (
        <p role="status" className={`max-w-xs text-right text-xs ${result.ok ? "text-muted" : "text-rose-600 dark:text-rose-400"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
