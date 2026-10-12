/**
 * godbox-powers.js — god powers for the GODBOX sim (pure ES module; acts on godbox-minds + godbox-civ state)
 * ======================================================================================================
 * STATE   state = { world, civ? }   world = minds.createWorldMinds(...), civ = civ.createCiv(world) (optional).
 *         The module keeps its own JSON-serializable bookkeeping in state.powers (created lazily by ensurePowers):
 *         { rs, effects[], sick{id:{t,sev}}, height[]|null, laws{nationId:[...]}, log[] }.
 * COORDS  all x / y / radius are SIM coordinates (world.width x world.height, the same space minds and civ use).
 * DETERMINISM  one seeded RNG (mulberry32 step, state in state.powers.rs, seeded from world.seed) — same seed + same calls
 *         => same results. Never uses Math.random.
 * RESULT  every power returns { ok, id, message, fx: [{kind, x, y, radius, color, duration, ...}], ...data }.
 *         fx are visual hints only (duration in sim days). Land powers also return heightDelta for the renderer.
 * TIME    tickPowers(state, dt) must be called with the same dt (days) you pass to civ.step: it runs timed effects
 *         (rain / drought expiry, plague spread & deaths, reapplied god laws) and returns events [{message, fx}].
 * FREE WILL  NPC responses go through minds.notify (faith / fear / wrath driven by each mind's own traits);
 *         leaders accept or refuse visions by their traits + faith; nothing forces belief.
 */
import * as M from './godbox-minds.js';
import * as V from './godbox-civ.js';

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v === v ? v : a);
const d2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

export const TUNING = {
  rainFert: 0.6, droughtFert: 0.6, rainFoodPerPop: 0.8, droughtFoodLoss: 0.35,
  blessFood: 2, blessStab: 0.12, blessLegit: 0.08, curseFoodLoss: 0.4, curseStab: 0.15, curseLegit: 0.1,
  visionBase: 0.15, plagueSpread: 0.25, plagueDays: 20, plagueDeathK: 0.08, seaLevel: 0, feastFood: 4,
};

