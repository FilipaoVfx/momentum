import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AXIS_WINDOW, SCORE_VERSION, type Axis, type Quadrant } from '@momentum/core';
import {
  countOrigins,
  listGaps,
  listMetricPoints,
  listNarratives,
  usageReport,
  type Db,
} from '@momentum/db';
import type {
  Comparison,
  DeclaredGap,
  Feed,
  MeasuredValue,
  Meta,
  NarrativeDetail,
  NarrativeSummary,
  Provenance,
  QuadrantPeriod,
  SeriesPoint,
  SourceHealth,
} from './types.ts';

const HISTORY_MS = 14 * 86_400_000;
const WEEK_MS = 7 * 86_400_000;

const METHODS: Readonly<Record<Axis, string>> = {
  attention:
    'orígenes distintos en 24 h, ponderados por costo de fabricación y deduplicados por publicación raíz',
  fundamental:
    'media ponderada de TVL, comisiones y volumen diarios de las entidades de la narrativa, ' +
    'en escala logarítmica, sobre una ventana de 48 h para que la base del compuesto no cambie ' +
    'cuando la fuente retrasa una de las cifras',
};

const SOURCES: Readonly<Record<Axis, string>> = {
  attention: 'reddit + polymarket',
  fundamental: 'defillama',
};

/**
 * Exporta el material que consume el sitio.
 *
 * Regla que gobierna este fichero: **si un número no puede responder las tres
 * preguntas —comparado con qué, de dónde salió, qué tan viejo es— no se
 * exporta.** No se exporta a medias ni con la procedencia en blanco: se queda
 * en el store hasta que pueda responderlas (manifiesto, «Las tres preguntas»).
 */
export async function exportStaticData(input: {
  readonly db: Db;
  readonly outDir: string;
  readonly now?: Date;
  readonly scoreVersion?: string;
}): Promise<{ files: string[]; narratives: number }> {
  const { db, outDir } = input;
  const now = input.now ?? new Date();
  const scoreVersion = input.scoreVersion ?? SCORE_VERSION;
  const since = new Date(now.getTime() - HISTORY_MS);

  const narratives = await listNarratives(db);
  const lastRunId = await latestRunId(db);
  const gapsByNarrative = await gapIndex(db, lastRunId);

  const summaries: NarrativeSummary[] = [];
  const details: NarrativeDetail[] = [];

  // Primera pasada: series por narrativa, para poder comparar unas con otras.
  const seriesByNarrative = new Map<string, Record<Axis, SeriesPoint[]>>();
  const rawByNarrative = new Map<
    string,
    Record<Axis, { value: number; at: Date; snapshotIds: string[] } | null>
  >();

  for (const narrative of narratives) {
    // Cada eje trae la ventana con la que fue calculado (ver AXIS_WINDOW).
    const points = (
      await listMetricPoints(db, { narrativeId: narrative.id, scoreVersion, since, until: now })
    ).filter((p) => p.window === AXIS_WINDOW[p.axis]);
    const series: Record<Axis, SeriesPoint[]> = { attention: [], fundamental: [] };
    const latest: Record<Axis, { value: number; at: Date; snapshotIds: string[] } | null> = {
      attention: null,
      fundamental: null,
    };
    for (const p of points) {
      series[p.axis].push({ at: p.observedAt.toISOString(), value: p.value });
      const current = latest[p.axis];
      if (!current || p.observedAt > current.at) {
        latest[p.axis] = {
          value: p.value,
          at: p.observedAt,
          snapshotIds: [...p.inputSnapshotIds],
        };
      }
    }
    seriesByNarrative.set(narrative.slug, series);
    rawByNarrative.set(narrative.slug, latest);
  }

  // Segunda pasada: ya se puede situar cada valor frente a sus pares.
  for (const narrative of narratives) {
    const series = seriesByNarrative.get(narrative.slug)!;
    const latest = rawByNarrative.get(narrative.slug)!;
    const quadrant = await currentQuadrant(db, narrative.id, scoreVersion);
    const history = await quadrantHistory(db, narrative.id);
    const counts = await countOrigins(db, narrative.id, since, now);

    const measure = (axis: Axis): MeasuredValue | null => {
      const value = latest[axis];
      if (!value) return null;
      const provenance: Provenance = {
        source: SOURCES[axis],
        method: METHODS[axis],
        scoreVersion,
        fetchedAt: value.at.toISOString(),
        snapshotIds: value.snapshotIds,
      };
      // Sin insumos no hay camino de vuelta a la fuente, así que no sale.
      if (provenance.snapshotIds.length === 0) return null;
      return {
        value: value.value,
        comparison: compare(axis, narrative.slug, value.value, seriesByNarrative, rawByNarrative, now),
        provenance,
      };
    };

    const summary: NarrativeSummary = {
      slug: narrative.slug,
      name: narrative.name,
      quadrant: quadrant?.quadrant ?? null,
      insufficientDataReason: quadrant
        ? null
        : 'sin puntos suficientes en ambos ejes para calcular una pendiente',
      since: quadrant?.startedAt.toISOString() ?? null,
      attention: measure('attention'),
      fundamental: measure('fundamental'),
      origins: counts.origins,
      mentions: counts.mentions,
      tickers: narrative.entities.ticker,
      gaps: gapsByNarrative.get(narrative.slug) ?? [],
    };
    summaries.push(summary);
    details.push({
      ...summary,
      series,
      quadrantHistory: history,
      entities: narrative.entities as unknown as Record<string, readonly string[]>,
    });
  }

  const feed: Feed = { generatedAt: now.toISOString(), scoreVersion, narratives: summaries };
  const meta: Meta = {
    generatedAt: now.toISOString(),
    lastRunAt: (await lastRunAt(db))?.toISOString() ?? null,
    scoreVersion,
    sources: await sourceHealth(db, now, gapsByNarrative),
    coverage: {
      narratives: summaries.length,
      withAttention: summaries.filter((s) => s.attention).length,
      withFundamental: summaries.filter((s) => s.fundamental).length,
      classified: summaries.filter((s) => s.quadrant).length,
    },
  };

  const files: string[] = [];
  const write = async (relative: string, data: unknown): Promise<void> => {
    const path = join(outDir, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    files.push(relative);
  };

  await write('meta.json', meta);
  await write('feed.json', feed);
  for (const detail of details) await write(`narratives/${detail.slug}.json`, detail);

  return { files, narratives: summaries.length };
}

/** ¿Comparado con qué? Variación propia en 7 días y posición entre pares. */
function compare(
  axis: Axis,
  slug: string,
  value: number,
  seriesByNarrative: Map<string, Record<Axis, SeriesPoint[]>>,
  rawByNarrative: Map<string, Record<Axis, { value: number; at: Date } | null>>,
  now: Date,
): Comparison {
  const series = seriesByNarrative.get(slug)?.[axis] ?? [];
  const weekAgo = now.getTime() - WEEK_MS;
  let reference: SeriesPoint | null = null;
  for (const point of series) {
    const at = Date.parse(point.at);
    if (at <= weekAgo && (!reference || at > Date.parse(reference.at))) reference = point;
  }

  const peers: number[] = [];
  for (const [otherSlug, latest] of rawByNarrative) {
    if (otherSlug === slug) continue;
    const other = latest[axis];
    if (other) peers.push(other.value);
  }
  const below = peers.filter((v) => v < value).length;

  return {
    change7d: reference ? value - reference.value : null,
    percentileAmongPeers: peers.length > 0 ? Math.round((below / peers.length) * 100) : null,
    peerCount: peers.length,
  };
}

async function latestRunId(db: Db): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    "select id from run where kind = 'ingest' order by started_at desc limit 1",
  );
  return rows[0]?.id ?? null;
}

