import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { appliedMigrations, migrateDown, migrateUp, upsertNarrative, withTransaction } from '../src/index.ts';
import type { Db } from '../src/index.ts';
import { testDb, truncateAll } from '../../../test/db.ts';

let db: Db;

beforeEach(async () => {
  db ??= await testDb();
  await truncateAll(db);
});

afterAll(async () => {
  await db?.end();
});

const narrativeId = (): Promise<string> =>
  withTransaction(db, (tx) =>
    upsertNarrative(tx, { slug: 'n', name: 'N', dictionaryVersion: 'test', entities: {} }),
  );

describe('migraciones', () => {
  it('aplican y revierten en orden inverso, hasta dejar la base vacía', async () => {
    const applied = await appliedMigrations(db);
    expect(applied).toContain('0001_init');
    expect(applied).toContain('0002_provider_usage');

    // Se revierten todas: una migración que solo sabe aplicarse no es
    // reversible, es un camino de ida.
    const reverted: string[] = [];
    for (let i = applied.length; i > 0; i -= 1) {
      const name = await migrateDown(db);
      if (name) reverted.push(name);
    }
    expect(reverted).toEqual([...applied].reverse());
    expect(await appliedMigrations(db)).toHaveLength(0);
    expect(await migrateDown(db)).toBeNull();

    await migrateUp(db);
    expect(await appliedMigrations(db)).toEqual(applied);
  });
});

describe('invariantes del esquema', () => {
  it('un punto de serie sin score_version no se puede escribir (FR-051)', async () => {
    const id = await narrativeId();
    await expect(
      db.query(
        `insert into metric_point (narrative_id, axis, window_label, observed_at, value, input_snapshot_ids)
         values ($1, 'attention', '24h', now(), 1, array[gen_random_uuid()])`,
        [id],
      ),
    ).rejects.toThrow(/score_version/);
  });

  it('un punto de serie sin insumos tampoco (M§7)', async () => {
    const id = await narrativeId();
    await expect(
      db.query(
        `insert into metric_point
           (narrative_id, axis, window_label, observed_at, value, score_version, input_snapshot_ids)
         values ($1, 'attention', '24h', now(), 1, 'v1', array[]::uuid[])`,
        [id],
      ),
    ).rejects.toThrow();
  });

  it('un token "resuelto" sin narrativa es contradictorio y se rechaza (FR-007)', async () => {
    await expect(
      db.query(
        `insert into token (chain, address, narrative_resolution) values ('solana', 'abc', 'resolved')`,
      ),
    ).rejects.toThrow();
    await db.query(
      `insert into token (chain, address, narrative_resolution) values ('solana', 'abc', 'unresolved')`,
    );
  });

  it('no puede haber dos cuadrantes abiertos para la misma narrativa', async () => {
    const id = await narrativeId();
    const insert = (quadrant: string): Promise<unknown> =>
      db.query(
        `insert into quadrant_state
           (narrative_id, quadrant, attention_slope, fundamental_slope, score_version, started_at)
         values ($1, $2, 0, 0, 'v1', now())`,
        [id, quadrant],
      );
    await insert('dead');
    await expect(insert('confirmed')).rejects.toThrow();
  });

  it('mention_event está particionada por tiempo desde el inicio', async () => {
    const { rows } = await db.query(
      `select relkind from pg_class where relname = 'mention_event'`,
    );
    expect(rows[0].relkind).toBe('p');
  });
});
