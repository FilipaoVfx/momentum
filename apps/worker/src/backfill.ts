import type { CollectionGap } from '@momentum/core';
import { SCORE_VERSION } from '@momentum/core';
import {
  finishRun,
  listNarratives,
  listSnapshotsByRun,
  recordGaps,
  startRun,
  type Db,
} from '@momentum/db';
import { SourceGateway, defillama } from '@momentum/sources';
import type { DictionaryIndex } from './dictionary.ts';
import { rebuildFundamentalHistory, type HistoryResult } from './history.ts';

/**
 * Carga única de historia de fundamento.
 *
 * Sin esto el eje arranca plano y hacen falta días de espera antes de que una
 * pendiente signifique algo. Con esto, el sistema tiene serie real desde el
 * primer minuto — y sigue siendo serie *nuestra*, porque el histórico entra al
 * store como snapshot crudo con su hash, igual que cualquier otra captura.
 *
 * Lo que **no** hace: rellenar el eje de atención. Ni Reddit ni Polymarket dan
 * historia, y fabricarla sería exactamente la clase de invención que el
 * manifiesto §4 prohíbe. El cuadrante seguirá diciendo `insufficient_data`
 * hasta que tengamos días de observación propia, y eso se declara.
 */
export async function backfill(deps: {
  readonly db: Db;
  readonly index: DictionaryIndex;
  readonly days: number;
  readonly now?: Date;
  readonly fetchImpl?: typeof fetch;
}): Promise<{ runId: string; history: HistoryResult; gaps: CollectionGap[] }> {
  const { db, index, days } = deps;
  const now = deps.now ?? new Date();
  const since = new Date(now.getTime() - days * 86_400_000);

  const runId = await startRun(db, 'ingest', 'live', SCORE_VERSION);
  const gateway = new SourceGateway({
    db,
    runId,
    now: () => now,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
  const gaps: CollectionGap[] = [
    {
      source: 'reddit',
      reason: 'window_not_covered',
      detail:
        `el backfill cubre ${days} días de fundamento; el eje de atención no tiene ` +
        'historia porque las fuentes sociales no la publican',
      windowStart: since,
      windowEnd: now,
    },
  ];

  try {
    const narratives = await listNarratives(db);
    // Los tres componentes del eje, no solo el TVL: si la historia midiera algo
    // distinto de lo que mide la corrida en vivo, el empalme fabricaría un
    // escalón que parecería un cambio de fundamento sin serlo.
    // En paralelo, pero sin desbordar a nadie: el semáforo del gateway limita la
    // concurrencia por proveedor y el cubo de fichas el ritmo. Secuencialmente
    // son 159 llamadas pesadas y media hora larga; así son unos minutos, y el
    // proveedor ve exactamente la misma presión.
    const results = await Promise.all(
      index.defillamaProtocols.flatMap((protocol) =>
        [
          defillama.fetchProtocolHistory,
          defillama.fetchFeesHistory,
          defillama.fetchDexsHistory,
          // Un 404 aquí es normal: no todo protocolo cobra comisiones ni es un
          // DEX. Se declara como brecha y ese componente no existe para esa
          // entidad, ni en la historia ni en vivo.
        ].map((fetchOne) => fetchOne(gateway, protocol)),
      ),
    );
    for (const result of results) if (!result.ok) gaps.push(result.gap);

    const snapshots = await listSnapshotsByRun(db, runId);
    const history = await rebuildFundamentalHistory({
      db,
      index,
      narratives,
      snapshots,
      since,
      until: now,
    });

    const idBySlug = new Map(narratives.map((n) => [n.slug, n.id]));
    await recordGaps(db, runId, idBySlug, gaps);
    await finishRun(db, runId, 'ok');
    return { runId, history, gaps };
  } catch (error) {
    await finishRun(db, runId, 'failed');
    throw error;
  }
}
