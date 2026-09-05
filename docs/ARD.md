# ARD — Momentum (MVP)

Documento de arquitectura y registro de decisiones.

| | |
|---|---|
| Estado | Borrador para revisión |
| Versión | 0.1 |
| Documentos hermanos | `PRD.md`, `SRS.md`, `MANIFIESTO-CALIDAD.md` |

---

## 1. Fuerzas que condicionan el diseño

1. **Descubrir y consultar tienen presupuestos de latencia incompatibles.**
   Descubrir requiere barrer el universo; consultar toca un punto. No pueden
   vivir en el mismo camino de ejecución.
2. **El tráfico es fuertemente correlacionado.** Cuando un token se pone de
   moda, todos lo consultan en la misma ventana de minutos. El diseño debe
   asumir picos concentrados sobre la misma clave, no distribución uniforme.
3. **El costo dominante son las APIs externas, no el cómputo.** Toda decisión de
   arquitectura es, en el fondo, una decisión sobre cuántas llamadas se hacen.
4. **Ninguna fuente puede ser indispensable.** Rate limits, cambios de términos
   y caídas son eventos ordinarios en este dominio.
5. **La procedencia es requisito, no adorno.** El esquema debe soportarla desde
   la primera tabla; retrofitearla es reescribir el pipeline.

---

## 2. Vista general: dos planos y un store

```
┌─────────────────────────────────────────────────┐
│ PLANO FRÍO — worker, cadencia 15 min            │
│                                                 │
│  ┌────────────────────┐  ┌───────────────────┐  │
│  │ Feed de auge       │  │ Serie por         │  │
│  │ barrido + ranking  │  │ narrativa         │  │
│  └────────────────────┘  └───────────────────┘  │
└──────────────────────┬──────────────────────────┘
                       │
              ┌────────▼─────────┐
              │ STORE COMPARTIDO │
              │ crudos + grafo   │
              └────────┬─────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│ PLANO CALIENTE — request, deadline 2,5 s        │
│                                                 │
│         ┌─────────────────────────────┐         │
│         │ Lens de token               │         │
│         │ scatter-gather + singleflight│        │
│         └─────────────────────────────┘         │
└─────────────────────────────────────────────────┘
```

El plano frío alimenta el diccionario y las series. El plano caliente lo consume
para dar contexto a una consulta puntual, y complementa con las llamadas en vivo
que no se pueden precalcular (liquidez, tenedores, pares).

**Regla de frontera:** si algo se puede precalcular, se precalcula. El plano
caliente solo hace lo que no admite espera.

---

## 3. Componentes

| Componente | Plano | Responsabilidad |
|---|---|---|
| `discovery` | Frío | Barrido de listados, nominación y ranking de temas por velocidad |
| `series` | Frío | Cálculo de atención y fundamento por narrativa, clasificación de cuadrante |
| `lineage` | Frío | Resolución de origen raíz para deduplicación por origen |
| `outcomes` | Frío | Evaluación diferida a 7/14/30 días |
| `lens-api` | Caliente | Scatter-gather, coalescing, ensamblado incremental |
| `stream` | Caliente | Entrega incremental de bloques al cliente |
| `store` | — | Snapshots crudos, series, grafo de menciones, outcomes |
| `cache` | — | Tres capas: respuesta de fuente, objeto computado, respuesta HTTP |

---

## 4. Modelo de concurrencia

### 4.1 Plano caliente

El camino de solicitud es un **scatter-gather con deadline global**. El deadline
se declara al inicio y se propaga a cada llamada hija; ninguna fuente puede
consumirlo completo.

```
deadline_global   = 2.500 ms
presupuesto_fuente = 1.200 ms
primer_flush       = en cuanto el primer bloque esté listo
```

Cuatro mecanismos, en este orden de importancia:

1. **Singleflight.** Solicitudes concurrentes sobre la misma clave se colapsan
   en una sola llamada aguas arriba. Sin esto, el primer token viral del día
   agota la cuota de todos los proveedores.
2. **Semáforo por proveedor.** Límite de concurrencia independiente por API,
   alineado al límite contractual de cada una. No un pool global.
3. **Interruptor de circuito por fuente.** 5 fallos en 60 s abren el circuito
   30 s. Una fuente caída no puede consumir presupuesto de latencia en cada
   solicitud.
4. **Entrega incremental.** Cada bloque se emite al estar listo. La percepción
   de latencia la fija el bloque más rápido, no el más lento.

### 4.2 Plano frío

