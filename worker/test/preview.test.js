import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { ensureMockTrip } from './_mocktrip.js';
import { validateFamilyMessage, telegramPostFromOwner, MemoryRoom, makeLimiter } from '../src/chat.js';

let core, prod, trip;
const kv = new Map();
let sent = [];
const room = Object.assign(new MemoryRoom(), { limiter: makeLimiter(), allow(k) { return this.limiter(k); } });
const OWNER = 42;
const env = {
  TG_TOKEN: 'x', FORWARD_SECRET: 'fw', PUBLIC_URL: 'https://preview.example',
  ROOM: { idFromName: () => 'familia', get: () => room },
  STATE: {
    get: async (k, t) => (kv.has(k) ? (t === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null),
    put: async (k, v) => kv.set(k, v),
    delete: async (k) => kv.delete(k),
  },
};
before(async () => {
  trip = await ensureMockTrip();
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), headers: init?.headers, body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 900 + sent.length } }));
  };
  core = await import('../src/preview-core.js');
  prod = await import('../src/index.js');
});

const fwd = (update, secret = 'fw') => core.handleRequest(new Request('https://p/tg', {
  method: 'POST', headers: { 'X-Ruta-Forward': secret, 'X-Ruta-Owner': String(OWNER), 'Content-Type': 'application/json' }, body: JSON.stringify(update),
}), env, { waitUntil() {} });
const priv = (extra) => ({ message: { message_id: Math.floor(Math.random() * 1e6), chat: { id: OWNER, type: 'private' }, from: { id: OWNER }, date: 1795000000, ...extra } });
const api = (path, init) => core.handleRequest(new Request(`https://p${path}`, init), env, { waitUntil() {} });

test('validation of family messages', () => {
  assert.ok(validateFamilyMessage({ name: 'Tía Marta', text: 'Buen viaje!' }).text);
  assert.match(validateFamilyMessage({ name: '', text: 'x' }).error, /nombre/);
  assert.match(validateFamilyMessage({ name: 'x', text: '' }).error, /Escribí/);
  assert.match(validateFamilyMessage({ name: 'x', text: 'a'.repeat(501) }).error, /500/);
  assert.match(validateFamilyMessage({ name: 'Lean', text: 'hola' }).error, /reservado/);
});

test('owner posts: text and photo, commands ignored', () => {
  assert.deepEqual(telegramPostFromOwner({ text: 'Fito hizo caca' }), { text: 'Fito hizo caca', photo: null });
  assert.equal(telegramPostFromOwner({ photo: [{ file_id: 'a' }, { file_id: 'b' }], caption: 'Mirá' }).photo, 'b');
  assert.equal(telegramPostFromOwner({ text: '/estado' }), null);
  assert.equal(telegramPostFromOwner({ location: {} }), null);
});

test('forward requires the shared secret', async () => {
  assert.equal((await fwd({}, 'nope')).status, 403);
});

test('/prueba creates the link; API is token-gated', async () => {
  sent = [];
  await fwd(priv({ text: '/prueba' }));
  const token = JSON.parse(kv.get('share')).token;
  assert.ok(sent[0].body.text.includes(`https://preview.example/?k=${token}`));
  assert.ok(sent[0].body.text.includes(`https://preview.example/nueva/?k=${token}`));
  assert.equal((await api('/api/chat')).status, 404);
  assert.equal((await api(`/api/chat?k=${token}`)).status, 200);
});

