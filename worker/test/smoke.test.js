// End-to-end smoke test of the Worker with a fake KV, fake Telegram and a straight-line trip.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

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

before(async () => {
  let existing = null;
  try { existing = await fs.readFile(builtPath, 'utf8'); } catch {}
  if (!existing) {
    // Straight lines between stops stand in for the OSRM geometry.
    const trip = JSON.parse(await fs.readFile(path.join(here, '../../data/trip.json'), 'utf8'));
    const { cumulativeKm } = await import('../src/logic.js');
    trip.days = trip.days.map((d) => {
      const route = d.stops.map((s) => [s.lon, s.lat]);
      const cum = cumulativeKm(route);
      return { ...d, route, totalKm: Math.round(cum.at(-1)), driveMin: 600, plannedEnd: '20:00',
        stops: d.stops.map((s, i) => ({ ...s, km: cum[i], plannedArrival: '12:00', legKm: 0, legMin: 0 })) };
    });
    await fs.writeFile(builtPath, `export default ${JSON.stringify(trip)};\n`);
  }
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null }); return new Response('{"ok":true}'); };
  worker = (await import('../src/index.js'));
});

const post = (update, secret = 's3cret') => worker.default.fetch(new Request('https://w/tg', {
  method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': secret, 'Content-Type': 'application/json' }, body: JSON.stringify(update),
}), env);

test('rejects bad webhook secret', async () => {
  const r = await post({}, 'nope');
  assert.equal(r.status, 403);
});

test('start registers owner, location triggers plan, cron alerts before Gorchs', async () => {
  sent = [];
  await post({ message: { chat: { id: 42 }, text: '/start', date: 1 } });
  assert.equal(JSON.parse(kv.get('owner')), 42);
  // Day 1, ~20 km before ACA Gorchs on the Berisso→Gorchs line.
  const ts = Date.UTC(2026, 10, 18, 14, 0) / 1000;
  const lat = -35.70025 + (35.70025 - 34.86886) * 0.18, lon = -58.88974 + (58.88974 - 57.88287) * 0.18;
  await post({ message: { chat: { id: 42 }, date: ts, location: { latitude: lat, longitude: lon } } });
  assert.ok(sent.some((m) => m.body?.text?.includes('Día 1')), 'plan sent');
  sent = [];
  const res = await worker.runCron(env, ts * 1000 + 60e3);
  assert.equal(res.notified, 'd1-gorchs');
  assert.ok(sent[0].body.text.includes('ACA Gorchs'));
  assert.ok(sent[0].body.reply_markup.inline_keyboard[0][0].url.startsWith('https://waze.com/ul'));
  // Not twice.
  sent = [];
  const res2 = await worker.runCron(env, ts * 1000 + 16 * 60e3);
  assert.equal(res2.notified, undefined);
});

test('ignores strangers and serves /status', async () => {
  sent = [];
  await post({ message: { chat: { id: 7 }, date: 1, location: { latitude: -30, longitude: -60 } } });
  assert.equal(sent.length, 0);
  const r = await worker.default.fetch(new Request('https://w/status'), env);
  const st = await r.json();
  assert.equal(st.hasPosition, true);
  assert.equal(st.dayId, 'd1');
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
});

test('stale alert after 30 min without location on a trip day', async () => {
  sent = [];
  const pos = JSON.parse(kv.get('pos'));
  const res = await worker.runCron(env, pos.ts + 40 * 60e3);
  assert.equal(res.stale, true);
  assert.ok(sent[0].body.text.includes('No recibo tu ubicación'));
});
