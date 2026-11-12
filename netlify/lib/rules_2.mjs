/**
 * Ranking ATC — reglas puras (sin base de datos). Las usa el servidor y los tests.
 *
 * Nivel (Elo adaptado a 30–99):
 *   E = 1 / (1 + 10^((rival − yo) / 20))
 *   resultado = 0,75 si ganas (0 si pierdes) + 0,25 × (juegos que ganas / juegos totales)
 *   Δ = K × (resultado − E)
 *   K = 12 en los 5 primeros partidos de cada jugador, después 4.
 *   Así cuentan también los juegos: perder 6-7 6-7 contra alguien mucho mejor casi no resta,
 *   y ganar 6-0 6-0 suma más que ganar 7-6 7-6.
 * Puntos de temporada: victoria 3, derrota en 3 sets 1, derrota en 2 sets 0, +1 si ganas a alguien con 5+ niveles más
 *   (solo si ninguno es provisional). Cuentan como máximo 3 partidos por semana por jugador
 *   y 1 partido por pareja en la temporada. Los Másters no dan puntos.
 */

export const ATTRS = [
  ['derecha', 'Derecha'],
  ['reves', 'Revés'],
  ['slice', 'Slice'],
  ['saque', 'Servicio'],
  ['velocidad', 'Velocidad'],
];
/** Cartas antiguas (1.er y 2.º servicio): servicio = la media de los dos y velocidad = lo que sobra,
 *  así el nivel (la media de las 5 barritas) no cambia. */
export function migrateAttrs(a) {
  if (!a || a.saque != null) return a;
  if (a.saque1 == null) return a;
  const saque = Math.round((a.saque1 + a.saque2) / 2);
  const { saque1, saque2, ...rest } = a;
  return { ...rest, saque, velocidad: Math.max(MIN_LVL, Math.min(MAX_LVL, saque1 + saque2 - saque)) };
}
export const MIN_LVL = 30, MAX_LVL = 99;
export const K_PROV = 12, K_NORMAL = 4, PROV_MATCHES = 5, WIN_WEIGHT = 0.75, GAMES_WEIGHT = 0.25;
export const WEEK_CAP = 3, PAIR_CAP = 1;
export const PTS_WIN = 3, PTS_LOSS = 0, PTS_LOSS_3SETS = 1, PTS_BONUS = 1, BONUS_GAP = 5;
/** Desde este día de la fase regular, solo se puede retar a tu grupo de 8 y a los de al lado. */
export const BAND_FROM_DAY = 30, BAND_SIZE = 8, BAND_LAST = 3;
export const TIERS = [
  ['oro', 'Máster Oro'],
  ['plata', 'Máster Plata'],
  ['bronce', 'Máster Bronce'],
  ['challenger', 'Máster Challenger'],
];
export const CHALLENGER_MAX = 16;

const clamp = (v, lo = MIN_LVL, hi = MAX_LVL) => Math.min(hi, Math.max(lo, v));
const r2 = (v) => Math.round(v * 100) / 100;

/* ── Carta ───────────────────────────────────────────────────────────── */
export function checkAttrs(a) {
  if (!a || typeof a !== 'object') return null;
  const out = {};
  for (const [k] of ATTRS) {
    const v = Number(a[k]);
    if (!Number.isInteger(v) || v < MIN_LVL || v > MAX_LVL) return null;
    out[k] = v;
  }
  return out;
}
export const levelFromAttrs = (a) => r2(ATTRS.reduce((s, [k]) => s + a[k], 0) / ATTRS.length);
/** Barritas que se muestran: la valoración inicial movida lo mismo que el nivel. */
export function shownAttrs(attrs, startLevel, level) {
  attrs = migrateAttrs(attrs);
  const d = Number(level) - Number(startLevel);
  const out = {};
  for (const [k] of ATTRS) out[k] = Math.round(clamp(attrs[k] + d));
  return out;
}

