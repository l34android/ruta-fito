// End-to-end smoke test of the Worker with a fake KV, fake Telegram and a straight-line trip.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureMockTrip } from './_mocktrip.js';

const here = path.dirname(new URL(import.meta.url).pathname);
const builtPath = path.join(here, '../src/trip.built.js');
let worker, sent = [];
const kv = new Map();
const env = {
  TG_TOKEN: 'x', WEBHOOK_SECRET: 's3cret', PAGES_URL: 'https://example.github.io/ruta-fito/',
  STATE: {
    get: async (k, t) => (kv.has(k) ? (t === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null),
    put: async (k, v) => kv.set(k, v),
    delete: async (k) => kv.delete(k),
  },
};
const OWNER = 42, FAMILY = -100;
let trip;

before(async () => {
  trip = await ensureMockTrip();
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null }); return new Response('{"ok":true}'); };
  worker = await import('../src/index.js');
});

const post = (update, secret = 's3cret') => worker.default.fetch(new Request('https://w/tg', {
  method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': secret, 'Content-Type': 'application/json' }, body: JSON.stringify(update),
}), env);
const priv = (extra) => ({ message: { chat: { id: OWNER, type: 'private' }, from: { id: OWNER }, date: 1, ...extra } });
const loc = (lat, lon, ts) => priv({ date: Math.round(ts / 1000), location: { latitude: lat, longitude: lon } });
const toFamily = () => sent.filter((m) => m.body?.chat_id === FAMILY).map((m) => m.body.text);
const toOwner = () => sent.filter((m) => m.body?.chat_id === OWNER).map((m) => m.body.text);
const stop = (id) => trip.days.flatMap((d) => d.stops).find((s) => s.id === id);
const lerp = (a, b, f) => [a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f];
const T = (hh, mm, day = 18) => Date.UTC(2026, 10, day, hh + 3, mm);

test('rejects bad webhook secret', async () => {
  assert.equal((await post({}, 'nope')).status, 403);
});

test('owner setup, share link and family group', async () => {
  sent = [];
  await post(priv({ text: '/start' }));
  assert.equal(JSON.parse(kv.get('owner')), OWNER);
  await post(priv({ text: '/compartir' }));
  const token = JSON.parse(kv.get('share')).token;
  assert.match(toOwner().at(-1), new RegExp(`seguir\\.html\\?k=${token}`));
  // someone else can't link a group
  await post({ message: { chat: { id: FAMILY, type: 'group' }, from: { id: 7 }, text: '/familia', date: 1 } });
  assert.equal(kv.get('family'), undefined);
  await post({ message: { chat: { id: FAMILY, type: 'group', title: 'Familia' }, from: { id: OWNER }, text: '/familia@travel_guide_fito_bot', date: 1 } });
  assert.equal(JSON.parse(kv.get('family')).chatId, FAMILY);
  assert.equal(toFamily().length, 1);
});

test('departure, stop alert, arrival and family updates on day 1', async () => {
  sent = [];
  const s0 = stop('d1-salida'), g = stop('d1-gorchs');
  // At home before leaving: plan sent to owner, nothing to family.
  await post(loc(s0.lat, s0.lon, T(10, 20)));
  assert.ok(toOwner().some((t) => t.includes('Día 1')));
  assert.equal(toFamily().length, 0);
  // On the road, ~80% of the way to Gorchs → departure message to family.
  const [la, lo] = lerp(s0, g, 0.8);
  await post(loc(la, lo, T(11, 50)));
  assert.ok(toFamily().some((t) => t.includes('salieron de Berisso')));
  // Cron: Gorchs is close → alert with live ETA.
  sent = [];
  const res = await worker.runCron(env, T(11, 51));
  assert.equal(res.notified, 'd1-gorchs');
  assert.ok(toOwner()[0].includes('ACA Gorchs'));
  // Two samples at Gorchs → arrival → family message.
  sent = [];
  await post(loc(g.lat, g.lon, T(12, 20)));
  await post(loc(g.lat + 0.001, g.lon, T(12, 22)));
  assert.ok(toFamily().some((t) => t.startsWith('Pararon en ACA Gorchs')));
  const visits = JSON.parse(kv.get('visits'));
  assert.equal(visits['d1-gorchs'].arrivedAt, T(12, 20));
});

