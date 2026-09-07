import { createHash } from 'node:crypto';
import type { CollectionGap, Rating, SourceId, SourceResult } from '@momentum/core';
import { gap, ok } from '@momentum/core';
import {
  bumpUsage,
  cooldownUntil,
  insertSnapshot,
  setCooldown,
  usageToday,
  type Db,
} from '@momentum/db';
import { CircuitBreaker } from './circuit-breaker.ts';
import { PROVIDERS } from './config.ts';
import { TokenBucket, parseRetryAfter } from './rate-limiter.ts';
import { Semaphore } from './semaphore.ts';
import { Singleflight } from './singleflight.ts';

export interface FetchedSnapshot {
  readonly snapshotId: string;
  readonly payload: unknown;
  readonly fetchedAt: Date;
  readonly requestKey: string;
  readonly source: SourceId;
}

export interface GatewayDeps {
  readonly db: Db;
  readonly now?: () => Date;
  readonly fetchImpl?: typeof fetch;
  /** Corrida a la que se atribuyen los snapshots capturados por este gateway. */
  readonly runId?: string;
}

export interface GetOptions {
  readonly source: SourceId;
  /** Ruta relativa al `baseUrl` del proveedor. */
  readonly path: string;
  /**
   * Clave estable de la solicitud. Es a la vez la clave del singleflight y la
   * que permite al replay saber qué representaba este snapshot sin volver a
   * llamar a nadie. Formato: `<fuente>:<tipo>:<identificador>`.
   */
  readonly requestKey: string;
  readonly budgetMs?: number;
  readonly rating?: Rating;
  readonly headers?: Readonly<Record<string, string>>;
  /** Sustituye el `baseUrl` del proveedor (Reddit sirve OAuth en otro host). */
  readonly baseUrl?: string;
}

/**
 * La única puerta de salida a la red del sistema.
 *
 * Todo lo que sale pasa por aquí y todo lo que entra queda persistido antes de
 * ser interpretado (ADR-007). Un adaptador nunca ve una respuesta HTTP cruda ni
 * decide si guardarla: si pudiera, tarde o temprano alguien transformaría y
 * descartaría (M§9).
 */
export class SourceGateway {
  readonly #db: Db;
  readonly #now: () => Date;
  readonly #fetch: typeof fetch;
  readonly #runId: string | null;
  readonly #singleflight = new Singleflight();
  readonly #semaphores = new Map<SourceId, Semaphore>();
  readonly #breakers = new Map<SourceId, CircuitBreaker>();
  readonly #buckets = new Map<SourceId, TokenBucket>();

  constructor(deps: GatewayDeps) {
    this.#db = deps.db;
    this.#now = deps.now ?? (() => new Date());
    this.#fetch = deps.fetchImpl ?? globalThis.fetch;
    this.#runId = deps.runId ?? null;
  }

  breaker(source: SourceId): CircuitBreaker {
    let breaker = this.#breakers.get(source);
    if (!breaker) {
      breaker = new CircuitBreaker();
      this.#breakers.set(source, breaker);
    }
    return breaker;
  }