/* ── Edad ────────────────────────────────────────────────────────────── */
/** Lo que se enseña de la edad: nunca la cifra exacta, solo la franja. */
export function ageTag(age) {
  if (!Number.isFinite(age)) return null;
  if (age < 18) return 'Junior';
  if (age < 20) return '+18';
  return '+' + Math.min(60, Math.floor(age / 10) * 10);
}
export function ageOn(birth, today = new Date()) {
  const b = new Date(birth + 'T00:00:00Z');
  if (isNaN(b)) return NaN;
  let a = today.getUTCFullYear() - b.getUTCFullYear();
  const m = today.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < b.getUTCDate())) a--;
  return a;
}

/* ── Marcadores ──────────────────────────────────────────────────────── */
/**
 * sets: [[juegosP1, juegosP2], ...] (1 a 3 sets). El 3.º puede ser super tie-break (a 10).
 * Devuelve { ok, winner: 0|1, loserGames, games: [juegosP1, juegosP2], sets: nº de sets, error }.
 * (el súper tie-break cuenta como 1 juego para quien lo gana)
 */
export function checkSets(sets) {
  if (!Array.isArray(sets) || sets.length < 1 || sets.length > 3) return { ok: false, error: 'Pon entre 1 y 3 sets.' };
  let w0 = 0, w1 = 0, g0 = 0, g1 = 0;
  for (let i = 0; i < sets.length; i++) {
    const s = sets[i];
    if (!Array.isArray(s) || s.length !== 2) return { ok: false, error: 'Marcador no válido.' };
    const [a, b] = s.map(Number);
    if (![a, b].every((x) => Number.isInteger(x) && x >= 0 && x <= 30)) return { ok: false, error: 'Marcador no válido.' };
    if (a === b) return { ok: false, error: `El set ${i + 1} no puede acabar en empate.` };
    const hi = Math.max(a, b), lo = Math.min(a, b);
    const superTb = i === 2 && hi >= 10;
    if (superTb) {
      if (hi - lo < 2 || (hi > 10 && hi - lo !== 2)) return { ok: false, error: 'El super tie-break se gana a 10 con 2 de diferencia.' };
    } else {
      // set normal (a 6, 7-5, 7-6) o set largo hasta 9
      const okSet = (hi >= 6 && hi <= 9 && hi - lo >= 2) || (hi === 7 && lo === 6) || (hi === 9 && lo === 8);
      if (!okSet) return { ok: false, error: `El set ${i + 1} (${a}-${b}) no es un marcador de tenis.` };
    }
    if (a > b) w0++; else w1++;
    g0 += superTb ? (a > b ? 1 : 0) : a;
    g1 += superTb ? (b > a ? 1 : 0) : b;
  }
  if (w0 === w1) return { ok: false, error: 'Alguien tiene que ganar más sets.' };
  if (sets.length === 3 && (w0 === 3 || w1 === 3)) return { ok: false, error: 'Con 3 sets, el ganador gana 2 y pierde 1.' };
  if (sets.length === 2 && w0 !== 2 && w1 !== 2) return { ok: false, error: 'Con 2 sets, falta el tercero.' };
  const winner = w0 > w1 ? 0 : 1;
  return { ok: true, winner, loserGames: winner === 0 ? g1 : g0, games: [g0, g1], sets: sets.length };
}
export const fmtSets = (sets, flip = false) =>
  sets.map(([a, b]) => (flip ? `${b}-${a}` : `${a}-${b}`)).join(' ');

/* ── Elo ─────────────────────────────────────────────────────────────── */
export const expected = (me, rival) => 1 / (1 + Math.pow(10, (rival - me) / 20));
/** Resultado del partido para el Elo: 0,75 por ganar + 0,25 × % de juegos ganados. */
export const matchScore = (won, gameShare) => (won ? WIN_WEIGHT : 0) + GAMES_WEIGHT * gameShare;
/** Grupo de 8 según el puesto (0 = 1.º–8.º, 1 = 9.º–16.º, 2 = 17.º–24.º, 3 = del 25.º en adelante). */
export const bandOf = (index) => Math.min(Math.floor(index / BAND_SIZE), BAND_LAST);
export const bandName = (b) => ['1.º–8.º', '9.º–16.º', '17.º–24.º', 'del 25.º en adelante'][b];

