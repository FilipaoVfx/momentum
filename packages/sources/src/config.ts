import type { Rating, SourceId } from '@momentum/core';

export interface ProviderConfig {
  readonly baseUrl: string;
  /** Alineado al límite de tasa contractual del proveedor, no a un número redondo. */
  readonly concurrency: number;
  /**
   * Techo de llamadas por minuto. Ninguno de los tres proveedores publica el
   * suyo, así que estos valores son una apuesta conservadora, no un dato: se
   * suben con evidencia de que aguantan, nunca por optimismo.
   */
  readonly requestsPerMinute: number;
  /** Presupuesto diario. Agotado, no se toca la red y se declara la brecha. */
  readonly dailyBudget: number;
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
    // 53 protocolos + 2 agregados por corrida horaria = 55 llamadas/hora.
    // El techo deja margen para un barrido puntual sin acercarse a lo que
    // Cloudflare pueda considerar abuso.
    requestsPerMinute: 60,
    dailyBudget: 4_000,
    budgetMs: 8_000,
    rating: { reliability: 'A', credibility: 2 },
  },
  // Conversación abierta: fiable como registro de que algo se dijo, no de que
  // sea cierto. De ahí C3 y no algo mejor.
  reddit: {
    baseUrl: 'https://www.reddit.com',
    concurrency: 2,
    // Reddit documenta 100 peticiones por minuto por cliente OAuth. Nos
    // quedamos en la mitad: 11 subreddits cada 15 minutos son 44 por hora.
    requestsPerMinute: 50,
    dailyBudget: 2_000,
    budgetMs: 8_000,
    rating: { reliability: 'C', credibility: 3 },
  },
  // Capital en riesgo: caro de fabricar, por eso pesa más aunque su cobertura
  // temática sea estrecha.
  polymarket: {
    baseUrl: 'https://gamma-api.polymarket.com',
    concurrency: 2,
    // Una llamada por corrida. El techo existe por si M2 empieza a consultar
    // mercados por narrativa, no por el consumo de hoy.
    requestsPerMinute: 30,
    dailyBudget: 1_000,
    budgetMs: 8_000,
    rating: { reliability: 'B', credibility: 2 },
  },
};
