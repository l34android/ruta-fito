// Ruta Fito Worker
//  - Telegram webhook: live location in, commands, stop arrival/departure detection, family updates.
//  - Cron every 15 min: next-stop alerts, live-plan warnings (nightfall, fuel), stale-location alert.
//  - GET /status (driver app) and GET /public?k=token ("Seguinos" family view).
import trip from './trip.built.js';
import {
  cumulativeKm, computeStatus, shouldNotify, isStale, wazeLink, argentinaDate, argentinaHour, pickDay,
  haversineKm, detectVisit, livePlan, darkSuggestion, fuelState, formatClock,
} from './logic.js';

const days = trip.days.map((d) => ({ ...d, cum: cumulativeKm(d.route) }));
const allStops = days.flatMap((d) => d.stops.map((s) => ({ ...s, dayId: d.id })));
const HOME = days[0].stops[0];
// The trip has two legs (ida / vuelta) whose routes overlap (Villa Ventana, RN22, RN3).
// Only the current leg's days are candidates for position matching, fuel and arrival totals.
export function legOf(now) {
  const today = argentinaDate(now);
  return (days.filter((d) => d.date <= today).at(-1) || days[0]).leg || 'ida';
}
const legDays = (now) => { const leg = legOf(now); return days.filter((d) => (d.leg || 'ida') === leg); };
const fillOdo = (st, now) => (st.fuel?.leg || 'ida') === legOf(now) ? st.fuel.odo : 0;
const HOME_HIDE_KM = 5;
const TYPE_ICON = { salida: '🚩', descanso: '🌳', nafta: '⛽', noche: '🛏️', destino: '🏁' };
const POS_WRITE_EVERY_MS = 90e3; // one KV write per sample keeps us well under the free daily quota
const HISTORY_MAX = 12;

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors } });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const getJSON = async (env, key, fallback = null) => (await env.STATE.get(key, 'json')) ?? fallback;
const putJSON = (env, key, value) => env.STATE.put(key, JSON.stringify(value));

