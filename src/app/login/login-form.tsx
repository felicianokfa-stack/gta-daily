"use client";

import { useActionState } from "react";
import { signInAction, type ActionState } from "../actions";
import { buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";

export function LoginForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(signInAction, { ok: true, message: "" });
  return (
    <form action={action} className="grid gap-3">
      <label className="grid gap-1 text-sm">
        E-mail
        <input name="email" type="email" required autoComplete="email" className={inputClass} />
      </label>
      <label className="grid gap-1 text-sm">
        Senha
        <input name="password" type="password" required minLength={8} autoComplete="current-password" className={inputClass} />
      </label>
      <div className="mt-2 flex gap-2">
        <button type="submit" name="intent" value="signin" disabled={pending} className={buttonClass}>
          Entrar
        </button>
        <button type="submit" name="intent" value="signup" disabled={pending} className={secondaryButtonClass}>
          Criar conta
        </button>
      </div>
      {state.message && (
        <p role="status" className={`text-sm ${state.ok ? "text-muted" : "text-rose-600 dark:text-rose-400"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
