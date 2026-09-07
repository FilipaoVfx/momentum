/**
 * Lenguaje estimativo con bandas publicadas (M§20). Sin la tabla, "probablemente"
 * significa 30% para quien escribe y 80% para quien lee.
 */

export interface ProbabilityBand {
  readonly label: string;
  readonly minPct: number;
  readonly maxPct: number;
}

export const PROBABILITY_BANDS: readonly ProbabilityBand[] = [
  { label: 'remota', minPct: 1, maxPct: 5 },
  { label: 'muy improbable', minPct: 5, maxPct: 20 },
  { label: 'improbable', minPct: 20, maxPct: 40 },
  { label: 'equiparable', minPct: 40, maxPct: 60 },
  { label: 'probable', minPct: 60, maxPct: 80 },
  { label: 'muy probable', minPct: 80, maxPct: 95 },
  { label: 'casi cierta', minPct: 95, maxPct: 99 },
];

/** Toda expresión de probabilidad corresponde a una banda publicada (FR-033). */
export function bandFor(probabilityPct: number): ProbabilityBand {
  if (!Number.isFinite(probabilityPct) || probabilityPct < 1 || probabilityPct > 99) {
    throw new Error(
      `Probabilidad fuera de las bandas publicadas (1–99%): ${probabilityPct}. ` +
        'La certeza y la imposibilidad no se expresan como estimación.',
    );
  }
  const found = PROBABILITY_BANDS.find(
    (b) => probabilityPct > b.minPct && probabilityPct <= b.maxPct,
  );
  return found ?? PROBABILITY_BANDS[0]!;
}
