// Ruta Fito — preview Worker core ("modo 8 bits" + sala de la familia).
// Receives a copy of the owner's Telegram updates from production (never the webhook itself),
// keeps its own state, serves the 8-bit webapp as static assets, and hosts the family room.
// SILENT: never sends trip alerts; only room messages (silently) and the /prueba link.
import trip from './trip.built.js';
import { pickDay, argentinaDate, detectVisit, formatClock } from './logic.js';
import { loadState, buildView, publicView } from './index.js';
import { validateFamilyMessage, telegramPostFromOwner } from './chat.js';

const days = trip.days;
const POS_WRITE_EVERY_MS = 90e3;
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
const getJSON = async (env, key, fb = null) => (await env.STATE.get(key, 'json')) ?? fb;
const putJSON = (env, key, v) => env.STATE.put(key, JSON.stringify(v));

async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) console.error('telegram', method, r.status, await r.text());
  return r.ok ? r.json() : null;
}

export const roomOf = (env) => env.ROOM.get(env.ROOM.idFromName('familia'));

// ───────── Updates forwarded from production ─────────
async function onLocation(env, st, msg, room) {
  const ts = (msg.edit_date || msg.date) * 1000;
  if (st.track.pos && ts - st.track.pos.ts < POS_WRITE_EVERY_MS) return;
  const pos = { lat: msg.location.latitude, lon: msg.location.longitude, ts };
  const p = [pos.lon, pos.lat];
  const { day, proj } = pickDay(p, days, argentinaDate(ts));
  const history = (st.track.history || []).concat({ km: proj.km, ts, day: day.id }).slice(-12);
  let near = st.track.near || null;
  const writes = [];
  if (argentinaDate(ts) === day.date) {
    const r = detectVisit({ p, ts, stops: day.stops, visits: st.visits, near });
    near = r.near;
    if (r.events.length) {
      writes.push(putJSON(env, 'visits', r.visits));
      for (const ev of r.events) {
        if (ev.type !== 'arrived') continue;
        const s = ev.stop;
        const text = s.type === 'destino' ? `¡LLEGARON A ${s.name.replace(/ \(destino\)$/, '').toUpperCase()}!`
          : s.type === 'noche' ? `Llegaron a ${s.name} (${formatClock(ev.ts)}). A descansar.`
          : `¡PARADA! ${s.name} (${formatClock(ev.ts)})`;
        await room.add({ ts: ev.ts, author: 'Ruta', kind: 'event', text });
      }
    }
    if (proj.km > 3 && !st.flags[`dep-${day.id}`]) {
      st.flags[`dep-${day.id}`] = ts;
      writes.push(putJSON(env, 'flags', st.flags));
      await room.add({ ts, author: 'Ruta', kind: 'event', text: `${day.label.toUpperCase()}: ¡salieron de ${day.stops[0].name}!` });
    }
  }
  writes.push(putJSON(env, 'track', { pos, history, near }));
  await Promise.all(writes);
}

