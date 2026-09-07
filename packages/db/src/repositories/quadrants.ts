import type { Quadrant } from '@momentum/core';
import type { Db, Tx } from '../pool.ts';

export interface QuadrantStateRecord {
  readonly id: string;
  readonly narrativeId: string;
  readonly narrativeSlug: string;
  readonly quadrant: Quadrant;
  readonly attentionSlope: number;
  readonly fundamentalSlope: number;
  readonly scoreVersion: string;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}

export async function openQuadrantState(
  db: Db | Tx,
  narrativeId: string,
  scoreVersion: string,
): Promise<QuadrantStateRecord | null> {
  const { rows } = await db.query(
    `select q.*, n.slug from quadrant_state q join narrative n on n.id = q.narrative_id
      where q.narrative_id = $1 and q.score_version = $2 and q.ended_at is null`,
    [narrativeId, scoreVersion],
  );
  const r = rows[0];
  return r ? mapState(r) : null;
}

/**
 * Registra el cuadrante actual. Si no cambió, no pasa nada: el estado abierto
 * sigue abierto y su `started_at` conserva desde cuándo lleva ahí (FR-006).
 * Si cambió, se cierra el anterior y se abre uno nuevo — el histórico no se
 * sobrescribe nunca (FR-023).
 */
export async function recordQuadrant(
  tx: Tx,
  input: {
    readonly narrativeId: string;
    readonly quadrant: Quadrant;
    readonly attentionSlope: number;
    readonly fundamentalSlope: number;
    readonly scoreVersion: string;
    readonly at: Date;
  },
): Promise<'unchanged' | 'opened' | 'transitioned' | 'out_of_order'> {
  const current = await openQuadrantState(tx, input.narrativeId, input.scoreVersion);
  if (current?.quadrant === input.quadrant) return 'unchanged';

  // Una transición con fecha anterior al estado abierto reescribiría el pasado:
  // diría que dejamos de creer algo antes de empezar a creerlo. Se rechaza y se
  // informa, en vez de escribir una fila incoherente o reventar contra la
  // restricción del esquema.
  if (current && input.at <= current.startedAt) return 'out_of_order';

  if (current) {
    await tx.query('update quadrant_state set ended_at = $1 where id = $2', [
      input.at,
      current.id,
    ]);
  }
  await tx.query(
    `insert into quadrant_state
       (narrative_id, quadrant, attention_slope, fundamental_slope, score_version, started_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      input.narrativeId,
      input.quadrant,
      input.attentionSlope,
      input.fundamentalSlope,
      input.scoreVersion,
      input.at,
    ],
  );
  return current ? 'transitioned' : 'opened';
}

/** Clasificaciones con antigüedad suficiente para ser evaluadas (FR-050). */
export async function statesDueForOutcome(
  db: Db,
  horizonDays: 7 | 14 | 30,
  now: Date,
): Promise<QuadrantStateRecord[]> {
  const { rows } = await db.query(
    `select q.*, n.slug from quadrant_state q
       join narrative n on n.id = q.narrative_id
      where q.started_at <= $1::timestamptz - make_interval(days => $2)
        and not exists (
          select 1 from outcome o
           where o.quadrant_state_id = q.id
             and o.horizon_days = $2
             and o.score_version = q.score_version)
      order by q.started_at asc`,
    [now, horizonDays],
  );
  return rows.map(mapState);
}

function mapState(r: Record<string, unknown>): QuadrantStateRecord {
  return {
    id: r['id'] as string,
    narrativeId: r['narrative_id'] as string,
    narrativeSlug: r['slug'] as string,
    quadrant: r['quadrant'] as Quadrant,
    attentionSlope: Number(r['attention_slope']),
    fundamentalSlope: Number(r['fundamental_slope']),
    scoreVersion: r['score_version'] as string,
    startedAt: r['started_at'] as Date,
    endedAt: (r['ended_at'] as Date | null) ?? null,
  };
}
