import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@momentum/db';
import { testDb, truncateAll } from '../../../test/db.ts';
import { SourceGateway } from '../src/index.ts';

let db: Db;

beforeEach(async () => {
  db ??= await testDb();
  await truncateAll(db);
});

afterAll(async () => {
  await db?.end();
});

const response = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { 'content-type': 'application/json' } });

const get = (gateway: SourceGateway) =>
  gateway.get({ source: 'defillama', path: '/protocol/lido', requestKey: 'defillama:protocol:lido' });

describe('procedencia (ADR-007, M§9, M§18)', () => {
  it('persiste el crudo con hash y timestamp de captura', async () => {
    const body = JSON.stringify({ tvl: [{ totalLiquidityUSD: 42 }] });
    const gateway = new SourceGateway({ db, fetchImpl: async () => response(body) });

    const result = await get(gateway);
    expect(result.ok).toBe(true);

    const { rows } = await db.query('select * from source_snapshot');
    expect(rows).toHaveLength(1);
    expect(rows[0].content_hash).toEqual(createHash('sha256').update(body).digest());
    expect(rows[0].payload).toEqual({ tvl: [{ totalLiquidityUSD: 42 }] });
    expect(rows[0].source_reliability).toBe('A');
    expect(rows[0].fetched_at).toBeInstanceOf(Date);
  });

  it('guarda el crudo aunque no sea JSON: es justo cuando hace falta mirarlo', async () => {
    const gateway = new SourceGateway({ db, fetchImpl: async () => response('<html>502</html>') });

    const result = await get(gateway);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.gap.reason).toBe('parse_failed');

    const { rows } = await db.query('select payload from source_snapshot');
    expect(rows[0].payload).toEqual({ _raw_text: '<html>502</html>' });
  });

  it('un cuerpo vacío con 200 es ausencia de dato, no fuente rota', async () => {
    const fetchImpl = vi.fn(async () => response(''));
    const gateway = new SourceGateway({ db, fetchImpl });

    for (let i = 0; i < 6; i += 1) {
      const result = await get(gateway);
      expect(result.ok === false && result.gap.reason).toBe('window_not_covered');
    }
    // Seis ausencias no abren el circuito: la fuente respondió las seis veces.
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(gateway.breaker('defillama').state()).toBe('closed');

    const { rows } = await db.query('select payload from source_snapshot limit 1');
    expect(rows[0].payload).toEqual({ _empty: true });
  });

  it('guarda el crudo de una respuesta de error', async () => {
    const gateway = new SourceGateway({
      db,
      fetchImpl: async () => response(JSON.stringify({ error: 'rate limit' }), 429),
    });
    const result = await get(gateway);
    expect(result.ok === false && result.gap.reason).toBe('rate_limited');
    expect((await db.query('select count(*)::int as n from source_snapshot')).rows[0].n).toBe(1);
  });
});

describe('degradación (NFR-020, M§3)', () => {
  it('un fallo de red es un valor de retorno, no una excepción', async () => {
    const gateway = new SourceGateway({
      db,
      fetchImpl: async () => {
        throw Object.assign(new Error('conexión rechazada'), { name: 'TypeError' });
      },
    });
    const result = await get(gateway);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.gap.reason).toBe('source_down');
    expect(result.ok === false && result.gap.detail).toContain('defillama:protocol:lido');
  });

  it('un timeout se declara como tal y no consume más que su presupuesto', async () => {
    const gateway = new SourceGateway({
      db,
      fetchImpl: async () => {
        throw Object.assign(new Error('agotado'), { name: 'TimeoutError' });
      },
    });
    const result = await get(gateway);
    expect(result.ok === false && result.gap.reason).toBe('timeout');
    expect((await db.query('select count(*)::int as n from source_snapshot')).rows[0].n).toBe(0);
  });

  it('tras cinco fallos deja de tocar la red', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error('caída'), { name: 'TypeError' });
    });
    const gateway = new SourceGateway({ db, fetchImpl });

    for (let i = 0; i < 5; i += 1) await get(gateway);
    expect(fetchImpl).toHaveBeenCalledTimes(5);

    const blocked = await get(gateway);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(blocked.ok === false && blocked.gap.reason).toBe('circuit_open');
  });
});

describe('coalescing en el camino real', () => {
  it('cien solicitudes concurrentes producen una llamada y un snapshot', async () => {
    const fetchImpl = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return response(JSON.stringify({ tvl: [] }));
    });
    const gateway = new SourceGateway({ db, fetchImpl });

    await Promise.all(Array.from({ length: 100 }, () => get(gateway)));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await db.query('select count(*)::int as n from source_snapshot')).rows[0].n).toBe(1);
  });
});
