import { describe, expect, it } from 'vitest';
import { defillama, polymarket, reddit } from '../src/index.ts';

describe('DefiLlama', () => {
  it('lee el número suelto de /tvl/{slug}', () => {
    expect(defillama.parseProtocolTvl(24_260_650_933.32)).toBeCloseTo(24_260_650_933.32, 2);
  });

  it('sigue leyendo los snapshots antiguos con la serie completa', () => {
    expect(
      defillama.parseProtocolTvl({ tvl: [{ totalLiquidityUSD: 1 }, { totalLiquidityUSD: 7 }] }),
    ).toBe(7);
  });

  it('un payload sin TVL da null, no cero', () => {
    expect(defillama.parseProtocolTvl({ mensaje: 'no encontrado' })).toBeNull();
    expect(defillama.parseProtocolTvl(null)).toBeNull();
  });

  it('indexa el agregado por slug, módulo y nombre', () => {
    const totals = defillama.parseOverviewTotals({
      protocols: [{ slug: 'lido', module: 'lido', name: 'Lido', total24h: 5 }],
    });
    expect(totals.get('lido')).toBe(5);
    expect(totals.get(defillama.normalizeSlug('Lido'))).toBe(5);
  });

  it('un protocolo sin total24h no entra con un cero inventado', () => {
    const totals = defillama.parseOverviewTotals({ protocols: [{ slug: 'x', total24h: null }] });
    expect(totals.has('x')).toBe(false);
  });
});

describe('Reddit', () => {
  it('ignora entradas sin identidad o sin instante', () => {
    const posts = reddit.parseListing({
      data: { children: [{ data: { name: 't3_a' } }, { data: { created_utc: 1 } }] },
    });
    expect(posts).toHaveLength(0);
  });

  it('no inventa el historial del autor', () => {
    const posts = reddit.parseListing({
      data: { children: [{ data: { name: 't3_a', created_utc: 1_760_000_000, ups: 4 } }] },
    });
    expect(posts[0]!.ups).toBe(4);
    expect(posts[0]!.createdAt.getTime()).toBe(1_760_000_000_000);
  });

  it('tolera un payload que no es un listado', () => {
    expect(reddit.parseListing({ error: 403 })).toEqual([]);
  });
});

describe('Polymarket', () => {
  it('lee volumen numérico y en texto', () => {
    const markets = polymarket.parseMarkets([
      { id: 1, question: 'q', slug: 's', volume24hr: '1234.5' },
      { id: '2', question: 'q2', slug: 's2', volume24hr: 10 },
    ]);
    expect(markets.map((m) => m.volume24hUsd)).toEqual([1234.5, 10]);
    expect(markets[0]!.id).toBe('1');
  });

  it('un payload de error no produce mercados fantasma', () => {
    expect(polymarket.parseMarkets({ error: 'down' })).toEqual([]);
  });
});

describe('universo de Polymarket', () => {
  it('pide los mercados de cripto, no los de mayor volumen del sitio', async () => {
    const calls: string[] = [];
    const gateway = {
      get: async (opts: { path: string }) => {
        calls.push(opts.path);
        return { ok: true as const, value: {} as never };
      },
    };
    await polymarket.fetchTopMarkets(gateway as never);
    expect(calls[0]).toContain(`tag_id=${polymarket.CRYPTO_TAG_ID}`);
  });
});
