import pg from 'pg';

const { Pool, types } = pg;

/**
 * `numeric` llega como string para no perder precisión. En este sistema los
 * valores de serie son magnitudes en coma flotante y los queremos como número:
 * la precisión decimal exacta no aporta nada y el string contamina el dominio.
 */
types.setTypeParser(1700, (v) => Number(v));

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(connectionString = process.env['DATABASE_URL']): Db {
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL no está definida. El store es la única dependencia dura del ' +
        'sistema (ARD §7): sin él no hay degradación parcial posible.',
    );
  }
  return new Pool({ connectionString, max: 10 });
}

export async function withTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
