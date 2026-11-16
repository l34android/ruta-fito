# Ruta Fito 🐕

Berisso → Villa Ventana → Arroyito (18–19 nov 2026) con Fito.

- **Webapp** (GitHub Pages): mapa con la ruta, paradas y "Próxima parada" en vivo.
- **Worker** (Cloudflare): recibe la ubicación en tiempo real que compartís con el bot de Telegram, y cada 15 min avisa ~20–35 min antes de cada parada.

## Uso en viaje
1. Abrí el bot en Telegram y mandá `/start`.
2. 📎 → Ubicación → **Compartir ubicación en tiempo real** → "hasta que la desactive".
3. Comandos: `/estado`, `/plan`, `/ruta`, `/cargue` (anotar que cargaste nafta fuera del plan), `/reset`.

## Plan vivo
Los horarios se recalculan con tu avance real y las paradas que hacés. El bot avisa si a este ritmo llegarías de noche (y qué parada acortar) o si te podés quedar corto de nafta.

## Seguinos (familia)
- `/compartir` te da un link de solo lectura para familia y amigos (`/compartir nuevo` anula el anterior). A menos de 5 km de casa la posición no se muestra.
- Agregá el bot a un grupo de Telegram de la familia y escribí `/familia` ahí: el bot avisa cuando salen, cada parada y la llegada.

## Cambiar paradas
Editá `data/trip.json` y hacé push: el workflow recalcula la ruta (OSRM), corre los tests y redeploya todo.

Secretos del repo: `CLOUDFLARE_API_TOKEN`, `TG_TOKEN`.
