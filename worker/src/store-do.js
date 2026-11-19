// Durable Object holding the trip state as a small key/value table (SQLite).
import { DurableObject } from 'cloudflare:workers';

export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)');
  }
  getMany(keys) {
    const out = {};
    for (const k of keys) {
      const row = this.sql.exec('SELECT v FROM kv WHERE k = ?', k).toArray()[0];
      out[k] = row ? row.v : null;
    }
    return out;
  }
  put(k, v) { this.sql.exec('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, v); }
}
