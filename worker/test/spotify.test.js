import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { ensureMockTrip } from './_mocktrip.js';
import { parseNowPlaying, nowPlaying, _mem, authorizeUrl } from '../src/spotify.js';

const env = { SPOTIFY_CLIENT_ID: 'cid', SPOTIFY_CLIENT_SECRET: 'sec', PUBLIC_URL: 'https://p.example' };
const playing = { is_playing: true, currently_playing_type: 'track', item: { name: 'Mañana en el Abasto', artists: [{ name: 'Sumo' }], album: { name: 'Llegando los monos', images: [{ url: 'big', width: 640 }, { url: 'mid', width: 300 }, { url: 'small', width: 64 }] }, external_urls: { spotify: 'https://open.spotify.com/track/x' } } };

test('parse: playing track, paused, ads', () => {
  assert.deepEqual(parseNowPlaying(playing), { title: 'Mañana en el Abasto', artist: 'Sumo', album: 'Llegando los monos', image: 'mid', url: 'https://open.spotify.com/track/x' });
  assert.equal(parseNowPlaying({ ...playing, is_playing: false }), null);
  assert.equal(parseNowPlaying({ ...playing, currently_playing_type: 'ad' }), null);
  assert.equal(parseNowPlaying(null), null);
});

test('authorize url carries scopes, redirect and state', () => {
  const u = new URL(authorizeUrl(env, 'nonce1'));
  assert.equal(u.searchParams.get('redirect_uri'), 'https://p.example/spotify/callback');
  assert.equal(u.searchParams.get('state'), 'nonce1');
  assert.match(u.searchParams.get('scope'), /user-read-currently-playing/);
});

test('refreshes an expired token, caches the answer for 30 s, respects off', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).includes('/api/token')) return new Response(JSON.stringify({ access_token: 'A2', expires_in: 3600 }));
    return new Response(JSON.stringify(playing), { status: 200 });
  };
  let saved = null;
  _mem.at = 0;
  const sp = { refresh: 'R', access: 'old', exp: 0 };
  const t0 = 1e12;
  const a = await nowPlaying(env, { sp, enabled: true, save: (v) => { saved = v; }, now: t0 });
  assert.equal(a.title, 'Mañana en el Abasto');
  assert.equal(saved.access, 'A2');
  assert.equal(calls.filter((c) => c.includes('/api/token')).length, 1);
  await nowPlaying(env, { sp: saved, enabled: true, save() {}, now: t0 + 10e3 });
  assert.equal(calls.length, 2, 'cached');
  assert.equal(await nowPlaying(env, { sp: saved, enabled: false, save() {}, now: t0 + 60e3 }), null);
  assert.equal(await nowPlaying(env, { sp: null, enabled: true, save() {}, now: t0 + 60e3 }), null);
});

test('204 means nothing playing; errors never throw', async () => {
  _mem.at = 0;
  globalThis.fetch = async () => new Response(null, { status: 204 });
  assert.equal(await nowPlaying(env, { sp: { refresh: 'R', access: 'A', exp: 2e12 }, enabled: true, save() {}, now: 1e12 }), null);
  _mem.at = 0;
  globalThis.fetch = async () => { throw new Error('down'); };
  assert.equal(await nowPlaying(env, { sp: { refresh: 'R', access: 'A', exp: 2e12 }, enabled: true, save() {}, now: 1e12 }), null);
});

test('/musica gives a one-time link; callback stores tokens and verifies the endpoint', async () => {
  await ensureMockTrip();
  const core = await import('../src/preview-core.js');
  const { storeAdapter, MemoryStore } = await import('../src/state.js');
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('api.telegram.org')) { sent.push(JSON.parse(init.body)); return new Response('{"ok":true,"result":{"message_id":1}}'); }
    if (u.includes('/api/token')) return new Response(JSON.stringify({ access_token: 'A', refresh_token: 'R', expires_in: 3600 }));
    if (u.includes('currently-playing')) return new Response(JSON.stringify(playing));
    return new Response('{}');
  };
  const e = { ...env, TG_TOKEN: 'x', FORWARD_SECRET: 'fw', STATE: storeAdapter(new MemoryStore(), null), ROOM: { idFromName: () => 'r', get: () => ({}) } };
  const fwd = (text) => core.handleRequest(new Request('https://p/tg', { method: 'POST', headers: { 'X-Ruta-Forward': 'fw', 'X-Ruta-Owner': '42' }, body: JSON.stringify({ message: { message_id: 5, chat: { id: 42, type: 'private' }, from: { id: 42 }, date: 1, text } }) }), e, { waitUntil() {} });
  await fwd('/musica');
  const link = sent.at(-1).text.match(/https:\/\/p\.example\/spotify\/login\?n=(\w+)/);
  assert.ok(link, 'login link sent');
  const login = await core.handleRequest(new Request(`https://p/spotify/login?n=${link[1]}`), e, {});
  assert.equal(login.status, 302);
  assert.match(login.headers.get('Location'), /accounts\.spotify\.com\/authorize/);
  assert.equal((await core.handleRequest(new Request('https://p/spotify/callback?state=bad&code=c'), e, {})).status, 400);
  const cb = await core.handleRequest(new Request(`https://p/spotify/callback?state=${link[1]}&code=c`), e, {});
  assert.equal(cb.status, 200);
  assert.match(await cb.text(), /Mañana en el Abasto/);
  assert.equal(JSON.parse(await e.STATE.get('spotify')).refresh, 'R');
  await fwd('/musica off');
  assert.equal(await e.STATE.get('spotifyOn', 'json'), false);
});
