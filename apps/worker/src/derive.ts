import type { FundamentalObservation, MentionEvent } from '@momentum/core';
import type { StoredSnapshot } from '@momentum/db';
import { defillama, polymarket, reddit } from '@momentum/sources';
import type { DictionaryIndex } from './dictionary.ts';
import { redditRootOrigin } from './lineage.ts';

/**
 * Derivación: snapshot crudo → eventos de dominio.
 *
 * Esta función es la razón por la que el replay es gratis y fiel. La corrida en
 * vivo y la reconstrucción histórica **llaman exactamente a este mismo código**:
 * la primera sobre los snapshots que acaba de capturar, la segunda sobre los que
 * ya estaban en el store. No hay dos rutas que puedan divergir porque no hay dos
 * rutas (FR-052, criterio de salida de M1).
 *
 * Es pura: no toca la red ni la base y no lee el reloj.
 */
export interface Derived {
  readonly mentions: MentionEvent[];
  readonly fundamentals: FundamentalObservation[];
}

export interface DeriveOptions {
  /**
   * Corta la serie histórica por abajo. Es un filtro sobre lo que se deriva, no
   * sobre lo que se guarda: el snapshot conserva el payload íntegro. Sin esto,
   * un solo protocolo aportaría más de dos mil observaciones que se remontan a
   * 2020 y que a nadie le sirven.
   */
  readonly since?: Date;
}

export function deriveFromSnapshot(
  snapshot: StoredSnapshot,
  index: DictionaryIndex,
  options: DeriveOptions = {},
): Derived {
  const mentions: MentionEvent[] = [];
  const fundamentals: FundamentalObservation[] = [];
  const key = snapshot.requestKey;

  if (key.startsWith('defillama:protocol:')) {
    const protocol = defillama.normalizeSlug(key.slice('defillama:protocol:'.length));
    const tvlUsd = defillama.parseProtocolTvl(snapshot.payload);
    for (const narrativeSlug of index.narrativesForDefillama(protocol)) {
      fundamentals.push({
        source: 'defillama',
        narrativeSlug,
        entity: protocol,
        observedAt: snapshot.fetchedAt,
        tvlUsd,
        fees24hUsd: null,
        volume24hUsd: null,
        snapshotId: snapshot.id,
      });
    }
  } else if (key.startsWith('defillama:history:')) {
    const protocol = defillama.normalizeSlug(key.slice('defillama:history:'.length));
    const narratives = index.narrativesForDefillama(protocol);
    if (narratives.length > 0) {
      for (const point of defillama.parseProtocolHistory(snapshot.payload)) {
        if (options.since && point.at < options.since) continue;
        for (const narrativeSlug of narratives) {
          fundamentals.push({
            source: 'defillama',
            narrativeSlug,
            entity: protocol,
            // El instante real del dato, no el de la captura: es historia.
            observedAt: point.at,
            tvlUsd: point.tvlUsd,
            fees24hUsd: null,
            volume24hUsd: null,
            snapshotId: snapshot.id,
          });
        }
      }
    }
  } else if (
    key.startsWith('defillama:history-fees:') ||
    key.startsWith('defillama:history-dexs:')
  ) {
    const isFees = key.startsWith('defillama:history-fees:');
    const prefix = isFees ? 'defillama:history-fees:' : 'defillama:history-dexs:';
    const protocol = defillama.normalizeSlug(key.slice(prefix.length));
    for (const narrativeSlug of index.narrativesForDefillama(protocol)) {
      for (const point of defillama.parseSummaryHistory(snapshot.payload)) {
        if (options.since && point.at < options.since) continue;
        fundamentals.push({
          source: 'defillama',
          narrativeSlug,
          entity: protocol,
          observedAt: point.at,
          tvlUsd: null,
          fees24hUsd: isFees ? point.tvlUsd : null,
          volume24hUsd: isFees ? null : point.tvlUsd,
          snapshotId: snapshot.id,
        });
      }
    }
  } else if (key === 'defillama:overview:fees' || key === 'defillama:overview:dexs') {
    const totals = defillama.parseOverviewTotals(snapshot.payload);
    const isFees = key.endsWith('fees');
    for (const protocol of index.defillamaProtocols) {
      const total = totals.get(defillama.normalizeSlug(protocol));
      if (total === undefined) continue;
      for (const narrativeSlug of index.narrativesForDefillama(protocol)) {
        fundamentals.push({
          source: 'defillama',
          narrativeSlug,
          entity: defillama.normalizeSlug(protocol),
          observedAt: snapshot.fetchedAt,
          tvlUsd: null,
          fees24hUsd: isFees ? total : null,
          volume24hUsd: isFees ? null : total,
          snapshotId: snapshot.id,
        });
      }
    }
  } else if (key.startsWith('reddit:new:')) {
    const subreddit = key.slice('reddit:new:'.length);
    const narratives = index.narrativesForSubreddit(subreddit);
    if (narratives.length > 0) {
      for (const post of reddit.parseListing(snapshot.payload)) {
        for (const narrativeSlug of narratives) {
          mentions.push({
            source: 'reddit',
            narrativeSlug,
            rootOriginKey: redditRootOrigin(post),
            replicatorKey: post.fullname,
            observedAt: post.createdAt,
            signalKind: 'reddit_post',
            // El listado no trae la antigüedad del autor. No lo sabemos, y eso
            // se propaga como `null` hasta el peso (M§4).
            authorHasHistory: null,
            magnitude: post.ups,
            snapshotId: snapshot.id,
          });
        }
      }
    }
  } else if (key === 'polymarket:markets:top') {
    for (const market of polymarket.parseMarkets(snapshot.payload)) {
      if (market.volume24hUsd <= 0) continue;
      for (const narrativeSlug of index.narrativesForText(`${market.question} ${market.slug}`)) {
        mentions.push({
          source: 'polymarket',
          narrativeSlug,
          // El mercado es su propio origen: no hay réplica que deduplicar, y
          // verlo en cien corridas sigue siendo un mercado.
          rootOriginKey: `polymarket:market:${market.id}`,
          replicatorKey: `polymarket:market:${market.id}`,
          observedAt: snapshot.fetchedAt,
          signalKind: 'prediction_market_position',
          authorHasHistory: null,
          magnitude: market.volume24hUsd,
          snapshotId: snapshot.id,
        });
      }
    }
  }

  return { mentions, fundamentals };
}

export function deriveAll(
  snapshots: readonly StoredSnapshot[],
  index: DictionaryIndex,
  options: DeriveOptions = {},
): Derived {
  const mentions: MentionEvent[] = [];
  const fundamentals: FundamentalObservation[] = [];
  for (const snapshot of snapshots) {
    const derived = deriveFromSnapshot(snapshot, index, options);
    mentions.push(...derived.mentions);
    fundamentals.push(...derived.fundamentals);
  }
  return { mentions, fundamentals };
}
