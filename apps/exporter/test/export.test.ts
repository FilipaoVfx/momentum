import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AXIS_WINDOW, SCORE_VERSION } from '@momentum/core';
import { upsertNarrative, withTransaction, type Db } from '@momentum/db';
import { testDb, truncateAll } from '../../../test/db.ts';
import { exportStaticData } from '../src/export.ts';
import type { Feed, Meta, NarrativeDetail } from '../src/types.ts';

let db: Db;
const NOW = new Date('2026-02-01T00:00:00Z');

beforeEach(async () => {
  db ??= await testDb();
  await truncateAll(db);
});

afterAll(async () => {
  await db?.end();
});

async function seed(): Promise<{ id: string; snapshotId: string }> {
  const id = await withTransaction(db, (tx) =>
    upsertNarrative(tx, {
      slug: 'liquid-staking',
      name: 'Liquid staking',
      dictionaryVersion: 'test',
      entities: { defillama_protocol: ['lido'] },
    }),
  );
  await withTransaction(db, (tx) =>
    upsertNarrative(tx, {
      slug: 'depin',
      name: 'DePIN',
      dictionaryVersion: 'test',
      entities: {},
    }),
  );

  const snap = await db.query(
    `insert into source_snapshot
       (source, endpoint, request_key, latency_ms, payload, content_hash, fetched_at,
        source_reliability, data_credibility)
     values ('defillama', 'https://api.llama.fi/tvl/lido', 'defillama:protocol:lido', 10,
             '1'::jsonb, '\\x00'::bytea, $1, 'A', 2)
     returning id`,
    [NOW],
  );
  const snapshotId = snap.rows[0].id as string;

  // Ocho días de serie en ambos ejes para que haya con qué comparar.
  for (let day = 8; day >= 0; day -= 1) {
    const at = new Date(NOW.getTime() - day * 86_400_000);
    for (const [axis, base] of [
      ['attention', 1],
      ['fundamental', 10],
    ] as const) {
      await db.query(
        `insert into metric_point
           (narrative_id, axis, window_label, observed_at, value, score_version, input_snapshot_ids)
         values ($1, $2, $7, $3, $4, $6, array[$5::uuid])`,
        [id, axis, at, base + (8 - day) * 0.5, snapshotId, SCORE_VERSION, AXIS_WINDOW[axis]],
      );
    }
  }
  return { id, snapshotId };
}

const read = async <T>(dir: string, file: string): Promise<T> =>
  JSON.parse(await readFile(join(dir, file), 'utf8')) as T;

describe('las tres preguntas (manifiesto)', () => {
  it('cada número exportado trae comparación, procedencia e instante', async () => {
    const { snapshotId } = await seed();
    const dir = await mkdtemp(join(tmpdir(), 'momentum-'));
    await exportStaticData({ db, outDir: dir, now: NOW });

    const feed = await read<Feed>(dir, 'feed.json');
    const ls = feed.narratives.find((n) => n.slug === 'liquid-staking')!;

    for (const measured of [ls.attention!, ls.fundamental!]) {
      // ¿Comparado con qué?
      expect(measured.comparison.change7d).toBeCloseTo(3.5, 6);
      expect(measured.comparison.peerCount).toBeGreaterThanOrEqual(0);
      // ¿De dónde salió?
      expect(measured.provenance.snapshotIds).toEqual([snapshotId]);
      expect(measured.provenance.method.length).toBeGreaterThan(20);
      expect(measured.provenance.scoreVersion).toBe(SCORE_VERSION);
      // ¿Qué tan viejo es?
      expect(measured.provenance.fetchedAt).toBe(NOW.toISOString());
    }
  });

  it('una narrativa sin datos sale como tal, nunca como "muerta"', async () => {
    await seed();
    const dir = await mkdtemp(join(tmpdir(), 'momentum-'));
    await exportStaticData({ db, outDir: dir, now: NOW });

    const feed = await read<Feed>(dir, 'feed.json');
    const depin = feed.narratives.find((n) => n.slug === 'depin')!;
    expect(depin.quadrant).toBeNull();
    expect(depin.attention).toBeNull();
    expect(depin.insufficientDataReason).toContain('sin puntos suficientes');
  });

  it('un punto sin insumos no puede existir, ni siquiera forzándolo por SQL', async () => {
    await seed();
    // El exportador tiene su propia guarda, pero no llega a hacer falta: la
    // restricción del esquema impide crear el caso. Es la defensa que importa,
    // porque no depende de que nadie se acuerde de comprobarlo.
    await expect(
      db.query('update metric_point set input_snapshot_ids = array[]::uuid[]'),
    ).rejects.toThrow(/input_snapshot_ids/);
  });
});

describe('material del sitio', () => {
  it('escribe meta, feed y una ficha por narrativa', async () => {
    await seed();
    const dir = await mkdtemp(join(tmpdir(), 'momentum-'));
    const result = await exportStaticData({ db, outDir: dir, now: NOW });

    expect(result.files).toContain('meta.json');
    expect(result.files).toContain('feed.json');
    expect(result.files).toContain('narratives/liquid-staking.json');

    const detail = await read<NarrativeDetail>(dir, 'narratives/liquid-staking.json');
    expect(detail.series.attention).toHaveLength(9);
    expect(detail.series.fundamental).toHaveLength(9);
  });

  it('meta declara la cobertura real, no la deseada', async () => {
    await seed();
    const dir = await mkdtemp(join(tmpdir(), 'momentum-'));
    await exportStaticData({ db, outDir: dir, now: NOW });

    const meta = await read<Meta>(dir, 'meta.json');
    expect(meta.coverage).toEqual({
      narratives: 2,
      withAttention: 1,
      withFundamental: 1,
      classified: 0,
    });
    expect(meta.sources.map((s) => s.source)).toEqual(['defillama', 'reddit', 'polymarket']);
  });
});
