import { useEffect, useState } from 'react';
import type { Feed as FeedData, Meta, NarrativeSummary } from '@momentum/exporter';
import { GapList } from '../components/GapList.tsx';
import { ageLabel, formatSigned, isStale, loadFeed, loadMeta } from '../lib/data.ts';
import { GRID, quadrantInfo } from '../lib/quadrant.ts';

export function Feed({ onOpen }: { onOpen: (slug: string) => void }): JSX.Element {
  const [feed, setFeed] = useState<FeedData | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadFeed(), loadMeta()])
      .then(([f, m]) => {
        setFeed(f);
        setMeta(m);
      })
      .catch((e: unknown) => setError((e as Error).message));
  }, []);

  if (error) return <Notice>{error}</Notice>;
  if (!feed || !meta) return <Notice>Cargando…</Notice>;

  const classified = feed.narratives.filter((n) => n.quadrant);
  const unclassified = feed.narratives.filter((n) => !n.quadrant);
  const globalGaps = feed.narratives.flatMap((n) => n.gaps).filter((g) => !g.narrativeSlug);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Narrativas</h1>
        <p className="max-w-2xl text-sm" style={{ color: 'var(--text-secondary)' }}>
          Cada narrativa cae en un cuadrante según el <strong>signo de la derivada</strong> de sus
          dos series, no según su nivel absoluto. Una narrativa sin puntos suficientes no se
          clasifica: aparece abajo, declarada.
        </p>
        <Freshness meta={meta} />
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {GRID.map((quadrant) => {
          const q = quadrantInfo(quadrant);
          const inQuadrant = classified.filter((n) => n.quadrant === quadrant);
          return (
            <section
              key={quadrant}
              className="rounded-xl border p-4"
              style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold">{q.label}</h2>
                <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  atención {q.attention === 'up' ? '↑' : '→'} · fundamento{' '}
                  {q.fundamental === 'up' ? '↑' : '→'}
                </span>
              </div>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                {q.meaning}
              </p>
              <ul className="mt-3 space-y-2">
                {inQuadrant.length === 0 ? (
                  <li className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Ninguna narrativa aquí ahora mismo.
                  </li>
                ) : (
                  inQuadrant.map((n) => (
                    <li key={n.slug}>
                      <NarrativeRow narrative={n} onOpen={onOpen} />
                    </li>
                  ))
                )}
              </ul>
            </section>
          );
        })}
      </div>

      {unclassified.length > 0 && (
        <section
          className="rounded-xl border border-dashed p-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <h2 className="text-base font-semibold">Sin datos suficientes para clasificar</h2>
          <p className="mt-1 max-w-2xl text-xs" style={{ color: 'var(--text-muted)' }}>
            No son narrativas muertas. «Muerta» significa que miramos y no se movió; esto significa
            que todavía no tenemos con qué opinar.
          </p>
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {unclassified.map((n) => (
              <li key={n.slug}>
                <NarrativeRow narrative={n} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <GapList gaps={globalGaps} title="Lo que no vimos en la última corrida" />
    </div>
  );
}

function NarrativeRow({
  narrative,
  onOpen,
}: {
  narrative: NarrativeSummary;
  onOpen: (slug: string) => void;
}): JSX.Element {
  const campaign = narrative.mentions > 0 && narrative.origins < narrative.mentions;
  return (
    <button
      type="button"
      onClick={() => onOpen(narrative.slug)}
      className="w-full rounded-lg border px-3 py-2 text-left transition-colors"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{narrative.name}</span>
        {narrative.since && (
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            desde {ageLabel(narrative.since)}
          </span>
        )}
      </div>
      <div
        className="mt-1 flex flex-wrap gap-x-3 text-[11px] tabular-nums"
        style={{ color: 'var(--text-secondary)' }}
      >
        <Axis label="atención" measured={narrative.attention} color="var(--attention)" />
        <Axis label="fundamento" measured={narrative.fundamental} color="var(--fundamental)" />
        {campaign && (
          <span title="Menciones frente a orígenes distintos: la distancia es replicación.">
            {narrative.origins} orígenes / {narrative.mentions} menciones
          </span>
        )}
      </div>
    </button>
  );
}

function Axis({
  label,
  measured,
  color,
}: {
  label: string;
  measured: NarrativeSummary['attention'];
  color: string;
}): JSX.Element {
  if (!measured) {
    return (
      <span style={{ color: 'var(--text-muted)' }}>
        {label}: sin datos
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} />
      {label}: {measured.value.toFixed(2)}
      {measured.comparison.change7d !== null && (
        <span style={{ color: 'var(--text-muted)' }}>
          ({formatSigned(measured.comparison.change7d)} 7d)
        </span>
      )}
    </span>
  );
}

export function Freshness({ meta }: { meta: Meta }): JSX.Element {
  const stale = isStale(meta.generatedAt);
  return (
    <p className="text-xs" style={{ color: stale ? 'var(--fundamental)' : 'var(--text-muted)' }}>
      Generado {ageLabel(meta.generatedAt)} · {meta.coverage.classified} de{' '}
      {meta.coverage.narratives} narrativas clasificadas ·{' '}
      {meta.coverage.withAttention} con eje de atención
      {stale && ' · el sitio se regenera por tarea programada y esta copia está vieja'}
    </p>
  );
}

export function Notice({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <p className="py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
      {children}
    </p>
  );
}
