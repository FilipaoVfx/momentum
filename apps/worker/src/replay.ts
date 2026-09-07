import type { CollectionGap } from '@momentum/core';
import { SCORE_VERSION } from '@momentum/core';
import {
  finishRun,
  listNarratives,
  listSnapshots,
  recordGaps,
  startRun,
  type Db,
  type StoredSnapshot,
} from '@momentum/db';
import type { DictionaryIndex } from './dictionary.ts';
import { SLOPE_LOOKBACK_MS, processBatch, type BatchResult } from './pipeline.ts';

/**
 * Reconstrucción de la historia desde los snapshots crudos. Cero llamadas
 * externas.
 *
 * Es a la vez el criterio de salida de M1 —la serie de 14 días se reconstruye
 * sin volver a pagar ninguna API— y el modo sombra de FR-052: basta pasar otra
 * `scoreVersion` para evaluar una fórmula nueva contra toda la historia.
 */
export async function replay(deps: {
  readonly db: Db;
  readonly index: DictionaryIndex;
  readonly from: Date;
  readonly to?: Date;
  readonly scoreVersion?: string;
  /**
   * Reconstruir también la clasificación. Por defecto **no**: `quadrant_state`
   * registra lo que afirmamos en su momento y `outcome` mide si acertamos.
   * Recalcularlo sobre la marcha convertiría cada replay en una oportunidad de
   * quedar bien con el pasado, que es justo lo contrario de medir el acierto.
   */
  readonly classifyQuadrants?: boolean;
}): Promise<{ runId: string; batches: BatchResult[] }> {
  const { db, index, from } = deps;
  const to = deps.to ?? new Date();
  const scoreVersion = deps.scoreVersion ?? SCORE_VERSION;

  const runId = await startRun(db, 'replay', 'replay', scoreVersion);
  try {
    const narratives = await listNarratives(db);
    const snapshots = await listSnapshots(db, { since: from, until: to });
    const batches: BatchResult[] = [];
    const gaps: CollectionGap[] = [
      {
        // La ventana de reconstrucción está truncada por definición: los puntos
        // de los primeros siete días se apoyan en menos historia que el resto.
        source: 'defillama',
        reason: 'window_not_covered',
        detail:
          `replay desde ${from.toISOString()}: las pendientes de los primeros ` +
          `${SLOPE_LOOKBACK_MS / 86_400_000} días se calculan con historia parcial`,
        windowStart: from,
        windowEnd: new Date(from.getTime() + SLOPE_LOOKBACK_MS),
      },
    ];

    for (const group of groupByRun(snapshots)) {
      const batch = await processBatch({
        db,
        index,
        narratives,
        snapshots: group.snapshots,
        windowEnd: group.windowEnd,
        scoreVersion,
        classify: deps.classifyQuadrants ?? false,
      });
      batches.push(batch);
      gaps.push(...batch.gaps);
    }

    const idBySlug = new Map(narratives.map((n) => [n.slug, n.id]));
    await recordGaps(db, runId, idBySlug, gaps);
    await finishRun(db, runId, 'ok');
    return { runId, batches };
  } catch (error) {
    await finishRun(db, runId, 'failed');
    throw error;
  }
}

/**
 * Los snapshots se reagrupan por la corrida que los capturó, y cada grupo
 * recupera su `windowEnd` original. Reconstruir con ventanas nuevas daría otra
 * serie —parecida, pero otra— y entonces el replay no probaría nada.
 */
export function groupByRun(
  snapshots: readonly StoredSnapshot[],
): { key: string; windowEnd: Date; snapshots: StoredSnapshot[] }[] {
  const groups = new Map<string, StoredSnapshot[]>();
  for (const snapshot of snapshots) {
    const key = snapshot.runId ?? `orphan:${snapshot.id}`;
    const list = groups.get(key);
    if (list) list.push(snapshot);
    else groups.set(key, [snapshot]);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({
      key,
      snapshots: list,
      windowEnd: list.reduce(
        (latest, s) => (s.fetchedAt > latest ? s.fetchedAt : latest),
        list[0]!.fetchedAt,
      ),
    }))
    .sort((a, b) => a.windowEnd.getTime() - b.windowEnd.getTime());
}
