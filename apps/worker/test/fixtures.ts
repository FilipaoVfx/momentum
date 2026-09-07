import type { Dictionary } from '../src/dictionary.ts';

export const DICTIONARY: Dictionary = {
  version: 'test',
  narratives: [
    {
      slug: 'liquid-staking',
      name: 'Liquid staking',
      entities: {
        defillama: ['lido'],
        subreddits: ['ethstaker'],
        polymarket_tags: ['ethereum'],
        tickers: ['LDO'],
      },
    },
    {
      slug: 'solana-defi',
      name: 'DeFi en Solana',
      entities: {
        defillama: ['raydium-amm'],
        subreddits: [],
        polymarket_tags: ['solana'],
        tickers: ['RAY'],
      },
    },
  ],
};

export const BASE = new Date('2026-01-10T00:00:00Z');
/** Instante fijo de publicación: un post tiene una hora de creación, no una por corrida. */
const POSTED_AT = Math.floor((BASE.getTime() - 3_600_000) / 1000);

/**
 * Una campaña coordinada: cuarenta cuentas distintas citando el mismo hilo, más
 * un envío orgánico. A ojo de un contador de menciones son cuarenta y uno; a
 * ojo del linaje son dos.
 */
export const redditListing = (): unknown => ({
  data: {
    children: [
      ...Array.from({ length: 40 }, (_, i) => ({
        data: {
          name: `t3_replica${i}`,
          permalink: `/r/ethstaker/comments/replica${i}/`,
          url: 'https://www.reddit.com/r/ethstaker/comments/root/',
          is_self: false,
          crosspost_parent: 't3_root',
          author: `cuenta_nueva_${i}`,
          created_utc: POSTED_AT,
          ups: 3,
          num_comments: 0,
        },
      })),
      {
        data: {
          name: 't3_organico',
          permalink: '/r/ethstaker/comments/organico/',
          url: 'https://www.reddit.com/r/ethstaker/comments/organico/',
          is_self: true,
          author: 'usuario_con_historial',
          created_utc: POSTED_AT,
          ups: 120,
          num_comments: 44,
        },
      },
    ],
  },
});

export interface NetworkOptions {
  /** Fuentes que responden 500 en esta corrida. */
  readonly down?: readonly ('defillama' | 'reddit' | 'polymarket')[];
  /**
   * Si es `false`, el volumen de los mercados se queda quieto. Sirve para
   * fabricar el caso de construcción silenciosa: fundamento que crece sin que
   * nadie esté mirando todavía.
   */
  readonly attentionGrows?: boolean;
}

/**
 * Red falsa determinista. El TVL y el volumen crecen con el reloj para que las
 * series tengan pendiente; las menciones no, para que la deduplicación se note.
 */
export function fakeNetwork(clock: () => Date, options: NetworkOptions = {}): typeof fetch {
  const down = new Set(options.down ?? []);
  const attentionGrows = options.attentionGrows ?? true;
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const hours = (clock().getTime() - BASE.getTime()) / 3_600_000;

    if (url.includes('/api/v1/access_token')) {
      return json({ access_token: 'token-de-prueba', expires_in: 3600 });
    }
    if (url.startsWith('https://oauth.reddit.com')) {
      if (down.has('reddit')) return json({ error: 'down' }, 500);
      return json(redditListing());
    }
    if (url.startsWith('https://api.llama.fi')) {
      if (down.has('defillama')) return json({ error: 'down' }, 500);
      if (url.includes('/overview/fees')) {
        return json({ protocols: [{ slug: 'lido', total24h: 50_000 + hours * 1_000 }] });
      }
      if (url.includes('/overview/dexs')) {
        return json({ protocols: [{ slug: 'raydium-amm', total24h: 900_000 + hours * 10_000 }] });
      }
      const slug = url.split('/tvl/')[1] ?? '';
      // `/tvl/{slug}` devuelve un número suelto, no un objeto.
      return json(slug === 'lido' ? 20e9 + hours * 1e8 : 1e9 + hours * 1e7);
    }
    if (url.startsWith('https://gamma-api.polymarket.com')) {
      if (down.has('polymarket')) return json({ error: 'down' }, 500);
      return json([
        {
          id: '900001',
          question: 'Will Ethereum staking yield exceed 4% in 2026?',
          slug: 'ethereum-staking-yield-2026',
          volume24hr: 250_000 + (attentionGrows ? hours * 5_000 : 0),
          updatedAt: clock().toISOString(),
        },
        {
          id: '900002',
          question: 'Will Solana process 100k TPS before July?',
          slug: 'solana-tps-100k',
          volume24hr: 80_000 + (attentionGrows ? hours * 2_000 : 0),
          updatedAt: clock().toISOString(),
        },
      ]);
    }
    throw new Error(`URL no prevista en la red falsa: ${url}`);
  }) as typeof fetch;
}

export const CREDENTIALS = {
  clientId: 'id-de-prueba',
  clientSecret: 'secreto-de-prueba',
  userAgent: 'momentum/test',
};
