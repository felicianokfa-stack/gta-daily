import type { NicheContext } from "@/core/niches";
import type { ProjectContext } from "./types";

/** Bloco de contexto do nicho e do projeto, compartilhado por todos os papéis. */
export function contextBlock(niche: NicheContext, project: ProjectContext): string {
  return [
    `<nicho nome="${niche.name}">`,
    niche.description,
    `Termos-chave: ${niche.key_terms.join(", ")}`,
    "Orientação de fontes:",
    ...niche.source_guidance.map((s) => `- ${s}`),
    "Regras editoriais:",
    ...niche.editorial_rules.map((s) => `- ${s}`),
    "</nicho>",
    `<projeto nome="${project.name}">`,
    `Público: ${project.audience || niche.default_audience}`,
    `Idioma das saídas: ${project.language}`,
    `Plataformas: ${project.platforms.join(", ") || "não definidas"}`,
    "</projeto>",
  ].join("\n");
}

export function correctionBlock(notes: string[]): string {
  if (!notes.length) return "";
  return `\n\n<correcoes_exigidas>\nSua tentativa anterior foi rejeitada pela validação. Corrija:\n${notes
    .map((n) => `- ${n}`)
    .join("\n")}\n</correcoes_exigidas>`;
}

export function knownSourcesBlock(sources: { url: string; title: string }[]): string {
  if (!sources.length) return "";
  return `\n\n<fontes_ja_conhecidas>\nO projeto já registrou estas fontes em pesquisas anteriores. Priorize informações novas; para citar uma delas, ela precisa aparecer de novo na sua busca.\n${sources
    .map((s) => `- ${s.title} | ${s.url}`)
    .join("\n")}\n</fontes_ja_conhecidas>`;
}
