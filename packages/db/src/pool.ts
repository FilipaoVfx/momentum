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

/**
 * Esquema donde vive Momentum. Existe para poder compartir un Postgres con otro
 * proyecto sin pisarle nada: todo lo nuestro queda bajo `momentum.*` y `public`
 * se queda como estaba.
 */
export const schemaName = (): string => process.env['DB_SCHEMA'] ?? 'momentum';

export function createPool(connectionString = process.env['DATABASE_URL']): Db {
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL no está definida. El store es la única dependencia dura del ' +
        'sistema (ARD §7): sin él no hay degradación parcial posible.',
    );
  }
  const schema = schemaName();
  const pool = new Pool({
    connectionString,
    max: 10,
    // `public` se mantiene en la ruta para que `gen_random_uuid` y demás
    // funciones de extensión sigan resolviendo.
    options: `-c search_path=${schema},public`,
  });
  return pool;
}

/** Crea el esquema si no existe. Idempotente; la llama el CLI de migraciones. */
export async function ensureSchema(db: Db): Promise<string> {
  const schema = schemaName();
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
    throw new Error(`Nombre de esquema no válido: ${schema}`);
  }
  await db.query(`create schema if not exists ${schema}`);
  return schema;
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
