import type { Axis, MetricPoint, WindowLabel } from '@momentum/core';
import type { Db, Tx } from '../pool.ts';

/**
 * Un `metric_point` no puede existir sin `score_version` ni sin sus insumos: el
 * esquema lo impide y esta función no ofrece forma de saltárselo (FR-051, M§7).
 */
export async function insertMetricPoints(
  tx: Tx,
  narrativeIdBySlug: ReadonlyMap<string, string>,
  points: readonly MetricPoint[],
): Promise<number> {
  let written = 0;
  for (const p of points) {
    const narrativeId = narrativeIdBySlug.get(p.narrativeSlug);
    if (!narrativeId) continue;
    if (p.inputSnapshotIds.length === 0) {
      throw new Error(
        `metric_point sin insumos para ${p.narrativeSlug}/${p.axis}: ` +
          'una métrica sin camino de vuelta a su fuente no se guarda.',
      );
    }
    await tx.query(
      `insert into metric_point
         (narrative_id, axis, window_label, observed_at, value, score_version, input_snapshot_ids)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (narrative_id, axis, window_label, observed_at, score_version)
       do update set value = excluded.value,
                     input_snapshot_ids = excluded.input_snapshot_ids,
                     computed_at = now()`,
      [
        narrativeId,
        p.axis,
        p.window,
        p.observedAt,
        p.value,
        p.scoreVersion,
        p.inputSnapshotIds,
      ],
    );
    written += 1;
  }
  return written;
}

export async function listMetricPoints(
  db: Db | Tx,
  opts: {
    readonly narrativeId?: string;
    readonly axis?: Axis;
    readonly window: WindowLabel;
    readonly scoreVersion: string;
    readonly since: Date;
    readonly until: Date;
  },
): Promise<(MetricPoint & { narrativeId: string })[]> {
  const { rows } = await db.query(
    `select m.narrative_id, n.slug, m.axis, m.window_label, m.observed_at, m.value,
            m.score_version, m.input_snapshot_ids
       from metric_point m
       join narrative n on n.id = m.narrative_id
      where m.window_label = $1 and m.score_version = $2
        and m.observed_at > $3 and m.observed_at <= $4
        and ($5::uuid is null or m.narrative_id = $5)
        and ($6::text is null or m.axis = $6)
      order by m.observed_at asc`,
    [opts.window, opts.scoreVersion, opts.since, opts.until, opts.narrativeId ?? null, opts.axis ?? null],
  );
  return rows.map((r) => ({
    narrativeId: r.narrative_id as string,
    narrativeSlug: r.slug as string,
    axis: r.axis as Axis,
    window: r.window_label as WindowLabel,
    observedAt: r.observed_at as Date,
    value: Number(r.value),
    scoreVersion: r.score_version as string,
    inputSnapshotIds: r.input_snapshot_ids as string[],
  }));
}
