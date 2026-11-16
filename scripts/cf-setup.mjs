// Idempotent Cloudflare bootstrap for CI: account id, workers.dev subdomain, KV namespace.
// Writes worker/wrangler.toml and prints outputs for GitHub Actions.
import fs from 'node:fs/promises';
import path from 'node:path';

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) throw new Error('CLOUDFLARE_API_TOKEN missing');
const API = 'https://api.cloudflare.com/client/v4';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

async function cf(method, p, body) {
  const r = await fetch(API + p, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}

let accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!accountId) {
  const acc = await cf('GET', '/accounts');
  if (!acc.success || !acc.result?.length) throw new Error('Cannot list accounts: ' + JSON.stringify(acc.errors));
  accountId = acc.result[0].id;
  console.log('Account:', acc.result[0].name);
}

let sub = await cf('GET', `/accounts/${accountId}/workers/subdomain`);
let subdomain = sub.result?.subdomain;
if (!subdomain) {
  const wanted = process.env.WORKERS_SUBDOMAIN || `ruta-fito-${accountId.slice(0, 6)}`;
  const created = await cf('PUT', `/accounts/${accountId}/workers/subdomain`, { subdomain: wanted });
  if (!created.success) throw new Error('Cannot create workers.dev subdomain: ' + JSON.stringify(created.errors));
  subdomain = created.result.subdomain;
  console.log('Created workers.dev subdomain', subdomain);
}

const title = 'ruta-fito-state';
const list = await cf('GET', `/accounts/${accountId}/storage/kv/namespaces?per_page=100`);
if (!list.success) throw new Error('Cannot list KV namespaces: ' + JSON.stringify(list.errors));
let ns = list.result.find((n) => n.title === title);
if (!ns) {
  const c = await cf('POST', `/accounts/${accountId}/storage/kv/namespaces`, { title });
  if (!c.success) throw new Error('Cannot create KV: ' + JSON.stringify(c.errors));
  ns = c.result;
  console.log('Created KV namespace', ns.id);
}

const pagesUrl = process.env.PAGES_URL || '';
const toml = `name = "ruta-fito"
main = "src/index.js"
compatibility_date = "2026-11-01"
workers_dev = true

[triggers]
crons = ["*/15 * * * *"]

[[kv_namespaces]]
binding = "STATE"
id = "${ns.id}"

[vars]
PAGES_URL = "${pagesUrl}"
`;
await fs.writeFile(path.join(root, 'worker/wrangler.toml'), toml);

const workerUrl = `https://ruta-fito.${subdomain}.workers.dev`;
const out = process.env.GITHUB_OUTPUT;
if (out) await fs.appendFile(out, `account_id=${accountId}\nworker_url=${workerUrl}\n`);
console.log('Worker URL will be', workerUrl);