/* Semana ISO de una fecha 'YYYY-MM-DD' */
export function isoWeek(day) {
  const d = new Date(String(day).slice(0, 10) + 'T00:00:00Z');
  const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd + 3);
  const y = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const w = 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

/**
 * Recalcula todo desde cero repitiendo los partidos confirmados en orden.
 * players: [{ id, start_level }]
 * matches: [{ id, p1, p2, winner, sets, walkover, master_id, played_on }] confirmados, en orden.
 * Devuelve { level: {id: n}, count: {id: n}, perMatch: {matchId: {...}} }.
 */
export function replay(players, matches) {
  const level = {}, count = {};
  for (const p of players) { level[p.id] = Number(p.start_level); count[p.id] = 0; }
  const weekUsed = {};   // `${player}|${week}` → partidos que han dado puntos
  const pairUsed = {};   // `${a}|${b}` → partidos de la pareja que han dado puntos
  const perMatch = {};
  for (const m of matches) {
    if (!(m.p1 in level) || !(m.p2 in level)) continue;
    const L1 = level[m.p1], L2 = level[m.p2];
    const prov1 = count[m.p1] < PROV_MATCHES, prov2 = count[m.p2] < PROV_MATCHES;
    const p1Won = m.winner === m.p1;
    const chk = checkSets(m.sets);
    const share1 = chk.ok && chk.games[0] + chk.games[1] > 0 ? chk.games[0] / (chk.games[0] + chk.games[1]) : (p1Won ? 1 : 0);
    const S1 = matchScore(p1Won, share1), S2 = 1 - S1;
    const E1 = expected(L1, L2), E2 = 1 - E1;
    // Quien gana nunca baja y quien pierde nunca sube (aunque el marcador sea ajustado).
    const d1 = p1Won ? Math.max(0, (prov1 ? K_PROV : K_NORMAL) * (S1 - E1)) : Math.min(0, (prov1 ? K_PROV : K_NORMAL) * (S1 - E1));
    const d2 = p1Won ? Math.min(0, (prov2 ? K_PROV : K_NORMAL) * (S2 - E2)) : Math.max(0, (prov2 ? K_PROV : K_NORMAL) * (S2 - E2));
    const threeSets = chk.ok && chk.sets === 3;
    const A1 = r2(clamp(L1 + d1)), A2 = r2(clamp(L2 + d2));

    let pts1 = 0, pts2 = 0;
    if (!m.master_id) {
      const pairKey = [m.p1, m.p2].sort().join('|');
      if ((pairUsed[pairKey] || 0) < PAIR_CAP) {
        pairUsed[pairKey] = (pairUsed[pairKey] || 0) + 1;
        const wk = isoWeek(m.played_on);
        const bonusOk = !prov1 && !prov2;
        const give = (me, won, myL, rivalL) => {
          const key = `${me}|${wk}`;
          if ((weekUsed[key] || 0) >= WEEK_CAP) return 0;
          weekUsed[key] = (weekUsed[key] || 0) + 1;
          if (!won && m.walkover) return 0;           // rechazar no da el punto de participación
          let p = won ? PTS_WIN : threeSets ? PTS_LOSS_3SETS : PTS_LOSS;
          if (won && bonusOk && rivalL - myL >= BONUS_GAP) p += PTS_BONUS;
          return p;
        };
        pts1 = give(m.p1, p1Won, L1, L2);
        pts2 = give(m.p2, !p1Won, L2, L1);
      }
    }
    level[m.p1] = A1; level[m.p2] = A2;
    count[m.p1]++; count[m.p2]++;
    perMatch[m.id] = { p1_before: r2(L1), p1_after: A1, p2_before: r2(L2), p2_after: A2, p1_pts: pts1, p2_pts: pts2 };
  }
  return { level, count, perMatch };
}

