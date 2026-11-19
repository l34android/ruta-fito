// Build step (runs in GitHub Actions, which has internet):
//  1. Route each day through its stops with the public OSRM server.
//  2. Compute each stop's km along the route and a planned schedule.
//  3. Emit trip.built.json for the webapp and trip.built.js for the Worker.
import fs from 'node:fs/promises';
import path from 'node:path';
import { cumulativeKm, projectOnRoute } from '../worker/src/logic.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const trip = JSON.parse(await fs.readFile(path.join(root, 'data/trip.json'), 'utf8'));

async function osrm(stops) {
  const coords = stops.map((s) => `${s.lon},${s.lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'ruta-fito/1.0' } });
      const j = await r.json();
      if (j.code === 'Ok') return j.routes[0];
      throw new Error(j.code);
    } catch (e) {
      console.warn(`OSRM attempt ${attempt} failed: ${e.message}`);
      await new Promise((res) => setTimeout(res, attempt * 3000));
    }
  }
  throw new Error('OSRM unavailable');
}

function addMinutes(hhmm, min) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + Math.round(min);
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

const built = { ...trip, builtAt: new Date().toISOString(), days: [] };
for (const day of trip.days) {
  const r = await osrm(day.stops);
  const route = r.geometry.coordinates.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]);
  const cum = cumulativeKm(route);
  let clock = day.departure;
  const stops = day.stops.map((s, i) => {
    const proj = projectOnRoute([s.lon, s.lat], route, cum);
    if (i > 0) clock = addMinutes(clock, r.legs[i - 1].duration / 60);
    const arrive = clock;
    const legKm = i > 0 ? Math.round(r.legs[i - 1].distance / 1000) : 0;
    const legMin = i > 0 ? Math.round(r.legs[i - 1].duration / 60) : 0;
    clock = addMinutes(clock, s.dwellMin || 0);
    return { ...s, km: Math.round(proj.km * 10) / 10, legKm, legMin, plannedArrival: arrive };
  });
  built.days.push({
    ...day, stops, route,
    totalKm: Math.round(r.distance / 1000),
    driveMin: Math.round(r.duration / 60),
    plannedEnd: stops[stops.length - 1].plannedArrival,
  });
  console.log(`${day.id}: ${Math.round(r.distance / 1000)} km, ${Math.round(r.duration / 60)} min driving, ${route.length} pts`);
  for (const s of stops) console.log(`  ${s.plannedArrival}  km ${s.km}\t${s.name}`);
}

// Fuel sanity check: km driven between fuel opportunities (ACA stops / start full).
let sinceFuel = 0;
for (const d of built.days) {
  let prev = 0;
  for (const s of d.stops) {
    sinceFuel += s.km - prev; prev = s.km;
    if (sinceFuel > trip.fuelRuleKm) console.warn(`⚠️ ${Math.round(sinceFuel)} km without fuel before ${s.name}`);
    if (s.type === 'nafta' || (s.aca && s.type !== 'salida') ) sinceFuel = 0;
  }
}

const webDir = path.join(root, 'dist/web');
await fs.rm(webDir, { recursive: true, force: true });
await fs.cp(path.join(root, 'web'), webDir, { recursive: true });
await fs.writeFile(path.join(webDir, 'trip.built.json'), JSON.stringify(built));
// Cache-bust assets so a redeploy shows up immediately on the phone/tablet.
const v = Date.now().toString(36);
for (const page of ['index.html', 'seguir.html']) {
  const f = path.join(webDir, page);
  await fs.writeFile(f, (await fs.readFile(f, 'utf8'))
    .replace('href="styles.css"', `href="styles.css?v=${v}"`)
    .replace('src="config.js"', `src="config.js?v=${v}"`)
    .replace('src="app.js"', `src="app.js?v=${v}"`)
    .replace('src="seguir.js"', `src="seguir.js?v=${v}"`));
}
const workerUrl = process.env.WORKER_URL || '';
await fs.writeFile(path.join(webDir, 'config.js'), `window.RUTA_CONFIG = ${JSON.stringify({ workerUrl, bot: process.env.BOT_USERNAME || '' })};\n`);
await fs.writeFile(path.join(root, 'worker/src/trip.built.js'), `export default ${JSON.stringify(built)};\n`);
// 8-bit preview app (served as static assets by the preview Worker).
const prevDir = path.join(root, 'dist/preview');
await fs.rm(prevDir, { recursive: true, force: true });
try {
  await fs.cp(path.join(root, 'preview'), prevDir, { recursive: true });
  await fs.writeFile(path.join(prevDir, 'trip.built.json'), JSON.stringify(built));
  const pf = path.join(prevDir, 'index.html');
  await fs.writeFile(pf, (await fs.readFile(pf, 'utf8'))
    .replace('href="style.css"', `href="style.css?v=${v}"`)
    .replace('src="sprites.js"', `src="sprites.js?v=${v}"`)
    .replace('src="app.js"', `src="app.js?v=${v}"`));
} catch (e) { if (e.code !== 'ENOENT') throw e; }
console.log('Built dist/web, dist/preview and worker/src/trip.built.js');
