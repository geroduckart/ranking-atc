/**
 * Ranking ATC — utilidades del servidor: base de datos, PIN, sesiones, fechas.
 */
import postgres from 'postgres';
import crypto from 'node:crypto';

/* ── Base de datos ───────────────────────────────────────────────────── */
let _sql;
export function db() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta la variable DATABASE_URL en Netlify.');
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || url.includes('host=/');
  _sql = postgres(url, {
    prepare: false,              // necesario con el "Transaction pooler" de Supabase
    max: 8,                      // hasta 8 consultas a la vez: la ficha de un jugador lanza 7 en paralelo
    idle_timeout: 60,            // reutiliza la conexión entre peticiones seguidas (abrirla cuesta ~0,5 s)
    max_lifetime: 60 * 10,
    connect_timeout: 8,
    ssl: local ? false : 'require',
    // fechas y horas como texto, tal cual: '2026-11-14', '2026-11-14 10:30:00'
    types: { rawDates: { to: 1082, from: [1082, 1114], serialize: (x) => x, parse: (x) => x } },
  });
  return _sql;
}
/** Tira la conexión (por si el pooler la ha cortado) para que la siguiente se abra limpia. */
export function resetDb() {
  const old = _sql; _sql = null;
  if (old) old.end({ timeout: 1 }).catch(() => {});
}
const CONN_ERRORS = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'CONNECTION_CLOSED', 'CONNECTION_ENDED',
  'CONNECTION_DESTROYED', 'CONNECT_TIMEOUT', '57P01', '57P03', '08000', '08003', '08006', '08001', '08004']);
export const isConnError = (e) => !!e && (CONN_ERRORS.has(e.code) || /terminat|closed|timeout|ECONNRESET|socket/i.test(String(e.message || '')));

/* ── PIN ─────────────────────────────────────────────────────────────── */
export function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pin), salt, 32);
  return `s1$${salt.toString('base64')}$${h.toString('base64')}`;
}
export function checkPin(pin, stored) {
  const [v, s, h] = String(stored || '').split('$');
  if (v !== 's1' || !s || !h) return false;
  const got = crypto.scryptSync(String(pin), Buffer.from(s, 'base64'), 32);
  const want = Buffer.from(h, 'base64');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
export const validPin = (p) => /^\d{4}$/.test(String(p || ''));

/* ── Sesiones (token firmado) ────────────────────────────────────────── */
const SESSION_DAYS = 90;
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 24) throw new Error('Falta la variable SESSION_SECRET (mínimo 24 caracteres) en Netlify.');
  return s;
}
const b64u = (b) => Buffer.from(b).toString('base64url');
export function signSession(uid, v) {
  const body = b64u(JSON.stringify({ u: uid, v, e: Date.now() + SESSION_DAYS * 864e5 }));
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function readSession(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.e > Date.now() ? p : null;
  } catch { return null; }
}
export const randomToken = (n = 24) => crypto.randomBytes(n).toString('base64url');
export const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const sameStr = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

/* ── Fechas (hora del club: Europe/Madrid) ───────────────────────────── */
const TZ = 'Europe/Madrid';
/** 'YYYY-MM-DD HH:MM' en Madrid ahora mismo. */
export function madridNow(d = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(d).replace('T', ' ');
}
export const madridToday = (d) => madridNow(d).slice(0, 10);
const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** '2026-11-14 10:30:00' → 'sábado 14 de noviembre · 10:30' */
export function fmtWhen(ts, { withMonth = true } = {}) {
  const [d, t = ''] = String(ts).replace('T', ' ').split(' ');
  const dt = new Date(d + 'T12:00:00Z');
  const base = `${DAYS[dt.getUTCDay()]} ${dt.getUTCDate()}${withMonth ? ` de ${MONTHS[dt.getUTCMonth()]}` : ''}`;
  return t ? `${base} · ${t.slice(0, 5)}` : base;
}
export const fmtDay = (d) => fmtWhen(String(d).slice(0, 10));
export const fmtNum = (n, dec = 1) => Number(n).toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
export const signed = (n, dec = 1) => (n > 0 ? '+' : n < 0 ? '−' : '±') + fmtNum(Math.abs(n), dec);
export const ord = (n) => `${n}.º`;

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const firstName = (full) => String(full || '').trim().split(/\s+/)[0];
export const siteUrl = () => (process.env.SITE_URL || process.env.URL || 'http://localhost:8888').replace(/\/$/, '');
