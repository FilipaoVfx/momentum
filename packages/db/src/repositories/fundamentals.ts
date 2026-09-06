import type { FundamentalObservation } from '@momentum/core';
import type { Db, Tx } from '../pool.ts';

/**
 * El TVL llega del endpoint del protocolo y las comisiones del agregado diario,
 * en llamadas distintas. Si dos caen en el mismo instante, se fusionan campo a
 * campo en vez de pisarse: `coalesce(excluded, actual)` conserva lo que ya
 * había en vez de sustituirlo por un nulo.
 */
export async function insertFundamentals(
  tx: Tx,
  narrativeIdBySlug: ReadonlyMap<string, string>,
  observations: readonly FundamentalObservation[],
): Promise<number> {
  let written = 0;
  for (const o of observations) {
    const narrativeId = narrativeIdBySlug.get(o.narrativeSlug);
    if (!narrativeId) continue;
    if (o.tvlUsd === null && o.fees24hUsd === null && o.volume24hUsd === null) continue;
    await tx.query(
      `insert into fundamental_observation
         (narrative_id, source, entity, observed_at, tvl_usd, fees_24h_usd, volume_24h_usd, snapshot_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (narrative_id, source, entity, observed_at) do update
         set tvl_usd        = coalesce(excluded.tvl_usd, fundamental_observation.tvl_usd),
             fees_24h_usd   = coalesce(excluded.fees_24h_usd, fundamental_observation.fees_24h_usd),
             volume_24h_usd = coalesce(excluded.volume_24h_usd, fundamental_observation.volume_24h_usd)`,
      [
        narrativeId,
        o.source,
        o.entity,
        o.observedAt,
        o.tvlUsd,
        o.fees24hUsd,
        o.volume24hUsd,
        o.snapshotId,
      ],
    );
    written += 1;
  }
  return written;
}

export async function listFundamentals(
  db: Db | Tx,
  opts: { readonly since: Date; readonly until: Date },
): Promise<FundamentalObservation[]> {
  const { rows } = await db.query(
    `select n.slug, f.source, f.entity, f.observed_at, f.tvl_usd, f.fees_24h_usd,
            f.volume_24h_usd, f.snapshot_id
       from fundamental_observation f
       join narrative n on n.id = f.narrative_id
      where f.observed_at > $1 and f.observed_at <= $2
      order by f.observed_at asc`,
    [opts.since, opts.until],
  );
  return rows.map((r) => ({
    narrativeSlug: r.slug as string,
    source: r.source as FundamentalObservation['source'],
    entity: r.entity as string,
    observedAt: r.observed_at as Date,
    tvlUsd: r.tvl_usd === null ? null : Number(r.tvl_usd),
    fees24hUsd: r.fees_24h_usd === null ? null : Number(r.fees_24h_usd),
    volume24hUsd: r.volume_24h_usd === null ? null : Number(r.volume_24h_usd),
    snapshotId: r.snapshot_id as string,
  }));
}
