/**
 * Interruptor de circuito por fuente (NFR-013). Umbral inicial: 5 fallos en
 * 60 s abren el circuito 30 s.
 *
 * El punto no es proteger a la fuente caída, es proteger nuestro presupuesto de
 * latencia: sin esto, una fuente muerta consume su timeout completo en cada
 * solicitud y se lleva por delante el deadline de todo lo demás.
 */
export interface BreakerOptions {
  readonly failureThreshold: number;
  readonly windowMs: number;
  readonly openMs: number;
  readonly now: () => number;
}

export const DEFAULT_BREAKER: Omit<BreakerOptions, 'now'> = {
  failureThreshold: 5,
  windowMs: 60_000,
  openMs: 30_000,
};

export type BreakerState = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  #failures: number[] = [];
  #openedAt: number | null = null;
  readonly #opts: BreakerOptions;

  constructor(options: Partial<BreakerOptions> = {}) {
    this.#opts = { ...DEFAULT_BREAKER, now: () => Date.now(), ...options };
  }

  state(): BreakerState {
    if (this.#openedAt === null) return 'closed';
    return this.#opts.now() - this.#openedAt >= this.#opts.openMs ? 'half_open' : 'open';
  }

  /** `false` significa: no toques la red. */
  allows(): boolean {
    return this.state() !== 'open';
  }

  recordSuccess(): void {
    this.#failures = [];
    this.#openedAt = null;
  }

  recordFailure(): void {
    const now = this.#opts.now();
    this.#failures = this.#failures.filter((t) => now - t < this.#opts.windowMs);
    this.#failures.push(now);
    if (this.#failures.length >= this.#opts.failureThreshold) {
      this.#openedAt = now;
      this.#failures = [];
    }
  }
}
