import { NextResponse, type NextRequest } from "next/server";
import { authMode } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Destino do link de confirmação de e-mail do Supabase: troca o ?code= por uma sessão (cookie).
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  if (authMode() === "supabase" && code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/", origin));
  }
  return NextResponse.redirect(new URL("/login", origin));
}
