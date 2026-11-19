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

