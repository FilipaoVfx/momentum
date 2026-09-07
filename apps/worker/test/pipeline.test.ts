import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  countOrigins,
  listGaps,
  listNarratives,
  upsertNarrative,
  withTransaction,
  type Db,
} from '@momentum/db';
import { reddit } from '@momentum/sources';
import { testDb, truncateAll } from '../../../test/db.ts';
import { DictionaryIndex } from '../src/dictionary.ts';
import { ingestOnce } from '../src/ingest.ts';
import { replay } from '../src/replay.ts';
import { BASE, CREDENTIALS, DICTIONARY, fakeNetwork, type NetworkOptions } from './fixtures.ts';

let db: Db;
const index = new DictionaryIndex(DICTIONARY);

/** Ocho corridas cada dos horas: catorce horas de historia sintética. */
const RUNS = 8;
const STEP_MS = 2 * 60 * 60 * 1000;

beforeEach(async () => {
  db ??= await testDb();
  await truncateAll(db);
  reddit.resetTokenCache();
  await withTransaction(db, async (tx) => {
    for (const n of DICTIONARY.narratives) {
      await upsertNarrative(tx, {
        slug: n.slug,
        name: n.name,
        dictionaryVersion: DICTIONARY.version,
        entities: {
          defillama_protocol: n.entities.defillama,
          subreddit: n.entities.subreddits,
          polymarket_tag: n.entities.polymarket_tags,
          ticker: n.entities.tickers,
        },
      });
    }
  });
});

afterAll(async () => {
  await db?.end();
});

async function runHistory(options: NetworkOptions = {}): Promise<string[]> {
  const runIds: string[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const at = new Date(BASE.getTime() + i * STEP_MS);
    const result = await ingestOnce({
      db,
      index,
      now: () => at,
      fetchImpl: fakeNetwork(() => at, options),
      redditCredentials: CREDENTIALS,
    });
    runIds.push(result.runId);
  }
  return runIds;
}

const metricRows = async (): Promise<Record<string, unknown>[]> => {
  const { rows } = await db.query(
    `select n.slug, m.axis, m.window_label, m.observed_at, m.value, m.score_version,
            m.input_snapshot_ids
       from metric_point m join narrative n on n.id = m.narrative_id
      order by m.observed_at, n.slug, m.axis`,
  );
  return rows;
};

describe('M0 — esqueleto: un snapshot completo persistido con procedencia', () => {
  it('cada fuente deja su crudo con hash, instante y calificación', async () => {
    await runHistory();
    const { rows } = await db.query(
      `select source, count(*)::int as n,
              count(*) filter (where content_hash is null or fetched_at is null)::int as sin_procedencia
         from source_snapshot group by source order by source`,
    );
    expect(rows.map((r) => r.source)).toEqual(['defillama', 'polymarket', 'reddit']);
    for (const row of rows) {
      expect(row.n).toBeGreaterThan(0);
      expect(row.sin_procedencia).toBe(0);
    }
  });

  it('ninguna métrica existe sin score_version ni sin sus insumos (FR-051, M§7)', async () => {
    await runHistory();
    const { rows } = await db.query(
      `select count(*)::int as n from metric_point
        where score_version is null or cardinality(input_snapshot_ids) = 0`,
    );
    expect(rows[0].n).toBe(0);
    expect((await metricRows()).length).toBeGreaterThan(0);
  });
});

describe('deduplicación por origen de extremo a extremo (SRS §7.3)', () => {
  it('cuarenta réplicas de una publicación raíz suman una observación, no cuarenta', async () => {
    await runHistory();
    const narratives = await listNarratives(db);
    const liquidStaking = narratives.find((n) => n.slug === 'liquid-staking')!;

    const { origins, mentions } = await countOrigins(
      db,
      liquidStaking.id,
      new Date(BASE.getTime() - 86_400_000),
      new Date(BASE.getTime() + RUNS * STEP_MS),
    );

    // 41 envíos de Reddit + el mercado de predicción de esta narrativa.
    expect(mentions).toBeGreaterThanOrEqual(41);
    // La campaña colapsa en un origen; quedan el hilo raíz, el post orgánico y
    // el mercado.
    expect(origins).toBe(3);
  });
});

