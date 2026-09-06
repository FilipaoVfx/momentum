import type { Db, Tx } from '../pool.ts';

export type Verdict = 'confirmed' | 'refuted' | 'inconclusive' | 'insufficient_data';

export interface OutcomeInput {
  readonly quadrantStateId: string;
  readonly horizonDays: 7 | 14 | 30;
  readonly verdict: Verdict;
  readonly attentionChange: number | null;
  readonly fundamentalChange: number | null;
  readonly scoreVersion: string;
}

/** Lo que no se puede medir contra un resultado, no se lanza (M§14, FR-050). */
export async function insertOutcome(db: Db | Tx, input: OutcomeInput): Promise<void> {
  await db.query(
    `insert into outcome
       (quadrant_state_id, horizon_days, verdict, attention_change, fundamental_change, score_version)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (quadrant_state_id, horizon_days, score_version) do nothing`,
    [
      input.quadrantStateId,
      input.horizonDays,
      input.verdict,
      input.attentionChange,
      input.fundamentalChange,
      input.scoreVersion,
    ],
  );
}

/** Tasa de acierto por cuadrante: la métrica primaria del PRD §8. */
export async function hitRateByQuadrant(
  db: Db,
  horizonDays: 7 | 14 | 30,
  scoreVersion: string,
): Promise<{ quadrant: string; evaluated: number; confirmed: number }[]> {
  const { rows } = await db.query(
    `select q.quadrant,
            count(*)::int as evaluated,
            count(*) filter (where o.verdict = 'confirmed')::int as confirmed
       from outcome o join quadrant_state q on q.id = o.quadrant_state_id
      where o.horizon_days = $1 and o.score_version = $2
        and o.verdict <> 'insufficient_data'
      group by q.quadrant order by q.quadrant`,
    [horizonDays, scoreVersion],
  );
  return rows as { quadrant: string; evaluated: number; confirmed: number }[];
}

export type { Tx };
