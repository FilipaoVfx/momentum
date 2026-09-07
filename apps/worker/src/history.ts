import type { MetricPoint } from '@momentum/core';
import { SCORE_VERSION, computeFundamental } from '@momentum/core';
import {
  insertFundamentals,
  insertMetricPoints,
  listFundamentals,
  withTransaction,
  type Db,
  type NarrativeRecord,
  type StoredSnapshot,
} from '@momentum/db';
import { deriveAll } from './derive.ts';
import type { DictionaryIndex } from './dictionary.ts';
import { FUNDAMENTAL_WINDOW } from './pipeline.ts';

/**
 * Reconstrucción del eje de fundamento a partir de series históricas.
 *
 * Los puntos se calculan en **instantes deterministas** —medianoche UTC de cada
 * día del rango— y no en «ahora». Es la condición para que esto no rompa el
 * criterio de salida de M1: un replay del mismo rango vuelve a producir
 * exactamente los mismos puntos, porque las ventanas salen de los datos y no
 * del reloj de quien ejecuta.
 */
export const midnightsBetween = (from: Date, to: Date): Date[] => {
  const days: Date[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1),
  );
  // El último día queda fuera: la cifra diaria del día en curso todavía no está
  // publicada para todos los protocolos, así que su punto se calcularía sobre
  // un conjunto de entidades incompleto y saldría hundido. Un escalón así se
  // lee como una caída del fundamento y no lo es. De ese tramo se encarga la
  // corrida en vivo, que sí sabe qué le faltó y lo declara.
  const lastComplete = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  while (cursor <= lastComplete) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
};

export interface HistoryResult {
  readonly observations: number;
  readonly pointsWritten: number;
  readonly days: number;
}

/**
 * Deriva las observaciones históricas de los snapshots dados y calcula la serie
 * diaria de fundamento. No toca el eje de atención —ni Reddit ni Polymarket dan
 * historia— ni la clasificación: rellenar hacia atrás lo que dijimos en su
 * momento sería inventarse un pasado (ADR-013).
 */
export async function rebuildFundamentalHistory(input: {
  readonly db: Db;
  readonly index: DictionaryIndex;
  readonly narratives: readonly NarrativeRecord[];
  readonly snapshots: readonly StoredSnapshot[];
  readonly since: Date;
  readonly until: Date;
  readonly scoreVersion?: string;
}): Promise<HistoryResult> {
  const { db, index, narratives, snapshots, since, until } = input;
  const scoreVersion = input.scoreVersion ?? SCORE_VERSION;
  const idBySlug = new Map(narratives.map((n) => [n.slug, n.id]));

  const historical = snapshots.filter((s) => s.requestKey.startsWith('defillama:history'));
  if (historical.length === 0) return { observations: 0, pointsWritten: 0, days: 0 };

  const derived = deriveAll(historical, index, { since });
  const observations = await withTransaction(db, (tx) =>
    insertFundamentals(tx, idBySlug, derived.fundamentals),
  );

  const days = midnightsBetween(since, until);
  const points: MetricPoint[] = [];
  for (const windowEnd of days) {
    const windowStart = new Date(windowEnd.getTime() - FUNDAMENTAL_WINDOW.durationMs);
    const fundamentals = await listFundamentals(db, { since: windowStart, until: windowEnd });
    for (const narrative of narratives) {
      const point = computeFundamental(narrative.slug, fundamentals, windowEnd, FUNDAMENTAL_WINDOW);
      if (point) points.push({ ...point, scoreVersion });
    }
  }

  const pointsWritten = await withTransaction(db, (tx) =>
    insertMetricPoints(tx, idBySlug, points),
  );
  return { observations, pointsWritten, days: days.length };
}
