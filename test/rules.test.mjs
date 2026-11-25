import assert from 'node:assert/strict';
import * as R from '../netlify/lib/rules.mjs';
// Elo example from spec: 79 vs 85
const E = R.expected(79, 85); assert.ok(Math.abs(E - 0.334) < 0.002, E);
// sets
assert.equal(R.checkSets([[6,4],[7,5]]).winner, 0);
assert.equal(R.checkSets([[4,6],[7,5],[8,10]]).winner, 1);
assert.equal(R.checkSets([[6,1],[6,2]]).loserGames, 3);
assert.equal(R.checkSets([[6,5]]).ok, false);
assert.equal(R.checkSets([[6,4],[4,6]]).ok, false);
assert.equal(R.checkSets([[9,7]]).ok, true);
assert.equal(R.checkSets([[6,4],[6,3],[6,1]]).ok, false);
assert.equal(R.checkSets([[6,4],[3,6],[10,12]]).winner, 1);
// replay: provisional fast drop 90 vs 70 loses 3x 6-0 6-0
const P=[{id:'a',start_level:90},{id:'b',start_level:70},{id:'c',start_level:70},{id:'d',start_level:70}];
const M=['b','c','d'].map((r,i)=>({id:i+1,p1:'a',p2:r,winner:r,sets:[[0,6],[0,6]],played_on:'2026-11-1'+(2+i)}));
const out=R.replay(P,M); console.log('90 tras 3 derrotas:', out.level.a); assert.ok(out.level.a < 66 && out.level.a > 55);
// spec example non-provisional: 79 beats 85, 6-4 7-5, both with 5+ matches
const P2=[{id:'j',start_level:79},{id:'s',start_level:85}];
// fake history: pretend counts by prepending? test directly formula
const d = 4*(1-R.expected(79,85)); assert.ok(Math.abs(d-2.66)<0.02);
// points & caps
const P3=[{id:'x',start_level:60},{id:'y',start_level:60}];
const M3=[1,2,3].map(i=>({id:i,p1:'x',p2:'y',winner:'x',sets:[[6,4],[6,4]],played_on:'2026-11-1'+i}));
const o3=R.replay(P3,M3); assert.equal(o3.perMatch[3].p1_pts,0); assert.equal(o3.perMatch[1].p1_pts,3); assert.equal(o3.perMatch[1].p2_pts,0);
// week cap: x plays 4 different rivals same week
const P4=[{id:'x',start_level:60},...[1,2,3,4].map(i=>({id:'r'+i,start_level:60}))];
const M4=[1,2,3,4].map(i=>({id:i,p1:'x',p2:'r'+i,winner:'x',sets:[[6,4],[6,4]],played_on:'2026-11-16'}));
const o4=R.replay(P4,M4); assert.equal(o4.perMatch[4].p1_pts,0); assert.equal(o4.perMatch[4].p2_pts,0);
// standings
const ms=M4.map(m=>({...m,...o4.perMatch[m.id]}));
const st=R.standings(P4.map(p=>({...p,level:o4.level[p.id]})),ms,2);
assert.equal(st.qualified.length,1); assert.equal(st.qualified[0].id,'x'); assert.equal(st.qualified[0].pts,9); assert.equal(st.others.length,4);
// seeds
assert.deepEqual(R.seedOrder(8),[1,8,4,5,2,7,3,6]);
const fr=R.firstRound(['a','b','c','d','e','f']); assert.equal(fr.size,8); assert.equal(fr.first[0].p2,null);
assert.equal(R.isoWeek('2026-11-16'),'2026-W47'); assert.equal(R.isoWeek('2026-11-15'),'2026-W46');
assert.equal(R.ageOn('2012-11-12',new Date('2026-11-11T12:00:00Z')),13);
assert.deepEqual(R.shownAttrs({derecha:98,reves:70,slice:68,saque:72,velocidad:72},76,80).derecha,99);
console.log('rules OK');
// nuevo: juegos
{ const P=[{id:'a',start_level:79},{id:'b',start_level:85}];
  const close=R.replay(P,[{id:1,p1:'a',p2:'b',winner:'b',sets:[[6,7],[6,7]],played_on:'2026-11-20'}]);
  const crush=R.replay(P,[{id:1,p1:'a',p2:'b',winner:'b',sets:[[0,6],[0,6]],played_on:'2026-11-20'}]);
  const three=R.replay(P,[{id:1,p1:'a',p2:'b',winner:'b',sets:[[6,4],[3,6],[7,10]],played_on:'2026-11-20'}]);
  console.log('79 pierde 6-7 6-7:', close.perMatch[1].p1_after-79, ' 0-6 0-6:', crush.perMatch[1].p1_after-79, ' 3 sets pts:', three.perMatch[1].p1_pts);
  assert.ok(close.level.a > crush.level.a); assert.equal(three.perMatch[1].p1_pts, 1);
  assert.equal(R.bandOf(7),0); assert.equal(R.bandOf(8),1); assert.equal(R.bandOf(40),3); }
