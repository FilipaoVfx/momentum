import { DEFAULT_DEAD_BAND_PER_DAY } from './quadrant.ts';
import type { Quadrant } from './types.ts';

/**
 * Evaluación diferida de una clasificación (M§14, FR-050).
 *
 * Cada cuadrante es una predicción falsable y aquí está escrita: sin esto no
 * estamos iterando, estamos adivinando con más pasos y más infraestructura.
 *
 * | Cuadrante   | Predice                                             |
 * |-------------|-----------------------------------------------------|
 * | confirmed   | el fundamento sostiene lo que la atención ya celebró |
 * | pure_narrative | el fundamento **no** sigue a la atención          |
 * | quiet_build | el fundamento crece antes de que llegue la atención  |
 * | dead        | ninguno de los dos ejes se mueve                     |
 */
export type Verdict = 'confirmed' | 'refuted' | 'inconclusive' | 'insufficient_data';

export function evaluateOutcome(input: {
  readonly quadrant: Quadrant;
  /** Cambio total del eje entre la clasificación y el horizonte, en unidades de serie. */
  readonly attentionChange: number | null;
  readonly fundamentalChange: number | null;
  readonly horizonDays: number;
  readonly deadBandPerDay?: number;
}): Verdict {
  const { quadrant, attentionChange, fundamentalChange, horizonDays } = input;
  if (attentionChange === null || fundamentalChange === null) return 'insufficient_data';

  // El mismo umbral que decide el cuadrante decide si acertó: si 2%/día es la
  // frontera entre moverse y no moverse, no puede ser otra al evaluar.
  const threshold = (input.deadBandPerDay ?? DEFAULT_DEAD_BAND_PER_DAY) * horizonDays;
  const grew = (change: number): boolean => change > threshold;
  const flat = (change: number): boolean => Math.abs(change) <= threshold;

  switch (quadrant) {
    case 'quiet_build':
      return grew(fundamentalChange) ? 'confirmed' : flat(fundamentalChange) ? 'inconclusive' : 'refuted';
    case 'confirmed':
      return grew(fundamentalChange) || flat(fundamentalChange) ? 'confirmed' : 'refuted';
    case 'pure_narrative':
      // Acierta cuando el fundamento no llega: es una advertencia de techo, no
      // una predicción de caída de precio, que es algo que no medimos.
      return grew(fundamentalChange) ? 'refuted' : 'confirmed';
    case 'dead':
      return flat(fundamentalChange) && flat(attentionChange)
        ? 'confirmed'
        : grew(fundamentalChange) || grew(attentionChange)
          ? 'refuted'
          : 'inconclusive';
  }
}
