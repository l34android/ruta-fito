import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineKm, cumulativeKm, projectOnRoute, pickDay, nextStop,
  estimateSpeedKmh, etaMinutes, shouldNotify, isStale, argentinaDate, computeStatus, wazeLink,
} from '../src/logic.js';

// A straight east-west line along lat -38, ~100 km long.
const line = [[-62.0, -38.0], [-61.5, -38.0], [-60.86, -38.0]];
const cum = cumulativeKm(line);

test('haversine ~ 87.6 km per degree of longitude at 38°S', () => {
  const d = haversineKm([-62, -38], [-61, -38]);
  assert.ok(Math.abs(d - 87.6) < 0.5, `got ${d}`);
});

test('projection lands mid-segment and reports distance off route', () => {
  const p = [-61.75, -38.05]; // ~5.5 km south of the line, a quarter of the way
  const r = projectOnRoute(p, line, cum);
  assert.ok(Math.abs(r.km - haversineKm(line[0], [-61.75, -38])) < 0.3, `km ${r.km}`);
  assert.ok(Math.abs(r.distKm - 5.55) < 0.3, `dist ${r.distKm}`);
});

test('projection clamps before the start', () => {
  const r = projectOnRoute([-62.5, -38], line, cum);
  assert.equal(r.km, 0);
});

const stops = [
  { id: 'a', km: 0 }, { id: 'b', km: 40 }, { id: 'c', km: 80 },
];

test('next stop skips the one we are standing at', () => {
  assert.equal(nextStop(stops, 39.5).id, 'c');
  assert.equal(nextStop(stops, 10).id, 'b');
  assert.equal(nextStop(stops, 85), null);
});

test('speed estimate uses recent window and clamps', () => {
  const t0 = 1_000_000;
  const h = [{ km: 0, ts: t0 }, { km: 22.5, ts: t0 + 15 * 60e3 }]; // 90 km/h
  assert.equal(Math.round(estimateSpeedKmh(h)), 90);
  assert.equal(estimateSpeedKmh([{ km: 0, ts: t0 }, { km: 1, ts: t0 + 15 * 60e3 }]), 85, 'stopped -> default');
  assert.equal(estimateSpeedKmh([{ km: 0, ts: t0 }, { km: 50, ts: t0 + 15 * 60e3 }]), 110, 'clamped');
  assert.equal(estimateSpeedKmh([]), 85);
});

test('eta and notification rule', () => {
  assert.equal(etaMinutes(45, 90), 30);
  assert.equal(shouldNotify({ etaMin: 30, alreadyNotified: false }), true);
  assert.equal(shouldNotify({ etaMin: 30, alreadyNotified: true }), false);
  assert.equal(shouldNotify({ etaMin: 50, alreadyNotified: false }), false);
});

test('stale detection', () => {
  assert.equal(isStale(0, 31 * 60e3), true);
  assert.equal(isStale(0, 10 * 60e3), false);
});

test('argentina date is UTC-3', () => {
  // 2026-11-18 02:00 UTC is still the 17th in Argentina
  assert.equal(argentinaDate(Date.UTC(2026, 10, 18, 2)), '2026-11-17');
  assert.equal(argentinaDate(Date.UTC(2026, 10, 18, 13)), '2026-11-18');
});

const day1 = { id: 'd1', date: '2026-11-18', label: 'Día 1', route: line, cum, stops: [{ id: 's0', km: 0, name: 'Inicio' }, { id: 's1', km: 50, name: 'Mitad', type: 'descanso' }, { id: 's2', km: cum[cum.length - 1], name: 'Fin', type: 'noche' }] };
const line2 = [[-60.86, -38.0], [-60.86, -39.0]];
const cum2 = cumulativeKm(line2);
const day2 = { id: 'd2', date: '2026-11-19', label: 'Día 2', route: line2, cum: cum2, stops: [{ id: 't0', km: 0, name: 'Fin' }, { id: 't1', km: cum2[1], name: 'Destino', type: 'destino' }] };

test('pickDay uses the date to break ties at the shared overnight point', () => {
  const p = [-60.86, -38.0];
  assert.equal(pickDay(p, [day1, day2], '2026-11-18').day.id, 'd1');
  assert.equal(pickDay(p, [day1, day2], '2026-11-19').day.id, 'd2');
  assert.equal(pickDay([-60.86, -38.6], [day1, day2], '2026-11-18').day.id, 'd2', 'clearly on day 2 route');
});

test('computeStatus returns next stop with eta', () => {
  const now = Date.UTC(2026, 10, 18, 15);
  const st = computeStatus({ pos: { lat: -38, lon: -61.8, ts: now }, history: [], days: [day1, day2], now });
  assert.equal(st.dayId, 'd1');
  assert.equal(st.next.id, 's1');
  assert.ok(st.next.remainingKm > 30 && st.next.remainingKm < 40);
  assert.equal(st.arrived, false);
});

test('waze link format', () => {
  assert.equal(wazeLink(-38.1, -62.2), 'https://waze.com/ul?ll=-38.100000%2C-62.200000&navigate=yes');
});
