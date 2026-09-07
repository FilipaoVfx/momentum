import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { upsertNarrative, withTransaction, type Db } from '@momentum/db';
import { testDb, truncateAll } from '../../../test/db.ts';
import { backfill } from '../src/backfill.ts';
import { DictionaryIndex } from '../src/dictionary.ts';
import { midnightsBetween } from '../src/history.ts';
import { replay } from '../src/replay.ts';
import { DICTIONARY } from './fixtures.ts';

let db: Db;
const index = new DictionaryIndex(DICTIONARY);
const NOW = new Date('2026-02-01T12:00:00Z');

/** Serie diaria creciente, como la que devuelve `/protocol/{slug}`. */
function historyPayload(slug: string, days = 40): unknown {
  const tvl = [];
  for (let i = days; i >= 0; i -= 1) {
    const at = new Date(NOW.getTime() - i * 86_400_000);
    tvl.push({
      date: Math.floor(at.getTime() / 1000),
      totalLiquidityUSD: (slug === 'lido' ? 20e9 : 1e9) * (1 + (days - i) * 0.01),
    });
  }
  return { slug, tvl };
}

/**
 * Red que devuelve los tres componentes históricos, como DefiLlama de verdad.
 * Un backfill de solo TVL ya no produce serie: un compuesto sin señal de flujo
 * no es comparable con el resto (ver `computeFundamental`).
 */
const network: typeof fetch = (async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input.toString();
  const json = (body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const chart = (base: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 40; i >= 0; i -= 1) {
      out.push([
        Math.floor((NOW.getTime() - i * 86_400_000) / 1000),
        base * (1 + (40 - i) * 0.01),
      ]);
    }
    return out;
  };
  if (url.includes('/summary/fees/')) return json({ totalDataChart: chart(50_000) });
  if (url.includes('/summary/dexs/')) return json({ totalDataChart: chart(900_000) });
  const slug = url.split('/protocol/')[1] ?? '';
  return json(historyPayload(slug));
}) as typeof fetch;

beforeEach(async () => {
  db ??= await testDb();
  await truncateAll(db);
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

describe('instantes deterministas', () => {
  it('son las medianoches UTC del rango, no la hora de ejecución', () => {
    const days = midnightsBetween(new Date('2026-01-29T17:43:11Z'), new Date('2026-02-01T12:00:00Z'));
    // El 1 de febrero queda fuera: su cifra diaria aún no está completa.
    expect(days.map((d) => d.toISOString())).toEqual([
      '2026-01-30T00:00:00.000Z',
      '2026-01-31T00:00:00.000Z',
    ]);
  });
});

describe('backfill del eje de fundamento', () => {
  it('genera 14 días de serie con procedencia', async () => {
    const result = await backfill({ db, index, days: 14, now: NOW, fetchImpl: network });

    expect(result.history.days).toBe(13);
    expect(result.history.pointsWritten).toBeGreaterThan(0);

    const { rows } = await db.query(
      `select count(*)::int as n, count(*) filter (where axis = 'fundamental')::int as fund,
              count(*) filter (where cardinality(input_snapshot_ids) = 0)::int as sin_insumos
         from metric_point`,
    );
    expect(rows[0].n).toBe(rows[0].fund);
    expect(rows[0].sin_insumos).toBe(0);

    // El crudo íntegro queda guardado: 41 puntos, aunque solo derivemos 14 días.
    const snap = await db.query(
      "select payload from source_snapshot where request_key = 'defillama:history:lido'",
    );
    expect((snap.rows[0].payload as { tvl: unknown[] }).tvl).toHaveLength(41);
  });

  it('no inventa atención: la declara como brecha', async () => {
    const result = await backfill({ db, index, days: 14, now: NOW, fetchImpl: network });

    const { rows } = await db.query(
      "select count(*)::int as n from metric_point where axis = 'attention'",
    );
    expect(rows[0].n).toBe(0);
    expect(
      result.gaps.some((g) => g.source === 'reddit' && g.detail.includes('no tiene')),
    ).toBe(true);
  });

  it('no clasifica cuadrantes hacia atrás', async () => {
    await backfill({ db, index, days: 14, now: NOW, fetchImpl: network });
    const { rows } = await db.query('select count(*)::int as n from quadrant_state');
    expect(rows[0].n).toBe(0);
  });

  it('el replay del mismo rango reproduce los puntos exactamente', async () => {
    await backfill({ db, index, days: 14, now: NOW, fetchImpl: network });
    const before = (
      await db.query(
        `select n.slug, m.axis, m.observed_at, m.value from metric_point m
           join narrative n on n.id = m.narrative_id order by 1, 2, 3`,
      )
    ).rows;
    expect(before.length).toBeGreaterThan(10);

    await db.query('truncate table metric_point, fundamental_observation cascade');

    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('el replay no puede tocar la red');
    }) as typeof fetch;
    try {
      await replay({
        db,
        index,
        from: new Date(NOW.getTime() - 14 * 86_400_000),
        to: NOW,
      });
    } finally {
      globalThis.fetch = realFetch;
    }

    const after = (
      await db.query(
        `select n.slug, m.axis, m.observed_at, m.value from metric_point m
           join narrative n on n.id = m.narrative_id order by 1, 2, 3`,
      )
    ).rows;
    expect(after).toEqual(before);
  });
});

describe('la historia mide lo mismo que la corrida en vivo (ADR-016)', () => {
  it('reconstruye los tres componentes, no solo el TVL', async () => {
    await backfill({ db, index, days: 14, now: NOW, fetchImpl: network });

    const { rows } = await db.query(
      `select count(*) filter (where tvl_usd is not null)::int as tvl,
              count(*) filter (where fees_24h_usd is not null)::int as fees,
              count(*) filter (where volume_24h_usd is not null)::int as vol
         from fundamental_observation`,
    );
    expect(rows[0].tvl).toBeGreaterThan(0);
    expect(rows[0].fees).toBeGreaterThan(0);
    expect(rows[0].vol).toBeGreaterThan(0);
  });

  it('la serie no da un salto artificial al llegar al presente', async () => {
    await backfill({ db, index, days: 14, now: NOW, fetchImpl: network });
    const { rows } = await db.query(
      `select value from metric_point m join narrative n on n.id = m.narrative_id
        where n.slug = 'liquid-staking' and m.axis = 'fundamental'
        order by m.observed_at`,
    );
    const values = rows.map((r) => Number(r.value));
    expect(values.length).toBeGreaterThan(5);

    // Ningún paso entre días consecutivos puede ser mayor que el recorrido
    // total de la serie: eso delataría un cambio de lo que se está midiendo.
    const total = Math.abs(values.at(-1)! - values[0]!);
    for (let i = 1; i < values.length; i += 1) {
      expect(Math.abs(values[i]! - values[i - 1]!)).toBeLessThanOrEqual(total + 1e-9);
    }
  });
});
