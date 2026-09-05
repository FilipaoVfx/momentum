# Manifiesto de calidad — Momentum

**Filosofía raíz: enriquecer la data para el usuario.**

Agregar es poner cinco fuentes en una pantalla. Enriquecer es que el usuario
salga sabiendo algo que no sabía al entrar.

El mercado ya tiene diez productos que agregan. Ninguno enriquece. Esa es la
única razón por la que este producto existe, y todo lo que sigue se deriva de
ahí.

Este documento no es aspiracional. Es el criterio con el que se rechaza un PR.

---

## Las tres preguntas

Ningún número llega a la pantalla sin respuesta a las tres:

1. **¿Comparado con qué?** Un valor absoluto no es información. `TVL: $42M` no
   dice nada. `TVL: $42M, +34% en 7d, percentil 80 de su categoría` sí.
2. **¿De dónde salió?** Fuente, método y versión del cálculo, siempre
   recuperables desde la UI.
3. **¿Qué tan viejo es?** Con timestamp real, no "actualizado recientemente".

Si un dato no puede responder las tres, no está listo para mostrarse. Se queda
en el store hasta que lo esté.

---

## Principios

### 1. Contexto o nada

Un dato sin comparación es ruido con formato bonito. Todo número que mostramos
viene acompañado de al menos uno de: su variación en el tiempo, su posición
relativa a pares, o su distancia de una referencia conocida.

**Se viola cuando:** mostramos una métrica cruda porque "la API ya la devuelve
así".

### 2. La procedencia es parte del dato, no metadata

Cada valor viaja con `source`, `fetched_at`, `method` y `score_version`. Estos
campos no son opcionales ni se agregan después. Un pipeline que pierde
procedencia produce datos que no podemos defender ni depurar.

**Se viola cuando:** alguien hace un `SELECT valor` y lo pinta.

### 3. Lo viejo se declara viejo

La degradación parcial es el comportamiento correcto: si una fuente no responde
dentro del presupuesto, renderizamos sin ese eje y lo marcamos como stale
visiblemente. Nunca bloqueamos la pantalla completa por una fuente lenta, y
nunca mostramos un dato viejo como si fuera fresco.

**Se viola cuando:** el spinner reemplaza a la respuesta parcial.

### 4. Incompleto y honesto le gana a completo e inventado

No rellenamos huecos con estimaciones, promedios de categoría, ni valores
heredados de la corrida anterior sin marcarlos como tales. Un campo vacío que
dice "sin datos" es información útil. Un campo lleno de una suposición es una
mentira con dos decimales.

**Se viola cuando:** el fallback silencioso parece un dato real.

### 5. La señal se pondera por el costo de mentir

No todas las fuentes valen lo mismo. Un like es barato de fabricar; una posición
en un mercado de predicción, un flujo on-chain o un volumen liquidado son caros.
El scoring refleja esa asimetría explícitamente.

Corolario: si nuestro score es engagement crudo, construimos un detector de
campañas de marketing, no de narrativas.

**Se viola cuando:** una fuente nueva entra al score con peso igual "por
simplicidad".

### 6. Una pantalla, una decisión

El problema que resolvemos es que el usuario hoy abre siete pestañas y hace el
join en su cabeza. Si nuestra respuesta lo obliga a abrir la octava, fallamos —
por más bonita que sea.

**Prueba:** ¿puede alguien mirar la pantalla cinco segundos y decir qué haría?
Si no, no está terminada.

### 7. Toda afirmación es auditable hasta el origen

De cualquier conclusión que mostramos se puede llegar, en un clic o dos, al post,
la transacción o la fila que la sustenta. No pedimos confianza; ofrecemos
verificación.

**Se viola cuando:** una síntesis no tiene camino de vuelta a sus insumos.

### 8. La incertidumbre se muestra, no se esconde

Correlación desfasada no es causalidad, y la UI lo dice. Nada de rankings de
influencia con muestras minúsculas: piso duro de observaciones antes de publicar
un actor, y ajuste por comparaciones múltiples. Con `n` pequeño y muchas
hipótesis, los falsos positivos están garantizados.

**Se viola cuando:** un número aparece sin intervalo, sin `n`, o sin advertencia.

### 9. El crudo se guarda siempre

Cada snapshot por fuente se persiste junto al valor computado. Esto nos permite:
recalcular la historia cuando cambie la fórmula, correr shadow mode sin volver a
pagar APIs, y reproducir cualquier resultado pasado.

Un sistema que solo guarda el resultado no puede auditarse ni mejorarse.

