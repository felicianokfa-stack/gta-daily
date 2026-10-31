/**
 * Regras de negócio da produção de cortes, compartilhadas pelas validações dos agentes e pelo portão do rascunho.
 * Funções puras: sem banco, sem rede.
 */

export const PLATFORMS = ["instagram_reels", "instagram_carrossel", "tiktok", "youtube_shorts"] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * Limites USADOS PELO APP para validar as versões por plataforma. São valores conservadores adotados aqui, não uma
 * garantia oficial das plataformas (que mudam as regras): confira nas plataformas antes de publicar.
 */
export const PLATFORM_LIMITS: Record<Platform, { title: number; caption: number; hashtags: number }> = {
  instagram_reels: { title: 100, caption: 2200, hashtags: 30 },
  instagram_carrossel: { title: 100, caption: 2200, hashtags: 30 },
  tiktok: { title: 100, caption: 2200, hashtags: 30 },
  youtube_shorts: { title: 100, caption: 5000, hashtags: 15 },
};

/** Tolerância para comparar tempos, em segundos. */
export const TIME_TOLERANCE_S = 1;

/** Linguagem de promessa de resultado, proibida nos textos gerados. */
export const PROMISE_PATTERN =
  /probabilidade de (viraliz|sucesso)|vai viralizar|(garant\w+|certeza)\s+(?:de\s+|do\s+|no\s+)?(viral\w*|sucesso|alcance|resultado)/i;

/** Vazamento tratado como informação oficial/confirmada. */
export const LEAK_AS_OFFICIAL_PATTERN = /vazament\w*\s+(oficial|confirmad\w+)|(oficial|confirmad\w+)\s+(?:e\s+)?vazad\w+/i;

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A citação precisa aparecer literalmente (ignorando caixa, acentos e pontuação) no texto do segmento. */
export function quoteMatches(quote: string, segmentText: string): boolean {
  const q = normalizeText(quote);
  return q.length > 0 && normalizeText(segmentText).includes(q);
}

export interface TimedItem {
  t_start: number;
  t_end: number;
}

/** Mensagens de erro para itens fora do intervalo do corte, de ordem errada ou sobrepostos. */
export function checkTimeline(items: TimedItem[], clipStart: number, clipEnd: number, label: string): string[] {
  const errors: string[] = [];
  let previousEnd = clipStart;
  items.forEach((it, i) => {
    const where = `${label} ${i + 1}`;
    if (it.t_end <= it.t_start) errors.push(`${where}: o fim (${it.t_end}s) precisa ser maior que o início (${it.t_start}s).`);
    if (it.t_start < clipStart - TIME_TOLERANCE_S || it.t_end > clipEnd + TIME_TOLERANCE_S) {
      errors.push(`${where}: ${it.t_start}s–${it.t_end}s fora do corte (${clipStart}s–${clipEnd}s).`);
    }
    if (it.t_start < previousEnd - TIME_TOLERANCE_S) errors.push(`${where}: começa antes do fim do item anterior (${previousEnd}s).`);
    previousEnd = Math.max(previousEnd, it.t_end);
  });
  return errors;
}

export function hashtagProblems(hashtags: string[]): string[] {
  const problems: string[] = [];
  for (const h of hashtags) {
    if (!/^#[\p{L}\p{N}_]{1,60}$/u.test(h)) problems.push(`hashtag inválida: "${h}" (use #palavra, sem espaços)`);
  }
  if (new Set(hashtags.map((h) => h.toLowerCase())).size !== hashtags.length) problems.push("hashtags repetidas");
  return problems;
}

export interface VersionLike {
  platform: Platform;
  title: string;
  caption: string;
  hashtags: string[];
  cover_text: string;
}

/** Textos com promessa de resultado ou vazamento tratado como oficial. */
export function textProblems(texts: string[], label: string): string[] {
  const joined = texts.join(" ");
  const problems: string[] = [];
  if (PROMISE_PATTERN.test(joined)) problems.push(`${label} promete resultado (viralizar, sucesso, alcance).`);
  if (LEAK_AS_OFFICIAL_PATTERN.test(joined)) problems.push(`${label} trata vazamento como informação oficial ou confirmada.`);
  return problems;
}

/** Cobertura das plataformas do projeto, limites por plataforma, hashtags e linguagem proibida. */
export function distributionProblems(platforms: Platform[], versions: VersionLike[]): string[] {
  const errors: string[] = [];
  const count = new Map<Platform, number>();
  for (const v of versions) count.set(v.platform, (count.get(v.platform) ?? 0) + 1);
  for (const p of platforms) if (!count.has(p)) errors.push(`Falta a versão da plataforma ${p}.`);
  for (const [p, n] of count) {
    if (!platforms.includes(p)) errors.push(`Plataforma ${p} não pertence ao projeto.`);
    if (n > 1) errors.push(`Plataforma ${p} aparece ${n} vezes.`);
  }
  for (const v of versions) {
    const limit = PLATFORM_LIMITS[v.platform];
    if (v.title.length > limit.title) errors.push(`${v.platform}: título com ${v.title.length} caracteres (limite ${limit.title}).`);
    if (v.caption.length > limit.caption) errors.push(`${v.platform}: legenda com ${v.caption.length} caracteres (limite ${limit.caption}).`);
    if (v.hashtags.length > limit.hashtags) errors.push(`${v.platform}: ${v.hashtags.length} hashtags (limite ${limit.hashtags}).`);
    for (const problem of hashtagProblems(v.hashtags)) errors.push(`${v.platform}: ${problem}.`);
    errors.push(...textProblems([v.title, v.caption, v.cover_text], v.platform));
  }
  return errors;
}
