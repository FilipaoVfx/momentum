import { useState } from 'react';
import type { Provenance as ProvenanceData } from '@momentum/exporter';
import { ageLabel, isStale } from '../lib/data.ts';

/**
 * De cualquier número se llega a su origen en un clic (M§7, FR-003). No es un
 * tooltip decorativo: es el requisito de que no pidamos confianza, sino que
 * ofrezcamos verificación.
 */
export function Provenance({ provenance }: { provenance: ProvenanceData }): JSX.Element {
  const [open, setOpen] = useState(false);
  const stale = isStale(provenance.fetchedAt);

  return (
    <div className="mt-2 text-xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 underline decoration-dotted underline-offset-2"
        style={{ color: 'var(--text-muted)' }}
        aria-expanded={open}
      >
        <span>{provenance.source}</span>
        <span aria-hidden>·</span>
        <span style={stale ? { color: 'var(--fundamental)', fontWeight: 600 } : undefined}>
          {stale ? `viejo · ${ageLabel(provenance.fetchedAt)}` : ageLabel(provenance.fetchedAt)}
        </span>
      </button>

      {open && (
        <dl
          className="mt-2 space-y-1 rounded border p-3"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
        >
          <Row label="Método">{provenance.method}</Row>
          <Row label="Versión del cálculo">{provenance.scoreVersion}</Row>
          <Row label="Capturado">
            <time dateTime={provenance.fetchedAt}>{provenance.fetchedAt}</time>
          </Row>
          <Row label="Snapshots">
            <code className="break-all">{provenance.snapshotIds.join(', ')}</code>
          </Row>
        </dl>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 font-medium" style={{ color: 'var(--text-secondary)' }}>
        {label}:
      </dt>
      <dd style={{ color: 'var(--text-muted)' }}>{children}</dd>
    </div>
  );
}