/**
 * Clasificación de la temporada.
 * players: [{ id, level, ... }] activos. matches: confirmados con p1_pts/p2_pts.
 * Devuelve { qualified: [...], others: [...] } con pos, zone, pts, pj, won.
 */
export function standings(players, matches, minMatches = PROV_MATCHES) {
  const st = {};
  for (const p of players) st[p.id] = { ...p, pts: 0, pj: 0, won: 0, h2h: {} };
  for (const m of matches) {
    if (m.master_id) continue;
    for (const [me, rv, pts] of [[m.p1, m.p2, m.p1_pts], [m.p2, m.p1, m.p2_pts]]) {
      const s = st[me];
      if (!s) continue;
      s.pts += pts || 0;
      s.pj++;
      if (m.winner === me) { s.won++; s.h2h[rv] = (s.h2h[rv] || 0) + 1; }
    }
  }
  const cmp = (a, b) =>
    b.pts - a.pts || b.won - a.won ||
    ((b.h2h[a.id] || 0) - (a.h2h[b.id] || 0)) ||
    Number(b.level) - Number(a.level) ||
    String(a.full_name || '').localeCompare(String(b.full_name || ''), 'es');
  const all = Object.values(st);
  const qualified = all.filter((s) => s.pj >= minMatches).sort(cmp);
  const others = all.filter((s) => s.pj < minMatches).sort(cmp);
  qualified.forEach((s, i) => { s.pos = i + 1; s.zone = zoneOf(i); });
  others.forEach((s) => { s.pos = null; s.zone = null; s.missing = minMatches - s.pj; });
  for (const s of all) delete s.h2h;
  return { qualified, others };
}
export const zoneOf = (i) => (i < 8 ? 'oro' : i < 16 ? 'plata' : i < 24 ? 'bronce' : 'challenger');

/* ── Cuadros de los Másters ──────────────────────────────────────────── */
/** Orden de cabezas de serie para un cuadro de `size` (potencia de 2): [1, size, ...]. */
export function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}
/**
 * Primera ronda de un cuadro. ids: jugadores ordenados por clasificación (cabeza 1 primero).
 * Devuelve { size, rounds, first: [{slot, p1, p2, seed1, seed2}] } (null = bye).
 */
export function firstRound(ids) {
  const n = ids.length;
  let size = 2;
  while (size < n) size *= 2;
  const order = seedOrder(size);
  const first = [];
  for (let i = 0; i < size / 2; i++) {
    const s1 = order[2 * i], s2 = order[2 * i + 1];
    first.push({ slot: i, p1: ids[s1 - 1] ?? null, p2: ids[s2 - 1] ?? null, seed1: s1 <= n ? s1 : null, seed2: s2 <= n ? s2 : null });
  }
  return { size, rounds: Math.log2(size), first };
}
/** Reparte la clasificación en Másters: 8 + 8 + 8 + el resto (máx. 16) en el Challenger. */
export function mastersGroups(qualifiedIds) {
  const out = {};
  const chunks = [qualifiedIds.slice(0, 8), qualifiedIds.slice(8, 16), qualifiedIds.slice(16, 24), qualifiedIds.slice(24, 24 + CHALLENGER_MAX)];
  TIERS.forEach(([t], i) => { if (chunks[i].length >= 2) out[t] = chunks[i]; });
  return out;
}
export const roundName = (round, rounds) => {
  const left = rounds - round;
  return left === 0 ? 'Final' : left === 1 ? 'Semifinales' : left === 2 ? 'Cuartos' : left === 3 ? 'Octavos' : `Ronda ${round}`;
};
