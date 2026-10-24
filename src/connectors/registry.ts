import { describeProviders } from "./ai/status";
import type { ConnectorInfo, ConnectorState } from "./types";

function providerConnectors(): ConnectorInfo[] {
  return describeProviders().map((p): ConnectorInfo => {
    const state: ConnectorState = p.mode === "demonstracao" ? "demo" : p.configured ? "credential_present" : "pending_credential";
    const notes =
      p.mode === "demonstracao"
        ? "Sempre disponível, sem custo. Resultados simulados."
        : p.configured
          ? `Configurado${p.model ? ` (modelo ${p.model})` : ""}; conexão ainda não testada nesta execução. Use "Testar conexão" em Configurações.`
          : `Falta ${p.missing}. Nada é enviado a este provedor sem configuração e sem escolha explícita.`;
    return {
      id: `ia_${p.id}`,
      name: `IA — ${p.label}`,
      purpose: "Provedor de modelo dos agentes (Pesquisador, Verificador e demais).",
      state,
      notes,
    };
  });
}

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
    ...providerConnectors(),
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
      purpose: "Metadados (título, canal, datas, estatísticas) de vídeos públicos. Opcional.",
      state: process.env.YOUTUBE_API_KEY ? "credential_present" : "pending_credential",
      notes: process.env.YOUTUBE_API_KEY
        ? "Credencial presente, ainda não validada. A API entrega metadados; não baixa o arquivo do vídeo nem transcreve vídeos de terceiros."
        : "Opcional: falta YOUTUBE_API_KEY (credencial). Não bloqueia o restante: link manual, metadados informados e arquivo próprio entram na Central de Conteúdo (ainda não implementado).",
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
