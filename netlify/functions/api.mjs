/**
 * Ranking ATC — API (Netlify Function). Todas las rutas cuelgan de /api/...
 *
 * Cuentas:   POST signup · POST login · POST forgot · POST reset · GET me · POST me · POST pin · POST me/delete
 * Ranking:   GET ranking · GET player/:id · GET photo/:id
 * Retos:     GET retos · POST challenge · GET challenge/:id · POST challenge/:id/respond · POST challenge/:id/cancel
 *            POST challenge/:id/result
 * Partidos:  POST match/:id/confirm · POST match/:id/dispute · POST match/:id/withdraw
 * Tablón:    GET feed · POST feed/:id/comment · POST comment/:id/delete
 * Másters:   GET masters · POST masters/:id/result
 * Email:     GET/POST act (botones de un toque de los emails)
 * Admin:     GET admin · POST admin/player/:id · POST admin/player/:id/delete · POST admin/match/:id
 *            POST admin/post · POST admin/feed/:id/delete · POST admin/season
 *            POST admin/masters/generate · POST admin/masters/reset · GET admin/export
 */
import * as R from '../lib/rules.mjs';
import {
  db, hashPin, checkPin, validPin, signSession, readSession, randomToken, sha, sameStr,
  madridNow, madridToday, fmtWhen, fmtDay, fmtNum, signed, ord, esc, firstName, siteUrl,
} from '../lib/core.mjs';
import { mail, layout } from '../lib/mail.mjs';

export const config = { path: '/api/*' };

const OPEN_LIMIT = 5;            // retos pendientes que puede tener abiertos un jugador
const COUNTER_LIMIT = 3;         // contrapropuestas de hora por reto
const FREE_REJECTS = 2;          // rechazos libres al mes
const CHALLENGE_DAYS = 7;        // caducidad de un reto
const LOCK_FAILS = 5, LOCK_MIN = 15;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (msg, status = 400) => { throw new HttpError(status, msg); };
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
const html = (body, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

/* ════════════════════════════════════════════════════════════════════
   Router
   ════════════════════════════════════════════════════════════════════ */
const routes = [];
const on = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:id/g, '([^/]+)') + '$'), fn });

export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/(\.netlify\/functions\/api|api)\/?/, '').replace(/\/$/, '');
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = path.match(r.re);
    if (!m) continue;
    const out = [];   // emails a enviar cuando todo haya ido bien
    try {
      let body = {};
      if (method === 'POST') {
        const ct = req.headers.get('content-type') || '';
        if (ct.includes('application/x-www-form-urlencoded')) body = Object.fromEntries(new URLSearchParams(await req.text()));
        else { const t = await req.text(); body = t ? JSON.parse(t) : {}; }
      }
      const res = await r.fn({ req, url, body, params: m.slice(1).map(decodeURIComponent), out });
      await flush(out);
      return res instanceof Response ? res : json(res ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (e instanceof SyntaxError) return json({ error: 'Petición no válida.' }, 400);
      console.error(e);
      return json({ error: 'Error del servidor. Inténtalo de nuevo en un momento.' }, 500);
    }
  }
  return json({ error: 'No encontrado.' }, 404);
}
async function flush(out) {
  for (const f of out) { try { await f(); } catch (e) { console.error('email', e); } }
}

/* ════════════════════════════════════════════════════════════════════
   Ayudas
   ════════════════════════════════════════════════════════════════════ */
async function auth(req, { admin = false } = {}) {
  const h = req.headers.get('authorization') || '';
  const s = readSession(h.replace(/^Bearer\s+/i, ''));
  if (!s || !UUID.test(s.u)) fail('Tu sesión ha caducado. Vuelve a entrar.', 401);
  const [p] = await db()`select * from players where id = ${s.u}`;
  if (!p || !p.active || p.session_v !== s.v) fail('Tu sesión ha caducado. Vuelve a entrar.', 401);
  if (admin && !p.is_admin) fail('Solo para el administrador del club.', 403);
  return p;
}
const wants = (p, key) => !(p.notify && p.notify[key] === false);
const ageOf = (p) => R.ageOn(p.birth_date, new Date(madridToday() + 'T12:00:00Z'));
const isMinor = (p) => ageOf(p) < 18;
const checkId = (id) => { if (!UUID.test(id)) fail('Jugador no encontrado.', 404); return id; };
const checkNum = (id) => { if (!/^\d{1,12}$/.test(id)) fail('No encontrado.', 404); return Number(id); };
async function season(sql = db()) { const [s] = await sql`select * from season where id = 1`; return s; }

function selfView(p) {
  return {
    id: p.id, username: p.username, full_name: p.full_name, email: p.email, birth_date: p.birth_date,
    hand: p.hand, backhand: p.backhand, level: Number(p.level), start_level: Number(p.start_level),
    attrs: R.shownAttrs(p.attrs, p.start_level, p.level), photo_v: p.photo_v, is_admin: p.is_admin,
    notify: { challenges: wants(p, 'challenges'), results: wants(p, 'results'), drop: wants(p, 'drop'), reminders: wants(p, 'reminders') },
    minor: isMinor(p),
  };
}

/** Recalcula niveles y puntos repitiendo todos los partidos confirmados. */
async function recompute(sql) {
  const players = await sql`select id, start_level from players`;
  const ms = await sql`select id, p1, p2, winner, sets, walkover, master_id, played_on
                       from matches where status = 'confirmed' order by played_on, confirmed_at, id`;
  const { level, perMatch } = R.replay(players, ms);
  const lv = players.map((p) => ({ id: p.id, level: String(level[p.id]) }));
  if (lv.length) {
    await sql`update players set level = v.level::numeric from (values ${sql(lv.map((x) => [x.id, x.level]))}) as v(id, level)
              where players.id = v.id::uuid and players.level <> v.level::numeric`;
  }
  const pm = Object.entries(perMatch).map(([id, x]) => [id, x.p1_before, x.p1_after, x.p2_before, x.p2_after, x.p1_pts, x.p2_pts].map(String));
  if (pm.length) {
    await sql`update matches set p1_before = v.a::numeric, p1_after = v.b::numeric, p2_before = v.c::numeric, p2_after = v.d::numeric,
              p1_pts = v.e::int, p2_pts = v.f::int
              from (values ${sql(pm)}) as v(id, a, b, c, d, e, f) where matches.id = v.id::bigint`;
  }
}

/** Clasificación actual + nº de partidos de cada jugador (para «provisional»). */
async function standings(sql = db()) {
  const S = await season(sql);
  const players = await sql`select id, full_name, username, level, photo_v from players where active`;
  const ms = await sql`select id, p1, p2, winner, master_id, p1_pts, p2_pts from matches where status = 'confirmed'`;
  const count = {};
  for (const m of ms) { count[m.p1] = (count[m.p1] || 0) + 1; count[m.p2] = (count[m.p2] || 0) + 1; }
  const st = R.standings(players.map((p) => ({ ...p, level: Number(p.level) })), ms, S.min_matches);
  for (const r of [...st.qualified, ...st.others]) r.provisional = (count[r.id] || 0) < R.PROV_MATCHES;
  return { S, ...st, count };
}
const posMap = (st) => Object.fromEntries(st.qualified.map((r) => [r.id, r.pos]));

function stakes(me, meCount, rv, rvCount) {
  const K = meCount < R.PROV_MATCHES ? R.K_PROV : R.K_NORMAL;
  const E = R.expected(Number(me.level), Number(rv.level));
  const bonus = meCount >= R.PROV_MATCHES && rvCount >= R.PROV_MATCHES && Number(rv.level) - Number(me.level) >= R.BONUS_GAP;
  return { win: K * (1 - E), loss: -K * E, ptsWin: R.PTS_WIN + (bonus ? R.PTS_BONUS : 0), ptsLoss: R.PTS_LOSS };
}
const stakesLine = (s) => `Si ganas: ${signed(s.win)} nivel · +${s.ptsWin} pts. Si pierdes: ${signed(s.loss)} nivel · +${s.ptsLoss} pt.`;

