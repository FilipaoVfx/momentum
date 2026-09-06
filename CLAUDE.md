# CLAUDE.md — cómo trabajar en este repositorio

Contexto de producto en `README.md`; los cuatro documentos de `docs/` mandan
sobre este fichero. El manifiesto de calidad no es aspiracional: es el criterio
con el que se rechaza un PR.

## Comandos

```bash
pnpm install
pnpm migrate up          # aplica migraciones (DATABASE_URL)
pnpm migrate down        # revierte la última
pnpm dict:sync           # narratives/*.yaml → base
pnpm worker:once         # una corrida del plano frío contra la red
pnpm worker:replay --from=-14d [--score-version=v2]
pnpm worker:outcomes     # evalúa clasificaciones a 7/14/30 días
pnpm worker:serve        # worker con cron
pnpm typecheck && pnpm lint && pnpm test
```

Las pruebas necesitan Postgres en `TEST_DATABASE_URL` (por defecto
`postgres://momentum:momentum@localhost:5432/momentum_test`). Ninguna prueba
toca la red: las fuentes se sustituyen por una red falsa determinista.

## Estructura y regla de dependencia

```
packages/core     dominio puro — sin red, sin base, sin reloj
packages/db       esquema, migraciones y repositorios
packages/sources   única puerta de salida a la red
apps/worker       plano frío
apps/api          plano caliente (solo /health hasta M2)
narratives/       diccionario curado, 15 ficheros YAML
```

`core` no importa nada del repositorio. `db` y `sources` importan `core`. Las
apps importan las tres. Un import en sentido contrario es un fallo de revisión:
es lo que mantiene el scoring testeable sin infraestructura.

## Invariantes que no se negocian

1. **Toda llamada externa pasa por `SourceGateway`** (`packages/sources`), que
   persiste el crudo con hash y `fetched_at` antes de parsear. Si escribes un
   `fetch` fuera de ahí, la procedencia se pierde y el replay deja de ser fiel.
2. **Un fallo de fuente es un valor de retorno**, no una excepción:
   `SourceResult<T>` es `ok` o una `CollectionGap` con motivo. La degradación
   parcial es el camino normal del código.
3. **Ninguna fila producida sin `score_version` ni sin `input_snapshot_ids`.**
   El esquema lo impide; no busques la manera de rodearlo.
4. **La deduplicación es por origen**, nunca por texto ni por URL cruda
   (`apps/worker/src/lineage.ts`). El test de las cuarenta réplicas es la línea
   roja de ese fichero.
5. **Un hueco no vale cero.** Un campo ausente se omite y se declara en
   `collection_gap`; nunca se hereda de la corrida anterior sin marcarlo.
6. **Vivo y replay comparten código** (`apps/worker/src/derive.ts`). Si añades
   una fuente, la derivación debe funcionar leyendo un snapshot guardado, no
   solo una respuesta recién llegada.
7. **Sin puntos suficientes no se clasifica.** `insufficient_data` no es
   `dead`: "muerta" significa que miramos y no se movió.

## Añadir una fuente

1. Adaptador en `packages/sources/src/adapters/` con `fetchX` (usa el gateway) y
   un `parseX` **puro**. Declara su calificación Admiralty en `config.ts` con la
   razón, no con un valor por defecto.
2. Rama en `deriveFromSnapshot` con una `requestKey` estable: es lo que permite
   al replay saber qué representaba ese snapshot.
3. Peso en `packages/core/src/scoring/v1.ts` justificado por su costo de
   fabricación. Una fuente nueva con peso igual "por simplicidad" convierte el
   score en un detector de campañas de marketing.
4. Si cambias pesos o fórmula, sube `SCORE_VERSION`. Es barato y es lo único que
   hace comparables dos corridas.

## Definición de terminado

La checklist vive en `docs/MANIFIESTO-CALIDAD.md`. Antes de abrir un PR, la
pregunta única: ¿el usuario sale sabiendo algo que no sabía, o solo viendo algo
que ya podía ver en otro lado?
