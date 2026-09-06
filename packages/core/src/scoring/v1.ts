import type {
  Axis,
  FundamentalObservation,
  MentionEvent,
  MetricPoint,
  SignalKind,
  WindowLabel,
} from '../types.ts';

/** Toda fila producida por este pipeline la lleva (FR-051, M§9). */
export const SCORE_VERSION = 'v1';

/**
 * Ponderación por costo de fabricación (M§5, FR-031).
 *
 * El criterio no es cuánta gente lo dijo, sino cuánto le costó decirlo. Una
 * posición en un mercado de predicción arriesga capital; un comentario cuesta
 * tiempo; una cuenta recién creada no cuesta casi nada. Si estos pesos fueran
 * iguales "por simplicidad", tendríamos un detector de campañas de marketing.
 *
 * `authorHasHistory === null` (no lo sabemos) cae en la rama sin historial: ante
 * la duda, el peso bajo. Suponer historial sería rellenar un hueco con una
 * suposición (M§4).
 */
export const ATTENTION_WEIGHTS: Readonly<Record<SignalKind, { withHistory: number; withoutHistory: number }>> = {
  // Capital en riesgo: el historial del autor es irrelevante frente al dinero.
  prediction_market_position: { withHistory: 1.0, withoutHistory: 1.0 },
  reddit_post: { withHistory: 0.35, withoutHistory: 0.08 },
  reddit_comment: { withHistory: 0.15, withoutHistory: 0.03 },
};

/**
 * Pesos del eje de fundamento. Las comisiones y el volumen son ingresos que
 * alguien pagó; el TVL se puede inflar haciendo circular capital propio en
 * bucle (M§22), así que pesa menos que las dos señales que cuestan dinero.
 */
export const FUNDAMENTAL_WEIGHTS = {
  fees24hUsd: 0.5,
  volume24hUsd: 0.3,
  tvlUsd: 0.2,
} as const;

/**
 * Tipo de cambio explícito entre "una voz" y "dinero en riesgo": mil dólares de
 * volumen en 24 h equivalen a un origen social con historial.
 *
 * Es una suposición discutible, y por eso está aquí con nombre y número en vez
 * de disuelta en una fórmula. Va atada a `SCORE_VERSION`: cambiarla obliga a
 * versionar el score, que es exactamente lo que queremos que cueste.
 */
export const PREDICTION_MARKET_USD_PER_ORIGIN = 1_000;

/**
 * Peso de una mención concreta.
 *
 * Para una señal social, el peso lo fija el costo de fabricarla. Para un mercado
 * de predicción, lo fija el capital expuesto: un mercado con cien dólares de
 * volumen no dice lo mismo que uno con un millón, y contarlos igual sería tirar
 * la única señal cara que tenemos.
 */
export function attentionWeight(event: MentionEvent): number {
  const w = ATTENTION_WEIGHTS[event.signalKind];
  if (event.signalKind === 'prediction_market_position') {
    const dollars = Math.max(0, event.magnitude);
    return (
      w.withHistory * (Math.log1p(dollars) / Math.log1p(PREDICTION_MARKET_USD_PER_ORIGIN))
    );
  }
  return event.authorHasHistory === true ? w.withHistory : w.withoutHistory;
}

/**
 * Escala logarítmica en ambos ejes.
 *
 * Dos razones, no una preferencia estética: (1) permite sumar magnitudes de
 * órdenes distintos —TVL de 1e9 junto a comisiones de 1e5— sin que la mayor
 * borre a la menor; (2) hace que la pendiente de la serie sea una tasa de
 * crecimiento relativo, comparable entre narrativas de tamaños muy distintos.
 * El ranking se basa en la derivada, no en el nivel (FR-011).
 */
const scale = (x: number): number => Math.log1p(Math.max(0, x));

export interface WindowSpec {
  readonly window: WindowLabel;
  readonly durationMs: number;
}

export const WINDOWS: readonly WindowSpec[] = [
  { window: '1h', durationMs: 60 * 60 * 1000 },
  { window: '24h', durationMs: 24 * 60 * 60 * 1000 },
  { window: '7d', durationMs: 7 * 24 * 60 * 60 * 1000 },
];