function checkWhen(date, time, S, { allowToday = true } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) fail('Elige el día.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || ''))) fail('Elige la hora.');
  const now = madridNow();
  const at = `${date} ${time}`;
  if (at <= now) fail('Esa fecha ya ha pasado.');
  if (!allowToday && date === now.slice(0, 10)) fail('Elige otro día.');
  if (date > String(S.ends_on)) fail(`La fase regular termina el ${fmtDay(S.ends_on)}. Elige un día antes.`);
  if (date > addDays(now.slice(0, 10), 30)) fail('Elige un día dentro del próximo mes.');
  return at;
}
function addDays(day, n) { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

const actUrl = (kind, id, token, a) => `${siteUrl()}/api/act?t=${encodeURIComponent(`${kind}.${id}.${token}`)}&a=${a}`;
const appUrl = (hash) => `${siteUrl()}/#/${hash}`;

/* Jugadores por id, en un mapa */
async function playersById(sql, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return {};
  const rows = await sql`select * from players where id in ${sql(list)}`;
  return Object.fromEntries(rows.map((p) => [p.id, p]));
}

/* ════════════════════════════════════════════════════════════════════
   Cuentas
   ════════════════════════════════════════════════════════════════════ */
on('POST', 'signup', async ({ body }) => {
  const sql = db();
  const full_name = String(body.full_name || '').trim().replace(/\s+/g, ' ');
  const username = String(body.username || '').trim().toLowerCase();
  const email = String(body.email || '').trim().toLowerCase();
  if (full_name.length < 3 || full_name.length > 60) fail('Escribe tu nombre y apellidos.');
  if (!/^[a-z0-9._]{3,20}$/.test(username)) fail('El usuario debe tener de 3 a 20 letras, números, puntos o guiones bajos, sin espacios.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) fail('Revisa el email.');
  if (!validPin(body.pin)) fail('El PIN tiene que tener 6 cifras.');
  if (/^(\d)\1{5}$/.test(body.pin) || ['123456', '654321', '012345'].includes(body.pin)) fail('Ese PIN es demasiado fácil. Elige otro.');
  const age = R.ageOn(String(body.birth_date || ''), new Date(madridToday() + 'T12:00:00Z'));
  if (!Number.isFinite(age) || age > 100) fail('Revisa tu fecha de nacimiento.');
  if (age < 14) fail('Para apuntarte al ranking hay que tener al menos 14 años.');
  if (body.accept !== true) fail('Tienes que aceptar la política de privacidad y las normas.');
  const hand = body.hand === 'zurdo' ? 'zurdo' : 'diestro';
  const backhand = body.backhand === 'una' ? 'una' : 'dos';
  const attrs = R.checkAttrs(body.attrs);
  if (!attrs) fail('Valora cada golpe entre 30 y 99.');
  const lvl = R.levelFromAttrs(attrs);
  const [dupU] = await sql`select 1 from players where username = ${username}`;
  if (dupU) fail('Ese usuario ya existe. Prueba con otro.');
  const [dupE] = await sql`select 1 from players where email = ${email}`;
  if (dupE) fail('Ya hay una cuenta con ese email. Si es tuya, recupera tu PIN.');
  const isAdmin = (process.env.ADMIN_USERNAME || '').toLowerCase().split(',').map((s) => s.trim()).includes(username);
  const [p] = await sql`insert into players (username, full_name, email, pin_hash, birth_date, hand, backhand, attrs, start_level, level, is_admin)
    values (${username}, ${full_name}, ${email}, ${hashPin(body.pin)}, ${body.birth_date}, ${hand}, ${backhand}, ${sql.json(attrs)}, ${lvl}, ${lvl}, ${isAdmin})
    returning *`;
  await sql`insert into feed (kind, actor, data) values ('new_player', ${p.id}, ${sql.json({ level: lvl })})`;
  return { token: signSession(p.id, p.session_v), me: selfView(p) };
});

on('POST', 'login', async ({ body }) => {
  const sql = db();
  const username = String(body.username || '').trim().toLowerCase();
  const [p] = await sql`select * from players where username = ${username}`;
  if (p && p.locked_until && new Date(p.locked_until) > new Date()) {
    const min = Math.ceil((new Date(p.locked_until) - Date.now()) / 60000);
    fail(`Demasiados intentos. Prueba otra vez dentro de ${min} min o recupera tu PIN.`, 429);
  }
  const ok = p && checkPin(String(body.pin || ''), p.pin_hash);
  if (!ok) {
    if (p) {
      const fails = p.failed_logins + 1;
      if (fails >= LOCK_FAILS) await sql`update players set failed_logins = 0, locked_until = now() + ${LOCK_MIN + ' minutes'}::interval where id = ${p.id}`;
      else await sql`update players set failed_logins = ${fails} where id = ${p.id}`;
    }
    fail('Usuario o PIN incorrectos.', 401);
  }
  if (!p.active) fail('Esta cuenta está desactivada. Habla con el club.', 403);
  await sql`update players set failed_logins = 0, locked_until = null where id = ${p.id}`;
  return { token: signSession(p.id, p.session_v), me: selfView(p) };
});

on('POST', 'forgot', async ({ body, out }) => {
  const sql = db();
  const who = String(body.who || '').trim().toLowerCase();
  if (!who) fail('Escribe tu usuario o tu email.');
  const [p] = await sql`select * from players where (username = ${who} or email = ${who}) and active`;
  if (p) {
    const raw = randomToken();
    await sql`update players set reset_hash = ${sha(raw)}, reset_expires = now() + interval '1 hour' where id = ${p.id}`;
    out.push(() => mail(p.email, 'Crea un PIN nuevo', {
      lines: [`Hola ${esc(firstName(p.full_name))}: alguien (seguramente tú) ha pedido cambiar el PIN de <b>${esc(p.username)}</b>.`,
        'Pulsa el botón para elegir uno nuevo. El enlace vale durante 1 hora.'],
      buttons: [{ label: 'Crear PIN nuevo', url: appUrl(`reset?t=${raw}`) }],
      foot: 'Si no lo has pedido tú, ignora este email: tu PIN no cambia.',
    }));
  }
  return { ok: true };
});

on('POST', 'reset', async ({ body }) => {
  const sql = db();
  if (!validPin(body.pin)) fail('El PIN tiene que tener 6 cifras.');
  const [p] = await sql`select * from players where reset_hash = ${sha(String(body.token || ''))} and reset_expires > now() and active`;
  if (!p) fail('El enlace ha caducado o ya se ha usado. Pide otro.');
  const [u] = await sql`update players set pin_hash = ${hashPin(body.pin)}, session_v = session_v + 1, reset_hash = null,
    reset_expires = null, failed_logins = 0, locked_until = null where id = ${p.id} returning *`;
  return { token: signSession(u.id, u.session_v), me: selfView(u) };
});

on('GET', 'me', async ({ req }) => {
  const p = await auth(req);
  const sql = db();
  const S = await season(sql);
  const [todo] = await sql`select
      (select count(*) from challenges where status = 'pending' and proposed_by <> ${p.id} and (challenger = ${p.id} or challenged = ${p.id}))::int as respond,
      (select count(*) from matches where status = 'pending' and reported_by <> ${p.id} and (p1 = ${p.id} or p2 = ${p.id}))::int as confirm,
      (select count(*) from challenges c where c.status = 'accepted' and (c.challenger = ${p.id} or c.challenged = ${p.id})
         and c.play_at::date <= ${madridToday()}::date
         and not exists (select 1 from matches m where m.challenge_id = c.id and m.status in ('pending','confirmed','disputed')))::int as report`;
  return { me: selfView(p), season: seasonView(S), todo: todo.respond + todo.confirm + todo.report };
});
function seasonView(S) {
  const today = madridToday();
  // días de la temporada completa: fase regular + Másters
  const total = Math.round((new Date(S.masters_end) - new Date(S.starts_on)) / 864e5) + 1;
  const day = Math.round((new Date(today) - new Date(S.starts_on)) / 864e5) + 1;
  return { name: S.name, starts_on: S.starts_on, ends_on: S.ends_on, masters_end: S.masters_end, phase: S.phase, min_matches: S.min_matches,
    day: Math.max(0, Math.min(day, total)), total, started: today >= S.starts_on, regularOver: today > S.ends_on };
}

on('POST', 'me', async ({ req, body }) => {
  const p = await auth(req);
  const sql = db();
  const upd = {};
  if (body.hand) upd.hand = body.hand === 'zurdo' ? 'zurdo' : 'diestro';
  if (body.backhand) upd.backhand = body.backhand === 'una' ? 'una' : 'dos';
  if (body.notify && typeof body.notify === 'object') {
    upd.notify = {};
    for (const k of ['challenges', 'results', 'drop', 'reminders']) upd.notify[k] = body.notify[k] !== false;
  }
  if ('photo' in body) {
    if (body.photo === null) { upd.photo = null; }
    else {
      const ph = String(body.photo);
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(ph) || ph.length > 150000) fail('La foto no es válida o es demasiado grande.');
      upd.photo = ph;
    }
  }
  if (!Object.keys(upd).length) return { me: selfView(p) };
  const [u] = await sql`update players set ${sql(upd)}, photo_v = photo_v + ${'photo' in upd ? 1 : 0} where id = ${p.id} returning *`;
  return { me: selfView(u) };
});

on('POST', 'pin', async ({ req, body }) => {
  const p = await auth(req);
  if (!checkPin(String(body.old || ''), p.pin_hash)) fail('El PIN actual no es correcto.');
  if (!validPin(body.pin)) fail('El PIN nuevo tiene que tener 6 cifras.');
  const [u] = await db()`update players set pin_hash = ${hashPin(body.pin)}, session_v = session_v + 1 where id = ${p.id} returning *`;
  return { token: signSession(u.id, u.session_v), me: selfView(u) };
});

on('POST', 'me/delete', async ({ req, body }) => {
  const p = await auth(req);
  if (!checkPin(String(body.pin || ''), p.pin_hash)) fail('El PIN no es correcto.');
  await anonymize(db(), p.id);
  return { ok: true };
});
/** Borra los datos personales. Los partidos se quedan (cuentan para los rivales) con el nombre «Jugador eliminado». */
async function anonymize(sql, id) {
  await sql.begin(async (tx) => {
    await tx`update challenges set status = 'cancelled', updated_at = now() where status in ('pending','accepted') and (challenger = ${id} or challenged = ${id})`;
    await tx`update players set full_name = 'Jugador eliminado', username = ${'eliminado_' + id.slice(0, 8)}, email = ${'eliminado-' + id + '@invalid'},
      pin_hash = 'deleted', photo = null, active = false, session_v = session_v + 1, notify = '{}'::jsonb,
      birth_date = '1900-01-01', reset_hash = null where id = ${id}`;
    await tx`delete from comments where author = ${id}`;
    await tx`delete from feed where actor = ${id} and kind in ('new_player','admin')`;
  });
}

/* ════════════════════════════════════════════════════════════════════
   Ranking y perfiles
   ════════════════════════════════════════════════════════════════════ */
const rowView = (r) => ({ id: r.id, full_name: r.full_name, username: r.username, level: r.level, photo_v: r.photo_v,
  pts: r.pts, pj: r.pj, won: r.won, pos: r.pos, zone: r.zone, missing: r.missing ?? 0, provisional: r.provisional });

on('GET', 'ranking', async ({ req }) => {
  await auth(req);
  const st = await standings();
  return { season: seasonView(st.S), qualified: st.qualified.map(rowView), others: st.others.map(rowView) };
});

on('GET', 'player/:id', async ({ req, params }) => {
  const me = await auth(req);
  const id = checkId(params[0]);
  const sql = db();
  const [p] = await sql`select * from players where id = ${id}`;
  if (!p || (!p.active && !me.is_admin)) fail('Jugador no encontrado.', 404);
  const st = await standings(sql);
  const row = [...st.qualified, ...st.others].find((r) => r.id === id) || { pts: 0, pj: 0, won: 0, pos: null, zone: null, missing: st.S.min_matches };
  const recent = await sql`select m.id, m.p1, m.p2, m.winner, m.sets, m.walkover, m.played_on, m.master_id,
      m.p1_before, m.p1_after, m.p2_before, m.p2_after, a.full_name as n1, b.full_name as n2
    from matches m join players a on a.id = m.p1 join players b on b.id = m.p2
    where m.status = 'confirmed' and (m.p1 = ${id} or m.p2 = ${id}) order by m.played_on desc, m.id desc limit 10`;
  const out = {
    player: {
      id: p.id, full_name: p.full_name, username: p.username, hand: p.hand, backhand: p.backhand,
      level: Number(p.level), start_level: Number(p.start_level), attrs: R.shownAttrs(p.attrs, p.start_level, p.level),
      photo_v: p.photo_v, since: String(p.created_at.toISOString?.() || p.created_at).slice(0, 10),
      pos: row.pos, zone: row.zone, pts: row.pts, pj: row.pj, won: row.won, missing: row.missing ?? 0,
      provisional: (st.count[id] || 0) < R.PROV_MATCHES, matches_total: st.count[id] || 0,
    },
    recent: recent.map((m) => {
      const mine = m.p1 === id;
      return { id: m.id, rival: mine ? m.n2 : m.n1, rival_id: mine ? m.p2 : m.p1, won: m.winner === id,
        score: R.fmtSets(m.sets, !mine), walkover: m.walkover, played_on: m.played_on, master: !!m.master_id,
        delta: Number(mine ? m.p1_after - m.p1_before : m.p2_after - m.p2_before) };
    }),
    season: seasonView(st.S),
  };
  if (id !== me.id) {
    const [pair] = await sql`select
        (select count(*) from matches where master_id is null and status in ('pending','confirmed','disputed')
           and ((p1 = ${me.id} and p2 = ${id}) or (p1 = ${id} and p2 = ${me.id})))::int as played,
        (select id from challenges where status in ('pending','accepted')
           and ((challenger = ${me.id} and challenged = ${id}) or (challenger = ${id} and challenged = ${me.id})) limit 1) as open_id`;
    out.vs = {
      pairLeft: Math.max(0, R.PAIR_CAP - pair.played - (pair.open_id ? 1 : 0)),
      openChallenge: pair.open_id ? Number(pair.open_id) : null,
      stakes: stakes(me, st.count[me.id] || 0, p, st.count[id] || 0),
      noMessage: isMinor(me) || isMinor(p),
      canChallenge: p.active && st.S.phase === 'regular',
    };
  }
  return out;
});

on('GET', 'photo/:id', async ({ params }) => {
  const id = checkId(params[0]);
  const [p] = await db()`select photo from players where id = ${id}`;
  if (!p || !p.photo) return new Response('', { status: 404 });
  const [, mime, data] = p.photo.match(/^data:(image\/[a-z]+);base64,(.+)$/) || [];
  if (!data) return new Response('', { status: 404 });
  return new Response(Buffer.from(data, 'base64'), { headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=31536000, immutable' } });
});

/* ════════════════════════════════════════════════════════════════════
   Retos
   ════════════════════════════════════════════════════════════════════ */
const CH_SELECT = (sql) => sql`select c.*, c.play_at::text as play_at, a.full_name as challenger_name, b.full_name as challenged_name
  from challenges c join players a on a.id = c.challenger join players b on b.id = c.challenged`;

on('POST', 'challenge', async ({ req, body, out }) => {
  const me = await auth(req);
  const sql = db();
  const S = await season(sql);
  if (S.phase !== 'regular') fail('La fase regular ha terminado: ya no se pueden crear retos.');
  if (madridToday() < String(S.starts_on)) fail(`La temporada empieza el ${fmtDay(S.starts_on)}.`);
  const to = checkId(String(body.to || ''));
  if (to === me.id) fail('No puedes retarte a ti mismo.');
  const at = checkWhen(body.date, body.time, S);
  const [rv] = await sql`select * from players where id = ${to} and active`;
  if (!rv) fail('Ese jugador no está disponible.');
  let message = String(body.message || '').trim().slice(0, 200) || null;
  if (isMinor(me) || isMinor(rv)) message = null;
  const ch = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${[me.id, to].sort().join('|')}))`;
    const [chk] = await tx`select
        (select count(*) from challenges where status in ('pending','accepted')
          and ((challenger = ${me.id} and challenged = ${to}) or (challenger = ${to} and challenged = ${me.id})))::int as open,
        (select count(*) from matches where master_id is null and status in ('pending','confirmed','disputed')
          and ((p1 = ${me.id} and p2 = ${to}) or (p1 = ${to} and p2 = ${me.id})))::int as played,
        (select count(*) from challenges where status = 'pending' and challenger = ${me.id})::int as mine`;
    if (chk.open) fail(`Ya tienes un reto abierto con ${firstName(rv.full_name)}.`);
    if (chk.played >= R.PAIR_CAP) fail(`Ya habéis jugado ${R.PAIR_CAP} partidos esta temporada, el máximo por pareja.`);
    if (chk.mine >= OPEN_LIMIT) fail(`Tienes ${OPEN_LIMIT} retos esperando respuesta. Espera a que te contesten.`);
    const [c] = await tx`insert into challenges (challenger, challenged, play_at, proposed_by, message, token)
      values (${me.id}, ${to}, ${at}, ${me.id}, ${message}, ${randomToken()}) returning *, play_at::text as play_at`;
    await tx`insert into feed (kind, actor, target, data) values ('challenge', ${me.id}, ${to}, ${tx.json({ challenge: c.id })})`;
    return c;
  });
  if (wants(rv, 'challenges')) {
    const st = await standings(sql);
    out.push(() => challengeMail(ch, rv, me, st, false));
  }
  return { challenge: { id: Number(ch.id) } };
});

function challengeMail(c, to, from, st, isCounter, reminder = false) {
  const s = stakes(to, st.count[to.id] || 0, from, st.count[from.id] || 0);
  const fn = esc(from.full_name);
  return mail(to.email, (reminder ? 'Recordatorio: ' : '') + (isCounter ? `${firstName(from.full_name)} propone otra hora` : `${from.full_name} te ha retado`), {
    lines: [isCounter ? `<b>${fn}</b> no puede a la hora que dijiste y propone otra:` : `<b>${fn}</b> (nivel ${Math.round(from.level)}) quiere jugar contigo:`,
      c.message ? `«${esc(c.message)}»` : ''].filter(Boolean),
    highlight: { big: esc(cap(fmtWhen(c.play_at))), small: stakesLine(s) },
    buttons: [
      { label: 'Acepto', url: actUrl('c', c.id, c.token, 'accept') },
      { label: 'Otra hora', url: appUrl(`reto/${c.id}`), style: 'ghost' },
      { label: 'No puedo', url: actUrl('c', c.id, c.token, 'reject'), style: 'ghost' },
    ],
    foot: `Si aceptas, reservad pista en el club. El reto caduca a los ${CHALLENGE_DAYS} días si nadie responde.`,
  });
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

on('GET', 'retos', async ({ req }) => {
  const me = await auth(req);
  const sql = db();
  const S = await season(sql);
  const chs = await sql`select c.id, c.challenger, c.challenged, c.play_at::text as play_at, c.proposed_by, c.counters, c.message, c.status,
      c.walkover, c.updated_at, a.full_name as challenger_name, b.full_name as challenged_name, a.photo_v as challenger_pv, b.photo_v as challenged_pv,
      m.id as match_id, m.status as match_status, m.sets as match_sets, m.reported_by as match_reporter, m.winner as match_winner
    from challenges c join players a on a.id = c.challenger join players b on b.id = c.challenged
    left join lateral (select * from matches mm where mm.challenge_id = c.id and mm.status <> 'annulled' order by mm.id desc limit 1) m on true
    where (c.challenger = ${me.id} or c.challenged = ${me.id})
      and (c.status in ('pending','accepted') or c.updated_at > now() - interval '14 days')
    order by c.play_at`;
  const today = madridToday();
  const challenges = chs.map((c) => {
    const iAmChallenger = c.challenger === me.id;
    return {
      id: Number(c.id), status: c.status, play_at: c.play_at, message: c.message, counters: c.counters, walkover: c.walkover,
      rival: { id: iAmChallenger ? c.challenged : c.challenger, name: iAmChallenger ? c.challenged_name : c.challenger_name, photo_v: iAmChallenger ? c.challenged_pv : c.challenger_pv },
      iAmChallenger, myTurn: c.status === 'pending' && c.proposed_by !== me.id,
      canReport: c.status === 'accepted' && c.play_at.slice(0, 10) <= today && !c.match_id && S.phase === 'regular',
      match: c.match_id ? { id: Number(c.match_id), status: c.match_status, score: R.fmtSets(c.match_sets, !iAmChallenger),
        iReported: c.match_reporter === me.id, iWon: c.match_winner === me.id } : null,
    };
  });
  // Partidos de los Másters donde me toca jugar o confirmar
  const nodes = await sql`select n.*, a.full_name as n1, b.full_name as n2,
      m.id as match_id, m.status as match_status, m.sets as match_sets, m.reported_by as match_reporter, m.winner as match_winner
    from masters n left join players a on a.id = n.p1 left join players b on b.id = n.p2
    left join lateral (select * from matches mm where mm.master_id = n.id and mm.status <> 'annulled' order by mm.id desc limit 1) m on true
    where n.winner is null and n.p1 is not null and n.p2 is not null and (n.p1 = ${me.id} or n.p2 = ${me.id})`;
  const rounds = await masterRounds(sql);
  const masters = nodes.map((n) => {
    const mine1 = n.p1 === me.id;
    return { id: Number(n.id), tier: n.tier, round: R.roundName(n.round, rounds[n.tier]),
      rival: { id: mine1 ? n.p2 : n.p1, name: mine1 ? n.n2 : n.n1 },
      match: n.match_id ? { id: Number(n.match_id), status: n.match_status, score: R.fmtSets(n.match_sets, !mine1), iReported: n.match_reporter === me.id, iWon: n.match_winner === me.id } : null };
  });
  return { challenges, masters, season: seasonView(S), rejectsLeft: Math.max(0, FREE_REJECTS - (await rejectsThisMonth(sql, me.id))) };
});

on('GET', 'challenge/:id', async ({ req, params }) => {
  const me = await auth(req);
  const sql = db();
  const id = checkNum(params[0]);
  const [c] = await sql`${CH_SELECT(sql)} where c.id = ${id}`;
  if (!c || (c.challenger !== me.id && c.challenged !== me.id)) fail('Reto no encontrado.', 404);
  const iAmChallenger = c.challenger === me.id;
  return {
    challenge: {
      id: Number(c.id), status: c.status, play_at: c.play_at, message: c.message, counters: c.counters,
      rival: { id: iAmChallenger ? c.challenged : c.challenger, name: iAmChallenger ? c.challenged_name : c.challenger_name },
      iAmChallenger, myTurn: c.status === 'pending' && c.proposed_by !== me.id,
      countersLeft: COUNTER_LIMIT - c.counters,
      rejectIsWalkover: !iAmChallenger && c.status === 'pending' && (await rejectsThisMonth(sql, me.id)) >= FREE_REJECTS,
      rejectsLeft: iAmChallenger ? null : Math.max(0, FREE_REJECTS - (await rejectsThisMonth(sql, me.id))),
    },
  };
});
async function rejectsThisMonth(sql, pid) {
  const [r] = await sql`select count(*)::int as n from challenges where challenged = ${pid} and responded_by = ${pid}
    and (status = 'rejected' or (status = 'done' and walkover))
    and date_trunc('month', updated_at at time zone 'Europe/Madrid') = date_trunc('month', now() at time zone 'Europe/Madrid')`;
  return r.n;
}

on('POST', 'challenge/:id/respond', async ({ req, params, body, out }) => {
  const me = await auth(req);
  return respond(db(), checkNum(params[0]), me, String(body.action || ''), body, out);
});

async function respond(sql, id, me, action, body, out) {
  const S = await season(sql);
  let result;
  await sql.begin(async (tx) => {
    const [c] = await tx`select *, play_at::text as play_at from challenges where id = ${id} for update`;
    if (!c || (c.challenger !== me.id && c.challenged !== me.id)) fail('Reto no encontrado.', 404);
    if (c.status === 'pending' && new Date(c.created_at) < new Date(Date.now() - CHALLENGE_DAYS * 864e5)) {
      await tx`update challenges set status = 'expired', updated_at = now() where id = ${id}`;
      fail('Este reto ha caducado.');
    }
    if (c.status !== 'pending') fail(c.status === 'accepted' ? 'Este reto ya está aceptado.' : 'Este reto ya no está abierto.');
    if (c.proposed_by === me.id) fail('Te toca esperar a que responda tu rival.');
    const P = await playersById(tx, [c.challenger, c.challenged]);
    const other = P[c.challenger === me.id ? c.challenged : c.challenger];
    if (action === 'accept') {
      await tx`update challenges set status = 'accepted', responded_by = ${me.id}, updated_at = now() where id = ${id}`;
      await tx`insert into feed (kind, actor, target, data) values ('accepted', ${c.challenger}, ${c.challenged}, ${tx.json({ challenge: c.id, play_at: c.play_at })})`;
      for (const p of [P[c.challenger], P[c.challenged]]) {
        if (!wants(p, 'challenges')) continue;
        const rival = p.id === c.challenger ? P[c.challenged] : P[c.challenger];
        out.push(() => mail(p.email, `Partido confirmado con ${firstName(rival.full_name)}`, {
          lines: [`Jugáis <b>${esc(firstName(P[c.challenger].full_name))}</b> contra <b>${esc(firstName(P[c.challenged].full_name))}</b>:`],
          highlight: { big: esc(cap(fmtWhen(c.play_at))), small: 'Almuñécar Tennis Club. Reservad pista en el club.' },
          buttons: [{ label: 'Ver el reto', url: appUrl('retos') }],
          foot: 'Después del partido, uno de los dos pone el resultado en la app y el otro lo confirma.',
        }));
      }
      result = { status: 'accepted' };
    } else if (action === 'counter') {
      if (c.counters >= COUNTER_LIMIT) fail('Ya habéis cambiado la hora 3 veces. Habladlo directamente y que uno cree un reto nuevo.');
      const at = checkWhen(body.date, body.time, S);
      const [u] = await tx`update challenges set play_at = ${at}, proposed_by = ${me.id}, counters = counters + 1, token = ${randomToken()},
        reminded = false, updated_at = now() where id = ${id} returning *, play_at::text as play_at`;
      if (wants(other, 'challenges')) {
        const st = await standings(tx);
        out.push(() => challengeMail(u, other, me, st, true));
      }
      result = { status: 'pending' };
    } else if (action === 'reject') {
      if (me.id === c.challenger) {
        await tx`update challenges set status = 'cancelled', responded_by = ${me.id}, updated_at = now() where id = ${id}`;
        if (wants(other, 'challenges')) out.push(() => mail(other.email, `${firstName(me.full_name)} no puede a esa hora`, {
          lines: [`<b>${esc(me.full_name)}</b> no puede jugar a la hora que propusiste y el reto se ha cancelado.`, 'Podéis crear otro reto cuando queráis.'],
          buttons: [{ label: 'Abrir el ranking', url: appUrl('') }],
        }));
        result = { status: 'cancelled' };
      } else if (S.phase === 'regular' && (await rejectsThisMonth(tx, me.id)) >= FREE_REJECTS) {
        // Tercer rechazo del mes: el partido se da por perdido 6-0 6-0
        await tx`update challenges set status = 'done', walkover = true, responded_by = ${me.id}, updated_at = now() where id = ${id}`;
        const [m] = await tx`insert into matches (challenge_id, p1, p2, sets, winner, walkover, reported_by, status, confirmed_at, played_on)
          values (${c.id}, ${c.challenger}, ${c.challenged}, ${tx.json([[6, 0], [6, 0]])}, ${c.challenger}, true, ${me.id}, 'confirmed', now(), ${madridToday()})
          returning id`;
        const before = posMap(await standings(tx));
        await recompute(tx);
        await afterConfirm(tx, m.id, before, out, { walkover: true });
        result = { status: 'walkover' };
      } else {
        await tx`update challenges set status = 'rejected', responded_by = ${me.id}, updated_at = now() where id = ${id}`;
        if (wants(other, 'challenges')) out.push(() => mail(other.email, `${firstName(me.full_name)} no puede jugar`, {
          lines: [`<b>${esc(me.full_name)}</b> no puede jugar el ${esc(fmtWhen(c.play_at))}.`, 'Puedes retar a otro jugador, o volver a retarle otro día.'],
          buttons: [{ label: 'Ver la clasificación', url: appUrl('') }],
        }));
        result = { status: 'rejected' };
      }
    } else fail('Acción no válida.');
  });
  return result;
}

on('POST', 'challenge/:id/cancel', async ({ req, params, out }) => {
  const me = await auth(req);
  const sql = db();
  const id = checkNum(params[0]);
  const [c] = await sql`select *, play_at::text as play_at from challenges where id = ${id}`;
  if (!c || c.challenger !== me.id) fail('Solo quien ha retado puede cancelar el reto.');
  if (!['pending', 'accepted'].includes(c.status)) fail('Este reto ya no está abierto.');
  const [hasMatch] = await sql`select 1 from matches where challenge_id = ${id} and status in ('pending','confirmed','disputed')`;
  if (hasMatch) fail('Este partido ya tiene resultado.');
  await sql`update challenges set status = 'cancelled', responded_by = ${me.id}, updated_at = now() where id = ${id}`;
  const [o] = await sql`select * from players where id = ${c.challenged}`;
  if (o && wants(o, 'challenges')) out.push(() => mail(o.email, `${firstName(me.full_name)} ha cancelado el reto`, {
    lines: [`<b>${esc(me.full_name)}</b> ha cancelado el partido del ${esc(fmtWhen(c.play_at))}.`],
    buttons: [{ label: 'Abrir el ranking', url: appUrl('') }],
  }));
  return { ok: true };
});

/* ── Resultados ──────────────────────────────────────────────────────── */
function setsFromMine(sets, iAmP1) {
  if (!Array.isArray(sets)) fail('Pon el marcador.');
  const clean = sets.filter((s) => Array.isArray(s) && s.some((x) => x !== '' && x !== null && x !== undefined))
    .map((s) => s.map((x) => Number(x)));
  const p1sets = iAmP1 ? clean : clean.map(([a, b]) => [b, a]);
  const chk = R.checkSets(p1sets);
  if (!chk.ok) fail(chk.error);
  return { sets: p1sets, winnerIdx: chk.winner };
}

on('POST', 'challenge/:id/result', async ({ req, params, body, out }) => {
  const me = await auth(req);
  const sql = db();
  const id = checkNum(params[0]);
  const S = await season(sql);
  if (S.phase !== 'regular') fail('La fase regular ha terminado. Si tienes un resultado pendiente, habla con el club.');
  let created;
  await sql.begin(async (tx) => {
    const [c] = await tx`select *, play_at::text as play_at from challenges where id = ${id} for update`;
    if (!c || (c.challenger !== me.id && c.challenged !== me.id)) fail('Reto no encontrado.', 404);
    if (c.status !== 'accepted') fail('Solo se puede poner el resultado de un reto aceptado.');
    if (c.play_at.slice(0, 10) > madridToday()) fail('Este partido todavía no se ha jugado.');
    const [ex] = await tx`select id from matches where challenge_id = ${id} and status in ('pending','confirmed','disputed')`;
    if (ex) fail('Este partido ya tiene un resultado. Si no es correcto, márcalo como «No estoy de acuerdo».');
    const { sets, winnerIdx } = setsFromMine(body.sets, me.id === c.challenger);
    const [m] = await tx`insert into matches (challenge_id, p1, p2, sets, winner, reported_by, token, played_on)
      values (${id}, ${c.challenger}, ${c.challenged}, ${tx.json(sets)}, ${winnerIdx === 0 ? c.challenger : c.challenged}, ${me.id},
              ${randomToken()}, ${c.play_at.slice(0, 10)}) returning *`;
    created = m;
  });
  const other = (await playersById(sql, [created.p1 === me.id ? created.p2 : created.p1]));
  out.push(() => resultToConfirmMail(created, me, Object.values(other)[0]));
  return { match: { id: Number(created.id), status: 'pending' } };
});

function resultToConfirmMail(m, reporter, other) {
  if (!other || !wants(other, 'results')) return;
  const flip = other.id === m.p2;   // el marcador, visto desde quien confirma
  const won = m.winner === other.id;
  return mail(other.email, `Confirma el resultado contra ${firstName(reporter.full_name)}`, {
    lines: [`<b>${esc(reporter.full_name)}</b> ha puesto este resultado:`],
    highlight: { big: `${won ? 'Ganas' : 'Pierdes'} ${esc(R.fmtSets(m.sets, flip))}`, small: 'Tu marcador va primero.' },
    buttons: [
      { label: 'Confirmar', url: actUrl('m', m.id, m.token, 'confirm') },
      { label: 'No estoy de acuerdo', url: appUrl('retos'), style: 'ghost' },
    ],
    foot: 'Si no respondes en 48 horas, el resultado se da por bueno.',
  });
}

on('POST', 'match/:id/confirm', async ({ req, params, out }) => {
  const me = await auth(req);
  await confirmAs(db(), checkNum(params[0]), me, out);
  return { ok: true };
});
async function confirmAs(sql, id, me, out) {
  await sql.begin(async (tx) => {
    const [m] = await tx`select * from matches where id = ${id} for update`;
    if (!m || (me && m.p1 !== me.id && m.p2 !== me.id)) fail('Partido no encontrado.', 404);
    if (m.status !== 'pending') fail(m.status === 'confirmed' ? 'Este resultado ya está confirmado.' : 'Este resultado ya no se puede confirmar.');
    if (me && m.reported_by === me.id) fail('Lo tiene que confirmar tu rival.');
    await confirmMatch(tx, m, out);
  });
}
/** Confirma un partido (dentro de una transacción): niveles, puntos, cuadro, tablón y emails. */
async function confirmMatch(tx, m, out) {
  const before = posMap(await standings(tx));
  await tx`update matches set status = 'confirmed', confirmed_at = now(), token = null where id = ${m.id}`;
  if (m.challenge_id) await tx`update challenges set status = 'done', updated_at = now() where id = ${m.challenge_id}`;
  if (m.master_id) await advance(tx, m.master_id, m.winner);
  await recompute(tx);
  await afterConfirm(tx, m.id, before, out, {});
}
async function afterConfirm(tx, matchId, before, out, { walkover }) {
  const [m] = await tx`select * from matches where id = ${matchId}`;
  const st = await standings(tx);
  const after = posMap(st);
  const P = await playersById(tx, [m.p1, m.p2]);
  const wIs1 = m.winner === m.p1;
  const W = P[m.winner], L = P[wIs1 ? m.p2 : m.p1];
  const wd = Number(wIs1 ? m.p1_after - m.p1_before : m.p2_after - m.p2_before);
  const ld = Number(wIs1 ? m.p2_after - m.p2_before : m.p1_after - m.p1_before);
  const wp = wIs1 ? m.p1_pts : m.p2_pts;
  const lp = wIs1 ? m.p2_pts : m.p1_pts;
  let tier = null;
  if (m.master_id) { const [n] = await tx`select tier from masters where id = ${m.master_id}`; tier = n?.tier; }
  await tx`insert into feed (kind, actor, target, data) values (${walkover ? 'walkover' : 'result'}, ${W.id}, ${L.id},
    ${tx.json({ match: Number(m.id), score: R.fmtSets(m.sets, !wIs1), delta: wd, pts: m.master_id ? null : wp, tier })})`;
  for (const [p, won, d, pts] of [[W, true, wd, wp], [L, false, ld, lp]]) {
    if (!wants(p, 'results')) continue;
    const rival = p.id === W.id ? L : W;
    const pos = after[p.id];
    const subj = walkover
      ? (won ? `${firstName(rival.full_name)} no puede jugar: ganas 6-0 6-0` : `Partido perdido 6-0 6-0 contra ${firstName(rival.full_name)}`)
      : `${won ? 'Victoria' : 'Derrota'} contra ${firstName(rival.full_name)}: resultado confirmado`;
    out.push(() => mail(p.email, subj, {
      lines: walkover
        ? [won ? `<b>${esc(rival.full_name)}</b> ha rechazado su tercer reto del mes, así que el partido cuenta como victoria tuya 6-0 6-0.`
               : 'Es tu tercer rechazo de este mes, así que el partido cuenta como derrota 6-0 6-0. Los dos primeros rechazos de cada mes son libres.']
        : [`${won ? 'Has ganado' : 'Has perdido'} <b>${esc(R.fmtSets(m.sets, p.id !== m.p1))}</b> contra <b>${esc(rival.full_name)}</b>.`],
      highlight: { big: `Nivel ${Math.round(Number(P[p.id].level))} (${signed(d)})${m.master_id ? '' : ` · +${pts || 0} pts`}`,
        small: pos ? `Vas ${ord(pos)} en la clasificación.` : (m.master_id ? 'Partido de los Másters.' : `Te faltan ${Math.max(0, st.S.min_matches - ([...st.others].find((r) => r.id === p.id)?.pj ?? 0))} partidos para clasificarte.`) },
      buttons: [{ label: 'Ver la clasificación', url: appUrl('') }],
    }));
  }
  // Avisos de «has bajado de puesto» (como mucho uno al día)
  const today = madridToday();
  const dropped = Object.keys(before).filter((id) => after[id] && after[id] > before[id] && id !== m.p1 && id !== m.p2);
  if (dropped.length) {
    const DP = await playersById(tx, dropped);
    for (const id of dropped) {
      const p = DP[id];
      if (!p || !p.active || !wants(p, 'drop') || String(p.last_drop_mail) === today) continue;
      await tx`update players set last_drop_mail = ${today} where id = ${id}`;
      out.push(() => mail(p.email, `Has bajado al ${ord(after[id])} puesto`, {
        lines: [`<b>${esc(W.full_name)}</b> ha ganado a ${esc(L.full_name)} y la clasificación se ha movido.`, `Ahora vas <b>${ord(after[id])}</b> (antes ${ord(before[id])}).`],
        buttons: [{ label: 'Retar a alguien', url: appUrl('') }],
      }));
    }
  }
}

on('POST', 'match/:id/dispute', async ({ req, params, body, out }) => {
  const me = await auth(req);
  const sql = db();
  const id = checkNum(params[0]);
  const [m] = await sql`select * from matches where id = ${id}`;
  if (!m || (m.p1 !== me.id && m.p2 !== me.id)) fail('Partido no encontrado.', 404);
  if (m.status !== 'pending') fail('Este resultado ya no se puede discutir. Habla con el club.');
  if (m.reported_by === me.id) fail('Si te has equivocado, borra el resultado y ponlo otra vez.');
  await sql`update matches set status = 'disputed', token = null where id = ${id}`;
  const note = String(body.note || '').trim().slice(0, 300);
  const P = await playersById(sql, [m.p1, m.p2]);
  const admins = await sql`select email from players where is_admin and active`;
  for (const a of admins) out.push(() => mail(a.email, `Resultado en disputa: ${P[m.p1].full_name} vs ${P[m.p2].full_name}`, {
    lines: [`<b>${esc(P[m.reported_by].full_name)}</b> puso ${esc(R.fmtSets(m.sets))} (marcador de ${esc(P[m.p1].full_name)} primero), y <b>${esc(me.full_name)}</b> no está de acuerdo.`,
      note ? `Su comentario: «${esc(note)}»` : ''].filter(Boolean),
    buttons: [{ label: 'Resolver en el panel', url: appUrl('admin') }],
  }));
  const rep = P[m.reported_by];
  out.push(() => mail(rep.email, `${firstName(me.full_name)} no está de acuerdo con el resultado`, {
    lines: [`<b>${esc(me.full_name)}</b> no está de acuerdo con el resultado que pusiste. El club lo revisará y os dirá algo.`],
  }));
  return { ok: true };
});

on('POST', 'match/:id/withdraw', async ({ req, params }) => {
  const me = await auth(req);
  const sql = db();
  const id = checkNum(params[0]);
  const [m] = await sql`select * from matches where id = ${id}`;
  if (!m || m.reported_by !== me.id || m.status !== 'pending') fail('Este resultado ya no se puede borrar.');
  await sql`delete from matches where id = ${id}`;
  return { ok: true };
});

/* ════════════════════════════════════════════════════════════════════
   Másters
   ════════════════════════════════════════════════════════════════════ */
async function masterRounds(sql) {
  const rows = await sql`select tier, max(round)::int as r from masters group by tier`;
  return Object.fromEntries(rows.map((x) => [x.tier, x.r]));
}
/** Pasa al ganador de un nodo a la siguiente ronda. */
async function advance(tx, nodeId, winner) {
  const [n] = await tx`update masters set winner = ${winner} where id = ${nodeId} returning *`;
  const [{ r }] = await tx`select max(round)::int as r from masters where tier = ${n.tier}`;
  if (n.round >= r) return;
  const seed = winner === n.p1 ? n.seed1 : n.seed2;
  if (n.slot % 2 === 0) await tx`update masters set p1 = ${winner}, seed1 = ${seed} where tier = ${n.tier} and round = ${n.round + 1} and slot = ${Math.floor(n.slot / 2)}`;
  else await tx`update masters set p2 = ${winner}, seed2 = ${seed} where tier = ${n.tier} and round = ${n.round + 1} and slot = ${Math.floor(n.slot / 2)}`;
}
/** Deshace el avance de un nodo (si la siguiente ronda aún no se ha jugado). */
async function unadvance(tx, n) {
  const [{ r }] = await tx`select max(round)::int as r from masters where tier = ${n.tier}`;
  if (n.round < r) {
    const [parent] = await tx`select * from masters where tier = ${n.tier} and round = ${n.round + 1} and slot = ${Math.floor(n.slot / 2)}`;
    if (parent.winner) fail('La siguiente ronda ya se ha jugado: no se puede cambiar este partido.');
    const [pm] = await tx`select 1 from matches where master_id = ${parent.id} and status in ('pending','confirmed','disputed')`;
    if (pm) fail('La siguiente ronda ya tiene resultado: no se puede cambiar este partido.');
    if (n.slot % 2 === 0) await tx`update masters set p1 = null, seed1 = null where id = ${parent.id}`;
    else await tx`update masters set p2 = null, seed2 = null where id = ${parent.id}`;
  }
  await tx`update masters set winner = null where id = ${n.id}`;
}

on('GET', 'masters', async ({ req }) => {
  await auth(req);
  const sql = db();
  const S = await season(sql);
  const nodes = await sql`select n.*, a.full_name as n1, b.full_name as n2, m.sets, m.p1 as mp1
    from masters n left join players a on a.id = n.p1 left join players b on b.id = n.p2
    left join lateral (select * from matches mm where mm.master_id = n.id and mm.status = 'confirmed' order by mm.id desc limit 1) m on true
    order by n.tier, n.round, n.slot`;
  const rounds = await masterRounds(sql);
  const tiers = R.TIERS.filter(([t]) => rounds[t]).map(([t, name]) => {
    const list = nodes.filter((n) => n.tier === t);
    const final = list.find((n) => n.round === rounds[t]);
    return {
      tier: t, name,
      champion: final?.winner ? (final.winner === final.p1 ? final.n1 : final.n2) : null,
      rounds: Array.from({ length: rounds[t] }, (_, i) => ({
        name: R.roundName(i + 1, rounds[t]),
        matches: list.filter((n) => n.round === i + 1).map((n) => ({
          id: Number(n.id), p1: n.p1 ? { id: n.p1, name: n.n1, seed: n.seed1 } : null, p2: n.p2 ? { id: n.p2, name: n.n2, seed: n.seed2 } : null,
          winner: n.winner, score: n.sets ? R.fmtSets(n.sets) : null,
          bye: n.round === 1 && (!n.p1 || !n.p2) && !!n.winner,
        })),
      })),
    };
  });
  return { season: seasonView(S), tiers };
});

on('POST', 'masters/:id/result', async ({ req, params, body, out }) => {
  const me = await auth(req);
  const sql = db();
  const id = checkNum(params[0]);
  let created;
  await sql.begin(async (tx) => {
    const [n] = await tx`select * from masters where id = ${id} for update`;
    if (!n || (n.p1 !== me.id && n.p2 !== me.id)) fail('Partido no encontrado.', 404);
    if (n.winner || !n.p1 || !n.p2) fail('Este partido no está pendiente.');
    const [ex] = await tx`select id from matches where master_id = ${id} and status in ('pending','confirmed','disputed')`;
    if (ex) fail('Este partido ya tiene un resultado.');
    const { sets, winnerIdx } = setsFromMine(body.sets, me.id === n.p1);
    const [m] = await tx`insert into matches (master_id, p1, p2, sets, winner, reported_by, token, played_on)
      values (${id}, ${n.p1}, ${n.p2}, ${tx.json(sets)}, ${winnerIdx === 0 ? n.p1 : n.p2}, ${me.id}, ${randomToken()}, ${madridToday()}) returning *`;
    created = m;
  });
  const P = await playersById(sql, [created.p1, created.p2]);
  out.push(() => resultToConfirmMail(created, me, P[created.p1 === me.id ? created.p2 : created.p1]));
  return { match: { id: Number(created.id) } };
});

/* ════════════════════════════════════════════════════════════════════
   Tablón
   ════════════════════════════════════════════════════════════════════ */
on('GET', 'feed', async ({ req, url }) => {
  await auth(req);
  const sql = db();
  const before = Number(url.searchParams.get('before')) || 9e15;
  const posts = await sql`select f.*, a.full_name as actor_name, a.photo_v as actor_pv, t.full_name as target_name
    from feed f left join players a on a.id = f.actor left join players t on t.id = f.target
    where f.id < ${before} order by f.id desc limit 30`;
  const ids = posts.map((p) => p.id);
  const comments = ids.length ? await sql`select c.*, p.full_name as author_name, p.photo_v as author_pv from comments c
    left join players p on p.id = c.author where c.post_id in ${sql(ids)} order by c.id` : [];
  return {
    posts: posts.map((p) => ({
      id: Number(p.id), kind: p.kind, data: p.data, body: p.body, created_at: p.created_at,
      actor: p.actor ? { id: p.actor, name: p.actor_name, photo_v: p.actor_pv } : null,
      target: p.target ? { id: p.target, name: p.target_name } : null,
      comments: comments.filter((c) => c.post_id === p.id).map((c) => ({ id: Number(c.id), body: c.body, created_at: c.created_at,
        author: c.author ? { id: c.author, name: c.author_name, photo_v: c.author_pv } : null })),
    })),
    more: posts.length === 30,
  };
});

on('POST', 'feed/:id/comment', async ({ req, params, body }) => {
  const me = await auth(req);
  if (me.muted) fail('El club ha desactivado tus comentarios.');
  const text = String(body.body || '').trim();
  if (!text) fail('Escribe algo.');
  if (text.length > 500) fail('Máximo 500 caracteres.');
  const sql = db();
  const id = checkNum(params[0]);
  const [f] = await sql`select id from feed where id = ${id}`;
  if (!f) fail('Publicación no encontrada.', 404);
  const [recent] = await sql`select count(*)::int as n from comments where author = ${me.id} and created_at > now() - interval '1 minute'`;
  if (recent.n >= 5) fail('Vas muy rápido. Espera un momento.');
  const [c] = await sql`insert into comments (post_id, author, body) values (${id}, ${me.id}, ${text}) returning id`;
  return { id: Number(c.id) };
});

on('POST', 'comment/:id/delete', async ({ req, params }) => {
  const me = await auth(req);
  const sql = db();
  const id = checkNum(params[0]);
  const [c] = await sql`select * from comments where id = ${id}`;
  if (!c) return { ok: true };
  if (c.author !== me.id && !me.is_admin) fail('Solo puedes borrar tus comentarios.');
  await sql`delete from comments where id = ${id}`;
  return { ok: true };
});

/* ════════════════════════════════════════════════════════════════════
   Botones de los emails (un toque). GET enseña la pregunta; POST la ejecuta.
   Así, los programas que abren enlaces de los emails para revisarlos no aceptan nada solos.
   ════════════════════════════════════════════════════════════════════ */
function actPage(title, text, { form, link } = {}) {
  const { html: page } = layout({ title, lines: [text] });
  const extra = form
    ? `<form method="post" action="${siteUrl()}/api/act" style="margin:0;text-align:center;padding:0 20px 24px">
        <input type="hidden" name="t" value="${esc(form.t)}"><input type="hidden" name="a" value="${esc(form.a)}">
        <button type="submit" style="border:0;cursor:pointer;padding:15px 30px;border-radius:999px;font:700 16px -apple-system,Helvetica,Arial,sans-serif;background:${form.a === 'reject' ? '#12294A' : '#E35B2A'};color:#fff">${esc(form.label)}</button>
        <div style="margin-top:14px"><a href="${appUrl(form.alt || '')}" style="font:600 14px -apple-system,Helvetica,Arial,sans-serif;color:#546073">Abrir la app</a></div></form>`
    : `<div style="text-align:center;padding:0 20px 26px"><a href="${link || appUrl('')}" style="display:inline-block;padding:14px 26px;border-radius:999px;font:700 15px -apple-system,Helvetica,Arial,sans-serif;background:#12294A;color:#fff;text-decoration:none">Abrir la app</a></div>`;
  return html(page.replace(/(<tr><td style="padding:18px 28px 26px)/, `<tr><td>${extra}</td></tr>$1`));
}
async function parseAct(sql, t) {
  const [kind, id, raw] = String(t || '').split('.');
  if (!['c', 'm'].includes(kind) || !/^\d+$/.test(id || '') || !raw) return null;
  if (kind === 'c') {
    const [c] = await sql`${CH_SELECT(sql)} where c.id = ${Number(id)}`;
    if (!c || !sameStr(c.token, raw)) return null;
    return { kind, c };
  }
  const [m] = await sql`select * from matches where id = ${Number(id)}`;
  if (!m || !sameStr(m.token, raw)) return null;
  return { kind, m };
}
on('GET', 'act', async ({ url }) => {
  const sql = db();
  const t = url.searchParams.get('t'), a = url.searchParams.get('a');
  const x = await parseAct(sql, t);
  if (!x) return actPage('Este enlace ya no vale', 'Puede que ya hayas respondido o que haya cambiado la hora. Entra en la app para ver cómo está.');
  if (x.kind === 'c') {
    const c = x.c;
    if (c.status !== 'pending') return actPage('Este reto ya está respondido', 'Entra en la app para ver cómo está.', { link: appUrl('retos') });
    const who = c.proposed_by === c.challenger ? c.challenger_name : c.challenged_name;
    if (a === 'accept') return actPage(`¿Aceptas jugar contra ${who}?`, `${cap(fmtWhen(c.play_at))}, en el Almuñécar Tennis Club.`, { form: { t, a, label: 'Sí, acepto', alt: `reto/${c.id}` } });
    if (a === 'reject') {
      const resp = c.proposed_by === c.challenger ? c.challenged : c.challenger;
      const wo = resp === c.challenged && (await rejectsThisMonth(sql, resp)) >= FREE_REJECTS && (await season(sql)).phase === 'regular';
      return actPage(`¿No puedes jugar contra ${who}?`, wo ? 'Ojo: ya has usado tus 2 rechazos libres de este mes. Si rechazas, el partido cuenta como derrota 6-0 6-0. Si prefieres otra hora, abre la app.'
        : `${cap(fmtWhen(c.play_at))}. Si prefieres otra hora, abre la app y propón una.`, { form: { t, a, label: wo ? 'Rechazar igualmente' : 'No puedo jugar', alt: `reto/${c.id}` } });
    }
  } else if (a === 'confirm') {
    const m = x.m;
    if (m.status !== 'pending') return actPage('Este resultado ya está gestionado', 'Entra en la app para verlo.');
    const P = await playersById(sql, [m.p1, m.p2]);
    return actPage('¿Confirmas el resultado?', `${esc(P[m.p1].full_name)} ${esc(R.fmtSets(m.sets))} ${esc(P[m.p2].full_name)} (gana ${esc(P[m.winner].full_name)}).`,
      { form: { t, a, label: 'Sí, es correcto', alt: 'retos' } });
  }
  return actPage('Enlace no válido', 'Entra en la app para continuar.');
});
on('POST', 'act', async ({ body, out }) => {
  const sql = db();
  const x = await parseAct(sql, body.t);
  if (!x) return actPage('Este enlace ya no vale', 'Puede que ya hayas respondido o que haya cambiado la hora. Entra en la app para ver cómo está.');
  try {
    if (x.kind === 'c' && ['accept', 'reject'].includes(body.a)) {
      const c = x.c;
      const actorId = c.proposed_by === c.challenger ? c.challenged : c.challenger;
      const [actor] = await sql`select * from players where id = ${actorId} and active`;
      if (!actor) fail('Cuenta no disponible.');
      const r = await respond(sql, Number(c.id), actor, body.a, {}, out);
      await flush(out.splice(0));
      if (r.status === 'accepted') return actPage('¡Partido aceptado!', `${cap(fmtWhen(c.play_at))}. Os hemos enviado un email a los dos. Recordad reservar pista en el club.`, { link: appUrl('retos') });
      if (r.status === 'walkover') return actPage('Reto rechazado', 'Como era tu tercer rechazo del mes, el partido cuenta como derrota 6-0 6-0.', { link: appUrl('retos') });
      return actPage('Hecho', 'Hemos avisado a tu rival de que no puedes jugar.', { link: appUrl('') });
    }
    if (x.kind === 'm' && body.a === 'confirm') {
      const m = x.m;
      const actorId = m.reported_by === m.p1 ? m.p2 : m.p1;
      const [actor] = await sql`select * from players where id = ${actorId}`;
      await confirmAs(sql, Number(m.id), actor, out);
      await flush(out.splice(0));
      return actPage('Resultado confirmado', 'Los niveles y la clasificación ya están actualizados.', { link: appUrl('') });
    }
  } catch (e) {
    if (e instanceof HttpError) return actPage('No se ha podido hacer', esc(e.message), { link: appUrl('retos') });
    throw e;
  }
  return actPage('Enlace no válido', 'Entra en la app para continuar.');
});

/* ════════════════════════════════════════════════════════════════════
   Admin
   ════════════════════════════════════════════════════════════════════ */
on('GET', 'admin', async ({ req }) => {
  await auth(req, { admin: true });
  const sql = db();
  const st = await standings(sql);
  const rowOf = Object.fromEntries([...st.qualified, ...st.others].map((r) => [r.id, r]));
  const players = await sql`select id, username, full_name, email, birth_date, hand, backhand, attrs, start_level, level,
    is_admin, active, muted, created_at from players order by full_name`;
  const matches = await sql`select m.*, a.full_name as n1, b.full_name as n2, r.full_name as reporter
    from matches m join players a on a.id = m.p1 join players b on b.id = m.p2 left join players r on r.id = m.reported_by
    order by (m.status = 'disputed') desc, (m.status = 'pending') desc, m.id desc limit 150`;
  return {
    season: seasonView(st.S),
    players: players.map((p) => ({ ...p, level: Number(p.level), start_level: Number(p.start_level), age: R.ageOn(p.birth_date),
      pj: rowOf[p.id]?.pj ?? 0, pts: rowOf[p.id]?.pts ?? 0, pos: rowOf[p.id]?.pos ?? null, deleted: p.full_name === 'Jugador eliminado' })),
    matches: matches.map((m) => ({ id: Number(m.id), status: m.status, n1: m.n1, n2: m.n2, p1: m.p1, p2: m.p2, sets: m.sets, score: R.fmtSets(m.sets),
      winner: m.winner, walkover: m.walkover, reporter: m.reporter, played_on: m.played_on, master: !!m.master_id,
      d1: m.p1_after != null ? Number(m.p1_after - m.p1_before) : null, d2: m.p2_after != null ? Number(m.p2_after - m.p2_before) : null })),
  };
});

on('POST', 'admin/player/:id', async ({ req, params, body }) => {
  await auth(req, { admin: true });
  const sql = db();
  const id = checkId(params[0]);
  const upd = {};
  if (typeof body.full_name === 'string') {
    const n = body.full_name.trim().replace(/\s+/g, ' ');
    if (n.length < 3 || n.length > 60) fail('Nombre no válido.');
    upd.full_name = n;
  }
  for (const k of ['active', 'muted', 'is_admin']) if (typeof body[k] === 'boolean') upd[k] = body[k];
  let needRecompute = false;
  if (body.attrs) {
    const a = R.checkAttrs(body.attrs);
    if (!a) fail('Cada golpe entre 30 y 99.');
    upd.attrs = sql.json(a);
    upd.start_level = R.levelFromAttrs(a);
    needRecompute = true;
  }
  if (body.pin) {
    if (!validPin(body.pin)) fail('El PIN tiene que tener 6 cifras.');
    upd.pin_hash = hashPin(body.pin);
    upd.failed_logins = 0; upd.locked_until = null;
  }
  if (!Object.keys(upd).length) return { ok: true };
  await sql.begin(async (tx) => {
    await tx`update players set ${tx(upd)}${body.pin ? tx`, session_v = session_v + 1` : tx``} where id = ${id}`;
    if (upd.active === false) await tx`update challenges set status = 'cancelled', updated_at = now() where status in ('pending','accepted') and (challenger = ${id} or challenged = ${id})`;
    if (needRecompute) await recompute(tx);
  });
  return { ok: true };
});

on('POST', 'admin/player/:id/delete', async ({ req, params }) => {
  const me = await auth(req, { admin: true });
  const id = checkId(params[0]);
  if (id === me.id) fail('No puedes borrar tu propia cuenta desde aquí.');
  await anonymize(db(), id);
  return { ok: true };
});

on('POST', 'admin/match/:id', async ({ req, params, body, out }) => {
  await auth(req, { admin: true });
  const sql = db();
  const id = checkNum(params[0]);
  await sql.begin(async (tx) => {
    const [m] = await tx`select * from matches where id = ${id} for update`;
    if (!m) fail('Partido no encontrado.', 404);
    const node = m.master_id ? (await tx`select * from masters where id = ${m.master_id}`)[0] : null;
    if (body.action === 'annul') {
      if (m.status === 'annulled') return;
      if (node && m.status === 'confirmed') await unadvance(tx, node);
      await tx`update matches set status = 'annulled', token = null where id = ${id}`;
      if (m.challenge_id) await tx`update challenges set status = 'cancelled', updated_at = now() where id = ${m.challenge_id}`;
      await recompute(tx);
    } else if (body.action === 'set' || body.action === 'confirm') {
      let sets = m.sets, winner = m.winner;
      if (body.action === 'set') {
        const chk = R.checkSets((body.sets || []).map((s) => s.map(Number)));
        if (!chk.ok) fail(chk.error);
        sets = body.sets.map((s) => s.map(Number));
        winner = chk.winner === 0 ? m.p1 : m.p2;
      }
      if (m.status === 'confirmed') {
        if (node && winner !== m.winner) { await unadvance(tx, node); await advance(tx, node.id, winner); }
        await tx`update matches set sets = ${tx.json(sets)}, winner = ${winner} where id = ${id}`;
        await recompute(tx);
      } else {
        await tx`update matches set sets = ${tx.json(sets)}, winner = ${winner}, status = 'pending' where id = ${id}`;
        const [fresh] = await tx`select * from matches where id = ${id}`;
        await confirmMatch(tx, fresh, out);
      }
    } else fail('Acción no válida.');
  });
  return { ok: true };
});

on('POST', 'admin/post', async ({ req, body }) => {
  const me = await auth(req, { admin: true });
  const text = String(body.body || '').trim();
  if (!text || text.length > 1000) fail('Escribe el aviso (máximo 1.000 caracteres).');
  await db()`insert into feed (kind, actor, body) values ('admin', ${me.id}, ${text})`;
  return { ok: true };
});

on('POST', 'admin/feed/:id/delete', async ({ req, params }) => {
  await auth(req, { admin: true });
  await db()`delete from feed where id = ${checkNum(params[0])}`;
  return { ok: true };
});

on('POST', 'admin/season', async ({ req, body }) => {
  await auth(req, { admin: true });
  const sql = db();
  const upd = {};
  if (body.name) upd.name = String(body.name).trim().slice(0, 40);
  for (const k of ['starts_on', 'ends_on', 'masters_end']) if (body[k]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body[k])) fail('Fecha no válida.');
    upd[k] = body[k];
  }
  if (body.min_matches != null) {
    const n = Number(body.min_matches);
    if (!Number.isInteger(n) || n < 1 || n > 20) fail('Mínimo de partidos entre 1 y 20.');
    upd.min_matches = n;
  }
  if (body.phase && ['regular', 'masters', 'closed'].includes(body.phase)) upd.phase = body.phase;
  if (Object.keys(upd).length) await sql`update season set ${sql(upd)} where id = 1`;
  const S = await season(sql);
  if (S.ends_on < S.starts_on) fail('El fin de la fase regular tiene que ser después del inicio.');
  return { season: seasonView(S) };
});

on('POST', 'admin/masters/generate', async ({ req, body, out }) => {
  await auth(req, { admin: true });
  if (body.confirm !== true) fail('Falta confirmar.');
  const sql = db();
  let summary;
  await sql.begin(async (tx) => {
    const [ex] = await tx`select 1 from masters limit 1`;
    if (ex) fail('Los cuadros ya existen. Si quieres rehacerlos, bórralos primero.');
    const st = await standings(tx);
    const groups = R.mastersGroups(st.qualified.map((r) => r.id));
    if (!Object.keys(groups).length) fail('Todavía no hay al menos 2 jugadores clasificados.');
    summary = {};
    for (const [tier, ids] of Object.entries(groups)) {
      const fr = R.firstRound(ids);
      for (let r = 1; r <= fr.rounds; r++) {
        const n = fr.size / 2 ** r;
        for (let s = 0; s < n; s++) {
          const f = r === 1 ? fr.first[s] : { p1: null, p2: null, seed1: null, seed2: null };
          await tx`insert into masters (tier, round, slot, p1, p2, seed1, seed2) values (${tier}, ${r}, ${s}, ${f.p1}, ${f.p2}, ${f.seed1}, ${f.seed2})`;
        }
      }
      // byes: pasa directamente quien no tiene rival
      const byes = await tx`select * from masters where tier = ${tier} and round = 1 and (p1 is null or p2 is null) and not (p1 is null and p2 is null)`;
      for (const b of byes) await advance(tx, b.id, b.p1 || b.p2);
      summary[tier] = ids.length;
    }
    await tx`update season set phase = 'masters' where id = 1`;
    const names = R.TIERS.filter(([t]) => summary[t]).map(([t, n]) => `${n} (${summary[t]})`).join(', ');
    await tx`insert into feed (kind, data, body) values ('masters', ${tx.json(summary)}, ${`¡Cuadros de los Másters listos! ${names}. Mirad vuestro primer partido en Retos.`})`;
    const P = await playersById(tx, Object.values(groups).flat());
    for (const [tier, ids] of Object.entries(groups)) {
      const tname = R.TIERS.find(([t]) => t === tier)[1];
      ids.forEach((pid, i) => {
        const p = P[pid];
        if (!p || !wants(p, 'results')) return;
        out.push(() => mail(p.email, `Te has clasificado para el ${tname}`, {
          lines: [`¡Enhorabuena, ${esc(firstName(p.full_name))}! Juegas el <b>${tname}</b> como cabeza de serie nº ${i + 1}.`, 'En la app tienes el cuadro y tu primer rival. Quedad entre vosotros y reservad pista en el club.'],
          buttons: [{ label: 'Ver el cuadro', url: appUrl('masters') }],
        }));
      });
    }
  });
  return { ok: true, summary };
});

on('POST', 'admin/masters/reset', async ({ req, body }) => {
  await auth(req, { admin: true });
  if (body.confirm !== true) fail('Falta confirmar.');
  const sql = db();
  await sql.begin(async (tx) => {
    await tx`delete from matches where master_id is not null`;
    await tx`delete from masters`;
    await tx`update season set phase = 'regular' where id = 1`;
    await recompute(tx);
  });
  return { ok: true };
});

on('GET', 'admin/export', async ({ req, url }) => {
  await auth(req, { admin: true });
  const sql = db();
  const what = url.searchParams.get('what') === 'matches' ? 'matches' : 'players';
  const csv = (rows) => rows.map((r) => r.map((v) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  let rows;
  if (what === 'players') {
    const st = await standings(sql);
    const rowOf = Object.fromEntries([...st.qualified, ...st.others].map((r) => [r.id, r]));
    const ps = await sql`select * from players order by full_name`;
    rows = [['usuario', 'nombre', 'email', 'nacimiento', 'mano', 'revés', 'nivel_inicial', 'nivel', 'puesto', 'puntos', 'partidos', 'victorias', 'activo', 'alta'],
      ...ps.map((p) => [p.username, p.full_name, p.email, p.birth_date, p.hand, p.backhand === 'una' ? 'una mano' : 'dos manos', Number(p.start_level), Number(p.level),
        rowOf[p.id]?.pos ?? '', rowOf[p.id]?.pts ?? 0, rowOf[p.id]?.pj ?? 0, rowOf[p.id]?.won ?? 0, p.active ? 'sí' : 'no', String(p.created_at.toISOString?.() || p.created_at).slice(0, 10)])];
  } else {
    const ms = await sql`select m.*, a.full_name as n1, b.full_name as n2, w.full_name as nw from matches m
      join players a on a.id = m.p1 join players b on b.id = m.p2 join players w on w.id = m.winner order by m.played_on, m.id`;
    rows = [['id', 'fecha', 'jugador1', 'jugador2', 'marcador', 'ganador', 'estado', 'másters', 'abandono', 'nivel1_antes', 'nivel1_después', 'nivel2_antes', 'nivel2_después', 'puntos1', 'puntos2'],
      ...ms.map((m) => [m.id, m.played_on, m.n1, m.n2, R.fmtSets(m.sets), m.nw, m.status, m.master_id ? 'sí' : 'no', m.walkover ? 'sí' : 'no',
        m.p1_before, m.p1_after, m.p2_before, m.p2_after, m.p1_pts, m.p2_pts])];
  }
  return new Response('﻿' + csv(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="ranking-atc-${what}-${madridToday()}.csv"`, 'Cache-Control': 'no-store' } });
});