Trabajo dominado por E/S, no por CPU. Pool con límite por proveedor y
paralelismo por narrativa. El descubrimiento es el trabajo más caro del sistema
—barre listados completos— y por eso corre en **cola separada con presupuesto de
tasa propio**.

### 4.3 Presupuesto de latencia declarado

| Etapa | Presupuesto |
|---|---|
| Resolución de token → narrativa (desde store) | 50 ms |
| Llamadas en vivo por fuente | 1.200 ms |
| Ensamblado y scoring | 150 ms |
| Total antes del corte duro | 2.500 ms |
| Objetivo p95 extremo a extremo | 3.000 ms |

---

## 5. Estrategia de caché

Tres capas, con TTL derivado de la volatilidad real del dato, no de una
convención uniforme:

| Capa | Contenido | TTL |
|---|---|---|
| L1 | Respuesta cruda por fuente | Social 5 min · fundamentos 15 min · precio y liquidez 30 s |
| L2 | Objeto de narrativa computado | Hasta la siguiente corrida del plano frío |
| L3 | Respuesta HTTP ensamblada | 30 s, con revalidación |

Vencido el TTL, el dato no desaparece: se sirve marcado como stale mientras se
revalida en segundo plano. Un dato viejo y declarado es mejor que una pantalla
vacía; un dato viejo y no declarado es una mentira.

---

## 6. Modelo de datos: lo no negociable

Tres propiedades que el esquema debe garantizar desde la primera migración:

1. **Crudo junto a computado.** `source_snapshot` guarda el payload sin
   transformar, su hash y su timestamp de captura. Permite recalcular la
   historia y correr modo sombra sin volver a pagar las APIs.
2. **`score_version` en cada fila producida.** Sin esto no hay comparación entre
   fórmulas y por lo tanto no hay iteración medible.
3. **Linaje de origen en `mention_event`.** El campo que apunta a la publicación
   raíz, no a la réplica. Es lo que separa consenso de campaña coordinada.

`mention_event` es una tabla de eventos: crece rápido, se particiona por tiempo
desde el día uno, con retención en caliente de 90 días definida antes del
lanzamiento y no después de que duela.

---

## 7. Modos de fallo

| Fallo | Comportamiento |
|---|---|
| Una fuente lenta | Se corta en su presupuesto; el bloque se marca no disponible |
| Una fuente caída | Circuito abierto; no se intenta hasta que cierre |
| Todas las fuentes en vivo caídas | Se responde solo con contexto precalculado, declarando la brecha |
| Store no disponible | Error total. Es la única dependencia dura del sistema |
| Cuota de proveedor agotada | Degradación a fuentes alternativas; se declara la ausencia |
| Pico correlacionado sobre una clave | Singleflight absorbe; una llamada aguas arriba |

---

## 8. Decisiones registradas

### ADR-001 — Dos planos con store compartido

**Contexto.** El producto necesita un feed de descubrimiento y una consulta
puntual de baja latencia. Descubrir requiere barrido; consultar requiere
puntualidad.

**Decisión.** Separar en plano frío (worker, cadencia 15 min) y plano caliente
(request, deadline 2,5 s), comunicados por un store compartido.

**Consecuencias.** Dos ciclos de despliegue y dos modelos operativos. A cambio,
el feed no puede degradar la latencia del lens y el lens gana contexto que
ninguna herramienta de su categoría ofrece.

---

### ADR-002 — Singleflight como requisito, no optimización

**Contexto.** El tráfico es fuertemente correlacionado: cientos de usuarios
consultan el mismo token en la misma ventana de minutos.

**Decisión.** Coalescer solicitudes concurrentes por clave antes de cualquier
llamada externa, desde la primera versión.

**Consecuencias.** Complejidad adicional en el camino caliente y necesidad de
coordinación si se escala a varias instancias. Sin esto, el primer evento viral
agota la cuota diaria de todos los proveedores.

---

### ADR-003 — Entrega incremental en lugar de respuesta única

**Contexto.** El presupuesto de 2,5 s no alcanza para esperar a la fuente más
lenta sin castigar al usuario.

**Decisión.** Emitir cada bloque al estar listo, mediante flujo de eventos del
servidor.

**Consecuencias.** El cliente debe manejar estados parciales y reordenamiento.
A cambio, el primer contenido útil aparece en menos de 800 ms y la degradación
parcial se vuelve el comportamiento natural, no una excepción.

---

### ADR-004 — Diccionario de narrativas curado a mano

**Contexto.** Resolver automáticamente un texto libre a un conjunto de entidades
es el trabajo más difícil del sistema y el de peor calidad inicial.

**Decisión.** Arrancar con 15 narrativas curadas manualmente. Sin resolución
automática en el MVP.

