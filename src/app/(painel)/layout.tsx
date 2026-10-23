import Link from "next/link";
import { authMode, requireUser } from "@/lib/auth";
import { signOutAction } from "../actions";

const NAV = [
  { href: "/", label: "Painel" },
  { href: "/oportunidades", label: "Oportunidades" },
  { href: "/execucoes", label: "Execuções" },
  { href: "/projetos", label: "Projetos" },
  { href: "/agentes", label: "Agentes e conectores" },
];

export default async function PainelLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const local = authMode() === "local";
  return (
    <div className="min-h-screen">
      {local && (
        <div className="bg-amber-500/15 px-4 py-2 text-center text-xs text-amber-800 dark:text-amber-200">
          Modo local de desenvolvimento: banco embutido (PGlite) e usuário de teste. Não use em produção.
        </div>
      )}
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/" className="whitespace-nowrap font-semibold tracking-tight">
              GTA <span className="text-accent">DAILY</span>
              <span className="ml-2 text-xs font-normal text-muted">Central de Conteúdo</span>
            </Link>
            <nav className="flex flex-wrap gap-1 text-sm">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="rounded-md px-2.5 py-1.5 text-muted hover:bg-bg hover:text-text">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <form action={signOutAction} className="flex items-center gap-3 text-xs text-muted">
            <span>{user.email}</span>
            {!local && (
              <button type="submit" className="rounded-md border border-border px-2 py-1 hover:bg-bg">
                Sair
              </button>
            )}
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
