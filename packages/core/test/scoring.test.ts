import { describe, expect, it } from 'vitest';
import {
  SCORE_VERSION,
  WINDOWS,
  attentionWeight,
  computeAttention,
  computeFundamental,
  type FundamentalObservation,
  type MentionEvent,
} from '../src/index.ts';

const WINDOW = WINDOWS.find((w) => w.window === '24h')!;
const END = new Date('2026-01-02T00:00:00Z');
const at = (hoursAgo: number): Date => new Date(END.getTime() - hoursAgo * 3_600_000);

const mention = (overrides: Partial<MentionEvent> = {}): MentionEvent => ({
  source: 'reddit',
  narrativeSlug: 'liquid-staking',
  rootOriginKey: 'reddit:t3_root',
  replicatorKey: 'reddit:t3_root',
  observedAt: at(1),
  signalKind: 'reddit_post',
  authorHasHistory: null,
  magnitude: 0,
  snapshotId: 'snap-1',
  ...overrides,
});

describe('deduplicación por origen (M§17, FR-012)', () => {
  it('cuenta cuarenta réplicas de una misma publicación raíz como una observación', () => {
    const campaign = Array.from({ length: 40 }, (_, i) =>
      mention({ replicatorKey: `reddit:t3_replica${i}`, snapshotId: `snap-${i}` }),
    );
    const organic = mention({ rootOriginKey: 'reddit:t3_otro', replicatorKey: 'reddit:t3_otro' });

    const forty = computeAttention('liquid-staking', campaign, END, WINDOW)!;
    const one = computeAttention('liquid-staking', [campaign[0]!], END, WINDOW)!;
    const twoDistinctOrigins = computeAttention(
      'liquid-staking',
      [...campaign, organic],
      END,
      WINDOW,
    )!;

    // Cuarenta réplicas del mismo hilo valen exactamente lo que una.
    expect(forty.value).toBeCloseTo(one.value, 12);
    // Dos orígenes distintos sí valen más que uno: no estamos deduplicando de más.
    expect(twoDistinctOrigins.value).toBeGreaterThan(forty.value);
  });

  it('de un mismo origen conserva la réplica de mayor peso, no la primera', () => {
    const anonymous = mention({ replicatorKey: 'a', authorHasHistory: null });
    const established = mention({ replicatorKey: 'b', authorHasHistory: true });
    const both = computeAttention('liquid-staking', [anonymous, established], END, WINDOW);
    const onlyEstablished = computeAttention('liquid-staking', [established], END, WINDOW);
    expect(both!.value).toBeCloseTo(onlyEstablished!.value, 12);
  });
});

describe('ponderación por costo de mentir (M§5, FR-031)', () => {
  it('ordena las señales por lo que cuesta fabricarlas', () => {
    const market = attentionWeight(
      mention({ signalKind: 'prediction_market_position', magnitude: 250_000 }),
    );
    const withHistory = attentionWeight(mention({ authorHasHistory: true }));
    const withoutHistory = attentionWeight(mention({ authorHasHistory: null }));
    const comment = attentionWeight(mention({ signalKind: 'reddit_comment', authorHasHistory: true }));

    expect(market).toBeGreaterThan(withHistory);
    expect(withHistory).toBeGreaterThan(comment);
    expect(comment).toBeGreaterThan(withoutHistory);
  });

  it('un autor de historial desconocido pesa como uno sin historial, no como uno con él', () => {
    expect(attentionWeight(mention({ authorHasHistory: null }))).toBe(
      attentionWeight(mention({ authorHasHistory: false })),
    );
  });

  it('un mercado con más capital en riesgo pesa más que uno con menos', () => {
    const big = attentionWeight(mention({ signalKind: 'prediction_market_position', magnitude: 1e6 }));
    const small = attentionWeight(mention({ signalKind: 'prediction_market_position', magnitude: 500 }));
    expect(big).toBeGreaterThan(small);
  });
});

describe('ventanas', () => {
  it('ignora lo que cae fuera de la ventana', () => {
    const old = mention({ observedAt: at(30) });
    expect(computeAttention('liquid-staking', [old], END, WINDOW)).toBeNull();
  });

  it('no produce punto cuando no hay nada que observar', () => {
    expect(computeAttention('liquid-staking', [], END, WINDOW)).toBeNull();
  });
});

