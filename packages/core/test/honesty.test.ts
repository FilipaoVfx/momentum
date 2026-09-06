import { describe, expect, it } from 'vitest';
import {
  PROBABILITY_BANDS,
  bandFor,
  describeRating,
  inference,
  observation,
  parseRating,
  valuation,
} from '../src/index.ts';

describe('bandas de probabilidad (M§20, FR-033)', () => {
  it('toda expresión cae en una banda publicada', () => {
    for (const p of [2, 10, 30, 50, 70, 90, 97]) {
      expect(PROBABILITY_BANDS).toContainEqual(bandFor(p));
    }
  });

  it('rechaza la certeza disfrazada de estimación', () => {
    expect(() => bandFor(100)).toThrow();
    expect(() => bandFor(0)).toThrow();
  });
});

describe('calificación Admiralty (M§16)', () => {
  it('separa fiabilidad de la fuente y credibilidad del dato', () => {
    expect(describeRating(parseRating('B2'))).toContain('Usualmente confiable');
    expect(describeRating(parseRating('E2'))).toContain('No confiable');
  });

  it('rechaza códigos inválidos', () => {
    expect(() => parseRating('Z9')).toThrow();
  });
});

describe('registros (M§19, FR-032)', () => {
  it('una observación necesita evidencia', () => {
    expect(() => observation('la wallet X compró 40.000 tokens', [])).toThrow();
    expect(observation('la wallet X compró 40.000 tokens', ['snap']).register).toBe('observation');
  });

  it('una inferencia necesita su n', () => {
    expect(() => inference('precedió movimientos similares', 0, ['snap'])).toThrow();
    const i = inference('precedió movimientos similares', 14, ['snap']);
    expect(i.register === 'inference' && i.sampleSize).toBe(14);
  });

  it('una valoración lleva su banda, no un adjetivo', () => {
    const v = valuation('parece acumulación temprana', 65, ['flujo previo']);
    expect(v.register === 'valuation' && v.band.label).toBe('probable');
  });
});