describe('M1 — la serie se reconstruye desde los crudos, sin red', () => {
  it('el replay produce exactamente los mismos puntos que la corrida original', async () => {
    await runHistory();
    const original = await metricRows();
    expect(original.length).toBeGreaterThan(10);

    await db.query('truncate table metric_point, mention_event, fundamental_observation cascade');

    // Cualquier llamada externa durante el replay es un fallo del criterio de
    // salida de M1, así que la red deja de existir mientras corre.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('el replay no puede tocar la red');
    }) as typeof fetch;
    try {
      const result = await replay({
        db,
        index,
        from: new Date(BASE.getTime() - 86_400_000),
        to: new Date(BASE.getTime() + RUNS * STEP_MS),
      });
      expect(result.batches).toHaveLength(RUNS);
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(await metricRows()).toEqual(original);
  });

  const quadrantRows = async (): Promise<Record<string, unknown>[]> =>
    (
      await db.query(
        `select n.slug, q.quadrant, q.started_at, q.ended_at
           from quadrant_state q join narrative n on n.id = q.narrative_id
          order by n.slug, q.started_at`,
      )
    ).rows;

  it('fundamento creciendo con atención parada es construcción silenciosa', async () => {
    await runHistory({ attentionGrows: false });
    const rows = await quadrantRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.quadrant === 'quiet_build')).toBe(true);
  });

  it('con los dos ejes creciendo la narrativa queda confirmada', async () => {
    await runHistory();
    const rows = await quadrantRows();
    expect(rows.some((r) => r.quadrant === 'confirmed')).toBe(true);
    // Un solo estado abierto por narrativa: el histórico no se sobrescribe.
    const open = rows.filter((r) => r.ended_at === null);
    expect(new Set(open.map((r) => r.slug)).size).toBe(open.length);
  });
});

describe('degradación parcial declarada (FR-004, FR-014, M§23)', () => {
  it('con DefiLlama caída sigue habiendo serie de atención y una brecha con nombre', async () => {
    const runIds = await runHistory({ down: ['defillama'] });
    const gaps = await listGaps(db, runIds.at(-1)!);

    expect(gaps.some((g) => g.source === 'defillama' && g.reason === 'source_down')).toBe(true);
    expect(
      gaps.some((g) => g.source === 'defillama' && g.reason === 'window_not_covered'),
    ).toBe(true);

    const { rows } = await db.query(
      `select axis, count(*)::int as n from metric_point group by axis order by axis`,
    );
    expect(rows).toEqual([{ axis: 'attention', n: expect.any(Number) }]);
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it('sin credenciales de Reddit se declara la ausencia en vez de fingir cobertura', async () => {
    const at = BASE;
    const result = await ingestOnce({
      db,
      index,
      now: () => at,
      fetchImpl: fakeNetwork(() => at),
      redditCredentials: null,
    });
    const gaps = await listGaps(db, result.runId);
    expect(gaps.some((g) => g.source === 'reddit' && g.reason === 'not_configured')).toBe(true);
  });

  it('con todas las fuentes caídas no se inventa una serie', async () => {
    const at = BASE;
    const result = await ingestOnce({
      db,
      index,
      now: () => at,
      fetchImpl: fakeNetwork(() => at, { down: ['defillama', 'reddit', 'polymarket'] }),
      redditCredentials: CREDENTIALS,
    });
    expect(result.batch?.pointsWritten ?? 0).toBe(0);
    const gaps = await listGaps(db, result.runId);
    expect(gaps.length).toBeGreaterThan(0);
  });
});
