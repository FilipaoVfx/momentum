import Fastify from 'fastify';
import { createPool } from '@momentum/db';

/**
 * Esqueleto del plano caliente.
 *
 * En M0/M1 solo expone salud. El lens (scatter-gather, SSE, singleflight) llega
 * en M2 y aterrizará aquí reutilizando las primitivas de `@momentum/sources`,
 * que ya existen y ya están probadas por el plano frío.
 */
const app = Fastify({ logger: true });
const db = createPool();

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
  const healthy = Object.values(checks).every((c) => c.status === 'ok');
  return reply.code(healthy ? 200 : 503).send({ status: healthy ? 'ok' : 'degraded', checks });
});

const port = Number(process.env['PORT'] ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
