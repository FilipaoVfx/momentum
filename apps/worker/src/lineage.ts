import type { RedditPost } from '@momentum/sources';

/**
 * Resolución de origen raíz (ADR-005, FR-012, M§17).
 *
 * Este es el fichero que separa medir narrativas de medir campañas de
 * marketing. Cuarenta cuentas citando el mismo hilo comparten una clave y
 * cuentan una vez; si dedujéramos por texto o por URL sin canonicalizar, una
 * campaña coordinada puntuaría como consenso orgánico.
 */

const TRACKING_PARAMS = /^(utm_|ref$|ref_|fbclid$|gclid$|igshid$|si$|s$|t$|feature$)/i;

/**
 * URL canónica: mismo recurso ⇒ misma clave. Se descartan los parámetros de
 * seguimiento, que existen precisamente para que dos enlaces al mismo sitio se
 * vean distintos.
 */
export function canonicalizeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return input.trim().toLowerCase();
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = new URLSearchParams(params).toString();
  const path = url.pathname.replace(/\/+$/, '') || '/';
  return `${host}${path}${query ? `?${query}` : ''}`;
}

/**
 * Clave de origen de un envío de Reddit, en orden de preferencia:
 *
 *   1. El padre del crosspost — la réplica declara su origen, se le cree.
 *   2. La URL enlazada canonicalizada — cien envíos del mismo artículo son un
 *      artículo.
 *   3. El propio envío — un texto original es su propio origen.
 */
export function redditRootOrigin(post: RedditPost): string {
  if (post.crosspostParent) return `reddit:${post.crosspostParent}`;
  if (!post.isSelf && post.linkedUrl) {
    const canonical = canonicalizeUrl(post.linkedUrl);
    // Un enlace a Reddit mismo apunta al hilo original, no a un dominio externo.
    const selfLink = /^reddit\.com\/r\/[^/]+\/comments\/([a-z0-9]+)/.exec(canonical);
    return selfLink ? `reddit:t3_${selfLink[1]}` : `url:${canonical}`;
  }
  return `reddit:${post.fullname}`;
}
