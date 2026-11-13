/**
 * Ranking ATC — avisos por WhatsApp (Meta Cloud API).
 *
 * Solo se envía a quien dio su consentimiento en el alta (players.wa_consent)
 * y tiene móvil guardado. Sin WHATSAPP_TOKEN o WHATSAPP_PHONE_ID no se envía
 * nada: el aviso se escribe en el registro de la función, igual que los emails.
 *
 * Variables de entorno (Netlify):
 *   WHATSAPP_TOKEN      token permanente de la app de Meta
 *   WHATSAPP_PHONE_ID   Phone Number ID del número emisor
 *   WHATSAPP_API        opcional, por defecto v21.0
 */
import { fmtWhen, fmtDay, madridToday, firstName } from './core.mjs';
import { tr } from './i18n.mjs';

const ready = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);

/**
 * Móvil en E.164 sin el '+', como lo quiere Meta.
 * Nueve cifras que empiezan por 6, 7 o 9 se toman como España.
 */
export function waNumber(raw) {
  let s = String(raw || '').replace(/[\s().-]/g, '');
  if (/^00/.test(s)) s = '+' + s.slice(2);
  if (/^[679]\d{8}$/.test(s)) s = '+34' + s;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s.slice(1) : null;
}

/** El móvil al que escribir, o null si este jugador no debe recibir WhatsApp. */
export const waTo = (p) => (p && p.wa_consent === true ? waNumber(p.phone) : null);

/** Meta rechaza parámetros vacíos, con saltos de línea o con tabulaciones. */
const param = (v) => {
  const s = String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  return s || '—';
};

/**
 * Envía una plantilla aprobada.
 * @param {string} to      móvil en E.164 sin '+'
 * @param {string} name    nombre de la plantilla en Meta
 * @param {string} lang    'es' o 'en'
 * @param {string[]} vars  valores de {{1}}, {{2}}… en orden
 */
export async function sendTemplate(to, name, lang, vars = []) {
  if (!to) return { skipped: true };
  const parameters = vars.map((v) => ({ type: 'text', text: param(v) }));
  if (globalThis.__waOutbox) globalThis.__waOutbox.push({ to, name, lang, vars: parameters.map((p) => p.text) });
  if (!ready()) {
    console.log(`[whatsapp sin enviar: falta WHATSAPP_TOKEN o WHATSAPP_PHONE_ID] → ${to}: ${name} (${lang})`);
    return { skipped: true };
  }
  const url = `https://graph.facebook.com/${process.env.WHATSAPP_API || 'v21.0'}/${process.env.WHATSAPP_PHONE_ID}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name,
      language: { code: lang === 'en' ? 'en' : 'es' },
      ...(parameters.length ? { components: [{ type: 'body', parameters }] } : {}),
    },
  };
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const txt = await r.text();
      // 132001: la plantilla no existe en ese idioma. Se reintenta en español.
      if (lang !== 'es' && /132001|does not exist/i.test(txt)) return sendTemplate(to, name, 'es', vars);
      console.error('WhatsApp error', r.status, txt);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error('WhatsApp error', e);
    return { ok: false };
  }
}

/* ── Fechas y nombres en el idioma del jugador ───────────────────────── */
const lang = (p) => (p && p.lang === 'en' ? 'en' : 'es');
/** 'viernes 20 de noviembre · 18:00' → en inglés si toca, y con '·' en 'a las'. */
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const when = (ts, l) => {
  const s = fmtWhen(ts);
  return cap((l === 'en' ? tr(s, 'en') : s).replace(' · ', l === 'en' ? ' at ' : ' a las '));
};
/** Solo la fecha, sin hora: 'Viernes 20 de noviembre'. Acepta Date o texto. */
const day = (ts, l) => {
  const s = fmtDay(ts instanceof Date ? madridToday(ts) : ts);
  return cap(l === 'en' ? tr(s, 'en') : s);
};

/* ── Los cinco avisos ────────────────────────────────────────────────
   Cada uno comprueba el consentimiento por su cuenta: si el jugador no lo
   dio, la llamada no hace nada y el email sigue saliendo igual.          */

/** Alguien te ha retado. La tercera variable es la fecha límite para responder. */
export const waChallenge = (to, from, deadline) => {
  const l = lang(to);
  return sendTemplate(waTo(to), 'reto_recibido', l, [firstName(to.full_name), from.full_name, day(deadline, l)]);
};

/** Tu rival propone otra hora. */
export const waCounter = (to, from, playAt) => {
  const l = lang(to);
  return sendTemplate(waTo(to), 'nueva_hora', l, [firstName(to.full_name), from.full_name, when(playAt, l)]);
};

/** El reto se ha aceptado: ya hay partido. */
export const waConfirmed = (to, rival, playAt) => {
  const l = lang(to);
  return sendTemplate(waTo(to), 'partido_confirmado', l, [firstName(to.full_name), rival.full_name, when(playAt, l)]);
};

/** El día antes del partido. */
export const waReminder = (to, rival, playAt) => {
  const l = lang(to);
  const time = String(playAt).replace('T', ' ').split(' ')[1]?.slice(0, 5) || '';
  return sendTemplate(waTo(to), 'recordatorio_partido', l, [firstName(to.full_name), rival.full_name, time]);
};

/** Se ha publicado el cuadro de los Másters. */
export const waDraw = (to, tierName, rival) => {
  const l = lang(to);
  return sendTemplate(waTo(to), 'cuadro_publicado', l,
    [firstName(to.full_name), l === 'en' ? tr(tierName, 'en') : tierName, rival ? rival.full_name : (l === 'en' ? 'to be decided' : 'por decidir')]);
};
