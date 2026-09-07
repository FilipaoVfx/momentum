import type { Rating, SourceId } from '@momentum/core';
import type { Db, Tx } from '../pool.ts';

export interface SnapshotInput {
  readonly source: SourceId;
  readonly endpoint: string;
  readonly requestKey: string;
  readonly httpStatus: number | null;
  readonly latencyMs: number;
  readonly payload: unknown;
  readonly contentHash: Buffer;
  readonly fetchedAt: Date;
  readonly rating: Rating;
  readonly runId?: string | null;
}

export interface StoredSnapshot extends Omit<SnapshotInput, 'rating' | 'runId'> {
  readonly id: string;
  readonly rating: Rating;
  readonly runId: string | null;
}

/** Se escribe antes de parsear: si el parseo falla, el crudo ya está a salvo. */
export async function insertSnapshot(db: Db | Tx, input: SnapshotInput): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into source_snapshot
       (source, endpoint, request_key, http_status, latency_ms, payload, content_hash,
        fetched_at, source_reliability, data_credibility, run_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning id`,
    [
      input.source,
      input.endpoint,
      input.requestKey,
      input.httpStatus,
      input.latencyMs,
      JSON.stringify(input.payload),
      input.contentHash,
      input.fetchedAt,
      input.rating.reliability,
      input.rating.credibility,
      input.runId ?? null,
    ],
  );
  return rows[0]!.id;
}

/**
 * Insumo del replay: la historia completa, sin tocar la red (FR-052, M§9).
 * Se devuelve en orden de captura porque el pipeline la reconstruye en ese orden.
 */
export async function listSnapshots(
  db: Db,
  opts: { readonly since: Date; readonly until: Date; readonly source?: SourceId },
): Promise<StoredSnapshot[]> {
  const { rows } = await db.query(
    `select id, source, endpoint, request_key, http_status, latency_ms, payload,
            content_hash, fetched_at, source_reliability, data_credibility, run_id
       from source_snapshot
      where fetched_at > $1 and fetched_at <= $2
        and ($3::text is null or source = $3)
      order by fetched_at asc, id asc`,
    [opts.since, opts.until, opts.source ?? null],
  );
  return rows.map(mapSnapshot);
}

/** Snapshots capturados por una corrida concreta, en orden de captura. */
export async function listSnapshotsByRun(db: Db, runId: string): Promise<StoredSnapshot[]> {
  const { rows } = await db.query(
    `select id, source, endpoint, request_key, http_status, latency_ms, payload,
            content_hash, fetched_at, source_reliability, data_credibility, run_id
       from source_snapshot where run_id = $1 order by fetched_at asc, id asc`,
    [runId],
  );
  return rows.map(mapSnapshot);
}

function mapSnapshot(r: Record<string, unknown>): StoredSnapshot {
  return {
    id: r['id'] as string,
    source: r['source'] as SourceId,
    endpoint: r['endpoint'] as string,
    requestKey: r['request_key'] as string,
    httpStatus: (r['http_status'] as number | null) ?? null,
    latencyMs: r['latency_ms'] as number,
    payload: r['payload'],
    contentHash: r['content_hash'] as Buffer,
    fetchedAt: r['fetched_at'] as Date,
    runId: (r['run_id'] as string | null) ?? null,
    rating: {
      reliability: r['source_reliability'] as Rating['reliability'],
      credibility: r['data_credibility'] as Rating['credibility'],
    },
  };
}

/** Instante de la última captura de una `requestKey`, o `null` si nunca se pidió. */
export async function lastFetchedAt(db: Db, requestKey: string): Promise<Date | null> {
  const { rows } = await db.query<{ fetched_at: Date }>(
    'select fetched_at from source_snapshot where request_key = $1 order by fetched_at desc limit 1',
    [requestKey],
  );
  return rows[0]?.fetched_at ?? null;
}
