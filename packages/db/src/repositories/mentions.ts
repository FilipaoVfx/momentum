import type { MentionEvent } from '@momentum/core';
import type { Db, Tx } from '../pool.ts';

/**
 * Inserta menciones ya resueltas a su origen raíz. Idempotente por
 * (narrativa, fuente, replicador, instante): una corrida repetida no infla la
 * serie.
 */
export async function insertMentions(
  tx: Tx,
  narrativeIdBySlug: ReadonlyMap<string, string>,
  events: readonly MentionEvent[],
): Promise<number> {
  if (events.length === 0) return 0;

  const months = new Set(events.map((e) => e.observedAt.toISOString().slice(0, 7)));
  for (const month of months) {
    await tx.query('select ensure_mention_event_partition($1)', [`${month}-01T00:00:00Z`]);
  }

  let inserted = 0;
  for (const e of events) {
    const narrativeId = narrativeIdBySlug.get(e.narrativeSlug);
    if (!narrativeId) continue;
    const { rowCount } = await tx.query(
      `insert into mention_event
         (narrative_id, source, signal_kind, root_origin_key, replicator_key,
          observed_at, author_has_history, magnitude, snapshot_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (narrative_id, source, replicator_key, observed_at) do nothing`,
      [
        narrativeId,
        e.source,
        e.signalKind,
        e.rootOriginKey,
        e.replicatorKey,
        e.observedAt,
        e.authorHasHistory,
        e.magnitude,
        e.snapshotId,
      ],
    );
    inserted += rowCount ?? 0;
  }
  return inserted;
}

export async function listMentions(
  db: Db | Tx,
  opts: { readonly since: Date; readonly until: Date },
): Promise<MentionEvent[]> {
  const { rows } = await db.query(
    `select n.slug, m.source, m.signal_kind, m.root_origin_key, m.replicator_key,
            m.observed_at, m.author_has_history, m.magnitude, m.snapshot_id
       from mention_event m
       join narrative n on n.id = m.narrative_id
      where m.observed_at > $1 and m.observed_at <= $2
      order by m.observed_at asc`,
    [opts.since, opts.until],
  );
  return rows.map((r) => ({
    narrativeSlug: r.slug as string,
    source: r.source as MentionEvent['source'],
    signalKind: r.signal_kind as MentionEvent['signalKind'],
    rootOriginKey: r.root_origin_key as string,
    replicatorKey: r.replicator_key as string,
    observedAt: r.observed_at as Date,
    authorHasHistory: r.author_has_history as boolean | null,
    magnitude: Number(r.magnitude),
    snapshotId: r.snapshot_id as string,
  }));
}

/**
 * Conteo de orígenes distintos frente a menciones totales. La distancia entre
 * ambos números es la campaña coordinada (M§17): se expone porque es la métrica
 * que delata el modo de falla, no un detalle de implementación.
 */
export async function countOrigins(
  db: Db | Tx,
  narrativeId: string,
  since: Date,
  until: Date,
): Promise<{ origins: number; mentions: number }> {
  const { rows } = await db.query<{ origins: string; mentions: string }>(
    `select count(distinct root_origin_key) as origins, count(*) as mentions
       from mention_event
      where narrative_id = $1 and observed_at > $2 and observed_at <= $3`,
    [narrativeId, since, until],
  );
  return { origins: Number(rows[0]!.origins), mentions: Number(rows[0]!.mentions) };
}
