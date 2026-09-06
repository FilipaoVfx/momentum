import type { MetricPoint, Quadrant } from './types.ts';

/**
 * Banda muerta de la pendiente, en unidades de la serie por día.
 *
 * Como las series están en escala logarítmica, la pendiente es una tasa de
 * crecimiento relativo: 0,02/día ≈ +15% en siete días. Por debajo de eso no
 * distinguimos movimiento de ruido de recolección, así que no lo llamamos
 * movimiento. El umbral tiene nombre y justificación precisamente para que se
 * pueda discutir y cambiar con una medición delante.
 */
export const DEFAULT_DEAD_BAND_PER_DAY = 0.02;

/** Mínimo de puntos para permitirnos una pendiente. Con menos, no opinamos. */
export const MIN_POINTS_FOR_SLOPE = 4;

export type QuadrantVerdict =
  | {
      readonly kind: 'classified';
      readonly quadrant: Quadrant;
      readonly attentionSlope: number;
      readonly fundamentalSlope: number;
    }
  | { readonly kind: 'insufficient_data'; readonly reason: string };

/** Pendiente por mínimos cuadrados, en unidades de valor por día. */
export function slopePerDay(points: readonly MetricPoint[]): number | null {
  if (points.length < MIN_POINTS_FOR_SLOPE) return null;
  const sorted = [...points].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const t0 = sorted[0]!.observedAt.getTime();
  const day = 24 * 60 * 60 * 1000;

  const n = sorted.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const p of sorted) {
    const x = (p.observedAt.getTime() - t0) / day;
    sumX += x;
    sumY += p.value;
    sumXY += x * p.value;
    sumXX += x * x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null; // todos los puntos en el mismo instante
  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Clasificación en uno de los cuatro cuadrantes (FR-021).
 *
 * Devuelve `insufficient_data` en vez de un cuadrante cuando no hay puntos
 * suficientes: "muerta" significa que miramos y no se movió, no que no miramos.
 * Confundir las dos cosas es exactamente el error que el manifiesto §23 prohíbe.
 */
export function classifyQuadrant(
  attention: readonly MetricPoint[],
  fundamental: readonly MetricPoint[],
  deadBand: number = DEFAULT_DEAD_BAND_PER_DAY,
): QuadrantVerdict {
  const a = slopePerDay(attention);
  const f = slopePerDay(fundamental);
  if (a === null || f === null) {
    return {
      kind: 'insufficient_data',
      reason: `se requieren ${MIN_POINTS_FOR_SLOPE} puntos por eje; ` +
        `hay ${attention.length} de atención y ${fundamental.length} de fundamento`,
    };
  }

  const attentionUp = a > deadBand;
  const fundamentalUp = f > deadBand;
  const quadrant: Quadrant = attentionUp
    ? fundamentalUp
      ? 'confirmed'
      : 'pure_narrative'
    : fundamentalUp
      ? 'quiet_build'
      : 'dead';

  return { kind: 'classified', quadrant, attentionSlope: a, fundamentalSlope: f };
}

export const QUADRANT_LABELS: Readonly<Record<Quadrant, string>> = {
  confirmed: 'Confirmada',
  pure_narrative: 'Puro relato',
  quiet_build: 'Construcción silenciosa',
  dead: 'Muerta',
};
