import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hitRateByQuadrant, upsertNarrative, withTransaction, type Db } from '@momentum/db';
import { testDb, truncateAll } from '../../../test/db.ts';
import { evaluateOutcomes } from '../src/outcomes.ts';

let db: Db;
const NOW = new Date('2026-03-01T00:00:00Z');
const daysBefore = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000);

beforeEach(async () => {
  db ??= await testDb();
  await truncateAll(db);
});

afterAll(async () => {
  await db?.end();
});

/** Siembra una clasificación antigua con su serie, como la habría dejado el worker. */
async function seed(input: {
  quadrant: string;
  startedDaysAgo: number;
  fundamentalAtStart: number;
  fundamentalAtHorizon: number;
  horizonDays: number;
}): Promise<string> {
  const narrativeId = await withTransaction(db, (tx) =>
    upsertNarrative(tx, {
      slug: 'liquid-staking',
      name: 'Liquid staking',
      dictionaryVersion: 'test',
      entities: {},
    }),
  );
  const startedAt = daysBefore(input.startedDaysAgo);
  const horizonAt = new Date(startedAt.getTime() + input.horizonDays * 86_400_000);

  const { rows } = await db.query(
    `insert into quadrant_state
       (narrative_id, quadrant, attention_slope, fundamental_slope, score_version, started_at)
     values ($1, $2, 0, 0.1, 'v1', $3) returning id`,
    [narrativeId, input.quadrant, startedAt],
  );

  for (const [at, fundamental] of [
    [startedAt, input.fundamentalAtStart],
    [horizonAt, input.fundamentalAtHorizon],
  ] as const) {
    for (const [axis, value] of [
      ['attention', 1],
      ['fundamental', fundamental],
    ] as const) {
      await db.query(
        `insert into metric_point
           (narrative_id, axis, window_label, observed_at, value, score_version, input_snapshot_ids)
         values ($1, $2, '24h', $3, $4, 'v1', array[gen_random_uuid()])`,
        [narrativeId, axis, at, value],
      );
    }
  }
  return rows[0].id as string;
}

describe('tabla de outcomes (M§14, FR-050)', () => {
  it('evalúa una construcción silenciosa a 30 días y la da por acertada si el fundamento creció', async () => {
    await seed({
      quadrant: 'quiet_build',
      startedDaysAgo: 31,
      fundamentalAtStart: 1,
      fundamentalAtHorizon: 4,
      horizonDays: 30,
    });

    const result = await evaluateOutcomes({ db, now: NOW });
    expect(result.written).toBeGreaterThan(0);

    const { rows } = await db.query(
      'select horizon_days, verdict from outcome order by horizon_days',
    );
    expect(rows.map((r) => r.horizon_days)).toEqual([7, 14, 30]);
    expect(rows.find((r) => r.horizon_days === 30)!.verdict).toBe('confirmed');
  });

  it('sin serie en el horizonte registra que no se pudo evaluar, no un acierto', async () => {
    const narrativeId = await withTransaction(db, (tx) =>
      upsertNarrative(tx, {
        slug: 'depin',
        name: 'DePIN',
        dictionaryVersion: 'test',
        entities: {},
      }),
    );
    await db.query(
      `insert into quadrant_state
         (narrative_id, quadrant, attention_slope, fundamental_slope, score_version, started_at)
       values ($1, 'confirmed', 0.5, 0.5, 'v1', $2)`,
      [narrativeId, daysBefore(40)],
    );

    await evaluateOutcomes({ db, now: NOW });
    const { rows } = await db.query('select distinct verdict from outcome');
    expect(rows).toEqual([{ verdict: 'insufficient_data' }]);
  });

  it('es idempotente: dos corridas no duplican la evaluación', async () => {
    await seed({
      quadrant: 'quiet_build',
      startedDaysAgo: 31,
      fundamentalAtStart: 1,
      fundamentalAtHorizon: 4,
      horizonDays: 30,
    });
    await evaluateOutcomes({ db, now: NOW });
    await evaluateOutcomes({ db, now: NOW });
    const { rows } = await db.query('select count(*)::int as n from outcome');
    expect(rows[0].n).toBe(3);
  });

  it('la tasa de acierto por cuadrante es consultable: es la métrica primaria del PRD', async () => {
    await seed({
      quadrant: 'quiet_build',
      startedDaysAgo: 31,
      fundamentalAtStart: 1,
      fundamentalAtHorizon: 4,
      horizonDays: 30,
    });
    await evaluateOutcomes({ db, now: NOW });
    const rates = await hitRateByQuadrant(db, 30, 'v1');
    expect(rates).toEqual([{ quadrant: 'quiet_build', evaluated: 1, confirmed: 1 }]);
  });
});
