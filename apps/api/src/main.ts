import Fastify from 'fastify';
import { createPool, usageReport } from '@momentum/db';
import { registerIngestRoute } from './ingest-route.ts';

/**
 * Esqueleto del plano caliente.
 *
 * En M0/M1 solo expone salud. El lens (scatter-gather, SSE, singleflight) llega
 * en M2 y aterrizará aquí reutilizando las primitivas de `@momentum/sources`,
 * que ya existen y ya están probadas por el plano frío.
 */
const app = Fastify({ logger: true, bodyLimit: 8 * 1024 * 1024 });
const db = createPool();

registerIngestRoute(app, db);

/**
 * Chequeo de salud por dependencia (NFR-052). Reporta la causa concreta, no un
 * booleano: "degradado" sin decir qué está degradado no sirve para nada.
 */
app.get('/health', async (_request, reply) => {
  const checks: Record<string, { status: 'ok' | 'down'; detail?: string }> = {};
  try {
    await db.query('select 1');
    checks['store'] = { status: 'ok' };
  } catch (error) {
    checks['store'] = { status: 'down', detail: (error as Error).message };
  }
  // Consumo de cuota por proveedor: sin esto, "degradado" no dice por qué
  // (NFR-050).
  let usage: unknown;
  try {
    usage = await usageReport(db, new Date());
  } catch {
    usage = null;
  }

  const healthy = Object.values(checks).every((c) => c.status === 'ok');
  return reply
    .code(healthy ? 200 : 503)
    .send({ status: healthy ? 'ok' : 'degraded', checks, usage });
});

const port = Number(process.env['PORT'] ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
