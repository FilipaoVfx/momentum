import { describe, expect, it } from 'vitest';
import { TokenBucket, parseRetryAfter } from '../src/index.ts';

describe('cubo de fichas (NFR-061)', () => {
  it('deja pasar la capacidad y no una más', () => {
    const now = 0;
    const bucket = new TokenBucket({ capacity: 10, refillPerMinute: 10, now: () => now });
    let allowed = 0;
    for (let i = 0; i < 100; i += 1) if (bucket.tryTake()) allowed += 1;
    expect(allowed).toBe(10);
  });

  it('se rellena con el tiempo, no de golpe', () => {
    let now = 0;
    const bucket = new TokenBucket({ capacity: 60, refillPerMinute: 60, now: () => now });
    while (bucket.tryTake());
    expect(bucket.tryTake()).toBe(false);

    now += 1_000; // un segundo = una ficha a 60/min
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });

  it('no acumula más allá de su capacidad tras un rato parado', () => {
    let now = 0;
    const bucket = new TokenBucket({ capacity: 5, refillPerMinute: 60, now: () => now });
    while (bucket.tryTake());
    now += 3_600_000; // una hora
    let allowed = 0;
    while (bucket.tryTake()) allowed += 1;
    expect(allowed).toBe(5);
  });

  it('dice cuánto falta para la siguiente ficha', () => {
    const now = 0;
    const bucket = new TokenBucket({ capacity: 1, refillPerMinute: 60, now: () => now });
    expect(bucket.waitMs()).toBe(0);
    bucket.tryTake();
    expect(bucket.waitMs()).toBe(1_000);
  });
});

describe('Retry-After', () => {
  const now = new Date('2026-01-10T00:00:00Z');

  it('entiende los segundos', () => {
    expect(parseRetryAfter('30', now)?.toISOString()).toBe('2026-01-10T00:00:30.000Z');
  });

  it('entiende la fecha HTTP', () => {
    expect(parseRetryAfter('Sat, 10 Jan 2026 00:05:00 GMT', now)?.toISOString()).toBe(
      '2026-01-10T00:05:00.000Z',
    );
  });

  it('no inventa una espera si la cabecera falta o es basura', () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter('mañana', now)).toBeNull();
  });
});
