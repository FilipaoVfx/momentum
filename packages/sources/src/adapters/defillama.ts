import type { SourceResult } from '@momentum/core';
import type { FetchedSnapshot, SourceGateway } from '../gateway.ts';

/**
 * DefiLlama — eje de fundamento.
 *
 * Dos formas de llamada, elegidas por costo de cuota (NFR-060): el TVL se pide
 * por protocolo, pero las comisiones y el volumen se piden **una vez por
 * corrida** para todo el universo y se cruzan localmente. Diez narrativas más
 * no añaden diez llamadas de fees.
 */

export const requestKeys = {
  protocol: (slug: string) => `defillama:protocol:${slug}`,
  // Se conserva por si hiciera falta releer snapshots antiguos capturados con
  // el endpoint pesado; la ingesta ya no lo usa.
  history: (slug: string) => `defillama:history:${slug}`,
  feesHistory: (slug: string) => `defillama:history-fees:${slug}`,
  dexsHistory: (slug: string) => `defillama:history-dexs:${slug}`,
  feesOverview: () => 'defillama:overview:fees',
  dexsOverview: () => 'defillama:overview:dexs',
} as const;

/**
 * TVL actual de un protocolo.
 *
 * Se usa `/tvl/{slug}`, que devuelve un único número, y no `/protocol/{slug}`,
 * que arrastra la serie histórica completa: medido contra las 15 narrativas del
 * diccionario, el endpoint pesado son 112 MB por corrida —unos 10 GB al día a
 * cadencia de 15 minutos— para quedarnos con el último valor. El histórico ya
 * lo construimos nosotros, snapshot a snapshot.
 */
export function fetchProtocol(
  gateway: SourceGateway,
  slug: string,
): Promise<SourceResult<FetchedSnapshot>> {
  return gateway.get({
    source: 'defillama',
    path: `/tvl/${encodeURIComponent(slug)}`,
    requestKey: requestKeys.protocol(slug),
  });
}

/**
 * Serie histórica completa de un protocolo.
 *
 * Usa `/protocol/{slug}`, el endpoint pesado que la ingesta evita a propósito
 * (2 MB por protocolo). Aquí compensa: se paga una sola vez y da los 14 días de
 * fundamento que el eje necesita para que una pendiente signifique algo. La
 * ingesta periódica sigue usando `/tvl/{slug}`.
 */
export function fetchProtocolHistory(
  gateway: SourceGateway,
  slug: string,
): Promise<SourceResult<FetchedSnapshot>> {
  return gateway.get({
    source: 'defillama',
    path: `/protocol/${encodeURIComponent(slug)}`,
    requestKey: requestKeys.history(slug),
    budgetMs: 30_000,
  });
}

/**
 * Historia diaria de comisiones y de volumen.
 *
 * Sin estas dos, el backfill produciría una serie de solo TVL empalmada con una
 * serie viva de tres componentes: el escalón del empalme no sería un cambio del
 * fundamento, sería un cambio de lo que estamos midiendo. Un gráfico así miente
 * aunque cada punto por separado sea cierto.
 */
export function fetchFeesHistory(
  gateway: SourceGateway,
  slug: string,
): Promise<SourceResult<FetchedSnapshot>> {
  return gateway.get({
    source: 'defillama',
    path: `/summary/fees/${encodeURIComponent(slug)}?dataType=dailyFees`,
    requestKey: requestKeys.feesHistory(slug),
    budgetMs: 30_000,
  });
}

export function fetchDexsHistory(
  gateway: SourceGateway,
  slug: string,
): Promise<SourceResult<FetchedSnapshot>> {
  return gateway.get({
    source: 'defillama',
    path: `/summary/dexs/${encodeURIComponent(slug)}`,
    requestKey: requestKeys.dexsHistory(slug),
    budgetMs: 30_000,
  });
}

export function fetchFeesOverview(gateway: SourceGateway): Promise<SourceResult<FetchedSnapshot>> {
  return gateway.get({
    source: 'defillama',
    path: '/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true',
    requestKey: requestKeys.feesOverview(),
  });
}

export function fetchDexsOverview(gateway: SourceGateway): Promise<SourceResult<FetchedSnapshot>> {
  return gateway.get({
    source: 'defillama',
    path: '/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true',
    requestKey: requestKeys.dexsOverview(),
  });
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const asFiniteNumber = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * TVL de un snapshot de DefiLlama. Acepta las dos formas que hemos capturado
 * alguna vez —el número suelto de `/tvl/{slug}` y la serie de
 * `/protocol/{slug}`— porque el replay tiene que poder leer la historia entera,
 * incluida la que se capturó con el endpoint anterior.
 *
 * Devuelve `null` si el payload no lo trae: un hueco declarado, no un cero.
 */
export function parseProtocolTvl(payload: unknown): number | null {
  const direct = asFiniteNumber(payload);
  if (direct !== null) return direct;

  const root = asRecord(payload);
  if (!root) return null;
  const series = root['tvl'];
  if (Array.isArray(series) && series.length > 0) {
    const last = asRecord(series.at(-1));
    const value = asFiniteNumber(last?.['totalLiquidityUSD']);
    if (value !== null) return value;
  }
  return asFiniteNumber(root['tvl']);
}

/** `{ slug → total24h }` a partir de un payload de `/overview/{fees,dexs}`. */
export function parseOverviewTotals(payload: unknown): Map<string, number> {
  const root = asRecord(payload);
  const protocols = root?.['protocols'];
  const totals = new Map<string, number>();
  if (!Array.isArray(protocols)) return totals;
  for (const entry of protocols) {
    const p = asRecord(entry);
    if (!p) continue;
    const total = asFiniteNumber(p['total24h']);
    if (total === null) continue;
    for (const key of [p['slug'], p['module'], p['name']]) {
      if (typeof key === 'string' && key.length > 0) totals.set(normalizeSlug(key), total);
    }
  }
  return totals;
}

export interface HistoricalTvlPoint {
  readonly at: Date;
  readonly tvlUsd: number;
}

/** Serie `tvl[]` de `/protocol/{slug}`, con las fechas en su instante real. */
export function parseProtocolHistory(payload: unknown): HistoricalTvlPoint[] {
  const root = asRecord(payload);
  const series = root?.['tvl'];
  if (!Array.isArray(series)) return [];
  const points: HistoricalTvlPoint[] = [];
  for (const entry of series) {
    const p = asRecord(entry);
    const date = asFiniteNumber(p?.['date']);
    const value = asFiniteNumber(p?.['totalLiquidityUSD']);
    if (date === null || value === null) continue;
    points.push({ at: new Date(date * 1000), tvlUsd: value });
  }
  return points;
}

/** Serie `totalDataChart` de `/summary/{fees,dexs}/{slug}`: pares [epoch, valor]. */
export function parseSummaryHistory(payload: unknown): HistoricalTvlPoint[] {
  const chart = asRecord(payload)?.['totalDataChart'];
  if (!Array.isArray(chart)) return [];
  const points: HistoricalTvlPoint[] = [];
  for (const entry of chart) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const at = asFiniteNumber(entry[0]);
    const value = asFiniteNumber(entry[1]);
    if (at === null || value === null) continue;
    points.push({ at: new Date(at * 1000), tvlUsd: value });
  }
  return points;
}

/** DefiLlama mezcla `Lido`, `lido` y `lido-finance` según el endpoint. */
export const normalizeSlug = (slug: string): string =>
  slug.trim().toLowerCase().replace(/\s+/g, '-');