// ---------- bookkeeping & rng ----------
export function ensurePowers(state) {
  if (!state.powers) state.powers = { v: 1, rs: ((state.world?.seed ?? 1) * 2246822519 ^ 0x9e3779b9) >>> 0, effects: [], sick: {}, height: null, laws: {}, log: [], nextFx: 1 };
  return state.powers;
}
export function rng(state) {
  const P = ensurePowers(state); const a = (P.rs = (P.rs + 0x6D2B79F5) >>> 0); let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const now = (state) => state.civ ? state.civ.t : state.world.t;
const living = (state) => state.world.minds.filter((m) => m.alive && (!state.civ || (state.civ.people[m.id] && state.civ.people[m.id].died == null)));
export function mindsInRadius(state, x, y, r) { const r2 = r * r; return living(state).filter((m) => d2(m.x, m.y, x, y) <= r2); }
const nationOf = (state, m) => state.civ ? state.civ.nations[state.civ.people[m.id]?.nat] : null;
const nationCenter = (civ, n) => { const mp = civ.map; return { x: (n.capital % mp.gw + 0.5) * mp.ts, y: (((n.capital / mp.gw) | 0) + 0.5) * mp.tsy }; };
const nationMinds = (state, n) => living(state).filter((m) => state.civ.people[m.id].nat === n.id);
const nationRadius = (civ, n) => Math.sqrt(Math.max(1, n.tiles) * civ.map.ts * civ.map.tsy / Math.PI);
function record(state, res) { const P = ensurePowers(state); P.log.push({ t: now(state), id: res.id, message: res.message }); if (P.log.length > 200) P.log.shift(); if (state.civ && res.ok && res.chron !== false) { const e = { y: state.civ.year, type: 'god', text: `${state.civ.year}: ${res.message}`, n: res.nations || [] }; state.civ.chron.push(e); for (const id of e.n) state.civ.nations[id]?.hist.push(e); } return res; }
const fail = (id, message) => ({ ok: false, id, message, fx: [] });
function resolveNation(state, target) {
  const civ = state.civ; if (!civ) return null;
  let id = target?.nation ?? target?.nationId;
  if (id == null && target?.x != null) id = V.nationAt(civ, target.x, target.y);
  if (id == null && target?.person != null) id = civ.people[target.person]?.nat;
  const n = civ.nations[id]; return n && n.alive ? n : null;
}

// ---------- 1. rain / drought ----------
function tilesInRadius(civ, x, y, r) {
  const mp = civ.map, out = [];
  const x0 = Math.max(0, Math.floor((x - r) / mp.ts)), x1 = Math.min(mp.gw - 1, Math.floor((x + r) / mp.ts));
  const y0 = Math.max(0, Math.floor((y - r) / mp.tsy)), y1 = Math.min(mp.gh - 1, Math.floor((y + r) / mp.tsy));
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (d2((tx + 0.5) * mp.ts, (ty + 0.5) * mp.tsy, x, y) <= r * r) out.push(ty * mp.gw + tx);
  return out;
}
export function weather(state, target, params = {}) {
  const kind = params.kind === 'drought' ? 'drought' : 'rain', id = kind;
  const { x, y } = target || {}; if (x == null) return fail(id, 'Weather needs a point or region.');
  const radius = params.radius ?? 120, days = params.days ?? 60, k = clamp(params.intensity ?? 1, 0, 2), wet = kind === 'rain';
  const P = ensurePowers(state), civ = state.civ, changed = [], nations = new Set();
  if (civ) {
    for (const t of tilesInRadius(civ, x, y, radius)) {
      const r = civ.map.res[t]; if (!civ.map.terr[t] || r.fert == null) continue;
      const before = r.fert, after = wet ? before * (1 + TUNING.rainFert * k) : before * (1 - clamp(TUNING.droughtFert * k, 0, 0.95));
      r.fert = after; changed.push([t, after - before]);
      const o = civ.map.own[t]; if (o >= 0) { nations.add(o); const n = civ.nations[o]; if (n.res) n.res.fert = Math.max(0, (n.res.fert || 0) + after - before); }
    }
    for (const id2 of nations) { const n = civ.nations[id2]; if (wet) n.stock.food += n.pop * TUNING.rainFoodPerPop * k * 0.5; else n.stock.food *= 1 - TUNING.droughtFoodLoss * k * 0.5; }
  }
  P.effects.push({ type: 'weather', kind, until: now(state) + days, changed, x, y, radius, k });
  const ms = mindsInRadius(state, x, y, radius);
  M.notify(ms, wet ? { type: 'rain', x, y, radius, intensity: k } : { type: 'famine', x, y, radius, intensity: 0.5 * k, cruel: true }, state.world);
  const names = [...nations].map((i) => civ.nations[i].name);
  return record(state, { ok: true, id, kind, nations: [...nations], affected: ms.length, tiles: changed.length, days,
    message: `${wet ? 'Rain falls' : 'Drought grips the land'} for ${days} days${names.length ? ' over ' + names.join(', ') : ''}: ${changed.length} fields ${wet ? 'flourish' : 'wither'}, ${ms.length} people feel it.`,
    fx: [{ kind, x, y, radius, color: wet ? '#4fb3ff' : '#d9a441', duration: days }] });
}

// ---------- 2. bless / curse nation ----------
export function judgeNation(state, target, params = {}) {
  const kind = params.kind === 'curse' ? 'curse' : 'bless', id = kind + 'Nation';
  const n = resolveNation(state, target); if (!n) return fail(id, 'No living nation there.');
  const civ = state.civ, k = clamp(params.intensity ?? 1, 0, 2), good = kind === 'bless';
  const before = { food: n.stock.food, stability: n.stability, legit: n.leader?.legitimacy ?? null };
  if (good) { n.stock.food += n.pop * TUNING.blessFood * k; n.treasury += n.pop * k; n.stability = clamp(n.stability + TUNING.blessStab * k); if (n.leader) n.leader.legitimacy = clamp(n.leader.legitimacy + TUNING.blessLegit * k); }
  else { n.stock.food *= 1 - TUNING.curseFoodLoss * k * 0.5; n.stock.goods *= 1 - 0.2 * k; n.stability = clamp(n.stability - TUNING.curseStab * k); if (n.leader) n.leader.legitimacy = clamp(n.leader.legitimacy - TUNING.curseLegit * k); }
  const ms = nationMinds(state, n); let faithUp = 0, fearUp = 0, angry = 0;
  const f0 = ms.map((m) => [m.faith, m.fearOfGod, m.wrath || 0]);
  M.notify(ms, good ? { type: 'bless', intensity: k } : { type: 'curse', intensity: k, cruel: true }, state.world);
  ms.forEach((m, i) => {
    if (!good) m.fearOfGod = clamp(m.fearOfGod + 0.15 * k * (1 - 0.6 * m.traits.courage)); // the timid fear more; the brave less
    if (m.faith > f0[i][0] + 1e-9) faithUp++; if (m.fearOfGod > f0[i][1] + 1e-9) fearUp++; if ((m.wrath || 0) > f0[i][2] + 1e-9) angry++;
  });
  const c = nationCenter(civ, n);
  return record(state, { ok: true, id, kind, nation: n.id, nations: [n.id], before, after: { food: n.stock.food, stability: n.stability, legit: n.leader?.legitimacy ?? null }, people: ms.length, faithUp, fearUp, angry,
    message: good ? `You bless ${n.name}: granaries fill and spirits rise. ${faithUp} of ${ms.length} grow in faith; others thank other gods or shrug.`
      : `You curse ${n.name}: stores rot and order frays. ${fearUp} now fear you, ${angry} rage at heaven, ${ms.length - angry} accept it as judgement.`,
    fx: [{ kind, x: c.x, y: c.y, radius: nationRadius(civ, n), color: good ? '#ffd77a' : '#8a2be2', duration: 6 }] });
}

// ---------- 3. vision ----------
export const VISIONS = {
  invention: { label: 'an invention', fit: (T) => T.curiosity * 0.6 + T.ambition * 0.2 },
  peace: { label: 'peace', fit: (T) => T.kindness * 0.6 + (1 - T.temper) * 0.3 },
  war: { label: 'war', fit: (T) => T.temper * 0.4 + T.courage * 0.3 + T.ambition * 0.2 },
  law: { label: 'a new law', fit: (T) => T.ambition * 0.3 + T.diligence * 0.3 + T.kindness * 0.1 },
};
export const LAWS = { tithe: 'Tithes for the temples', mercy: 'Mercy to the defeated', 'free trade': 'Open markets for all', 'low tax': 'Taxes lowered for the poor', 'learning': 'Schools in every town' };
export function vision(state, target, params = {}) {
  const id = 'vision', civ = state.civ; if (!civ) return fail(id, 'Visions need nations (civ layer).');
  const n = resolveNation(state, target); if (!n || !n.leader) return fail(id, 'That nation has no leader to dream.');
  const L = n.leader, m = state.world.byId.get(L.id); if (!m || !m.alive) return fail(id, 'The leader is gone.');
  const idea = VISIONS[params.idea] ? params.idea : 'invention', T = m.traits, law = LAWS[params.law] ? params.law : 'tithe';
  const p = clamp(TUNING.visionBase + m.faith * 0.35 + m.fearOfGod * 0.15 + VISIONS[idea].fit(T) * 0.4 - T.stubbornness * 0.3 - (m.wrath || 0) * 0.2, 0.02, 0.97);
  const roll = rng(state), accepted = roll < p, pol = L.policies, effect = {};
  M.notify(m, { type: 'speak', text: `a vision of ${VISIONS[idea].label}` }, state.world);
  if (accepted) {
    if (idea === 'invention') { pol.research = clamp(pol.research + 0.35); civ.expRate = civ.expRate; ensurePowers(state).effects.push({ type: 'inspire', nation: n.id, leader: L.id, until: now(state) + 360, prev: pol.research - 0.35 }); effect.research = pol.research; }
    if (idea === 'peace') { pol.war = clamp(pol.war - 0.35); for (const k in n.rel) n.rel[k].op = clamp(n.rel[k].op + 0.2, -1, 1); for (const w of civ.wars) if (w.on && (w.a === n.id || w.b === n.id)) { V.godAct(civ, state.world, { type: 'peace', ...nationCenter(civ, n), radius: 1 }); break; } effect.war = pol.war; }
    if (idea === 'war') { pol.war = clamp(pol.war + 0.35); for (const k in n.rel) n.rel[k].op = clamp(n.rel[k].op - 0.2, -1, 1); effect.war = pol.war; }
    if (idea === 'law') { const P = ensurePowers(state); (P.laws[n.id] ||= []).includes(LAWS[law]) || P.laws[n.id].push(LAWS[law]); applyLaws(state);
      if (law === 'tithe') pol.faith = clamp(pol.faith + 0.2); if (law === 'mercy') pol.war = clamp(pol.war - 0.15); if (law === 'free trade') pol.trade = clamp(pol.trade + 0.2); if (law === 'low tax') pol.tax = Math.max(0.03, pol.tax - 0.08); if (law === 'learning') pol.research = clamp(pol.research + 0.15); effect.law = LAWS[law]; }
    L.bio.push(`Had a vision of ${VISIONS[idea].label} in ${civ.year} and heeded it.`);
  } else { L.bio.push(`Had a vision of ${VISIONS[idea].label} in ${civ.year} and rejected it.`); m.memories.push({ type: 'rejected a vision', weight: 0.5, t: state.world.t, about: null, text: idea }); if (m.memories.length > 12) m.memories.shift(); }
  if (L.bio.length > 12) L.bio.splice(0, L.bio.length - 12);
  const c = nationCenter(civ, n);
  const why = accepted ? (T.stubbornness < 0.4 ? 'open-minded' : m.faith > 0.6 ? 'faithful' : 'persuaded') : (T.stubbornness > 0.6 ? 'too stubborn' : m.faith < 0.3 ? 'faithless' : 'unconvinced');
  return record(state, { ok: true, id, idea, law: idea === 'law' ? LAWS[law] : undefined, accepted, chance: +p.toFixed(3), nation: n.id, nations: [n.id], leader: L.id, effect,
    message: `${L.title} ${L.name} of ${n.name} dreams of ${idea === 'law' ? 'a law: “' + LAWS[law] + '”' : VISIONS[idea].label} and ${accepted ? 'embraces it' : 'rejects it'} (${why}, ${(p * 100) | 0}% inclined).`,
    fx: [{ kind: 'vision', x: m.x ?? c.x, y: m.y ?? c.y, radius: 12, color: accepted ? '#b46cff' : '#666a7a', duration: 3, person: L.id }] });
}
function applyLaws(state) { const P = ensurePowers(state); for (const id in P.laws) { const n = state.civ.nations[id]; if (n && n.alive) for (const l of P.laws[id]) if (!n.laws.includes(l)) n.laws.push(l); } }

// ---------- 4. raise / sink land ----------
const TERR_H = [-0.5, 0.25, 0.3, 0.6, 0.9, 0.2]; // per civ terrain class (0 ocean, 1 plain, 2 forest, 3 hills, 4 mountain, 5 desert)
export function heightField(state) {
  const P = ensurePowers(state), civ = state.civ;
  if (!P.height) { if (!civ) return null; P.height = civ.map.terr.map((t) => TERR_H[t] ?? 0.3); }
  return civ ? { gw: civ.map.gw, gh: civ.map.gh, cellW: civ.map.ts, cellH: civ.map.tsy, data: P.height } : null;
}
/** Smooth cosine kernel; apply the same {x,y,radius,amount} to ANY renderer grid. Returns [[index, dh], ...]. */
export function applyHeightKernel(arr, gw, gh, cellW, cellH, k, wrapX = false) {
  const out = [], W = gw * cellW;
  const x0 = Math.floor((k.x - k.radius) / cellW), x1 = Math.floor((k.x + k.radius) / cellW);
  const y0 = Math.max(0, Math.floor((k.y - k.radius) / cellH)), y1 = Math.min(gh - 1, Math.floor((k.y + k.radius) / cellH));
  for (let ty = y0; ty <= y1; ty++) for (let tx0 = x0; tx0 <= x1; tx0++) {
    let tx = tx0; if (wrapX) tx = ((tx % gw) + gw) % gw; else if (tx < 0 || tx >= gw) continue;
    let dx = (tx0 + 0.5) * cellW - k.x; if (wrapX && Math.abs(dx) > W / 2) dx -= Math.sign(dx) * W;
    const d = Math.hypot(dx, (ty + 0.5) * cellH - k.y) / k.radius; if (d > 1) continue;
    const dh = k.amount * 0.5 * (1 + Math.cos(Math.PI * d)), i = ty * gw + tx;
    if (arr) arr[i] += dh; out.push([i, dh]);
  }
  return out;
}
export function shapeLand(state, target, params = {}) {
  const sink = params.kind === 'sink', id = sink ? 'sink' : 'raise';
  const { x, y } = target || {}; if (x == null) return fail(id, 'Shaping land needs a point.');
  const radius = params.radius ?? 60, amount = Math.abs(params.amount ?? 0.4) * (sink ? -1 : 1), civ = state.civ;
  const kernel = { x, y, radius, amount, falloff: 'cosine' };
  let changes = [], newLand = 0, drowned = 0, hf = null;
  if (civ) {
    hf = heightField(state); changes = applyHeightKernel(hf.data, hf.gw, hf.gh, hf.cellW, hf.cellH, kernel);
    for (const [i] of changes) {
      const h = hf.data[i], t = civ.map.terr[i];
      if (t === 0 && h > TUNING.seaLevel) { civ.map.terr[i] = h > 0.75 ? 4 : h > 0.5 ? 3 : 1; civ.map.res[i] = { fert: civ.map.terr[i] === 1 ? 1 : 0.3, ...(h > 0.5 ? { iron: 1 } : {}) }; newLand++; }
      else if (t !== 0 && h <= TUNING.seaLevel) { civ.map.terr[i] = 0; civ.map.res[i] = {}; civ.map.own[i] = -1; drowned++; }
      else if (t !== 0 && t !== 2 && t !== 5) civ.map.terr[i] = h > 0.75 ? 4 : h > 0.5 ? 3 : 1;
    }
  }
  const ms = mindsInRadius(state, x, y, radius);
  M.notify(ms, { type: 'quake', x, y, radius, intensity: Math.min(1, Math.abs(amount)), cruel: true }, state.world);
  return record(state, { ok: true, id, kernel, affected: ms.length, newLand, drowned,
    heightDelta: hf ? { gw: hf.gw, gh: hf.gh, cellW: hf.cellW, cellH: hf.cellH, changes } : { changes: [] },
    message: `The earth ${sink ? 'sinks' : 'rises'} by ${Math.abs(amount).toFixed(2)} across ${radius | 0} paces${newLand ? `; ${newLand} new land tiles rise from the sea` : ''}${drowned ? `; ${drowned} tiles drown` : ''}. ${ms.length} people feel the ground move.`,
    fx: [{ kind: sink ? 'sink' : 'raise', x, y, radius, color: sink ? '#2d6ea8' : '#9c7a4b', duration: 4 }] });
}

// ---------- 5. plague & healing ----------
export function plague(state, target, params = {}) {
  const id = 'plague', { x, y } = target || {}; if (x == null) return fail(id, 'Plague needs a point.');
  const radius = params.radius ?? 25, sev = clamp(params.severity ?? 1, 0.1, 2), P = ensurePowers(state), t = now(state);
  const ms = mindsInRadius(state, x, y, radius); let n = 0;
  for (const m of ms) if (!P.sick[m.id]) { P.sick[m.id] = { t, sev }; n++; }
  P.effects.push({ type: 'plague', spread: params.spread ?? TUNING.plagueSpread, range: params.range ?? 15 });
  M.notify(mindsInRadius(state, x, y, radius * 2), { type: 'plague', x, y, radius, intensity: sev, cruel: true }, state.world);
  return record(state, { ok: true, id, infected: n, message: `A plague breaks out: ${n} fall sick. It will spread to those nearby.`, fx: [{ kind: 'plague', x, y, radius, color: '#6bbf3a', duration: TUNING.plagueDays }] });
}
export function heal(state, target, params = {}) {
  const id = 'heal', { x, y } = target || {}; if (x == null) return fail(id, 'Healing needs a point.');
  const radius = params.radius ?? 30, P = ensurePowers(state), ms = mindsInRadius(state, x, y, radius); let cured = 0;
  for (const m of ms) { if (P.sick[m.id]) { delete P.sick[m.id]; cured++; } m.needs.safety = clamp(m.needs.safety - 0.2); m.needs.rest = clamp(m.needs.rest - 0.3); }
  M.notify(ms, { type: 'heal', x, y, radius }, state.world);
  return record(state, { ok: true, id, cured, touched: ms.length, message: `A healing light: ${cured} of the sick recover; ${ms.length} feel renewed.`, fx: [{ kind: 'heal', x, y, radius, color: '#7dffb0', duration: 3 }] });
}
export function sickCount(state) { return Object.keys(ensurePowers(state).sick).length; }

// ---------- 6. lightning & feast ----------
export function lightning(state, target, params = {}) {
  const id = 'lightning', { x, y } = target || {}; if (x == null) return fail(id, 'Lightning needs a point.');
  const radius = params.radius ?? 20, civ = state.civ;
  const ms = mindsInRadius(state, x, y, radius);
  if (civ) V.godAct(civ, state.world, { type: 'lightning', x, y, radius, cruel: true }); else M.notify(state.world, { type: 'lightning', x, y, radius, cruel: true });
  let struck = null; if (ms.length) { struck = ms.reduce((a, b) => (d2(a.x, a.y, x, y) <= d2(b.x, b.y, x, y) ? a : b)); struck.needs.safety = 1; struck.fearOfGod = clamp(struck.fearOfGod + 0.4); struck.memories.push({ type: 'struck by lightning', weight: -1, t: state.world.t, about: null, text: null }); if (struck.memories.length > 12) struck.memories.shift(); }
  return record(state, { ok: true, id, struck: struck?.id ?? null, witnesses: ms.length,
    message: `Lightning splits the sky${struck ? `; ${struck.name} is thrown to the ground and survives, shaken` : ''}. ${ms.length} witness it.`,
    fx: [{ kind: 'lightning', x, y, radius: 4, color: '#e8f4ff', duration: 0.5 }, { kind: 'scorch', x, y, radius: radius * 0.3, color: '#ff9f1c', duration: 8 }] });
}
export function feast(state, target, params = {}) {
  const id = 'feast', { x, y } = target || {}; if (x == null) return fail(id, 'A feast needs a point.');
  const radius = params.radius ?? 40, civ = state.civ, ms = mindsInRadius(state, x, y, radius), nations = new Set();
  for (const m of ms) { m.needs.hunger = 0; m.needs.belonging = clamp(m.needs.belonging - 0.3); if (civ) { const p = civ.people[m.id]; p.fed = 1; nations.add(p.nat); } }
  if (civ) for (const id2 of nations) civ.nations[id2].stock.food += ms.filter((m) => civ.people[m.id].nat === id2).length * TUNING.feastFood;
  M.notify(ms, { type: 'feed', x, y, radius }, state.world); M.notify(ms, { type: 'miracle', x, y, radius, intensity: 0.5 }, state.world);
  return record(state, { ok: true, id, fed: ms.length, nations: [...nations], message: `A miracle feast appears from nowhere: ${ms.length} eat their fill and wonder who sent it.`, fx: [{ kind: 'feast', x, y, radius, color: '#ffb347', duration: 5 }] });
}

// ---------- ongoing effects ----------
export function tickPowers(state, dt = 1) {
  const P = ensurePowers(state), t = now(state), civ = state.civ, out = [];
  P.effects = P.effects.filter((e) => {
    if (e.type === 'weather' && t >= e.until) {
      if (civ) for (const [i, dv] of e.changed) { const r = civ.map.res[i]; if (r && r.fert != null) r.fert = Math.max(0, r.fert - dv); }
      out.push({ message: `The ${e.kind} ends.`, fx: [] }); return false;
    }
    if (e.type === 'weather' && civ) for (const id of new Set(e.changed.map(([i]) => civ.map.own[i]).filter((o) => o >= 0))) { const n = civ.nations[id]; if (e.kind === 'rain') n.stock.food += n.pop * 0.01 * e.k * dt; else n.stock.food *= 1 - 0.01 * e.k * dt; }
    if (e.type === 'inspire' && t >= e.until) { const n = civ?.nations[e.nation]; if (n?.leader?.id === e.leader) n.leader.policies.research = clamp(Math.max(e.prev, n.leader.policies.research - 0.35)); return false; }
    if (e.type === 'plague') return Object.keys(P.sick).length > 0;
    return true;
  });
  // plague: spread to neighbours, kill a few (by genetic resistance in civ), recover after plagueDays
  const ids = Object.keys(P.sick);
  if (ids.length) {
    const pe = P.effects.find((e) => e.type === 'plague') || { spread: TUNING.plagueSpread, range: 15 };
    const alive = living(state), cell = pe.range, grid = new Map();
    for (const m of alive) { const k = ((m.x / cell) | 0) + ',' + ((m.y / cell) | 0); (grid.get(k) || grid.set(k, []).get(k)).push(m); }
    const newly = [];
    for (const id of ids) {
      const m = state.world.byId.get(+id), s = P.sick[id];
      if (!m || !m.alive || (civ && civ.people[m.id]?.died != null)) { delete P.sick[id]; continue; }
      if (t - s.t > TUNING.plagueDays) { delete P.sick[id]; continue; }
      const cx = (m.x / cell) | 0, cy = (m.y / cell) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const o of grid.get(cx + dx + ',' + (cy + dy)) || [])
        if (!P.sick[o.id] && d2(o.x, o.y, m.x, m.y) <= cell * cell && rng(state) < pe.spread * s.sev * dt * 0.2) newly.push([o, s.sev * 0.97]);
    }
    for (const [o, sev] of newly) if (!P.sick[o.id]) { P.sick[o.id] = { t, sev }; o.needs.safety = clamp(o.needs.safety + 0.2); }
    let dead = 0;
    if (civ) { const sick = new Set(Object.keys(P.sick).map(Number)), before = sick.size; V.plague(civ, state.world, (m) => sick.has(m.id), TUNING.plagueDeathK * dt); const le = civ.chron.pop(); if (civ._ev && civ._ev[civ._ev.length - 1] === le) civ._ev.pop(); for (const i of sick) { const m = state.world.byId.get(i); if (!m.alive || civ.people[i]?.died != null) { delete P.sick[i]; dead++; } } void before; }
    if (newly.length || dead) out.push({ message: `Plague: ${newly.length} newly sick, ${dead} dead, ${Object.keys(P.sick).length} ill.`, fx: newly.slice(0, 50).map(([o]) => ({ kind: 'sick', x: o.x, y: o.y, radius: 2, color: '#6bbf3a', duration: 2, person: o.id })) });
  }
  if (civ) applyLaws(state);
  return out;
}

