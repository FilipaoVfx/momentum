import type { Rating, SourceId } from '@momentum/core';

export interface ProviderConfig {
  readonly baseUrl: string;
  /** Alineado al límite de tasa contractual del proveedor, no a un número redondo. */
  readonly concurrency: number;
  /** Presupuesto por llamada en el plano frío. El caliente usa 1.200 ms (NFR-004). */
  readonly budgetMs: number;
  /**
   * Calificación Admiralty por defecto de la fuente (M§16). Es la fiabilidad de
   * *quien lo dice*; la credibilidad del dato concreto puede bajarla en el
   * adaptador si el payload lo justifica.
   */
  readonly rating: Rating;
}

export const PROVIDERS: Readonly<Record<SourceId, ProviderConfig>> = {
  // Datos on-chain agregados y públicamente auditables contra la cadena.
  defillama: {
    baseUrl: 'https://api.llama.fi',
    concurrency: 4,
    budgetMs: 8_000,
    rating: { reliability: 'A', credibility: 2 },
  },
  // Conversación abierta: fiable como registro de que algo se dijo, no de que
  // sea cierto. De ahí C3 y no algo mejor.
  reddit: {
    baseUrl: 'https://www.reddit.com',
    concurrency: 2,
    budgetMs: 8_000,
    rating: { reliability: 'C', credibility: 3 },
  },
  // Capital en riesgo: caro de fabricar, por eso pesa más aunque su cobertura
  // temática sea estrecha.
  polymarket: {
    baseUrl: 'https://gamma-api.polymarket.com',
    concurrency: 2,
    budgetMs: 8_000,
    rating: { reliability: 'B', credibility: 2 },
  },
};
