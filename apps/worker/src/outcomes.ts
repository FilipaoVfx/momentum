import { SCORE_VERSION, evaluateOutcome } from '@momentum/core';
import {
  finishRun,
  insertOutcome,
  listMetricPoints,
  startRun,
  statesDueForOutcome,
  type Db,
} from '@momentum/db';
import { ATTENTION_WINDOW, FUNDAMENTAL_WINDOW } from './pipeline.ts';

export const HORIZONS = [7, 14, 30] as const;

/** Tolerancia al buscar el punto de serie más próximo a un instante. */
const NEAREST_TOLERANCE_MS = 12 * 60 * 60 * 1000;

/**
 * Evaluación diferida de cada clasificación emitida (FR-050, M§14).
 *
 * Corre a diario y es idempotente: si el punto de serie del horizonte todavía
 * no existe, escribe `insufficient_data` en vez de inventar un veredicto, y una
 * corrida posterior no lo reescribe —el registro de que no pudimos evaluar
 * también es un dato.
 */
export async function evaluateOutcomes(deps: {
  readonly db: Db;
  readonly now?: Date;
  readonly scoreVersion?: string;
}): Promise<{ runId: string; written: number }> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const scoreVersion = deps.scoreVersion ?? SCORE_VERSION;

  const runId = await startRun(db, 'outcomes', 'live', scoreVersion);
  let written = 0;
  try {
    for (const horizonDays of HORIZONS) {
      const due = await statesDueForOutcome(db, horizonDays, now);
      for (const state of due) {
        const at = state.startedAt;
        const target = new Date(at.getTime() + horizonDays * 86_400_000);
        const series = await listMetricPoints(db, {
          narrativeId: state.narrativeId,
          scoreVersion: state.scoreVersion,
          since: new Date(at.getTime() - NEAREST_TOLERANCE_MS),
          until: new Date(target.getTime() + NEAREST_TOLERANCE_MS),
        });

        const change = (axis: 'attention' | 'fundamental'): number | null => {
          const window = axis === 'attention' ? ATTENTION_WINDOW.window : FUNDAMENTAL_WINDOW.window;
          const points = series.filter((p) => p.axis === axis && p.window === window);
          const start = nearest(points, at);
          const end = nearest(points, target);
          return start && end && start !== end ? end.value - start.value : null;
        };

        const attentionChange = change('attention');
        const fundamentalChange = change('fundamental');
        await insertOutcome(db, {
          quadrantStateId: state.id,
          horizonDays,
          verdict: evaluateOutcome({
            quadrant: state.quadrant,
            attentionChange,
            fundamentalChange,
            horizonDays,
          }),
          attentionChange,
          fundamentalChange,
          scoreVersion: state.scoreVersion,
        });
        written += 1;
      }
    }
    await finishRun(db, runId, 'ok');
    return { runId, written };
  } catch (error) {
    await finishRun(db, runId, 'failed');
    throw error;
  }
}

function nearest<T extends { observedAt: Date }>(points: readonly T[], at: Date): T | null {
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const p of points) {
    const distance = Math.abs(p.observedAt.getTime() - at.getTime());
    if (distance < bestDistance && distance <= NEAREST_TOLERANCE_MS) {
      best = p;
      bestDistance = distance;
    }
  }
  return best;
}
