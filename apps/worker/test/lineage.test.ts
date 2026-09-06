import { describe, expect, it } from 'vitest';
import type { RedditPost } from '@momentum/sources';
import { canonicalizeUrl, redditRootOrigin } from '../src/lineage.ts';

const post = (o: Partial<RedditPost> = {}): RedditPost => ({
  fullname: 't3_abc',
  permalink: '/r/ethstaker/comments/abc/',
  linkedUrl: null,
  isSelf: true,
  crosspostParent: null,
  author: 'alguien',
  createdAt: new Date('2026-01-10T00:00:00Z'),
  ups: 1,
  numComments: 0,
  ...o,
});

describe('canonicalización de URL', () => {
  it('descarta los parámetros que existen para que dos enlaces iguales parezcan distintos', () => {
    expect(canonicalizeUrl('https://blog.io/post?utm_source=x&id=7')).toBe(
      canonicalizeUrl('https://www.blog.io/post/?id=7&utm_campaign=y'),
    );
  });

  it('ordena los parámetros que sí importan', () => {
    expect(canonicalizeUrl('https://a.io/x?b=2&a=1')).toBe(canonicalizeUrl('https://a.io/x?a=1&b=2'));
  });

  it('no confunde recursos distintos', () => {
    expect(canonicalizeUrl('https://a.io/x?id=1')).not.toBe(canonicalizeUrl('https://a.io/x?id=2'));
  });

  it('no revienta con una entrada que no es una URL', () => {
    expect(canonicalizeUrl('esto no es una url')).toBe('esto no es una url');
  });
});

describe('origen raíz (ADR-005, M§17)', () => {
  it('una réplica declara su origen y se le cree', () => {
    expect(redditRootOrigin(post({ crosspostParent: 't3_raiz', isSelf: false }))).toBe('reddit:t3_raiz');
  });

  it('cuarenta réplicas de un mismo hilo comparten clave', () => {
    const claves = new Set(
      Array.from({ length: 40 }, (_, i) =>
        redditRootOrigin(post({ fullname: `t3_r${i}`, crosspostParent: 't3_raiz', isSelf: false })),
      ),
    );
    expect(claves.size).toBe(1);
  });

  it('cien envíos del mismo artículo son un artículo', () => {
    const a = redditRootOrigin(post({ isSelf: false, linkedUrl: 'https://n.io/a?utm_source=tg' }));
    const b = redditRootOrigin(post({ fullname: 't3_otro', isSelf: false, linkedUrl: 'https://n.io/a' }));
    expect(a).toBe(b);
    expect(a).toBe('url:n.io/a');
  });

  it('un enlace a un hilo de Reddit apunta al hilo, no a un dominio externo', () => {
    expect(
      redditRootOrigin(
        post({ isSelf: false, linkedUrl: 'https://www.reddit.com/r/ethstaker/comments/raiz/titulo/' }),
      ),
    ).toBe('reddit:t3_raiz');
  });

  it('un texto original es su propio origen', () => {
    expect(redditRootOrigin(post())).toBe('reddit:t3_abc');
  });

  it('dos publicaciones originales distintas no se colapsan', () => {
    expect(redditRootOrigin(post({ fullname: 't3_uno' }))).not.toBe(
      redditRootOrigin(post({ fullname: 't3_dos' })),
    );
  });
});
