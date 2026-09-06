import cron from 'node-cron';
import { createPool } from '@momentum/db';
import { DictionaryIndex, loadDictionary } from './dictionary.ts';
import { ingestOnce } from './ingest.ts';
import { evaluateOutcomes } from './outcomes.ts';

/**
 * Worker del plano frío.
 *
 * Dos programaciones con presupuestos independientes (ADR-008): la ingesta cada
 * 15 minutos y la evaluación de outcomes una vez al día. El descubrimiento —el
 * consumidor más pesado de cuota— tendrá la suya cuando exista, y por eso el
 * aislamiento está desde ahora y no se retrofitea.
 *
 * Un proceso de larga vida, no una función efímera: es lo que permite que el
 * singleflight y los semáforos por proveedor signifiquen algo.
 */
const db = createPool();
const index = new DictionaryIndex(await loadDictionary());

const ingestCron = process.env['INGEST_CRON'] ?? '*/15 * * * *';
const outcomesCron = process.env['OUTCOMES_CRON'] ?? '0 3 * * *';

let ingestRunning = false;

cron.schedule(ingestCron, () => {
  if (ingestRunning) {
    // Solaparse no aceleraría nada: duplicaría el consumo de cuota sobre las
    // mismas claves.
    console.warn('[ingest] corrida anterior todavía en curso; se salta este tick');
    return;
  }
  ingestRunning = true;
  ingestOnce({ db, index })
    .then((r) =>
      console.log(
        `[ingest] ${r.runId}: ${r.snapshotCount} snapshots, ` +
          `${r.batch?.pointsWritten ?? 0} puntos, ${r.gaps.length} brechas`,
      ),
    )
    .catch((error: unknown) => console.error('[ingest] falló:', error))
    .finally(() => {
      ingestRunning = false;
    });
});

cron.schedule(outcomesCron, () => {
  evaluateOutcomes({ db })
    .then((r) => console.log(`[outcomes] ${r.runId}: ${r.written} evaluados`))
    .catch((error: unknown) => console.error('[outcomes] falló:', error));
});

console.log(`Worker en marcha. Ingesta "${ingestCron}", outcomes "${outcomesCron}".`);

const shutdown = async (): Promise<void> => {
  console.log('Cerrando worker…');
  await db.end();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
