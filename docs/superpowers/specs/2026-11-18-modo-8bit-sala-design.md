# Ruta Fito: modo 8 bits + Fito animado + sala de la familia (diseño)

Rama: `feat/8bit-sala`. Se publica aparte, con un link de prueba propio, sin tocar la app que Lean usa en ruta.

## Intención
La familia de Lean está dividida y no siempre se escribe por WhatsApp. Lean quiere un lugar propio del viaje donde todos puedan:
- ver dónde están él y Fito;
- leer sus "señales de vida", con fotos;
- escribir en una sala común, sin depender de WhatsApp.

La estética de videojuego de 8 bits y Fito animado hacen que sea un lugar lindo de visitar, no solo un mapa de seguimiento.

## Objetivos
1. **Rediseño de la vista "Seguinos":**
   - El mapa ocupa toda la pantalla, con una barra de estado de la próxima parada arriba y una barra inferior estilo iOS.
   - Estética 8 bits con píxeles visibles y una paleta corta.
2. **Fito en el mapa:**
   - En ruta, el marcador es la cara de Fito en pixel art (16×16, escalada ×3).
   - Parados en una parada, es Fito de cuerpo entero moviendo la cola, con una animación en bucle de 4 cuadros estilo arcade.
3. **Sala común:**
   - La familia escribe desde la app. Pone su nombre la primera vez y el celular lo recuerda.
   - Lean publica texto y fotos mandándoselos al bot de Telegram.
   - Los eventos del viaje ("Pararon en Azul", "Llegaron") aparecen solos en la sala.
   - Los mensajes de la familia le llegan a Lean por Telegram en silencio, sin sonido, para no distraerlo si maneja.
4. **Link de prueba propio:** la producción sigue funcionando igual.

## No objetivos
- Cuentas, contraseñas o perfiles.
- Fotos subidas por la familia: solo texto. Las fotos son de Lean, por el bot.
- Mensajes privados: es una sala común, decisión de Lean.
- Pasar a producción durante el viaje: eso se decide después de probar.
- Cambiar la app del conductor (`index.html`).

## Anti-objetivos
- Que la versión de prueba mande avisos de parada, nafta o noche duplicados a Lean: debe estar en **modo silencioso**.
- Que un error en la versión de prueba afecte al bot o a los avisos de producción.
- Que la sala quede abierta a cualquiera: escribir y leer exige el token del link.
- Que la estética sacrifique la lectura: el texto del chat y de la barra de estado tiene que leerse bien en un celular a pleno sol.

## Restricciones
- **El bot de Telegram tiene un solo webhook**, que apunta a producción.
- **Todo en el plan gratuito de Cloudflare.** El token actual tiene permisos de Workers y KV, pero no sabemos si los tiene para D1 o Pages.
- **Plazo:** el link de prueba tiene que estar listo antes de las 9:00 del jueves 19, hora de salida del día 2.
- **Repo público:** ningún token ni link con token va en logs ni en el código.

## Enfoques considerados
| | Enfoque | Contra principal |
|---|---|---|
| **A (elegido)** | La producción reenvía una copia de cada update del dueño a un Worker de prueba con estado propio, que sirve la vista 8 bits y la sala | Cambia una línea en producción esta noche |
| B | Worker de prueba con un segundo bot de Telegram | Dos bots durante el viaje |
| C | Todo en el Worker de producción | Toca lo que guía el viaje y no tiene link de prueba separado. Descartado |

## Diseño

### Cambio en producción (único)
- En `/tg`, después de procesar un update **del dueño**, en el chat privado, la producción reenvía el JSON del update al Worker de prueba:
  - Se reenvía con `ctx.waitUntil` y `try/catch`, así que nunca bloquea ni rompe la respuesta.
  - Va con el header `X-Ruta-Forward: <secreto>` y el header `X-Ruta-Owner: <owner id>`.
- Se activa solo si existe la variable `PREVIEW_URL`. Sin ella, la producción se comporta igual que hoy.
- **Test:** si el reenvío falla o tarda, la producción responde igual.

### Worker de prueba `ruta-fito-preview`
- **Sirve la webapp** como assets estáticos (Workers Static Assets). Es el mismo origen, así que no hace falta CORS, y solo requiere permisos de Workers, que ya tenemos.
- **Reusa la lógica de producción:** ubicación, detección de paradas y plan vivo, con estado propio en un KV de prueba.
- **Modo silencioso** (`SILENT=1`):
  - No tiene cron ni manda avisos de paradas, plan, nafta, noche ni ubicación perdida.
  - Solo le manda a Lean por Telegram los mensajes de la sala (en silencio) y la respuesta a `/prueba`.
- **La sala vive en un Durable Object (SQLite)**, por consistencia fuerte y orden garantizado. KV no sirve porque su listado puede tardar hasta un minuto en mostrar mensajes nuevos.
  - Mensaje: `id, ts, author, kind ('family' | 'lean' | 'event'), text, photo_file_id`.
  - Se guardan los últimos 500 y se borran los más viejos.
