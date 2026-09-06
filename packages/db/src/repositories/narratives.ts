import type { Db, Tx } from '../pool.ts';

export type EntityKind = 'defillama_protocol' | 'subreddit' | 'polymarket_tag' | 'ticker';

export interface NarrativeRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: 'active' | 'retired';
  readonly entities: Readonly<Record<EntityKind, readonly string[]>>;
}

export interface NarrativeInput {
  readonly slug: string;
  readonly name: string;
  readonly dictionaryVersion: string;
  readonly entities: Readonly<Partial<Record<EntityKind, readonly string[]>>>;
}

const emptyEntities = (): Record<EntityKind, string[]> => ({
  defillama_protocol: [],
  subreddit: [],
  polymarket_tag: [],
  ticker: [],
});

/** Upsert idempotente: el diccionario curado vive en git y se sincroniza (ADR-004). */
export async function upsertNarrative(tx: Tx, input: NarrativeInput): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `insert into narrative (slug, name, dictionary_version)
     values ($1, $2, $3)
     on conflict (slug) do update
       set name = excluded.name,
           dictionary_version = excluded.dictionary_version,
           updated_at = now()
     returning id`,
    [input.slug, input.name, input.dictionaryVersion],
  );
  const id = rows[0]!.id;

  await tx.query('delete from narrative_entity where narrative_id = $1', [id]);
  for (const [kind, values] of Object.entries(input.entities)) {
    for (const value of values ?? []) {
      await tx.query(
        `insert into narrative_entity (narrative_id, kind, value) values ($1, $2, $3)
         on conflict do nothing`,
        [id, kind, value],
      );
    }
  }
  return id;
}

export async function listNarratives(db: Db | Tx): Promise<NarrativeRecord[]> {
  const { rows } = await db.query(
    `select n.id, n.slug, n.name, n.status,
            coalesce(json_agg(json_build_object('kind', e.kind, 'value', e.value))
                     filter (where e.id is not null), '[]') as entities
       from narrative n
       left join narrative_entity e on e.narrative_id = n.id
      where n.status = 'active'
      group by n.id
      order by n.slug`,
  );
  return rows.map((r) => {
    const entities = emptyEntities();
    for (const e of r.entities as { kind: EntityKind; value: string }[]) {
      entities[e.kind].push(e.value);
    }
    return {
      id: r.id as string,
      slug: r.slug as string,
      name: r.name as string,
      status: r.status as 'active' | 'retired',
      entities,
    };
  });
}
