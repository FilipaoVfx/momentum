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

/** DefiLlama mezcla `Lido`, `lido` y `lido-finance` según el endpoint. */
export const normalizeSlug = (slug: string): string =>
  slug.trim().toLowerCase().replace(/\s+/g, '-');
