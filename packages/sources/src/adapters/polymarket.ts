import type { SourceResult } from '@momentum/core';
import type { FetchedSnapshot, SourceGateway } from '../gateway.ts';

/**
 * Polymarket — atención respaldada por capital en riesgo.
 *
 * Es la señal más cara de fabricar de las tres fuentes del MVP: mover el
 * volumen de un mercado cuesta dinero real y perderlo es el modo de falla
 * normal. Por eso pondera distinto (M§5), no porque sea "más de moda".
 *
 * Una sola llamada por corrida para todo el universo: los mercados se cruzan
 * localmente contra las etiquetas del diccionario.
 */

export const requestKeys = { topMarkets: () => 'polymarket:markets:top' } as const;

/**
 * Etiqueta «Crypto» del catálogo de Polymarket.
 *
 * Sin este filtro pedíamos los mercados de mayor volumen del sitio entero, y
 * medido en una corrida real eso devolvía cien mercados de política europea y
 * cero señal para nuestras narrativas. El volumen global no es nuestro
 * universo; el de cripto sí.
 */
export const CRYPTO_TAG_ID = 21;

export function fetchTopMarkets(
  gateway: SourceGateway,
  limit = 200,
): Promise<SourceResult<FetchedSnapshot>> {
  return gateway.get({
    source: 'polymarket',
    path:
      `/markets?active=true&closed=false&order=volume24hr&ascending=false` +
      `&limit=${limit}&tag_id=${CRYPTO_TAG_ID}`,
    requestKey: requestKeys.topMarkets(),
  });
}

export interface PolymarketMarket {
  readonly id: string;
  readonly question: string;
  readonly slug: string;
  readonly volume24hUsd: number;
  readonly updatedAt: Date | null;
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const asNumber = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
};

export function parseMarkets(payload: unknown): PolymarketMarket[] {
  const list = Array.isArray(payload) ? payload : (asRecord(payload)?.['data'] ?? null);
  if (!Array.isArray(list)) return [];

  const markets: PolymarketMarket[] = [];
  for (const entry of list) {
    const m = asRecord(entry);
    if (!m) continue;
    const id = m['id'];
    if (typeof id !== 'string' && typeof id !== 'number') continue;
    const updatedRaw = m['updatedAt'];
    const updatedAt = typeof updatedRaw === 'string' ? new Date(updatedRaw) : null;
    markets.push({
      id: String(id),
      question: typeof m['question'] === 'string' ? m['question'] : '',
      slug: typeof m['slug'] === 'string' ? m['slug'] : '',
      volume24hUsd: asNumber(m['volume24hr']),
      updatedAt: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : null,
    });
  }
  return markets;
}
