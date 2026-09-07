import { describe, expect, it, vi } from 'vitest';
import { CircuitBreaker, Semaphore, Singleflight } from '../src/index.ts';

describe('singleflight (NFR-010, criterio de aceptación 2 del SRS)', () => {
  it('colapsa 500 solicitudes concurrentes sobre la misma clave en una sola llamada', async () => {
    const upstream = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return 'valor';
    });
    const sf = new Singleflight();

    const results = await Promise.all(
      Array.from({ length: 500 }, () => sf.do('token:abc', upstream)),
    );

    expect(upstream).toHaveBeenCalledTimes(1);
    expect(new Set(results)).toEqual(new Set(['valor']));
  });

  it('no mezcla claves distintas', async () => {
    const sf = new Singleflight();
    const upstream = vi.fn(async (k: string) => k);
    await Promise.all([sf.do('a', () => upstream('a')), sf.do('b', () => upstream('b'))]);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('libera la clave al terminar, incluso si falló', async () => {
    const sf = new Singleflight();
    await expect(sf.do('k', () => Promise.reject(new Error('fuente caída')))).rejects.toThrow();
    expect(sf.inFlightCount).toBe(0);
    await expect(sf.do('k', () => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});

describe('semáforo por proveedor (NFR-011)', () => {
  it('nunca supera el límite de concurrencia', async () => {
    const semaphore = new Semaphore(3);
    let current = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        semaphore.run(async () => {
          current += 1;
          peak = Math.max(peak, current);
          await new Promise((r) => setTimeout(r, 5));
          current -= 1;
        }),
      ),
    );
    expect(peak).toBe(3);
  });
});

describe('interruptor de circuito (NFR-013)', () => {
  it('5 fallos en 60 s abren el circuito 30 s', () => {
    let now = 0;
    const breaker = new CircuitBreaker({ now: () => now });

    for (let i = 0; i < 4; i += 1) breaker.recordFailure();
    expect(breaker.allows()).toBe(true);

    breaker.recordFailure();
    expect(breaker.allows()).toBe(false);
    expect(breaker.state()).toBe('open');

    now += 29_999;
    expect(breaker.allows()).toBe(false);

    now += 2;
    expect(breaker.state()).toBe('half_open');
    expect(breaker.allows()).toBe(true);
  });

  it('fallos dispersos fuera de la ventana no abren nada', () => {
    let now = 0;
    const breaker = new CircuitBreaker({ now: () => now });
    for (let i = 0; i < 10; i += 1) {
      breaker.recordFailure();
      now += 61_000;
    }
    expect(breaker.allows()).toBe(true);
  });

  it('un éxito borra el historial de fallos', () => {
    const breaker = new CircuitBreaker();
    for (let i = 0; i < 4; i += 1) breaker.recordFailure();
    breaker.recordSuccess();
    for (let i = 0; i < 4; i += 1) breaker.recordFailure();
    expect(breaker.allows()).toBe(true);
  });
});
