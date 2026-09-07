import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';

/**
 * Diccionario de narrativas curado a mano (ADR-004).
 *
 * Vive en git, no en la base: es dato de producto, se revisa en un PR y su
 * historia importa. Quince narrativas al lanzamiento, con fecha de revisión a
 * los 90 días.
 */

export const DEFAULT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'narratives',
);

const narrativeSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/, 'slug en minúsculas con guiones'),
  name: z.string().min(1),
  entities: z.object({
    defillama: z.array(z.string()).default([]),
    subreddits: z.array(z.string()).default([]),
    polymarket_tags: z.array(z.string()).default([]),
    tickers: z.array(z.string()).default([]),
  }),
});

export type NarrativeDefinition = z.infer<typeof narrativeSchema>;

export interface Dictionary {
  readonly version: string;
  readonly narratives: readonly NarrativeDefinition[];
}

export async function loadDictionary(dir = DEFAULT_DIR): Promise<Dictionary> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.yaml')).sort();
  const narratives: NarrativeDefinition[] = [];
  for (const file of files) {
    const raw = parse(await readFile(join(dir, file), 'utf8')) as unknown;
    const parsed = narrativeSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    }
    narratives.push(parsed.data);
  }

  const slugs = new Set<string>();
  for (const n of narratives) {
    if (slugs.has(n.slug)) throw new Error(`Slug duplicado en el diccionario: ${n.slug}`);
    slugs.add(n.slug);
  }
  return { version: `d${files.length}-${new Date().toISOString().slice(0, 10)}`, narratives };
}

/** Índices de resolución entidad → narrativas. Una entidad puede estar en varias. */
export class DictionaryIndex {
  readonly #byDefillama = new Map<string, string[]>();
  readonly #bySubreddit = new Map<string, string[]>();
  readonly #tags: { slug: string; tag: string; matcher: RegExp }[] = [];

  constructor(readonly dictionary: Dictionary) {
    for (const n of dictionary.narratives) {
      for (const p of n.entities.defillama) push(this.#byDefillama, p.toLowerCase(), n.slug);
      for (const s of n.entities.subreddits) push(this.#bySubreddit, s.toLowerCase(), n.slug);
      for (const tag of n.entities.polymarket_tags) {
        this.#tags.push({
          slug: n.slug,
          tag,
          // Frontera de palabra: "ai" no debe casar dentro de "chain".
          matcher: new RegExp(`\\b${escapeRegExp(tag.toLowerCase())}\\b`),
        });
      }
    }
  }

  narrativesForDefillama(protocol: string): string[] {
    return this.#byDefillama.get(protocol.toLowerCase()) ?? [];
  }

  narrativesForSubreddit(subreddit: string): string[] {
    return this.#bySubreddit.get(subreddit.toLowerCase()) ?? [];
  }

  /**
   * Emparejamiento de un mercado con narrativas por palabra clave.
   *
   * Es deliberadamente conservador: sin coincidencia, el mercado no se atribuye
   * a nadie. Preferimos una narrativa sin señal de mercado a una narrativa con
   * la señal de otra (FR-007 llevado a su consecuencia natural).
   */
  narrativesForText(text: string): string[] {
    const haystack = text.toLowerCase();
    const found = new Set<string>();
    for (const t of this.#tags) if (t.matcher.test(haystack)) found.add(t.slug);
    return [...found];
  }

  get defillamaProtocols(): string[] {
    return [...this.#byDefillama.keys()];
  }

  get subreddits(): string[] {
    return [...this.#bySubreddit.keys()];
  }
}

const push = (map: Map<string, string[]>, key: string, value: string): void => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
