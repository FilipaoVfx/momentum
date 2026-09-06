import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEAD_BAND_PER_DAY,
  classifyQuadrant,
  evaluateOutcome,
  slopePerDay,
  type MetricPoint,
} from '../src/index.ts';

const series = (values: readonly number[], axis: MetricPoint['axis'] = 'attention'): MetricPoint[] =>
  values.map((value, i) => ({
    narrativeSlug: 'n',
    axis,
    window: '24h',
    observedAt: new Date(Date.UTC(2026, 0, 1 + i)),
    value,
    scoreVersion: 'v1',
    inputSnapshotIds: ['s'],
  }));

describe('pendiente', () => {
  it('mide crecimiento por día', () => {
    expect(slopePerDay(series([1, 2, 3, 4]))).toBeCloseTo(1, 10);
  });

  it('no opina con menos de cuatro puntos', () => {
    expect(slopePerDay(series([1, 2, 3]))).toBeNull();
  });
});

describe('cuadrante (FR-021)', () => {
  const flat = [1, 1.001, 1.002, 1.003];
  const rising = [1, 1.3, 1.7, 2.2];

  it('atención y fundamento subiendo: confirmada', () => {
    const v = classifyQuadrant(series(rising), series(rising, 'fundamental'));
    expect(v.kind === 'classified' && v.quadrant).toBe('confirmed');
  });

  it('atención sube y fundamento no: puro relato', () => {
    const v = classifyQuadrant(series(rising), series(flat, 'fundamental'));
    expect(v.kind === 'classified' && v.quadrant).toBe('pure_narrative');
  });

  it('fundamento sube y atención no: construcción silenciosa', () => {
    const v = classifyQuadrant(series(flat), series(rising, 'fundamental'));
    expect(v.kind === 'classified' && v.quadrant).toBe('quiet_build');
  });

  it('ninguno se mueve: muerta', () => {
    const v = classifyQuadrant(series(flat), series(flat, 'fundamental'));
    expect(v.kind === 'classified' && v.quadrant).toBe('dead');
  });

  it('un movimiento dentro de la banda muerta no es movimiento', () => {
    const withinBand = [1, 1 + DEFAULT_DEAD_BAND_PER_DAY / 2, 1 + DEFAULT_DEAD_BAND_PER_DAY, 1 + DEFAULT_DEAD_BAND_PER_DAY * 1.5];
    const v = classifyQuadrant(series(withinBand), series(flat, 'fundamental'));
    expect(v.kind === 'classified' && v.quadrant).toBe('dead');
  });

  it('sin puntos suficientes declara falta de datos en vez de decir "muerta"', () => {
    const v = classifyQuadrant(series([1, 2]), series([1, 2], 'fundamental'));
    expect(v.kind).toBe('insufficient_data');
  });
});

describe('evaluación de outcomes (M§14)', () => {
  it('construcción silenciosa acierta si el fundamento crece', () => {
    expect(
      evaluateOutcome({
        quadrant: 'quiet_build',
        attentionChange: 0,
        fundamentalChange: 5,
        horizonDays: 7,
      }),
    ).toBe('confirmed');
  });

  it('construcción silenciosa falla si el fundamento cae', () => {
    expect(
      evaluateOutcome({
        quadrant: 'quiet_build',
        attentionChange: 0,
        fundamentalChange: -5,
        horizonDays: 7,
      }),
    ).toBe('refuted');
  });

  it('puro relato acierta cuando el fundamento no llega', () => {
    expect(
      evaluateOutcome({
        quadrant: 'pure_narrative',
        attentionChange: 2,
        fundamentalChange: 0,
        horizonDays: 14,
      }),
    ).toBe('confirmed');
  });

  it('sin serie en el horizonte no se inventa un veredicto', () => {
    expect(
      evaluateOutcome({
        quadrant: 'confirmed',
        attentionChange: null,
        fundamentalChange: 1,
        horizonDays: 30,
      }),
    ).toBe('insufficient_data');
  });
});