**Se viola cuando:** un job transforma y descarta.

### 10. Nuestro KPI es el acierto, no el engagement

De las N señales que marcamos, ¿cuántas resultaron ciertas? Ese es el único
número que importa. Optimizar tiempo en pantalla o frecuencia de notificación es
un incentivo directo a producir ansiedad en vez de claridad.

Toda métrica que suba cuando el usuario duda más es una métrica que no
perseguimos.

### 11. La latencia es una propiedad de calidad

Un dato correcto que llega tarde es un dato incorrecto en este dominio. Cada
superficie tiene presupuesto de latencia declarado y medido en p95, no en
promedio. El promedio esconde exactamente los casos que hacen que alguien
abandone.

**Se viola cuando:** un feature se aprueba sin presupuesto de latencia definido.

### 12. Entregamos evidencia, no órdenes

No emitimos señales de compra ni de venta. Mostramos qué cambió, en qué
dirección, con qué respaldo y con qué nivel de confianza. La decisión, el
tamaño y el riesgo son del usuario.

Esto no es cobardía legal: es que un producto que decide por el usuario deja de
enriquecer su criterio y empieza a reemplazarlo. Ahí perdemos la razón de
existir.

### 13. Las personas no son datos públicos por defecto

Atribuir influencia significa señalar gente por nombre. Antes de publicar un
actor individual: piso de observaciones, agregados primero, y un camino de
opt-out definido — antes del lanzamiento, no después del primer reclamo.

### 14. Lo que no se puede medir contra un resultado, no se lanza

Todo feature de señal nace con su tabla de outcomes: qué pasó a 7, 14 y 30 días
después de que lo marcamos. Sin eso no estamos iterando, estamos adivinando con
más pasos y más infraestructura.

---

## Filosofía OSINT

La disciplina OSINT lleva décadas resolviendo exactamente nuestro problema:
convertir fuentes abiertas, ruidosas y parcialmente hostiles en algo sobre lo
que alguien pueda decidir. No inventamos método — adoptamos el suyo.

### 15. Recolectar no es producir inteligencia

El ciclo completo es dirección → recolección → procesamiento → análisis →
difusión → **retroalimentación**. Un producto que se detiene en recolección es un
scraper con diseño. El valor vive en los pasos del medio, y el último — medir si
acertamos — es el que casi todo el mundo omite. Nuestro principio 14 *es* ese
paso.

### 16. Dos ejes independientes: fiabilidad de la fuente y credibilidad del dato

Adaptación del código Admiralty. Una fuente con historial impecable puede
reportar algo sin confirmar; una fuente basura puede acertar por casualidad. Se
califican por separado y se muestran por separado.

| Fiabilidad de la fuente | | Credibilidad del dato | |
|---|---|---|---|
| A | Historial verificado | 1 | Confirmado por fuentes independientes |
| B | Usualmente confiable | 2 | Probablemente cierto |
| C | Confiabilidad irregular | 3 | Posiblemente cierto |
| D | Usualmente poco confiable | 4 | Dudoso |
| E | No confiable | 5 | Improbable |
| F | Sin historial suficiente | 6 | No evaluable |

Un `B2` y un `E2` dicen lo mismo y no valen lo mismo. La UI lo refleja.

### 17. El reporte circular cuenta como una sola fuente

Cuarenta cuentas citando el mismo hilo es **un** dato, no cuarenta. Este es el
error clásico de OSINT y el modo de falla número uno de cualquier métrica de
mindshare: una campaña coordinada se ve idéntica a un consenso orgánico si
cuentas menciones en vez de orígenes.

La deduplicación por origen — no por texto, no por URL — es requisito de
arquitectura, no una optimización posterior.

### 18. Preservamos el artefacto

El post se borra, el hilo se edita, la página cambia. Todo insumo se archiva con
su hash y su timestamp de captura en el momento de recolectarlo. Una afirmación
cuya evidencia ya no existe es una afirmación indefendible.

### 19. Observación, inferencia y valoración nunca se mezclan

Tres registros distintos, marcados distinto, siempre:

- **Observación:** la wallet X compró 40.000 tokens el día D. *(verificable)*
- **Inferencia:** esa wallet precedió movimientos similares 11 de 14 veces.
  *(derivado, con su `n` a la vista)*
- **Valoración:** parece acumulación temprana. *(juicio nuestro, falible)*

Colapsar los tres en una sola frase es exactamente cómo se fabrica confianza
injustificada. Nunca lo hacemos, ni siquiera por brevedad.

