import { useMemo, useRef, useState } from 'react';
import type { SeriesPoint } from '@momentum/exporter';
import { ageLabel } from '../lib/data.ts';

/**
 * Una serie, un eje.
 *
 * Atención y fundamento **nunca** comparten gráfico: son magnitudes de escalas
 * distintas y superponerlas con dos ejes verticales es la forma más rápida de
 * sugerir una correlación que nadie ha medido. Se dibujan como dos gráficos
 * apilados que comparten el eje de tiempo, que es lo que permite comparar la
 * forma sin inventar la relación.
 */
const W = 640;
const H = 180;
const PAD = { top: 16, right: 56, bottom: 24, left: 8 };

export function SeriesChart({
  title,
  points,
  accent,
  emptyMessage,
}: {
  title: string;
  points: readonly SeriesPoint[];
  accent: string;
  emptyMessage: string;
}): JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const model = useMemo(() => {
    if (points.length === 0) return null;
    const times = points.map((p) => Date.parse(p.at));
    const values = points.map((p) => p.value);
    const t0 = Math.min(...times);
    const t1 = Math.max(...times);
    const min = Math.min(...values);
    const max = Math.max(...values);
    // Margen del 8% para que la línea no toque los bordes del área.
    const span = max - min || Math.abs(max) || 1;
    const lo = min - span * 0.08;
    const hi = max + span * 0.08;

    const x = (t: number): number =>
      PAD.left + ((t - t0) / (t1 - t0 || 1)) * (W - PAD.left - PAD.right);
    const y = (v: number): number =>
      PAD.top + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD.top - PAD.bottom);

    return {
      x,
      y,
      coords: points.map((p, i) => ({ ...p, cx: x(times[i]!), cy: y(p.value), t: times[i]! })),
      t0,
      t1,
    };
  }, [points]);

  if (!model || points.length === 0) {
    return (
      <figure className="m-0">
        <figcaption className="mb-2 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          {title}
        </figcaption>
        <div
          className="flex h-[180px] items-center justify-center rounded-lg border border-dashed px-6 text-center text-sm"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        >
          {emptyMessage}
        </div>
      </figure>
    );
  }

  const path = model.coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.cx},${c.cy}`).join(' ');
  const last = model.coords.at(-1)!;
  const active = hover === null ? null : model.coords[hover];

  const onMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((event.clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    for (let i = 1; i < model.coords.length; i += 1) {
      if (Math.abs(model.coords[i]!.cx - px) < Math.abs(model.coords[nearest]!.cx - px)) nearest = i;
    }
    setHover(nearest);
  };

  return (
    <figure className="m-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <figcaption className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          {title}
        </figcaption>
        <button
          type="button"
          onClick={() => setTable(!table)}
          className="text-xs underline decoration-dotted underline-offset-2"
          style={{ color: 'var(--text-muted)' }}
        >
          {table ? 'ver gráfico' : 'ver tabla'}
        </button>
      </div>

      {table ? (
        <div className="max-h-[180px] overflow-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-left text-xs tabular-nums">
            <thead style={{ color: 'var(--text-secondary)' }}>
              <tr>
                <th className="px-3 py-1.5 font-medium">Instante</th>
                <th className="px-3 py-1.5 font-medium">Valor</th>
              </tr>
            </thead>
            <tbody style={{ color: 'var(--text-muted)' }}>
              {[...points].reverse().map((p) => (
                <tr key={p.at}>
                  <td className="px-3 py-1">{p.at}</td>
                  <td className="px-3 py-1">{p.value.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full touch-none"
            style={{ height: H }}
            role="img"
            aria-label={`${title}: ${points.length} puntos entre ${points[0]!.at} y ${last.at}`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            {[0, 0.5, 1].map((f) => (
              <line
                key={f}
                x1={PAD.left}
                x2={W - PAD.right}
                y1={PAD.top + f * (H - PAD.top - PAD.bottom)}
                y2={PAD.top + f * (H - PAD.top - PAD.bottom)}
                stroke="var(--grid)"
                strokeWidth={1}
              />
            ))}

            <path d={path} fill="none" stroke={accent} strokeWidth={2} strokeLinejoin="round" />

            {/* Etiqueta directa solo del último valor: nunca un número por punto. */}
            <circle cx={last.cx} cy={last.cy} r={4} fill={accent} stroke="var(--surface-1)" strokeWidth={2} />
            <text
              x={last.cx + 10}
              y={last.cy + 4}
              fontSize={12}
              fill="var(--text-secondary)"
              className="tabular-nums"
            >
              {last.value.toFixed(2)}
            </text>

            {active && (
              <>
                <line
                  x1={active.cx}
                  x2={active.cx}
                  y1={PAD.top}
                  y2={H - PAD.bottom}
                  stroke="var(--text-muted)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <circle
                  cx={active.cx}
                  cy={active.cy}
                  r={5}
                  fill={accent}
                  stroke="var(--surface-1)"
                  strokeWidth={2}
                />
              </>
            )}
          </svg>

          {active && (
            <div
              className="pointer-events-none absolute top-0 rounded border px-2 py-1 text-xs shadow-sm"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--surface-1)',
                left: `${(active.cx / W) * 100}%`,
                transform: 'translateX(-50%)',
              }}
            >
              <div className="font-medium tabular-nums">{active.value.toFixed(3)}</div>
              <div style={{ color: 'var(--text-muted)' }}>{ageLabel(active.at)}</div>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
