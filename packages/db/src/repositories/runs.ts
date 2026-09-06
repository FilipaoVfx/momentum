import type { CollectionGap } from '@momentum/core';
import type { Db, Tx } from '../pool.ts';

export type RunKind = 'ingest' | 'replay' | 'outcomes' | 'discovery';

export async function startRun(
  db: Db,
  kind: RunKind,
  mode: 'live' | 'replay',
  scoreVersion: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'insert into run (kind, mode, score_version) values ($1, $2, $3) returning id',
    [kind, mode, scoreVersion],
  );
  return rows[0]!.id;
}

export async function finishRun(db: Db, runId: string, status: 'ok' | 'failed'): Promise<void> {
  await db.query('update run set finished_at = now(), status = $2 where id = $1', [runId, status]);
}

/**
 * Cada corrida declara lo que no vio (FR-014, M§23). Cero filas significa
 * "miramos todo"; la ausencia de filas porque nadie miró es un bug, y por eso
 * el worker escribe una brecha `window_not_covered` cuando salta una fuente.
 */
export async function recordGaps(
  db: Db | Tx,
  runId: string,
  narrativeIdBySlug: ReadonlyMap<string, string>,
  gaps: readonly CollectionGap[],
): Promise<void> {
  for (const g of gaps) {
    await db.query(
      `insert into collection_gap
         (run_id, source, narrative_id, reason, detail, window_start, window_end)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        runId,
        g.source,
        g.narrativeSlug ? (narrativeIdBySlug.get(g.narrativeSlug) ?? null) : null,
        g.reason,
        g.detail,
        g.windowStart ?? null,
        g.windowEnd ?? null,
      ],
    );
  }
}

export async function listGaps(db: Db, runId: string): Promise<CollectionGap[]> {
  const { rows } = await db.query(
    `select g.source, g.reason, g.detail, g.window_start, g.window_end, n.slug
       from collection_gap g left join narrative n on n.id = g.narrative_id
      where g.run_id = $1 order by g.created_at asc`,
    [runId],
  );
  return rows.map((r) => ({
    source: r.source as CollectionGap['source'],
    reason: r.reason as CollectionGap['reason'],
    detail: r.detail as string,
    ...(r.slug ? { narrativeSlug: r.slug as string } : {}),
    ...(r.window_start ? { windowStart: r.window_start as Date } : {}),
    ...(r.window_end ? { windowEnd: r.window_end as Date } : {}),
  }));
}
