import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './pool.ts';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const UP_MARKER = '-- +migrate up';
const DOWN_MARKER = '-- +migrate down';

export interface Migration {
  readonly name: string;
  readonly up: string;
  readonly down: string;
}

/**
 * Cada fichero es SQL plano con dos secciones marcadas. Sin DSL de migraciones:
 * el esquema es la parte del sistema que más se lee y menos se debería traducir.
 */
export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const migrations: Migration[] = [];
  for (const file of files) {
    const sql = await readFile(join(dir, file), 'utf8');
    const upAt = sql.indexOf(UP_MARKER);
    const downAt = sql.indexOf(DOWN_MARKER);
    if (upAt === -1 || downAt === -1 || downAt < upAt) {
      throw new Error(`${file}: faltan los marcadores "${UP_MARKER}" y "${DOWN_MARKER}"`);
    }
    migrations.push({
      name: file.replace(/\.sql$/, ''),
      up: sql.slice(upAt + UP_MARKER.length, downAt),
      down: sql.slice(downAt + DOWN_MARKER.length),
    });
  }
  return migrations;
}

async function ensureLedger(db: Db): Promise<void> {
  await db.query(`
    create table if not exists schema_migration (
      name       text primary key,
      applied_at timestamptz not null default now()
    )`);
}

export async function appliedMigrations(db: Db): Promise<string[]> {
  await ensureLedger(db);
  const { rows } = await db.query<{ name: string }>(
    'select name from schema_migration order by name',
  );
  return rows.map((r) => r.name);
}

export async function migrateUp(db: Db, dir?: string): Promise<string[]> {
  const applied = new Set(await appliedMigrations(db));
  const pending = (await loadMigrations(dir)).filter((m) => !applied.has(m.name));
  for (const m of pending) {
    await db.query('begin');
    try {
      await db.query(m.up);
      await db.query('insert into schema_migration (name) values ($1)', [m.name]);
      await db.query('commit');
    } catch (error) {
      await db.query('rollback');
      throw new Error(`Migración ${m.name} falló: ${(error as Error).message}`, { cause: error });
    }
  }
  return pending.map((m) => m.name);
}

/** Revierte la última migración aplicada. */
export async function migrateDown(db: Db, dir?: string): Promise<string | null> {
  const applied = await appliedMigrations(db);
  const last = applied.at(-1);
  if (!last) return null;
  const migration = (await loadMigrations(dir)).find((m) => m.name === last);
  if (!migration) throw new Error(`No existe el fichero de la migración aplicada ${last}`);
  await db.query('begin');
  try {
    await db.query(migration.down);
    await db.query('delete from schema_migration where name = $1', [last]);
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
  return last;
}
