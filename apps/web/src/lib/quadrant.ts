import type { Quadrant } from '@momentum/core';

/**
 * El cuadrante se identifica por su posición en la rejilla y por su nombre, no
 * por color: son cuatro estados, no cuatro niveles de bondad, y pintarlos de
 * verde a rojo sugeriría una recomendación que no damos (M§12).
 */
export const QUADRANTS: Readonly<
  Record<Quadrant, { label: string; meaning: string; attention: 'up' | 'flat'; fundamental: 'up' | 'flat' }>
> = {
  confirmed: {
    label: 'Confirmada',
    meaning: 'Real, pero vas tarde: el dinero llegó y la conversación también.',
    attention: 'up',
    fundamental: 'up',
  },
  pure_narrative: {
    label: 'Puro relato',
    meaning: 'Sube la conversación y el fundamento no la sigue. Riesgo de techo.',
    attention: 'up',
    fundamental: 'flat',
  },
  quiet_build: {
    label: 'Construcción silenciosa',
    meaning: 'El fundamento crece antes de que nadie esté mirando.',
    attention: 'flat',
    fundamental: 'up',
  },
  dead: {
    label: 'Muerta',
    meaning: 'Miramos y no se movió ninguno de los dos ejes.',
    attention: 'flat',
    fundamental: 'flat',
  },
};

/** Orden de la rejilla 2×2, tal como aparece en el README. */
export const GRID: readonly Quadrant[] = ['confirmed', 'pure_narrative', 'quiet_build', 'dead'];

/**
 * Acceso a la definición de un cuadrante. Existe como función para que el
 * `noUncheckedIndexedAccess` del proyecto no obligue a salpicar de `!` cada
 * pantalla: la clave es una unión cerrada y siempre resuelve.
 */
export const quadrantInfo = (quadrant: Quadrant): (typeof QUADRANTS)[Quadrant] =>
  QUADRANTS[quadrant];
