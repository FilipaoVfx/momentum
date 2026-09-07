/**
 * Cubo de fichas por proveedor (NFR-061).
 *
 * Es lo que faltaba: el semáforo limita cuántas llamadas van a la vez, no
 * cuántas se hacen por minuto. Con solo semáforo, un barrido de cincuenta
 * entidades sale a toda velocidad de cuatro en cuatro y consume la cuota en
 * segundos.
 *
 * Ni DefiLlama ni Polymarket publican su límite —no exponen cabeceras
 * `RateLimit-*` y su documentación no lo dice—, así que los valores de
 * `config.ts` son conservadores a propósito: se eligen por debajo de lo que
 * creemos poder gastar y se suben con evidencia, no al revés.
 */
export interface TokenBucketOptions {
  readonly capacity: number;
  readonly refillPerMinute: number;
  readonly now?: () => number;
}

export class TokenBucket {
  #tokens: number;
  #lastRefill: number;
  readonly #capacity: number;
  readonly #refillPerMs: number;
  readonly #now: () => number;

  constructor(options: TokenBucketOptions) {
    if (options.capacity < 1) throw new Error('El cubo necesita capacidad de al menos una ficha.');
    this.#capacity = options.capacity;
    this.#refillPerMs = options.refillPerMinute / 60_000;
    this.#now = options.now ?? (() => Date.now());
    this.#tokens = options.capacity;
    this.#lastRefill = this.#now();
  }

  #refill(): void {
    const now = this.#now();
    const elapsed = now - this.#lastRefill;
    if (elapsed <= 0) return;
    this.#tokens = Math.min(this.#capacity, this.#tokens + elapsed * this.#refillPerMs);
    this.#lastRefill = now;
  }

  /** Fichas disponibles ahora mismo, para diagnóstico. */
  get available(): number {
    this.#refill();
    return this.#tokens;
  }

  /** Toma una ficha si la hay. No espera: quien llama decide si esperar. */
  tryTake(): boolean {
    this.#refill();
    if (this.#tokens < 1) return false;
    this.#tokens -= 1;
    return true;
  }

  /** Milisegundos hasta que haya una ficha. 0 si ya la hay. */
  waitMs(): number {
    this.#refill();
    if (this.#tokens >= 1) return 0;
    return Math.ceil((1 - this.#tokens) / this.#refillPerMs);
  }
}

/**
 * `Retry-After` puede venir en segundos o como fecha HTTP. Ignorarlo es la
 * forma más rápida de que un 429 puntual se convierta en un bloqueo por
 * insistir.
 */
export function parseRetryAfter(header: string | null, now: Date): Date | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return new Date(now.getTime() + seconds * 1000);
  }
  const date = new Date(header);
  return Number.isNaN(date.getTime()) ? null : date;
}
