import { describe, expect, it } from 'vitest';
import {
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

  it('un campo ausente no vale cero: se omite del agregado', () => {
    const withNull = computeFundamental(
      'liquid-staking',
      [observation({ tvlUsd: 1_000_000 })],
      END,
      WINDOW,
    );
    const withZero = computeFundamental(
      'liquid-staking',
      [observation({ tvlUsd: 1_000_000, fees24hUsd: 0 })],
      END,
      WINDOW,
    );
    expect(withNull!.value).toBe(withZero!.value);
    expect(withNull!.value).toBeGreaterThan(0);
  });

  it('sin ningún campo con dato no hay punto', () => {
    expect(computeFundamental('liquid-staking', [observation({})], END, WINDOW)).toBeNull();
  });

  it('toda salida lleva score_version y sus insumos', () => {
    const point = computeFundamental(
      'liquid-staking',
      [observation({ tvlUsd: 42 })],
      END,
      WINDOW,
    )!;
    expect(point.scoreVersion).toBe('v1');
    expect(point.inputSnapshotIds.length).toBeGreaterThan(0);
  });
});
