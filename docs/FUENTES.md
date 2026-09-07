# Fuentes — acceso, límites y credenciales

Registro operativo de por dónde entra el dato y qué lo puede cortar. Existe
porque la pregunta "¿de dónde sale esto y qué pasa si falla?" no se responde
leyendo el código de los adaptadores.

Convención: **medido** es algo que comprobamos contra la API real; **documentado**
es lo que dice el proveedor y no hemos verificado; **supuesto** es una apuesta
nuestra. Mezclar los tres registros sería exactamente lo que el manifiesto §19
prohíbe.

---

## Resumen

| Fuente | Eje | Credencial | Estado | Llamadas/día |
|---|---|---|---|---|
| DefiLlama | Fundamento | No | Operativa | ~1.272 |
| Polymarket | Atención (capital) | No | Operativa | 96 |
| Reddit | Atención (social) | **Sí, OAuth** | Bloqueada sin credencial | ~1.056 |
| DEX Screener | Liquidez (M2) | No | Verificada, sin integrar | — |
| RPC Solana | Tenedores (M2) | **Sí** | Imposible sin clave | — |

---

## DefiLlama

**Acceso:** HTTP público, sin clave.

**Endpoints y por qué esos:**

- `/tvl/{slug}` — un número suelto, 18 bytes. **Medido:** el alternativo
  `/protocol/{slug}` devuelve la serie histórica completa y suma 112 MB por
  corrida sobre el diccionario de 15 narrativas, unos 10 GB al día a cadencia de
  15 minutos, para quedarnos con el último valor.
- `/overview/fees` y `/overview/dexs` — agregados de **todo** el universo en una
  llamada. **Medido:** 2.658 protocolos, campo `total24h` por entrada. Dos
  llamadas cubren las 15 narrativas; el costo escala con el diccionario y no con
  los usuarios (NFR-060).

**Límites:** no publica ninguno. **Medido:** no expone cabeceras `RateLimit-*` y
su ruta de documentación devuelve 404. Una ráfaga de 25 peticiones seguidas pasó
sin error, lo que no dice nada del comportamiento sostenido. Está detrás de
Cloudflare, así que el límite existe y solo se descubre chocando.

**Nuestro presupuesto:** 60 por minuto y 4.000 al día (**supuesto**,
deliberadamente conservador). Cadencia horaria: son magnitudes de 24 h y la
ventana de agregación también es de 24 h, así que pedirlas cada 15 minutos era
gastar cuota en recibir el mismo número. Bajó de 5.088 a ~1.272 llamadas diarias.

**Ausencias conocidas:** `helium-network` y `render-network-bme` responden
**vacío** con HTTP 200 — DefiLlama no publica TVL para ellos. Se declara como
ausencia de dato, no como fuente rota. La narrativa `depin` está sin eje de
fundamento fiable hasta encontrar una fuente mejor.

**Plan B si se cae o cierra:** DefiLlama es sustituible por consultas propias a
The Graph o por Dune, ambas con clave y bastante más trabajo. Ninguna
funcionalidad la exige en exclusiva (ADR-006), pero perderla deja el eje de
fundamento sin cobertura práctica: es la dependencia más profunda que tenemos.

---

## Polymarket

**Acceso:** Gamma API pública, sin clave.

**Endpoint:** `/markets?active=true&closed=false&order=volume24hr&limit=200`.
Una llamada por corrida para todo el universo; los mercados se cruzan localmente
contra las etiquetas del diccionario.

**Límites:** no publicados. **Medido:** sin cabeceras de límite; respuestas
cacheadas 300 s en el borde.

**Nuestro presupuesto:** 30 por minuto, 1.000 al día (**supuesto**). Consumo
real: 96 llamadas diarias.

**Riesgo específico:** el emparejamiento mercado → narrativa es por palabra clave
sobre la pregunta del mercado. Es conservador —sin coincidencia, no se atribuye a
nadie— pero un falso positivo mete señal de una narrativa en otra. Es la parte
más frágil del eje de atención y merece revisión cuando haya volumen.

---

## Reddit

**Acceso:** **OAuth de aplicación obligatorio.**

**Medido:** el endpoint público `/r/{sub}/new.json` devuelve **403** desde
infraestructura de servidor. El bloqueo viene de su propio CDN, no de nuestra
red. No es una limitación de cuota: es que el JSON público no está disponible
para clientes de datacenter, punto.

**Qué hace falta:** una app de tipo *script* en reddit.com/prefs/apps →
`REDDIT_CLIENT_ID` y `REDDIT_CLIENT_SECRET`. Gratis. El token se pide con
`client_credentials` y **no se persiste en `source_snapshot`**: un snapshot es
evidencia que guardamos y consultamos, y una credencial no tiene por qué acabar
en una tabla.

**Límites:** 100 peticiones por minuto por cliente OAuth (**documentado**).
Nuestro consumo serían 11 subreddits cada 15 minutos: 44 por hora, 1.056 al día.
El límite no es el problema; la credencial lo era.

**Qué se rompe sin ella:** hoy, con Reddit fuera, solo 4 de las 15 narrativas
tienen serie de atención — las que casan con mercados de Polymarket. El
cuadrante de las otras once se apoya en un eje muerto, y por eso la corrida
declara `not_configured` en cada una en vez de fingir cobertura.

**Lo que Reddit no da:** el listado no trae la antigüedad ni el historial del
autor. Averiguarlo costaría una llamada por autor. Mientras tanto,
`authorHasHistory` es `null` y pesa como "sin historial": ante la duda, el peso
bajo.

---

## Fuentes de M2, todavía sin integrar

**DEX Screener** — `/latest/dex/tokens/{address}`. **Medido:** funciona sin
clave; 30 pares con liquidez, precio y volumen para un token de Solana, 38 kB.
Es la vía para el bloque de liquidez del lens.

**GeckoTerminal** — **medido:** responde sin clave. Segunda opinión para precio
y liquidez, útil precisamente para no depender de DEX Screener en exclusiva.

**Distribución de tenedores** — **medido:** el RPC público de Solana devuelve
**429 a la primera llamada** de `getTokenLargestAccounts`. No es cuestión de ir
más despacio: ese dato no se obtiene sin un proveedor con clave (Helius,
QuickNode o similar). El FR-001 pide distribución de tenedores, así que **M2
está bloqueado por esta credencial**, no por código pendiente.

---

## Extractores externos (n8n)

Existe `POST /ingest/snapshot`, autenticado con `INGEST_TOKEN`, para que un
extractor externo entregue payloads crudos.

**Lo que n8n resuelve:** una IP de salida distinta —relevante para bloqueos por
origen como el 403 de Reddit— y la gestión de credenciales fuera de nuestro
despliegue.

**Lo que n8n no resuelve:** los límites de tasa aguas arriba son exactamente los
mismos, y las credenciales siguen haciendo falta. Mover la llamada de sitio no
cambia quién la contesta.

**La regla:** n8n es transportista, nunca intérprete. El endpoint acepta el crudo
y calcula el hash en servidor; rechaza fuentes desconocidas, `requestKey` que
`derive.ts` no sabría leer, y cualquier intento de mandar valores ya calculados.
El día que aceptáramos un valor computado desde fuera, perderíamos la capacidad
de recalcular la historia, que es la propiedad por la que existe todo el diseño.