  #bucket(source: SourceId): TokenBucket {
    let bucket = this.#buckets.get(source);
    if (!bucket) {
      const { requestsPerMinute } = PROVIDERS[source];
      bucket = new TokenBucket({
        capacity: requestsPerMinute,
        refillPerMinute: requestsPerMinute,
        now: () => this.#now().getTime(),
      });
      this.#buckets.set(source, bucket);
    }
    return bucket;
  }

  #semaphore(source: SourceId): Semaphore {
    let semaphore = this.#semaphores.get(source);
    if (!semaphore) {
      semaphore = new Semaphore(PROVIDERS[source].concurrency);
      this.#semaphores.set(source, semaphore);
    }
    return semaphore;
  }

  async get(opts: GetOptions): Promise<SourceResult<FetchedSnapshot>> {
    return this.#singleflight.do(opts.requestKey, () => this.#execute(opts));
  }

  async #execute(opts: GetOptions): Promise<SourceResult<FetchedSnapshot>> {
    const provider = PROVIDERS[opts.source];
    const breaker = this.breaker(opts.source);
    if (!breaker.allows()) {
      return gap(this.#gap(opts, 'circuit_open', 'circuito abierto; no se intenta la llamada'));
    }

    // El proveedor nos pidió expresamente no volver todavía. Insistir sobre un
    // `Retry-After` es la forma más rápida de convertir un 429 en un bloqueo.
    const cooldown = await cooldownUntil(this.#db, opts.source, this.#now());
    if (cooldown) {
      return gap(
        this.#gap(
          opts,
          'rate_limited',
          `el proveedor pidió esperar hasta ${cooldown.toISOString()} (Retry-After)`,
        ),
      );
    }

    const spent = await usageToday(this.#db, opts.source, this.#now());
    if (spent >= provider.dailyBudget) {
      return gap(
        this.#gap(
          opts,
          'rate_limited',
          `presupuesto diario agotado: ${spent}/${provider.dailyBudget} llamadas`,
        ),
      );
    }

    // El cubo de fichas limita el ritmo; el semáforo limita la simultaneidad.
    // Son cosas distintas y hacen falta las dos.
    const bucket = this.#bucket(opts.source);
    if (!bucket.tryTake()) {
      const waitMs = bucket.waitMs();
      const budgetMs = opts.budgetMs ?? provider.budgetMs;
      if (waitMs > budgetMs) {
        return gap(
          this.#gap(
            opts,
            'rate_limited',
            `sin fichas: habría que esperar ${waitMs} ms, más que el presupuesto de ${budgetMs} ms`,
          ),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      bucket.tryTake();
    }

    return this.#semaphore(opts.source).run(async () => {
      const url = `${opts.baseUrl ?? provider.baseUrl}${opts.path}`;
      const budgetMs = opts.budgetMs ?? provider.budgetMs;
      const startedAt = this.#now();
      // Se cuenta antes de salir: una llamada que se corta a medias también
      // consumió cuota del proveedor.
      await bumpUsage(this.#db, opts.source, startedAt);
      let response: Response;
      let body: string;

      try {
        response = await this.#fetch(url, {
          signal: AbortSignal.timeout(budgetMs),
          headers: { accept: 'application/json', ...opts.headers },
        });
        body = await response.text();
      } catch (error) {
        breaker.recordFailure();
        const isTimeout = (error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError';
        return gap(
          this.#gap(
            opts,
            isTimeout ? 'timeout' : 'source_down',
            `${(error as Error).name}: ${(error as Error).message} (presupuesto ${budgetMs} ms)`,
          ),
        );
      }

      const fetchedAt = this.#now();
      const latencyMs = fetchedAt.getTime() - startedAt.getTime();
      const contentHash = createHash('sha256').update(body).digest();

      // El payload se guarda aunque no sea JSON válido y aunque el status sea
      // un error: es justo el caso en el que querremos mirar el crudo después.
      //
      // Un cuerpo vacío con 200 no es un fallo de la fuente, es la fuente
      // diciendo que no tiene ese dato (DefiLlama responde así para protocolos
      // sin TVL). Contarlo como fallo abriría el circuito de una fuente sana a
      // los cinco protocolos sin datos, así que se distingue.
      const isEmpty = body.trim().length === 0;
      let payload: unknown;
      let parseFailed = false;
      if (isEmpty) {
        payload = { _empty: true };
      } else {
        try {
          payload = JSON.parse(body) as unknown;
        } catch {
          payload = { _raw_text: body.slice(0, 100_000) };
          parseFailed = true;
        }
      }

      const snapshotId = await insertSnapshot(this.#db, {
        source: opts.source,
        endpoint: url,
        requestKey: opts.requestKey,
        httpStatus: response.status,
        latencyMs,
        payload,
        contentHash,
        fetchedAt,
        rating: opts.rating ?? provider.rating,
        runId: this.#runId,
      });

      if (!response.ok) {
        breaker.recordFailure();
        if (response.status === 429) {
          const until =
            parseRetryAfter(response.headers.get('retry-after'), fetchedAt) ??
            new Date(fetchedAt.getTime() + 60_000);
          await setCooldown(this.#db, opts.source, until, fetchedAt);
          return gap(
            this.#gap(
              opts,
              'rate_limited',
              `HTTP 429; en enfriamiento hasta ${until.toISOString()} (snapshot ${snapshotId})`,
            ),
          );
        }
        return gap(
          this.#gap(opts, 'source_down', `HTTP ${response.status} (snapshot ${snapshotId})`),
        );
      }
      if (isEmpty) {
        breaker.recordSuccess();
        return gap(
          this.#gap(
            opts,
            'window_not_covered',
            `la fuente no tiene dato para esta entidad: respuesta vacía (snapshot ${snapshotId})`,
          ),
        );
      }
      if (parseFailed) {
        breaker.recordFailure();
        return gap(this.#gap(opts, 'parse_failed', `respuesta no es JSON (snapshot ${snapshotId})`));
      }

      breaker.recordSuccess();
      return ok({ snapshotId, payload, fetchedAt, requestKey: opts.requestKey, source: opts.source });
    });
  }

  #gap(opts: GetOptions, reason: CollectionGap['reason'], detail: string): CollectionGap {
    return { source: opts.source, reason, detail: `${opts.requestKey}: ${detail}` };
  }
}
