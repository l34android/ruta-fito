// One-time, idempotent copy of the trip state from Workers KV into the Durable Object store.
// The Worker only imports keys the store doesn't have yet, so re-running never rolls back newer state.
const { CLOUDFLARE_API_TOKEN: token, ACCOUNT_ID: acc, KV_ID: ns, WORKER_URL: url, FORWARD_SECRET: secret } = process.env;
const KEYS = ['owner', 'track', 'visits', 'fuel', 'flags', 'notified', 'share', 'family'];
const body = {};
for (const k of KEYS) {
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/storage/kv/namespaces/${ns}/values/${k}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) body[k] = await r.text();
    console.log(`KV ${k}: ${r.status}`);
  } catch (e) { console.log(`KV ${k}: ${e.message}`); }
}
if (!Object.keys(body).length) { console.log('Nothing read from KV (quota or empty); the Worker will migrate lazily later.'); process.exit(0); }
const r = await fetch(`${url}/admin/import`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ruta-Admin': secret }, body: JSON.stringify(body) });
console.log('import:', r.status, await r.text());
