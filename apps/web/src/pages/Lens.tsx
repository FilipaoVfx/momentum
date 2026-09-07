import { useEffect, useState } from 'react';
import type { Feed, NarrativeSummary } from '@momentum/exporter';
import { GapList } from '../components/GapList.tsx';
import { ageLabel, formatUsd, loadFeed } from '../lib/data.ts';
import {
  fetchDexScreener,
  fetchGeckoTerminal,
  geckoNetwork,
  riskFlags,
  type LensSnapshot,
  type RiskFlag,
} from '../lib/lens.ts';
import { quadrantInfo } from '../lib/quadrant.ts';

type Block<T> = { state: 'idle' | 'loading' } | { state: 'ok'; value: T } | { state: 'gap'; detail: string };

const EJEMPLO = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export function Lens({ onOpen }: { onOpen: (slug: string) => void }): JSX.Element {
  const [address, setAddress] = useState('');
  const [market, setMarket] = useState<Block<LensSnapshot>>({ state: 'idle' });
  const [second, setSecond] = useState<Block<{ priceUsd: number | null; fetchedAt: string }>>({
    state: 'idle',
  });
  const [feed, setFeed] = useState<Feed | null>(null);

  useEffect(() => {
    loadFeed()
      .then(setFeed)
      .catch(() => setFeed(null));
  }, []);

  /**
   * Entrega incremental (FR-002): cada bloque se pinta cuando su fuente
   * responde, no cuando responden todas. La percepción de latencia la fija el
   * bloque más rápido, no el más lento.
   */
  const consultar = (value: string): void => {
    const target = value.trim();
    if (!target) return;
    setMarket({ state: 'loading' });
    setSecond({ state: 'idle' });

    fetchDexScreener(target)
      .then((snapshot) => {
        setMarket({ state: 'ok', value: snapshot });
        const network = geckoNetwork(snapshot.identity.chain);
        if (!network) {
          setSecond({
            state: 'gap',
            detail: `GeckoTerminal no cubre la cadena "${snapshot.identity.chain}"`,
          });
          return;
        }
        setSecond({ state: 'loading' });
        fetchGeckoTerminal(network, target)
          .then((value) => setSecond({ state: 'ok', value }))
          .catch((e: unknown) => setSecond({ state: 'gap', detail: (e as Error).message }));
      })
      .catch((e: unknown) => setMarket({ state: 'gap', detail: (e as Error).message }));
  };

  const snapshot = market.state === 'ok' ? market.value : null;
  const narrative = snapshot && feed ? matchNarrative(feed, snapshot.identity.symbol) : null;
  const flags = snapshot ? riskFlags(snapshot) : [];

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Lens de token</h1>
        <p className="max-w-2xl text-sm" style={{ color: 'var(--text-secondary)' }}>
          Pega una dirección de contrato. Los bloques se pintan según llegan, cada uno con su fuente
          y su hora de captura. Lo que no podemos ver aparece declarado, no vacío.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          consultar(address);
        }}
        className="flex flex-wrap gap-2"
      >
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Dirección de contrato (Solana, Base, Ethereum…)"
          className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--surface-1)',
            color: 'var(--text-primary)',
          }}
          aria-label="Dirección de contrato"
        />
        <button
          type="submit"
          className="rounded-lg px-4 py-2 text-sm font-medium"
          style={{ background: 'var(--attention)', color: '#fff' }}
        >
          Consultar
        </button>
        <button
          type="button"
          onClick={() => {
            setAddress(EJEMPLO);
            consultar(EJEMPLO);
          }}
          className="rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
        >
          Probar con USDC
        </button>
      </form>

      {market.state === 'loading' && <Skeleton />}

      {market.state === 'gap' && (
        <GapList
          gaps={[
            {
              source: 'dexscreener',
              reason: 'source_down',
              detail: `No se pudo resolver la dirección: ${market.detail}`,
              narrativeSlug: null,
            },
          ]}
          title="No se pudo consultar"
        />
      )}

      {snapshot && (
        <div className="space-y-6">
          <BlockCard
            title="Identidad y liquidez"
            source="dexscreener"
            fetchedAt={snapshot.fetchedAt}
          >
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-xl font-semibold">{snapshot.identity.symbol}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{snapshot.identity.name}</span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {snapshot.identity.chain}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="Liquidez total" value={formatUsd(snapshot.totalLiquidityUsd)} />
              <Stat label="Volumen 24 h" value={formatUsd(snapshot.totalVolume24hUsd)} />
              <Stat label="Pares" value={String(snapshot.pairs.length)} />
            </dl>
            <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              Suma de {snapshot.pairs.length} pares; el mayor aporta{' '}
              {snapshot.totalLiquidityUsd > 0
                ? Math.round(
                    ((snapshot.pairs[0]?.liquidityUsd ?? 0) / snapshot.totalLiquidityUsd) * 100,
                  )
                : 0}
              % de la liquidez.
            </p>
          </BlockCard>

          <BlockCard
            title="Precio, contrastado"
            source="dexscreener + geckoterminal"
            fetchedAt={snapshot.fetchedAt}
          >
            {snapshot.priceUsd === null ? (
              <p style={{ color: 'var(--text-muted)' }}>Ningún par publicó precio.</p>
            ) : (
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <div>
                  <div className="text-xl font-semibold tabular-nums">
                    ${snapshot.priceUsd.toPrecision(6)}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    DEX Screener
                  </div>
                </div>
                <div>
                  <div className="text-xl font-semibold tabular-nums">
                    {second.state === 'ok' && second.value.priceUsd !== null
                      ? `$${second.value.priceUsd.toPrecision(6)}`
                      : second.state === 'loading'
                        ? '…'
                        : '—'}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {second.state === 'gap' ? `GeckoTerminal: ${second.detail}` : 'GeckoTerminal'}
                  </div>
                </div>
              </div>
            )}
          </BlockCard>

          <BlockCard title="Contexto de narrativa" source="momentum (plano frío)" fetchedAt={null}>
            {narrative ? (
              <button type="button" onClick={() => onOpen(narrative.slug)} className="text-left">
                <div className="text-lg font-semibold underline decoration-dotted underline-offset-4">
                  {narrative.name}
                </div>
                <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {narrative.quadrant ? (
                    <>
                      <strong>{quadrantInfo(narrative.quadrant).label}</strong>
                      {narrative.since && ` desde ${ageLabel(narrative.since)}`} —{' '}
                      {quadrantInfo(narrative.quadrant).meaning}
                    </>
                  ) : (
                    `Sin clasificar: ${narrative.insufficientDataReason ?? 'faltan datos'}`
                  )}
                </p>
              </button>
            ) : (
              <p style={{ color: 'var(--text-muted)' }}>
                <strong>{snapshot.identity.symbol}</strong> no resuelve a ninguna narrativa del
                diccionario curado. No le asignamos la más parecida: preferimos decir que no lo
                sabemos.
              </p>
            )}
          </BlockCard>

          <BlockCard title="Banderas evaluadas de oficio" source="derivadas de dexscreener" fetchedAt={snapshot.fetchedAt}>
            {flags.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)' }}>
                Ninguna de las banderas que evaluamos se activó. Eso no significa que no haya riesgo:
                significa que no vimos <em>estos</em> patrones.
              </p>
            ) : (
              <ul className="space-y-2">
                {flags.map((flag: RiskFlag) => (
                  <li key={flag.label}>
                    <div className="text-sm font-medium">{flag.label}</div>
                    <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {flag.detail}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </BlockCard>

          <BlockCard title="Distribución de tenedores" source="—" fetchedAt={null} unavailable>
            <p style={{ color: 'var(--text-muted)' }}>
              <strong>No disponible.</strong> Requiere un RPC con clave: el endpoint público de
              Solana devuelve 429 en la primera llamada. No es un cero ni un dato viejo — es algo
              que no hemos podido mirar, y hasta que se pueda seguirá diciendo esto.
            </p>
          </BlockCard>
        </div>
      )}
    </div>
  );
}

function matchNarrative(feed: Feed, symbol: string): NarrativeSummary | null {
  const wanted = symbol.toUpperCase();
  return feed.narratives.find((n) => n.tickers.some((t) => t.toUpperCase() === wanted)) ?? null;
}

function BlockCard({
  title,
  source,
  fetchedAt,
  unavailable,
  children,
}: {
  title: string;
  source: string;
  fetchedAt: string | null;
  unavailable?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section
      className={`rounded-xl border p-4 ${unavailable ? 'border-dashed' : ''}`}
      style={{
        borderColor: 'var(--border)',
        background: unavailable ? 'transparent' : 'var(--surface-1)',
      }}
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {source}
          {fetchedAt && ` · ${ageLabel(fetchedAt)}`}
        </span>
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {label}
      </dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Skeleton(): JSX.Element {
  return (
    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
      Consultando fuentes en vivo… cada bloque aparecerá en cuanto su fuente responda.
    </p>
  );
}
