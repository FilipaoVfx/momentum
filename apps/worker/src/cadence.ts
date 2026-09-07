import { lastFetchedAt, type Db } from '@momentum/db';

/**
 * Cadencia por familia de solicitud.
 *
 * El plano frío corre cada 15 minutos, pero no todo necesita ese ritmo. El TVL
 * de un protocolo no se mueve de forma apreciable en un cuarto de hora, y las
 * comisiones y el volumen que publica DefiLlama son totales de 24 h: pedirlos
 * cuatro veces por hora es gastar cuota en recibir el mismo número.
 *
 * Medido sobre el diccionario de 15 narrativas, bajar el eje de fundamento a
 * cadencia horaria lleva DefiLlama de 5.088 a 1.272 llamadas diarias sin perder
 * un solo punto de la serie, porque la ventana de agregación es de 24 h.
 *
 * La decisión es de *cuándo* llamar y vive aquí, en el worker. El gateway sigue
 * ocupándose solo de *cómo* llamar.
 */
export const CADENCE_MS = {
  /** Donde ocurre el movimiento de atención. */
  fast: 15 * 60 * 1000,
  /** Magnitudes lentas o agregados de 24 h. */
  slow: 60 * 60 * 1000,
} as const;

export type Cadence = keyof typeof CADENCE_MS;

/**
 * ¿Toca pedir esta clave? Se decide leyendo el store, así que sobrevive a un
 * reinicio del worker y el replay no se entera: reconstruye con los snapshots
 * que haya, sin importar a qué ritmo se capturaron.
 *
 * El margen del 10 % evita que una corrida disparada unos segundos antes de la
 * hora salte la captura y la deje para una hora más tarde.
 */
export async function isDue(
  db: Db,
  requestKey: string,
  cadence: Cadence,
  now: Date,
): Promise<boolean> {
  const last = await lastFetchedAt(db, requestKey);
  if (!last) return true;
  const interval = CADENCE_MS[cadence] * 0.9;
  return now.getTime() - last.getTime() >= interval;
}