- **Endpoints, todos con `?k=<token>`:**
  - `GET /api/public`: el mismo contenido que el `/public` de producción.
  - `GET /api/chat?after=<id>`: mensajes nuevos.
  - `POST /api/chat`: recibe `{name, text}`. Texto de hasta 500 caracteres y nombre de hasta 30. Limitado a 1 mensaje cada 5 s por IP y nombre.
  - `GET /api/photo/<file_id>`: proxy de la foto de Telegram (`getFile`), con caché de 1 día. El token del bot nunca llega al navegador.
- **Lo que publica Lean por el bot:** texto o foto con texto en el chat privado, que no sea comando ni ubicación, va a la sala como "Lean".
  - En producción esos mensajes hoy se ignoran, así que no hay conflicto.
- **Moderación:** si Lean responde con `/borrar` a un mensaje reenviado, ese mensaje se borra de la sala.
- **Eventos:** las llegadas a paradas y las salidas que detecta la lógica existente se agregan a la sala como mensajes del sistema.
- **Link de prueba:** Lean le manda `/prueba` al bot. La producción ignora comandos que no conoce y la versión de prueba responde con el link y su token.

### Webapp 8 bits (`preview/`)
- **Layout a pantalla completa:**
  - Mapa de fondo.
  - Arriba, una barra de estado tipo HUD: ícono de la parada, nombre, km, hora estimada de llegada y una barra de progreso del día estilo "HP", en bloques.
  - Abajo, una barra de 3 pestañas estilo iOS: **Mapa · Ruta · Sala**, con un contador de mensajes nuevos.
  - Ruta y Sala abren como paneles a pantalla completa sobre el mapa.
- **Estilo Street Fighter, arcade de pelea** (elegido por Lean):
  - **Paleta corta:** azul noche `#0b0b1a`, panel `#1a2350`, amarillo arcade `#ffd400`, rojo `#e4262c` y blanco, más el marrón rojizo `#c0662b` y el negro de Fito.
  - **Barra de estado tipo barra de vida:** progreso del día en amarillo sobre rojo. El "reloj" del centro muestra los minutos a la próxima parada y hay un cartel "DÍA 1" / "DÍA 2".
  - **Al llegar a una parada,** un cartel "¡PARADA!" de 2 s, al estilo "FIGHT!". Sin animación si el usuario pidió movimiento reducido.
- **Tipografía:** "Press Start 2P" para títulos y la barra de estado, y "VT323" para el texto del chat y las listas, que es más legible. Las dos son de Google Fonts.
- **Mapa:** los tiles de Esri se agrandan ×2 (tileSize 512 con zoomOffset −1) con `image-rendering: pixelated`, así los píxeles se ven, y un filtro CSS los tiñe de azul noche. La ruta es una línea amarilla con borde negro.
- **Sprites de Fito,** dibujados desde cero como matrices de píxeles en JS y renderizados a canvas:
  - **Cara de 16×16:** marcador en ruta.
  - **Cuerpo de 32×24, 4 cuadros:** marcador cuando el estado del plan es "acá". Mueve la cola y respira subiendo y bajando 1 px, con animación `steps(4)` a 6 fps.
  - **Movimiento reducido:** con `prefers-reduced-motion` se muestra un cuadro fijo.
- **Sala:**
  - Burbujas pixeladas: las de Lean con foto ocupan todo el ancho y las de la familia muestran el nombre. Los eventos aparecen como banners centrados.
  - Campo de texto con etiqueta visible y botón "Enviar".
  - Mientras la sala está abierta se actualiza cada 10 s. Con la sala cerrada, el contador de nuevos se actualiza cada 60 s.
- **Accesibilidad:**
  - Contraste AA o más en el texto del chat.
  - Botones de 48 px.
  - `aria-live` en los mensajes nuevos.

### Deploy
- **Workflow nuevo `preview.yml`** que corre en push a `feat/*`:
  1. Tests.
  2. Build.
  3. Bootstrap de Cloudflare para la prueba: KV propio.
  4. `wrangler deploy` de `ruta-fito-preview` con assets y Durable Object.
  5. Secretos: `TG_TOKEN` y `FORWARD_SECRET`, este último derivado del token como ya hacemos con el webhook.
- **El workflow de producción** se dispara solo con `main`. El cambio de reenvío entra a `main` con `PREVIEW_URL` configurada.

## Riesgos y plan B
- **El plan gratuito o el token no permiten Durable Objects:** la sala usa KV con una clave por mensaje (`msg:<ts>-<rand>`). Los mensajes nuevos pueden tardar hasta 60 s en verse.
- **OSRM o los tiles no están disponibles:** se usa el mismo plan B que en producción.

## A criterio del builder
- El diseño exacto del pixel art y la animación, dentro de lo de arriba.
- Detalles de layout y textos, en tono cálido.

## Decisiones de Claude (para revisar)
- Durable Object para la sala.
- Assets servidos desde el Worker, en lugar de Pages.
- Paleta y tipografías.
- Fotos guardadas en Telegram.
- `/prueba` para obtener el link.
- Reenvío silencioso a Lean de los mensajes de la familia.
