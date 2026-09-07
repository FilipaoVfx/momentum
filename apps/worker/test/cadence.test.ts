import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { upsertNarrative, withTransaction, type Db } from '@momentum/db';
import { reddit } from '@momentum/sources';
import { testDb, truncateAll } from '../../../test/db.ts';
import { CADENCE_MS, isDue } from '../src/cadence.ts';
import { DictionaryIndex } from '../src/dictionary.ts';
import { ingestOnce } from '../src/ingest.ts';
import { BASE, CREDENTIALS, DICTIONARY, fakeNetwork } from './fixtures.ts';

let db: Db;
const index = new DictionaryIndex(DICTIONARY);

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

describe('cadencia por eje', () => {
  it('una clave nunca pedida siempre toca', async () => {
    expect(await isDue(db, 'defillama:protocol:lido', 'slow', BASE)).toBe(true);
  });

  it('cuatro corridas a 15 minutos capturan la atención cuatro veces y el TVL una', async () => {
    for (let i = 0; i < 4; i += 1) {
      const at = new Date(BASE.getTime() + i * 15 * 60 * 1000);
      await ingestOnce({
        db,
        index,
        now: () => at,
        fetchImpl: fakeNetwork(() => at),
        redditCredentials: CREDENTIALS,
      });
    }

    const { rows } = await db.query(
      `select request_key, count(*)::int as n from source_snapshot
        group by 1 order by 1`,
    );
    const byKey = new Map(rows.map((r) => [r.request_key as string, r.n as number]));

    expect(byKey.get('polymarket:markets:top')).toBe(4);
    expect(byKey.get('reddit:new:ethstaker')).toBe(4);
    // El TVL y los agregados de 24 h van a cadencia horaria: una sola captura
    // en los 45 minutos que cubren las cuatro corridas.
    expect(byKey.get('defillama:protocol:lido')).toBe(1);
    expect(byKey.get('defillama:overview:fees')).toBe(1);
  });

  it('pasada la hora, el eje lento vuelve a pedirse', async () => {
    const first = BASE;
    await ingestOnce({
      db,
      index,
      now: () => first,
      fetchImpl: fakeNetwork(() => first),
      redditCredentials: CREDENTIALS,
    });
    const later = new Date(BASE.getTime() + CADENCE_MS.slow);
    await ingestOnce({
      db,
      index,
      now: () => later,
      fetchImpl: fakeNetwork(() => later),
      redditCredentials: CREDENTIALS,
    });

    const { rows } = await db.query(
      "select count(*)::int as n from source_snapshot where request_key = 'defillama:protocol:lido'",
    );
    expect(rows[0].n).toBe(2);
  });

  it('saltarse una llamada por cadencia no es una brecha de recolección', async () => {
    const first = BASE;
    await ingestOnce({
      db,
      index,
      now: () => first,
      fetchImpl: fakeNetwork(() => first),
      redditCredentials: CREDENTIALS,
    });
    const soon = new Date(BASE.getTime() + 15 * 60 * 1000);
    const result = await ingestOnce({
      db,
      index,
      now: () => soon,
      fetchImpl: fakeNetwork(() => soon),
      redditCredentials: CREDENTIALS,
    });

    expect(result.skippedByCadence).toBeGreaterThan(0);
    // Un dato fresco que no volvemos a pedir no es un hueco: es ahorro.
    for (const gap of result.gaps) {
      expect(gap.detail).not.toContain('cadencia');
    }
    // Y la serie de fundamento sigue existiendo, porque la observación anterior
    // cae dentro de la ventana de 24 h.
    const { rows } = await db.query(
      "select count(*)::int as n from metric_point where axis = 'fundamental'",
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it('el replay sigue siendo fiel con capturas a cadencias distintas', async () => {
    for (let i = 0; i < 6; i += 1) {
      const at = new Date(BASE.getTime() + i * 15 * 60 * 1000);
      await ingestOnce({
        db,
        index,
        now: () => at,
        fetchImpl: fakeNetwork(() => at),
        redditCredentials: CREDENTIALS,
      });
    }
    const before = (
      await db.query(
        `select n.slug, m.axis, m.observed_at, m.value from metric_point m
           join narrative n on n.id = m.narrative_id order by 1, 2, 3`,
      )
    ).rows;

    await db.query('truncate table metric_point, mention_event, fundamental_observation cascade');
    const { replay } = await import('../src/replay.ts');
    await replay({
      db,
      index,
      from: new Date(BASE.getTime() - 86_400_000),
      to: new Date(BASE.getTime() + 2 * 3_600_000),
    });

    const after = (
      await db.query(
        `select n.slug, m.axis, m.observed_at, m.value from metric_point m
           join narrative n on n.id = m.narrative_id order by 1, 2, 3`,
      )
    ).rows;
    expect(after).toEqual(before);
  });
});

describe('una corrida sin capturas nuevas', () => {
  it('no revienta ni inventa un punto de serie irreproducible', async () => {
    const at = BASE;
    await ingestOnce({
      db,
      index,
      now: () => at,
      fetchImpl: fakeNetwork(() => at),
      redditCredentials: CREDENTIALS,
    });
    const puntosTrasPrimera = (
      await db.query('select count(*)::int as n from metric_point')
    ).rows[0].n as number;

    // Segunda corrida un minuto después: no toca nada por cadencia.
    const enseguida = new Date(BASE.getTime() + 60_000);
    const result = await ingestOnce({
      db,
      index,
      now: () => enseguida,
      fetchImpl: fakeNetwork(() => enseguida),
      redditCredentials: CREDENTIALS,
    });

    expect(result.snapshotCount).toBe(0);
    expect(result.skippedByCadence).toBeGreaterThan(0);
    expect(result.batch).toBeNull();
    // La serie no avanza: un punto sin snapshot que lo respalde no se podría
    // reconstruir en el replay.
    const despues = (await db.query('select count(*)::int as n from metric_point')).rows[0].n;
    expect(despues).toBe(puntosTrasPrimera);
    // Y no se declara "ninguna fuente respondió", porque no es lo que pasó.
    expect(result.gaps.some((g) => g.detail.includes('ninguna fuente respondió'))).toBe(false);
  });
});
