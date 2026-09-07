import type { Db, Tx } from '../pool.ts';

/** Día UTC del instante dado. El presupuesto se cuenta en UTC, no en local. */
export const usageDay = (at: Date): string => at.toISOString().slice(0, 10);

/** Suma una llamada y devuelve el total del día. Atómico. */
export async function bumpUsage(db: Db | Tx, provider: string, at: Date): Promise<number> {
  const { rows } = await db.query<{ bump_provider_usage: string }>(
    'select bump_provider_usage($1, $2) ',
    [provider, usageDay(at)],
  );
  return Number(rows[0]!.bump_provider_usage);
}

export async function usageToday(db: Db | Tx, provider: string, at: Date): Promise<number> {
  const { rows } = await db.query<{ calls: string }>(
    'select calls from provider_usage where provider = $1 and usage_day = $2',
    [provider, usageDay(at)],
  );
  return rows[0] ? Number(rows[0].calls) : 0;
}

/**
 * Enfriamiento pedido por el proveedor con `Retry-After`. Se guarda en la base
 * por la misma razón que el contador: sobrevive al reinicio, y volver antes de
 * tiempo es la forma más rápida de que un 429 se convierta en un bloqueo.
 */
export async function setCooldown(db: Db | Tx, provider: string, until: Date, at: Date): Promise<void> {
  await db.query(
    `insert into provider_usage (provider, usage_day, calls, cooldown_until)
     values ($1, $2, 0, $3)
     on conflict (provider, usage_day) do update
       set cooldown_until = greatest(
             coalesce(provider_usage.cooldown_until, to_timestamp(0)), excluded.cooldown_until),
           updated_at = now()`,
    [provider, usageDay(at), until],
  );
}

export async function cooldownUntil(db: Db | Tx, provider: string, at: Date): Promise<Date | null> {
  const { rows } = await db.query<{ cooldown_until: Date | null }>(
    'select cooldown_until from provider_usage where provider = $1 and usage_day = $2',
    [provider, usageDay(at)],
  );
  const until = rows[0]?.cooldown_until ?? null;
  return until && until > at ? until : null;
}

/** Consumo por proveedor de un día, para el chequeo de salud (NFR-050). */
export async function usageReport(
  db: Db,
  at: Date,
): Promise<{ provider: string; calls: number; cooldownUntil: Date | null }[]> {
  const { rows } = await db.query(
    `select provider, calls, cooldown_until from provider_usage
      where usage_day = $1 order by provider`,
    [usageDay(at)],
  );
  return rows.map((r) => ({
    provider: r.provider as string,
    calls: Number(r.calls),
    cooldownUntil: (r.cooldown_until as Date | null) ?? null,
  }));
}
