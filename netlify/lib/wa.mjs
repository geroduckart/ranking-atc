/**
 * Ranking ATC — avisos por WhatsApp (Cloud API de Meta).
 *
 * Variables de entorno (Netlify): WHATSAPP_TOKEN y WHATSAPP_PHONE_ID.
 * Sin ellas no se envía nada: el aviso se escribe en el registro de la función.
 *
 * Solo se envía a quien tiene móvil y ha dado su consentimiento (wa_consent).
 * Idioma: el del jugador (players.lang). Si la plantilla en inglés aún no está
 * aprobada, se reintenta en español para que nadie se quede sin aviso.
 *
 * Plantillas (todas con 3 variables numéricas):
 *   reto_recibido        {{1}} nombre · {{2}} quien reta   · {{3}} fecha límite («viernes 20»)
 *   nueva_hora           {{1}} nombre · {{2}} rival        · {{3}} fecha y hora («sábado 21 a las 10:00»)
 *   partido_confirmado   {{1}} nombre · {{2}} rival        · {{3}} fecha y hora
 *   recordatorio_partido {{1}} nombre · {{2}} rival        · {{3}} hora («18:00»)
 *   cuadro_publicado     {{1}} nombre · {{2}} Máster       · {{3}} rival de primera ronda
 */
import { tr } from './i18n.mjs';

const API = 'https://graph.facebook.com/v21.0';
const TZ = 'Europe/Madrid';

const langOf = (p) => (p && p.lang === 'en' ? 'en' : 'es');
const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const shown = (p) => (p && (p.card_name || p.full_name)) || '';

// play_at llega como texto de Postgres («2026-11-20 17:00:00+00»): se pasa a ISO.
function toDate(v) {
  if (v instanceof Date) return v;
  const s = String(v || '').trim().replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function day(d, lang) {
  const loc = lang === 'en' ? 'en-GB' : 'es-ES';
  const wd = new Intl.DateTimeFormat(loc, { timeZone: TZ, weekday: 'long' }).format(d);
  const n = new Intl.DateTimeFormat(loc, { timeZone: TZ, day: 'numeric' }).format(d);
  return lang === 'en' ? `${wd} ${n}` : `${wd.toLowerCase()} ${n}`;
}
function hour(d) {
  return new Intl.DateTimeFormat('es-ES', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
function when(v, lang) {
  const d = toDate(v);
  if (!d) return lang === 'en' ? 'the agreed time' : 'la hora acordada';
  return lang === 'en' ? `${day(d, 'en')} at ${hour(d)}` : `${day(d, 'es')} a las ${hour(d)}`;
}

const CODE = { es: 'es', en: 'en' };

async function post(to, name, lang, vars) {
  const res = await fetch(`${API}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: String(to).replace(/^\+/, ''),
      type: 'template',
      template: {
        name,
        language: { code: CODE[lang] },
        components: [{ type: 'body', parameters: vars.map((t) => ({ type: 'text', text: String(t).slice(0, 200) })) }],
      },
    }),
  });
  if (res.ok) return { ok: true };
  let err = {};
  try { err = (await res.json()).error || {}; } catch (e) {}
  return { ok: false, code: err.code, msg: err.message || res.statusText };
}

async function send(p, name, varsFor) {
  if (!p || !p.phone || p.wa_consent !== true) return;
  const lang = langOf(p);
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) {
    console.log('[wa] sin credenciales, no se envía', name, lang, p.phone, varsFor(lang));
    return;
  }
  let r = await post(p.phone, name, lang, varsFor(lang));
  // 132001 = la plantilla no existe en ese idioma (o aún no está aprobada) → en español
  if (!r.ok && lang === 'en' && r.code === 132001) r = await post(p.phone, name, 'es', varsFor('es'));
  if (!r.ok) console.error('[wa] error', name, p.phone, r.code, r.msg);
}

/** Te han retado. deadline = fecha límite para responder (Date). */
export const waChallenge = (to, from, deadline) =>
  send(to, 'reto_recibido', (l) => [first(to.full_name), shown(from), day(toDate(deadline) || new Date(), l)]);

/** El rival propone otra hora. */
export const waCounter = (to, from, playAt) =>
  send(to, 'nueva_hora', (l) => [first(to.full_name), shown(from), when(playAt, l)]);

/** Partido confirmado. */
export const waConfirmed = (p, rival, playAt) =>
  send(p, 'partido_confirmado', (l) => [first(p.full_name), shown(rival), when(playAt, l)]);

/** Recordatorio el día antes: solo la hora. */
export const waReminder = (p, rival, playAt) =>
  send(p, 'recordatorio_partido', () => [first(p.full_name), shown(rival), toDate(playAt) ? hour(toDate(playAt)) : '--:--']);

/** Cuadro del Máster publicado. tname = «Máster Oro»…; rival puede faltar (exento). */
export const waDraw = (p, tname, rival) =>
  send(p, 'cuadro_publicado', (l) => [
    first(p.full_name),
    l === 'en' ? tr(tname, 'en') : tname,
    rival ? shown(rival) : l === 'en' ? 'to be decided' : 'por decidir',
  ]);
