/**
 * Límite de concurrencia por proveedor (NFR-011). No es un pool global: cada
 * API tiene su propio límite contractual y compartir un pool haría que la más
 * lenta marcase el ritmo de todas.
 */
export class Semaphore {
  #available: number;
  readonly #waiting: (() => void)[] = [];

  constructor(readonly permits: number) {
    if (permits < 1) throw new Error('Un semáforo necesita al menos un permiso.');
    this.#available = permits;
  }

  async acquire(): Promise<void> {
    if (this.#available > 0) {
      this.#available -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.#waiting.push(resolve));
  }

  release(): void {
    const next = this.#waiting.shift();
    if (next) next();
    else this.#available = Math.min(this.#available + 1, this.permits);
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
