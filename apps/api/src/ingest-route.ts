import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { parseRating, type SourceId } from '@momentum/core';
import { insertSnapshot, type Db } from '@momentum/db';

/**
 * Puerta de entrada para extractores externos (n8n u otros).
 *
 * Existe por una razón concreta: algunas fuentes son más fáciles de alcanzar
 * desde otra IP o con las credenciales guardadas en otro sitio. Lo que **no**
 * puede pasar es que ese atajo se salte la procedencia.
 *
 * Por eso este endpoint acepta el **crudo y nada más**. No admite valores
 * computados, no admite métricas, no admite "ya te lo he parseado yo". Calcula
 * el hash en servidor y escribe exactamente la misma fila que habría escrito
 * `SourceGateway`, de modo que `deriveFromSnapshot` y el replay funcionan sin
 * enterarse de por dónde entró el dato.
 *
 * Si algún día alguien quiere mandar aquí un valor ya calculado, la respuesta
 * es no: en ese momento dejaríamos de poder recalcular la historia, que es la
 * propiedad por la que existe todo el diseño.
 */

/** Formas de `requestKey` que el sistema sabe interpretar en `derive.ts`. */
const KNOWN_REQUEST_KEYS: readonly RegExp[] = [
  /^defillama:protocol:[a-z0-9._-]+$/,
  /^defillama:overview:(fees|dexs)$/,
  /^reddit:new:[a-z0-9_]+$/,
  /^polymarket:markets:top$/,
];

const KNOWN_SOURCES: readonly SourceId[] = ['defillama', 'reddit', 'polymarket'];

/** 4 MB: el mayor payload legítimo que capturamos hoy no llega a 500 kB. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

interface IngestBody {
  source?: unknown;
  requestKey?: unknown;
  endpoint?: unknown;
  payload?: unknown;
  fetchedAt?: unknown;
  rating?: unknown;
  httpStatus?: unknown;
  latencyMs?: unknown;
}

/** Comparación en tiempo constante: un token no se compara con `===`. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerIngestRoute(app: FastifyInstance, db: Db): void {
  const expectedToken = process.env['INGEST_TOKEN'];

  app.post('/ingest/snapshot', async (request, reply) => {
    if (!expectedToken) {
      return reply
        .code(503)
        .send({ error: 'INGEST_TOKEN no está configurado; la puerta de entrada está cerrada' });
    }
    const header = request.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!provided || !tokenMatches(provided, expectedToken)) {
      return reply.code(401).send({ error: 'token de ingesta inválido' });
    }

    const body = (request.body ?? {}) as IngestBody;
    const source = body.source;
    const requestKey = body.requestKey;

    if (typeof source !== 'string' || !KNOWN_SOURCES.includes(source as SourceId)) {
      return reply.code(400).send({ error: `fuente desconocida: ${String(source)}` });
    }
    if (typeof requestKey !== 'string' || !KNOWN_REQUEST_KEYS.some((r) => r.test(requestKey))) {
      return reply.code(400).send({
        error:
          `requestKey no reconocida: ${String(requestKey)}. ` +
          'Debe coincidir con una de las formas que sabe interpretar derive.ts, ' +
          'o el snapshot entraría al store sin que nadie pudiera leerlo.',
      });
    }
    if (body.payload === undefined || body.payload === null) {
      return reply.code(400).send({ error: 'falta el payload crudo' });
    }

    const fetchedAt = typeof body.fetchedAt === 'string' ? new Date(body.fetchedAt) : new Date();
    if (Number.isNaN(fetchedAt.getTime())) {
      return reply.code(400).send({ error: 'fetchedAt no es una fecha válida' });
    }

    // El hash se calcula aquí, sobre lo que realmente vamos a guardar. Aceptarlo
    // del cliente sería confiar en que no mienta sobre su propia evidencia.
    const canonical = JSON.stringify(body.payload);
    if (Buffer.byteLength(canonical) > MAX_BODY_BYTES) {
      return reply.code(413).send({ error: 'payload demasiado grande' });
    }
    const contentHash = createHash('sha256').update(canonical).digest();

    const rating =
      typeof body.rating === 'string'
        ? parseRating(body.rating)
        : { reliability: 'F' as const, credibility: 6 as const };

    const snapshotId = await insertSnapshot(db, {
      source: source as SourceId,
      endpoint: typeof body.endpoint === 'string' ? body.endpoint : `external:${requestKey}`,
      requestKey,
      httpStatus: typeof body.httpStatus === 'number' ? body.httpStatus : null,
      latencyMs: typeof body.latencyMs === 'number' ? body.latencyMs : 0,
      payload: body.payload,
      contentHash,
      fetchedAt,
      rating,
      runId: null,
    });

    return reply.code(201).send({ snapshotId, contentHash: contentHash.toString('hex') });
  });
}
