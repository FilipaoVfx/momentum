import type { MeasuredValue } from '@momentum/exporter';
import { formatSigned } from '../lib/data.ts';
import { Provenance } from './Provenance.tsx';

/**
 * Un número con sus tres respuestas o nada.
 *
 * Si el exportador no pudo acompañarlo de comparación y procedencia, aquí llega
 * `null` y se pinta el estado de ausencia — que es visualmente distinto de un
 * cero y de un dato viejo (FR-004, M§4).
 */
export function Measured({
  label,
  measured,
  accent,
  missingReason,
}: {
  label: string;
  measured: MeasuredValue | null;
  accent: string;
  missingReason: string;
}): JSX.Element {
  if (!measured) {
    return (
      <div
        className="rounded-lg border border-dashed p-4"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </div>
        <div className="mt-1 text-lg" style={{ color: 'var(--text-muted)' }}>
          sin datos
        </div>
        <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          {missingReason}
        </p>
      </div>
    );
  }

  const { comparison } = measured;
  return (
    <div
      className="rounded-lg border p-4"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block h-2.5 w-2.5 rounded-sm"
          style={{ background: accent }}
        />
        <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </span>
      </div>

      <div className="mt-1 text-2xl font-semibold tabular-nums">
        {measured.value.toFixed(2)}
      </div>

      {/* ¿Comparado con qué? Nunca un valor absoluto solo. */}
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
        {comparison.change7d === null ? (
          <span style={{ color: 'var(--text-muted)' }}>sin 7 días de historia todavía</span>
        ) : (
          <span>{formatSigned(comparison.change7d)} en 7 d</span>
        )}
        {comparison.percentileAmongPeers !== null && (
          <span>
            percentil {comparison.percentileAmongPeers} de {comparison.peerCount + 1}
          </span>
        )}
      </div>

      <Provenance provenance={measured.provenance} />
    </div>
  );
}
