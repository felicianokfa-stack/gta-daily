import "server-only";
import { redirect } from "next/navigation";
import { dbMode, getDb } from "@/db";
import { supabasePublicConfig } from "./supabase/config";
import { createSupabaseServerClient } from "./supabase/server";

export interface CurrentUser {
  id: string;
  email: string;
}

export type AuthMode = "supabase" | "local";

/** Usuário fixo do modo local (somente desenvolvimento, banco PGlite). */
const LOCAL_USER: CurrentUser = { id: "00000000-0000-4000-8000-000000000001", email: "dev@local" };

/**
 * - supabase: Supabase Auth + banco Postgres do Supabase (produção).
 * - local: sem Supabase e fora de produção → banco PGlite e usuário de desenvolvimento.
 */
export function authMode(): AuthMode {
  if (supabasePublicConfig() && dbMode() === "postgres") return "supabase";
  if (process.env.NODE_ENV === "production") {
    throw new Error("Configure Supabase (URL, chave pública) e DATABASE_URL para rodar em produção.");
  }
  return "local";
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (authMode() === "local") {
    const sql = await getDb();
    await sql.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`, [
      LOCAL_USER.id,
      LOCAL_USER.email,
    ]);
    return LOCAL_USER;
  }
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "" };
}

/** Use em toda página e Server Action protegida. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
