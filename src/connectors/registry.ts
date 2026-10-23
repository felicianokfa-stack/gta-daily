import { claudeModel, hasClaudeCredential } from "./claude";
import type { ConnectorInfo } from "./types";

/**
 * Matriz de conectores (seção 7). Estados honestos: nenhum conector aparece como
 * "conectado" sem credencial e sem uso validado.
 */
export function listConnectors(): ConnectorInfo[] {
  const usingPostgres = Boolean(process.env.DATABASE_URL);
  return [
    {
      id: "supabase",
      name: "Supabase (Postgres + Auth)",
      purpose: "Banco, autenticação, políticas de acesso e armazenamento.",
      state: usingPostgres ? "credential_present" : "pending_credential",
      notes: usingPostgres
        ? "Conectado via DATABASE_URL. Projeto gta-daily-plataforma (sa-east-1)."
        : "Em modo local (PGlite). Configure DATABASE_URL e as chaves públicas do Supabase para usar o projeto real.",
    },
    {
      id: "claude",
      name: "Claude API (Anthropic)",
      purpose: "Pesquisa assistida, verificação, análise, estratégia, roteiro e revisão textual.",
      state: hasClaudeCredential() ? "credential_present" : "pending_credential",
      notes: hasClaudeCredential()
        ? `Credencial presente. Modelo ${claudeModel()} com busca na web e fallback no servidor em recusas cobertas.`
        : "Falta ANTHROPIC_API_KEY no servidor/worker. Os agentes Pesquisador e Verificador dependem dela.",
    },
    {
      id: "buffer",
      name: "Buffer API",
      purpose: "Agendar e acompanhar publicações (Instagram, TikTok, YouTube Shorts).",
      state: "needs_validation",
      notes: "Bloco G. Validar canais, formatos suportados e retorno de erros na documentação oficial; falta credencial.",
    },
    {
      id: "vidiq",
      name: "vidIQ",
      purpose: "Palavras-chave, análise de vídeos e oportunidades.",
      state: "needs_validation",
      notes: "Validar se há API para a plataforma (o acesso atual é só via assistente) e os limites do plano.",
    },
    {
      id: "opusclip",
      name: "OpusClip (clipping)",
      purpose: "Momentos, cortes, legendas e reenquadramento.",
      state: "needs_validation",
      notes: "Bloco D/E. Validar API, upload permitido, custo, marca d'água e exportação.",
    },
    {
      id: "youtube",
      name: "YouTube Data API",
      purpose: "Metadados e legendas de vídeos autorizados.",
      state: "pending_credential",
      notes: "Bloco C/D. Requer credencial do Google Cloud e respeito às regras de uso.",
    },
    {
      id: "ffmpeg",
      name: "FFmpeg",
      purpose: "Cortes determinísticos, conversão, 9:16, áudio e legendas.",
      state: "needs_validation",
      notes: "Bloco E. Roda localmente; em produção precisa de worker com FFmpeg (não na função serverless).",
    },
    {
      id: "stt",
      name: "Transcrição (speech-to-text)",
      purpose: "Transcrição com marcações de tempo em português.",
      state: "needs_validation",
      notes: "Bloco D. Fornecedor a escolher (precisão em gameplay, custo, limites).",
    },
    {
      id: "vercel",
      name: "Vercel",
      purpose: "Hospedagem da interface e cron do worker.",
      state: "needs_validation",
      notes: "Conta conectada ao assistente, sem time listado. Deploy ainda não feito.",
    },
  ];
}
