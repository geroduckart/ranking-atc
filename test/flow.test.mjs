import assert from 'node:assert/strict';
process.env.DATABASE_URL = 'postgres://postgres:pg@127.0.0.1:5432/ranking';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.ADMIN_USERNAME = 'gero';
process.env.SITE_URL = 'http://localhost:8888';
globalThis.__outbox = [];
const { default: api, runCron } = await import('../netlify/functions/api.mjs');
const { db } = await import('../netlify/lib/core.mjs');
const sql = db();
await sql`truncate comments, feed, matches, masters, challenges, players restart identity cascade`;
await sql`update season set starts_on = current_date - 10, ends_on = current_date + 39, phase = 'regular', min_matches = 5`;

async function call(method, path, body, token, form) {
  const headers = {};
  if (token) headers.authorization = 'Bearer ' + token;
  let b;
  if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; b = new URLSearchParams(body).toString(); }
  else if (body) { headers['content-type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await api(new Request('http://localhost:8888/api/' + path, { method, headers, body: b }));
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  return { status: r.status, data };
}
const ok = (r, msg) => { if (r.status >= 400) { console.error(msg, r.status, r.data); process.exit(1); } return r.data; };
const A = { derecha: 70, reves: 70, slice: 70, saque: 70, velocidad: 70 };
const at = (lvl) => Object.fromEntries(Object.keys(A).map((k) => [k, lvl]));
const T = {};
const ids = {};
async function signup(u, lvl, birth = '1990-05-01', extra = {}) {
  const d = ok(await call('POST', 'signup', { full_name: u[0].toUpperCase() + u.slice(1) + ' Test', username: u, email: u + '@test.com', pin: '482915', birth_date: birth, accept: true, hand: 'diestro', backhand: 'dos', attrs: at(lvl), ...extra }), 'signup ' + u);
  T[u] = d.token; ids[u] = d.me.id; return d;
}
const g = await signup('gero', 90); assert.equal(g.me.is_admin, true);
await signup('jesus', 79); await signup('sergio', 85); await signup('pablo', 83); await signup('marta', 81);
await signup('lucia', 72, '2011-01-01');
let r = await call('POST', 'signup', { full_name: 'Niño Peque', username: 'nino', email: 'n@test.com', pin: '482915', birth_date: '2014-01-01', accept: true, attrs: A });
assert.equal(r.status, 400); assert.match(r.data.error, /14 años/);
r = await call('POST', 'signup', { full_name: 'Dup', username: 'jesus', email: 'x@test.com', pin: '482915', birth_date: '1990-01-01', accept: true, attrs: A });
assert.match(r.data.error, /usuario ya existe/);
// login + lock
for (let i = 0; i < 5; i++) r = await call('POST', 'login', { username: 'pablo', pin: '000001' });
r = await call('POST', 'login', { username: 'pablo', pin: '482915' }); assert.equal(r.status, 429);
await sql`update players set locked_until = null where username = 'pablo'`;
ok(await call('POST', 'login', { username: 'Pablo ', pin: '482915' }), 'login');

// ── Reto Jesús → Sergio
const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
__outbox.length = 0;
let ch = ok(await call('POST', 'challenge', { to: ids.sergio, date: tomorrow, time: '10:30', message: '¿Te va bien?' }, T.jesus), 'challenge').challenge;
assert.equal(__outbox.length, 1); assert.match(__outbox[0].subject, /Jesus Test te ha retado/);
const acceptLink = __outbox[0].text.match(/Acepto: (\S+)/)[1];
r = await call('POST', 'challenge', { to: ids.sergio, date: tomorrow, time: '11:30' }, T.jesus); assert.match(r.data.error, /reto abierto/);
// GET act shows page, does not act
const q = new URL(acceptLink).searchParams;
r = await call('GET', 'act?' + q.toString()); assert.match(r.data, /Aceptas jugar contra Jesus/);
let [c1] = await sql`select status from challenges where id = ${ch.id}`; assert.equal(c1.status, 'pending');
__outbox.length = 0;
r = await call('POST', 'act', { t: q.get('t'), a: 'accept' }, null, true); assert.match(r.data, /Partido aceptado/);
[c1] = await sql`select status from challenges where id = ${ch.id}`; assert.equal(c1.status, 'accepted');
assert.equal(__outbox.length, 2);
r = await call('POST', 'act', { t: q.get('t'), a: 'accept' }, null, true); assert.match(r.data, /ya está respondido|no se ha podido|ya no vale|Este reto ya/i);
// result before playing → error
r = await call('POST', `challenge/${ch.id}/result`, { sets: [[6, 4], [7, 5]] }, T.jesus); assert.match(r.data.error, /todavía no se ha jugado/);
await sql`update challenges set play_at = now() - interval '1 day' where id = ${ch.id}`;
__outbox.length = 0;
const m1 = ok(await call('POST', `challenge/${ch.id}/result`, { sets: [[6, 4], [7, 5]] }, T.jesus), 'result').match;
assert.match(__outbox[0].subject, /Confirma el resultado/); assert.match(__outbox[0].text, /Pierdes 4-6 5-7/);
const conf = new URL(__outbox[0].text.match(/Confirmar: (\S+)/)[1]).searchParams;
r = await call('POST', `match/${m1.id}/confirm`, null, T.jesus); assert.match(r.data.error, /tu rival/);
__outbox.length = 0;
r = await call('POST', 'act', { t: conf.get('t'), a: 'confirm' }, null, true); assert.match(r.data, /Resultado confirmado/);
let [J] = await sql`select level from players where username = 'jesus'`;
let [S] = await sql`select level from players where username = 'sergio'`;
console.log('Jesús', J.level, 'Sergio', S.level, 'mails', __outbox.map((m) => m.subject));
assert.ok(Number(J.level) > 79 + 6 && Number(S.level) < 85 - 6); // provisional K=12 ×1.15? 6-4 7-5 no margin → 12*.666=8.0
// ── contrapropuesta: Pablo → Marta, Marta propone otra hora, Pablo acepta
ch = ok(await call('POST', 'challenge', { to: ids.marta, date: tomorrow, time: '18:00' }, T.pablo), 'ch2').challenge;
r = await call('POST', `challenge/${ch.id}/respond`, { action: 'accept' }, T.pablo); assert.match(r.data.error, /esperar/);
ok(await call('POST', `challenge/${ch.id}/respond`, { action: 'counter', date: tomorrow, time: '19:00' }, T.marta), 'counter');
ok(await call('POST', `challenge/${ch.id}/respond`, { action: 'accept' }, T.pablo), 'accept counter');
// ── rechazos: Sergio rechaza 3 retos este mes → el tercero walkover
for (const u of ['pablo', 'marta', 'gero']) {
  if (u === 'pablo' || u === 'marta') { /* pablo-marta ya tienen reto, no afecta a sergio */ }
  const c = ok(await call('POST', 'challenge', { to: ids.sergio, date: tomorrow, time: '09:00' }, T[u]), 'ch ' + u).challenge;
  const info = ok(await call('GET', `challenge/${c.id}`, null, T.sergio), 'info').challenge;
  r = ok(await call('POST', `challenge/${c.id}/respond`, { action: 'reject' }, T.sergio), 'reject');
  console.log('rechazo', u, r.status, 'walkoverAviso', info.rejectIsWalkover);
  if (u === 'gero') { assert.equal(r.status, 'walkover'); assert.equal(info.rejectIsWalkover, true); } else assert.equal(r.status, 'rejected');
}
// ── menor: mensaje eliminado
ch = ok(await call('POST', 'challenge', { to: ids.lucia, date: tomorrow, time: '17:00', message: 'hola' }, T.jesus), 'minor ch').challenge;
let [cm] = await sql`select message from challenges where id = ${ch.id}`; assert.equal(cm.message, null);
const pv = ok(await call('GET', `player/${ids.lucia}`, null, T.jesus), 'player'); assert.equal(pv.vs.noMessage, true); assert.equal(pv.vs.openChallenge, ch.id);
// ── disputa y resolución del admin
await sql`update challenges set status='accepted', play_at = now() - interval '2 hours' where id = ${ch.id}`;
const m2 = ok(await call('POST', `challenge/${ch.id}/result`, { sets: [[6, 1], [6, 1]] }, T.jesus), 'res2').match;
__outbox.length = 0;
ok(await call('POST', `match/${m2.id}/dispute`, { note: 'Gané yo' }, T.lucia), 'dispute');
assert.ok(__outbox.some((m) => /disputa/.test(m.subject)));
ok(await call('POST', `admin/match/${m2.id}`, { action: 'set', sets: [[4, 6], [6, 3], [7, 10]] }, T.gero), 'admin set');
let [m2r] = await sql`select status, winner from matches where id = ${m2.id}`; assert.equal(m2r.status, 'confirmed'); assert.equal(m2r.winner, ids.lucia);
r = await call('POST', `admin/match/${m2.id}`, { action: 'set', sets: [[4, 6], [6, 3], [7, 10]] }, T.jesus); assert.equal(r.status, 403);
// ── ranking, retos, feed, comentarios
const rk = ok(await call('GET', 'ranking', null, T.jesus), 'ranking'); console.log('ranking others', rk.others.map((x) => `${x.username}:${x.pts}pts/${x.pj}pj/${Math.round(x.level)}`).join(' '));
const rt = ok(await call('GET', 'retos', null, T.pablo), 'retos'); assert.ok(rt.challenges.length >= 1);
const me = ok(await call('GET', 'me', null, T.pablo), 'me'); console.log('pablo todo', me.todo, me.season);
const fd = ok(await call('GET', 'feed', null, T.jesus), 'feed'); console.log('feed', fd.posts.map((p) => p.kind).join(','));
ok(await call('POST', `feed/${fd.posts[0].id}/comment`, { body: '¡Vaya partidazo!' }, T.marta), 'comment');
ok(await call('POST', 'admin/post', { body: 'Bienvenidos a la Temporada 1' }, T.gero), 'post');
ok(await call('POST', 'admin/player/' + ids.marta, { muted: true }, T.gero), 'mute');
r = await call('POST', `feed/${fd.posts[0].id}/comment`, { body: 'otra' }, T.marta); assert.match(r.data.error, /desactivado/);
// ── Másters: min 1 partido, generar cuadros
ok(await call('POST', 'admin/season', { min_matches: 1 }, T.gero), 'season');
const rk2 = ok(await call('GET', 'ranking', null, T.gero), 'rk2'); console.log('clasificados', rk2.qualified.map((x) => `${x.pos}.${x.username}(${x.pts})`).join(' '));
const gen = ok(await call('POST', 'admin/masters/generate', { confirm: true }, T.gero), 'generate'); console.log('masters', gen.summary);
let ms = ok(await call('GET', 'masters', null, T.gero), 'masters');
console.log(JSON.stringify(ms.tiers[0].rounds.map((r) => r.name + ': ' + r.matches.map((m) => `${m.p1?.name || 'bye'} v ${m.p2?.name || 'bye'}`).join(' | '))));
r = await call('POST', 'challenge', { to: ids.sergio, date: tomorrow, time: '09:00' }, T.marta); assert.match(r.data.error, /fase regular/);
// juega todo el cuadro de oro
for (let guard = 0; guard < 10; guard++) {
  ms = ok(await call('GET', 'masters', null, T.gero), 'masters');
  const open = ms.tiers[0].rounds.flatMap((r) => r.matches).find((m) => m.p1 && m.p2 && !m.winner);
  if (!open) break;
  const u = Object.keys(ids).find((k) => ids[k] === open.p1.id);
  const mm = ok(await call('POST', `masters/${open.id}/result`, { sets: [[6, 3], [6, 2]] }, T[u]), 'master result').match;
  await sql`update matches set created_at = now() - interval '3 days' where id = ${mm.id}`;
  const log = await runCron(); assert.equal(log.autoConfirmed, 1);
}
ms = ok(await call('GET', 'masters', null, T.gero), 'masters'); console.log('campeón oro:', ms.tiers[0].champion);
assert.ok(ms.tiers[0].champion);
// ── caducidad
const old = ok(await call('POST', 'admin/masters/reset', { confirm: true }, T.gero), 'reset');
ch = ok(await call('POST', 'challenge', { to: ids.gero, date: tomorrow, time: '12:00' }, T.marta), 'ch exp').challenge;
await sql`update challenges set created_at = now() - interval '8 days', updated_at = now() - interval '8 days' where id = ${ch.id}`;
let log = await runCron(); console.log('cron', log); assert.ok(log.expired >= 1);
// ── PIN olvidado
__outbox.length = 0;
ok(await call('POST', 'forgot', { who: 'marta@test.com' }), 'forgot');
const tok = __outbox[0].text.match(/reset\?t=(\S+)/)[1];
const rs = ok(await call('POST', 'reset', { token: tok, pin: '739104' }), 'reset pin');
r = await call('GET', 'me', null, T.marta); assert.equal(r.status, 401);
ok(await call('POST', 'login', { username: 'marta', pin: '739104' }), 'login new pin');
// ── export + borrar cuenta
const csv = await call('GET', 'admin/export?what=matches', null, T.gero); assert.match(csv.data, /jugador1/);
ok(await call('POST', 'me/delete', { pin: '482915' }, T.pablo), 'delete');
r = await call('POST', 'login', { username: 'pablo', pin: '482915' }); assert.equal(r.status, 401);
const adm = ok(await call('GET', 'admin', null, T.gero), 'admin'); console.log('admin players', adm.players.length, 'matches', adm.matches.length);
console.log('FLOW OK');
await sql.end();
