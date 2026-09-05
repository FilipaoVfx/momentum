# SRS — Momentum (MVP)

| | |
|---|---|
| Estado | Borrador para revisión |
| Versión | 0.1 |
| Documentos hermanos | `PRD.md`, `ARD.md`, `MANIFIESTO-CALIDAD.md` |

Convención: **DEBE** es obligatorio, **DEBERÍA** es fuertemente recomendado,
**PUEDE** es opcional. Cada requisito con `[M§n]` traza al principio
correspondiente del manifiesto de calidad.

---

## 1. Propósito y alcance

Este documento especifica el comportamiento requerido del sistema Momentum en su
versión MVP: el lens de token bajo demanda, el feed de narrativas emergentes, la
serie histórica por narrativa y la infraestructura de medición interna.

Fuera de alcance: ejecución de operaciones, alertas push, atribución nominal de
personas, backtest expuesto al usuario.

---

## 2. Definiciones

| Término | Definición |
|---|---|
| **Narrativa** | Entidad curada que agrupa tickers, contratos, protocolos, subreddits y cuentas bajo un mismo relato de mercado |
| **Atención** | Serie temporal derivada de fuentes sociales y de mercados de predicción, ponderada por costo de mentir |
| **Fundamento** | Serie temporal derivada de métricas on-chain: TVL, comisiones, volumen real, holders |
| **Cuadrante** | Clasificación en uno de cuatro estados según el signo de la derivada de ambas series |
| **Plano frío** | Procesamiento por lotes en worker, sin restricción de latencia de usuario |
| **Plano caliente** | Procesamiento en tiempo de solicitud, con presupuesto de latencia estricto |
| **Origen** | Publicación raíz de la que deriva una mención, independiente de cuántas veces se replique |
| **Snapshot crudo** | Respuesta sin transformar de una fuente, persistida con procedencia |

---

## 3. Actores e interfaces

| Actor | Interfaz |
|---|---|
| Usuario final | Web responsive |
| Worker de plano frío | Cola interna, programador por cadencia |
| Fuentes externas | HTTP/JSON, límites de tasa por proveedor |
| Operador del sistema | Panel de salud, métricas, alertas técnicas |

---

## 4. Requisitos funcionales

### 4.1 Lens de token

**FR-001** — El sistema DEBE aceptar una dirección de contrato y devolver la
ficha del token con: identidad, liquidez, distribución de tenedores, narrativa
asociada y banderas de riesgo.

**FR-002** — El sistema DEBE entregar la respuesta de forma incremental: cada
bloque se renderiza al estar listo, sin esperar al bloque más lento. `[M§3]`

**FR-003** — Cada bloque de la ficha DEBE mostrar su fuente, su método y su
timestamp de captura, accesibles desde la interfaz en máximo dos interacciones.
`[M§2, M§7]`

**FR-004** — Si una fuente no responde dentro de su presupuesto, el bloque
correspondiente DEBE renderizarse en estado "no disponible", visualmente
distinto de un valor cero y de un valor antiguo. `[M§3, M§4]`

**FR-005** — El sistema NO DEBE rellenar campos ausentes con estimaciones,
promedios de categoría ni valores heredados de una corrida anterior sin
marcarlos explícitamente como tales. `[M§4]`

**FR-006** — Cuando el token pertenece a una narrativa conocida, el sistema DEBE
mostrar el cuadrante actual de esa narrativa y cuánto tiempo lleva en él.

**FR-007** — Cuando el token no resuelve a ninguna narrativa del diccionario, el
sistema DEBE declararlo explícitamente en lugar de asignar la narrativa más
cercana.

### 4.2 Feed de narrativas emergentes

**FR-010** — El sistema DEBE producir, con cadencia máxima de 15 minutos, una
lista ordenada de narrativas emergentes con su etiqueta de momentum.

**FR-011** — El ranking DEBE basarse en la primera derivada de la atención y del
fundamento, no en su nivel absoluto.

**FR-012** — La deduplicación de menciones DEBE realizarse por origen, no por
texto ni por URL. Múltiples citas de una misma publicación raíz cuentan como una
sola observación. `[M§17]`

**FR-013** — Cada entrada del feed DEBE enlazar a las evidencias que la
sustentan.

