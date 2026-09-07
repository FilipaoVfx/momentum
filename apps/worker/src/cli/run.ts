import { createPool, listGaps } from '@momentum/db';
import { DictionaryIndex, loadDictionary } from '../dictionary.ts';
import { backfill } from '../backfill.ts';
import { ingestOnce } from '../ingest.ts';
import { evaluateOutcomes } from '../outcomes.ts';
import { replay } from '../replay.ts';

const command = process.argv[2] ?? 'once';
const args = new Map(
  process.argv.slice(3).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k ?? '', v ?? 'true'];
  }),
);

/** Acepta `--from=2026-01-01` y `--from=-14d`. */
function parseSince(raw: string): Date {
  const relative = /^-(\d+)d$/.exec(raw);
  if (relative) return new Date(Date.now() - Number(relative[1]) * 86_400_000);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error(`Fecha no reconocida: ${raw}`);
  return date;
}

const db = createPool();
try {
  if (command === 'once') {
    const index = new DictionaryIndex(await loadDictionary());
    const result = await ingestOnce({ db, index });
    console.log(
      `Corrida ${result.runId}: ${result.snapshotCount} snapshots, ` +
        `${result.batch?.mentionsInserted ?? 0} menciones, ` +
        `${result.batch?.pointsWritten ?? 0} puntos de serie.`,
    );
    const gaps = await listGaps(db, result.runId);
    console.log(
      gaps.length === 0
        ? 'Brecha de recolección: ninguna.'
        : `Brecha de recolección (${gaps.length}):\n` +
            gaps.map((g) => `  · ${g.source} ${g.reason}: ${g.detail}`).join('\n'),
    );
    if (result.batch) {
      for (const [slug, outcome] of Object.entries(result.batch.quadrants)) {
        console.log(`  ${slug}: ${outcome}`);
      }
    }
  } else if (command === 'replay') {
    const index = new DictionaryIndex(await loadDictionary());
    const from = parseSince(args.get('from') ?? '-14d');
    const scoreVersion = args.get('score-version');
    const result = await replay({
      db,
      index,
      from,
      ...(scoreVersion ? { scoreVersion } : {}),
    });
    const points = result.batches.reduce((n, b) => n + b.pointsWritten, 0);
    console.log(
      `Replay ${result.runId}: ${result.batches.length} corridas reconstruidas, ` +
        `${points} puntos de serie, 0 llamadas externas.`,
    );
  } else if (command === 'backfill') {
    const index = new DictionaryIndex(await loadDictionary());
    const days = Number(args.get('days') ?? '14');
    const result = await backfill({ db, index, days });
    console.log(
      `Backfill ${result.runId}: ${result.history.observations} observaciones, ` +
        `${result.history.pointsWritten} puntos en ${result.history.days} días.`,
    );
    console.log(
      'El eje de atención no se rellena: las fuentes sociales no publican ' +
        'historia. Se declara como brecha.',
    );
  } else if (command === 'outcomes') {
    const result = await evaluateOutcomes({ db });
    console.log(`Corrida ${result.runId}: ${result.written} outcomes evaluados.`);
  } else {
    console.error(
      'Uso: run [once|replay --from=-14d [--score-version=v1]|backfill --days=14|outcomes]',
    );
    process.exitCode = 1;
  }
} finally {
  await db.end();
}
