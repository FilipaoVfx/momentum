import { useEffect, useState } from 'react';
import { Feed } from './pages/Feed.tsx';
import { Lens } from './pages/Lens.tsx';
import { Narrative } from './pages/Narrative.tsx';

/**
 * Enrutado por hash: es lo que sobrevive en GitHub Pages sin reglas de
 * reescritura en el servidor, porque no hay servidor.
 */
type Route = { name: 'feed' } | { name: 'lens' } | { name: 'narrative'; slug: string };

const parse = (hash: string): Route => {
  const path = hash.replace(/^#\/?/, '');
  if (path.startsWith('n/')) return { name: 'narrative', slug: path.slice(2) };
  if (path === 'lens') return { name: 'lens' };
  return { name: 'feed' };
};

export function App(): JSX.Element {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));

  useEffect(() => {
    const onHash = (): void => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (hash: string): void => {
    window.location.hash = hash;
  };

  return (
    <div className="min-h-screen">
      <nav
        className="sticky top-0 z-10 border-b backdrop-blur"
        style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--surface-0) 88%, transparent)' }}
      >
        <div className="mx-auto flex max-w-4xl flex-wrap items-baseline gap-x-6 gap-y-1 px-4 py-3">
          <a href="#/" className="text-sm font-semibold">
            Momentum
          </a>
          <NavLink active={route.name !== 'lens'} onClick={() => go('#/')}>
            Narrativas
          </NavLink>
          <NavLink active={route.name === 'lens'} onClick={() => go('#/lens')}>
            Lens
          </NavLink>
          <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
            Evidencia, no órdenes
          </span>
        </div>
      </nav>

      <main className="mx-auto max-w-4xl px-4 py-8">
        {route.name === 'feed' && <Feed onOpen={(slug) => go(`#/n/${slug}`)} />}
        {route.name === 'lens' && <Lens onOpen={(slug) => go(`#/n/${slug}`)} />}
        {route.name === 'narrative' && (
          <Narrative slug={route.slug} onBack={() => go('#/')} />
        )}
      </main>

      <footer
        className="mx-auto max-w-4xl border-t px-4 py-6 text-xs"
        style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
      >
        <p>
          Momentum no emite señales de compra ni de venta. Muestra qué cambió, en qué dirección, con
          qué respaldo y con qué nivel de confianza. La decisión, el tamaño y el riesgo son tuyos.
        </p>
        <p className="mt-2">
          El sitio es estático y se regenera por tarea programada: cada pantalla declara cuándo se
          generó y qué no pudo ver.
        </p>
      </footer>
    </div>
  );
}

function NavLink({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-sm"
      style={{
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}