**Consecuencias.** No escala más allá de unas decenas de narrativas y exige
trabajo humano recurrente. A cambio, la calidad es alta desde el primer día,
que es lo único que importa antes de tener usuarios.

---

### ADR-005 — Deduplicación por origen, no por texto

**Contexto.** Cuarenta cuentas citando un mismo hilo se ven idénticas a un
consenso orgánico si se cuentan menciones.

**Decisión.** El grafo de menciones almacena el origen raíz. La deduplicación
opera sobre ese campo. La resolución de linaje corre en el plano frío por ser
costosa.

**Consecuencias.** Requiere un campo y un proceso que no existirían en una
implementación ingenua. Es la diferencia entre medir narrativas y medir
campañas de marketing.

---

### ADR-006 — Ninguna fuente indispensable

**Contexto.** Rate limits, cambios de términos y caídas son eventos ordinarios.

**Decisión.** Ninguna funcionalidad puede requerir una fuente específica. Todo
bloque de la respuesta debe poder ausentarse dejando el resto usable.

**Consecuencias.** Más código de degradación y una interfaz que debe representar
la ausencia con dignidad. A cambio, ninguna decisión comercial de un tercero
puede tumbar el producto.

---

### ADR-007 — Persistir el crudo siempre

**Contexto.** La fórmula de scoring cambiará varias veces y hay que poder
evaluarla contra la historia.

**Decisión.** Persistir el payload sin transformar junto al valor computado, con
hash y timestamp de captura.

**Consecuencias.** Mayor costo de almacenamiento y una política de retención
explícita. A cambio, el modo sombra es prácticamente gratis y cualquier
resultado pasado es reproducible.

---

### ADR-008 — Colas separadas para descubrimiento y consulta

**Contexto.** El barrido de descubrimiento es el consumidor más pesado de cuota
del sistema.

**Decisión.** Colas y presupuestos de tasa independientes por plano.

**Consecuencias.** Configuración más compleja. Evita que un pico de usuarios
ahogue el descubrimiento y que el barrido nocturno consuma la cuota que el lens
necesitará por la mañana.

---

### ADR-009 — Atribución agregada, no nominal, en el MVP

**Contexto.** Con muestras pequeñas y muchas hipótesis, los hit rates
individuales son ruido con decimales. Además, nombrar personas tiene coste
reputacional y legal.

**Decisión.** El MVP publica solo agregados de impulso. Nada de rankings de
actores individuales.

**Consecuencias.** Se pospone uno de los diferenciadores más llamativos. A
cambio se evita publicar un ranking indefendible y se gana tiempo para acumular
observaciones suficientes.

---

### ADR-010 — Postgres particionado antes que almacén especializado

**Contexto.** Hay series temporales, un grafo de menciones y documentos crudos.
La tentación es tres motores distintos.

**Decisión.** Un solo Postgres con particionamiento por tiempo para las tablas
de eventos, más una caché en memoria para el camino caliente.

**Consecuencias.** Techo de escala más bajo que un almacén especializado. A
cambio, una sola cosa que operar en un MVP donde el cuello de botella son las
APIs externas, no la base de datos. Se revisa cuando `mention_event` supere el
volumen que el particionamiento maneje con comodidad.

---

## 9. Deuda aceptada conscientemente

Estas no son omisiones; son decisiones con fecha de revisión.

| Deuda | Revisión |
|---|---|
| Diccionario manual (ADR-004) | A los 90 días o al llegar a 40 narrativas |
| Un solo Postgres (ADR-010) | Cuando el particionamiento deje de bastar |
| Sin atribución nominal (ADR-009) | Cuando existan 15+ observaciones por actor |
| Sin alertas push | Tras validar la métrica primaria del PRD |
| Dos cadenas | Tras validar que el cuadrante predice algo |

---

## 10. Qué invalidaría esta arquitectura

Un documento de arquitectura que no dice cómo se refuta no sirve. Tres
condiciones nos obligarían a rediseñar:

1. **Que el cuadrante no prediga nada** medido contra la tabla de outcomes a 90
   días. Entonces el plano frío pierde su razón de ser y el producto se reduce a
   un lens sin contexto — que es un mercado ya ocupado.
2. **Que el costo por consulta no baje con el volumen.** Significaría que el
   coalescing no está capturando la correlación real del tráfico y que el modelo
   económico no cierra.
3. **Que la deduplicación por origen resulte irresoluble a escala.** Si no
   podemos distinguir consenso de campaña, nuestra métrica de atención mide otra
   cosa, y conviene saberlo antes de construir encima.