### 20. Lenguaje estimativo con bandas publicadas

"Probable" significa un rango de probabilidad definido y publicado, no una
intuición. Sin la tabla, "probablemente" significa 30% para quien escribe y 80%
para quien lee, y esa brecha la paga el usuario.

### 21. Buscamos activamente la hipótesis contraria

Análisis de hipótesis en competencia: antes de publicar una lectura, se enumera
la explicación alternativa y se busca la evidencia que la sostendría. Un sistema
que solo confirma lo que ya subió es un amplificador, no un analista — y los
amplificadores son gratis.

### 22. Asumimos un adversario, siempre

Alguien está intentando envenenar el feed en este momento. La detección de
engaño es una capa del pipeline, no un filtro de spam al final. Banderas
mínimas que se evalúan de oficio:

- Visibilidad comprada presentada como orgánica (boosts, trending pagado).
- Cuentas nacidas en ventana corta con actividad sincronizada.
- Volumen reciclado entre pocas direcciones.
- TVL inflada con capital propio circulando en bucle.
- Divulgación ausente en cuentas con contrato comercial.

### 23. Declaramos lo que no vimos

Cada resultado termina con su brecha de recolección: qué fuente estuvo caída,
qué idioma no cubrimos, qué ventana quedó fuera, qué método falló. Sin
denominador no hay porcentaje, y sin brecha declarada la ausencia de evidencia
se lee como evidencia de ausencia.

### 24. Abierto no significa disponible

Que un dato sea técnicamente accesible no lo vuelve nuestro para publicar.
Vincular direcciones con identidades reales es la línea donde OSINT se convierte
en doxxing, y esa línea no se cruza por una feature.

Minimización: recolectamos lo mínimo necesario para responder la pregunta, y no
correlacionamos identidades salvo que su titular las haya hecho públicas por
decisión propia.

### 25. Nuestra propia huella es parte del modelo

Somos observadores que alteran lo observado. Lo que agregamos al feed puede
convertirse en objetivo de manipulación dirigida, y el patrón de consultas de
nuestros usuarios es información valiosa para terceros. Se protege como tal: sin
exponer agregados de búsqueda, con límites que no revelen prioridades internas, y
con recolección que no anuncie lo que está mirando.

---

## Lo que no somos

- **No somos un dashboard más.** Un dashboard le devuelve al usuario el trabajo
  de interpretar. Nosotros interpretamos y mostramos el trabajo.
- **No somos un bot de señales.** Ver el principio 12.
- **No vendemos FOMO.** La urgencia manufacturada es la métrica más fácil de
  subir y la más rápida de destruir la confianza.
- **No competimos por milisegundos.** Ese juego ya tiene ganadores con
  colocación e infraestructura dedicada. Competimos por contexto.
- **No mostramos algo solo porque la API lo devuelve.** Cada campo en pantalla
  se ganó su lugar respondiendo las tres preguntas.
- **No somos una herramienta de vigilancia.** Analizamos comportamiento de
  mercado y de narrativas, no personas. Si un feature solo funciona
  desanonimizando a alguien, ese feature no se construye.

---

## Definición de terminado

Un feature no está listo hasta que:

- [ ] Cada número en pantalla responde las tres preguntas.
- [ ] Existe estado de degradación parcial y está probado con una fuente caída.
- [ ] El estado stale es visible y distinguible del estado fresco.
- [ ] La procedencia es recuperable desde la UI en máximo dos clics.
- [ ] Los snapshots crudos se persisten, no solo el valor computado.
- [ ] Hay presupuesto de latencia declarado y medido en p95.
- [ ] Existe la tabla de outcomes que permitirá evaluarlo en 30 días.
- [ ] El `score_version` queda registrado en cada fila producida.
- [ ] Alguien ajeno al feature mira la pantalla y dice qué haría, sin ayuda.
- [ ] La deduplicación es por origen, no por texto: una campaña coordinada no
      puede puntuar como consenso.
- [ ] Los insumos quedan archivados con hash y timestamp de captura.
- [ ] Observación, inferencia y valoración están marcadas distinto en la salida.
- [ ] El resultado declara su brecha de recolección.
- [ ] Ninguna parte del feature depende de vincular una dirección con una
      identidad real.

---

## La prueba final

Antes de mergear cualquier cosa, una sola pregunta:

> ¿El usuario sale de esta pantalla sabiendo algo que no sabía, o solo viendo
> algo que ya podía ver en otro lado?

Si es lo segundo, agregamos. No enriquecimos. Se devuelve.
