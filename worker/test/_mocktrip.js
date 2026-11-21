// Writes a straight-line mock of trip.built.js (atomic, idempotent) so tests can import the Workers.
import fs from 'node:fs/promises';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
export const builtPath = path.join(here, '../src/trip.built.js');
export async function ensureMockTrip() {
  const trip = JSON.parse(await fs.readFile(path.join(here, '../../data/trip.json'), 'utf8'));
  const { cumulativeKm } = await import('../src/logic.js');
  trip.days = trip.days.map((d) => {
    const route = d.stops.map((s) => [s.lon, s.lat]);
    const cum = cumulativeKm(route);
    return { ...d, route, totalKm: Math.round(cum.at(-1)), driveMin: 600, plannedEnd: '19:00',
      stops: d.stops.map((s, i) => ({ ...s, km: cum[i], plannedArrival: '12:00', legKm: i ? cum[i] - cum[i - 1] : 0, legMin: i ? Math.round((cum[i] - cum[i - 1]) / 1.3) : 0 })) };
  });
  // Mock race course too (straight line, 110 km) so modules importing race.built.js load in tests.
  const racePath = path.join(here, '../src/race.built.js');
  const lonPerKm = 1 / 85.24;
  const race = { id: 'gf-test', name: 'Gran Fondo Test', date: '2026-11-22', officialKm: 110, totalKm: 110, gain: 1500,
    route: Array.from({ length: 111 }, (_, i) => [-71.5 + i * lonPerKm, -40]), climbs: [{ startKm: 87, endKm: 88.9, lenKm: 1.9, grade: 7.2, official: true }], lakes: [] };
  const rtmp = `${racePath}.${process.pid}.tmp`;
  await fs.writeFile(rtmp, `export default ${JSON.stringify(race)};\n`);
  await fs.rename(rtmp, racePath);
  const tmp = `${builtPath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `export default ${JSON.stringify(trip)};\n`);
  await fs.rename(tmp, builtPath);
  return trip;
}
