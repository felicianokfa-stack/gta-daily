import { z } from "zod";

/** Segmento de transcrição com marcações de tempo em segundos. */
export const TranscriptSegment = z
  .object({
    id: z.number().int().min(1),
    start_s: z.number().min(0),
    end_s: z.number().min(0),
    text: z.string().trim().min(1).max(1000),
  })
  .refine((s) => s.end_s > s.start_s, { message: "end_s precisa ser maior que start_s" });
export type TranscriptSegment = z.infer<typeof TranscriptSegment>;

/** Segmentos com ids únicos, em ordem e sem sobreposição. */
export const Transcript = z
  .array(TranscriptSegment)
  .min(1, "A transcrição precisa ter ao menos um segmento")
  .max(500)
  .superRefine((segments, ctx) => {
    const ids = new Set<number>();
    let previousEnd = 0;
    segments.forEach((s, i) => {
      if (ids.has(s.id)) ctx.addIssue({ code: "custom", message: `id repetido: ${s.id}`, path: [i, "id"] });
      ids.add(s.id);
      if (s.start_s < previousEnd - 0.001) {
        ctx.addIssue({ code: "custom", message: `segmento ${s.id} começa antes do fim do anterior`, path: [i, "start_s"] });
      }
      previousEnd = s.end_s;
    });
  });
export type Transcript = z.infer<typeof Transcript>;

export class TranscriptParseError extends Error {}

/** "1:05" → 65; "01:02:03" → 3723; aceita também segundos puros ("65"). null se inválido. */
export function parseTimestamp(raw: string): number | null {
  const parts = raw.split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d{1,5}(\.\d+)?$/.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.length > 1 && nums.slice(1).some((n) => n >= 60)) return null;
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Converte o texto colado pelo usuário em segmentos. Uma linha por segmento, começando pelo tempo de INÍCIO
 * (formato comum de transcrições): `0:00 Texto`, `1:05 Texto`, `01:02:03 Texto`. O fim de cada segmento é o início
 * do próximo; o do último é a duração total do material. Linhas vazias são ignoradas.
 */
export function parseTranscriptText(text: string, durationSeconds: number): TranscriptSegment[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) throw new TranscriptParseError("Cole a transcrição: uma linha por trecho, começando pelo tempo (ex.: 0:00 Texto).");
  const starts: { start: number; text: string }[] = [];
  lines.forEach((line, i) => {
    const m = line.match(/^\[?(\d{1,2}(?::\d{2}){1,2}|\d+(?:\.\d+)?)\]?\s*[-–—:]?\s*(.+)$/);
    const start = m ? parseTimestamp(m[1]) : null;
    if (!m || start === null || !m[2]?.trim()) {
      throw new TranscriptParseError(`Linha ${i + 1} fora do formato "mm:ss texto": ${line.slice(0, 60)}`);
    }
    starts.push({ start, text: m[2].trim() });
  });
  const segments: TranscriptSegment[] = starts.map((s, i) => {
    const next = starts[i + 1]?.start ?? durationSeconds;
    return { id: i + 1, start_s: s.start, end_s: next, text: s.text };
  });
  const parsed = Transcript.safeParse(segments);
  if (!parsed.success) {
    throw new TranscriptParseError(
      `Marcações de tempo inválidas: ${parsed.error.issues.map((i) => i.message).slice(0, 2).join("; ")}. Os tempos precisam crescer e ficar dentro da duração (${formatTimestamp(durationSeconds)}).`,
    );
  }
  return parsed.data;
}
