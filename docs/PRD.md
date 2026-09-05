# PRD — Momentum (MVP)

| | |
|---|---|
| Estado | Borrador para revisión |
| Versión | 0.1 |
| Documentos hermanos | `SRS.md`, `ARD.md`, `MANIFIESTO-CALIDAD.md` |

---

## 1. Resumen

Momentum responde una pregunta que hoy requiere siete pestañas y una hoja de cálculo
mental: **¿qué es esto que estoy mirando, y qué tan real es?**

El usuario pega la dirección de un contrato y recibe, en menos de tres segundos,
el token en su contexto de narrativa: a qué relato pertenece, si ese relato está
respaldado por dinero o solo por conversación, y desde cuándo. En paralelo, un
feed le muestra qué narrativas están naciendo antes de que sean obvias.

No es un terminal de trading ni un bot de señales. Es la capa de contexto que
ninguno de los dos tiene.

---

## 2. El problema

La información cripto no está escasa — está **fragmentada por eje**. Cada
herramienta domina una sola dimensión y ninguna cruza:

| Eje | Herramientas dominantes | Lo que no ven |
|---|---|---|
| Atención / mindshare | Kaito, X, Cookie | Si hay dinero detrás |
| Fundamento on-chain | DefiLlama, Dune | Si alguien está hablando de eso |
| Liquidez y ejecución | DEX Screener, GMGN, Axiom | Qué narrativa es, y desde cuándo |

El *join* entre esos ejes lo hace hoy el usuario, de memoria, bajo presión de
tiempo y con sesgo. Ese join es el producto.

**Consecuencia observable del problema:** la gente compra el relato en su punto
de máxima atención, que es sistemáticamente su punto de mínimo retorno esperado.

---

## 3. Usuarios

### Usuario objetivo

Operador activo de lowcaps y tokens nuevos, principalmente en Solana. Ya usa
DEX Screener o un terminal tipo GMGN/Axiom. Toma decisiones en ventanas de
minutos a días. Sabe leer un gráfico; lo que no tiene es contexto de narrativa
sin abrir cinco pestañas.

**Su queja actual:** "sé qué es el token, no sé si la historia detrás es real."

### Usuario secundario

Investigador, creador de contenido o fondo pequeño que necesita entender de qué
se está hablando y con qué respaldo. Menor sensibilidad a latencia, mayor
exigencia de procedencia y trazabilidad.

### Explícitamente fuera del objetivo

- Trading de alta frecuencia y sniping de lanzamientos. Ese juego se gana con
  colocación e infraestructura dedicada, no con contexto.
- Inversor institucional. Requiere cumplimiento, custodia y reportería que este
  MVP no aborda.
- Usuario totalmente nuevo en cripto. El producto asume vocabulario base.

---

## 4. Jobs to be done

| # | Job | Situación |
|---|---|---|
| JTBD-1 | "Vi este contrato, dime qué es y qué tan real" | Alguien le pasó un CA por Telegram |
| JTBD-2 | "Dime qué está naciendo antes de que sea obvio" | Revisión diaria, buscando rotación |
| JTBD-3 | "Dime si esto que subió tiene algo detrás o es puro relato" | Ya vio el pump, decide si entra |
| JTBD-4 | "Dime quién empujó esto y si suele acertar" | Evalúa la calidad del impulso |

JTBD-4 entra al MVP **solo a nivel agregado** (ver §6).

---

## 5. Propuesta de valor

Un solo enunciado, y todo lo demás se deriva:

> Cruzamos atención y fundamento en una sola pantalla, con procedencia
> verificable y una postura explícita sobre lo que no sabemos.

Diferenciadores frente a lo existente:

1. **El cuadrante.** Atención y fundamento como dos series independientes
   clasifican cada narrativa en cuatro estados: confirmada, puro relato,
   construcción silenciosa, muerta. Nadie más publica ese cruce.
2. **Token → narrativa.** Los terminales dicen qué es el token; nosotros decimos
   a qué historia pertenece y en qué momento de esa historia estás entrando.
3. **Ponderación por costo de mentir.** Un like es barato; un mercado de
   predicción, un flujo on-chain y un volumen liquidado no lo son. El score lo
   refleja.
4. **Honestidad operativa.** Declaramos fuentes caídas, datos viejos y brechas
   de cobertura. Es lo contrario de lo que hace el resto del sector y es lo que
   sostiene la confianza a los seis meses.

---

## 6. Alcance del MVP

### Dentro

- **Lens de token.** Entrada de dirección de contrato → ficha con contexto de
  narrativa, señales de liquidez y banderas de riesgo. Objetivo p95 < 3 s.
- **Feed de auge.** Lista de narrativas emergentes ordenadas por velocidad,
  recalculada cada 15 minutos.
- **Serie y cuadrante por narrativa.** Atención y fundamento en el tiempo, con
  clasificación en uno de los cuatro estados.
- **Diccionario de narrativas curado a mano.** 15 narrativas al lanzamiento.
- **Atribución agregada.** "Este impulso vino mayoritariamente de cuentas
  nuevas / de cuentas con historial / de flujo on-chain previo." Sin nombrar
  personas.
- **Tabla de outcomes.** Registro de qué pasó a 7, 14 y 30 días después de cada
  clasificación. Interno, no expuesto al usuario en el MVP.
