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
