/**
 * Código Admiralty adaptado (M§16). Dos ejes independientes: qué tan fiable es
 * quien lo dice, y qué tan creíble es lo que dice. Un `B2` y un `E2` afirman lo
 * mismo y no valen lo mismo.
 */

export const SOURCE_RELIABILITY = {
  A: 'Historial verificado',
  B: 'Usualmente confiable',
  C: 'Confiabilidad irregular',
  D: 'Usualmente poco confiable',
  E: 'No confiable',
  F: 'Sin historial suficiente',
} as const;

export const DATA_CREDIBILITY = {
  1: 'Confirmado por fuentes independientes',
  2: 'Probablemente cierto',
  3: 'Posiblemente cierto',
  4: 'Dudoso',
  5: 'Improbable',
  6: 'No evaluable',
} as const;

export type SourceReliability = keyof typeof SOURCE_RELIABILITY;
export type DataCredibility = keyof typeof DATA_CREDIBILITY;

export interface Rating {
  readonly reliability: SourceReliability;
  readonly credibility: DataCredibility;
}

export const formatRating = (r: Rating): string => `${r.reliability}${r.credibility}`;

export function parseRating(text: string): Rating {
  const m = /^([A-F])([1-6])$/.exec(text);
  if (!m) throw new Error(`Calificación Admiralty inválida: ${text}`);
  return {
    reliability: m[1] as SourceReliability,
    credibility: Number(m[2]) as DataCredibility,
  };
}

export const describeRating = (r: Rating): string =>
  `${formatRating(r)} — ${SOURCE_RELIABILITY[r.reliability]} / ${DATA_CREDIBILITY[r.credibility]}`;