/**
 * Atención de una narrativa en una ventana.
 *
 * Deduplicación por origen (M§17, FR-012): se agrupa por `rootOriginKey` y cada
 * origen aporta **una** observación, con el peso de su réplica más cara. Las
 * cuarenta cuentas que citan el mismo hilo suman una vez, no cuarenta. El conteo
 * de réplicas no entra en el score; se guarda aparte para el resumen de impulso.
 */
export function computeAttention(
  narrativeSlug: string,
  events: readonly MentionEvent[],
  windowEnd: Date,
  spec: WindowSpec,
): MetricPoint | null {
  const windowStart = new Date(windowEnd.getTime() - spec.durationMs);
  const inWindow = events.filter(
    (e) =>
      e.narrativeSlug === narrativeSlug &&
      e.observedAt > windowStart &&
      e.observedAt <= windowEnd,
  );
  if (inWindow.length === 0) return null;

  const bestByOrigin = new Map<string, MentionEvent>();
  for (const e of inWindow) {
    const current = bestByOrigin.get(e.rootOriginKey);
    if (!current || attentionWeight(e) > attentionWeight(current)) {
      bestByOrigin.set(e.rootOriginKey, e);
    }
  }

  let total = 0;
  const snapshotIds = new Set<string>();
  for (const e of bestByOrigin.values()) {
    total += attentionWeight(e);
    snapshotIds.add(e.snapshotId);
  }

  return {
    narrativeSlug,
    axis: 'attention' satisfies Axis,
    window: spec.window,
    observedAt: windowEnd,
    value: scale(total),
    scoreVersion: SCORE_VERSION,
    inputSnapshotIds: [...snapshotIds].sort(),
  };
}

/**
 * Fundamento de una narrativa en una ventana: la observación más reciente por
 * entidad dentro de la ventana, sumada en escala logarítmica.
 *
 * Un campo nulo se omite del agregado y no se sustituye por cero ni por el valor
 * de la corrida anterior (FR-005, M§4). Si todas las entidades vienen sin dato,
 * no hay punto: se devuelve `null` y quien llama declara la brecha.
 */
export function computeFundamental(
  narrativeSlug: string,
  observations: readonly FundamentalObservation[],
  windowEnd: Date,
  spec: WindowSpec,
): MetricPoint | null {
  const windowStart = new Date(windowEnd.getTime() - spec.durationMs);
  const inWindow = observations.filter(
    (o) =>
      o.narrativeSlug === narrativeSlug &&
      o.observedAt > windowStart &&
      o.observedAt <= windowEnd,
  );
  if (inWindow.length === 0) return null;

  // El valor más reciente **por campo**, no por observación: el TVL llega del
  // endpoint del protocolo y las comisiones del agregado del día, en snapshots
  // distintos. Quedarse con "la observación más reciente" descartaría la mitad
  // de los ejes por un detalle de cómo se piden los datos.
  type FieldName = keyof typeof FUNDAMENTAL_WEIGHTS;
  const latest = new Map<string, { at: Date; value: number; snapshotId: string }>();
  for (const o of inWindow) {
    for (const field of Object.keys(FUNDAMENTAL_WEIGHTS) as FieldName[]) {
      const raw = o[field];
      if (raw === null || !Number.isFinite(raw)) continue;
      const key = `${o.entity}\u0000${field}`;
      const current = latest.get(key);
      if (!current || o.observedAt > current.at) {
        latest.set(key, { at: o.observedAt, value: raw, snapshotId: o.snapshotId });
      }
    }
  }
  if (latest.size === 0) return null;

  let total = 0;
  const snapshotIds = new Set<string>();
  for (const [key, entry] of latest) {
    const field = key.split('\u0000')[1] as FieldName;
    total += FUNDAMENTAL_WEIGHTS[field] * scale(entry.value);
    snapshotIds.add(entry.snapshotId);
  }

  return {
    narrativeSlug,
    axis: 'fundamental' satisfies Axis,
    window: spec.window,
    observedAt: windowEnd,
    value: total,
    scoreVersion: SCORE_VERSION,
    inputSnapshotIds: [...snapshotIds].sort(),
  };
}
