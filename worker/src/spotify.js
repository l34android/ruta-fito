// Spotify "now playing" for the trip view. Owner authorizes once (via a one-time link from the bot);
// the Worker keeps the refresh token in the state store and caches the answer for 30 s.

export const SCOPES = 'user-read-currently-playing user-read-playback-state';
const CACHE_MS = 30e3;
const mem = { at: 0, value: null };
export const _mem = mem;

export const redirectUri = (env) => `${env.PUBLIC_URL}/spotify/callback`;

export function authorizeUrl(env, state) {
  const p = new URLSearchParams({ response_type: 'code', client_id: env.SPOTIFY_CLIENT_ID, scope: SCOPES, redirect_uri: redirectUri(env), state, show_dialog: 'true' });
  return `https://accounts.spotify.com/authorize?${p}`;
}

async function tokenRequest(env, params) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)}` },
    body: new URLSearchParams(params),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`spotify token ${r.status} ${j.error || ''}`);
  return j;
}

export async function exchangeCode(env, code) {
  const j = await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(env) });
  return { refresh: j.refresh_token, access: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
}

async function accessToken(env, sp, save) {
  if (sp.access && sp.exp > Date.now()) return sp.access;
  const j = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: sp.refresh });
  const next = { ...sp, access: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000, refresh: j.refresh_token || sp.refresh };
  await save(next);
  return next.access;
}

// Normalized track or null (nothing playing / paused / ad / not connected / off).
export function parseNowPlaying(j) {
  if (!j || !j.is_playing || !j.item || j.currently_playing_type !== 'track') return null;
  const it = j.item;
  const imgs = it.album?.images || [];
  const img = imgs.find((i) => i.width && i.width <= 320) || imgs[imgs.length - 1] || null;
  return {
    title: it.name,
    artist: (it.artists || []).map((a) => a.name).join(', '),
    album: it.album?.name || '',
    image: img?.url || null,
    url: it.external_urls?.spotify || null,
  };
}

export async function nowPlaying(env, { sp, enabled, save, now = Date.now() }) {
  if (!enabled || !sp?.refresh || !env.SPOTIFY_CLIENT_ID) return null;
  if (now - mem.at < CACHE_MS) return mem.value;
  let value = null;
  try {
    const tok = await accessToken(env, sp, save);
    const r = await fetch('https://api.spotify.com/v1/me/player/currently-playing', { headers: { Authorization: `Bearer ${tok}` } });
    if (r.status === 200) value = parseNowPlaying(await r.json());
    else if (r.status !== 204) console.error('spotify now playing', r.status);
  } catch (e) { console.error('spotify', e.message); }
  mem.at = now; mem.value = value;
  return value;
}
