import { claudeModel, hasClaudeCredential } from "../claude";
import { geminiGroundingEnabled, geminiModel, hasGeminiCredential } from "./gemini";
import { PROVIDER_IDS, PROVIDER_LABEL, type ProviderId } from "./ids";
import { hasOllamaConfig, ollamaBaseUrl, ollamaModel } from "./ollama";

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  /** demonstração (simulado) ou real */
  mode: "demonstracao" | "real";
  /** credencial/configuração presente no servidor. Nunca expõe o valor. */
  configured: boolean;
  /** O que falta, quando não configurado. */
  missing: string | null;
  model: string | null;
  webSearch: boolean;
  limits: string[];
}

/** Estado de cada provedor para a tela de Configurações. Não faz chamadas de rede e nunca devolve segredos. */
export function describeProviders(): ProviderStatus[] {
  return PROVIDER_IDS.map((id): ProviderStatus => {
    switch (id) {
      case "mock":
        return {
          id,
          label: PROVIDER_LABEL[id],
          mode: "demonstracao",
          configured: true,
          missing: null,
          model: null,
          webSearch: false,
          limits: [
            "Sem chamadas de rede e sem custo.",
            "Respostas fictícias e determinísticas, marcadas como simuladas; nenhuma fonte ou fato é real.",
            "Só os papéis Pesquisador e Verificador têm resposta de demonstração.",
          ],
        };
      case "gemini":
        return {
          id,
          label: PROVIDER_LABEL[id],
          mode: "real",
          configured: hasGeminiCredential(),
          missing: hasGeminiCredential() ? null : "GEMINI_API_KEY",
          model: geminiModel(),
          webSearch: geminiGroundingEnabled(),
          limits: [
            "Use uma chave do Google AI Studio de projeto SEM faturamento: o app não consegue verificar isso.",
            "O plano gratuito tem limites por minuto e por dia (por projeto Google); confira os valores atuais no AI Studio.",
            "“Testar conexão” faz UMA geração mínima (poucos tokens) e lista os modelos que a chave pode usar; um modelo pode existir e ainda assim ser recusado para contas novas.",
            "O modelo padrão pode estar desatualizado: se a geração falhar com 404, defina GEMINI_MODEL com um modelo da lista.",
            "No plano gratuito o Google pode usar o conteúdo enviado para melhorar seus produtos: envie só conteúdo público ou de teste.",
            geminiGroundingEnabled()
              ? "Busca do Google ligada (GEMINI_GROUNDING=on): confirme no seu plano se é gratuita; não testada neste projeto."
              : "Sem busca na web: o Pesquisador só usa fontes já conhecidas e registra a limitação.",
          ],
        };
      case "ollama":
        return {
          id,
          label: PROVIDER_LABEL[id],
          mode: "real",
          configured: hasOllamaConfig(),
          missing: hasOllamaConfig() ? null : "OLLAMA_MODEL",
          model: ollamaModel() ?? null,
          webSearch: false,
          limits: [
            `Endereço: ${ollamaBaseUrl()}. Não é alcançável a partir da Vercel; use no worker local (npm run worker).`,
            "Sem busca na web: só fontes já conhecidas. A qualidade depende do modelo local.",
          ],
        };
      case "anthropic":
        return {
          id,
          label: PROVIDER_LABEL[id],
          mode: "real",
          configured: hasClaudeCredential(),
          missing: hasClaudeCredential() ? null : "ANTHROPIC_API_KEY",
          model: claudeModel(),
          webSearch: true,
          limits: ["API paga: gera cobrança. Só é usada quando escolhida explicitamente, nunca como fallback."],
        };
    }
  });
}