test('/status exposes the live plan; /public needs the token and hides home', async () => {
  const realNow = Date.now; Date.now = () => T(12, 25);
  const st = await (await worker.default.fetch(new Request('https://w/status'), env)).json();
  const p1 = st.plans.find((p) => p.dayId === 'd1');
  assert.equal(p1.stops.find((x) => x.id === 'd1-gorchs').state, 'here');
  assert.ok(st.fuel.next.id === 'd1-olavarria');
  assert.equal((await worker.default.fetch(new Request('https://w/public?k=bad'), env)).status, 404);
  const token = JSON.parse(kv.get('share')).token;
  const pub = await (await worker.default.fetch(new Request(`https://w/public?k=${token}`), env)).json();
  assert.equal(pub.hasPosition, true);
  assert.ok(pub.plans.length === 2);
  assert.equal(pub.position.lat, stop('d1-gorchs').lat + 0.001);
  assert.equal(pub.plans[0].live, true);
  Date.now = realNow;
});

test('/public hides the position near home', async () => {
  const s0 = stop('d1-salida');
  kv.set('track', JSON.stringify({ pos: { lat: s0.lat + 0.01, lon: s0.lon, ts: T(10, 0) }, history: [] }));
  const token = JSON.parse(kv.get('share')).token;
  const pub = await (await worker.default.fetch(new Request(`https://w/public?k=${token}`), env)).json();
  assert.equal(pub.position, null);
  assert.equal(pub.hiddenNearHome, true);
  kv.set('track', JSON.stringify({ pos: { lat: stop('d1-gorchs').lat, lon: stop('d1-gorchs').lon, ts: T(12, 22) }, history: [] }));
});

test('fuel stop arrival resets the fuel counter', async () => {
  const o = stop('d1-olavarria');
  await post(loc(o.lat, o.lon, T(15, 30)));
  await post(loc(o.lat, o.lon + 0.001, T(15, 32)));
  assert.equal(JSON.parse(kv.get('fuel')).stopId, 'd1-olavarria');
});

test('nightfall warning when running late', async () => {
  sent = [];
  // 19:30 and still ~40% of the way from Olavarría to Villa Ventana.
  const o = stop('d1-olavarria'), vv = stop('d1-villaventana');
  const [la, lo] = lerp(o, vv, 0.4);
  await post(loc(la, lo, T(19, 30)));
  const r = await worker.runCron(env, T(19, 31));
  assert.equal(r.dark, true);
  assert.ok(toOwner().some((t) => t.includes('oscurece')));
  // not repeated
  sent = [];
  const r2 = await worker.runCron(env, T(19, 46));
  assert.notEqual(r2.dark, true);
});

test('stale alert after 30 min without location on a trip day', async () => {
  sent = [];
  const pos = JSON.parse(kv.get('track')).pos;
  const res = await worker.runCron(env, pos.ts + 40 * 60e3);
  assert.equal(res.stale, true);
  assert.ok(toOwner()[0].includes('No recibo tu ubicación'));
});

test('strangers are ignored', async () => {
  sent = [];
  await post({ message: { chat: { id: 7, type: 'private' }, from: { id: 7 }, date: 1, location: { latitude: -30, longitude: -60 } } });
  assert.equal(sent.length, 0);
});

test('/reset keeps owner, link and family', async () => {
  await post(priv({ text: '/reset' }));
  assert.equal(kv.get('track'), undefined);
  assert.ok(kv.get('share') && kv.get('family') && kv.get('owner'));
});
