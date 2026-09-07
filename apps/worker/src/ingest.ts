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
import type { DictionaryIndex } from './dictionary.ts';
import { processBatch, type BatchResult } from './pipeline.ts';

export interface IngestResult {
  readonly runId: string;
  readonly batch: BatchResult | null;
  readonly gaps: readonly CollectionGap[];
  readonly snapshotCount: number;
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
  const collect = (result: SourceResult<FetchedSnapshot>): void => {
    if (!result.ok) gaps.push(result.gap);
  };

  try {
    const narratives = await listNarratives(db);

    // Dos llamadas agregadas para todo el universo, no dos por narrativa: el
    // costo del plano frío escala con el diccionario, no con los usuarios
    // (NFR-060).
    const overviews = await Promise.all([
      defillama.fetchFeesOverview(gateway),
      defillama.fetchDexsOverview(gateway),
    ]);
    overviews.forEach(collect);

    const perEntity = await Promise.all([
      ...index.defillamaProtocols.map((p) => defillama.fetchProtocol(gateway, p)),
      ...index.subreddits.map((s) =>
        reddit.fetchNewListing(gateway, s, {
          ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
          ...(deps.redditCredentials !== undefined ? { credentials: deps.redditCredentials } : {}),
        }),
      ),
      polymarket.fetchTopMarkets(gateway),
    ]);
    perEntity.forEach(collect);

    const snapshots = await listSnapshotsByRun(db, runId);
    let batch: BatchResult | null = null;

    if (snapshots.length === 0) {
      // Ninguna fuente respondió. Se declara y se termina: no hay serie que
      // calcular y fingir una a partir de la corrida anterior sería mentir.
      gaps.push({
        source: 'defillama',
        reason: 'source_down',
        detail: 'ninguna fuente respondió en esta corrida; no se calcularon series',
      });
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
    return { runId, batch, gaps, snapshotCount: snapshots.length };
  } catch (error) {
    await finishRun(db, runId, 'failed');
    throw error;
  }
}
