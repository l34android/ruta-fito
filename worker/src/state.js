// KV-compatible state backed by a Durable Object (SQLite), with lazy one-time migration from KV.
// Why: Workers KV free tier allows 100k reads/day; live location updates exhausted it.
// The DO serves all keys in a single call (getMany) and has no daily read cap that we can hit.

export const ABSENT = '\u0000absent'; // known-missing marker, so we never fall back to KV twice for the same key

export function storeAdapter(stub, kv) {
  async function getMany(keys) {
    const got = await stub.getMany(keys);
    const out = {};
    for (const k of keys) {
      let v = got[k];
      if (v == null && kv) { // not migrated yet: try KV once
        try {
          const fromKv = await kv.get(k);
          v = fromKv == null ? ABSENT : fromKv;
          await stub.put(k, v);
        } catch { v = null; } // KV over quota or down: treat as missing, retry another time
      }
      out[k] = v === ABSENT ? null : v ?? null;
    }
    return out;
  }
  return {
    getMany,
    async get(k, type) {
      const v = (await getMany([k]))[k];
      if (v == null) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: (k, v) => stub.put(k, String(v)),
    delete: (k) => stub.put(k, ABSENT),
  };
}

// Plain-JS store used by tests (same interface as the Durable Object).
export class MemoryStore {
  constructor() { this.m = new Map(); this.calls = 0; }
  getMany(keys) { this.calls++; return Object.fromEntries(keys.map((k) => [k, this.m.has(k) ? this.m.get(k) : null])); }
  put(k, v) { this.calls++; this.m.set(k, v); }
}
