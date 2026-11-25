// Datos de ejemplo para probar la app en local.
process.env.DATABASE_URL = 'postgres://postgres:pg@127.0.0.1:5432/ranking';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.ADMIN_USERNAME = 'gero';
globalThis.__outbox = [];
const { default: api } = await import('../netlify/functions/api.mjs');
const { db } = await import('../netlify/lib/core.mjs');
const sql = db();
await sql`truncate comments, feed, matches, masters, challenges, players restart identity cascade`;
await sql`update season set starts_on = current_date - 22, ends_on = current_date + 27, masters_end = current_date + 38, phase = 'regular', min_matches = 5`;
const call = async (m, p, b, t) => { const r = await api(new Request('http://x/api/' + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })); const d = await r.json(); if (r.status >= 400) throw new Error(p + ': ' + d.error); return d; };
const people = [['gero','Gero Fornari',88],['sergio','Sergio Jiménez',85],['marta','Marta Ruiz',81],['pablo','Pablo Ortega',83],['lucia','Lucía Navarro',77],['andres','Andrés Molina',80],['jesus','Jesús Fernández',79],['carlos','Carlos Vega',74],['elena','Elena Castro',72],['raul','Raúl Herrera',76],['ines','Inés Martín',68],['david','David Romero',71],['sara','Sara López',64],['tomas','Tomás Gil',66]];
const T = {}, ID = {};
for (const [u, n, l] of people) {
  const a = { derecha: l + 3, reves: l - 2, slice: l - 1, saque: l + 2, velocidad: l - 2 };
  const d = await call('POST', 'signup', { full_name: n, username: u, email: u + '@test.com', pin: '482915', birth_date: u === 'ines' ? '2010-03-03' : '1988-04-04', accept: true, hand: u === 'marta' || u === 'raul' ? 'zurdo' : 'diestro', backhand: ['sergio','andres'].includes(u) ? 'una' : 'dos', attrs: a });
  T[u] = d.token; ID[u] = d.me.id;
}
const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
let day = 20;
async function play(a, b, sets) {
  const c = (await call('POST', 'challenge', { to: ID[b], date: tomorrow, time: '10:30' }, T[a])).challenge;
  await call('POST', `challenge/${c.id}/respond`, { action: 'accept' }, T[b]);
  await sql`update challenges set play_at = current_date - ${day}::int + time '10:30' where id = ${c.id}`;
  const m = (await call('POST', `challenge/${c.id}/result`, { sets }, T[a])).match;
  await sql`update matches set played_on = current_date - ${day}::int where id = ${m.id}`;
  await call('POST', `match/${m.id}/confirm`, null, T[b]);
  day = Math.max(1, day - 1);
}
const W = [[6,3],[6,4]], L = [[4,6],[3,6]], W3 = [[6,4],[3,6],[10,7]];
const games = [['sergio','marta',W],['pablo','andres',W],['gero','sergio',L],['marta','lucia',W],['jesus','sergio',[[6,4],[7,5]]],['andres','carlos',W],['elena','raul',L],['gero','pablo',W3],
  ['sergio','andres',W],['marta','pablo',L],['lucia','jesus',W],['carlos','elena',W],['raul','david',W],['gero','marta',W],['sergio','lucia',W],['pablo','jesus',W],
  ['andres','marta',L],['carlos','raul',L],['elena','david',W],['gero','andres',W],['sergio','pablo',W3],['marta','carlos',W],['jesus','andres',L],['lucia','raul',W],
  ['ines','sara',W],['david','tomas',W],['gero','lucia',W],['pablo','carlos',W],['jesus','elena',W],['raul','andres',L],['sergio','raul',W]];
for (const [a, b, s] of games) await play(a, b, s);
// Cosas pendientes para Jesús
await call('POST', 'challenge', { to: ID.jesus, date: tomorrow, time: '18:30', message: '¿Revancha el sábado?' }, T.marta);
const c2 = (await call('POST', 'challenge', { to: ID.carlos, date: tomorrow, time: '10:30' }, T.jesus)).challenge;
await call('POST', `challenge/${c2.id}/respond`, { action: 'accept' }, T.carlos);
const c3 = (await call('POST', 'challenge', { to: ID.jesus, date: tomorrow, time: '12:00' }, T.david)).challenge;
await call('POST', `challenge/${c3.id}/respond`, { action: 'accept' }, T.jesus);
await sql`update challenges set play_at = current_date - 1 + time '12:00' where id = ${c3.id}`;
await call('POST', `challenge/${c3.id}/result`, { sets: [[6, 2], [6, 3]] }, T.david);
await call('POST', 'admin/post', { body: 'Quedan 27 días de fase regular. Recordad: 5 partidos como mínimo para entrar en los Másters. ¡A retar!' }, T.gero);
const fd = await call('GET', 'feed', null, T.marta);
const res = fd.posts.find((p) => p.kind === 'result');
await call('POST', `feed/${res.id}/comment`, { body: 'El segundo set fue un partidazo. Revancha la semana que viene.' }, T.marta);
await call('POST', `feed/${res.id}/comment`, { body: '¡Cuando quieras!' }, T.jesus);
console.log('seed ok', (await sql`select count(*) from matches`)[0].count, 'partidos');
const fs = await import("node:fs"); fs.writeFileSync("/tmp/outbox.json", JSON.stringify(globalThis.__outbox.map((m) => m.subject + "\n" + m.text))); await sql.end();
