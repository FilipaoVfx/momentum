import type { Feed, Meta, NarrativeDetail } from '@momentum/exporter';

/**
 * El sitio es estático: todo lo precalculado viaja como JSON generado por el
 * plano frío en CI. No hay servidor detrás, y por eso cada fichero trae su
 * `generatedAt` — la página declara su antigüedad en vez de aparentar tiempo
 * real.
 */
const base = import.meta.env.BASE_URL;

async function load<T>(path: string): Promise<T> {
  const response = await fetch(`${base}data/${path}`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`No se pudo cargar ${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

export const loadFeed = (): Promise<Feed> => load<Feed>('feed.json');
export const loadMeta = (): Promise<Meta> => load<Meta>('meta.json');
export const loadNarrative = (slug: string): Promise<NarrativeDetail> =>
  load<NarrativeDetail>(`narratives/${slug}.json`);

/** Antigüedad legible. Nunca "actualizado recientemente" (manifiesto, 3ª pregunta). */
export function ageLabel(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'hace menos de un minuto';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

/** Un dato con más antigüedad que su TTL se marca viejo, siempre (NFR-021). */
export const isStale = (iso: string, ttlMinutes = 90, now = Date.now()): boolean =>
  now - Date.parse(iso) > ttlMinutes * 60_000;

export const formatUsd = (value: number): string =>
  new Intl.NumberFormat('es', {
    style: 'currency',
    currency: 'USD',
    notation: value >= 1_000_000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value);

export const formatSigned = (value: number, digits = 2): string =>
  `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
