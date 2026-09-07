/**
 * Contrato entre el plano frío y el sitio.
 *
 * Está tipado aquí y lo importa el front, así que un cambio en el exportador
 * que rompa la página falla en `typecheck` y no en producción.
 */
import type { Axis, Quadrant } from '@momentum/core';

/**
 * Procedencia de un valor. No es metadata opcional: sin esto el número no se
 * exporta (M§2).
 */
export interface Provenance {
  readonly source: string;
  readonly method: string;
  readonly scoreVersion: string;
  readonly fetchedAt: string;
  readonly snapshotIds: readonly string[];
}

/**
 * La comparación que exige la primera de las tres preguntas: ¿comparado con
 * qué? Un valor absoluto no es información (M§1).
 */
export interface Comparison {
  /** Variación del valor en los últimos 7 días, en unidades de la serie. */
  readonly change7d: number | null;
  /** Posición entre las narrativas con dato en el mismo eje, 0–100. */
  readonly percentileAmongPeers: number | null;
  readonly peerCount: number;
}

export interface MeasuredValue {
  readonly value: number;
  readonly comparison: Comparison;
  readonly provenance: Provenance;
}

export interface DeclaredGap {
  readonly source: string;
  readonly reason: string;
  readonly detail: string;
  readonly narrativeSlug: string | null;
}

export interface SeriesPoint {
  readonly at: string;
  readonly value: number;
}

export interface QuadrantPeriod {
  readonly quadrant: Quadrant;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly attentionSlope: number;
  readonly fundamentalSlope: number;
}

export interface NarrativeSummary {
  readonly slug: string;
  readonly name: string;
  /** `null` cuando no hay puntos suficientes: no es lo mismo que "muerta". */
  readonly quadrant: Quadrant | null;
  readonly insufficientDataReason: string | null;
  readonly since: string | null;
  readonly attention: MeasuredValue | null;
  readonly fundamental: MeasuredValue | null;
  readonly origins: number;
  readonly mentions: number;
  /** Símbolos del diccionario, para que el lens resuelva un token a su relato. */
  readonly tickers: readonly string[];
  readonly gaps: readonly DeclaredGap[];
}

export interface Feed {
  readonly generatedAt: string;
  readonly scoreVersion: string;
  readonly narratives: readonly NarrativeSummary[];
}

export interface NarrativeDetail extends NarrativeSummary {
  readonly series: Readonly<Record<Axis, readonly SeriesPoint[]>>;
  readonly quadrantHistory: readonly QuadrantPeriod[];
  readonly entities: Readonly<Record<string, readonly string[]>>;
}

export interface SourceHealth {
  readonly source: string;
  readonly status: 'ok' | 'degraded' | 'down' | 'not_configured';
  readonly detail: string;
  readonly lastFetchedAt: string | null;
  readonly callsToday: number;
}

export interface Meta {
  readonly generatedAt: string;
  readonly lastRunAt: string | null;
  readonly scoreVersion: string;
  readonly sources: readonly SourceHealth[];
  readonly coverage: {
    readonly narratives: number;
    readonly withAttention: number;
    readonly withFundamental: number;
    readonly classified: number;
  };
}