async function lastRunAt(db: Db): Promise<Date | null> {
  const { rows } = await db.query<{ started_at: Date }>(
    "select started_at from run where kind = 'ingest' order by started_at desc limit 1",
  );
  return rows[0]?.started_at ?? null;
}

async function gapIndex(db: Db, runId: string | null): Promise<Map<string, DeclaredGap[]>> {
  const index = new Map<string, DeclaredGap[]>();
  if (!runId) return index;
  for (const gap of await listGaps(db, runId)) {
    const declared: DeclaredGap = {
      source: gap.source,
      reason: gap.reason,
      detail: gap.detail,
      narrativeSlug: gap.narrativeSlug ?? null,
    };
    const key = gap.narrativeSlug ?? '*';
    const list = index.get(key);
    if (list) list.push(declared);
    else index.set(key, [declared]);
  }
  return index;
}

async function currentQuadrant(
  db: Db,
  narrativeId: string,
  scoreVersion: string,
): Promise<{ quadrant: Quadrant; startedAt: Date } | null> {
  const { rows } = await db.query(
    `select quadrant, started_at from quadrant_state
      where narrative_id = $1 and score_version = $2 and ended_at is null`,
    [narrativeId, scoreVersion],
  );
  const row = rows[0];
  return row ? { quadrant: row.quadrant as Quadrant, startedAt: row.started_at as Date } : null;
}

async function quadrantHistory(db: Db, narrativeId: string): Promise<QuadrantPeriod[]> {
  const { rows } = await db.query(
    `select quadrant, started_at, ended_at, attention_slope, fundamental_slope
       from quadrant_state where narrative_id = $1 order by started_at asc`,
    [narrativeId],
  );
  return rows.map((r) => ({
    quadrant: r.quadrant as Quadrant,
    startedAt: (r.started_at as Date).toISOString(),
    endedAt: (r.ended_at as Date | null)?.toISOString() ?? null,
    attentionSlope: Number(r.attention_slope),
    fundamentalSlope: Number(r.fundamental_slope),
  }));
}

/**
 * Salud por fuente con la causa concreta (NFR-052). «Degradado» sin decir qué
 * está degradado no le sirve a nadie.
 */
async function sourceHealth(
  db: Db,
  now: Date,
  gaps: Map<string, DeclaredGap[]>,
): Promise<SourceHealth[]> {
  const usage = new Map((await usageReport(db, now)).map((u) => [u.provider, u.calls]));
  const { rows } = await db.query(
    'select source, max(fetched_at) as last from source_snapshot group by source',
  );
  const lastBySource = new Map(rows.map((r) => [r.source as string, r.last as Date]));
  const allGaps = [...gaps.values()].flat();

  return (['defillama', 'reddit', 'polymarket'] as const).map((source) => {
    const sourceGaps = allGaps.filter((g) => g.source === source);
    const notConfigured = sourceGaps.find((g) => g.reason === 'not_configured');
    const down = sourceGaps.find((g) =>
      ['source_down', 'timeout', 'circuit_open', 'rate_limited'].includes(g.reason),
    );
    const last = lastBySource.get(source) ?? null;

    const status: SourceHealth['status'] = notConfigured
      ? 'not_configured'
      : down
        ? 'degraded'
        : last
          ? 'ok'
          : 'down';
    return {
      source,
      status,
      detail: notConfigured?.detail ?? down?.detail ?? 'respondió en la última corrida',
      lastFetchedAt: last?.toISOString() ?? null,
      callsToday: usage.get(source) ?? 0,
    };
  });
}