export async function handleForwarded(env, update, ownerId) {
  const msg = update.message || update.edited_message;
  if (!msg?.chat || msg.chat.type !== 'private' || msg.chat.id !== ownerId) return { ignored: true };
  if ((await getJSON(env, 'owner')) !== ownerId) await putJSON(env, 'owner', ownerId);
  const st = await loadState(env);
  const room = roomOf(env);
  if (msg.location) { await onLocation(env, st, msg, room); return { location: true }; }

  const text = (msg.text || '').trim();
  const cmd = text.split(/\s+/)[0].split('@')[0].toLowerCase();
  if (cmd === '/prueba') {
    let share = await getJSON(env, 'share');
    if (!share?.token || text.split(/\s+/)[1] === 'nuevo') { share = { token: crypto.randomUUID().replace(/-/g, '') }; await putJSON(env, 'share', share); }
    const url = `${env.PUBLIC_URL}/?k=${share.token}`;
    const nueva = `${env.PUBLIC_URL}/nueva/?k=${share.token}`;
    await tg(env, 'sendMessage', { chat_id: ownerId, text: `Links de prueba (comparten la misma sala):\n\nVista nueva: ${nueva}\nModo arcade: ${url}\n\nMandame texto o fotos y aparecen en la sala. Respondé /borrar a un mensaje para sacarlo.`, disable_web_page_preview: true });
    return { prueba: true };
  }
  if (cmd === '/borrar' && msg.reply_to_message) {
    const id = await getJSON(env, `map:${msg.reply_to_message.message_id}`);
    if (id) { await room.remove(id); await tg(env, 'setMessageReaction', { chat_id: ownerId, message_id: msg.message_id, reaction: [{ type: 'emoji', emoji: '👌' }] }); }
    return { deleted: id || null };
  }
  const post = telegramPostFromOwner(msg);
  if (!post) return { ignored: true };
  const row = await room.add({ ts: msg.date * 1000, author: 'Lean', kind: 'lean', text: post.text, photo: post.photo });
  await putJSON(env, `map:${msg.message_id}`, row.id);
  await tg(env, 'setMessageReaction', { chat_id: ownerId, message_id: msg.message_id, reaction: [{ type: 'emoji', emoji: '👍' }] });
  return { posted: row.id };
}

// ───────── Public API (token-gated) ─────────
async function authed(env, url) {
  const share = await getJSON(env, 'share');
  return !!(share?.token && url.searchParams.get('k') === share.token);
}

async function photoProxy(env, fileId, ctx) {
  const cache = caches.default;
  const key = new Request(`https://photo.cache/${fileId}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  const info = await (await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`)).json();
  if (!info.ok) return new Response('not found', { status: 404 });
  const img = await fetch(`https://api.telegram.org/file/bot${env.TG_TOKEN}/${info.result.file_path}`);
  const res = new Response(img.body, { headers: { 'Content-Type': img.headers.get('Content-Type') || 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

export async function handleRequest(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/tg' && request.method === 'POST') {
      if (!env.FORWARD_SECRET || request.headers.get('X-Ruta-Forward') !== env.FORWARD_SECRET) return new Response('forbidden', { status: 403 });
      const owner = Number(request.headers.get('X-Ruta-Owner'));
      try { await handleForwarded(env, await request.json(), owner); } catch (e) { console.error('forwarded failed', e.stack || e); }
      return new Response('ok');
    }
    if (!url.pathname.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Ruta Fito 8-bit');
    if (!(await authed(env, url))) return json({ error: 'Link no válido o vencido' }, 404);
    const room = roomOf(env);

    if (url.pathname === '/api/public') {
      const st = await loadState(env);
      return json(publicView(st, buildView(st, Date.now()), Date.now()));
    }
    if (url.pathname === '/api/chat' && request.method === 'GET') {
      const after = Number(url.searchParams.get('after') || 0);
      const [messages, ids] = await Promise.all([room.list(after), room.ids()]);
      return json({ messages, ids });
    }
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      let body; try { body = await request.json(); } catch { return json({ error: 'No pude leer el mensaje.' }, 400); }
      const v = validateFamilyMessage(body);
      if (v.error) return json({ error: v.error }, 400);
      const ip = request.headers.get('CF-Connecting-IP') || 'x';
      if (!(await room.allow(`${ip}|${v.name.toLowerCase()}`))) return json({ error: 'Esperá unos segundos antes de mandar otro.' }, 429);
      const row = await room.add({ ts: Date.now(), author: v.name, kind: 'family', text: v.text });
      const owner = (await getJSON(env, 'owner')) || Number(env.OWNER_ID || 0);
      if (owner) {
        const sent = await tg(env, 'sendMessage', { chat_id: owner, text: `💬 ${v.name}: ${v.text}`, disable_notification: true });
        if (sent?.result?.message_id) await putJSON(env, `map:${sent.result.message_id}`, row.id);
      }
      return json({ message: row }, 201);
    }
    const m = url.pathname.match(/^\/api\/photo\/([\w-]+)$/);
    if (m) return photoProxy(env, m[1], ctx);
    return json({ error: 'not found' }, 404);
}
