# Ruta Fito — Berisso → Arroyito (18–19 nov 2026) — Diseño

## Intención
Lean viaja en su Ranger 2.0 biturbo 2023 XLT (autonomía ~600 km) con Fito, su boyero de Berna, desde Berisso hasta Arroyito, Neuquén (-39.0734, -68.5665). Quiere manejar tranquilo: paradas cada 2–3 h en lugares verdes donde Fito pueda bajar, nafta en estaciones ACA (es socio) y una noche a mitad de camino. Una webapp le muestra la ruta, y un bot de Telegram le avisa antes de cada parada sin que tenga que mirar nada.

## Objetivos
- Ruta completa en dos días, con paradas elegidas a mano:
  - **Día 1 (mié 18, salida 10–11 h):** Berisso → Villa Ventana (~590 km), noche en cabaña que acepte perros grandes.
  - **Día 2 (jue 19):** Villa Ventana → Bahía Blanca → RN22 → Arroyito (~660 km), con parada larga en Río Colorado (ACA, junto al río).
- Paradas de descanso cada 2–3 h, en lugares con verde, con desvío de la ruta principal de 30 km como máximo.
- Nafta en estaciones ACA. Se carga antes de los ~450 km recorridos con el tanque, para dejar margen sobre los 600 km de autonomía.
- Aviso por Telegram ~20–25 min antes de cada parada, con el nombre, una línea de descripción y el link de Waze.
- Webapp legible de un vistazo: mapa con la ruta trazada, paradas numeradas con su descripción, tarjeta grande de "Próxima parada".
- Todo en servicios gratuitos.

## No objetivos
- Recalcular la ruta en vivo, ver el tránsito o desviarse automáticamente. Para eso está Waze.
- Mostrar la app en la pantalla de la Ranger: SYNC 4 no tiene navegador y Android Auto/CarPlay no admiten webapps. Se usa en el celular o una tablet.
- Reservas, pagos, varios usuarios, reutilizar la app para otros viajes.

## Anti-objetivos (fallaría aunque "funcione")
- Una UI que obligue a tocar o leer letra chica mientras se maneja.
- Un aviso que no llega y nadie se entera. Si la ubicación deja de llegar, el bot lo dice.
- Quedarse corto de nafta en un tramo largo (por ejemplo, Río Colorado → Choele Choel → Neuquén).

## Restricciones
- **Waze:** un link (`waze.com/ul?ll=…&navigate=yes`) abre un solo destino. La app da un link por tramo y una lista para cargar el trayecto con paradas a mano en la app de iOS antes de salir.
- **Ubicación:** sale de la función "Compartir ubicación en tiempo real" de Telegram con el bot, en modo "hasta que la desactive", al arrancar cada día.
- **Plazo:** tiene que estar andando el miércoles 18 antes de las 10.
- **Cuentas que pone Lean:** el bot se crea con @BotFather desde su Telegram y la cuenta de Cloudflare la crea él. GitHub ya lo tiene.

## Enfoques considerados
| | Enfoque | Contra principal |
|---|---|---|
| **A (elegido)** | GitHub Pages (webapp) + Cloudflare Worker: webhook de Telegram, cron cada 15 min, endpoint de estado | Dos servicios y una cuenta nueva en Cloudflare |
| B | GitHub Pages + GitHub Actions con cron cada 15 min | El cron de Actions se atrasa entre 10 y 30 min o saltea ejecuciones, así que no sirve para avisar con anticipación |
| C | Sin servidor: la página lee el GPS y manda mensajes a Telegram | Deja de andar con la pantalla bloqueada o con Waze al frente |

Lean eligió **A**.

## Diseño

### Datos (fijos y versionados)
- `data/trip.json`: los dos días y la lista ordenada de paradas. Cada parada lleva `id`, `día`, `nombre`, `tipo` (nafta, descanso, noche, destino), `aca: bool`, `lat/lon`, `km` acumulado sobre la ruta, `descripción` (1–2 líneas), `para Fito` (verde, sombra, agua, si se puede soltar) y `desvío_km`.
- `data/route.geojson`: el trazado de la ruta, calculado una sola vez con un ruteador OSM (OSRM o GraphHopper) y guardado en el repo.
- Las paradas las investiga y las cura Claude antes de construir: mapas, sitio de ACA, reseñas. Para la cabaña, hay que confirmar por teléfono que acepta un perro de más de 40 kg.

