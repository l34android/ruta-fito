// Ruta Fito — preview Worker entry: Durable Object for the family room + request wiring.
import { DurableObject } from 'cloudflare:workers';
import { makeLimiter, KEEP } from './chat.js';
import { handleRequest } from './preview-core.js';

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS msg (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, author TEXT, kind TEXT, text TEXT, photo TEXT)');
    this.limiter = makeLimiter();
  }
  add(m) {
    const row = this.sql.exec('INSERT INTO msg (ts, author, kind, text, photo) VALUES (?, ?, ?, ?, ?) RETURNING id', m.ts, m.author, m.kind, m.text || '', m.photo || null).one();
    this.sql.exec('DELETE FROM msg WHERE id <= ?', row.id - KEEP);
    return { id: row.id, ts: m.ts, author: m.author, kind: m.kind, text: m.text || '', photo: m.photo || null };
  }
  list(after = 0, limit = 100) { return this.sql.exec('SELECT * FROM msg WHERE id > ? ORDER BY id DESC LIMIT ?', after, limit).toArray().reverse(); }
  ids(limit = 100) { return this.sql.exec('SELECT id FROM msg ORDER BY id DESC LIMIT ?', limit).toArray().map((r) => r.id); }
  remove(id) { this.sql.exec('DELETE FROM msg WHERE id = ?', id); }
  allow(key) { return this.limiter(key); }
}

export default { fetch: handleRequest };
