// Datos de ejemplo (API actual: PIN de 4 cifras, edad, móvil). Para la demo y las pruebas en local.
process.env.DATABASE_URL = 'postgres://postgres:pg@127.0.0.1:5432/ranking';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.ADMIN_USERNAME = 'gero';
process.env.SITE_URL = 'http://localhost:8888';
globalThis.__outbox = []; globalThis.__waOutbox = [];
const { default: api } = await import('../netlify/functions/api.mjs');
const { db } = await import('../netlify/lib/core.mjs');
const sql = db();
await sql`truncate likes, comments, feed, matches, masters, challenges, players restart identity cascade`;
await sql`update season set starts_on = current_date - 22, ends_on = current_date + 37, masters_end = current_date + 51, phase = 'regular', min_matches = 5`;
const call = async (m, p, b, t) => {
  const r = await api(new Request('http://localhost:8888/api/' + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }));
  const d = await r.json(); if (r.status >= 400) throw new Error(p + ': ' + d.error); return d;
};
// usuario, nombre, nivel base, edad, mano
const people = [
  ['gero', 'Gero Duckart', 86, 34, 'diestro'], ['sergio', 'Sergio Jiménez', 84, 41, 'diestro'], ['marta', 'Marta Ruiz', 80, 29, 'zurdo'],
  ['pablo', 'Pablo Ortega', 82, 37, 'diestro'], ['lucia', 'Lucía Navarro', 77, 26, 'diestro'], ['andres', 'Andrés Molina', 79, 45, 'diestro'],
  ['jesus', 'Jesús Fernández', 74, 52, 'diestro'], ['carlos', 'Carlos Peña', 72, 33, 'zurdo'], ['ana', 'Ana Vidal', 70, 31, 'diestro'],
  ['luis', 'Luis Soto', 68, 48, 'diestro'], ['nuria', 'Nuria Cano', 66, 24, 'diestro'], ['david', 'David Romero', 64, 39, 'diestro'],
  ['ines', 'Inés Martín', 62, 16, 'diestro'], ['tomas', 'Tomás Gil', 60, 58, 'diestro'],
];
const T = {}, ID = {};
let ph = 600100100;
for (const [u, n, l, age, hand] of people) {
  const attrs = { derecha: l + 3, reves: l - 2, slice: l - 1, saque: l + 2, velocidad: l - 2 };
  const d = await call('POST', 'signup', { full_name: n, username: u, pin: '4829', age, accept: true, hand, backhand: 'dos', attrs, phone: '+34' + (ph++) });
  T[u] = d.token; ID[u] = d.me.id;
}
const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
let day = 21;
async function play(a, b, sets) {
  const c = (await call('POST', 'challenge', { to: ID[b], date: tomorrow, time: '10:30' }, T[a])).challenge;
  await call('POST', `challenge/${c.id}/respond`, { action: 'accept' }, T[b]);
  await sql`update challenges set play_at = current_date - ${day}::int + time '10:30' where id = ${c.id}`;
  const m = (await call('POST', `challenge/${c.id}/result`, { sets }, T[a])).match;
  await sql`update matches set played_on = current_date - ${day}::int where id = ${m.id}`;
  await call('POST', `match/${m.id}/confirm`, null, T[b]);
  day = Math.max(1, day - 1);
}
const W = [[6, 3], [6, 4]], W2 = [[6, 2], [6, 3]], W3 = [[6, 4], [3, 6], [10, 7]], L = [[4, 6], [3, 6]], L3 = [[4, 6], [6, 3], [5, 7]];
await play('gero', 'sergio', W3);  await play('marta', 'gero', L);     await play('gero', 'pablo', W);
await play('gero', 'lucia', W2);   await play('andres', 'gero', L3);   await play('gero', 'jesus', W);
await play('sergio', 'marta', W);  await play('pablo', 'sergio', L);   await play('sergio', 'lucia', W2);
await play('sergio', 'andres', W); await play('marta', 'pablo', W3);   await play('lucia', 'marta', L);
await play('marta', 'andres', W);  await play('pablo', 'lucia', W);    await play('andres', 'pablo', L3);
await play('lucia', 'andres', W3); await play('jesus', 'carlos', W);   await play('carlos', 'ana', W);
await play('ana', 'luis', W2);     await play('luis', 'nuria', W3);    await play('jesus', 'ana', L);
await play('carlos', 'luis', W);   await play('nuria', 'david', W);    await play('david', 'ines', W);
await play('ines', 'tomas', W2);   await play('jesus', 'luis', W);     await play('carlos', 'nuria', W3);
await play('ana', 'david', W);     await play('luis', 'ines', W);      await play('nuria', 'tomas', W);
// un reto pendiente para Gero (le toca responder) y uno enviado por él
await call('POST', 'challenge', { to: ID.gero, date: tomorrow, time: '18:30', message: '¿Te viene bien el sábado?' }, T.carlos);
await call('POST', 'challenge', { to: ID.ana, date: tomorrow, time: '12:00' }, T.gero);
console.log('seed listo ·', people.length, 'jugadores · gero / 4829');
process.exit(0);