test('Lean posts via bot, family writes in the room, Lean can delete', async () => {
  const token = JSON.parse(kv.get('share')).token;
  sent = [];
  const m = priv({ text: 'Fito hizo caca' });
  await fwd(m);
  assert.equal(room.rows.at(-1).author, 'Lean');
  assert.ok(sent.some((s) => s.url.endsWith('/setMessageReaction')));
  // family message → stored + forwarded to Lean silently
  sent = [];
  const r = await api(`/api/chat?k=${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.1.1.1' }, body: JSON.stringify({ name: 'Mamá', text: '¡Abrazo a Fito!' }) });
  assert.equal(r.status, 201);
  const tgSend = sent.find((s) => s.url.endsWith('/sendMessage'));
  assert.equal(tgSend.body.chat_id, OWNER);
  assert.equal(tgSend.body.disable_notification, true);
  // rate limit
  const r2 = await api(`/api/chat?k=${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.1.1.1' }, body: JSON.stringify({ name: 'Mamá', text: 'otro' }) });
  assert.equal(r2.status, 429);
  // list
  const list = await (await api(`/api/chat?k=${token}&after=0`)).json();
  assert.deepEqual(list.messages.map((x) => x.author), ['Lean', 'Mamá']);
  // Lean replies /borrar to the forwarded family message
  const fwdMsgId = tgSend ? 900 + sent.indexOf(tgSend) + 1 : 0;
  await fwd(priv({ text: '/borrar', reply_to_message: { message_id: fwdMsgId } }));
  assert.deepEqual(room.rows.map((x) => x.author), ['Lean']);
});

test('location in preview creates room events, never Telegram alerts', async () => {
  sent = [];
  const s0 = trip.days[0].stops[0], g = trip.days[0].stops[1];
  const T = (h, m) => Math.round(Date.UTC(2026, 10, 18, h + 3, m) / 1000);
  const loc = (lat, lon, t) => priv({ date: t, location: { latitude: lat, longitude: lon } });
  await fwd(loc(s0.lat + (g.lat - s0.lat) * 0.8, s0.lon + (g.lon - s0.lon) * 0.8, T(11, 50)));
  await fwd(loc(g.lat, g.lon, T(12, 20)));
  await fwd(loc(g.lat + 0.001, g.lon, T(12, 22)));
  const ev = room.rows.filter((x) => x.kind === 'event').map((x) => x.text);
  assert.ok(ev.some((t) => t.includes('salieron')));
  assert.ok(ev.some((t) => t.startsWith('¡PARADA!')));
  assert.equal(sent.filter((s) => s.url.endsWith('/sendMessage')).length, 0);
});


test('admin import restores the share token once and never overwrites it', async () => {
  const { storeAdapter, MemoryStore } = await import('../src/state.js');
  const store = new MemoryStore();
  const e = { ...env, STATE: storeAdapter(store, null) };
  const imp = (body, secret = 'fw') => core.handleRequest(new Request('https://p/admin/import', { method: 'POST', headers: { 'X-Ruta-Admin': secret }, body: JSON.stringify(body) }), e, { waitUntil() {} });
  assert.equal((await imp({ share: '{"token":"abc"}' }, 'nope')).status, 403);
  assert.deepEqual((await (await imp({ share: '{"token":"abc"}' })).json()).imported, ['share']);
  assert.equal((await core.handleRequest(new Request('https://p/api/chat?k=abc'), e, { waitUntil() {} })).status, 200);
  assert.deepEqual((await (await imp({ share: '{"token":"zzz"}' })).json()).imported, []);
  assert.equal((await core.handleRequest(new Request('https://p/api/chat?k=abc'), e, { waitUntil() {} })).status, 200);
});

test('a lost link is re-registered by its SHA-256, other tokens stay rejected', async () => {
  const { storeAdapter, MemoryStore } = await import('../src/state.js');
  const crypto = await import('node:crypto');
  const tok = '51e61292e51647f7a5abcb14a47facf9';
  const e = { ...env, STATE: storeAdapter(new MemoryStore(), null), SHARE_SHA256: crypto.createHash('sha256').update(tok).digest('hex') };
  const get = (k) => core.handleRequest(new Request(`https://p/api/chat?k=${k}`), e, { waitUntil() {} });
  assert.equal((await get('otro')).status, 404);
  assert.equal((await get(tok)).status, 200);
  assert.equal(JSON.parse(await e.STATE.get('share')).token, tok);
  assert.equal((await get('otro')).status, 404);
});

test('the original link keeps working even after a new one is generated', async () => {
  const { storeAdapter, MemoryStore } = await import('../src/state.js');
  const crypto = await import('node:crypto');
  const tok = '51e61292e51647f7a5abcb14a47facf9';
  const e = { ...env, STATE: storeAdapter(new MemoryStore(), null), SHARE_SHA256: crypto.createHash('sha256').update(tok).digest('hex') };
  await e.STATE.put('share', JSON.stringify({ token: 'nuevo123' }));
  const get = (k) => core.handleRequest(new Request(`https://p/api/chat?k=${k}`), e, { waitUntil() {} });
  assert.equal((await get(tok)).status, 200);
  assert.equal((await get('nuevo123')).status, 200);
  assert.equal((await get('otro')).status, 404);
});

test('Gran Fondo: race-day locations drive the live view; hotel location stays hidden', async () => {
  const { storeAdapter, MemoryStore } = await import('../src/state.js');
  const e = { ...env, STATE: storeAdapter(new MemoryStore(), null) };
  core.pmem.lastPosTs = 0; core.pmem.cache.clear();
  await e.STATE.put('share', JSON.stringify({ token: 'gf' }));
  const lonPerKm = 1 / 85.24;
  const T = (h, m) => Math.round(Date.UTC(2026, 10, 22, h + 3, m) / 1000);
  const loc = (km, t, off = 0) => core.handleRequest(new Request('https://p/tg', { method: 'POST', headers: { 'X-Ruta-Forward': 'fw', 'X-Ruta-Owner': '42' },
    body: JSON.stringify({ message: { message_id: 1, chat: { id: 42, type: 'private' }, from: { id: 42 }, date: t, location: { latitude: -40 + off, longitude: -71.5 + km * lonPerKm } } }) }), e, { waitUntil() {} });
  const gf = async () => { core.pmem.cache.clear(); return (await core.handleRequest(new Request('https://p/api/granfondo?k=gf'), e, {})).json(); };
  await loc(10, T(7, 0), 0.3); // hotel, far from the course
  let v = await gf();
  assert.equal(v.live.started, false);
  assert.equal(v.position, null);
  await loc(0.5, T(8, 0));
  await loc(15.5, T(8, 30));
  v = await gf();
  assert.equal(v.live.started, true);
  assert.ok(v.live.km > 15 && v.live.km < 16);
  assert.ok(v.position);
  assert.equal(v.live.nextClimb.startKm, 87);
  assert.equal((await core.handleRequest(new Request('https://p/api/granfondo?k=nope'), e, {})).status, 404);
});

// ───────── Karoo telemetry ─────────
async function karooEnv() {
  const { storeAdapter, MemoryStore } = await import('../src/state.js');
  const e = { ...env, KAROO_KEY: 'kk', STATE: storeAdapter(new MemoryStore(), null) };
  core.pmem.lastPosTs = 0; core.pmem.cache.clear(); core.pmem.tele = null;
  await e.STATE.put('share', JSON.stringify({ token: 'gf' }));
  return e;
}
const lonPerKmK = 1 / 85.24;
const TK = (h, m, s = 0) => Date.UTC(2026, 10, 22, h + 3, m, s);
const tele = (e, body, key = 'kk') => core.handleRequest(new Request('https://p/api/telemetry', { method: 'POST', headers: { 'X-Ruta-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), e, { waitUntil() {} });
const gfK = async (e) => { core.pmem.cache.clear(); return (await core.handleRequest(new Request('https://p/api/granfondo?k=gf'), e, {})).json(); };
const sample = (km, ts, extra = {}) => ({ ts, lat: -40, lon: -71.5 + km * lonPerKmK, hr: 150, power: 240, cadence: 90, speedKmh: 30, state: 'recording', ...extra });

test('telemetry rejects wrong key and stores nothing', async () => {
  const e = await karooEnv();
  const r = await tele(e, sample(1, TK(8, 0)), 'bad');
  assert.equal(r.status, 401);
  assert.equal((await tele(e, sample(1, TK(8, 0)), '')).status, 401);
  const v = await gfK(e);
  assert.equal(v.sensors, null);
});

test('telemetry feeds the race on race day and hides position before the start', async () => {
  const e = await karooEnv();
  assert.equal((await tele(e, sample(10, TK(7, 0), { lat: -39.7 }))).status, 200); // hotel, off course
  let v = await gfK(e);
  assert.equal(v.live.started, false);
  assert.equal(v.position, null);
  assert.equal(v.sensors.hr, 150);
  await tele(e, sample(0.5, TK(8, 0)));
  await tele(e, sample(20.5, TK(8, 40)));
  v = await gfK(e);
  assert.equal(v.live.started, true);
  assert.ok(v.live.km > 20 && v.live.km < 21, `km ${v.live.km}`);
  assert.ok(v.position);
  assert.deepEqual([v.sensors.hr, v.sensors.power, v.sensors.cadence, v.sensors.speedKmh], [150, 240, 90, 30]);
});

test('Telegram location is ignored for the race while the Karoo is fresh', async () => {
  const e = await karooEnv();
  await tele(e, sample(0.5, TK(8, 0)));
  await tele(e, sample(20.5, TK(8, 40)));
  const loc = (km, t) => core.handleRequest(new Request('https://p/tg', { method: 'POST', headers: { 'X-Ruta-Forward': 'fw', 'X-Ruta-Owner': '42' },
    body: JSON.stringify({ message: { message_id: 1, chat: { id: 42, type: 'private' }, from: { id: 42 }, date: Math.round(t / 1000), location: { latitude: -40, longitude: -71.5 + km * lonPerKmK } } }) }), e, { waitUntil() {} });
  await loc(30, TK(8, 41)); // phone GPS says km 30, Karoo (1 min ago) says 20.5
  const v = await gfK(e);
  assert.ok(v.live.km < 21, `km ${v.live.km}`);
});

test('sensor values older than 60 s are null; a missing power meter stays null', async () => {
  const e = await karooEnv();
  await tele(e, sample(0.5, TK(8, 0), { power: null }));
  let v = await gfK(e);
  assert.equal(v.sensors.power, null);
  assert.equal(v.sensors.hr, 150);
  const st = await e.STATE.get('tele', 'json'); await e.STATE.put('tele', JSON.stringify({ ...st, at: st.at - 61e3 }));
  v = await gfK(e);
  assert.equal(v.sensors.hr, null);
  assert.ok(v.sensors.ageSec >= 61);
});

test('/karoo replies with the APK link to the owner', async () => {
  const e = await karooEnv();
  sent = [];
  await core.handleRequest(new Request('https://p/tg', { method: 'POST', headers: { 'X-Ruta-Forward': 'fw', 'X-Ruta-Owner': '42' },
    body: JSON.stringify({ message: { message_id: 2, chat: { id: 42, type: 'private' }, from: { id: 42 }, date: 1, text: '/karoo' } }) }), e, { waitUntil() {} });
  const msg = sent.find((s) => s.body?.text?.includes('/karoo/'));
  assert.ok(msg, 'no karoo link sent');
  assert.match(msg.body.text, /https:\/\/preview\.example\/karoo\/[0-9a-f]{24}\.apk/);
  assert.ok(!msg.body.text.includes('kk'));
});

test('sensors come from storage, not a stale per-isolate copy', async () => {
  const e = await karooEnv();
  await tele(e, sample(0.5, TK(8, 0), { hr: 120 }));
  await gfK(e); // this isolate now holds a copy
  // another isolate stores a newer sample
  await e.STATE.put('tele', JSON.stringify({ ...sample(1, TK(8, 1), { hr: 171 }), at: Date.now() }));
  const v = await gfK(e);
  assert.equal(v.sensors.hr, 171);
});

test('Telegram is ignored for the race even when the Karoo posted to another isolate', async () => {
  const e = await karooEnv();
  await tele(e, sample(0.5, TK(8, 0)));
  await tele(e, sample(20.5, TK(8, 40)));
  core.pmem.tele = null; // the Telegram webhook lands on a different isolate
  await core.handleRequest(new Request('https://p/tg', { method: 'POST', headers: { 'X-Ruta-Forward': 'fw', 'X-Ruta-Owner': '42' },
    body: JSON.stringify({ message: { message_id: 1, chat: { id: 42, type: 'private' }, from: { id: 42 }, date: Math.round(TK(8, 41) / 1000), location: { latitude: -40, longitude: -71.5 + 30 * lonPerKmK } } }) }), e, { waitUntil() {} });
  const v = await gfK(e);
  assert.ok(v.live.km < 21, `km ${v.live.km}`);
  assert.ok(Math.abs(v.position.lon - (-71.5 + 20.5 * lonPerKmK)) < 1e-6, 'marker must follow the Karoo while it is fresh');
});
