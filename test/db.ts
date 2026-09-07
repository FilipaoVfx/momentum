import { createPool, migrateUp, type Db } from '../packages/db/src/index.ts';

export const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://momentum:momentum@localhost:5432/momentum_test';

/**
 * Base de pruebas real, no un doble.
 *
 * Las invariantes que más importan en este sistema —`score_version` obligatorio,
 * insumos no vacíos, unicidad por origen— viven en el esquema. Probarlas contra
 * un mock probaría el mock.
 */
export async function testDb(): Promise<Db> {
  const db = createPool(TEST_DATABASE_URL);
  await migrateUp(db);
  return db;
}

export async function truncateAll(db: Db): Promise<void> {
  await db.query(`
    truncate table collection_gap, outcome, quadrant_state, metric_point,
                   fundamental_observation, mention_event, source_snapshot,
                   narrative_entity, narrative, run, provider_usage
    restart identity cascade`);
}