**FR-014** — El feed DEBE declarar su brecha de recolección: fuentes caídas,
idiomas no cubiertos y ventanas no procesadas en la corrida. `[M§23]`

### 4.3 Narrativa, series y cuadrante

**FR-020** — El sistema DEBE mantener, por narrativa, dos series temporales
independientes: atención y fundamento.

**FR-021** — El sistema DEBE clasificar cada narrativa en uno de cuatro
cuadrantes: confirmada, puro relato, construcción silenciosa, muerta.

**FR-022** — Toda métrica mostrada DEBE ir acompañada de al menos una
comparación: variación temporal, posición relativa a pares, o distancia a una
referencia. `[M§1]`

**FR-023** — El sistema DEBE conservar el histórico de cuadrantes por narrativa,
incluyendo la fecha de cada transición.

### 4.4 Calificación de fuentes y evidencia

**FR-030** — Cada dato ingerido DEBE llevar dos calificaciones independientes:
fiabilidad de la fuente (A–F) y credibilidad del dato (1–6). `[M§16]`

**FR-031** — El scoring DEBE ponderar cada fuente por su costo de fabricación:
las señales respaldadas por capital en riesgo pesan más que las señales de
interacción social. `[M§5]`

**FR-032** — La salida DEBE distinguir tipográfica y semánticamente entre
observación, inferencia y valoración. Estos tres registros NO DEBEN combinarse
en una misma afirmación. `[M§19]`

**FR-033** — Toda expresión de probabilidad DEBE corresponder a una banda
numérica publicada. `[M§20]`

**FR-034** — El sistema DEBE evaluar de oficio, sobre cada narrativa y cada
token, las banderas de manipulación definidas en el manifiesto §22, y exponer
las que se activen.

### 4.5 Atribución

**FR-040** — El sistema DEBE producir un resumen agregado del impulso de cada
narrativa: proporción de cuentas nuevas, de cuentas con historial, y presencia
de flujo on-chain previo a la subida de atención.

**FR-041** — El sistema NO DEBE publicar métricas de acierto de actores
individuales en el MVP.

**FR-042** — El sistema NO DEBE vincular direcciones on-chain con identidades
reales, ni exponer correlaciones que permitan esa inferencia. `[M§24]`

**FR-043** — Cuando un análisis de atribución se base en correlación desfasada,
la salida DEBE incluir el tamaño de muestra y una advertencia explícita de que
correlación no implica causalidad. `[M§8]`

### 4.6 Medición interna

**FR-050** — El sistema DEBE registrar, para cada clasificación de cuadrante,
una entrada de outcome evaluada a 7, 14 y 30 días. `[M§14]`

**FR-051** — Cada fila producida por el pipeline de scoring DEBE llevar su
`score_version`. `[M§9]`

**FR-052** — El sistema DEBE permitir ejecutar una versión alternativa del
scoring en modo sombra, sobre datos históricos, sin llamadas adicionales a
fuentes externas. `[M§9]`

---

## 5. Requisitos no funcionales

### 5.1 Rendimiento

**NFR-001** — p95 de respuesta completa del lens: **< 3.000 ms**. `[M§11]`

**NFR-002** — Primer contenido útil renderizado: **< 800 ms**.

**NFR-003** — Deadline global del scatter-gather en el plano caliente:
**2.500 ms**. Vencido el deadline, se responde con lo disponible.

**NFR-004** — Presupuesto individual por fuente en el plano caliente:
**1.200 ms**. Ninguna fuente puede consumir el deadline completo.

**NFR-005** — p95 de lectura del feed: **< 200 ms** (servido desde material
precalculado).

**NFR-006** — Toda medición de latencia se reporta en p95 y p99. El promedio no
es una métrica aceptable de rendimiento en este sistema.

### 5.2 Concurrencia

**NFR-010** — Las solicitudes concurrentes sobre el mismo recurso DEBEN
coalescerse en una sola llamada aguas arriba (singleflight). El tráfico de este
dominio es fuertemente correlacionado.

**NFR-011** — El sistema DEBE mantener un límite de concurrencia independiente
por proveedor externo, alineado a su límite de tasa contractual.

**NFR-012** — El plano frío y el plano caliente DEBEN usar colas y presupuestos
de tasa separados. Un pico de usuarios no puede degradar el barrido de
descubrimiento, ni viceversa.