// ---------- registry ----------
const pt = (t) => t && t.x != null;
export const POWERS = [
  { id: 'rain', name: 'Rain', icon: '🌧️', hotkey: 'R', target: 'region', params: { radius: 120, days: 60, intensity: 1 }, apply: (s, t, p) => weather(s, t, { ...p, kind: 'rain' }) },
  { id: 'drought', name: 'Drought', icon: '☀️', hotkey: 'D', target: 'region', params: { radius: 120, days: 60, intensity: 1 }, apply: (s, t, p) => weather(s, t, { ...p, kind: 'drought' }) },
  { id: 'blessNation', name: 'Bless nation', icon: '✨', hotkey: 'B', target: 'nation', params: { intensity: 1 }, apply: (s, t, p) => judgeNation(s, t, { ...p, kind: 'bless' }) },
  { id: 'curseNation', name: 'Curse nation', icon: '💀', hotkey: 'C', target: 'nation', params: { intensity: 1 }, apply: (s, t, p) => judgeNation(s, t, { ...p, kind: 'curse' }) },
  { id: 'vision', name: 'Vision', icon: '👁️', hotkey: 'V', target: 'nation', params: { idea: 'invention', law: 'tithe', options: { idea: Object.keys(VISIONS), law: Object.keys(LAWS) } }, apply: vision },
  { id: 'raise', name: 'Raise land', icon: '⛰️', hotkey: 'U', target: 'point', params: { radius: 60, amount: 0.4 }, apply: (s, t, p) => shapeLand(s, t, { ...p, kind: 'raise' }) },
  { id: 'sink', name: 'Sink land', icon: '🕳️', hotkey: 'J', target: 'point', params: { radius: 60, amount: 0.4 }, apply: (s, t, p) => shapeLand(s, t, { ...p, kind: 'sink' }) },
  { id: 'plague', name: 'Plague', icon: '🦠', hotkey: 'P', target: 'point', params: { radius: 25, severity: 1, spread: 0.25 }, apply: plague },
  { id: 'heal', name: 'Heal', icon: '❤️', hotkey: 'H', target: 'point', params: { radius: 30 }, apply: heal },
  { id: 'lightning', name: 'Lightning', icon: '⚡', hotkey: 'L', target: 'point', params: { radius: 20 }, apply: lightning },
  { id: 'feast', name: 'Miracle feast', icon: '🍖', hotkey: 'F', target: 'point', params: { radius: 40 }, apply: feast },
];
export const POWER_BY_ID = Object.fromEntries(POWERS.map((p) => [p.id, p]));
/** Convenience: merge defaults, apply, never throw. target: {x,y} | {nation} | {person} (sim coords). */
export function usePower(state, id, target, params = {}) {
  const p = POWER_BY_ID[id]; if (!p) return fail(id, 'Unknown power.');
  if (p.target === 'person' && target?.person == null) return fail(id, 'Pick a person.');
  if ((p.target === 'point' || p.target === 'region') && !pt(target)) return fail(id, 'Pick a place.');
  const { options, ...defs } = p.params;
  try { return p.apply(state, target, { ...defs, ...params }); } catch (e) { return fail(id, 'The power fizzles: ' + e.message); }
}
