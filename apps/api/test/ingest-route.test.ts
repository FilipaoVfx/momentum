import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@momentum/db';
import { testDb, truncateAll } from '../../../test/db.ts';
import { registerIngestRoute } from '../src/ingest-route.ts';

let db: Db;
let app: FastifyInstance;
const TOKEN = 'token-de-prueba';

beforeEach(async () => {
  db ??= await testDb();
  await truncateAll(db);
  process.env['INGEST_TOKEN'] = TOKEN;
  app = Fastify();
  registerIngestRoute(app, db);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.end();
});

const post = (body: unknown, token: string | null = TOKEN) =>
  app.inject({
    method: 'POST',
    url: '/ingest/snapshot',
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    payload: body as Record<string, unknown>,
  });

const validBody = {
  source: 'defillama',
  requestKey: 'defillama:protocol:lido',
  endpoint: 'https://api.llama.fi/tvl/lido',
  payload: 24_260_650_933.32,
  fetchedAt: '2026-01-10T00:00:00.000Z',
  rating: 'A2',
};

describe('autenticación', () => {
  it('sin token no se entra', async () => {
    expect((await post(validBody, null)).statusCode).toBe(401);
  });

  it('con token equivocado tampoco', async () => {
    expect((await post(validBody, 'otro')).statusCode).toBe(401);
  });

  it('sin INGEST_TOKEN configurado la puerta está cerrada, no abierta', async () => {
    delete process.env['INGEST_TOKEN'];
    const closed = Fastify();
    registerIngestRoute(closed, db);
    await closed.ready();
    const res = await closed.inject({
      method: 'POST',
      url: '/ingest/snapshot',
      headers: { authorization: 'Bearer lo-que-sea' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(503);
    await closed.close();
  });
});

describe('procedencia idéntica a la del gateway', () => {
  it('escribe un snapshot con hash calculado en servidor', async () => {
    const res = await post(validBody);
    expect(res.statusCode).toBe(201);

    const { rows } = await db.query('select * from source_snapshot');
    expect(rows).toHaveLength(1);
    expect(rows[0].request_key).toBe('defillama:protocol:lido');
    expect(rows[0].source_reliability).toBe('A');
    expect(rows[0].fetched_at.toISOString()).toBe('2026-01-10T00:00:00.000Z');
    // El hash se calcula sobre lo que guardamos, no se acepta del cliente.
    expect(rows[0].content_hash).toEqual(
      createHash('sha256').update(JSON.stringify(validBody.payload)).digest(),
    );
  });

  it('sin calificación declarada asume la peor, no la mejor', async () => {
    const sinRating = { ...validBody, rating: undefined };
    await post(sinRating);
    const { rows } = await db.query(
      'select source_reliability, data_credibility from source_snapshot',
    );
    expect(rows[0].source_reliability).toBe('F');
    expect(rows[0].data_credibility).toBe(6);
  });

  it('lo que entra por aquí lo entiende derive.ts igual que lo del gateway', async () => {
    await post(validBody);
    const { listSnapshots } = await import('@momentum/db');
    const { deriveFromSnapshot } = await import('../../worker/src/derive.ts');
    const { DictionaryIndex } = await import('../../worker/src/dictionary.ts');

    const [snapshot] = await listSnapshots(db, {
      since: new Date('2026-01-01'),
      until: new Date('2026-02-01'),
    });
    const index = new DictionaryIndex({
      version: 'test',
      narratives: [
        {
          slug: 'liquid-staking',
          name: 'Liquid staking',
          entities: { defillama: ['lido'], subreddits: [], polymarket_tags: [], tickers: [] },
        },
      ],
    });
    const derived = deriveFromSnapshot(snapshot!, index);
    expect(derived.fundamentals).toHaveLength(1);
    expect(derived.fundamentals[0]!.tvlUsd).toBeCloseTo(24_260_650_933.32, 2);
  });
});

describe('la puerta no acepta atajos', () => {
  it('rechaza una fuente desconocida', async () => {
    const res = await post({ ...validBody, source: 'un-scraper-cualquiera' });
    expect(res.statusCode).toBe(400);
  });

  it('rechaza una requestKey que derive.ts no sabría interpretar', async () => {
    const res = await post({ ...validBody, requestKey: 'defillama:loquesea:x' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('derive.ts');
  });

  it('rechaza un envío sin payload crudo', async () => {
    const sinPayload = { ...validBody, payload: undefined };
    expect((await post(sinPayload)).statusCode).toBe(400);
  });

  it('rechaza una fecha de captura inválida', async () => {
    expect((await post({ ...validBody, fetchedAt: 'ayer' })).statusCode).toBe(400);
  });

  it('no deja escribir nada en las tablas de resultado', async () => {
    await post(validBody);
    const { rows } = await db.query(
      'select (select count(*) from metric_point) m, (select count(*) from quadrant_state) q',
    );
    expect(rows[0]).toEqual({ m: '0', q: '0' });
  });
});
