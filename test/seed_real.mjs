// Datos realistas para el vídeo (reloj falso: jueves 3 dic 2026, día 15 de 60)
import './fakeclock.mjs';
process.env.DATABASE_URL = 'postgres://postgres:pg@127.0.0.1:5432/ranking';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.ADMIN_USERNAME = 'gero';
globalThis.__outbox = [];
const { default: api } = await import('../netlify/functions/api.mjs');
const { db } = await import('../netlify/lib/core.mjs');
const sql = db();
await sql`truncate comments, likes, feed, matches, masters, challenges, players restart identity cascade`;
await sql`update season set name='Temporada 1', starts_on='2026-11-19', ends_on='2027-01-17', masters_end='2027-01-31', phase='regular', min_matches=5 where id=1`;
const call = async (m, p, b, t) => { const r = await api(new Request('http://x/api/' + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })); const d = await r.json(); if (r.status >= 400) throw new Error(p + ' ' + JSON.stringify(d)); return d; };
const people = [['sergio','Sergio Jiménez',86,41],['lucia','Lucía Navarro',84,29],['pablo','Pablo Ortega',83,37],['marta','Marta Ruiz',81,34],['andres','Andrés Molina',80,45],
 ['jesus','Jesús Fernández',79,33],['carlos','Carlos Vega',76,38],['elena','Elena Castro',74,31],['raul','Raúl Herrera',72,52],['david','David Romero',70,27],
 ['laura','Laura Sánchez',68,24],['tomas','Tomás Gil',66,48],['sara','Sara López',64,26],['javier','Javier Moreno',62,44],['ines','Inés Martín',60,16],
 ['nuria','Nuria Peña',58,39],['ivan','Iván Soto',56,30],['alba','Alba Torres',55,22]];
const T = {}, ID = {}, LV = {};
let i = 0;
for (const [u, n, l, age] of people) { i++;
  const a = { derecha: l + 3, reves: l - 2, slice: l - 1, saque: l + 2, velocidad: l - 2 };
  const d = await call('POST', 'signup', { full_name: n, username: u, email: u + '@test.com', pin: '4829', phone: '+3460000' + String(100 + i).padStart(4,'0'), wa_consent: true, age, accept: true, hand: ['marta','raul','tomas'].includes(u) ? 'zurdo' : 'diestro', backhand: ['sergio','andres','raul'].includes(u) ? 'una' : 'dos', attrs: a });
  T[u] = d.token; ID[u] = d.me.id; LV[u] = l;
}
// calendario: semanas reales de la temporada, como mucho 3 partidos por semana y 1 por rival
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const weeks = [['2026-11-19','2026-11-20','2026-11-21','2026-11-22'], ['2026-11-23','2026-11-24','2026-11-25','2026-11-26','2026-11-27','2026-11-28','2026-11-29'], ['2026-11-30','2026-12-01','2026-12-02']];
const U = people.map((p) => p[0]); const used = new Set(); const games = [];
const cap = { carlos: [1, 2, 1] };
for (let w = 0; w < weeks.length; w++) {
  const cnt = {}; const pairs = [];
  for (const a of U) for (const b of U) if (a < b && Math.abs(LV[a] - LV[b]) <= 12) pairs.push([a, b, rnd()]);
  pairs.sort((x, y) => x[2] - y[2]);
  for (const [a, b] of pairs) {
    const lim = (u) => (cap[u] ? cap[u][w] : w === 0 ? 2 : 3);
    if (used.has(a + b) || (cnt[a] || 0) >= lim(a) || (cnt[b] || 0) >= lim(b)) continue;
    if ([a, b].includes('carlos') && [a, b].some((x) => ['jesus', 'pablo', 'marta'].includes(x))) continue;
    used.add(a + b); cnt[a] = (cnt[a] || 0) + 1; cnt[b] = (cnt[b] || 0) + 1;
    games.push([a, b, weeks[w][Math.floor(rnd() * weeks[w].length)]]);
  }
}
games.sort((x, y) => x[2].localeCompare(y[2]));
const tomorrow = '2026-12-04';
const setsFor = (a, b) => { const p = 1 / (1 + Math.pow(10, (LV[b] - LV[a]) / 12)); const aw = rnd() < p; const r = rnd();
  const s = r < .2 ? [[6,4],[4,6],[10,7]] : r < .5 ? [[6,4],[7,5]] : r < .8 ? [[6,3],[6,4]] : [[6,2],[6,1]];
  return aw ? s : s.map(([x, y]) => [y, x]); };
for (const [a, b, d] of games) {
  const c = (await call('POST', 'challenge', { to: ID[b], date: tomorrow, time: '10:30' }, T[a])).challenge;
  await sql`update challenges set created_at = ${new Date()} where id = ${c.id}`;
  await call('POST', `challenge/${c.id}/respond`, { action: 'accept' }, T[b]);
  const hh = ['09:00','10:30','12:00','17:30','19:00'][Math.floor(rnd() * 5)];
  await sql`update challenges set play_at = ${d + ' ' + hh}::timestamp where id = ${c.id}`;
  const m = (await call('POST', `challenge/${c.id}/result`, { sets: setsFor(a, b) }, T[a])).match;
  await sql`update matches set played_on = ${d}::date where id = ${m.id}`;
  await call('POST', `match/${m.id}/confirm`, null, T[b]);
}
await sql`update challenges set promo = false`;
// Para el vídeo: Marta y Carlos jugaron ayer (falta el resultado); Pablo reta a Carlos
const cm = (await call('POST', 'challenge', { to: ID.carlos, date: tomorrow, time: '18:00' }, T.marta)).challenge;
await sql`update challenges set created_at = ${new Date()} where id = ${cm.id}`;
await call('POST', `challenge/${cm.id}/respond`, { action: 'accept' }, T.carlos);
await sql`update challenges set play_at = '2026-12-02 18:00', promo = false where id = ${cm.id}`;
console.log(JSON.stringify({ games: games.length, tokens: { carlos: T.carlos, pablo: T.pablo, marta: T.marta }, ids: ID }));
await sql.end();