async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) console.error('telegram', method, r.status, await r.text());
  return r;
}
const send = (env, chatId, text, extra = {}) => tg(env, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

// Per-isolate memory: avoids storage calls for the frequent live-location edits and repeated polls.
export const mem = { owner: null, lastPosTs: 0, cache: new Map() };
const STATE_KEYS = ['owner', 'track', 'visits', 'fuel', 'flags', 'notified', 'share', 'family'];

export async function loadState(env) {
  let vals;
  if (env.STATE.getMany) { // Durable Object store: one call for every key
    const got = await env.STATE.getMany(STATE_KEYS);
    vals = STATE_KEYS.map((k) => (got[k] == null ? null : JSON.parse(got[k])));
  } else vals = await Promise.all(STATE_KEYS.map((k) => getJSON(env, k)));
  const [owner, track, visits, fuel, flags, notified, share, family] = vals;
  if (owner) mem.owner = owner;
  if (track?.pos?.ts) mem.lastPosTs = Math.max(mem.lastPosTs, track.pos.ts);
  return { owner, track: track || {}, visits: visits || {}, fuel: fuel || { odo: 0, stopId: 'start' }, flags: flags || {}, notified: notified || {}, share, family };
}

function shareUrl(env, share) {
  return share?.token && env.PAGES_URL ? `${env.PAGES_URL}seguir.html?k=${share.token}` : null;
}

// One view of the trip that every consumer (cron, bot, app, family page) reads.
export function buildView(st, now) {
  const ld = legDays(now);
  const status = computeStatus({ pos: st.track.pos, history: st.track.history, days: ld, now });
  const planned = (d) => livePlan({ day: d, live: false });
  if (!status.hasPosition) {
    return { status, plans: days.map(planned), fuel: fuelState({ days: ld, dayId: ld[0].id, currentKm: 0, lastFillOdo: fillOdo(st, now) }) };
  }
  const plans = days.map((d) => {
    if (d.id !== status.dayId) return planned(d);
    const live = argentinaDate(now) === d.date;
    return livePlan({ day: d, currentKm: status.km, observedKmh: status.speedKmh, visits: st.visits, now, live });
  });
  const plan = plans.find((p) => p.dayId === status.dayId);
  const nextPlan = plan.live ? plan.stops.find((x) => x.state === 'next') : null;
  if (nextPlan && status.next) {
    const s = allStops.find((x) => x.id === nextPlan.id);
    status.next = { ...status.next, id: s.id, name: s.name, type: s.type, remainingKm: Math.max(0, Math.round(s.km - status.km)), etaMin: Math.max(0, Math.round((nextPlan.eta - now) / 60e3)), etaClock: formatClock(nextPlan.eta) };
  }
  const fuel = fuelState({ days: ld, dayId: status.dayId, currentKm: status.km, lastFillOdo: fillOdo(st, now) });
  return { status, plans, plan, fuel };
}

// ───────── Telegram copy ─────────
function stopButtons(env, stop) {
  const row = [{ text: 'Abrir en Waze', url: wazeLink(stop.lat, stop.lon) }];
  if (env.PAGES_URL) row.push({ text: 'Ver ruta', url: `${env.PAGES_URL}#${stop.id}` });
  return { reply_markup: { inline_keyboard: [row] } };
}

function stopAlertText(stop, next, fuel) {
  const lines = [
    `${TYPE_ICON[stop.type] || '📍'} <b>Próxima parada en ~${next.etaMin} min</b> (${next.remainingKm} km, llegada ~${next.etaClock})`,
    `<b>${esc(stop.name)}</b>`,
    esc(stop.description),
    `Para Fito: ${esc(stop.fito)}`,
  ];
  if (stop.detourKm) lines.push(`Desvío: ${stop.detourKm} km de la ruta`);
  if (stop.fuel && fuel?.next?.id === stop.id && fuel.mustFillAtNext) lines.push(`<b>Cargá nafta acá sí o sí:</b> la siguiente carga queda lejos para tu autonomía.`);
  return lines.join('\n');
}

function dayPlanText(day) {
  const lines = [`<b>${esc(day.label)}</b> · ${day.totalKm} km · ~${Math.round((day.driveMin / 60) * 10) / 10} h de manejo`];
  for (const s of day.stops) lines.push(`${TYPE_ICON[s.type] || '📍'} ${s.plannedArrival} · ${esc(s.name)}${s.km ? ` (km ${Math.round(s.km)})` : ''}`);
  lines.push('\nTe aviso unos 20–35 min antes de cada parada y si el plan se complica (noche o nafta). Mantené la ubicación en tiempo real activa.');
  return lines.join('\n');
}

function statusText(view) {
  const { status: st, plan, fuel } = view;
  if (!st.hasPosition) return 'Todavía no recibí tu ubicación. Compartila en tiempo real con este chat (adjuntar → Ubicación → Compartir en tiempo real).';
  const lines = [`📍 <b>${esc(st.dayLabel)}</b> · km ${Math.round(st.km)} · ${st.speedKmh} km/h prom.`];
  if (st.next) lines.push(`Siguiente: <b>${esc(st.next.name)}</b> en ${st.next.remainingKm} km (~${st.next.etaMin} min, ${st.next.etaClock})`);
  if (plan?.live) {
    const d = plan.delayMin;
    lines.push(`Llegada al final del día: <b>${formatClock(plan.endEta)}</b> (${d > 5 ? `+${d} min sobre el plan` : d < -5 ? `${-d} min antes del plan` : 'en horario'}) · oscurece ${formatClock(plan.sunset)}`);
  }
  if (fuel?.next) lines.push(`Nafta: ${fuel.sinceKm} km desde la última carga · próxima en ${esc(fuel.next.name)} (${fuel.next.inKm} km)`);
  if (st.position.ageMin > 5) lines.push(`⚠️ Última ubicación hace ${st.position.ageMin} min.`);
  if (st.offRouteKm > 5) lines.push(`Estás a ${st.offRouteKm} km de la ruta planificada.`);
  return lines.join('\n');
}

const famText = {
  departed: (day, plan) => `Lean y Fito salieron de ${esc(day.stops[0].name)} a las ${formatClock(Date.now())}. Llegada estimada a ${esc(day.stops.at(-1).name)}: ${formatClock(plan.endEta)}.`,
  arrived: (s, ts) => s.type === 'destino'
    ? `¡Llegaron a ${esc(s.name.replace(/ \(destino\)$/, ''))}! Fueron ${Math.round(legDays(Date.now()).reduce((a, d) => a + d.totalKm, 0))} km. Gracias por acompañarlos.`
    : s.type === 'noche'
      ? `Llegaron a ${esc(s.name)} a las ${formatClock(ts)}. Hoy hacen noche acá; mañana sigue la ruta.`
      : `Pararon en ${esc(s.name)} (${formatClock(ts)}). ${s.type === 'descanso' ? 'Fito está estirando las patas.' : 'Cargando nafta.'}`,
};

async function familySend(env, st, text) {
  if (!st.family?.chatId) return;
  const url = shareUrl(env, st.share);
  await send(env, st.family.chatId, text, url ? { reply_markup: { inline_keyboard: [[{ text: 'Ver dónde van', url }]] } } : {});
}

// ───────── Webhook ─────────
async function onLocation(env, st, msg) {
  const now = Date.now();
  const ts = (msg.edit_date || msg.date) * 1000;
  if (st.track.pos && ts - st.track.pos.ts < POS_WRITE_EVERY_MS) return;

  const pos = { lat: msg.location.latitude, lon: msg.location.longitude, ts };
  const p = [pos.lon, pos.lat];
  const { day, proj } = pickDay(p, legDays(ts), argentinaDate(ts));
  const history = (st.track.history || []).concat({ km: proj.km, ts, day: day.id }).slice(-HISTORY_MAX);
  const writes = [];
  let flagsChanged = false;
  const tripDay = argentinaDate(ts) === day.date;

  let near = st.track.near || null;
  if (tripDay) {
    const r = detectVisit({ p, ts, stops: day.stops, visits: st.visits, near });
    near = r.near;
    if (r.events.length) {
      st.visits = r.visits;
      writes.push(putJSON(env, 'visits', st.visits));
      for (const ev of r.events) {
        if (ev.type !== 'arrived') continue;
        if (ev.stop.fuel) {
          let offset = 0; for (const d of legDays(ts)) { if (d.id === day.id) break; offset += d.totalKm; }
          st.fuel = { odo: Math.round(offset + ev.stop.km), at: ev.ts, stopId: ev.stop.id, leg: day.leg || 'ida' };
          writes.push(putJSON(env, 'fuel', st.fuel));
        }
        await familySend(env, st, famText.arrived(ev.stop, ev.ts));
      }
    }
    if (proj.km > 3 && !st.flags[`dep-${day.id}`]) {
      st.flags[`dep-${day.id}`] = now; flagsChanged = true;
      st.track = { pos, history, near };
      const view = buildView(st, now);
      await familySend(env, st, famText.departed(day, view.plan));
    }
  }
  st.track = { pos, history, near };
  mem.lastPosTs = ts;
  writes.push(putJSON(env, 'track', st.track));

  if (!st.flags[`plan-${day.id}`]) {
    st.flags[`plan-${day.id}`] = now; st.flags.staleAlert = null; flagsChanged = true;
    await send(env, st.owner, dayPlanText(day));
  } else if (st.flags.staleAlert) {
    st.flags.staleAlert = null; flagsChanged = true;
    await send(env, st.owner, '✅ Vuelvo a recibir tu ubicación.');
  }
  if (flagsChanged) writes.push(putJSON(env, 'flags', st.flags));
  await Promise.all(writes);
}

async function handleUpdate(env, update) {
  const msg = update.message || update.edited_message;
  if (!msg?.chat) return;
  const chatId = msg.chat.id;
  const fromId = msg.from?.id;
  const isPrivate = msg.chat.type === 'private';
  const cmd = (msg.text || '').trim().split(/\s+/)[0].split('@')[0].toLowerCase();
  const arg = (msg.text || '').trim().split(/\s+/)[1]?.toLowerCase();
  // Fast path: live-location edits arrive every few seconds; we only keep one every 90 s.
  if (msg.location && isPrivate && mem.owner === chatId && (msg.edit_date || msg.date) * 1000 - mem.lastPosTs < POS_WRITE_EVERY_MS) return;
  const st = await loadState(env);

  if (isPrivate && cmd === '/start') {
    if (!st.owner) { st.owner = chatId; await putJSON(env, 'owner', chatId); }
    if (st.owner !== chatId) return send(env, chatId, 'Este bot ya acompaña a otro viajero.');
    return send(env, chatId, [
      '<b>Ruta Fito</b> listo.',
      '1) Adjuntar → Ubicación → <b>Compartir ubicación en tiempo real</b> → "hasta que la desactive".',
      '2) Te aviso antes de cada parada y si el plan se complica (llegar de noche o quedarte corto de nafta).',
      'Comandos: /estado · /plan · /compartir · /cargue · /ruta',
    ].join('\n'), env.PAGES_URL ? { reply_markup: { inline_keyboard: [[{ text: 'Abrir la ruta', url: env.PAGES_URL }]] } } : {});
  }

  // Family group: the owner links it once.
  if (!isPrivate && cmd === '/familia') {
    if (fromId !== st.owner) return;
    if (!st.share?.token) { st.share = { token: crypto.randomUUID().replace(/-/g, '') }; await putJSON(env, 'share', st.share); }
    st.family = { chatId, title: msg.chat.title || '' };
    await putJSON(env, 'family', st.family);
    return send(env, chatId, 'Hola familia. Voy a avisar acá cuando Lean y Fito salgan, cada vez que paren y cuando lleguen. En el link ven el mapa en vivo.', { reply_markup: { inline_keyboard: [[{ text: 'Ver dónde van', url: shareUrl(env, st.share) }]] } });
  }

  if (!isPrivate || st.owner !== chatId) return; // everything else: owner only, private chat

  if (msg.location) return onLocation(env, st, msg);

  const now = Date.now();
  if (cmd === '/estado') {
    const view = buildView(st, now);
    const extra = view.status.next ? stopButtons(env, allStops.find((s) => s.id === view.status.next.id)) : {};
    return send(env, chatId, statusText(view), extra);
  }
  if (cmd === '/plan') return send(env, chatId, legDays(Date.now()).map(dayPlanText).join('\n\n'));
  if (cmd === '/ruta') return send(env, chatId, env.PAGES_URL ? env.PAGES_URL : 'La webapp todavía no tiene URL configurada.');
  if (cmd === '/compartir') {
    if (!st.share?.token || arg === 'nuevo') { st.share = { token: crypto.randomUUID().replace(/-/g, '') }; await putJSON(env, 'share', st.share); }
    return send(env, chatId, [
      arg === 'nuevo' ? 'Listo, generé un link nuevo: el anterior ya no funciona.' : 'Este es el link para tu familia y amigos:',
      shareUrl(env, st.share),
      '',
      'Para que reciban avisos automáticos: agregá este bot a un grupo de Telegram de la familia y escribí /familia en el grupo.',
      'Mientras estés a menos de 5 km de casa, tu posición no se muestra.',
      'Para anular el link: /compartir nuevo',
    ].join('\n'));
  }
  if (cmd === '/cargue') {
    const view = buildView(st, now);
    st.fuel = { odo: view.fuel.odo, at: now, stopId: 'manual' };
    await putJSON(env, 'fuel', st.fuel);
    return send(env, chatId, `Anotado: tanque lleno en el km ${view.fuel.odo} del viaje.`);
  }
  if (cmd === '/reset') { // keep owner, share link and family group
    await Promise.all(['track', 'visits', 'fuel', 'flags', 'notified'].map((k) => env.STATE.delete(k)));
    return send(env, chatId, 'Estado reiniciado. El link para la familia y el grupo siguen igual.');
  }
}

// ───────── Cron ─────────
export async function runCron(env, now = Date.now()) {
  const st = await loadState(env);
  if (!st.owner) return { skipped: 'no owner' };
  const pos = st.track.pos;
  if (!pos) return { skipped: 'no position' };
  const today = argentinaDate(now);
  const tripDay = days.find((d) => d.date === today);
  const hour = argentinaHour(now);
  const view = buildView(st, now);

  if (tripDay && hour >= 8 && hour < 23 && isStale(pos.ts, now) && !st.flags.staleAlert) {
    if (!view.status.arrived) {
      st.flags.staleAlert = now; await putJSON(env, 'flags', st.flags);
      await send(env, st.owner, `⚠️ No recibo tu ubicación hace ${Math.round((now - pos.ts) / 60e3)} min. Si querés los avisos, volvé a compartir la ubicación en tiempo real con este chat.`);
    }
    return { stale: true };
  }
  if (isStale(pos.ts, now, 45)) return { skipped: 'old position' };

  const { status, plan, fuel } = view;
  const out = { status: { dayId: status.dayId, km: status.km, next: status.next?.id }, delayMin: plan?.delayMin, fuel: fuel?.risk };
  const flagsBefore = JSON.stringify(st.flags);

  if (status.arrived) {
    const key = `arrived-${status.dayId}`;
    if (!st.notified[key]) {
      st.notified[key] = now; await putJSON(env, 'notified', st.notified);
      const day = days.find((d) => d.id === status.dayId);
      const end = day.stops.at(-1);
      await send(env, st.owner, end.type === 'destino' ? `🏁 <b>¡Llegaron a ${esc(end.name)}!</b> Buen viaje, Fito.` : `🛏️ <b>Llegaron a ${esc(end.name)}</b>. A descansar. Mañana sigue la ruta.`);
    }
    return out;
  }

  // Plan vivo: nightfall risk (once per day, again only if it gets 20+ min worse).
  if (plan?.live && plan.afterDark) {
    const day = days.find((d) => d.id === plan.dayId);
    const sug = darkSuggestion(day, plan);
    const key = `dark-${plan.dayId}`;
    if (sug && (!st.flags[key] || sug.overMin - st.flags[key] >= 20)) {
      st.flags[key] = sug.overMin;
      const lines = [`🌙 <b>A este ritmo llegás a ${esc(day.stops.at(-1).name)} ${formatClock(plan.endEta)}</b> y oscurece ${formatClock(plan.sunset)}.`];
      if (sug.cuts.length) {
        lines.push(`Si ${sug.cuts.map((c) => `acortás ${esc(c.stop.name)} a ${c.toMin} min`).join(' y ')}, ganás ${sug.cuts.reduce((a, c) => a + c.savesMin, 0)} min${sug.enough ? ' y llegás con luz' : ''}.`);
      }
      lines.push('De noche, más despacio: fauna suelta y camiones en la ruta.');
      await send(env, st.owner, lines.join('\n'));
      out.dark = true;
    }
  }

  // Plan vivo: fuel.
  if (fuel?.next && fuel.risk !== 'ok') {
    const key = `fuel-${fuel.next.id}-${fuel.risk}`;
    if (!st.flags[key]) {
      st.flags[key] = now;
      await send(env, st.owner, fuel.risk === 'high'
        ? `⛽ <b>Ojo con la nafta:</b> llevás ${fuel.sinceKm} km desde la última carga y la próxima estación del plan (${esc(fuel.next.name)}) está a ${fuel.next.inKm} km. Cargá en la primera que veas. Si ya cargaste, mandame /cargue.`
        : `⛽ Llevás ${fuel.sinceKm} km desde la última carga. Llegás a ${esc(fuel.next.name)} con ~${fuel.next.atKm} km: cargá ahí sin falta. Si cargaste en otro lado, mandame /cargue.`);
      out.fuelAlert = fuel.risk;
    }
  }
  if (JSON.stringify(st.flags) !== flagsBefore) await putJSON(env, 'flags', st.flags);

  if (status.next && shouldNotify({ etaMin: status.next.etaMin, alreadyNotified: !!st.notified[status.next.id] })) {
    const stop = allStops.find((s) => s.id === status.next.id);
    st.notified[stop.id] = now; await putJSON(env, 'notified', st.notified);
    await send(env, st.owner, stopAlertText(stop, status.next, fuel), stopButtons(env, stop));
    out.notified = stop.id;
  }
  return out;
}

// Short per-isolate cache for polled endpoints (many viewers polling every 30–60 s).
const CACHE_MS = 15e3;
async function cachedRaw(key, fn) {
  const hit = mem.cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await fn();
  mem.cache.set(key, { at: Date.now(), value });
  return value;
}
const cached = async (key, fn) => json(await cachedRaw(key, fn));

// Copy the owner's private updates to the preview Worker. Fire-and-forget: it never
// affects the production response, and any failure is swallowed.
export async function forwardToPreview(env, update) {
  try {
    const msg = update.message || update.edited_message;
    if (!msg?.chat || msg.chat.type !== 'private') return false;
    const owner = mem.owner || await getJSON(env, 'owner');
    if (!owner || msg.chat.id !== owner) return false;
    await fetch(`${env.PREVIEW_URL}/tg`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ruta-Forward': env.FORWARD_SECRET, 'X-Ruta-Owner': String(owner) },
      body: JSON.stringify(update),
      signal: AbortSignal.timeout(5000),
    });
    return true;
  } catch (e) { console.error('preview forward failed', e?.message || e); return false; }
}

