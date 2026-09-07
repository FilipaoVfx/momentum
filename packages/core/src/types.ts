/**
 * Tipos del dominio. Este paquete no hace E/S: no importa `pg`, no llama a la
 * red y no lee el reloj. Todo instante entra por parámetro.
 */

/** Los dos ejes independientes del cuadrante (SRS §4.3, FR-020). */
export type Axis = 'attention' | 'fundamental';

/** Ventana de agregación de una serie. */
export type WindowLabel = '1h' | '24h' | '48h' | '7d';

/** Cuadrante (SRS FR-021). Los nombres del README en su forma de identificador. */
export type Quadrant =
  | 'confirmed' // atención ↑ · fundamento ↑ — real, pero vas tarde
  | 'pure_narrative' // atención ↑ · fundamento plano — riesgo de techo
  | 'quiet_build' // atención plana · fundamento ↑ — construcción silenciosa
  | 'dead'; // atención plana · fundamento plano

export type SourceId = 'defillama' | 'reddit' | 'polymarket';

/**
 * Motivo por el que una parte de la recolección no ocurrió. Se declara siempre
 * (M§23, FR-014): sin denominador no hay porcentaje.
 */
export type GapReason =
  | 'source_down'
  | 'timeout'
  | 'rate_limited'
  | 'circuit_open'
  | 'parse_failed'
  | 'window_not_covered'
  | 'not_configured';

export interface CollectionGap {
  readonly source: SourceId;
  readonly reason: GapReason;
  readonly detail: string;
  readonly narrativeSlug?: string;
  readonly windowStart?: Date;
  readonly windowEnd?: Date;
}

/**
 * Un fallo de fuente es un valor de retorno, no una excepción. Es lo que hace
 * que la degradación parcial sea el camino normal del código (M§3, NFR-020).
 */
export type SourceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly gap: CollectionGap };

export const ok = <T>(value: T): SourceResult<T> => ({ ok: true, value });
export const gap = <T>(g: CollectionGap): SourceResult<T> => ({ ok: false, gap: g });

/** Clase de señal de atención, ordenada por costo de fabricación (M§5). */
export type SignalKind =
  | 'prediction_market_position' // capital en riesgo
  | 'reddit_post'
  | 'reddit_comment';

/**
 * Una mención ya resuelta a su publicación raíz. `rootOriginKey` es la clave de
 * deduplicación: cuarenta cuentas citando un hilo comparten una sola (M§17).
 */
export interface MentionEvent {
  readonly source: SourceId;
  readonly narrativeSlug: string;
  readonly rootOriginKey: string;
  readonly replicatorKey: string;
  readonly observedAt: Date;
  readonly signalKind: SignalKind;
  /** `null` = no lo sabemos. Nunca se sustituye por un valor por defecto. */
  readonly authorHasHistory: boolean | null;
  /** Magnitud cruda de la señal (USD en riesgo, votos, etc.). Solo informativa. */
  readonly magnitude: number;
  readonly snapshotId: string;
}

/** Observación de fundamento on-chain para una entidad de la narrativa. */
export interface FundamentalObservation {
  readonly source: SourceId;
  readonly narrativeSlug: string;
  readonly entity: string;
  readonly observedAt: Date;
  readonly tvlUsd: number | null;
  readonly fees24hUsd: number | null;
  readonly volume24hUsd: number | null;
  readonly snapshotId: string;
}

/** Punto de serie. Nunca existe sin `scoreVersion` ni sin sus insumos (M§2, M§7). */
export interface MetricPoint {
  readonly narrativeSlug: string;
  readonly axis: Axis;
  readonly window: WindowLabel;
  readonly observedAt: Date;
  readonly value: number;
  readonly scoreVersion: string;
  readonly inputSnapshotIds: readonly string[];
}
