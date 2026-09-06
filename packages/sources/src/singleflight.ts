/**
 * Coalescing por clave (NFR-010, ADR-002).
 *
 * El tráfico de este dominio es fuertemente correlacionado: cuando un token se
 * pone de moda, cientos de solicitudes caen sobre la misma clave en la misma
 * ventana de minutos. Sin esto, el primer evento viral del día agota la cuota
 * diaria de todos los proveedores.
 *
 * Es requisito desde la primera versión, no una optimización posterior.
 */
export class Singleflight {
  readonly #inFlight = new Map<string, Promise<unknown>>();

  async do<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.#inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = (async () => fn())().finally(() => {
      this.#inFlight.delete(key);
    });
    this.#inFlight.set(key, promise);
    return promise as Promise<T>;
  }

  get inFlightCount(): number {
    return this.#inFlight.size;
  }
}