/* ════════════════════════════════════════════════════════════════════
   Tareas programadas (las llama cron.mjs cada hora)
   ════════════════════════════════════════════════════════════════════ */
export async function runCron() {
  const sql = db();
  const out = [];
  const log = { expired: 0, reminded: 0, autoConfirmed: 0 };
  // 1. Retos sin respuesta en 7 días → caducan
  const exp = await sql`update challenges set status = 'expired', updated_at = now()
    where status = 'pending' and created_at < now() - ${CHALLENGE_DAYS + ' days'}::interval returning *, play_at::text as play_at`;
  log.expired = exp.length;
  if (exp.length) {
    const P = await playersById(sql, exp.flatMap((c) => [c.challenger, c.challenged]));
    for (const c of exp) {
      const p = P[c.challenger], o = P[c.challenged];
      if (p && wants(p, 'challenges')) out.push(() => mail(p.email, `Tu reto a ${firstName(o.full_name)} ha caducado`, {
        lines: [`Han pasado ${CHALLENGE_DAYS} días sin respuesta y el reto se ha cerrado, sin penalización para nadie.`],
        buttons: [{ label: 'Retar a alguien', url: appUrl('') }],
      }));
    }
  }
  // 2. Recordatorio a los 3 días
  const rem = await sql`update challenges set reminded = true
    where status = 'pending' and not reminded and updated_at < now() - interval '3 days' returning *, play_at::text as play_at`;
  log.reminded = rem.length;
  if (rem.length) {
    const P = await playersById(sql, rem.flatMap((c) => [c.challenger, c.challenged]));
    for (const c of rem) {
      const to = P[c.proposed_by === c.challenger ? c.challenged : c.challenger];
      const from = P[c.proposed_by];
      if (to && to.active && wants(to, 'reminders')) {
        const st = await standings(sql);
        out.push(() => challengeMail(c, to, from, st, c.counters > 0, true));
      }
    }
  }
  // 3. Resultados sin confirmar en 48 h → se dan por buenos
  const pend = await sql`select * from matches where status = 'pending' and created_at < now() - interval '48 hours' order by id`;
  for (const m of pend) {
    try {
      await sql.begin(async (tx) => {
        const [x] = await tx`select * from matches where id = ${m.id} for update`;
        if (x.status === 'pending') { await confirmMatch(tx, x, out); log.autoConfirmed++; }
      });
    } catch (e) { console.error('auto-confirm', m.id, e); }
  }
  await flush(out);
  return log;
}
