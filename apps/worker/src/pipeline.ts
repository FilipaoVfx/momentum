import type { CollectionGap, MetricPoint } from '@momentum/core';
import {
  AXIS_WINDOW,
  SCORE_VERSION,
  classifyQuadrant,
  computeAttention,
  computeFundamental,
  windowSpec,
} from '@momentum/core';
import {
  insertFundamentals,
  insertMentions,
  insertMetricPoints,
  listFundamentals,
  listMentions,
  listMetricPoints,
  recordQuadrant,
  withTransaction,
  type Db,
  type NarrativeRecord,
  type StoredSnapshot,
} from '@momentum/db';
import { deriveAll } from './derive.ts';
import type { DictionaryIndex } from './dictionary.ts';

/** Una ventana por eje: las fuentes de cada uno no publican al mismo ritmo. */
export const ATTENTION_WINDOW = windowSpec(AXIS_WINDOW.attention);
export const FUNDAMENTAL_WINDOW = windowSpec(AXIS_WINDOW.fundamental);
/** Horizonte sobre el que se mide la pendiente (FR-011: derivada, no nivel). */
export const SLOPE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export type QuadrantOutcome =
  | 'unchanged'
  | 'opened'
  | 'transitioned'
  | 'insufficient_data'
  | 'out_of_order'
  | 'skipped';

export interface BatchResult {
  readonly windowEnd: Date;
  readonly mentionsInserted: number;
  readonly fundamentalsInserted: number;
  readonly pointsWritten: number;
  readonly quadrants: Record<string, QuadrantOutcome>;
  readonly gaps: CollectionGap[];
}

/**
 * Procesa un lote de snapshots que pertenecen a la misma corrida.
 *
 * Es el único camino que escribe series, lo use la corrida en vivo o el replay.
 * `windowEnd` viene del lote (el instante del último snapshot), no del reloj:
 * por eso una reconstrucción produce las mismas ventanas que la corrida
 * original en vez de unas nuevas desplazadas.
 */
export async function processBatch(input: {
  readonly db: Db;
  readonly index: DictionaryIndex;
  readonly narratives: readonly NarrativeRecord[];
  readonly snapshots: readonly StoredSnapshot[];
  readonly windowEnd: Date;
  readonly scoreVersion?: string;
  /**
   * Si es `false`, se recalculan las series pero no se toca la clasificación.
   * El replay lo usa: `quadrant_state` es el registro de lo que dijimos en su
   * momento y `outcome` mide exactamente eso. Reescribirlo al recalcular
   * borraría nuestra propia tasa de acierto (M§14).
   */
  readonly classify?: boolean;
}): Promise<BatchResult> {
  const { db, index, narratives, snapshots, windowEnd } = input;
  const scoreVersion = input.scoreVersion ?? SCORE_VERSION;
  const idBySlug = new Map(narratives.map((n) => [n.slug, n.id]));
  const gaps: CollectionGap[] = [];

  const derived = deriveAll(snapshots, index);

  const { mentionsInserted, fundamentalsInserted } = await withTransaction(db, async (tx) => ({
    mentionsInserted: await insertMentions(tx, idBySlug, derived.mentions),
    fundamentalsInserted: await insertFundamentals(tx, idBySlug, derived.fundamentals),
  }));

  // La ventana se lee de la base, no del lote: la serie de las últimas 24 h
  // incluye lo que trajeron las corridas anteriores, que es justo el punto.
  const attentionStart = new Date(windowEnd.getTime() - ATTENTION_WINDOW.durationMs);
  const fundamentalStart = new Date(windowEnd.getTime() - FUNDAMENTAL_WINDOW.durationMs);
  const [mentions, fundamentals] = await Promise.all([
    listMentions(db, { since: attentionStart, until: windowEnd }),
    listFundamentals(db, { since: fundamentalStart, until: windowEnd }),
  ]);

  const points: MetricPoint[] = [];
  for (const narrative of narratives) {
    const attention = computeAttention(narrative.slug, mentions, windowEnd, ATTENTION_WINDOW);
    const fundamental = computeFundamental(
      narrative.slug,
      fundamentals,
      windowEnd,
      FUNDAMENTAL_WINDOW,
    );
    if (attention) points.push(attention);
    if (fundamental) points.push(fundamental);

    // Un eje sin ningún dato en la ventana no vale cero: vale "no lo vimos".
    if (!attention) {
      gaps.push({
        source: 'reddit',
        reason: 'window_not_covered',
        detail: `sin menciones para ${narrative.slug} en la ventana de ${ATTENTION_WINDOW.window}`,
        narrativeSlug: narrative.slug,
        windowStart: attentionStart,
        windowEnd,
      });
    }
    if (!fundamental) {
      gaps.push({
        source: 'defillama',
        reason: 'window_not_covered',
        detail: `sin fundamento para ${narrative.slug} en la ventana de ${FUNDAMENTAL_WINDOW.window}`,
        narrativeSlug: narrative.slug,
        windowStart: fundamentalStart,
        windowEnd,
      });
    }
  }

  const pointsWritten = await withTransaction(db, (tx) =>
    insertMetricPoints(tx, idBySlug, points),
  );

  const quadrants =
    input.classify === false
      ? Object.fromEntries(narratives.map((n) => [n.slug, 'skipped' as const]))
      : await classifyAll({ db, narratives, windowEnd, scoreVersion });
  return {
    windowEnd,
    mentionsInserted,
    fundamentalsInserted,
    pointsWritten,
    quadrants,
    gaps,
  };
}

async function classifyAll(input: {
  readonly db: Db;
  readonly narratives: readonly NarrativeRecord[];
  readonly windowEnd: Date;
  readonly scoreVersion: string;
}): Promise<Record<string, QuadrantOutcome>> {
  const { db, narratives, windowEnd, scoreVersion } = input;
  const since = new Date(windowEnd.getTime() - SLOPE_LOOKBACK_MS);
  const result: Record<string, QuadrantOutcome> = {};

  for (const narrative of narratives) {
    const [attention, fundamental] = await Promise.all([
      listMetricPoints(db, {
        narrativeId: narrative.id,
        axis: 'attention',
        window: ATTENTION_WINDOW.window,
        scoreVersion,
        since,
        until: windowEnd,
      }),
      listMetricPoints(db, {
        narrativeId: narrative.id,
        axis: 'fundamental',
        window: FUNDAMENTAL_WINDOW.window,
        scoreVersion,
        since,
        until: windowEnd,
      }),
    ]);
    const verdict = classifyQuadrant(attention, fundamental);

    if (verdict.kind === 'insufficient_data') {
      // No se abre estado: "muerta" significa que miramos y no se movió, no
      // que todavía no tenemos con qué opinar (M§23).
      result[narrative.slug] = 'insufficient_data';
      continue;
    }
    result[narrative.slug] = await withTransaction(db, (tx) =>
      recordQuadrant(tx, {
        narrativeId: narrative.id,
        quadrant: verdict.quadrant,
        attentionSlope: verdict.attentionSlope,
        fundamentalSlope: verdict.fundamentalSlope,
        scoreVersion,
        at: windowEnd,
      }),
    );
  }
  return result;
}
