# Wanderlust

App personal de viajes de Laura: viajes, billetes, alojamientos, itinerarios, excursiones, documentos, maleta y avisos de cancelación.

- **App (copia en GitHub):** https://laura2112-star.github.io/wanderlust/
- **Versión principal:** el artefacto de Claude "Wanderlust". Esta app es la **copia de seguridad**, independiente de Claude.
- **Accesos directos para el iPhone:** `acceso.html` (abre el artefacto de Wanderlust en Claude) e `italiano.html` (abre el artefacto de Italiano en Claude), con sus iconos.
- **Datos:** se guardan en el Google Drive de quien inicia sesión (ahora perezdelemalaura@gmail.com), en la carpeta `Wanderlust`:
  - `wanderlust-datos.json`: todos los viajes.
  - `Adjuntos/`: los PDFs e imágenes de las reservas.
  - Aquí, en GitHub, solo está el código, nunca los datos.

## Qué hay en este repositorio

- `index.html`: la página del artefacto original, con cinco retoques: activa el mapa de calles de OpenStreetMap en la pestaña Mapa (`window.__wlTiles = true`; el artefacto usa en su lugar un mapa base propio guardado en la colección `mapbase`), carga `drive-shim.js`, los enlaces a adjuntos y las portadas apuntan a Drive, el botón del asistente con IA está oculto (fuera de Claude no funciona) y lleva iconos y manifest para el móvil.
- `drive-shim.js`: sustituye el almacenamiento de Claude (`window.claude.use("db")` y `use("assets")`) por Google Drive (Google Identity Services + Drive API, permiso `drive.file`). Incluye el menú de cuenta (abrir la carpeta de Drive, descargar copia, importar copia, cerrar sesión).

## Funciones que fuera de Claude se resuelven de otra forma

- `ia.js`: asistente con IA usando **Gemini** (Google AI Studio) con la clave de Laura, guardada en su Drive (`settings.geminiKey` dentro de `wanderlust-datos.json`, nunca en GitHub). Ofrece la misma interfaz que la IA de Claude, así funcionan igual el chat (también con fotos), el buscador de restaurantes (con búsqueda de Google), "Pedir más tips" y "Proponer itinerario". Se configura en **Cuenta → Asistente con IA**.
- `correo.js`: **reservas desde el correo**. Lee el Gmail de Wanderlust (perezdelemalaura@gmail.com), al que Hotmail reenvía con una regla los correos de Booking, Rentalcars y aerolíneas. Con Gemini entiende cualquier formato y añade reservas nuevas (con foto y valoración si vienen en el correo, y el hotel en el mapa), aplica cambios y cancelaciones por número de reserva. Sin Gemini solo aplica cancelaciones con referencia conocida. Lo que no puede añadir solo aparece en la portada como "Correos de reservas por revisar". Se usa desde **Cuenta → Revisar el correo de reservas**; después se revisa solo al abrir la app (cada 2 horas como mucho) mientras el acceso siga activo. Requiere la API de Gmail activada en el proyecto de Google Cloud y permiso `gmail.readonly` (de solo lectura).
- En `index.html` (código compartido con el artefacto, activado con `window.__wlOutside = true`):
  - **Tiempo en directo** con Open-Meteo para los viajes que empiezan en menos de 15 días.
  - **Cambio de moneda del día** con open.er-api.com en la pestaña Útil.
  - **Mapa de calles** de OpenStreetMap y búsqueda de sitios con Photon al añadir puntos.
  - **Descargas** (PDF, KML para My Maps, avisos de calendario) directamente desde el navegador.
- En las dos versiones: terminal de salida (habitual en Madrid según la aerolínea), equipaje, **aviso de apertura del check-in** (en la app y como evento de calendario .ics), **"Pegar itinerario"** (acepta el texto de cualquier IA) y **añadir o quitar puntos del mapa**.

## Cómo actualizar la copia desde el artefacto (para Claude)

1. Lee todos los documentos de la colección `trips` del artefacto con ArtifactData (y los adjuntos con Artifact `read` + `path` = id del asset, uno a uno).
2. Construye un archivo de importación: `{"trips": {...}, "files": {"<id antiguo>": {"name", "type", "b64"}}}` solo con los adjuntos que todavía no están en Drive.
3. Para cambiar solo algunos campos de un viaje sin tocar sus adjuntos (por ejemplo, el mapa), usa un archivo `{"patch": {"<id del viaje>": {"map": {...}}}}`: se fusiona con el viaje que ya está en Drive.
4. En el Chrome de Laura, abre la app con la sesión iniciada y usa **Cuenta → Importar copia** con ese archivo. La importación sube los adjuntos a Drive y cambia sus ids. Los viajes con el mismo id se sustituyen; los que se hayan borrado en el artefacto hay que borrarlos aparte con `db.doc("trips/<id>").delete()` desde la consola de la app.

## Cómo volver a crear el artefacto en otra cuenta de Claude

1. Toma `index.html` de este repositorio.
2. Quita las líneas de `window.__wlTiles`/`__wlOutside`, `drive-shim.js`, `ia.js` y `correo.js`, cambia `blobUrl` y `coverHtml` para que vuelvan a usar `"/_blob/" + id` y `<img src=...>`, y vuelve a mostrar el botón del asistente (`$("#fab").hidden = false`).
3. Publica el artefacto con base de datos, adjuntos (assets), usuario e IA (sample).
4. Datos: en la app de GitHub, **Cuenta → Descargar copia de seguridad** da todos los viajes en JSON; cárgalos en la colección `trips`. Los adjuntos están en `Wanderlust/Adjuntos` del Drive y hay que volver a subirlos al artefacto y enlazarlos.

## Cuenta de Google

- Proyecto de Google Cloud: `wanderlust-511911` (propietaria laura.perezdelema@gmail.com).
- Cliente OAuth web autorizado para `https://laura2112-star.github.io`.
- Modo de prueba: solo entran las usuarias añadidas en Google Auth Platform → Público (ahora laura.perezdelema@gmail.com y perezdelemalaura@gmail.com).