**NFR-013** — Cada fuente externa DEBE estar protegida por un interruptor de
circuito. Umbral inicial: 5 fallos en 60 s abren el circuito por 30 s.

**NFR-014** — El sistema DEBE tolerar la caída total de cualquier fuente
individual sin dejar de responder.

### 5.3 Disponibilidad y degradación

**NFR-020** — La degradación parcial es el comportamiento correcto ante fallo de
fuente. Un error total de la solicitud solo es aceptable si ninguna fuente
respondió.

**NFR-021** — Todo dato servido con antigüedad superior a su TTL DEBE marcarse
como stale en la respuesta y en la interfaz. `[M§3]`

### 5.4 Datos y trazabilidad

**NFR-030** — Todo snapshot crudo por fuente DEBE persistirse junto al valor
computado, con hash de contenido y timestamp de captura. `[M§9, M§18]`

**NFR-031** — Cualquier resultado histórico DEBE ser reproducible a partir de
los snapshots crudos y la `score_version` correspondiente.

**NFR-032** — Retención: 90 días en almacenamiento caliente, 12 meses en frío
para snapshots crudos. Las tablas de eventos DEBEN estar particionadas por
tiempo desde el inicio.

### 5.5 Privacidad y ética

**NFR-040** — Minimización: solo se recolecta lo necesario para responder la
pregunta planteada. `[M§24]`

**NFR-041** — No se almacenan ni exponen agregados de consultas de usuarios que
permitan inferir qué está mirando el conjunto de la base. `[M§25]`

**NFR-042** — La recolección DEBE ser pasiva: no puede alterar la métrica que
observa ni anunciar su interés en un objetivo.

### 5.6 Observabilidad

**NFR-050** — Métricas obligatorias por fuente: tasa de éxito, latencia p95/p99,
estado del circuito, tasa de aciertos de caché, consumo de cuota.

**NFR-051** — Todo resultado servido DEBE ser rastreable, vía identificador de
correlación, hasta las llamadas a fuentes que lo produjeron.

**NFR-052** — El sistema DEBE exponer un chequeo de salud que reporte, por
fuente, si está operativa, degradada o caída, con la causa concreta.

### 5.7 Costo

**NFR-060** — El costo de las fuentes en el plano frío DEBE escalar con el número
de narrativas, no con el número de usuarios.

**NFR-061** — El sistema DEBE aplicar límites de consumo por usuario y por
proveedor, de modo que un pico de tráfico no agote la cuota diaria.

---

## 6. Requisitos de datos

Entidades mínimas del MVP:

| Entidad | Contenido esencial |
|---|---|
| `narrative` | Identificador, nombre, diccionario de entidades asociadas, estado |
| `source_snapshot` | Fuente, payload crudo, hash, timestamp de captura, calificación A–F / 1–6 |
| `metric_point` | Narrativa, eje (atención/fundamento), valor, ventana, `score_version` |
| `quadrant_state` | Narrativa, cuadrante, inicio, fin |
| `mention_event` | Origen raíz, replicador, timestamp, fuente — particionado por tiempo |
| `outcome` | Clasificación evaluada, horizonte (7/14/30 d), resultado observado |
| `token` | Dirección, cadena, narrativa resuelta o nulo explícito |

---

## 7. Criterios de aceptación del MVP

El MVP se considera entregado cuando, de forma verificable:

1. Una consulta de lens con una fuente caída devuelve resultado parcial marcado,
   nunca error total ni dato inventado.
2. 500 solicitudes concurrentes sobre el mismo token producen una sola llamada
   por proveedor aguas arriba.
3. Una campaña sintética de 40 réplicas de una misma publicación raíz suma una
   observación, no cuarenta.
4. Cualquier número visible en pantalla permite llegar a su fuente en dos
   interacciones.
5. La serie de 14 días de una narrativa se reconstruye desde snapshots crudos
   sin ninguna llamada externa nueva.
6. Existe al menos una entrada de outcome evaluada para cada clasificación
   emitida hace más de 30 días.
7. La respuesta declara su brecha de recolección cuando la hubo.
8. p95 del lens bajo carga sintética representativa se mantiene por debajo de
   3 segundos.
