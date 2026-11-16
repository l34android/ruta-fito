// Pure trip logic: geometry, projection onto route, next stop, ETA, notification rules.
// No I/O here so it can be unit-tested with node --test.

const R = 6371; // km

export function haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Cumulative km for each vertex of a [lon,lat] line.
export function cumulativeKm(coords) {
  const out = [0];
  for (let i = 1; i < coords.length; i++) out.push(out[i - 1] + haversineKm(coords[i - 1], coords[i]));
  return out;
}

// Project point p ([lon,lat]) onto polyline. Returns { km, distKm } where km is
// distance along the route and distKm the perpendicular-ish distance to it.
// Uses a local equirectangular approximation per segment (fine at this scale).
export function projectOnRoute(p, coords, cum = cumulativeKm(coords)) {
  let best = { km: 0, distKm: Infinity };
  const cosLat = Math.cos((p[1] * Math.PI) / 180);
  const kx = 111.32 * cosLat;
  const ky = 110.574;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
    const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    const d = Math.hypot(cx, cy);
    if (d < best.distKm) best = { km: cum[i - 1] + t * (cum[i] - cum[i - 1]), distKm: d };
  }
  return best;
}

// Pick which day's route the position belongs to.
// Closest route wins; if both are within 3 km of each other (e.g. at the overnight stop),
// the calendar date (YYYY-MM-DD, Argentina time) breaks the tie.
export function pickDay(p, days, localDate) {
  const scored = days.map((d) => ({ day: d, proj: projectOnRoute(p, d.route, d.cum) }));
  scored.sort((x, y) => x.proj.distKm - y.proj.distKm);
  if (scored.length > 1 && scored[1].proj.distKm - scored[0].proj.distKm < 3) {
    const byDate = scored.find((s) => s.day.date === localDate);
    if (byDate) return byDate;
  }
  return scored[0];
}

// Next stop strictly ahead of currentKm (with a small tolerance so we don't
// keep announcing a stop we are standing at).
export function nextStop(stops, currentKm, toleranceKm = 1.0) {
  return stops.find((s) => s.km > currentKm + toleranceKm) || null;
}

// Average speed over recent positions (each {km, ts} on the same day's route).
// Falls back to defaultKmh; clamped to a sane band for a loaded pickup on Argentine routes.
export function estimateSpeedKmh(history, defaultKmh = 85) {
  if (!history || history.length < 2) return defaultKmh;
  const last = history[history.length - 1];
  // Use the oldest sample within the last 40 min, at least 5 min old.
  const window = history.filter((h) => last.ts - h.ts <= 40 * 60e3 && last.ts - h.ts >= 5 * 60e3);
  if (!window.length) return defaultKmh;
  const first = window[0];
  const hours = (last.ts - first.ts) / 3.6e6;
  const v = (last.km - first.km) / hours;
  if (!isFinite(v) || v < 20) return defaultKmh; // stopped or noise: assume we'll resume normal pace
  return Math.min(110, Math.max(40, v));
}

export function etaMinutes(remainingKm, speedKmh) {
  return Math.round((remainingKm / speedKmh) * 60);
}

// Notify when the stop is within `leadMin` minutes, or when it would be passed
// before the next cron tick (cron every 15 min) plus some margin.
export function shouldNotify({ etaMin, alreadyNotified, leadMin = 35 }) {
  if (alreadyNotified) return false;
  return etaMin <= leadMin;
}

export function isStale(posTs, now, staleMin = 30) {
  return now - posTs > staleMin * 60e3;
}

export function wazeLink(lat, lon) {
  return `https://waze.com/ul?ll=${lat.toFixed(6)}%2C${lon.toFixed(6)}&navigate=yes`;
}

// Argentina has no DST; UTC-3 year-round.
export function argentinaDate(ts) {
  return new Date(ts - 3 * 3.6e6).toISOString().slice(0, 10);
}
export function argentinaHour(ts) {
  return new Date(ts - 3 * 3.6e6).getUTCHours();
}

