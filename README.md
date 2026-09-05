# Momentum

Contexto de narrativa para tokens cripto. Cruza **atención** y **fundamento** en
una sola pantalla, con procedencia verificable y una postura explícita sobre lo
que no sabemos.

Pegas una dirección de contrato y en menos de tres segundos sabes a qué relato
pertenece, si ese relato está respaldado por dinero o solo por conversación, y
desde cuándo.

No es un terminal de trading. No es un bot de señales. Es la capa de contexto
que ninguno de los dos tiene.

---

## El problema

La información cripto no está escasa — está fragmentada por eje. Kaito ve
atención, DefiLlama ve fundamento, DEX Screener ve liquidez. El cruce entre los
tres lo hace hoy el usuario, de memoria, bajo presión de tiempo.

Ese cruce es el producto.

## El cuadrante

Dos series independientes por narrativa clasifican cada relato en cuatro
estados:

| | Fundamento ↑ | Fundamento plano |
|---|---|---|
| **Atención ↑** | Confirmada — real, pero vas tarde | Puro relato — riesgo de techo |
| **Atención plana** | **Construcción silenciosa** | Muerta |

---

## Arquitectura en una línea

Dos planos con presupuestos de latencia incompatibles, comunicados por un store
compartido: un **plano frío** (worker, 15 min) que descubre y calcula series, y
un **plano caliente** (request, deadline 2,5 s) que responde consultas puntuales.

Detalle completo y decisiones registradas en [`docs/ARD.md`](docs/ARD.md).

---

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | Problema, usuarios, alcance del MVP, métricas y riesgos |
| [`docs/SRS.md`](docs/SRS.md) | Requisitos funcionales y no funcionales con ID |
| [`docs/ARD.md`](docs/ARD.md) | Arquitectura, modelo de concurrencia y ADRs |
| [`docs/MANIFIESTO-CALIDAD.md`](docs/MANIFIESTO-CALIDAD.md) | Criterio de calidad y filosofía OSINT |

**Orden de lectura sugerido:** manifiesto → PRD → ARD → SRS. El manifiesto va
primero porque los otros tres se derivan de él; los requisitos del SRS trazan de
vuelta a sus principios con marcas `[M§n]`.

---

## Estado

MVP en definición. Ningún código todavía.

Hitos en [`docs/PRD.md`](docs/PRD.md) §10. El siguiente es **M0 — Esqueleto**:
store, esquema e ingesta de dos fuentes, con criterio de salida en un snapshot
completo persistido con procedencia.

---

## Principios que no se negocian

Del [manifiesto](docs/MANIFIESTO-CALIDAD.md), los cinco que más condicionan cada
PR:

1. **Contexto o nada.** Ningún número llega a pantalla sin responder: comparado
   con qué, de dónde salió, qué tan viejo es.
2. **Incompleto y honesto le gana a completo e inventado.** Nada de rellenar
   huecos con estimaciones sin marcarlas.
3. **La señal se pondera por el costo de mentir.** Un like es barato; un flujo
   on-chain no.
4. **El reporte circular cuenta como una sola fuente.** Cuarenta cuentas citando
   un hilo es un dato, no cuarenta.
5. **Nuestro KPI es el acierto, no el engagement.** Toda métrica que suba cuando
   el usuario duda más es una métrica que no perseguimos.

## Lo que no somos

Un dashboard más, un bot de señales, una herramienta de vigilancia, ni un
competidor por milisegundos de ejecución. Competimos por contexto.
