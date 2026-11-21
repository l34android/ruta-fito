import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareCourse, updateRace, raceView } from '../src/race.js';

// Straight 110 km course heading east at lat -40 (1° lon ≈ 85.2 km).
const lonPerKm = 1 / 85.24;
const route = Array.from({ length: 111 }, (_, i) => [-71.5 + i * lonPerKm, -40]);
const course = prepareCourse({ route, totalKm: 0, climbs: [] });
course.totalKm = course.cum.at(-1);
course.climbs = [{ startKm: 30, endKm: 32, lenKm: 2, grade: 6 }, { startKm: 87, endKm: 88.9, lenKm: 1.9, grade: 7.2, official: true }];
const at = (km, off = 0) => [-71.5 + km * lonPerKm, -40 + off];
const T0 = Date.UTC(2026, 10, 22, 11, 0);

test('not started before the line; start when moving on course', () => {
  let st = updateRace(course, null, at(0.1), T0);
  assert.equal(st.start, null);
  assert.equal(raceView(course, st, T0).started, false);
  st = updateRace(course, st, at(0.6), T0 + 60e3);
  assert.equal(st.start, T0 + 60e3);
});

test('metrics: km, average speed, eta and next climb', () => {
  let st = updateRace(course, null, at(0.5), T0);
  for (let m = 1; m <= 60; m++) st = updateRace(course, st, at(0.5 + m * (30 / 60)), T0 + m * 60e3); // 30 km/h
  const v = raceView(course, st, T0 + 60 * 60e3);
  assert.ok(Math.abs(v.km - 30.5) < 0.2, `km ${v.km}`);
  assert.ok(Math.abs(v.avgKmh - 30) < 1, `avg ${v.avgKmh}`);
  assert.ok(v.inClimb && v.inClimb.startKm === 30);
  assert.equal(v.nextClimb.startKm, 87);
  assert.ok(v.eta && v.remainingKm > 78);
});

test('off-course samples (hotel, car) are ignored', () => {
  const st = updateRace(course, null, at(10, 0.2), T0); // ~22 km north of the course
  assert.equal(st.offCourse, true);
  assert.equal(st.start, null);
});

test('GPS noise never moves progress back more than 500 m; finish detected', () => {
  let st = updateRace(course, null, at(0.5), T0);
  st = updateRace(course, st, at(50), T0 + 90 * 60e3);
  st = updateRace(course, st, at(48), T0 + 91 * 60e3);
  assert.ok(st.maxKm >= 49.8 && st.samples.at(-1).km >= st.maxKm - 0.5, `${st.maxKm} ${st.samples.at(-1).km}`);
  st = updateRace(course, st, at(course.totalKm), T0 + 200 * 60e3);
  const v = raceView(course, st, T0 + 230 * 60e3);
  assert.equal(v.finished, true);
  assert.equal(v.elapsedMin, 200);
});