export function formatClock(ts) {
  const d = new Date(ts - 3 * 3.6e6);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

// Full status computation used by both cron and /status.
export function computeStatus({ pos, history, days, now }) {
  if (!pos) return { hasPosition: false };
  const p = [pos.lon, pos.lat];
  const { day, proj } = pickDay(p, days, argentinaDate(pos.ts));
  const next = nextStop(day.stops, proj.km);
  const speed = estimateSpeedKmh((history || []).filter((h) => h.day === day.id));
  const remainingKm = next ? Math.max(0, next.km - proj.km) : 0;
  const eta = next ? etaMinutes(remainingKm + (next.detourKm || 0), speed) : 0;
  const dest = day.stops[day.stops.length - 1];
  const toEndKm = Math.max(0, dest.km - proj.km);
  return {
    hasPosition: true,
    dayId: day.id,
    dayLabel: day.label,
    km: Math.round(proj.km * 10) / 10,
    offRouteKm: Math.round(proj.distKm * 10) / 10,
    speedKmh: Math.round(speed),
    next: next ? { id: next.id, name: next.name, type: next.type, remainingKm: Math.round(remainingKm), etaMin: eta, etaClock: formatClock(now + eta * 60e3) } : null,
    toEndKm: Math.round(toEndKm),
    arrived: toEndKm < 2,
    position: { lat: pos.lat, lon: pos.lon, ageMin: Math.round((now - pos.ts) / 60e3) },
  };
}

// ───────────────────────── Plan vivo / Seguinos ─────────────────────────

// Local "HH:MM" on an Argentina date (UTC-3) → epoch ms.
export function localTs(dateStr, hhmm) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh + 3, mm);
}

// Sunset (epoch ms) for a lat/lon on a date, sunrise-equation approximation (±2 min).
export function sunsetTs(lat, lon, dateStr) {
  const rad = Math.PI / 180;
  const noonUtc = Date.parse(`${dateStr}T12:00:00Z`);
  const n = Math.round(noonUtc / 864e5 + 2440587.5 - 2451545.0 + 0.0008);
  const jStar = n - lon / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const jTransit = 2451545.0 + jStar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lambda * rad);
  const decl = Math.asin(Math.sin(lambda * rad) * Math.sin(23.44 * rad));
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
  const w0 = Math.acos(Math.max(-1, Math.min(1, cosW))) / rad;
  return Math.round((jTransit + w0 / 360 - 2440587.5) * 864e5);
}

// Arrival/departure detection at planned stops.
// near: {stopId, count, firstTs} carried between samples. An arrival needs 2 consecutive
// samples (≥90 s apart) within radiusKm, so driving past a roadside stop doesn't count.
export function detectVisit({ p, ts, stops, visits, near, radiusKm = 1.2, leaveKm = 2 }) {
  const events = [];
  const v = { ...visits };
  // Departures
  for (const [id, rec] of Object.entries(v)) {
    if (rec.leftAt) continue;
    const s = stops.find((x) => x.id === id);
    if (s && haversineKm(p, [s.lon, s.lat]) > leaveKm) { v[id] = { ...rec, leftAt: ts }; events.push({ type: 'left', stop: s, ts }); }
  }
  // Arrivals (skip the day's starting point)
  let best = null;
  for (const s of stops.slice(1)) {
    const d = haversineKm(p, [s.lon, s.lat]);
    if (d <= radiusKm && (!best || d < best.d)) best = { s, d };
  }
  let nextNear = null;
  if (best) {
    nextNear = near && near.stopId === best.s.id ? { ...near, count: near.count + 1 } : { stopId: best.s.id, count: 1, firstTs: ts };
    if (nextNear.count >= 2 && !v[best.s.id]) {
      v[best.s.id] = { arrivedAt: nextNear.firstTs };
      events.push({ type: 'arrived', stop: best.s, ts: nextNear.firstTs });
    }
  }
  return { visits: v, near: nextNear, events };
}