describe('fundamento (M§4)', () => {
  const observation = (o: Partial<FundamentalObservation>): FundamentalObservation => ({
    source: 'defillama',
    narrativeSlug: 'liquid-staking',
    entity: 'lido',
    observedAt: at(1),
    tvlUsd: null,
    fees24hUsd: null,
    volume24hUsd: null,
    snapshotId: 'snap-f',
    ...o,
  });

  it('fusiona campo a campo entre snapshots distintos de la misma entidad', () => {
    const merged = computeFundamental(
      'liquid-staking',
      [
        observation({ tvlUsd: 1_000_000, observedAt: at(2), snapshotId: 'tvl' }),
        observation({ fees24hUsd: 50_000, observedAt: at(1), snapshotId: 'fees' }),
      ],
      END,
      WINDOW,
    );
    expect(merged).not.toBeNull();
    expect(merged!.inputSnapshotIds).toEqual(['fees', 'tvl']);
  });

  it('un campo ausente se omite; un cero reportado sí cuenta y baja el valor', () => {
    const withNull = computeFundamental(
      'liquid-staking',
      [observation({ tvlUsd: 1_000_000, volume24hUsd: 500_000 })],
      END,
      WINDOW,
    )!;
    const withZero = computeFundamental(
      'liquid-staking',
      [observation({ tvlUsd: 1_000_000, volume24hUsd: 500_000, fees24hUsd: 0 })],
      END,
      WINDOW,
    )!;
    // Son cosas distintas y el score las trata distinto: «no sabemos cuánto
    // cobró» no puede valer lo mismo que «cobró cero» (M§4).
    expect(withZero.value).toBeLessThan(withNull.value);
    expect(withNull.value).toBeGreaterThan(0);
    expect(withZero.value).toBeGreaterThan(0);
  });

  it('sin ningún campo con dato no hay punto', () => {
    expect(computeFundamental('liquid-staking', [observation({})], END, WINDOW)).toBeNull();
  });

  it('fusiona campo a campo aunque lleguen en snapshots distintos', () => {
    const merged = computeFundamental(
      'liquid-staking',
      [
        observation({ tvlUsd: 1_000_000, observedAt: at(2), snapshotId: 'tvl' }),
        observation({ fees24hUsd: 50_000, observedAt: at(1), snapshotId: 'fees' }),
      ],
      END,
      WINDOW,
    );
    expect(merged?.inputSnapshotIds).toEqual(['fees', 'tvl']);
  });

  it('toda salida lleva score_version y sus insumos', () => {
    const point = computeFundamental(
      'liquid-staking',
      [observation({ tvlUsd: 42, fees24hUsd: 7 })],
      END,
      WINDOW,
    )!;
    expect(point.scoreVersion).toBe(SCORE_VERSION);
    expect(point.inputSnapshotIds.length).toBeGreaterThan(0);
  });
});

describe('comparabilidad del fundamento', () => {
  const obs = (o: Partial<FundamentalObservation>): FundamentalObservation => ({
    source: 'defillama',
    narrativeSlug: 'n',
    entity: 'lido',
    observedAt: at(1),
    tvlUsd: null,
    fees24hUsd: null,
    volume24hUsd: null,
    snapshotId: 's',
    ...o,
  });

  it('añadir un componente no dispara el valor: la escala se mantiene', () => {
    const dos = computeFundamental('n', [obs({ tvlUsd: 1e9, fees24hUsd: 1e5 })], END, WINDOW)!;
    const tres = computeFundamental(
      'n',
      [obs({ tvlUsd: 1e9, fees24hUsd: 1e5, volume24hUsd: 1e6 })],
      END,
      WINDOW,
    )!;
    // Sin normalizar por los pesos presentes, sumar un término más multiplicaba
    // el valor; ahora se queda en el mismo orden de magnitud.
    expect(tres.value / dos.value).toBeLessThan(1.3);
    expect(tres.value / dos.value).toBeGreaterThan(0.7);
  });

  it('el fundamento son los dólares sumados, no el promedio de sus logaritmos', () => {
    const tresDeMil = computeFundamental(
      'n',
      [
        obs({ tvlUsd: 1e9, fees24hUsd: 1e5, entity: 'a' }),
        obs({ tvlUsd: 1e9, fees24hUsd: 1e5, entity: 'b' }),
        obs({ tvlUsd: 1e9, fees24hUsd: 1e5, entity: 'c' }),
      ],
      END,
      WINDOW,
    )!;
    const unoDeTresMil = computeFundamental('n', [obs({ tvlUsd: 3e9, fees24hUsd: 3e5 })], END, WINDOW)!;
    // Tres protocolos con mil millones cada uno valen lo mismo que uno con tres
    // mil: lo que cuenta es el capital, no en cuántas entradas del diccionario
    // esté repartido.
    expect(tresDeMil.value).toBeCloseTo(unoDeTresMil.value, 9);

    // Y sí valen más que un solo protocolo de mil millones, porque hay más
    // dinero detrás. Eso no es un sesgo de cobertura, es el dato.
    const uno = computeFundamental('n', [obs({ tvlUsd: 1e9, fees24hUsd: 1e5 })], END, WINDOW)!;
    expect(tresDeMil.value).toBeGreaterThan(uno.value);
  });

  it('que aparezca una entidad diminuta no mueve la serie', () => {
    const grande = computeFundamental('n', [obs({ tvlUsd: 1e9, fees24hUsd: 1e5, entity: 'a' })], END, WINDOW)!;
    const conMigaja = computeFundamental(
      'n',
      [
        obs({ tvlUsd: 1e9, fees24hUsd: 1e5, entity: 'a' }),
        obs({ tvlUsd: 1e3, fees24hUsd: 1e-1, entity: 'b' }),
      ],
      END,
      WINDOW,
    )!;
    // Menos de una milésima de diferencia. Con la fórmula anterior —promediar
    // logaritmos entre entidades— este mismo caso movía la serie varios puntos.
    expect(Math.abs(conMigaja.value - grande.value)).toBeLessThan(0.001);
  });
});

describe('base mínima del compuesto', () => {
  const o = (x: Partial<FundamentalObservation>): FundamentalObservation => ({
    source: 'defillama',
    narrativeSlug: 'n',
    entity: 'lido',
    observedAt: at(1),
    tvlUsd: null,
    fees24hUsd: null,
    volume24hUsd: null,
    snapshotId: 's',
    ...x,
  });

  it('solo con TVL no se publica punto: no sería comparable con el resto', () => {
    expect(computeFundamental('n', [o({ tvlUsd: 1e9 })], END, WINDOW)).toBeNull();
  });

  it('con una señal de flujo al lado, sí', () => {
    expect(computeFundamental('n', [o({ tvlUsd: 1e9, fees24hUsd: 1e5 })], END, WINDOW)).not.toBeNull();
    expect(computeFundamental('n', [o({ volume24hUsd: 1e6 })], END, WINDOW)).not.toBeNull();
  });
});
