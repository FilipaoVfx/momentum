import type { SourceResult } from '@momentum/core';
import { gap } from '@momentum/core';
import type { FetchedSnapshot, SourceGateway } from '../gateway.ts';

/**
 * Reddit — eje de atención, extremo barato del espectro.
 *
 * La recolección es pasiva (NFR-042): leemos el listado público de nuevos
 * envíos y no interactuamos, no votamos y no anunciamos interés en nada.
 *
 * Reddit devuelve 403 al JSON público desde infraestructura de servidor, así
 * que la única ruta soportada es OAuth de aplicación. Sin credenciales no se
 * intenta la llamada: se declara la brecha y la corrida sigue sin este eje
 * (ADR-006). Es preferible una serie que dice "aquí no miré" a una que aparenta
 * cobertura social que no existe.
 */

export const OAUTH_HOST = 'https://oauth.reddit.com';
const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
/** Margen para no usar un token que expira mientras la corrida está en curso. */
const TOKEN_SAFETY_MS = 60_000;

export const requestKeys = {
  newListing: (subreddit: string) => `reddit:new:${subreddit.toLowerCase()}`,
} as const;

export interface RedditCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly userAgent: string;
}

export function credentialsFromEnv(env = process.env): RedditCredentials | null {
  const clientId = env['REDDIT_CLIENT_ID'];
  const clientSecret = env['REDDIT_CLIENT_SECRET'];
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    userAgent: env['REDDIT_USER_AGENT'] ?? 'momentum/0.1 (cold-plane ingest)',
  };
}

interface CachedToken {
  readonly value: string;
  readonly expiresAt: number;
}
let cachedToken: CachedToken | null = null;

/**
 * El token no pasa por el gateway y por lo tanto no se persiste: un snapshot es
 * evidencia que guardamos y consultamos, y una credencial no tiene por qué
 * acabar en una tabla.
 */
export async function accessToken(
  credentials: RedditCredentials,
  fetchImpl: typeof fetch = globalThis.fetch,
  now: () => number = Date.now,
): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - TOKEN_SAFETY_MS > now()) return cachedToken.value;

  const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': credentials.userAgent,
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`Reddit rechazó las credenciales de aplicación: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('Reddit no devolvió access_token');
  cachedToken = {
    value: body.access_token,
    expiresAt: now() + (body.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

/** Solo para pruebas: olvida el token cacheado. */
export const resetTokenCache = (): void => {
  cachedToken = null;
};

export async function fetchNewListing(
  gateway: SourceGateway,
  subreddit: string,
  options: {
    readonly limit?: number;
    readonly credentials?: RedditCredentials | null;
    readonly fetchImpl?: typeof fetch;
  } = {},
): Promise<SourceResult<FetchedSnapshot>> {
  const credentials = options.credentials ?? credentialsFromEnv();
  if (!credentials) {
    return gap({
      source: 'reddit',
      reason: 'not_configured',
      detail:
        `${requestKeys.newListing(subreddit)}: sin REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET; ` +
        'el eje de atención social queda sin cubrir en esta corrida',
    });
  }

  let token: string;
  try {
    token = await accessToken(credentials, options.fetchImpl ?? globalThis.fetch);
  } catch (error) {
    return gap({
      source: 'reddit',
      reason: 'source_down',
      detail: `${requestKeys.newListing(subreddit)}: ${(error as Error).message}`,
    });
  }

  return gateway.get({
    source: 'reddit',
    baseUrl: OAUTH_HOST,
    path: `/r/${encodeURIComponent(subreddit)}/new?limit=${options.limit ?? 100}&raw_json=1`,
    requestKey: requestKeys.newListing(subreddit),
    headers: { authorization: `Bearer ${token}`, 'user-agent': credentials.userAgent },
  });
}

export interface RedditPost {
  readonly fullname: string;
  readonly permalink: string;
  readonly linkedUrl: string | null;
  readonly isSelf: boolean;
  readonly crosspostParent: string | null;
  readonly author: string;
  readonly createdAt: Date;
  readonly ups: number;
  readonly numComments: number;
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Extrae los envíos de un listado. Lo que el listado no trae —la antigüedad y
 * el historial del autor— se queda como desconocido; averiguarlo costaría una
 * llamada por autor y suponerlo sería inventar (M§4).
 */
export function parseListing(payload: unknown): RedditPost[] {
  const children = asRecord(asRecord(payload)?.['data'])?.['children'];
  if (!Array.isArray(children)) return [];

  const posts: RedditPost[] = [];
  for (const child of children) {
    const d = asRecord(asRecord(child)?.['data']);
    if (!d) continue;
    const fullname = typeof d['name'] === 'string' ? d['name'] : null;
    const createdUtc = typeof d['created_utc'] === 'number' ? d['created_utc'] : null;
    if (!fullname || createdUtc === null) continue;

    const parents = d['crosspost_parent_list'];
    const parentFullname =
      typeof d['crosspost_parent'] === 'string'
        ? d['crosspost_parent']
        : Array.isArray(parents) && parents.length > 0
          ? ((asRecord(parents[0])?.['name'] as string | undefined) ?? null)
          : null;

    posts.push({
      fullname,
      permalink: typeof d['permalink'] === 'string' ? d['permalink'] : `/${fullname}`,
      linkedUrl: typeof d['url'] === 'string' ? d['url'] : null,
      isSelf: d['is_self'] === true,
      crosspostParent: parentFullname,
      author: typeof d['author'] === 'string' ? d['author'] : '[desconocido]',
      createdAt: new Date(createdUtc * 1000),
      ups: typeof d['ups'] === 'number' ? d['ups'] : 0,
      numComments: typeof d['num_comments'] === 'number' ? d['num_comments'] : 0,
    });
  }
  return posts;
}