// Live plan for one day: state + ETA per stop, end-of-day ETA, delay vs plan, sunset risk.
// Travel time per leg uses the routed leg speed, nudged by observed speed (±20 %).
export function livePlan({ day, currentKm, observedKmh, visits = {}, now, live }) {
  const plannedEnd = localTs(day.date, day.plannedEnd);
  const sunset = sunsetTs(day.stops.at(-1).lat, day.stops.at(-1).lon, day.date);
  const legSpeed = (s) => (s.legKm && s.legMin ? s.legKm / s.legMin : 1.3); // km/min
  const stops = day.stops.map((s) => ({ id: s.id, planned: localTs(day.date, s.plannedArrival), state: 'pending', eta: null }));

  if (!live) {
    stops.forEach((x) => { x.eta = x.planned; });
    return { dayId: day.id, stops, endEta: plannedEnd, plannedEnd, delayMin: 0, sunset, afterDark: plannedEnd > sunset, live: false };
  }

  let t = now, fromKm = currentKm, nextMarked = false;
  const departure = localTs(day.date, day.departure);
  if (currentKm < 1 && !Object.keys(visits).length) t = Math.max(now, departure); // not left yet

  day.stops.forEach((s, i) => {
    const x = stops[i], rec = visits[s.id];
    if (i === 0) { x.state = currentKm > 1 || Object.keys(visits).length ? 'visited' : 'here'; x.eta = x.state === 'here' ? t : x.planned; return; }
    if (rec?.leftAt) { x.state = 'visited'; x.arrivedAt = rec.arrivedAt; x.leftAt = rec.leftAt; x.eta = rec.arrivedAt; return; }
    if (rec?.arrivedAt) {
      x.state = 'here'; x.arrivedAt = rec.arrivedAt; x.eta = rec.arrivedAt;
      t = Math.max(now, rec.arrivedAt + (s.dwellMin || 0) * 60e3); fromKm = s.km; return;
    }
    if (s.km < currentKm - 2) { x.state = 'skipped'; x.eta = null; return; }
    const factor = observedKmh ? Math.min(1.2, Math.max(0.8, observedKmh / (legSpeed(s) * 60))) : 1;
    const travelMin = (Math.max(0, s.km - fromKm) + (s.detourKm || 0)) / (legSpeed(s) * factor);
    x.eta = Math.round(t + travelMin * 60e3);
    if (!nextMarked) { x.state = 'next'; nextMarked = true; }
    t = x.eta + (i < day.stops.length - 1 ? (s.dwellMin || 0) * 60e3 : 0);
    fromKm = s.km;
  });
  const end = stops.at(-1);
  const endEta = end.state === 'visited' || end.state === 'here' ? end.arrivedAt : end.eta;
  return {
    dayId: day.id, stops, endEta, plannedEnd, sunset, live: true,
    delayMin: Math.round((endEta - plannedEnd) / 60e3),
    afterDark: endEta > sunset && end.state !== 'here' && end.state !== 'visited',
  };
}

// Suggest which remaining stops to shorten to arrive before sunset.
export function darkSuggestion(day, plan, minDwell = 20) {
  const overMin = Math.ceil((plan.endEta - plan.sunset) / 60e3);
  if (overMin <= 0) return null;
  const cands = day.stops.slice(1, -1)
    .filter((s, i) => ['pending', 'next', 'here'].includes(plan.stops[i + 1].state) && (s.dwellMin || 0) > minDwell)
    .sort((a, b) => b.dwellMin - a.dwellMin);
  let saved = 0; const cuts = [];
  for (const s of cands) { if (saved >= overMin) break; const c = s.dwellMin - minDwell; saved += c; cuts.push({ stop: s, toMin: minDwell, savesMin: c }); }
  return { overMin, cuts, enough: saved >= overMin };
}

// Fuel: trip odometer = previous days' km + current km. Last fill defaults to the start (full tank).
export function fuelState({ days, dayId, currentKm, lastFillOdo = 0, ruleKm = 450, hardKm = 550 }) {
  const dayOffset = (() => { let o = 0; for (const d of days) { if (d.id === dayId) return o; o += d.totalKm; } return o; })();
  const odo = dayOffset + currentKm;
  let o2 = 0; const allFuel = [];
  for (const d of days) { for (const s of d.stops) if (s.fuel) allFuel.push({ stop: s, odo: o2 + s.km + (s.detourKm || 0) }); o2 += d.totalKm; }
  const ahead = allFuel.filter((f) => f.odo > odo + 0.5);
  const next = ahead[0] || null;
  const since = Math.max(0, odo - lastFillOdo);
  const atNext = next ? since + (next.odo - odo) : null;
  const afterNext = ahead[1] ? since + (ahead[1].odo - odo) : null;
  let risk = 'ok';
  if (atNext != null && atNext > hardKm) risk = 'high';
  else if (atNext != null && atNext > ruleKm) risk = 'warn';
  return { odo: Math.round(odo), sinceKm: Math.round(since), next: next ? { id: next.stop.id, name: next.stop.name, inKm: Math.round(next.odo - odo), atKm: Math.round(atNext) } : null, mustFillAtNext: afterNext != null && afterNext > ruleKm, risk };
}
