// Builds the Gran Fondo course: route (OSRM along RN40), elevation profile (Open-Meteo),
// climbs (auto-detected + official ones) and the 7 lakes as km markers (Nominatim).
import fs from 'node:fs/promises';
import path from 'node:path';
import { cumulativeKm, projectOnRoute, haversineKm } from '../worker/src/logic.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const cfg = JSON.parse(await fs.readFile(path.join(root, 'data/race.json'), 'utf8'));
const UA = { 'User-Agent': 'ruta-fito/1.0 (gran fondo tracker)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocode(q) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ format: 'jsonv2', q, limit: '1', countrycodes: 'ar' })}`, { headers: UA });
    const j = await r.json(); await sleep(1200);
    return j[0] ? { lat: +j[0].lat, lon: +j[0].lon } : null;
  } catch { return null; }
}

for (const k of ['start', 'finish']) {
  const g = await geocode(cfg[k].query);
  if (g) { cfg[k].lat = g.lat; cfg[k].lon = g.lon; }
  console.log(`${k}: ${cfg[k].lat.toFixed(5)},${cfg[k].lon.toFixed(5)} ${g ? '(geocoded)' : '(fallback)'}`);
}

let route;
for (let i = 1; i <= 5 && !route; i++) {
  try {
    const u = `https://router.project-osrm.org/route/v1/driving/${cfg.start.lon},${cfg.start.lat};${cfg.finish.lon},${cfg.finish.lat}?overview=full&geometries=geojson`;
    const j = await (await fetch(u, { headers: UA })).json();
    if (j.code === 'Ok') route = j.routes[0]; else throw new Error(j.code);
  } catch (e) { console.warn('OSRM retry', e.message); await sleep(i * 3000); }
}
if (!route) throw new Error('OSRM unavailable for the race course');
const coords = route.geometry.coordinates.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]);
const cum = cumulativeKm(coords);
const totalKm = cum.at(-1);
console.log(`course: ${totalKm.toFixed(1)} km (official ${cfg.officialKm}), ${coords.length} pts`);

// Sample every 250 m for the elevation profile.
const STEP = 0.25;
const samples = [];
for (let km = 0, i = 1; km <= totalKm; km += STEP) {
  while (i < cum.length - 1 && cum[i] < km) i++;
  const t = (km - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
  samples.push({ km: +km.toFixed(2), lat: coords[i - 1][1] + t * (coords[i][1] - coords[i - 1][1]), lon: coords[i - 1][0] + t * (coords[i][0] - coords[i - 1][0]) });
}
let elev = null;
try {
  elev = [];
  for (let i = 0; i < samples.length; i += 100) {
    const b = samples.slice(i, i + 100);
    const u = `https://api.open-meteo.com/v1/elevation?latitude=${b.map((s) => s.lat.toFixed(5)).join(',')}&longitude=${b.map((s) => s.lon.toFixed(5)).join(',')}`;
    const j = await (await fetch(u, { headers: UA })).json();
    if (!Array.isArray(j.elevation)) throw new Error(JSON.stringify(j).slice(0, 120));
    elev.push(...j.elevation);
    await sleep(300);
  }
} catch (e) { console.warn('elevation unavailable:', e.message); elev = null; }

let profile = [], climbs = [], gain = 0;
if (elev) {
  // light smoothing (5-sample moving average) to tame DEM noise
  const sm = elev.map((_, i) => { const w = elev.slice(Math.max(0, i - 2), i + 3); return w.reduce((a, b) => a + b, 0) / w.length; });
  profile = samples.map((s, i) => [s.km, Math.round(sm[i])]);
  for (let i = 1; i < sm.length; i++) if (sm[i] > sm[i - 1]) gain += sm[i] - sm[i - 1];
  // climbs: contiguous stretches where the 1 km grade stays >= 4 %
  const win = Math.round(1 / STEP);
  let startI = null;
  const flush = (endI) => {
    const len = profile[endI][0] - profile[startI][0];
    const rise = profile[endI][1] - profile[startI][1];
    if (len >= 0.8 && rise / (len * 1000) >= 0.04) climbs.push({ startKm: profile[startI][0], endKm: profile[endI][0], lenKm: +len.toFixed(1), grade: +((rise / (len * 1000)) * 100).toFixed(1), rise: Math.round(rise) });
  };
  for (let i = 0; i + win < sm.length; i++) {
    const g = (sm[i + win] - sm[i]) / 1000;
    if (g >= 0.04) { if (startI == null) startI = i; }
    else if (startI != null) { flush(Math.min(sm.length - 1, i + win - 1)); startI = null; }
  }
  if (startI != null) flush(sm.length - 1);
  console.log(`elevation: +${Math.round(gain)} m, ${climbs.length} climbs auto-detected`);
}
// Official climbs (from the organizer) mapped onto our course km.
const official = cfg.officialClimbs.map((c) => ({ label: c.label, startKm: +(totalKm - c.fromFinishKm).toFixed(1), endKm: +(totalKm - c.fromFinishKm + c.lenKm).toFixed(1), lenKm: c.lenKm, grade: c.grade, official: true }));
for (const o of official) climbs = climbs.filter((c) => c.endKm < o.startKm - 0.5 || c.startKm > o.endKm + 0.5);
climbs = [...climbs, ...official].sort((a, b) => a.startKm - b.startKm);
for (const c of climbs) console.log(`  climb ${c.startKm}-${c.endKm} km ${c.lenKm} km @ ${c.grade}%${c.official ? ' (oficial)' : ''}`);

// Lakes as markers (projected onto the course; only if near it).
const lakes = [];
for (const name of cfg.lakes) {
  const g = await geocode(`${name}, Neuquén`);
  if (!g) continue;
  const pr = projectOnRoute([g.lon, g.lat], coords, cum);
  if (pr.distKm < 12) lakes.push({ name, km: +pr.km.toFixed(1) });
  console.log(`  lake ${name}: ${g ? `${pr.km.toFixed(1)} km, ${pr.distKm.toFixed(1)} km off` : 'not found'}`);
}

const race = { ...cfg, builtAt: new Date().toISOString(), totalKm: +totalKm.toFixed(2), gain: Math.round(gain), route: coords, profile, climbs, lakes };
await fs.writeFile(path.join(root, 'worker/src/race.built.js'), `export default ${JSON.stringify(race)};\n`);
const out = path.join(root, 'dist/preview/granfondo');
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, 'race.json'), JSON.stringify(race));
console.log('Built race course');
