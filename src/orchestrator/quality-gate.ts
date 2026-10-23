import type { ResearchResult, VerificationResult } from "@/core/contracts/research";
import type { NicheContext } from "@/core/niches";

export interface GateCheck {
  rule: string;
  passed: boolean;
  detail: string;
}

export interface QualityGateResult {
  passed: boolean;
  checks: GateCheck[];
  /** Motivos de reprovação, em linguagem para o usuário. */
  reasons: string[];
}

export type VerificationState = "verificada" | "parcial" | "nao_verificada";

export function hostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function isPrimarySource(url: string, niche: NicheContext): boolean {
  const host = hostname(url);
  if (!host) return false;
  return niche.primary_domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Portão de qualidade entre verificação e estratégia (Bloco C).
 * Uma oportunidade só fica "pronta para estratégia" com evidência rastreável e suficiente.
 */
export function evaluateQualityGate(
  research: ResearchResult,
  verification: VerificationResult,
  niche: NicheContext,
): QualityGateResult {
  const registered = new Set([...research.sources, ...verification.additional_sources].map((s) => s.url));
  const evidenceUrls = verification.claims.flatMap((c) => c.evidence_urls);
  const untracked = evidenceUrls.filter((u) => !registered.has(u));

  const confirmed = verification.claims.filter((c) => c.label === "fato_confirmado");
  const strong = confirmed.filter((c) => {
    if (c.evidence_urls.some((u) => isPrimarySource(u, niche))) return true;
    const domains = new Set(c.evidence_urls.map(hostname).filter(Boolean));
    return domains.size >= 2;
  });

  const checks: GateCheck[] = [
    {
      rule: "rastreabilidade",
      passed: untracked.length === 0,
      detail:
        untracked.length === 0
          ? `Todas as ${evidenceUrls.length} evidências apontam para fontes registradas.`
          : `Evidências sem fonte registrada: ${untracked.join(", ")}`,
    },
    {
      rule: "evidencia_suficiente",
      passed: strong.length > 0,
      detail:
        strong.length > 0
          ? `${strong.length} fato(s) confirmado(s) por fonte primária ou por duas fontes independentes.`
          : "Nenhum fato confirmado por fonte primária ou por duas fontes independentes.",
    },
    {
      rule: "contradicoes_explicadas",
      passed: verification.contradictions.length === 0 || verification.caveats.length > 0,
      detail:
        verification.contradictions.length === 0
          ? "Sem contradições entre fontes."
          : verification.caveats.length > 0
            ? `${verification.contradictions.length} contradição(ões) acompanhada(s) de ressalvas.`
            : "Há contradições entre fontes sem nenhuma ressalva.",
    },
  ];
  const failed = checks.filter((c) => !c.passed);
  return { passed: failed.length === 0, checks, reasons: failed.map((c) => c.detail) };
}

export function verificationState(verification: VerificationResult): VerificationState {
  const labels = verification.claims.map((c) => c.label);
  if (labels.length > 0 && labels.includes("fato_confirmado") && !labels.includes("nao_verificado")) return "verificada";
  if (labels.some((l) => l !== "nao_verificado")) return "parcial";
  return "nao_verificada";
}

/** Prioridade sugerida: combina o portão de qualidade com o interesse editorial estimado. */
export function suggestedPriority(gatePassed: boolean, relevance: number): "alta" | "media" | "baixa" {
  if (gatePassed && relevance >= 70) return "alta";
  if (gatePassed || relevance >= 70) return "media";
  return "baixa";
}
