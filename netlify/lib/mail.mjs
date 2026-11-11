/**
 * Ranking ATC — emails (Resend).
 * Sin RESEND_API_KEY no se envía nada: el email se escribe en el registro de la función (útil para pruebas).
 */
import { esc, siteUrl } from './core.mjs';

const NAVY = '#12294A', ORANGE = '#E35B2A', INK = '#0F1720', MUTED = '#546073', BG = '#FBFAF8', LINE = '#E0E2E8';

export async function send({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM || 'Ranking ATC <avisos@almunecartennisclub.com>';
  const replyTo = process.env.MAIL_REPLY_TO || 'info@almunecartennisclub.com';
  if (globalThis.__outbox) globalThis.__outbox.push({ to, subject, text, html });
  if (!key) { console.log(`[email sin enviar: falta RESEND_API_KEY] → ${to}: ${subject}`); return { skipped: true }; }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject, html, text }),
    });
    if (!r.ok) console.error('Resend error', r.status, await r.text());
    return { ok: r.ok };
  } catch (e) {
    console.error('Resend error', e);
    return { ok: false };
  }
}

/**
 * Plantilla común. blocks: { title, lines: [texto], highlight?: {big, small}, buttons: [{label, url, style}] , foot }
 */
export function layout({ title, lines = [], highlight, buttons = [], foot }) {
  const btn = (b) => {
    const primary = b.style !== 'ghost';
    return `<a href="${esc(b.url)}" style="display:inline-block;margin:4px 4px;padding:13px 22px;border-radius:999px;font-weight:700;font-size:15px;text-decoration:none;${primary ? `background:${b.style === 'navy' ? NAVY : ORANGE};color:#ffffff;` : `background:#ffffff;color:${INK};border:1.5px solid ${LINE};`}">${esc(b.label)}</a>`;
  };
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title></head>
<body style="margin:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid ${LINE}">
<tr><td align="center" style="background:${NAVY};padding:26px 24px">
<img src="${siteUrl()}/img/club-white.png" width="170" alt="Almuñécar Tennis Club" style="display:block;width:170px;height:auto;border:0">
<div style="margin-top:10px;font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#F7A27E">Ranking del club</div>
</td></tr>
<tr><td style="padding:28px 28px 8px">
<h1 style="margin:0 0 14px;font-size:22px;line-height:1.25;color:${INK}">${esc(title)}</h1>
${lines.map((l) => `<p style="margin:0 0 10px;font-size:16px;line-height:1.5;color:${INK}">${l}</p>`).join('')}
${highlight ? `<div style="margin:16px 0 6px;padding:16px 18px;border-radius:14px;background:#F3F4F7"><div style="font-size:20px;font-weight:700;color:${NAVY}">${highlight.big}</div>${highlight.small ? `<div style="margin-top:4px;font-size:14px;color:${MUTED}">${highlight.small}</div>` : ''}</div>` : ''}
</td></tr>
${buttons.length ? `<tr><td align="center" style="padding:14px 20px 8px">${buttons.map(btn).join('')}</td></tr>` : ''}
<tr><td style="padding:18px 28px 26px;font-size:12px;line-height:1.5;color:${MUTED}">${foot || ''}${foot ? '<br>' : ''}Puedes elegir qué avisos recibes en la app, en Perfil. · <a href="${siteUrl()}" style="color:${MUTED}">Abrir el ranking</a></td></tr>
</table></td></tr></table></body></html>`;
  const strip = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const text = [title, '', ...lines.map(strip), highlight ? `\n${strip(highlight.big)}${highlight.small ? ' — ' + strip(highlight.small) : ''}` : '', '',
    ...buttons.map((b) => `${b.label}: ${b.url}`), '', foot ? strip(foot) : '', siteUrl()].join('\n');
  return { html, text };
}

export function mail(to, subject, parts) {
  const { html, text } = layout({ title: subject, ...parts });
  return send({ to, subject, html, text });
}
