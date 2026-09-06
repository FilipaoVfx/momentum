import { createPool, upsertNarrative, withTransaction } from '@momentum/db';
import { loadDictionary } from '../dictionary.ts';

/** Sincroniza `narratives/*.yaml` con la base. Idempotente. */
const dictionary = await loadDictionary();
const db = createPool();
try {
  const slugs = await withTransaction(db, async (tx) => {
    const written: string[] = [];
    for (const n of dictionary.narratives) {
      await upsertNarrative(tx, {
        slug: n.slug,
        name: n.name,
        dictionaryVersion: dictionary.version,
        entities: {
          defillama_protocol: n.entities.defillama,
          subreddit: n.entities.subreddits,
          polymarket_tag: n.entities.polymarket_tags,
          ticker: n.entities.tickers,
        },
      });
      written.push(n.slug);
    }
    return written;
  });
  console.log(`Diccionario ${dictionary.version}: ${slugs.length} narrativas sincronizadas.`);
  console.log(slugs.join(', '));
} finally {
  await db.end();
}
