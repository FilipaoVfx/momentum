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
| [`docs/FUENTES.md`](docs/FUENTES.md) | Acceso, límites y credenciales de cada fuente |

**Orden de lectura sugerido:** manifiesto → PRD → ARD → SRS. El manifiesto va
primero porque los otros tres se derivan de él; los requisitos del SRS trazan de
vuelta a sus principios con marcas `[M§n]`.

---

## Ver el MVP

**https://filipaovfx.github.io/momentum/**

Tres pantallas, dos flujos cerrados:

- **Narrativas** — las 15 narrativas colocadas en el cuadrante real de dos ejes.
  Las que no tienen datos suficientes aparecen aparte y declaradas, nunca como
  «muertas».
- **Narrativa** — las dos series en el tiempo (dos gráficos, nunca dos ejes en
  uno), el histórico de cuadrantes, la distancia entre orígenes y menciones, y la
  brecha de recolección de la última corrida.
- **Lens** — pegas un contrato y los bloques se pintan según llegan. Las llamadas
  salen **del navegador**: DEX Screener y GeckoTerminal responden con CORS
  abierto, así que este flujo no necesita servidor. La distribución de tenedores
  aparece como no disponible, porque lo es.

El sitio es estático y se regenera por tarea programada, así que declara cuándo
se generó y marca el dato como viejo cuando lo es. Detalle en
[`docs/ARD.md`](docs/ARD.md), ADR-015.

---

## Estado

**M0 y M1 implementados.** Hitos en [`docs/PRD.md`](docs/PRD.md) §10.

| Hito | Estado | Criterio de salida |
|---|---|---|
| M0 — Esqueleto | Hecho | Snapshot completo persistido con procedencia |
| M1 — Plano frío | Hecho | Serie de 14 días reconstruible desde crudos |
| M2 — Lens | Pendiente | p95 < 3 s con 4 fuentes bajo carga sintética |

Lo que hay hoy: worker del plano frío con ingesta cada 15 minutos, series de
atención y fundamento por narrativa, clasificación de cuadrante con su
histórico, deduplicación por origen, tabla de outcomes y reconstrucción completa
de la historia desde los snapshots crudos sin tocar la red. `apps/api` existe
pero solo expone `/health`: el lens llega en M2.

### Arrancar en local

```bash
docker compose up -d postgres          # o un Postgres 16 propio
cp .env.example .env                   # y rellenar DATABASE_URL
pnpm install
pnpm migrate up                        # esquema
pnpm dict:sync                         # 15 narrativas curadas → base
pnpm worker:backfill --days=14         # historia real de fundamento
pnpm worker:once                       # una corrida contra las fuentes reales
pnpm export apps/web/public/data       # JSON que consume el sitio
pnpm --filter @momentum/web dev        # el sitio en local
pnpm test                              # 121 pruebas, ninguna depende de la red
```

`pnpm worker:replay --from=-14d` recalcula la historia leyendo solo
`source_snapshot`: cero llamadas externas. Es el criterio de salida de M1 y, con
`--score-version=`, el modo sombra para evaluar una fórmula nueva contra el
pasado.

### Fuentes

| Fuente | Eje | Estado | Cadencia |
|---|---|---|---|
| DefiLlama | Fundamento | Operativa, sin credenciales | 60 min |
| Polymarket | Atención (capital en riesgo) | Operativa, sin credenciales | 15 min |
| Reddit | Atención (social) | Requiere `REDDIT_CLIENT_ID`/`SECRET`; sin ellas la corrida declara la brecha y sigue | 15 min |

Cada proveedor tiene techo por minuto y presupuesto diario, y el sistema respeta
`Retry-After` cuando le piden esperar. Detalle de accesos, límites medidos y
credenciales en [`docs/FUENTES.md`](docs/FUENTES.md).

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
