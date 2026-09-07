import { createPool, ensureSchema } from './pool.ts';
import { appliedMigrations, migrateDown, migrateUp } from './migrate.ts';

const command = process.argv[2] ?? 'up';
const db = createPool();

try {
  if (command === 'up') {
    console.log(`Esquema: ${await ensureSchema(db)}`);
    const applied = await migrateUp(db);
    console.log(applied.length ? `Aplicadas: ${applied.join(', ')}` : 'Sin migraciones pendientes.');
  } else if (command === 'down') {
    const reverted = await migrateDown(db);
    console.log(reverted ? `Revertida: ${reverted}` : 'Nada que revertir.');
  } else if (command === 'status') {
    console.log((await appliedMigrations(db)).join('\n') || '(ninguna aplicada)');
  } else {
    console.error(`Uso: migrate [up|down|status]`);
    process.exitCode = 1;
  }
} finally {
  await db.end();
}
