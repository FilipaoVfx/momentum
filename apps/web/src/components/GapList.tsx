import type { DeclaredGap } from '@momentum/exporter';

/**
 * Lo que no vimos, dicho en voz alta (M§23, FR-014). Sin denominador no hay
 * porcentaje, y sin brecha declarada la ausencia de evidencia se lee como
 * evidencia de ausencia.
 */
export function GapList({ gaps, title = 'Brecha de recolección' }: {
  gaps: readonly DeclaredGap[];
  title?: string;
}): JSX.Element | null {
  if (gaps.length === 0) return null;
  return (
    <section
      className="rounded-lg border p-4"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
    >
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-2 space-y-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
        {gaps.map((gap, i) => (
          <li key={`${gap.source}-${gap.reason}-${i}`} className="flex gap-2">
            <span
              className="shrink-0 rounded px-1.5 py-0.5 font-medium"
              style={{ background: 'var(--surface-0)', color: 'var(--text-muted)' }}
            >
              {gap.source}
            </span>
            <span>{gap.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
