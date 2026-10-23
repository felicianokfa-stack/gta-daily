import { redirect } from "next/navigation";
import { authMode, getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (authMode() === "local" || (await getCurrentUser())) redirect("/");
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6">
        <h1 className="text-lg font-semibold">
          GTA <span className="text-accent">DAILY</span>
        </h1>
        <p className="mb-5 mt-1 text-sm text-muted">Central de Conteúdo. Entre com seu e-mail.</p>
        <LoginForm />
      </div>
    </main>
  );
}
