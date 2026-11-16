// Ruta Fito Worker: Telegram webhook (live location in), cron every 15 min (alerts out), /status (webapp).
import trip from './trip.built.js';
import {
  cumulativeKm, computeStatus, shouldNotify, isStale, wazeLink, argentinaDate, argentinaHour, projectOnRoute, pickDay,
} from './logic.js';

const days = trip.days.map((d) => ({ ...d, cum: cumulativeKm(d.route) }));
const allStops = days.flatMap((d) => d.stops.map((s) => ({ ...s, dayId: d.id })));
const TYPE_ICON = { salida: '🚩', descanso: '🌳', nafta: '⛽', noche: '🛏️', destino: '🏁' };
const POS_WRITE_EVERY_MS = 90e3; // keep KV writes well under the free daily quota
const HISTORY_MAX = 12;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors } });

async function getJSON(env, key, fallback = null) {
  const v = await env.STATE.get(key, 'json');
  return v ?? fallback;
}
const putJSON = (env, key, value) => env.STATE.put(key, JSON.stringify(value));

async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) console.error('telegram', method, r.status, await r.text());
  return r;
}
async function send(env, chatId, text, extra = {}) {
  return tg(env, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function stopButtons(env, stop) {
  const row = [{ text: '🧭 Abrir en Waze', url: wazeLink(stop.lat, stop.lon) }];
  if (env.PAGES_URL) row.push({ text: '🗺️ Ver ruta', url: `${env.PAGES_URL}#${stop.id}` });
  return { reply_markup: { inline_keyboard: [row] } };
}

function stopAlertText(stop, status) {
  const icon = TYPE_ICON[stop.type] || '📍';
  const lines = [
    `${icon} <b>Próxima parada en ~${status.next.etaMin} min</b> (${status.next.remainingKm} km, llegada ~${status.next.etaClock})`,
    `<b>${esc(stop.name)}</b>`,
    esc(stop.description),
    `🐕 ${esc(stop.fito)}`,
  ];
  if (stop.detourKm) lines.push(`↪️ Desvío: ${stop.detourKm} km de la ruta`);
  return lines.join('\n');
}

function dayPlanText(day) {
  const lines = [`🗓️ <b>${esc(day.label)}</b> · ${day.totalKm} km · ~${Math.round(day.driveMin / 60 * 10) / 10} h de manejo`];
  for (const s of day.stops) lines.push(`${TYPE_ICON[s.type] || '📍'} ${s.plannedArrival} · ${esc(s.name)}${s.km ? ` (km ${Math.round(s.km)})` : ''}`);
  lines.push('\nTe aviso unos 20–35 min antes de cada parada. Mantené la ubicación en tiempo real activa.');
  return lines.join('\n');
}

function statusText(st) {
  if (!st.hasPosition) return 'Todavía no recibí tu ubicación. Compartila en tiempo real con este chat (📎 → Ubicación → Compartir en tiempo real).';
  const lines = [`📍 <b>${esc(st.dayLabel)}</b> · km ${Math.round(st.km)} · ${st.speedKmh} km/h prom.`];
  if (st.next) lines.push(`Siguiente: <b>${esc(st.next.name)}</b> en ${st.next.remainingKm} km (~${st.next.etaMin} min, ${st.next.etaClock})`);
  lines.push(`Faltan ${st.toEndKm} km para el final del día.`);
  if (st.position.ageMin > 5) lines.push(`⚠️ Última ubicación hace ${st.position.ageMin} min.`);
  if (st.offRouteKm > 5) lines.push(`↪️ Estás a ${st.offRouteKm} km de la ruta planificada.`);
  return lines.join('\n');
}

async function handleUpdate(env, update) {
  const msg = update.message || update.edited_message;
  if (!msg || !msg.chat) return;
  const chatId = msg.chat.id;
  let owner = await getJSON(env, 'owner');

  if (msg.text && msg.text.startsWith('/start')) {
    if (!owner) { owner = chatId; await putJSON(env, 'owner', owner); }
    if (owner !== chatId) return send(env, chatId, 'Este bot ya está asignado a otro viajero.');
    return send(env, chatId, [
      '🐕 <b>Ruta Fito</b> listo.',
      '1) Tocá 📎 → Ubicación → <b>Compartir ubicación en tiempo real</b> → "hasta que la desactive".',
      '2) Te aviso antes de cada parada, cuándo cargar nafta y si dejo de recibir tu ubicación.',
      'Comandos: /estado · /plan · /ruta',
    ].join('\n'), env.PAGES_URL ? { reply_markup: { inline_keyboard: [[{ text: '🗺️ Abrir la ruta', url: env.PAGES_URL }]] } } : {});
  }
  if (owner !== chatId) return; // ignore strangers

  if (msg.location) {
    const now = Date.now();
    const ts = (msg.edit_date || msg.date) * 1000;
    const last = await getJSON(env, 'pos');
    if (!last || ts - last.ts >= POS_WRITE_EVERY_MS) {
      const pos = { lat: msg.location.latitude, lon: msg.location.longitude, ts };
      const { day, proj } = pickDay([pos.lon, pos.lat], days, argentinaDate(ts));
      const history = (await getJSON(env, 'history', [])).concat({ km: proj.km, ts, day: day.id }).slice(-HISTORY_MAX);
      await Promise.all([putJSON(env, 'pos', pos), putJSON(env, 'history', history)]);
      // First fix of the day → send the day's plan.
      const flags = await getJSON(env, 'flags', {});
      if (!flags[`plan-${day.id}`]) {
        flags[`plan-${day.id}`] = now; flags.staleAlert = null;
        await putJSON(env, 'flags', flags);
        await send(env, chatId, dayPlanText(day));
      } else if (flags.staleAlert) {
        flags.staleAlert = null; await putJSON(env, 'flags', flags);
        await send(env, chatId, '✅ Vuelvo a recibir tu ubicación.');
      }
    }
    return;
  }

  const text = (msg.text || '').trim().toLowerCase();
  if (text.startsWith('/estado')) {
    const st = computeStatus({ pos: await getJSON(env, 'pos'), history: await getJSON(env, 'history', []), days, now: Date.now() });
    const extra = st.next ? stopButtons(env, allStops.find((s) => s.id === st.next.id)) : {};
    return send(env, chatId, statusText(st), extra);
  }
  if (text.startsWith('/plan')) {
    const today = argentinaDate(Date.now());
    const d = days.find((x) => x.date === today) || days[0];
    return send(env, chatId, days.map(dayPlanText).join('\n\n') + (d ? '' : ''));
  }
  if (text.startsWith('/ruta')) {
    return send(env, chatId, env.PAGES_URL ? `🗺️ ${env.PAGES_URL}` : 'La webapp todavía no tiene URL configurada.');
  }
  if (text.startsWith('/reset')) { // testing helper: forget alerts/position, keep owner
    await Promise.all(['pos', 'history', 'flags', 'notified'].map((k) => env.STATE.delete(k)));
    return send(env, chatId, '🔄 Estado reiniciado.');
  }
}

export async function runCron(env, now = Date.now()) {
  const owner = await getJSON(env, 'owner');
  if (!owner) return { skipped: 'no owner' };
  const pos = await getJSON(env, 'pos');
  const flags = await getJSON(env, 'flags', {});
  const today = argentinaDate(now);
  const tripDay = days.find((d) => d.date === today);
  const hour = argentinaHour(now);

  if (!pos) return { skipped: 'no position' };

  // Location stopped arriving during driving hours of a trip day.
  if (tripDay && hour >= 8 && hour < 23 && isStale(pos.ts, now) && !flags.staleAlert) {
    const st = computeStatus({ pos, history: [], days, now });
    if (!st.arrived) {
      flags.staleAlert = now; await putJSON(env, 'flags', flags);
      await send(env, owner, `⚠️ No recibo tu ubicación hace ${Math.round((now - pos.ts) / 60e3)} min. Si querés los avisos, volvé a compartir la ubicación en tiempo real con este chat.`);
    }
    return { stale: true };
  }
  if (isStale(pos.ts, now, 45)) return { skipped: 'old position' };

  const status = computeStatus({ pos, history: await getJSON(env, 'history', []), days, now });
  const notified = await getJSON(env, 'notified', {});
  const out = { status };

  if (status.arrived) {
    const key = `arrived-${status.dayId}`;
    if (!notified[key]) {
      notified[key] = now; await putJSON(env, 'notified', notified);
      const day = days.find((d) => d.id === status.dayId);
      const end = day.stops[day.stops.length - 1];
      await send(env, owner, end.type === 'destino' ? '🏁 <b>¡Llegaron a Arroyito!</b> Buen viaje, Fito 🐕' : `🛏️ <b>Llegaron a ${esc(end.name)}</b>. A descansar. Mañana sigue la ruta.`);
    }
    return out;
  }
  if (status.next && shouldNotify({ etaMin: status.next.etaMin, alreadyNotified: !!notified[status.next.id] })) {
    const stop = allStops.find((s) => s.id === status.next.id);
    notified[stop.id] = now; await putJSON(env, 'notified', notified);
    await send(env, owner, stopAlertText(stop, status), stopButtons(env, stop));
    out.notified = stop.id;
  }
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (url.pathname === '/tg' && request.method === 'POST') {
      if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
      const update = await request.json();
      try { await handleUpdate(env, update); } catch (e) { console.error('update failed', e.stack || e); }
      return new Response('ok');
    }
    if (url.pathname === '/status') {
      const st = computeStatus({ pos: await getJSON(env, 'pos'), history: await getJSON(env, 'history', []), days, now: Date.now() });
      return json(st);
    }
    if (url.pathname === '/health') return json({ ok: true, builtAt: trip.builtAt, days: days.map((d) => ({ id: d.id, km: d.totalKm, stops: d.stops.length })) });
    return new Response('Ruta Fito 🐕', { headers: cors });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env).then((r) => console.log('cron', JSON.stringify(r))));
  },
};
