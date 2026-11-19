import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { ensureMockTrip } from './_mocktrip.js';

let prod, sent = [];
const OWNER = 42;
const priv = (extra) => ({ message: { message_id: 1, chat: { id: OWNER, type: 'private' }, from: { id: OWNER }, date: 1, ...extra } });
before(async () => {
  await ensureMockTrip();
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), headers: init?.headers }); return new Response('{}'); };
  prod = await import('../src/index.js');
});

test('webhook answers ok even if the preview forward hangs', async () => {
  const kv = new Map([['owner', JSON.stringify(OWNER)]]);
  const env = { WEBHOOK_SECRET: 's', TG_TOKEN: 'x', PREVIEW_URL: 'https://prev', FORWARD_SECRET: 'fw',
    STATE: { get: async (k, t) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v) => kv.set(k, v), delete: async (k) => kv.delete(k) } };
  const pending = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => String(url).startsWith('https://prev') ? new Promise(() => {}) : realFetch(url, init);
  const res = await prod.default.fetch(new Request('https://w/tg', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 's' }, body: JSON.stringify(priv({ text: 'hola' })) }), env, { waitUntil: (p) => pending.push(p) });
  assert.equal(await res.text(), 'ok');
  assert.equal(pending.length, 1);
  globalThis.fetch = realFetch;
});

test('forward: only owner private updates, never throws', async () => {
  const pkv = new Map([['owner', JSON.stringify(OWNER)]]);
  const penv = { PREVIEW_URL: 'https://prev', FORWARD_SECRET: 'fw', STATE: { get: async (k, t) => (pkv.has(k) ? JSON.parse(pkv.get(k)) : null) } };
  sent = [];
  assert.equal(await prod.forwardToPreview(penv, priv({ text: 'hola' })), true);
  assert.equal(sent[0].url, 'https://prev/tg');
  assert.equal(sent[0].headers['X-Ruta-Owner'], String(OWNER));
  assert.equal(await prod.forwardToPreview(penv, { message: { chat: { id: 7, type: 'private' }, text: 'x' } }), false);
  assert.equal(await prod.forwardToPreview(penv, { message: { chat: { id: -100, type: 'group' }, from: { id: OWNER }, text: '/familia' } }), false);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('boom'); };
  assert.equal(await prod.forwardToPreview(penv, priv({ text: 'hola' })), false);
  globalThis.fetch = realFetch;
});
