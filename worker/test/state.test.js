import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { ensureMockTrip } from './_mocktrip.js';
import { storeAdapter, MemoryStore, ABSENT } from '../src/state.js';

const kvFrom = (obj, { fail = false } = {}) => ({ reads: 0, async get(k) { this.reads++; if (fail) throw new Error('KV get() limit exceeded for the day.'); return obj[k] ?? null; } });

test('migrates a key from KV once, then never reads KV again', async () => {
  const store = new MemoryStore(); const kv = kvFrom({ owner: '42' });
  const st = storeAdapter(store, kv);
  assert.equal(await st.get('owner', 'json'), 42);
  assert.equal(await st.get('owner', 'json'), 42);
  assert.equal(kv.reads, 1);
});

test('missing in KV is remembered as absent (no repeated KV reads)', async () => {
  const store = new MemoryStore(); const kv = kvFrom({});
  const st = storeAdapter(store, kv);
  assert.equal(await st.get('family'), null);
  assert.equal(await st.get('family'), null);
  assert.equal(kv.reads, 1);
  assert.equal(store.m.get('family'), ABSENT);
});

test('KV over quota: returns null and retries later without caching absence', async () => {
  const store = new MemoryStore(); const kv = kvFrom({ share: '{"token":"t"}' }, { fail: true });
  const st = storeAdapter(store, kv);
  assert.equal(await st.get('share', 'json'), null);
  assert.equal(store.m.has('share'), false);
});

test('put/delete go to the store; delete never resurrects KV data', async () => {
  const store = new MemoryStore(); const kv = kvFrom({ track: '{"a":1}' });
  const st = storeAdapter(store, kv);
  await st.put('track', '{"b":2}');
  assert.deepEqual(await st.get('track', 'json'), { b: 2 });
  await st.delete('track');
  assert.equal(await st.get('track'), null);
  assert.equal(kv.reads, 0);
});

test('loadState reads every key in a single store call', async () => {
  await ensureMockTrip();
  const { loadState } = await import('../src/index.js');
  const store = new MemoryStore();
  store.m.set('owner', '42'); store.m.set('share', '{"token":"abc"}');
  const env = { STATE: storeAdapter(store, null) };
  const st = await loadState(env);
  assert.equal(st.owner, 42);
  assert.equal(st.share.token, 'abc');
  assert.equal(store.calls, 1);
});

test('location edits within 90 s skip storage entirely', async () => {
  await ensureMockTrip();
  const prod = await import('../src/index.js');
  const store = new MemoryStore(); store.m.set('owner', '42');
  const env = { WEBHOOK_SECRET: 's', TG_TOKEN: 'x', STATE: storeAdapter(store, null) };
  globalThis.fetch = async () => new Response('{"ok":true}');
  const post = (ts) => prod.default.fetch(new Request('https://w/tg', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 's' },
    body: JSON.stringify({ edited_message: { chat: { id: 42, type: 'private' }, from: { id: 42 }, date: ts, edit_date: ts, location: { latitude: -35, longitude: -58 } } }) }), env, { waitUntil() {} });
  prod.mem.lastPosTs = 0; prod.mem.owner = null;
  const t0 = 1795000000;
  await post(t0);
  const after1 = store.calls;
  await post(t0 + 10); await post(t0 + 30); await post(t0 + 60);
  assert.equal(store.calls, after1, 'no storage calls for edits inside the window');
  await post(t0 + 100);
  assert.ok(store.calls > after1, 'a new sample after 90 s is stored');
});