// Family-safe projection of the view.
export function publicView(st, view, now) {
  const pos = st.track.pos;
  const nearHome = pos && haversineKm([pos.lon, pos.lat], [HOME.lon, HOME.lat]) < HOME_HIDE_KM;
  const s = view.status;
  return {
    title: trip.title,
    hasPosition: !!(s.hasPosition && !nearHome),
    hiddenNearHome: !!nearHome,
    position: s.hasPosition && !nearHome ? s.position : null,
    dayId: s.dayId || null,
    km: s.km ?? null,
    next: s.next ? { id: s.next.id, name: s.next.name, etaClock: s.next.etaClock, etaMin: s.next.etaMin } : null,
    arrived: !!s.arrived,
    plans: view.plans.map((p) => ({ dayId: p.dayId, live: p.live, endEta: p.endEta, delayMin: p.delayMin, sunset: p.sunset, stops: p.stops })),
    now,
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (url.pathname === '/tg' && request.method === 'POST') {
      if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
      const update = await request.json();
      try { await handleUpdate(env, update); } catch (e) { console.error('update failed', e.stack || e); }
      if (env.PREVIEW_URL && env.FORWARD_SECRET && ctx?.waitUntil) ctx.waitUntil(forwardToPreview(env, update));
      return new Response('ok');
    }
    if (url.pathname === '/status') {
      return cached('status', async () => {
        const st = await loadState(env);
        const view = buildView(st, Date.now());
        return { ...view.status, plans: view.plans, fuel: view.fuel };
      });
    }
    if (url.pathname === '/public') {
      const k = url.searchParams.get('k');
      const r = await cachedRaw('public', async () => { const st = await loadState(env); return { st, body: publicView(st, buildView(st, Date.now()), Date.now()) }; });
      if (!k || !r.st.share?.token || k !== r.st.share.token) return json({ error: 'Link no válido o vencido' }, 404);
      return json(r.body);
    }
    if (url.pathname === '/admin/import' && request.method === 'POST') { // one-time migration of KV data into the store
      if (!env.FORWARD_SECRET || request.headers.get('X-Ruta-Admin') !== env.FORWARD_SECRET) return new Response('forbidden', { status: 403 });
      const body = await request.json();
      const keys = Object.keys(body).filter((k) => STATE_KEYS.includes(k) && typeof body[k] === 'string');
      const existing = env.STATE.getMany ? await env.STATE.getMany(keys) : {};
      const done = [];
      for (const k of keys) if (existing[k] == null) { await env.STATE.put(k, body[k]); done.push(k); } // never overwrite newer state
      mem.cache.clear(); mem.owner = null;
      return json({ imported: done });
    }
    if (url.pathname === '/health') return json({ ok: true, builtAt: trip.builtAt, days: days.map((d) => ({ id: d.id, km: d.totalKm, stops: d.stops.length })) });
    return new Response('Ruta Fito', { headers: cors });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env).then((r) => console.log('cron', JSON.stringify(r))));
  },
};
