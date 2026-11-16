import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunsetTs, localTs, detectVisit, livePlan, darkSuggestion, fuelState, formatClock } from '../src/logic.js';

test('sunset in Villa Ventana on 18 Nov is around 20:00 local', () => {
  const s = sunsetTs(-38.0786, -61.9281, '2026-11-18');
  const min = (s - localTs('2026-11-18', '00:00')) / 60e3;
  assert.ok(min > 19 * 60 + 45 && min < 20 * 60 + 20, `got ${formatClock(s)}`);
});

test('sunset in Arroyito on 19 Nov is later (further west)', () => {
  const a = sunsetTs(-39.073, -68.566, '2026-11-19');
  const v = sunsetTs(-38.0786, -61.9281, '2026-11-18');
  assert.ok((a - localTs('2026-11-19', '00:00')) > (v - localTs('2026-11-18', '00:00')) + 20 * 60e3, formatClock(a));
});

const stops = [
  { id: 's0', lat: -38, lon: -62.0, km: 0 },
  { id: 'a', lat: -38, lon: -61.5, km: 44 },
  { id: 'b', lat: -38, lon: -61.0, km: 88 },
];

test('driving past a stop at speed is not an arrival; two samples nearby is', () => {
  const t0 = 1e12;
  // one sample next to "a", next one 3 km past it
  let r = detectVisit({ p: [-61.5, -38], ts: t0, stops, visits: {}, near: null });
  r = detectVisit({ p: [-61.46, -38], ts: t0 + 90e3, stops, visits: r.visits, near: r.near });
  assert.deepEqual(r.visits, {});
  // two samples within radius
  let s = detectVisit({ p: [-61.5, -38], ts: t0, stops, visits: {}, near: null });
  s = detectVisit({ p: [-61.501, -38.001], ts: t0 + 90e3, stops, visits: s.visits, near: s.near });
  assert.equal(s.visits.a.arrivedAt, t0);
  assert.equal(s.events[0].type, 'arrived');
  // leaving
  s = detectVisit({ p: [-61.45, -38], ts: t0 + 30 * 60e3, stops, visits: s.visits, near: s.near });
  assert.equal(s.visits.a.leftAt, t0 + 30 * 60e3);
  assert.equal(s.events[0].type, 'left');
});

const day = {
  id: 'd1', date: '2026-11-18', departure: '10:30', plannedEnd: '13:00',
  stops: [
    { id: 's0', lat: -38, lon: -62, km: 0, plannedArrival: '10:30', dwellMin: 0 },
    { id: 'a', lat: -38, lon: -61.5, km: 60, legKm: 60, legMin: 60, plannedArrival: '11:30', dwellMin: 30 },
    { id: 'b', lat: -38, lon: -61.0, km: 120, legKm: 60, legMin: 60, plannedArrival: '13:00', dwellMin: 0 },
  ],
};

test('live plan shifts ETAs when leaving late', () => {
  const now = localTs('2026-11-18', '11:00'); // 30 min late, still at km 0
  const p = livePlan({ day, currentKm: 0, observedKmh: null, visits: {}, now, live: true });
  assert.equal(formatClock(p.stops[1].eta), '12:00');
  assert.equal(formatClock(p.endEta), '13:30');
  assert.equal(p.delayMin, 30);
  assert.equal(p.stops[1].state, 'next');
});

test('live plan while parked at a stop counts remaining dwell', () => {
  const arrived = localTs('2026-11-18', '11:40');
  const now = localTs('2026-11-18', '11:50'); // 10 of 30 min used
  const p = livePlan({ day, currentKm: 60, observedKmh: null, visits: { a: { arrivedAt: arrived } }, now, live: true });
  assert.equal(p.stops[1].state, 'here');
  assert.equal(formatClock(p.endEta), '13:10'); // leave 12:10 + 60 min
});

test('skipped stops are marked and do not add dwell', () => {
  const now = localTs('2026-11-18', '11:40');
  const p = livePlan({ day, currentKm: 70, observedKmh: null, visits: {}, now, live: true });
  assert.equal(p.stops[1].state, 'skipped');
  assert.equal(formatClock(p.endEta), '12:30');
});

test('dark suggestion proposes shortening the longest stop', () => {
  const plan = { endEta: 1000 * 60e3, sunset: 985 * 60e3, stops: [{ state: 'visited' }, { state: 'pending' }, { state: 'pending' }] };
  const s = darkSuggestion(day, plan);
  assert.equal(s.overMin, 15);
  assert.equal(s.cuts[0].stop.id, 'a');
  assert.equal(s.enough, false); // only 10 min can be saved (30 → 20)
});

const days = [
  { id: 'd1', totalKm: 575, stops: [{ id: 'x0', km: 0 }, { id: 'olav', km: 355, fuel: true, detourKm: 2 }, { id: 'vv', km: 575 }] },
  { id: 'd2', totalKm: 706, stops: [{ id: 'y0', km: 0 }, { id: 'bb', km: 106, fuel: true }, { id: 'rc', km: 267, fuel: true }, { id: 'ch', km: 407, fuel: true }, { id: 'end', km: 705 }] },
];

test('fuel: start full, next fill Olavarría', () => {
  const f = fuelState({ days, dayId: 'd1', currentKm: 100 });
  assert.equal(f.next.id, 'olav');
  assert.equal(f.sinceKm, 100);
  assert.equal(f.risk, 'ok');
});

test('fuel: skipping Bahía Blanca after Olavarría puts Río Colorado over the 450 rule', () => {
  // Filled at Olavarría (odo 357). On day 2 just past Bahía Blanca (km 110), no fill there.
  const f = fuelState({ days, dayId: 'd2', currentKm: 110, lastFillOdo: 357 });
  assert.equal(f.next.id, 'rc');
  assert.equal(f.next.atKm, 575 + 267 - 357);
  assert.equal(f.risk, 'warn');
});

test('fuel: must fill at next when the one after is too far', () => {
  const f = fuelState({ days, dayId: 'd2', currentKm: 200, lastFillOdo: 575 + 106 });
  assert.equal(f.next.id, 'rc');
  assert.equal(f.mustFillAtNext, false); // ch is 407-106=301 from last fill
  const g = fuelState({ days, dayId: 'd1', currentKm: 300, lastFillOdo: 0 });
  assert.equal(g.mustFillAtNext, true); // after Olavarría the next is Bahía, 681 km from start
});
