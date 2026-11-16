# Ruta Fito 🐕

Berisso → Villa Ventana → Arroyito (18–19 nov 2026) con Fito.

- **Webapp** (GitHub Pages): mapa con la ruta, paradas y "Próxima parada" en vivo.
- **Worker** (Cloudflare): recibe la ubicación en tiempo real que compartís con el bot de Telegram, y cada 15 min avisa ~20–35 min antes de cada parada.

## Uso en viaje
1. Abrí el bot en Telegram y mandá `/start`.
2. 📎 → Ubicación → **Compartir ubicación en tiempo real** → "hasta que la desactive".
3. Comandos: `/estado`, `/plan`, `/ruta`.

## Cambiar paradas
Editá `data/trip.json` y hacé push: el workflow recalcula la ruta (OSRM), corre los tests y redeploya todo.

Secretos del repo: `CLOUDFLARE_API_TOKEN`, `TG_TOKEN`.
