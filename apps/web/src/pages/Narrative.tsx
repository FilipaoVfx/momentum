import { useEffect, useState } from 'react';
import type { NarrativeDetail } from '@momentum/exporter';
import { GapList } from '../components/GapList.tsx';
import { Measured } from '../components/Measured.tsx';
import { SeriesChart } from '../components/SeriesChart.tsx';
import { ageLabel, loadNarrative } from '../lib/data.ts';
import { quadrantInfo } from '../lib/quadrant.ts';
import { Notice } from './Feed.tsx';

export function Narrative({ slug, onBack }: { slug: string; onBack: () => void }): JSX.Element {
  const [detail, setDetail] = useState<NarrativeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    loadNarrative(slug)
      .then(setDetail)
      .catch((e: unknown) => setError((e as Error).message));
  }, [slug]);

  if (error) return <Notice>{error}</Notice>;
  if (!detail) return <Notice>Cargando…</Notice>;

  const quadrant = detail.quadrant ? quadrantInfo(detail.quadrant) : null;

  return (
    <div className="space-y-8">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="text-sm underline decoration-dotted underline-offset-2"
          style={{ color: 'var(--text-muted)' }}
        >
          ← todas las narrativas
        </button>
        <h1 className="mt-2 text-2xl font-semibold">{detail.name}</h1>
        {quadrant ? (
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <strong>{quadrant.label}</strong>
            {detail.since && ` desde ${ageLabel(detail.since)}`} — {quadrant.meaning}
          </p>
        ) : (
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            Sin clasificar: {detail.insufficientDataReason}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Measured
          label="Atención"
          measured={detail.attention}
          accent="var(--attention)"
          missingReason="Ninguna fuente social cubrió esta narrativa en la ventana."
        />
        <Measured
          label="Fundamento"
          measured={detail.fundamental}
          accent="var(--fundamental)"
          missingReason="Ninguna entidad de esta narrativa devolvió métricas on-chain."
        />
      </div>

      {/* Dos gráficos, no dos ejes en uno: son escalas distintas y superponerlas
          insinuaría una correlación que nadie ha medido. */}
      <div className="space-y-6">
        <SeriesChart
          title="Atención en el tiempo"
          points={detail.series.attention}
          accent="var(--attention)"
          emptyMessage="Sin serie de atención. Las fuentes sociales no están cubriendo esta narrativa."
        />
        <SeriesChart
          title="Fundamento en el tiempo"
          points={detail.series.fundamental}
          accent="var(--fundamental)"
          emptyMessage="Sin serie de fundamento."
        />
      </div>

      <section>
        <h2 className="text-base font-semibold">De dónde sale la atención</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <strong className="tabular-nums">{detail.origins}</strong> orígenes distintos en{' '}
          <strong className="tabular-nums">{detail.mentions}</strong> menciones.
        </p>
        <p className="mt-1 max-w-2xl text-xs" style={{ color: 'var(--text-muted)' }}>
          La distancia entre ambos números es replicación: cuarenta cuentas citando el mismo hilo
          cuentan como un origen, no como cuarenta. Es lo que separa un consenso de una campaña
          coordinada.
        </p>
      </section>

      {detail.quadrantHistory.length > 0 && (
        <section>
          <h2 className="text-base font-semibold">Histórico de cuadrantes</h2>
          <ol className="mt-2 space-y-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {detail.quadrantHistory.map((period) => (
              <li key={period.startedAt} className="flex flex-wrap gap-x-2 tabular-nums">
                <span className="font-medium">{quadrantInfo(period.quadrant).label}</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {period.startedAt} → {period.endedAt ?? 'ahora'}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section>
        <h2 className="text-base font-semibold">Entidades del diccionario</h2>
        <dl className="mt-2 space-y-1 text-xs">
          {Object.entries(detail.entities)
            .filter(([, values]) => values.length > 0)
            .map(([kind, values]) => (
              <div key={kind} className="flex flex-wrap gap-2">
                <dt className="font-medium" style={{ color: 'var(--text-secondary)' }}>
                  {kind}:
                </dt>
                <dd style={{ color: 'var(--text-muted)' }}>{values.join(', ')}</dd>
              </div>
            ))}
        </dl>
      </section>

      <GapList gaps={detail.gaps} />
    </div>
  );
}