- **Cadenas:** Solana y una cadena EVM (Base). Decisión reversible.

### Fuera del MVP

| Fuera | Por qué |
|---|---|
| Atribución nominal de personas | `n` insuficiente para hit rates defendibles y riesgo reputacional (Manifiesto §24) |
| Alertas push y notificaciones | Cambia toda la arquitectura de fan-out; se evalúa tras validar el core |
| Ejecución de operaciones | No competimos por latencia de ejecución |
| Resolución automática de narrativas nuevas | El diccionario curado da más calidad el día 1 |
| App nativa | Web responsive primero |
| Backtest expuesto al usuario | Necesita 90 días de outcomes propios antes de ser honesto |

---

## 7. Flujos principales

### F1 — Lens (JTBD-1, JTBD-3)

El usuario pega un CA. La respuesta se llena por partes: primero identidad y
liquidez, después contexto de narrativa, al final atribución. Cada bloque
muestra su procedencia y su antigüedad. Si una fuente no llegó a tiempo, ese
bloque aparece marcado como no disponible, no vacío ni inventado.

### F2 — Feed (JTBD-2)

Lista de narrativas emergentes con su etiqueta de momentum y su cuadrante. Cada
entrada abre la serie histórica y las evidencias que la sustentan.

### F3 — Narrativa (JTBD-3, JTBD-4)

Vista de una narrativa: dos series, cuadrante actual, cuánto lleva en él, y el
resumen agregado de quién la está empujando. Toda afirmación con camino de
vuelta a su fuente.

---

## 8. Métricas de éxito

### Métrica primaria

**Tasa de acierto de la clasificación de cuadrante**, evaluada contra la tabla
de outcomes a 30 días. Concretamente: de las narrativas marcadas como
"construcción silenciosa", qué fracción mostró crecimiento sostenido de
fundamento en la ventana siguiente.

Umbral de viabilidad: la clasificación debe superar de forma medible a la
heurística trivial de "lo que más subió la semana pasada". Si no lo logra en 90
días, el producto no tiene razón de existir en su forma actual.

### Métricas de soporte

| Métrica | Objetivo MVP |
|---|---|
| p95 de respuesta del lens | < 3 s |
| Primer contenido útil en pantalla | < 800 ms |
| Cobertura de fuentes por consulta | ≥ 4 de 5 en el 90% de las consultas |
| Consultas que terminan en una segunda pestaña externa | Tendencia a la baja |

### Anti-métricas

No perseguimos, y consideramos señal de alarma si suben:

- Tiempo en aplicación.
- Consultas por sesión.
- Frecuencia de retorno diario.

Las tres suben cuando el usuario está ansioso. Un usuario que consulta una vez,
entiende y se va, es un éxito.

---

## 9. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El cuadrante no predice nada | Fatal | Tabla de outcomes desde el día 1; matar el feature si no supera la línea base |
| Envenenamiento del feed por campañas coordinadas | Alto | Deduplicación por origen, no por texto (Manifiesto §17) |
| Costo de APIs bajo tráfico correlacionado | Alto | Singleflight, caché por capas, presupuesto por proveedor |
| Rate limits o cambios de términos en fuentes clave | Alto | Ninguna fuente única indispensable; degradación parcial declarada |
| El diccionario curado no escala | Medio | Aceptado conscientemente para el MVP; se revisa a los 90 días |
| Deriva legal hacia asesoría financiera | Medio | Principio 12: evidencia, no órdenes. Revisión de copy antes de lanzar |

---

## 10. Hitos

| Hito | Contenido | Criterio de salida |
|---|---|---|
| M0 — Esqueleto | Store, esquema, ingesta de 2 fuentes | Un snapshot completo persistido con procedencia |
| M1 — Plano frío | Serie por narrativa + cuadrante, 15 narrativas | Serie de 14 días reconstruible desde crudos |
| M2 — Lens | Scatter-gather, SSE, singleflight | p95 < 3 s con 4 fuentes bajo carga sintética |
| M3 — Feed | Descubrimiento y ranking por velocidad | Feed estable sin duplicados por origen |
| M4 — Honestidad | Procedencia en UI, estados stale, brecha declarada | Checklist de "definición de terminado" completo |
| M5 — Medición | Tabla de outcomes poblada | Primer reporte de acierto a 30 días |

---

## 11. Dependencias

- Fuentes de fundamento on-chain (TVL, fees, volumen).
- Fuentes de liquidez y pares (DEX).
- Fuentes de atención social con acceso a conteos de interacción reales.
- Mercados de predicción como señal de alto costo de mentir.
- Motor de descubrimiento para el barrido de temas emergentes.

Ninguna de estas puede ser un punto único de falla. Ver `ARD.md`, ADR-006.

---

## 12. Preguntas abiertas

1. ¿La segunda cadena es Base o Ethereum? Depende de dónde vive la narrativa que
   queramos cubrir primero, no de preferencia técnica.
2. ¿El feed es público o requiere cuenta? Afecta el modelo de abuso y el costo.
3. ¿Cuál es el umbral mínimo de liquidez bajo el cual simplemente no opinamos?
   Por debajo de cierto punto, cualquier métrica es ruido.
4. ¿Monetización desde el MVP o después de validar el acierto? La respuesta
   condiciona qué tan agresivo puede ser el límite de consultas.
