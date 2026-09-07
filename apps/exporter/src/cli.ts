import { createPool } from '@momentum/db';
import { exportStaticData } from './export.ts';

const outDir = process.argv[2] ?? 'apps/web/public/data';
const db = createPool();
try {
  const result = await exportStaticData({ db, outDir });
  console.log(`Exportadas ${result.narratives} narrativas → ${outDir}`);
  console.log(result.files.join('\n'));
} finally {
  await db.end();
}