**Borrador de paradas, a confirmar en la investigación:**
- **Día 1:** Berisso → ~2 h de descanso (zona Cañuelas–Las Flores) → Azul (ACA más balneario o parque junto al arroyo) → ~2 h más, zona Pringles o Tornquist → Villa Ventana.
- **Día 2:** Villa Ventana → Bahía Blanca o Médanos (nafta) → Río Colorado (ACA, nafta, río) → Choele Choel o Chelforó (río Negro) → Villa Regina o Chichinales → Arroyito.

### Cloudflare Worker
- **`POST /tg/<secret>`:** webhook del bot. Toma `message.location` y `edited_message.location` y guarda la última posición con su hora. Las escrituras se limitan a una cada ~2 min, porque la ubicación en tiempo real manda actualizaciones muy seguido y KV tiene un límite diario de escrituras gratis. Si eso no alcanza, se usa D1. También responde `/estado` (próxima parada, km, hora estimada de llegada) y `/ruta` (link a la webapp).
- **Cron `*/15 * * * *`:**
  1. Proyecta la última posición sobre `route.geojson` para obtener el km actual.
  2. Busca la próxima parada (la primera con km mayor al actual).
  3. Estima la hora de llegada con la velocidad promedio de las últimas posiciones, o 90 km/h si no hay datos.
  4. Si la parada está a ≤ 35 min, todavía no se avisó y probablemente no llegue al próximo ciclo, manda el aviso.
  5. También avisa:
     - una vez si la ubicación no se actualiza hace más de 30 min con el viaje en curso;
     - al inicio de cada día, con el plan del día;
     - al llegar a destino.
  6. Deduplica los avisos por parada.
- **`GET /status`:** devuelve un JSON con posición, km, próxima parada, hora estimada y antigüedad del dato, con CORS habilitado para el dominio de Pages.
- **Secretos:** token del bot, chat id de Lean y secreto del webhook.

### Webapp (GitHub Pages, estática)
- Mapa con Leaflet o MapLibre y tiles OSM en tema oscuro. Muestra la ruta, las paradas numeradas con color por tipo (nafta, descanso, noche, destino) y "estás acá" (consulta `/status` cada 60 s).
- **Arriba, tarjeta grande "Próxima parada":** nombre, a cuántos km y a qué hora se llega, un ícono por tipo y un botón grande "Abrir en Waze".
- **Panel lateral o inferior:** pestañas Día 1 y Día 2, cada una con la lista de paradas y su descripción, la nota para Fito y el link de Waze. También el botón "Copiar lista para Waze".
- **Estilo y accesibilidad:**
  - Oscuro, alto contraste (WCAG AA como mínimo, AAA en lo principal), tipografía grande.
  - Áreas táctiles de ≥ 48 px y diseño que funciona en horizontal (tablet o celular en el soporte).
  - Respeta `prefers-reduced-motion`. Íconos con texto, no solo color.
  - Si el dato tiene más de 20 min, lo marca como "sin señal".
- Si el Worker no responde, la ruta y las paradas igual se ven, porque los datos son estáticos.

## Lo que queda a criterio del builder
- Elegir entre Leaflet y MapLibre, el proveedor de tiles oscuros gratuito y entre KV y D1.
- El algoritmo de proyección sobre la ruta y la estimación de la hora de llegada, dentro del criterio de arriba.
- El texto exacto de los mensajes.
- Tests: proyección, elección de la próxima parada, regla de aviso y deduplicación.

## Lo que necesita Lean antes del miércoles
1. Crear el bot con @BotFather y pasar el token.
2. Crear una cuenta en Cloudflare y un API token para deploy de Workers, o hacer el deploy él con un comando.
3. Elegir el repo de GitHub donde se publica.
4. El miércoles: mandarle `/start` al bot y compartir la ubicación en tiempo real "hasta que la desactive".
