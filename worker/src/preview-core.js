// Ruta Fito — preview Worker core ("modo 8 bits" + sala de la familia).
// Receives a copy of the owner's Telegram updates from production (never the webhook itself),
// keeps its own state, serves the 8-bit webapp as static assets, and hosts the family room.
// SILENT: never sends trip alerts; only room messages (silently) and the /prueba link.
import trip from './trip.built.js';
import { pickDay, argentinaDate, detectVisit, formatClock } from './logic.js';
import { loadState, buildView, publicView } from './index.js';
import { validateFamilyMessage, telegramPostFromOwner } from './chat.js';
import { authorizeUrl, exchangeCode, nowPlaying, parseNowPlaying, _mem as spMem } from './spotify.js';

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

const page = (title, text, status = 200) => new Response(`<!doctype html><html lang="es-AR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#f5f5f7;font:16px/1.55 -apple-system,system-ui,sans-serif"><main style="max-width:420px;padding:24px;border:1px solid rgba(255,255,255,.1);border-radius:20px;background:#1c1c1e;margin:16px"><h1 style="font-size:1.44rem;font-weight:600;margin:0 0 8px">${title}</h1><p style="margin:0;color:#c7c7cc">${text.replace(/</g, '&lt;')}</p></main></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

export const roomOf = (env) => env.ROOM.get(env.ROOM.idFromName('familia'));

// ───────── Updates forwarded from production ─────────
async function onLocation(env, st, msg, room) {
  const ts = (msg.edit_date || msg.date) * 1000;
  if (st.track.pos && ts - st.track.pos.ts < POS_WRITE_EVERY_MS) { pmem.lastPosTs = Math.max(pmem.lastPosTs, st.track.pos.ts); return; }
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
  pmem.lastPosTs = ts;
  writes.push(putJSON(env, 'track', { pos, history, near }));
  await Promise.all(writes);
}

const pmem = { lastPosTs: 0, owner: null, cache: new Map() };
export { pmem };

export async function handleForwarded(env, update, ownerId) {
  const msg = update.message || update.edited_message;
  if (!msg?.chat || msg.chat.type !== 'private' || msg.chat.id !== ownerId) return { ignored: true };
  // Fast path: skip storage for live-location edits inside the 90 s window.
  if (msg.location && (msg.edit_date || msg.date) * 1000 - pmem.lastPosTs < POS_WRITE_EVERY_MS) return { location: 'skipped' };
  if (pmem.owner !== ownerId && (await getJSON(env, 'owner')) !== ownerId) await putJSON(env, 'owner', ownerId);
  pmem.owner = ownerId;
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
  if (cmd === '/musica' || cmd === '/música') {
    const arg = (text.split(/\s+/)[1] || '').toLowerCase();
    const sp = await getJSON(env, 'spotify');
    if (!env.SPOTIFY_CLIENT_ID) { await tg(env, 'sendMessage', { chat_id: ownerId, text: 'Falta configurar la app de Spotify (secretos SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET).' }); return { musica: 'unconfigured' }; }
    if (arg === 'off' || arg === 'on') {
      await putJSON(env, 'spotifyOn', arg === 'on'); spMem.at = 0;
      await tg(env, 'sendMessage', { chat_id: ownerId, text: arg === 'on' ? 'Listo: la app vuelve a mostrar lo que suena.' : 'Listo: la app deja de mostrar lo que suena. Para volver: /musica on' });
      return { musica: arg };
    }
    if (sp?.refresh && arg !== 'reconectar') {
      await tg(env, 'sendMessage', { chat_id: ownerId, text: 'Spotify ya está conectado. /musica off para ocultarlo, /musica on para mostrarlo, /musica reconectar para autorizar de nuevo.' });
      return { musica: 'connected' };
    }
    const nonce = crypto.randomUUID().replace(/-/g, '');
    await putJSON(env, 'spotifyNonce', { nonce, exp: Date.now() + 10 * 60e3 });
    await tg(env, 'sendMessage', { chat_id: ownerId, text: `Tocá este link para conectar Spotify (vence en 10 min):\n${env.PUBLIC_URL}/spotify/login?n=${nonce}`, disable_web_page_preview: true });
    return { musica: 'link' };
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
async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function authed(env, url) {
  const k = url.searchParams.get('k');
  if (!k) return false;
  const share = await getJSON(env, 'share');
  if (share?.token && k === share.token) return true;
  // The original family link (known only by its hash) is always valid, even if another link was generated later.
  if (env.SHARE_SHA256 && (await sha256hex(k)) === env.SHARE_SHA256) {
    if (!share?.token) await putJSON(env, 'share', { token: k });
    return true;
  }
  return false;
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
    if (url.pathname === '/admin/import' && request.method === 'POST') { // one-time copy of KV data into the store
      if (!env.FORWARD_SECRET || request.headers.get('X-Ruta-Admin') !== env.FORWARD_SECRET) return new Response('forbidden', { status: 403 });
      const body = await request.json();
      const keys = Object.keys(body).filter((k) => ['owner', 'share', 'track', 'visits', 'flags'].includes(k) && typeof body[k] === 'string');
      const existing = env.STATE.getMany ? await env.STATE.getMany(keys) : {};
      const done = [];
      for (const k of keys) if (existing[k] == null) { await env.STATE.put(k, body[k]); done.push(k); } // never overwrite newer state
      pmem.cache.clear();
      return json({ imported: done });
    }
    if (url.pathname === '/spotify/login') {
      const n = await getJSON(env, 'spotifyNonce');
      if (!n || n.nonce !== url.searchParams.get('n') || n.exp < Date.now()) return page('Este link venció', 'Mandale /musica al bot para pedir uno nuevo.', 400);
      return Response.redirect(authorizeUrl(env, n.nonce), 302);
    }
    if (url.pathname === '/spotify/callback') {
      const n = await getJSON(env, 'spotifyNonce');
      if (!n || n.nonce !== url.searchParams.get('state') || n.exp < Date.now()) return page('No pude verificar el pedido', 'Mandale /musica al bot y probá de nuevo.', 400);
      if (url.searchParams.get('error')) return page('No se conectó', 'Cancelaste la autorización en Spotify. Podés reintentar con /musica.', 400);
      try {
        const tokens = await exchangeCode(env, url.searchParams.get('code'));
        await putJSON(env, 'spotify', tokens); await putJSON(env, 'spotifyOn', true); await putJSON(env, 'spotifyNonce', null);
        // Verify the endpoint right away (Spotify restricts some endpoints for development-mode apps).
        const r = await fetch('https://api.spotify.com/v1/me/player/currently-playing', { headers: { Authorization: `Bearer ${tokens.access}` } });
        spMem.at = 0;
        if (r.status === 200) { const t = parseNowPlaying(await r.json()); return page('Spotify conectado', t ? `Ahora suena: ${t.title} — ${t.artist}. Ya aparece en la app.` : 'Funciona. Cuando pongas música, aparece en la app.'); }
        if (r.status === 204) return page('Spotify conectado', 'Funciona. Cuando pongas música, aparece en la app.');
        return page('Conectado, pero Spotify no deja leer lo que suena', `Respuesta ${r.status}. Puede ser una restricción de Spotify para apps en modo desarrollo; avisale a Claude.`, 200);
      } catch (e) { return page('No pude conectar', `Error al pedir el permiso a Spotify (${String(e.message).slice(0, 80)}). Revisá el Client Secret y la Redirect URI.`, 500); }
    }
    if (url.pathname === '/api/diag') { // no secrets: only whether things are configured
      const share = await getJSON(env, 'share');
      return json({ shareSet: !!share?.token, hashConfigured: !!env.SHARE_SHA256, store: !!env.STORE });
    }
    if (!url.pathname.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Ruta Fito 8-bit');
    if (!(await authed(env, url))) return json({ error: 'Link no válido o vencido' }, 404);
    const room = roomOf(env);

    if (url.pathname === '/api/public') {
      const hit = pmem.cache.get('public');
      if (hit && Date.now() - hit.at < 15e3) return json(hit.body);
      const st = await loadState(env);
      const body = publicView(st, buildView(st, Date.now()), Date.now());
      const [sp, on] = await Promise.all([getJSON(env, 'spotify'), getJSON(env, 'spotifyOn')]);
      body.music = await nowPlaying(env, { sp, enabled: on !== false, save: (v) => putJSON(env, 'spotify', v) });
      pmem.cache.set('public', { at: Date.now(), body });
      return json(body);
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
