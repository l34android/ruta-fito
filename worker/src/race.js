// Gran Fondo live tracking: projection onto the course, start/finish detection, live metrics.
import { cumulativeKm, projectOnRoute, formatClock } from './logic.js';

export function prepareCourse(race) { return { ...race, cum: cumulativeKm(race.route) }; }

const OFF_COURSE_KM = 3;      // farther than this: not racing (hotel, car, etc.)
const START_KM = 0.3;         // first sample past this km starts the clock
const FINISH_MARGIN_KM = 0.25;

// Update the race state with a new sample. Pure: returns the new state.
export function updateRace(course, state, p, ts) {
  const st = state ? { ...state, samples: [...(state.samples || [])] } : { start: null, finish: null, samples: [], maxKm: 0 };
  const pr = projectOnRoute(p, course.route, course.cum);
  if (pr.distKm > OFF_COURSE_KM) return { ...st, offCourse: true, lastTs: ts };
  // Monotonic progress: GPS noise or a step back never decreases km by more than 0.5.
  const km = Math.max(pr.km, st.maxKm - 0.5);
  if (!st.start && km > START_KM) st.start = ts;
  st.maxKm = Math.max(st.maxKm, km);
  if (!st.finish && st.start && km >= course.totalKm - FINISH_MARGIN_KM) st.finish = ts;
  st.samples.push({ km: +km.toFixed(3), ts });
  st.samples = st.samples.slice(-40);
  st.offCourse = false; st.lastTs = ts;
  return st;
}

function speedOver(samples, minutes) {
  if (samples.length < 2) return null;
  const last = samples.at(-1);
  const first = samples.find((s) => last.ts - s.ts <= minutes * 60e3) || samples[0];
  const h = (last.ts - first.ts) / 3.6e6;
  if (h <= 0) return null;
  return (last.km - first.km) / h;
}

const elevAt = (profile, km) => {
  if (!profile?.length) return null;
  const i = Math.min(profile.length - 1, Math.max(0, Math.round(km / (profile[1][0] - profile[0][0]))));
  return profile[i][1];
};

// Public, family-safe live view of the race.
export function raceView(course, state, now, profile) {
  const total = course.totalKm;
  if (!state?.start) {
    return { started: false, finished: false, km: 0, totalKm: total, nextClimb: course.climbs[0] ? { ...course.climbs[0], inKm: course.climbs[0].startKm } : null };
  }
  const last = state.samples.at(-1);
  const km = Math.min(total, state.maxKm);
  const end = state.finish || now;
  const elapsedMin = Math.round((end - state.start) / 60e3);
  const avgKmh = elapsedMin > 0 ? km / ((end - state.start) / 3.6e6) : null;
  const curKmh = speedOver(state.samples, 8);
  const pace = curKmh && curKmh > 8 ? (curKmh * 0.4 + (avgKmh || curKmh) * 0.6) : avgKmh;
  const remainingKm = Math.max(0, total - km);
  const etaTs = state.finish || (pace && pace > 5 ? now + (remainingKm / pace) * 3.6e6 : null);
  const inClimb = course.climbs.find((c) => km >= c.startKm && km <= c.endKm) || null;
  const next = course.climbs.find((c) => c.startKm > km) || null;
  return {
    started: true,
    finished: !!state.finish,
    km: +km.toFixed(1), totalKm: total, pct: Math.round((km / total) * 1000) / 10,
    elapsedMin, avgKmh: avgKmh ? +avgKmh.toFixed(1) : null, curKmh: curKmh ? +curKmh.toFixed(1) : null,
    remainingKm: +remainingKm.toFixed(1),
    eta: etaTs ? { ts: Math.round(etaTs), clock: formatClock(etaTs) } : null,
    elevation: elevAt(profile, km),
    inClimb: inClimb ? { ...inClimb, leftKm: +(inClimb.endKm - km).toFixed(1) } : null,
    nextClimb: next ? { ...next, inKm: +(next.startKm - km).toFixed(1) } : null,
    ageMin: last ? Math.round((now - last.ts) / 60e3) : null,
    offCourse: !!state.offCourse,
    startedAt: formatClock(state.start),
  };
}
