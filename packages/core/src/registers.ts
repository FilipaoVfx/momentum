import type { ProbabilityBand } from './probability.ts';
import { bandFor } from './probability.ts';

/**
 * Observación, inferencia y valoración nunca se mezclan (M§19, FR-032). El tipo
 * obliga a lo que la prosa olvida: una inferencia sin `n` no se puede construir,
 * y una valoración sin banda de probabilidad tampoco.
 */
export type Statement =
  | { readonly register: 'observation'; readonly text: string; readonly snapshotIds: readonly string[] }
  | {
      readonly register: 'inference';
      readonly text: string;
      readonly sampleSize: number;
      readonly snapshotIds: readonly string[];
    }
  | {
      readonly register: 'valuation';
      readonly text: string;
      readonly band: ProbabilityBand;
      readonly basis: readonly string[];
    };

export const observation = (text: string, snapshotIds: readonly string[]): Statement => {
  if (snapshotIds.length === 0) {
    throw new Error('Una observación sin snapshot que la sustente no es una observación.');
  }
  return { register: 'observation', text, snapshotIds };
};

export const inference = (
  text: string,
  sampleSize: number,
  snapshotIds: readonly string[],
): Statement => {
  if (!Number.isInteger(sampleSize) || sampleSize < 1) {
    throw new Error('Una inferencia se publica con su n a la vista (M§8).');
  }
  return { register: 'inference', text, sampleSize, snapshotIds };
};

export const valuation = (
  text: string,
  probabilityPct: number,
  basis: readonly string[],
): Statement => ({ register: 'valuation', text, band: bandFor(probabilityPct), basis });