console.log('rules v2 OK');
{ const P=[{id:'a',start_level:95},{id:'b',start_level:60}];
  const o=R.replay(P,[{id:1,p1:'a',p2:'b',winner:'a',sets:[[7,6],[7,6]],played_on:'2026-11-20'}]);
  assert.ok(o.perMatch[1].p1_after>=95 && o.perMatch[1].p2_after<=60, 'ganador no baja'); console.log('ganador no baja OK'); }
// punto extra: gana a alguien 5+ niveles por encima, los dos con 5+ partidos
{ const P=[{id:'a',start_level:60},{id:'b',start_level:70},...[1,2,3,4,5,6,7,8,9,10].map(i=>({id:'f'+i,start_level:60}))];
  // 5 partidos de rodaje para cada uno, en semanas distintas para no chocar con el tope semanal
  const M=[]; let id=1;
  for (let i=0;i<5;i++){ M.push({id:id++,p1:'a',p2:'f'+(i+1),winner:'f'+(i+1),sets:[[6,4],[6,4]],played_on:`2026-10-${String(1+i*7).padStart(2,'0')}`});
                         M.push({id:id++,p1:'b',p2:'f'+(i+6),winner:'b',sets:[[6,4],[6,4]],played_on:`2026-10-${String(1+i*7).padStart(2,'0')}`}); }
  M.push({id:99,p1:'a',p2:'b',winner:'a',sets:[[6,4],[6,4]],played_on:'2026-11-20'});
  const o=R.replay(P,M); assert.equal(o.perMatch[99].p1_pts, 4); assert.equal(o.perMatch[99].p2_pts, 0);
  // en sus primeros partidos no hay extra
  const o2=R.replay([{id:'a',start_level:60},{id:'b',start_level:70}],[{id:1,p1:'a',p2:'b',winner:'a',sets:[[6,4],[6,4]],played_on:'2026-11-20'}]);
  assert.equal(o2.perMatch[1].p1_pts, 3);
  console.log('punto extra OK'); }
// revancha: 1 partido por pareja hasta el día 30; desde el día 30, uno más
{
  const P=[{id:'a',start_level:60},{id:'b',start_level:60}];
  const m=(id,d)=>({id,p1:'a',p2:'b',winner:'a',sets:[[6,4],[6,4]],played_on:d});
  const o=R.replay(P,[m(1,'2026-11-20'),m(2,'2026-11-25'),m(3,'2026-12-18'),m(4,'2026-12-20')],{startsOn:'2026-11-19'});
  assert.equal(o.perMatch[1].p1_pts,3); assert.equal(o.perMatch[2].p1_pts,0);
  assert.equal(o.perMatch[3].p1_pts,3); assert.equal(o.perMatch[4].p1_pts,0);
  assert.equal(R.seasonDay('2026-12-18','2026-11-19'),30);
  console.log('revancha ok');
}
