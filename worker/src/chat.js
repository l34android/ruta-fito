// Family room: validation, rate limiting and message formatting (pure, testable).

export const MAX_TEXT = 500;
export const MAX_NAME = 30;
export const KEEP = 500;
export const RATE_MS = 5000;

const clean = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+\n/g, '\n').trim();

export function validateFamilyMessage(body) {
  const name = clean(body?.name).replace(/\n/g, ' ');
  const text = clean(body?.text);
  if (!name) return { error: 'Poné tu nombre para que sepan quién escribe.' };
  if (name.length > MAX_NAME) return { error: `El nombre puede tener hasta ${MAX_NAME} letras.` };
  if (!text) return { error: 'Escribí algo antes de enviar.' };
  if (text.length > MAX_TEXT) return { error: `El mensaje puede tener hasta ${MAX_TEXT} caracteres.` };
  if (/^lean$/i.test(name)) return { error: 'Ese nombre está reservado para Lean.' };
  return { name, text };
}

// In-memory sliding limiter: one message every RATE_MS per key (ip+name).
export function makeLimiter(rateMs = RATE_MS) {
  const last = new Map();
  return (key, now = Date.now()) => {
    const t = last.get(key) || 0;
    if (now - t < rateMs) return false;
    last.set(key, now);
    if (last.size > 2000) last.clear();
    return true;
  };
}

// Storage-agnostic room so it can run in a Durable Object (SQLite) or in memory (tests).
export class MemoryRoom {
  constructor() { this.rows = []; this.seq = 0; }
  add(m) { const row = { id: ++this.seq, ts: m.ts, author: m.author, kind: m.kind, text: m.text || '', photo: m.photo || null }; this.rows.push(row); if (this.rows.length > KEEP) this.rows.shift(); return row; }
  list(after = 0, limit = 100) { return this.rows.filter((r) => r.id > after).slice(-limit); }
  ids(limit = 100) { return this.rows.slice(-limit).map((r) => r.id); }
  remove(id) { this.rows = this.rows.filter((r) => r.id !== id); }
}

export function telegramPostFromOwner(msg) {
  // Returns {text, photo} for a non-command text/photo the owner sent to the bot, or null.
  if (msg.location) return null;
  const text = clean(msg.text ?? msg.caption ?? '');
  if (text.startsWith('/')) return null;
  const photo = Array.isArray(msg.photo) && msg.photo.length ? msg.photo[msg.photo.length - 1].file_id : null;
  if (!text && !photo) return null;
  return { text: text.slice(0, 1000), photo };
}
