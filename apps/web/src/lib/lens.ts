/**
 * Fuentes en vivo del lens, llamadas **desde el navegador**.
 *
 * DEX Screener y GeckoTerminal responden con `Access-Control-Allow-Origin: *`
 * (comprobado), así que este bloque del producto no necesita servidor. Lo que
 * sí necesita servidor —o mejor dicho, una clave— es la distribución de
 * tenedores: el RPC público de Solana devuelve 429 a la primera llamada. Eso no
 * se disimula: se declara.
 */
export interface LensPair {
  readonly dex: string;
  readonly url: string;
  readonly liquidityUsd: number | null;
  readonly volume24hUsd: number | null;
  readonly priceUsd: number | null;
  readonly createdAt: number | null;
}

export interface LensIdentity {
  readonly name: string;
  readonly symbol: string;
  readonly chain: string;
  readonly address: string;
}

export interface LensSnapshot {
  readonly identity: LensIdentity;
  readonly pairs: readonly LensPair[];
  readonly totalLiquidityUsd: number;
  readonly totalVolume24hUsd: number;
  readonly priceUsd: number | null;
  readonly fetchedAt: string;
}

const BUDGET_MS = 8_000;

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(BUDGET_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as unknown;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && Number.isFinite(Number(v))
      ? Number(v)
      : null;

/** Identidad, pares y liquidez. Es el bloque que más rápido llega. */
export async function fetchDexScreener(address: string): Promise<LensSnapshot> {
  const payload = (await getJson(
    `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`,
  )) as { pairs?: unknown };
  const raw = Array.isArray(payload.pairs) ? payload.pairs : [];
  if (raw.length === 0) throw new Error('sin pares para esta dirección');

  const pairs: LensPair[] = raw.map((entry) => {
    const p = entry as Record<string, unknown>;
    const liquidity = p['liquidity'] as Record<string, unknown> | undefined;
    const volume = p['volume'] as Record<string, unknown> | undefined;
    return {
      dex: String(p['dexId'] ?? 'desconocido'),
      url: String(p['url'] ?? ''),
      liquidityUsd: num(liquidity?.['usd']),
      volume24hUsd: num(volume?.['h24']),
      priceUsd: num(p['priceUsd']),
      createdAt: num(p['pairCreatedAt']),
    };
  });

  const first = raw[0] as Record<string, unknown>;
  const base = (first['baseToken'] ?? {}) as Record<string, unknown>;
  const sum = (get: (p: LensPair) => number | null): number =>
    pairs.reduce((total, p) => total + (get(p) ?? 0), 0);

  return {
    identity: {
      name: String(base['name'] ?? 'desconocido'),
      symbol: String(base['symbol'] ?? '?'),
      chain: String(first['chainId'] ?? 'desconocida'),
      address,
    },
    pairs: [...pairs].sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0)),
    totalLiquidityUsd: sum((p) => p.liquidityUsd),
    totalVolume24hUsd: sum((p) => p.volume24hUsd),
    priceUsd: pairs.find((p) => p.priceUsd !== null)?.priceUsd ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

/** Segunda opinión de precio: dos fuentes que discrepan es información. */
export async function fetchGeckoTerminal(
  network: string,
  address: string,
): Promise<{ priceUsd: number | null; fetchedAt: string }> {
  const payload = (await getJson(
    `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${encodeURIComponent(address)}`,
  )) as { data?: { attributes?: Record<string, unknown> } };
  return {
    priceUsd: num(payload.data?.attributes?.['price_usd']),
    fetchedAt: new Date().toISOString(),
  };
}

/** DEX Screener nombra las cadenas distinto que GeckoTerminal. */
export const geckoNetwork = (chainId: string): string | null =>
  ({ solana: 'solana', base: 'base', ethereum: 'eth', bsc: 'bsc' })[chainId] ?? null;

export interface RiskFlag {
  readonly label: string;
  readonly detail: string;
}

/**
 * Banderas evaluadas de oficio (M§22). Son **observaciones con umbral
 * declarado**, no un veredicto: cada una dice qué se midió y contra qué, y la
 * decisión sigue siendo del usuario (M§12).
 */
export function riskFlags(snapshot: LensSnapshot, now = Date.now()): RiskFlag[] {
  const flags: RiskFlag[] = [];

  if (snapshot.totalLiquidityUsd < 50_000) {
    flags.push({
      label: 'Liquidez baja',
      detail: `${Math.round(snapshot.totalLiquidityUsd).toLocaleString('es')} USD sumando todos los pares, por debajo del umbral de 50.000 en el que cualquier métrica de precio es ruido.`,
    });
  }
  if (snapshot.pairs.length <= 1) {
    flags.push({
      label: 'Un solo par',
      detail: 'Toda la liquidez depende de un único mercado; no hay contraste de precio.',
    });
  }

  const newest = snapshot.pairs.reduce<number | null>(
    (max, p) => (p.createdAt && (!max || p.createdAt > max) ? p.createdAt : max),
    null,
  );
  if (newest && now - newest < 7 * 86_400_000) {
    flags.push({
      label: 'Par reciente',
      detail: `El par más nuevo se creó hace menos de siete días (${new Date(newest).toISOString().slice(0, 10)}). No hay histórico contra el que comparar.`,
    });
  }

  const ratio =
    snapshot.totalLiquidityUsd > 0
      ? snapshot.totalVolume24hUsd / snapshot.totalLiquidityUsd
      : null;
  if (ratio !== null && ratio > 20) {
    flags.push({
      label: 'Volumen alto frente a liquidez',
      detail: `El volumen de 24 h es ${ratio.toFixed(1)} veces la liquidez. Es compatible con actividad real y también con volumen reciclado entre pocas direcciones; no distinguimos entre las dos.`,
    });
  }

  return flags;
}
