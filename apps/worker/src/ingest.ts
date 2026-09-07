import type { CollectionGap, SourceResult } from '@momentum/core';
import { SCORE_VERSION } from '@momentum/core';
import {
  finishRun,
  listNarratives,
  listSnapshotsByRun,
  recordGaps,
  startRun,
  type Db,
} from '@momentum/db';
import {
  SourceGateway,
  defillama,
  polymarket,
  reddit,
  type FetchedSnapshot,
  type RedditCredentials,
} from '@momentum/sources';
import { isDue } from './cadence.ts';
import type { DictionaryIndex } from './dictionary.ts';
import { processBatch, type BatchResult } from './pipeline.ts';

export interface IngestResult {
  readonly runId: string;
  readonly batch: BatchResult | null;
  readonly gaps: readonly CollectionGap[];
  readonly snapshotCount: number;
  /** Llamadas no hechas por cadencia. No son brechas: el dato ya está fresco. */
  readonly skippedByCadence: number;
}

/**
 * Una corrida del plano frío contra la red.
 *
 * Ninguna fuente es indispensable (ADR-006): cada llamada que falla produce una
 * brecha declarada y la corrida sigue. Una corrida en la que se cayó todo
 * termina igual, con la serie que pudo y la lista de lo que faltó.
 */
export async function ingestOnce(deps: {
  readonly db: Db;
  readonly index: DictionaryIndex;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  readonly redditCredentials?: RedditCredentials | null;
}): Promise<IngestResult> {
  const { db, index } = deps;
  const runId = await startRun(db, 'ingest', 'live', SCORE_VERSION);
  const gateway = new SourceGateway({
    db,
    runId,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  });
  const gaps: CollectionGap[] = [];
  let skipped = 0;
  const collect = (result: SourceResult<FetchedSnapshot>): void => {
    if (!result.ok) gaps.push(result.gap);
  };

  try {
    const narratives = await listNarratives(db);
    const now = deps.now?.() ?? new Date();

    /** Solo se pide lo que toca según su cadencia (ver `cadence.ts`). */
    const when = async (
      requestKey: string,
      cadence: 'fast' | 'slow',
      call: () => Promise<SourceResult<FetchedSnapshot>>,
    ): Promise<void> => {
      if (await isDue(db, requestKey, cadence, now)) collect(await call());
      else skipped += 1;
    };

    // Dos llamadas agregadas para todo el universo, no dos por narrativa: el
    // costo del plano frío escala con el diccionario, no con los usuarios
    // (NFR-060). Son totales de 24 h, así que van a cadencia lenta.
    await Promise.all([
      when(defillama.requestKeys.feesOverview(), 'slow', () =>
        defillama.fetchFeesOverview(gateway),
      ),
      when(defillama.requestKeys.dexsOverview(), 'slow', () =>
        defillama.fetchDexsOverview(gateway),
      ),
    ]);

    await Promise.all([
      ...index.defillamaProtocols.map((p) =>
        when(defillama.requestKeys.protocol(p), 'slow', () =>
          defillama.fetchProtocol(gateway, p),
        ),
      ),
      ...index.subreddits.map((s) =>
        when(reddit.requestKeys.newListing(s), 'fast', () =>
          reddit.fetchNewListing(gateway, s, {
            ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
            ...(deps.redditCredentials !== undefined
              ? { credentials: deps.redditCredentials }
              : {}),
          }),
        ),
      ),
      when(polymarket.requestKeys.topMarkets(), 'fast', () =>
        polymarket.fetchTopMarkets(gateway),
      ),
    ]);

    const snapshots = await listSnapshotsByRun(db, runId);
    let batch: BatchResult | null = null;

    if (snapshots.length === 0) {
      // Sin capturas nuevas no se calcula serie. La tentación es producir un
      // punto igualmente, porque la ventana de 24 h todavía tiene datos de
      // corridas anteriores — pero ese punto sería irreproducible: el replay
      // agrupa por corrida, y una corrida sin snapshots no existe para él.
      // Un punto que no se puede reconstruir rompe el criterio de M1.
      if (skipped === 0) {
        // Y si además no saltamos nada, es que no respondió nadie.
        gaps.push({
          source: 'defillama',
          reason: 'source_down',
          detail: 'ninguna fuente respondió en esta corrida; no se calcularon series',
        });
      }
    } else {
      const windowEnd = snapshots.reduce(
        (latest, s) => (s.fetchedAt > latest ? s.fetchedAt : latest),
        snapshots[0]!.fetchedAt,
      );
      batch = await processBatch({ db, index, narratives, snapshots, windowEnd });
      gaps.push(...batch.gaps);
    }

    const idBySlug = new Map(narratives.map((n) => [n.slug, n.id]));
    await recordGaps(db, runId, idBySlug, gaps);
    await finishRun(db, runId, 'ok');
    return { runId, batch, gaps, snapshotCount: snapshots.length, skippedByCadence: skipped };
  } catch (error) {
    await finishRun(db, runId, 'failed');
    throw error;
  }
}
