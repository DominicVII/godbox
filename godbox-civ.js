/**
 * godbox-civ.js — civilization layer for the godbox god-sim (pure ES module, no deps beyond sibling modules)
 * ==========================================================================================================
 * Plugs into godbox-minds.js (minds = individual inner lives) and adds jobs, markets, money, open-ended
 * invention, families/dynasties/genetics, nations, diplomacy and war. Deterministic: the civ owns a seeded,
 * serializable RNG (civ.rs) — same seed + same calls => same history. Sibling modules: godbox-culture.js
 * (languages, culture, sports, factions, leaders) and godbox-genetics.js (diploid genomes).
 *
 * API
 *   createCiv(world, opts) -> civ      world = createWorldMinds(seed, {count: 2000, width: 1600, height: 1000})
 *        opts: {seed=world.seed, nations=7, targetPop=world size, expRate=1}. Re-places minds into nations on a generated map.
 *   worldState(civ) -> ws              pass to minds tick(): food/danger/shelter come from the economy & wars
 *   tickCiv(civ, world, dt, actions?) -> events[]   dt in days (as minds). actions = minds tick() output (fights -> feuds).
 *   step(civ, world, dt) -> {actions, events}       convenience: minds tick + civ tick
 *   godAct(civ, world, event)          god acts: forwarded to minds.notify AND given material effect
 *        (plague kills by genetic resistance, famine/flood destroy food, bless/feed/rain add food, war/peace between nations at x,y)
 *   describeNation(civ, id) / nationInfo(civ, id), describeFamily(civ, famId), describePerson(civ, world, id) / personInfo,
 *   describeFaction(civ, factionId), describeSport(civ, nationId, i), describeInvention(civ, itemId),
 *   describeLanguageOf(civ, nationId), personAppearance(civ, id) -> params for a renderer's buildHuman()
 *   techTree(civ) -> {nodes, edges, milestones} (discovered graph only), chronicle(civ, n?) -> entries, stats(civ)
 *   serialize(civ) -> string, deserialize(str) -> civ    (minds world is serialized separately with minds.serialize)
 *   TUNING (mutable), GOODS, JOBS, MILESTONES
 *
 * WHAT IS RULE-DRIVEN vs EMERGENT (honest accounting)
 *   Rules (hand-written "physics"): base materials and their property vectors; 16 process operators (ignite, kiln,
 *   smelt, alloy, forge, draw, vessel, wind, wheel, engine, cell, dynamo, circuit, telegraph, dope, assemble) mapping input
 *   properties to output properties; the functions read off properties (heat, tool, current, gates, net, ledger, auto, rep);
 *   the milestone thresholds that LABEL an item (labels also unlock economic recipes; they never create items).
 *   Emergent: which inputs get combined, in what order, by which nation/person; whether a wired circuit actually closes
 *   (random wiring graph; shorts and open loops fail; Ohm's-law current); names; independent rediscovery; diffusion,
 *   theft and loss; all prices, wages, inequality, wars, splits and successions. There is no tech list: an invention is
 *   any combination whose computed function beats what the inventing nation knows by >4%. Items beyond the milestone
 *   labels (alloys, lamps, batteries, rotors, mixed devices) appear as by-products.
 *   Self-replication: an assembled machine whose properties cover smelting heat, conduction, semiconductors, control gates
 *   and motion lists ITSELF in its recipe; each copy needs metal, silicon and power, copies decay, and are capped per tile.
 *
 * Time: 1 dt = 1 day; economy runs monthly (30 d), demography/politics yearly (360 d).
 */
import * as M from './godbox-minds.js';
import * as C from './godbox-culture.js';
import * as Gn from './godbox-genetics.js';

export const TUNING = { expRate: 0.6, birth: 0.35, warChance: 0.025, splitChance: 0.03, repGrowth: 0.06, repPerTile: 4, blockTarget: 100, coinDifficulty: 20000, feeRate: 0.02,  depthCost: 0.12, halving: 63000 };
export const GOODS = ['food', 'wood', 'stone', 'ore', 'coal', 'oil', 'sand', 'metal', 'glass', 'silicon', 'wire', 'tools', 'power', 'chips', 'machines', 'goods'];
const BASEP = { food: 1, wood: 1, stone: 1, ore: 2, coal: 1.5, oil: 3, sand: 0.8, metal: 6, glass: 5, silicon: 12, wire: 9, tools: 8, power: 2, chips: 40, machines: 80, goods: 4 };
const YEAR = 360, MONTH = 30;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v === v ? v : a);
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
const log2 = Math.log2;
// recipes: in/out per worker-month; req = capability; res = territory resource factor
export const JOBS = {
  farmer: { fit: (m, g) => m.traits.diligence, r: [{ out: { food: 3.2 }, res: 'fert' }] },
  woodcutter: { fit: (m, g) => m.traits.courage * 0.6 + g.strength * 0.5, r: [{ out: { wood: 2.2 }, res: 'forest' }] },
  miner: { fit: (m, g) => m.traits.courage * 0.5 + g.strength * 0.7, r: [{ out: { ore: 1.3 }, res: 'ore' }, { out: { coal: 1.3 }, res: 'coal' }, { out: { stone: 1.6 } }, { out: { sand: 1.6 }, res: 'sand' }, { out: { oil: 1.4 }, res: 'oil', req: 'oil' }] },
  smith: { fit: (m, g) => m.traits.diligence * 0.7 + g.strength * 0.4, r: [{ in: { stone: 1, wood: 0.6 }, out: { tools: 0.6 } }, { in: { ore: 1.2, coal: 0.8 }, out: { metal: 1 }, req: 'metal' }, { in: { metal: 0.8 }, out: { tools: 1.2 }, req: 'metal' }, { in: { metal: 0.7 }, out: { wire: 1.4 }, req: 'wire' }] },
  glazier: { req: 'glass', fit: (m) => m.traits.diligence * 0.6 + m.traits.curiosity * 0.3, r: [{ in: { sand: 1.2, coal: 0.6 }, out: { glass: 1 }, req: 'glass' }, { in: { sand: 1.5, power: 2 }, out: { silicon: 0.8 }, req: 'silicon' }] },
  builder: { fit: (m, g) => m.traits.diligence * 0.5 + g.strength * 0.4, r: [{ in: { wood: 1, stone: 1 }, out: { goods: 1.6 } }, { in: { metal: 0.4, glass: 0.3, wood: 0.5 }, out: { goods: 3 }, req: 'glass' }] },
  trader: { fit: (m) => m.traits.sociability * 0.7 + m.traits.ambition * 0.5, r: [{ in: { food: 0.5 }, out: { goods: 0.6 } }] },
  scholar: { fit: (m, g) => m.traits.curiosity + g.intel * 0.8, r: [] },
  engineer: { req: 'metal', fit: (m, g) => m.traits.curiosity * 0.6 + g.intel * 0.7 + m.traits.diligence * 0.3, r: [{ in: { coal: 1 }, out: { power: 5 }, req: 'power' }, { in: { oil: 0.6 }, out: { power: 6 }, req: 'power' }, { out: { power: 2 }, req: 'power', res: 'water' }, { in: { silicon: 0.5, wire: 0.5, power: 1 }, out: { chips: 1 }, req: 'chips' }, { in: { metal: 2, chips: 1, power: 2 }, out: { machines: 1 }, req: 'machines' }] },
  soldier: { fit: (m, g) => m.traits.courage + m.traits.temper * 0.5 + g.strength * 0.5, r: [] },
  priest: { fit: (m) => m.traits.piety * 1.2 + m.faith * 0.6, r: [] },
  programmer: { req: 'computer', fit: (m, g) => g.intel + m.traits.curiosity * 0.5, r: [{ in: { power: 1 }, out: { goods: 2.5 } }] },
  coinminer: { req: 'ledger', fit: (m, g) => g.intel * 0.6 + m.traits.ambition * 0.6, r: [] },
};
const JOBN = Object.keys(JOBS);

// ---------- RNG (state in civ.rs so serialize keeps the stream) ----------
function R(civ) { const a = (civ.rs = (civ.rs + 0x6D2B79F5) >>> 0); let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const rf = (civ) => civ._r || (civ._r = () => R(civ));
const pick = (civ, a) => a[(R(civ) * a.length) | 0];

// ---------- materials & invention physics ----------
const PK = ['cond', 'hard', 'energy', 'melt', 'semi', 'mag', 'trans', 'flex', 'purity', 'heat', 'motion', 'emf', 'current', 'light', 'signal', 'logic', 'gates', 'net', 'ledger', 'auto', 'rep'];
const P = (o) => { const p = {}; for (const k of PK) p[k] = o[k] || 0; return p; };
const BASE = [
  ['wood', 'forest', { energy: 0.5, hard: 0.2, flex: 0.5, melt: 0.3, purity: 0.6 }], ['stone', null, { hard: 0.6, melt: 0.85, purity: 0.5 }],
  ['clay', 'clay', { hard: 0.25, flex: 0.6, melt: 0.8, purity: 0.5 }], ['river water', 'water', { flex: 1, motion: 0.35, purity: 0.7 }],
  ['sand', 'sand', { trans: 0.15, semi: 0.12, melt: 0.6, purity: 0.2, hard: 0.3 }], ['copper ore', 'copper', { cond: 0.22, hard: 0.4, melt: 0.45, flex: 0.35, purity: 0.3 }],
  ['tin ore', 'tin', { cond: 0.15, hard: 0.3, melt: 0.3, flex: 0.3, purity: 0.3 }], ['iron ore', 'iron', { cond: 0.12, hard: 0.5, melt: 0.65, mag: 0.25, purity: 0.3 }],
  ['lodestone', 'lode', { mag: 0.75, hard: 0.5, melt: 0.7, purity: 0.4 }], ['coal', 'coal', { energy: 0.8, melt: 0.3, purity: 0.5, cond: 0.05 }],
  ['quartz', 'quartz', { trans: 0.4, semi: 0.2, hard: 0.65, melt: 0.9, purity: 0.5 }], ['crude oil', 'oil', { energy: 0.95, flex: 0.9, purity: 0.4 }],
];
const DEV = new Set(['chip', 'board', 'computer', 'network', 'ledger', 'robot', 'machine', 'circuit', 'telegraph', 'engine', 'generator', 'rotor', 'replicator', 'cell']);
const isIngot = (x) => x.shape === 'ingot';
const OPS = {
  ignite: { pre: [(x) => x.p.energy >= 0.3 && x.p.heat < 0.05 && x.shape === 'raw'], f: ([a]) => ({ shape: 'fire', p: { ...a.p, heat: a.p.energy * 0.75, energy: a.p.energy * 0.5 } }) },
  kiln: { pre: [(h) => h.p.heat > 0.2 && h.shape !== 'circuit', (i) => i.p.melt >= 0.7 && i.p.cond < 0.3 && i.p.heat < 0.05 && i.shape === 'raw'], f: ([h, i]) => ({ shape: 'furnace', p: { ...h.p, hard: i.p.hard, heat: Math.min(1, h.p.heat * (1 + 0.45 * i.p.melt)) } }) },
  smelt: { pre: [(o) => o.p.purity < 0.97 && o.p.heat < 0.05 && o.p.energy < 0.3 && o.p.melt > 0.2 && (o.shape === 'raw' || isIngot(o)) && o.p.flex < 0.95, (h) => h.p.heat > 0.2],
    f: ([o, h]) => {
      if (h.p.heat < o.p.melt) return null;
      const q = o.p, pu = Math.min(1, q.purity + 0.45 * (h.p.heat - q.melt + 0.5)), f = pu / q.purity;
      return { shape: 'ingot', p: { ...q, purity: pu, cond: Math.min(1, q.cond * f ** 1.1), semi: Math.min(1, q.semi * f * (h.p.heat >= 0.95 ? 1.5 : 1)), trans: Math.min(1, q.trans * f), hard: Math.min(1, q.hard * (0.85 + 0.25 * pu)), flex: Math.min(1, q.flex + 0.25 * (pu - q.purity)), motion: 0 } };
    } },
  alloy: { pre: [(a) => isIngot(a) && a.p.purity >= 0.5 && a.p.trans < 0.4, (b) => (isIngot(b) && b.p.trans < 0.4) || (b.shape === 'raw' && b.p.energy >= 0.6)],
    f: ([a, b]) => a === b ? null : ({ shape: 'ingot', p: { ...a.p, hard: Math.min(1, Math.max(a.p.hard, b.p.hard) + 0.25 * Math.min(a.p.hard, b.p.hard + 0.2)), cond: (a.p.cond + b.p.cond) / 2 * 0.8, flex: (a.p.flex + b.p.flex) / 2, purity: Math.min(0.95, (a.p.purity + b.p.purity) / 2 + 0.05), mag: Math.max(a.p.mag, b.p.mag) * 0.9, melt: (a.p.melt + b.p.melt) / 2, energy: 0, semi: 0 } }) },
  forge: { pre: [(a) => a.p.hard >= 0.3 && (isIngot(a) || a.shape === 'raw') && a.p.flex < 0.9, (b) => b.p.flex >= 0.3 && b.shape === 'raw'], f: ([a, b]) => ({ shape: 'tool', p: { ...a.p, flex: (a.p.flex + b.p.flex) / 2 } }) },
  draw: { pre: [(a) => isIngot(a) && a.p.cond >= 0.3 && a.p.flex >= 0.4 && a.p.purity >= 0.6], f: ([a]) => ({ shape: 'wire', p: { ...a.p, flex: 0.9 } }) },
  vessel: { pre: [(a) => isIngot(a) && a.p.hard >= 0.5], f: ([a]) => ({ shape: 'vessel', p: { ...a.p } }) },
  wind: { pre: [(w) => w.shape === 'wire', (c) => c.p.mag >= 0.3 && c.shape !== 'wire' && !DEV.has(c.shape)], f: ([w, c]) => ({ shape: 'coil', p: { ...w.p, mag: Math.min(1, c.p.mag * (1 + w.p.cond)) } }) },
  wheel: { pre: [(s) => s.p.motion >= 0.2 && (s.shape === 'raw' || s.shape === 'engine'), (fr) => fr.p.hard >= 0.2 && fr.p.flex >= 0.3 && fr.p.flex < 1], f: ([s, fr]) => ({ shape: 'rotor', p: { ...fr.p, motion: s.p.motion * (0.6 + 0.4 * fr.p.hard), heat: s.p.heat } }) },
  engine: { pre: [(h) => h.p.heat >= 0.5 && h.shape !== 'circuit', (v) => v.shape === 'vessel'], f: ([h, v]) => ({ shape: 'engine', p: { ...v.p, heat: h.p.heat, motion: Math.min(1, h.p.heat * v.p.hard * 1.3) } }) },
  cell: { pre: [(a) => isIngot(a) && a.p.cond >= 0.3, (b) => isIngot(b) && b.p.cond >= 0.3, (e) => e.p.flex >= 0.9 && e.shape === 'raw'],
    f: ([a, b]) => { const e = Math.abs(a.p.hard - b.p.hard) * 0.9 * Math.min(a.p.purity, b.p.purity); return a === b || e < 0.02 ? null : { shape: 'cell', p: { ...a.p, emf: Math.min(0.35, e) } }; } },
  dynamo: { pre: [(r) => r.p.motion >= 0.2, (c) => c.shape === 'coil'], f: ([r, c]) => ({ shape: 'generator', p: { ...c.p, motion: r.p.motion, emf: Math.min(1, r.p.motion * c.p.mag * c.p.cond * 2.5) } }) },
  circuit: { pre: [(s) => s.p.emf >= 0.03 && (s.shape === 'generator' || s.shape === 'cell'), (w) => w.shape === 'wire', (l) => (l.shape !== 'wire' && l.p.cond > 0.05 && l.p.melt >= 0.4 && !DEV.has(l.shape)) || l.shape === 'coil'], f: (x, ctx) => simCircuit(x, ctx) },
  telegraph: { pre: [(c) => c.shape === 'circuit' && c.p.signal > 0, (w) => w.shape === 'wire'], f: ([c, w]) => ({ shape: 'telegraph', p: { ...c.p, signal: Math.min(1, c.p.signal * (1 + w.p.cond) * 1.2) } }) },
  dope: { pre: [(s) => s.p.semi >= 0.5 && s.p.purity >= 0.85 && isIngot(s), (d) => isIngot(d) && d.p.cond >= 0.1],
    f: ([s, d]) => { if (s === d) return null; const semi = Math.min(1, s.p.semi * 1.25), lg = semi * s.p.purity * (1 - Math.abs(d.p.cond - 0.4)); return { shape: 'chip', p: { ...s.p, semi, logic: lg, gates: lg >= 0.5 ? 1 : 0 } }; } },
  assemble: { pre: [(a) => DEV.has(a.shape), (b) => DEV.has(b.shape)], f: ([a, b]) => assemble(a, b) },
};
const OPN = Object.keys(OPS);
function assemble(a, b) {
  const A = a.p, B = b.p, p = {};
  for (const k of PK) p[k] = Math.max(A[k], B[k]);
  p.purity = Math.min(A.purity, B.purity);
  p.gates = A.gates && B.gates ? A.gates + B.gates : Math.max(A.gates, B.gates);
  p.logic = A.logic && B.logic ? Math.min(A.logic, B.logic) : Math.max(A.logic, B.logic);
  if (p.gates > 0 && p.logic < 0.5) p.gates = 0;
  if (p.gates > 32 && !(p.current > 0.05)) p.gates = 32;   // big logic needs a powered circuit in the assembly
  const lg = p.gates > 0 ? log2(p.gates) : 0;
  if (p.gates >= 64 && p.signal > 0.1) p.net = Math.max(p.net, Math.min(1, p.signal * lg / 12));
  if (p.net >= 0.25 && p.gates >= 2048) p.ledger = Math.max(p.ledger, Math.min(1, p.net * lg / 14));
  if (p.motion > 0.2 && p.gates >= 64) p.auto = Math.max(p.auto, Math.min(1, p.motion * Math.min(1, lg / 10) * (0.5 + 0.5 * p.hard)));
  let self = false;
  if (p.auto >= 0.4 && p.heat >= 0.8 && p.cond >= 0.5 && p.semi >= 0.5 && p.gates >= 1024) { p.rep = Math.max(p.rep, p.auto * Math.min(1, p.heat) * Math.min(1, p.semi + 0.2)); self = true; }
  const shape = p.rep >= 0.4 ? 'replicator' : p.auto >= 0.3 ? 'robot' : p.ledger >= 0.25 ? 'ledger' : p.net >= 0.25 ? 'network' : p.gates >= 256 ? 'computer' : p.gates > 1 ? 'board' : 'machine';
  return { shape, p, self };
}
// a wiring graph: S+ (0), S- (1), load terminals (2,3), junctions; wires join nodes; current needs S+ ~ load ~ S- and no short
function simCircuit([src, wire, load], ctx) {
  const { rng, skill } = ctx, nj = (rng() * 3) | 0, N = 4 + nj, uf = Array.from({ length: N }, (_, i) => i);
  const find = (i) => (uf[i] === i ? i : (uf[i] = find(uf[i])));
  const plan = [[0, 2], [3, 1]]; if (nj) { plan[0] = [0, 4]; plan.splice(1, 0, [4, 2]); }
  const segs = plan.length + ((rng() * 2) | 0);
  for (let s = 0; s < segs; s++) {
    const [a, b] = s < plan.length && rng() < skill ? plan[s] : [(rng() * N) | 0, (rng() * N) | 0];
    uf[find(a)] = find(b);
  }
  const same = (a, b) => find(a) === find(b);
  ctx.tries.circuits++;
  if (same(0, 1)) { ctx.tries.short++; return null; }
  if (!((same(0, 2) && same(3, 1)) || (same(0, 3) && same(2, 1)))) { ctx.tries.open++; return null; }
  const Rw = segs * (1 - wire.p.cond) * 0.25 + 0.05, Rl = 0.4 + (1 - load.p.cond) * 0.6, I = Math.min(1, src.p.emf / (0.2 + Rw + Rl));
  const p = { ...load.p, emf: src.p.emf, current: I, cond: Math.max(load.p.cond, wire.p.cond), motion: 0 };
  p.signal = load.p.mag >= 0.3 ? I * load.p.mag : 0;
  p.heat = load.p.melt >= 0.7 && load.p.mag < 0.3 ? Math.min(1, I * 2.2) : 0;
  p.light = load.p.mag < 0.3 ? I * load.p.melt : 0;
  return { shape: 'circuit', p };
}
function Fn(it) {
  const p = it.p, s = it.shape;
  return { heat: p.heat, tool: s === 'tool' ? p.hard * (0.7 + 0.3 * p.purity) : 0, metal: isIngot(it) ? p.purity * Math.max(p.cond, p.hard) : 0, hard: isIngot(it) ? p.hard : 0,
    trans: isIngot(it) ? p.trans : 0, semi: isIngot(it) ? p.semi : 0, wire: s === 'wire' ? p.cond : 0, mag: s === 'coil' ? p.mag : 0, vessel: s === 'vessel' ? p.hard : 0,
    motion: p.motion, emf: p.emf, current: p.current, light: p.light, signal: p.signal, logic: p.logic, gates: p.gates ? log2(p.gates + 1) / 14 : 0, compute: p.gates && p.current > 0.05 ? log2(p.gates + 1) / 14 : 0,
    net: p.net, ledger: p.ledger, auto: p.auto, rep: p.rep };
}
export const MILESTONES = [
  ['fire', (f) => f.heat >= 0.3], ['furnace', (f) => f.heat >= 0.75], ['smelting', (f, it) => it.op === 'smelt' && f.metal >= 0.2 && it.p.trans < 0.3],
  ['glass', (f) => f.trans >= 0.5], ['metallurgy', (f, it) => it.op === 'alloy' && f.hard >= 0.7], ['wire', (f) => f.wire >= 0.4], ['steam engine', (f, it) => it.op === 'engine' && f.motion >= 0.4],
  ['battery', (f, it) => it.op === 'cell' && f.emf >= 0.05], ['generator', (f, it) => it.op === 'dynamo' && f.emf >= 0.1], ['electricity', (f) => f.current >= 0.05],
  ['electric light', (f) => f.light >= 0.2], ['arc furnace', (f, it) => it.op === 'circuit' && f.heat >= 0.95], ['telegraph', (f, it) => it.op === 'telegraph' && f.signal >= 0.25],
  ['silicon', (f) => f.semi >= 0.6], ['transistor', (f) => f.logic >= 0.5], ['computer', (f) => f.compute >= log2(257) / 14], ['network', (f) => f.net >= 0.25],
  ['digital currency', (f) => f.ledger >= 0.25], ['automation', (f) => f.auto >= 0.3], ['self-replication', (f) => f.rep >= 0.4],
];
const NOUN = { ignite: 'fire', kiln: 'furnace', forge: 'tool', draw: 'wire', vessel: 'boiler', wind: 'coil', wheel: 'wheel', engine: 'engine', cell: 'battery', dynamo: 'generator', telegraph: 'telegraph', dope: 'transistor' };
function nounOf(it) {
  if (it.op === 'smelt') return it.p.semi >= 0.6 ? 'silicon' : it.p.trans >= 0.4 ? 'glass' : it.p.mag > 0.15 ? 'iron' : 'metal';
  if (it.op === 'alloy') return it.p.hard >= 0.7 ? 'steel' : 'bronze';
  if (it.op === 'forge') return it.p.hard >= 0.6 ? 'blade' : 'axe';
  if (it.op === 'circuit') return it.p.heat >= 0.3 ? 'arc furnace' : it.p.signal > 0 ? 'electromagnet' : it.p.light >= 0.2 ? 'lamp' : 'circuit';
  if (it.op === 'assemble') return { replicator: 'self-replicating factory', robot: 'automaton', ledger: 'coin ledger', network: 'network', computer: 'computer', board: 'logic board', machine: 'machine' }[it.shape];
  return NOUN[it.op] || it.shape;
}
const sigOf = (op, parts) => op + ':' + parts.slice().sort((a, b) => a - b).join(',');

// ---------- map ----------
function genMap(civ, W, H) {
  const gw = 64, gh = 40, n = gw * gh, rng = rf(civ);
  const oct = (s) => { const cw = Math.ceil(gw / s) + 2, ch = Math.ceil(gh / s) + 2, v = Array.from({ length: cw * ch }, rng);
    return (x, y) => { const fx = x / s, fy = y / s, ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, g = (i, j) => v[(iy + j) * cw + ix + i];
      return (g(0, 0) * (1 - tx) + g(1, 0) * tx) * (1 - ty) + (g(0, 1) * (1 - tx) + g(1, 1) * tx) * ty; }; };
  const e1 = oct(14), e2 = oct(6), e3 = oct(3), w1 = oct(9);
  const terr = [], res = [], own = [];
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const edge = Math.min(x, gw - 1 - x, y, gh - 1 - y) / 6;
    const e = (e1(x, y) * 0.6 + e2(x, y) * 0.3 + e3(x, y) * 0.1) * Math.min(1, 0.55 + edge * 0.45), wet = w1(x, y);
    const t = e < 0.36 ? 0 : e > 0.72 ? 4 : e > 0.62 ? 3 : wet > 0.58 ? 2 : wet < 0.32 ? 5 : 1;
    terr.push(t); own.push(-1);
    const r = {}; const ch = (k, pr) => { if (rng() < pr) r[k] = 1; };
    if (t) {
      ch('water', t === 1 || t === 2 ? 0.25 : 0.1); ch('clay', t === 1 ? 0.3 : 0.1);
      if (t === 2) r.forest = 1; ch('forest', t === 1 ? 0.2 : 0);
      ch('copper', t >= 3 ? 0.18 : 0.02); ch('tin', t >= 3 ? 0.1 : 0.01); ch('iron', t >= 3 ? 0.2 : 0.03); ch('lode', t === 4 ? 0.1 : 0.01);
      ch('coal', t === 3 || t === 2 ? 0.15 : 0.03); ch('quartz', t === 4 ? 0.12 : 0.02); ch('oil', t === 5 ? 0.2 : 0.02); ch('sand', t === 5 ? 0.6 : 0.05);
      r.fert = t === 1 ? 1 : t === 2 ? 0.5 : t === 5 ? 0.15 : 0.3;
    }
    res.push(r);
  }
  for (let i = 0; i < n; i++) if (terr[i]) { const x = i % gw, y = (i / gw) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx >= 0 && xx < gw && yy >= 0 && yy < gh && !terr[yy * gw + xx] && rng() < 0.35) res[i].sand = 1; } }
  return { gw, gh, ts: W / gw, tsy: H / gh, terr, res, own };
}
const tileOf = (civ, x, y) => { const m = civ.map; const tx = clamp((x / m.ts) | 0, 0, m.gw - 1), ty = clamp((y / m.tsy) | 0, 0, m.gh - 1); return ty * m.gw + tx; };

// ---------- creation ----------
export function createCiv(world, opts = {}) {
  const seed = opts.seed ?? world.seed ?? 1;
  const civ = { v: 1, seed, rs: (seed * 2654435761) >>> 0, t: 0, year: 0, nextMonth: MONTH, nextYear: YEAR, W: world.width, H: world.height,
    targetPop: opts.targetPop || Math.max(200, world.minds.length || 2000), nations: [], people: {}, families: {}, items: [], sigs: {}, milestones: {}, chron: [], stats: [],
    coin: null, nextNation: 0, nextFam: 1, nextItem: 0, tries: { experiments: 0, useful: 0, circuits: 0, short: 0, open: 0, rediscovered: 0 }, wars: [], nextWar: 1, phase: 99, expRate: opts.expRate ?? TUNING.expRate };
  civ._ev = [];
  civ.map = genMap(civ, civ.W, civ.H);
  for (const [name, res, p] of BASE) addItem(civ, { name, op: 'gather', shape: 'raw', parts: [], p: P(p), res, base: true }, null, null, true);
  const N = opts.nations || 7, land = [];
  for (let i = 0; i < civ.map.terr.length; i++) if (civ.map.terr[i] && civ.map.terr[i] < 4) land.push(i);
  const centers = [];
  for (let k = 0; k < N; k++) {
    let best = null, bd = -1;
    for (let tries = 0; tries < 40; tries++) { const t = pick(civ, land); let d = 1e9; for (const c of centers) d = Math.min(d, Math.hypot(t % 64 - c % 64, ((t / 64) | 0) - ((c / 64) | 0))); if (d > bd) { bd = d; best = t; } }
    centers.push(best);
  }
  for (const c of centers) makeNation(civ, { tile: c, year: 0 });
  const alive = world.minds.filter((m) => m.alive);
  alive.forEach((m, i) => {
    const n = civ.nations[i % N], cx = (n.capital % civ.map.gw + 0.5) * civ.map.ts, cy = (((n.capital / civ.map.gw) | 0) + 0.5) * civ.map.tsy;
    let x = cx, y = cy;
    for (let tr = 0; tr < 12; tr++) { x = cx + (R(civ) + R(civ) + R(civ) - 1.5) * 110; y = cy + (R(civ) + R(civ) + R(civ) - 1.5) * 110; if (civ.map.terr[tileOf(civ, x, y)]) break; x = cx; y = cy; }
    m.x = clamp(x, 1, civ.W - 1); m.y = clamp(y, 1, civ.H - 1); m.home = { x: m.x, y: m.y };
    const g = Gn.randomGenome(rf(civ), n.freqs); Gn.nudgeTraits(m.traits, g, 0.3);
    m.name = C.personName(n.lang, rf(civ)); m.group = n.id;
    civ.people[m.id] = { id: m.id, name: m.name, sex: m.sex, born: -m.age, nat: n.id, fam: 0, par: [], kids: [], job: 'farmer', w: 20 + R(civ) * 20, coins: 0, sk: 0.6 + R(civ) * 0.6, g, fed: 1, fac: null, gen: 1 };
  });
  for (const n of civ.nations) {
    const mem = alive.filter((m) => civ.people[m.id].nat === n.id);
    n.bank = mem.length * 30; n.treasury = mem.length * 5; n.pop = mem.length;
    for (let i = 0; i < mem.length; i += 5) {
      const grp = mem.slice(i, i + 5), f = makeFamily(civ, n, grp[0].id, 0);
      for (const m of grp) { civ.people[m.id].fam = f.id; f.members++; f.living++; }
      const a = grp.find((m) => m.sex === 'm' && m.age > 18 && m.spouse == null), b = grp.find((m) => m.sex === 'f' && m.age > 18 && m.spouse == null);
      if (a && b) { a.spouse = b.id; b.spouse = a.id; }
    }
  }
  territory(civ, world);
  for (const n of civ.nations) {
    refreshKnown(civ, n);
    for (const m of alive) if (civ.people[m.id].nat === n.id) chooseJob(civ, n, civ.people[m.id], m, true);
    pickLeader(civ, world, n, 'founding');
  }
  log(civ, 'founding', `${civ.nations.length} peoples settle the land: ${civ.nations.map((n) => n.name).join(', ')}.`, civ.nations.map((n) => n.id));
  return civ;
}
function makeNation(civ, { tile, year, lang, cult, parent, gov, color, freqs }) {
  const id = civ.nextNation++, rng = rf(civ);
  const L = lang || C.createLanguage(rng);
  const n = { id, name: C.placeName(L, rng), lang: L, cult: null, gov: gov || 'chiefdom', leader: null, factions: [], laws: [], founded: year, alive: true, capital: tile, tiles: 0, pop: 0,
    K: new Set(), best: {}, caps: {}, price: {}, stock: {}, bank: 0, treasury: 0, gdp: 0, gdpY: 0, gini: 0, foodRatio: 1, shelter: 0.5, jobs: {}, wage: {}, rel: {}, res: {},
    freqs: freqs || Gn.regionalFreqs(rng), machines: 0, replicators: 0, stability: 0.7, exhaustion: 0, parent: parent ?? null, color: color || `hsl(${(id * 137.5) % 360},65%,55%)`, coinHash: 0, inventions: 0, hist: [], pastLeaders: [] };
  n.cult = cult || C.createCulture(rng, L, {});
  for (const s of n.cult.sports) s.origin = s.origin || L.name;
  n.factions = C.createFactions(rng, L, n);
  for (const g of GOODS) { n.price[g] = BASEP[g]; n.stock[g] = g === 'food' ? 60 : g === 'wood' || g === 'stone' ? 30 : 0; }
  civ.nations.push(n);
  if (tile != null) { const m = civ.map, x0 = tile % m.gw, y0 = (tile / m.gw) | 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const x = x0 + dx, y = y0 + dy; if (x < 0 || y < 0 || x >= m.gw || y >= m.gh) continue; const t = y * m.gw + x; if (m.terr[t] && m.own[t] < 0) m.own[t] = id; } }
  return n;
}
function makeFamily(civ, n, founder, year) {
  const f = { id: civ.nextFam++, name: (C.personName(n.lang, rf(civ)) + C.word(n.lang, 'kin', rf(civ)).slice(0, 2)).slice(0, 10), nat: n.id, founder, founded: year, members: 0, living: 0,
    heroes: [], feuds: {}, grudges: {}, legends: [], rulers: [], gen: 1 };
  civ.families[f.id] = f; return f;
}
const fullName = (civ, p) => (p ? `${p.name} ${civ.families[p.fam]?.name || ''}`.trim() : '?');
function addItem(civ, it, nation, person, base) {
  it.id = civ.nextItem++; it.year = civ.year; it.by = nation ? nation.id : null; it.inventor = person ? person.id : null; it.known = 0; it.lost = false;
  it.noun = base ? 'material' : nounOf(it);
  if (!it.name) it.name = C.inventionName(nation.lang, rf(civ), it.noun);
  it.F = Fn(it);
  const sig = sigOf(it.op, it.parts);
  if (it.self) it.parts = [...it.parts, it.id];  // self-replicator: its own recipe contains itself
  civ.items.push(it); civ.sigs[sig] = it.id;
  if (!base) {
    for (const [k, test] of MILESTONES) if (!civ.milestones[k] && test(it.F, it)) {
      civ.milestones[k] = { year: civ.year, nation: nation.id, item: it.id, person: person?.id }; if (!it.milestone) it.milestone = k;
      log(civ, 'milestone', `${civ.year}: ${k.toUpperCase()} — ${person ? fullName(civ, person) + ' of ' : ''}${nation.name} creates the ${it.name}.`, [nation.id], k);
      if (k === 'digital currency') makeCoin(civ, nation, it);
    }
  }
  return it;
}
function learn(civ, n, it) {
  if (!it || n.K.has(it.id)) return false;
  n.K.add(it.id); it.known++; if (it.lost) it.lost = false;
  if (!it.base) { (n.recent || (n.recent = [])).push(it.id); if (n.recent.length > 8) n.recent.shift(); }
  for (const k in it.F) if (it.F[k] > (n.best[k] || 0)) n.best[k] = it.F[k];
  const b = n.best, c = n.caps;
  c.metal = (b.metal || 0) >= 0.2; c.glass = (b.trans || 0) >= 0.5; c.wire = (b.wire || 0) >= 0.4; c.oil = (b.motion || 0) >= 0.4;
  c.power = (b.current || 0) >= 0.05; c.silicon = (b.semi || 0) >= 0.6 && c.power; c.chips = (b.logic || 0) >= 0.5 && c.silicon;
  c.computer = (b.compute || 0) >= log2(257) / 14; c.ledger = (b.ledger || 0) >= 0.25; c.machines = (b.auto || 0) >= 0.3; c.replicator = (b.rep || 0) >= 0.4;
  if (c.replicator && !n.replicators) n.replicators = 1;
  return true;
}
function refreshKnown(civ, n) {
  for (const it of civ.items) {
    if (!it.base || n.K.has(it.id)) continue;
    const r = it.res;
    if (r === 'oil' && !n.caps.oil) continue;
    if (!r || (n.res[r] || 0) > 0) learn(civ, n, it);
  }
}
function log(civ, type, text, nations = [], tag) {
  const e = { y: civ.year, type, text, n: nations, tag };
  civ.chron.push(e); if (civ.chron.length > 4000) civ.chron.splice(0, 500);
  for (const id of nations) { const n = civ.nations[id]; if (n) { n.hist.push(e); if (n.hist.length > 80) n.hist.shift(); } }
  if (civ._ev) civ._ev.push(e);
  return e;
}

// ---------- world state for minds ----------
export function worldState(civ) {
  return {
    food: (m) => { const p = civ.people[m.id]; return p ? clamp(0.25 + 0.6 * p.fed) : 0.5; },
    danger: (m) => { const p = civ.people[m.id]; if (!p) return 0; const n = civ.nations[p.nat]; return n && n.atWar ? (p.job === 'soldier' ? 0.6 : 0.25) : 0; },
    shelter: (m) => { const p = civ.people[m.id]; return p ? clamp(civ.nations[p.nat]?.shelter ?? 0.5) : 0.5; },
  };
}
export function step(civ, world, dt, opts = {}) {
  const ws = civ._ws || (civ._ws = worldState(civ));
  // big crowds: each frame updates a third (or half) of the minds with 3x (2x) dt (minds' optional stride hook) to keep frames short
  const of = opts.stride ?? (world.minds.length > 1200 ? 3 : world.minds.length > 600 ? 2 : 1);
  const k = (civ.sk = ((civ.sk || 0) + 1) % of);
  const actions = M.tick(world, of > 1 ? { ...ws, stride: { k, of } } : ws, dt);
  return { actions, events: tickCiv(civ, world, dt, actions) };
}

// ---------- main tick ----------
export function tickCiv(civ, world, dt = 1, actions) {
  civ._ev = []; civ.t += dt;
  if (actions) for (const a of actions) if ((a.action === 'fight' || a.action === 'feud') && a.target != null) feud(civ, world, a.id, a.target, a.action === 'fight');
  while (civ.t >= civ.nextMonth) { civ.nextMonth += MONTH; monthly(civ, world); }
  while (civ.t >= civ.nextYear) { civ.nextYear += YEAR; while (civ.phase < PHASES.length) PHASES[civ.phase++](civ, world); civ.year++; civ.phase = 0; }
  if (civ.phase < PHASES.length) PHASES[civ.phase++](civ, world);
  return civ._ev;
}
function living(civ, world) { const out = []; for (const m of world.minds) if (m.alive) { const p = civ.people[m.id]; if (p && p.died == null) out.push([p, m]); } return out; }
function feud(civ, world, aId, bId, fight) {
  const a = civ.people[aId], b = civ.people[bId]; if (!a || !b || a.fam === b.fam) return;
  const fa = civ.families[a.fam], fb = civ.families[b.fam]; if (!fa || !fb) return;
  fa.feuds[fb.id] = Math.min(3, (fa.feuds[fb.id] || 0) + (fight ? 0.1 : 0.03)); fb.feuds[fa.id] = Math.min(3, (fb.feuds[fa.id] || 0) + (fight ? 0.12 : 0.03));
  if (fight && R(civ) < 0.004) {
    const v = world.byId.get(bId);
    if (v && v.alive) { kill(civ, world, b, v, 'killed in a brawl', aId); fb.feuds[fa.id] = 3; fb.legends.push(`${civ.year}: ${fullName(civ, b)} was slain by ${fullName(civ, a)}`); if (fb.legends.length > 10) fb.legends.shift(); log(civ, 'feud', `${civ.year}: ${fullName(civ, a)} kills ${fullName(civ, b)}; the ${fb.name} swear vengeance on the ${fa.name}.`, [a.nat]); }
  }
}

// ---------- economy (monthly) ----------
function monthly(civ, world) {
  const L = living(civ, world), byN = civ.nations.map(() => []);
  for (const pm of L) { const n = civ.nations[pm[0].nat]; if (n && n.alive) byN[n.id].push(pm); }
  for (const n of civ.nations) if (n.alive) economy(civ, n, byN[n.id]);
  trade(civ); research(civ, byN); mining(civ, byN); war(civ, world, byN);
  const m2 = civ.map;
  for (const [p, m] of L) {   // keep minds in bounds and on land
    m.x = clamp(fin(m.x, 1), 1, civ.W - 1); m.y = clamp(fin(m.y, 1), 1, civ.H - 1);
    if (!m2.terr[tileOf(civ, m.x, m.y)]) { const c = civ.nations[p.nat].capital; m.x += (((c % m2.gw) + 0.5) * m2.ts - m.x) * 0.3; m.y += ((((c / m2.gw) | 0) + 0.5) * m2.tsy - m.y) * 0.3; }
  }
}
function prodEff(n) {
  const b = n.best, workers = Math.max(1, n.pop * 0.6);
  const auto = Math.min(1, n.machines / (workers * 0.5)) * (b.auto || 0);
  return (1 + 0.8 * (b.tool || 0)) * (1 + 0.4 * (b.motion || 0)) * (1 + 1.5 * auto) * (0.6 + 0.4 * n.stability);
}
function resF(n, r) { if (!r) return 1; if (r === 'fert') return clamp((n.res.fert || 0) / Math.max(1, n.pop / 12), 0.25, 1.3); return clamp((n.res[r] || 0) / 3, 0, 1.4); }
function economy(civ, n, ppl) {
  const pr = n.price, st = n.stock, cnt = {}, sks = {}, dem = {}, sup = {};
  for (const g of GOODS) { dem[g] = 0; sup[g] = 0; }
  let adults = 0;
  for (const [p] of ppl) { if (p.job === 'child' || p.job === 'elder') continue; adults++; cnt[p.job] = (cnt[p.job] || 0) + 1; sks[p.job] = (sks[p.job] || 0) + p.sk; }
  n.jobs = cnt; n.pop = ppl.length;
  const eff = prodEff(n); let gdp = 0, rg = 0; const rev = {};
  if (n.replicators > 0) {   // self-replicating factories: grow only while metal, silicon and power last; decay; capped by land
    const capR = n.tiles * TUNING.repPerTile;
    const want = Math.max(0, Math.min(n.replicators * TUNING.repGrowth * (n.best.rep || 0), capR - n.replicators));
    const can = Math.max(0, Math.min(want, st.metal / 4, st.silicon, st.power / 6));
    st.metal -= can * 4; st.silicon -= can; st.power -= can * 6; dem.metal += want * 4; dem.silicon += want; dem.power += want * 6;
    const upkeep = n.replicators * 0.5, run = clamp(st.power / Math.max(1e-9, upkeep)); st.power -= upkeep * run; dem.power += upkeep;   // they run on electricity
    n.replicators = Math.max(0, n.replicators + can * run - n.replicators * (0.01 + 0.03 * (1 - run)));
    const o = n.replicators * 0.5 * run; st.machines += o * 0.3; st.ore += o * 1.5 * (n.res.ore ? 1 : 0.3); st.sand += o; st.goods += o * 2;
    gdp += o * (0.3 * pr.machines + 1.5 * pr.ore + pr.sand + 2 * pr.goods) * 0.3;
  }
  for (const j in cnt) {
    const J = JOBS[j]; rev[j] = 0; if (!J || !J.r.length) continue;
    const rs = J.r.filter((r) => !r.req || n.caps[r.req]);
    if (!rs.length) continue;
    const mg = rs.map((r) => { let v = 0; for (const g in r.out) v += r.out[g] * pr[g] * resF(n, r.res); for (const g in (r.in || {})) v -= r.in[g] * pr[g]; return Math.max(0, v); });
    const tot = mg.reduce((a, b) => a + b * b, 0);
    const skAvg = sks[j] / cnt[j];
    rs.forEach((r, i) => {
      const share = tot > 1e-12 ? mg[i] * mg[i] / tot : 1 / rs.length;
      const want = cnt[j] * share * eff * skAvg * (r.res ? resF(n, r.res) : 1);
      let ratio = 1;
      for (const g in (r.in || {})) { const need = want * r.in[g]; dem[g] += need; ratio = Math.min(ratio, need > 0 ? st[g] / need : 1); }
      ratio = clamp(ratio);
      let val = 0;
      for (const g in (r.in || {})) { st[g] -= want * r.in[g] * ratio; val -= want * r.in[g] * ratio * pr[g]; }
      for (const g in r.out) { const q = want * r.out[g] * ratio; st[g] += q; sup[g] += q; val += q * pr[g]; rg += q * BASEP[g]; }
      rev[j] += Math.max(0, val); gdp += Math.max(0, val);
    });
  }
  // consumption
  const kids = ppl.length - adults, foodNeed = adults + kids * 0.5, goodsNeed = ppl.length * 0.25, powerNeed = n.caps.power ? ppl.length * 0.3 : 0;
  dem.food += foodNeed; dem.goods += goodsNeed; dem.power += powerNeed;
  const fr = clamp(st.food / Math.max(1, foodNeed)); st.food -= foodNeed * fr; n.foodRatio = fr;
  const gr = clamp(st.goods / Math.max(1, goodsNeed)); st.goods -= goodsNeed * gr;
  const pwr = powerNeed ? clamp(st.power / powerNeed) : 0; st.power -= powerNeed * pwr;
  n.shelter = clamp(0.25 + 0.5 * gr + 0.25 * pwr);
  dem.tools += adults * 0.05; st.tools -= Math.min(st.tools, adults * 0.05);
  if (n.caps.machines) dem.machines += adults * 0.02;
  for (const g of GOODS) {
    const S = st[g] + sup[g] * 0.5, D = dem[g];
    if (D + S > 0.01) pr[g] = clamp(pr[g] * Math.exp(0.15 * Math.tanh(2 * (D - S) / (D + S + 0.01))), BASEP[g] * 0.05, BASEP[g] * 40);
    st[g] = Math.max(0, fin(st[g]) * (g === 'food' ? 0.92 : g === 'power' ? 0.5 : 0.99));
  }
  n.machines = st.machines = Math.max(0, st.machines * 0.98);
  n.chipsMade = (n.chipsMade || 0) + sup.chips;
  // wages come out of the national bank and spending flows back in: money is conserved
  const tax = n.leader ? n.leader.policies.tax : 0.12; let W = 0;
  for (const j in rev) W += rev[j];
  const scale = W > 0 ? Math.min(1, n.bank / W) : 0;
  n.bank -= W * scale; let taxed = 0;
  const avgW = adults ? (W * scale) / adults : 0;
  const stateJobs = { soldier: 1.1, priest: 0.6, scholar: 0.6 + 0.8 * (n.leader?.policies.research || 0.5), engineer: 0.9, programmer: 0.9, coinminer: 0 };
  let stateBill = 0; for (const j in stateJobs) stateBill += (cnt[j] || 0) * avgW * stateJobs[j];
  const sscale = stateBill > 0 ? Math.min(1, n.treasury / stateBill) : 0;
  n.treasury -= stateBill * sscale;
  const wsum = {};
  for (const [p] of ppl) {
    let w = 0; const j = p.job;
    if (rev[j]) w = rev[j] * scale * p.sk / sks[j];
    else if (stateJobs[j]) w = avgW * stateJobs[j] * sscale;
    const t = rev[j] ? w * tax : 0; taxed += t; p.w += w - t; p.lastW = w;
    wsum[j] = (wsum[j] || 0) + w;
    const fc = pr.food * (j === 'child' ? 0.5 : 1) * fr;
    if (p.w >= fc) { p.w -= fc; p.fed = fr; n.bank += fc; } else { p.fed = Math.max(fr * 0.55, fr * (fc > 0 ? Math.max(0, p.w) / fc : 1)); n.bank += Math.max(0, p.w); p.w = 0; } // the poor live on kin & charity
    const spend = p.w * 0.06; p.w -= spend; n.bank += spend;
    p.w = fin(p.w);
  }
  n.wage = {}; for (const j in wsum) if (cnt[j]) n.wage[j] = wsum[j] / cnt[j];
  for (const j of JOBN) {   // what a newcomer could expect to earn: best recipe margin at current prices (or state pay)
    if (n.wage[j] != null && cnt[j] > 3) continue;
    const J = JOBS[j]; if (J.req && !n.caps[J.req]) { n.wage[j] = 0; continue; } let best = stateJobs[j] != null ? avgW * stateJobs[j] * sscale : 0;
    for (const r of J.r) { if (r.req && !n.caps[r.req]) continue; let v = 0; for (const g in r.out) v += r.out[g] * pr[g] * resF(n, r.res); for (const g in (r.in || {})) v -= r.in[g] * pr[g]; best = Math.max(best, v * eff * (1 - tax)); }
    n.wage[j] = best;
  }
  if (civ.coin && n.caps.ledger) {
    const c = civ.coin; n.wage.coinminer = Math.max(0, (c.reward * TUNING.blockTarget * c.price + (c.pool || 0) + (c.fees || 0)) / ((c.miners || 0) + 3) - 3 * pr.power);
    for (const [p] of ppl) if (p.coins > 0 && p.job === 'coinminer') { const q = Math.min(p.coins * 0.1, n.bank * 0.002 / Math.max(1e-9, c.price)); p.coins -= q; p.w += q * c.price; n.bank -= q * c.price; }
  }
  n.treasury = Math.max(0, n.treasury + taxed); n.gdp = gdp; n.gdpY += gdp; n.rgdp = rg; n.rgdpY = (n.rgdpY || 0) + rg;
  if (n.bank < ppl.length * 3) { const mint = ppl.length * 0.5; n.bank += mint; n.minted = (n.minted || 0) + mint; }   // central bank keeps money circulating
  const reserve = ppl.length * 4;   // public works: the state spends what it does not need back into the economy
  if (n.treasury > reserve) { const sp = (n.treasury - reserve) * 0.25; n.treasury -= sp; n.bank += sp; }
}
function trade(civ) {
  const NS = civ.nations;
  for (const a of NS) if (a.alive) for (const bid in a.rel) {
    const b = NS[bid], r = a.rel[bid]; if (!b || !b.alive || b.id < a.id || r.embargo || r.war) continue;
    if (!r.trade && !(r.border > 0)) continue;
    const cap = ((a.jobs.trader || 0) + (b.jobs.trader || 0)) * 2 * (1 + Math.max(a.best.motion || 0, b.best.motion || 0)) * (r.trade ? 1 : 0.3) + 1;
    let vol = 0;
    for (const g of GOODS) {
      if (g === 'power') continue;
      const [lo, hi] = a.price[g] < b.price[g] ? [a, b] : [b, a];
      if (lo.price[g] * 1.25 >= hi.price[g] || lo.stock[g] < 1) continue;
      const mid = (lo.price[g] + hi.price[g]) / 2, q = Math.min(cap / 6, lo.stock[g] * 0.2), pay = Math.min(q * mid, hi.bank * 0.05);
      if (!(pay > 0)) continue;
      const qq = pay / mid; lo.stock[g] -= qq; hi.stock[g] += qq; hi.bank -= pay; lo.bank += pay; vol += pay;
    }
    r.vol = vol; if (b.rel[a.id]) b.rel[a.id].vol = vol;
  }
}

// ---------- invention (monthly) ----------
function research(civ, byN) {
  for (const n of civ.nations) {
    if (!n.alive) continue;
    const sch = byN[n.id].filter(([p]) => p.job === 'scholar' || p.job === 'engineer' || p.job === 'programmer');
    if (!sch.length) continue;
    const pol = n.leader?.policies.research ?? 0.5;
    const rate = sch.length * 0.03 * (0.5 + pol) * civ.expRate * (1 + (n.best.compute || 0));
    const known = []; let kn = 0; for (const id of n.K) { const it = civ.items[id]; if (it && !it.lost) { known.push(it); if (!it.base) kn++; } }
    const r2 = rate * (0.15 + 0.85 * Math.min(1, kn / 30));   // pre-literate societies experiment slowly
    const k = Math.min(10, Math.floor(r2) + (R(civ) < r2 % 1 ? 1 : 0));
    if (!k) continue;
    for (let e = 0; e < k; e++) {
      const [p, m] = pick(civ, sch); const g = Gn.phenotype(p.g);
      experiment(civ, n, known, p, clamp(0.25 + g.intel * 0.4 + m.traits.curiosity * 0.25 + p.sk * 0.1));
    }
  }
}
const score = (it) => { let s = 0; for (const k in it.F) s += it.F[k]; return s + (it.p.gates ? log2(it.p.gates) * 0.1 : 0); };
function experiment(civ, n, known, person, skill) {
  civ.tries.experiments++;
  // inventors start from something (usually something new) and ask "what can I do with this?"
  const recent = n.recent || (n.recent = []);
  const seed = recent.length && R(civ) < 0.6 ? civ.items[pick(civ, recent)] : pick(civ, known);
  if (!seed) return;
  const fits = []; for (const o of OPN) OPS[o].pre.forEach((pre, i) => { if (pre(seed)) fits.push([o, i]); });
  if (!fits.length) return;
  const [opn, slot] = pick(civ, fits), op = OPS[opn], inp = [];
  for (let si = 0; si < op.pre.length; si++) {
    if (si === slot) { inp.push(seed); continue; }
    const pre = op.pre[si], cand = known.filter(pre); if (!cand.length) return;
    let it; const u = R(civ);
    if (u < 0.35) {   // build on the same kind of thing (chip + chip -> board), favouring the most advanced copy
      const same = cand.filter((x) => x.shape === seed.shape); if (same.length) { same.sort((a, b) => score(b) - score(a)); it = same[(R(civ) * Math.min(2, same.length)) | 0]; }
    }
    if (!it && u < 0.7) { cand.sort((a, b) => (b.year - a.year) * 0.02 + score(b) - score(a)); it = cand[(R(civ) * Math.min(4, cand.length)) | 0]; }
    if (!it) it = pick(civ, cand);
    inp.push(it);
  }
  // deeper chains are harder to get right
  const depth = 1 + Math.max(...inp.map((x) => x.d || 0));
  if (R(civ) > 1 / (1 + TUNING.depthCost * depth ** 1.4) * (0.6 + skill * 0.6)) return;
  const parts = inp.map((x) => x.id), sig = sigOf(opn, parts);
  const ex = civ.sigs[sig];
  if (ex != null && ex >= 0) { if (!n.K.has(ex)) { learn(civ, n, civ.items[ex]); civ.tries.rediscovered++; if (civ.items[ex].known === 1) log(civ, 'invention', `${civ.year}: ${n.name} rediscovers the lost ${civ.items[ex].name}.`, [n.id]); } return; }
  if (ex === -1 && R(civ) < 0.9) return;
  const out = op.f(inp, { rng: rf(civ), skill, tries: civ.tries });
  if (!out) return;
  for (const k of PK) out.p[k] = clamp(fin(out.p[k]), 0, k === 'gates' ? 1e9 : 1);
  const it = { op: opn, parts, shape: out.shape, p: out.p, self: out.self };
  if (opn === 'assemble' && it.p.gates > 64 && it.p.gates > Math.max(...inp.map((x) => x.p.gates || 0))) {
    // building the prototype costs real silicon, metal and power; density improves with chips the economy has made (learning curve)
    const dens = 64 * (1 + (n.chipsMade || 0)) ** 0.9, k = it.p.gates / dens, st = n.stock;
    if (st.silicon < k || st.metal < k * 0.5 || st.power < k) { civ.tries.tooCostly = (civ.tries.tooCostly || 0) + 1; return; }
    st.silicon -= k; st.metal -= k * 0.5; st.power -= k;
  }
  const F = Fn(it); let useful = false;
  for (const f in F) if (F[f] > (n.best[f] || 0) * 1.04 + 0.01) { useful = true; break; }
  if (!useful) { civ.sigs[sig] = -1; return; }
  civ.tries.useful++;
  it.d = Math.max(...inp.map((x) => x.d || 0)) + 1;
  const item = addItem(civ, it, n, person);
  learn(civ, n, item); n.inventions++; known.push(item);
  const f = civ.families[person.fam];
  if (f && (item.milestone || R(civ) < 0.05)) { f.heroes.push(`${civ.year}: ${fullName(civ, person)} invented the ${item.name}`); if (f.heroes.length > 12) f.heroes.shift(); }
  if (!item.milestone && R(civ) < 0.12) log(civ, 'invention', `${civ.year}: ${fullName(civ, person)} of ${n.name} invents the ${item.name} (${item.noun}).`, [n.id]);
}

// ---------- digital currency ----------
function makeCoin(civ, n, it) {
  if (civ.coin) return;
  civ.coin = { name: C.word(n.lang, 'coin', rf(civ)).replace(/^./, (c) => c.toUpperCase()) + 'coin', nation: n.id, item: it.id, year: civ.year, supply: 0, height: 0, difficulty: TUNING.coinDifficulty, reward: 50, price: 1, hashLast: 0, powerLast: 0, fees: 0, txVol: 0, history: [] };
  log(civ, 'economy', `${civ.year}: the ${civ.coin.name} ledger goes live in ${n.name}: coins are minted only by spending electricity on proof-of-work.`, [n.id]);
}
function mining(civ, byN) {
  const c = civ.coin; if (!c) return;
  let H = 0, Pw = 0, nm = 0; const per = [];
  for (const n of civ.nations) {
    n.coinHash = 0;
    if (!n.alive || !n.caps.ledger) continue;
    const miners = byN[n.id].filter(([p]) => p.job === 'coinminer'); nm += miners.length; if (!miners.length) continue;
    const pw = Math.min(n.stock.power, miners.length * 3);
    n.stock.power -= pw; Pw += pw; n.price.power *= 1 + Math.min(0.05, pw / Math.max(1, n.pop) * 0.05);
    const h = pw * (1 + 4 * (n.best.compute || 0)) * 10; H += h; per.push([n, miners, h]); n.coinHash = h;
  }
  const lam = H / c.difficulty;
  let blocks = Math.max(0, Math.round(lam + Math.sqrt(lam) * (R(civ) + R(civ) + R(civ) - 1.5) * 1.4));
  const reward = 50 / 2 ** Math.floor(c.height / TUNING.halving);
  const minted = reward < 1e-6 ? 0 : blocks * reward; c.height += blocks; c.supply += minted; c.hashLast = H; c.powerLast = Pw; c.reward = reward; c.miners = nm;
  // real demand: adopters settle a share of their transactions on the ledger and keep some savings in coin
  let tx = 0, sav = 0;
  for (const n of civ.nations) {
    if (!n.alive || !n.caps.ledger) continue;
    n.coinUse = clamp((n.coinUse || 0) + 0.004 * (0.5 + (n.leader?.policies.trade ?? 0.5)));
    tx += n.gdp * n.coinUse * 0.3; sav += n.bank * 0.02 * n.coinUse;
  }
  c.txVol = tx;
  const target = (tx * 2 + sav * 4) / Math.max(1, c.supply);
  c.price = clamp(c.price * 0.9 + target * 0.1, 1e-6, 1e6);
  // transaction fees (paid in money by the adopting economies) go to whoever secures the blocks
  // fees accrue in a mempool every month whether or not blocks are found, so an idle ledger
  // builds up a bounty that pulls miners back (this is what sustains mining after halvings)
  for (const n of civ.nations) { if (!n.alive || !n.caps.ledger || !n.coinUse) continue; const f = Math.min(n.gdp * n.coinUse * 0.3 * TUNING.feeRate, n.bank * 0.01); n.bank -= f; c.pool = (c.pool || 0) + f; }
  let fees = 0; if (blocks > 0) { fees = (c.pool || 0) * Math.min(1, blocks / TUNING.blockTarget); c.pool -= fees; }
  c.fees = fees;
  if (H > 0) for (const [n, miners, h] of per) { const share = minted * h / H, fs = fees * h / H; for (const [p] of miners) { p.coins += share / miners.length; p.w += fs / miners.length; } }
  else if (fees > 0) civ.nations[c.nation].bank += fees;
  if (H > 0) c.difficulty = clamp(c.difficulty * clamp((blocks + 1) / (TUNING.blockTarget + 1), 0.75, 1.33), TUNING.coinDifficulty * 0.05, 1e15);
  if (civ.t % YEAR < MONTH) { c.history.push({ y: civ.year, miners: nm, hash: +H.toFixed(1), price: +c.price.toPrecision(4), fees: +fees.toFixed(2), supply: +c.supply.toFixed(1) }); if (c.history.length > 600) c.history.shift(); }
}

// ---------- jobs ----------
function chooseJob(civ, n, p, m, force) {
  if (m.age < 15) { p.job = 'child'; return; }
  if (m.age > 68) { p.job = 'elder'; return; }
  if (!force && p.job !== 'child' && R(civ) > 0.25) return;
  const g = Gn.phenotype(p.g), wages = n.wage || {}; let meanW = 0, k = 0; for (const j in wages) { meanW += wages[j]; k++; } meanW = k ? meanW / k : 1;
  const parentJob = p.par.length ? civ.people[p.par[0]]?.job : null;
  const soldierNeed = n.pop * (0.03 + (n.atWar ? 0.12 : 0) + (n.leader?.policies.war || 0) * 0.04) - (n.jobs.soldier || 0);
  let best = 'farmer', bv = -1e9;
  for (const j of JOBN) {
    const J = JOBS[j]; if (J.req && !n.caps[J.req]) continue;
    let u = J.fit(m, g) * 0.8 + (meanW > 0 ? Math.min(3, (wages[j] ?? meanW * 0.9) / meanW) : 1) * 1.2;
    if (j === 'farmer') u += m.needs.hunger * 0.2 + (1 - n.foodRatio) * 3 - (n.price.food < 0.5 ? 0.5 : 0);
    if (j === 'soldier') u += soldierNeed > 0 ? 0.8 : -0.8;
    if (j === 'priest') u -= (n.jobs.priest || 0) > n.pop * 0.04 ? 1 : 0;
    const rp = n.leader?.policies.research ?? 0.5;   // the state funds an academy: it hires up to a target share
    if (j === 'scholar') u += (n.jobs.scholar || 0) < n.pop * (0.02 + 0.04 * rp) ? 0.9 : -0.8;
    if (j === 'engineer') u += (n.jobs.engineer || 0) < n.pop * (0.015 + 0.03 * rp) ? 0.6 : 0;
    if (j === 'programmer') u += (n.jobs.programmer || 0) < n.pop * 0.04 ? 0.6 : 0;
    if (j === 'coinminer') u -= (n.jobs.coinminer || 0) > n.pop * 0.05 ? 1 : 0;
    if (j === parentJob) u += 0.3;
    if (j === p.job) u += 0.35;
    u += (R(civ) - 0.5) * 0.6;
    if (u > bv) { bv = u; best = j; }
  }
  p.job = best;
}

// ---------- yearly: demography, territory, politics, diplomacy, culture ----------
// the yearly work is split into phases run on successive ticks so no single tick carries it all
const PHASES = [
  (civ, world) => {
    const L = living(civ, world);
    for (const n of civ.nations) if (n.alive) { n.pop = 0; n.atWar = civ.wars.some((w) => w.on && (w.a === n.id || w.b === n.id)); }
    for (const [p] of L) { const n = civ.nations[p.nat]; if (n) n.pop++; }
    demography(civ, world, L);
  },
  (civ, world) => territory(civ, world, living(civ, world)),
  (civ, world) => {
    const L2 = living(civ, world), byN = civ.nations.map(() => []); for (const pm of L2) byN[pm[0].nat]?.push(pm);
    for (const n of civ.nations) if (n.alive) { n.pop = byN[n.id].length; refreshKnown(civ, n); politics(civ, world, n, byN[n.id]); }
  },
  (civ, world) => { const L2 = living(civ, world); diplomacy(civ, world, L2); splits(civ, world, L2); },
  (civ, world) => {
    culture(civ); diffuse(civ);
    for (const n of civ.nations) if (n.alive && n.pop > 30 && R(civ) < 0.01 * (1 + Object.values(n.rel).filter((r) => r.trade).length * 0.3)) { const id = n.id; plague(civ, world, (m) => civ.people[m.id]?.nat === id, 0.7); civ.chron[civ.chron.length - 1].text += ` (in ${n.name})`; civ.chron[civ.chron.length - 1].n = [id]; }
    yearStats(civ, world);
  },
];
function yearStats(civ, world) {
  const L2 = living(civ, world);
  let gdp = 0, pop = 0; const w = [];
  const ns = civ.nations.filter((n) => n.alive);
  let rgdp = 0; for (const n of ns) { gdp += n.gdpY; rgdp += n.rgdpY || 0; n.pop = 0; }
  for (const [p] of L2) { w.push(p.w + p.coins * (civ.coin?.price || 0)); civ.nations[p.nat].pop++; pop++; }
  civ.stats.push({ y: civ.year, pop, gdp: +gdp.toFixed(1), rgdp: +rgdp.toFixed(1), gini: +gini(w).toFixed(3), coins: civ.coin ? +civ.coin.supply.toFixed(2) : 0, coinPrice: civ.coin ? civ.coin.price : 0,
    hash: civ.coin ? civ.coin.hashLast : 0, items: civ.items.length, nations: ns.length, reps: +ns.reduce((a, n) => a + n.replicators, 0).toFixed(2), wars: civ.wars.filter((x) => x.on).length,
    price: Object.fromEntries(['food', 'metal', 'power', 'chips'].map((g) => [g, +(ns.reduce((a, n) => a + n.price[g] * n.pop, 0) / Math.max(1, pop)).toFixed(3)])) });
  if (civ.stats.length > 1500) civ.stats.shift();
  for (const n of ns) { n.gdpY = 0; n.rgdpY = 0; }
  if (civ.year % 10 === 0) for (const k in civ.sigs) if (civ.sigs[k] === -1) delete civ.sigs[k];
  if (civ.year % 5 === 0) {   // prune long-dead minds from the minds world (civ keeps their records)
    world.minds = world.minds.filter((m) => m.alive || (civ.people[m.id] && civ.year - civ.people[m.id].died < 3));
    for (const [id, m] of world.byId) if (!m.alive && (!civ.people[id] || civ.year - civ.people[id].died > 30)) world.byId.delete(id);
  }
}
function gini(a) { const n = a.length; if (n < 2) return 0; a = a.map((x) => Math.max(0, fin(x))).sort((x, y) => x - y); let s = 0, c = 0; for (let i = 0; i < n; i++) { c += a[i]; s += c; } return c > 0 ? clamp(1 - 2 * (s / c - 0.5) / n) : 0; }
function kill(civ, world, p, m, cause, killer) {
  if (p.died != null) return; p.died = civ.year; p.cause = cause; m.alive = false;
  const f = civ.families[p.fam]; if (f) f.living = Math.max(0, f.living - 1);
  const rel = []; const sp = m.spouse != null ? world.byId.get(m.spouse) : null; if (sp && sp.alive) rel.push(sp);
  for (const k of p.kids) { const km = world.byId.get(k); if (km && km.alive) rel.push(km); }
  for (const pid of p.par) { const km = world.byId.get(pid); if (km && km.alive) rel.push(km); }
  if (rel.length) M.notify(rel, { type: 'death', about: p.id, killer }, world);
  if (sp && sp.spouse === m.id) sp.spouse = null;
  const heirs = p.kids.map((k) => civ.people[k]).filter((k) => k && k.died == null);
  const n = civ.nations[p.nat];
  if (heirs.length) for (const h of heirs) { h.w += p.w / heirs.length; h.coins += p.coins / heirs.length; }
  else if (sp && civ.people[sp.id]) { civ.people[sp.id].w += p.w; civ.people[sp.id].coins += p.coins; }
  else if (n) n.treasury += p.w;
  p.w = 0; p.coins = 0;
  if (n && n.leader && n.leader.id === p.id) { n.leader.bio.push(`Died in ${civ.year} (${cause}).`); n.pastLeaders = n.pastLeaders.concat([{ ...n.leader, until: civ.year }]).slice(-30); n.leader = null; }
}
function demography(civ, world, L) {
  const cap = clamp(1.6 - L.length / civ.targetPop, 0, 1.3);
  for (const [p, m] of L) {
    m.age++;
    const g = Gn.phenotype(p.g), n = civ.nations[p.nat];
    const ae = m.age - (g.longevity - 0.5) * 16 + (g.disease ? 15 : 0);
    const q = 0.003 + 0.3 * Math.exp((ae - 85) / 8) + (m.age < 5 ? 0.02 : 0) + (g.disease ? 0.02 : 0) + (p.fed < 0.4 ? 0.08 * (1 - p.fed) : 0);
    if (R(civ) < q) { kill(civ, world, p, m, m.age > 60 ? 'old age' : p.fed < 0.4 ? 'hunger' : g.disease ? 'wasting sickness' : 'illness'); continue; }
    chooseJob(civ, n, p, m, m.age === 15 || m.age === 69 || (p.job === 'child' && m.age >= 15));
    if (m.sex === 'f' && m.age >= 18 && m.age <= 44 && m.spouse != null) {
      const dad = world.byId.get(m.spouse), dp = dad && civ.people[dad.id];
      if (dad && dad.alive && dp && R(civ) < TUNING.birth * cap * (0.4 + 0.6 * p.fed)) birth(civ, world, n, p, m, dp, dad);
    }
  }
  if (civ.year % 2 === 0) {   // matchmaking for adults the minds left single
    const single = {}; for (const [p, m] of L) if (m.alive && m.spouse == null && m.age >= 18 && m.age < 45) (single[p.nat + m.sex] = single[p.nat + m.sex] || []).push(m);
    for (const n of civ.nations) { const a = single[n.id + 'm'] || [], b = single[n.id + 'f'] || []; for (let i = 0; i < Math.min(a.length, b.length); i++) if (R(civ) < 0.35) { a[i].spouse = b[i].id; b[i].spouse = a[i].id; } }
  }
}
function birth(civ, world, n, mp, mm, dp, dm) {
  const rng = rf(civ), g = Gn.inherit(mp.g, dp.g, rng);
  const traits = {}; for (const k in mm.traits) traits[k] = clamp((mm.traits[k] + dm.traits[k]) / 2 + (R(civ) - 0.5) * 0.3);
  const child = M.createMind({ id: world.nextId, rng, name: C.personName(n.lang, rng), age: 0, traits, x: mm.x + (R(civ) - 0.5) * 10, y: mm.y + (R(civ) - 0.5) * 10, group: n.id });
  Gn.nudgeTraits(child.traits, g, 0.3);
  M.addMind(world, child);
  const fam = civ.families[dp.fam] || civ.families[mp.fam];
  const p = { id: child.id, name: child.name, sex: child.sex, born: civ.year, nat: n.id, fam: fam ? fam.id : 0, par: [dp.id, mp.id], kids: [], job: 'child', w: 0, coins: 0, sk: 0.5 + R(civ) * 0.4 + Gn.phenotype(g).intel * 0.3, g, fed: 1, fac: null, gen: 1 + Math.max(dp.gen || 1, mp.gen || 1) };
  civ.people[child.id] = p; mp.kids.push(child.id); dp.kids.push(child.id);
  if (fam) {
    fam.members++; fam.living++; fam.gen = Math.max(fam.gen, p.gen - (civ.people[fam.founder]?.gen || 1) + 1);
    // family memory passes down: feuds, war dead and heroes become the child's own memories
    for (const fid in fam.feuds) if (fam.feuds[fid] > 0.5) child.memories.push({ type: `family feud with the ${civ.families[fid]?.name}`, weight: -0.6, t: world.t });
    for (const nid in fam.grudges) if (fam.grudges[nid] > 0.4) child.memories.push({ type: `kin died fighting ${civ.nations[nid]?.name}`, weight: -0.7, t: world.t });
    if (fam.heroes.length) child.memories.push({ type: 'legend: ' + fam.heroes[fam.heroes.length - 1].replace(/^-?\d+: /, ''), weight: 0.7, t: world.t });
    for (const fid in fam.feuds) fam.feuds[fid] *= 0.97;
  }
}
function territory(civ, world, L) {
  const m = civ.map, NT = m.terr.length, own = m.own;
  L = L || living(civ, world);
  for (let t = 0; t < NT; t++) if (own[t] >= 0 && !civ.nations[own[t]].alive) own[t] = -1;
  const occ = new Map();
  for (const [p, mi] of L) { const k = tileOf(civ, mi.x, mi.y) * 256 + p.nat; occ.set(k, (occ.get(k) || 0) + 1); }
  const tileBest = new Map();
  for (const [k, c] of occ) { const t = Math.floor(k / 256), nid = k % 256; const b = tileBest.get(t); if (!b || c > b[1]) tileBest.set(t, [nid, c]); }
  for (const [t, [nid, c]] of tileBest) { if (!m.terr[t] || !civ.nations[nid].alive) continue; if (own[t] < 0 || (c >= 4 && !(occ.get(t * 256 + own[t]) > 0))) own[t] = nid; }
  for (const n of civ.nations) if (n.alive) { n.tiles = 0; n.res = {}; for (const a in n.rel) n.rel[a].border = 0; }
  const front = civ.nations.map(() => []);
  for (let t = 0; t < NT; t++) {
    const o = own[t]; if (o < 0) continue; const n = civ.nations[o]; n.tiles++;
    const r = m.res[t]; for (const k in r) n.res[k] = (n.res[k] || 0) + r[k];
    if (r.copper || r.tin || r.iron) n.res.ore = (n.res.ore || 0) + 1;
    const x = t % m.gw, y = (t / m.gw) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= m.gw || yy >= m.gh) continue; const u = yy * m.gw + xx;
      if (own[u] < 0 && m.terr[u]) front[o].push(u); else if (own[u] >= 0 && own[u] !== o) rel(civ, o, own[u]).border++;
    }
  }
  for (const n of civ.nations) if (n.alive && front[n.id].length) {
    const k = n.pop / Math.max(1, n.tiles) > 6 ? 3 : 1;
    for (let i = 0; i < k; i++) { const u = pick(civ, front[n.id]); if (own[u] < 0) { own[u] = n.id; n.tiles++; } }
  }
  for (const n of civ.nations) if (n.alive && own[n.capital] !== n.id) {
    let bt = -1, bc = -1; for (const [t, [nid, c]] of tileBest) if (nid === n.id && own[t] === n.id && c > bc) { bc = c; bt = t; }
    if (bt < 0) for (let t = 0; t < NT; t++) if (own[t] === n.id) { bt = t; break; }
    if (bt >= 0) { n.capital = bt; log(civ, 'politics', `${civ.year}: ${n.name} moves its capital.`, [n.id]); }
  }
}
function rel(civ, a, b) { const A = civ.nations[a]; return A.rel[b] || (A.rel[b] = { op: 0, trade: false, alliance: false, embargo: false, rival: false, grudge: 0, war: false, border: 0, vol: 0, treaties: [] }); }

// ---------- politics ----------
function politics(civ, world, n, ppl) {
  for (const f of n.factions) { f.members = 0; f._w = 0; f._top = []; }
  let tw = 0;
  for (const [p, m] of ppl) {
    if (m.age < 16) continue;
    let bf = null, bv = -1e9;
    for (const f of n.factions) { const v = C.factionAffinity(f, p, m) + (p.fac === f.id ? 0.4 : 0) + (R(civ) - 0.5) * 0.3; if (v > bv) { bv = v; bf = f; } }
    p.fac = bf.id; bf.members++; const w = 1 + Math.min(5, p.w / 100); bf._w += w; tw += w;
    bf._top.push([p, w]); if (bf._top.length > 6) { bf._top.sort((a, b) => b[1] - a[1]); bf._top.length = 3; }
  }
  for (const f of n.factions) { f._top.sort((a, b) => b[1] - a[1]); f.influence = tw ? f._w / tw : 0; f.top = f._top.slice(0, 3).map(([p]) => fullName(civ, p)); f.topIds = f._top.slice(0, 3).map(([p]) => p.id); f.leaderId = f.topIds[0] ?? null; delete f._top; delete f._w; }
  const inf = (name) => n.factions.find((f) => f.name.endsWith(name))?.influence || 0;
  n.gini = gini(ppl.map(([p]) => p.w));
  if (n.leader) n.leader.legitimacy = clamp(n.leader.legitimacy + 0.015 - (1 - n.foodRatio) * 0.1 - n.exhaustion * 0.05);
  n.stability = clamp((n.leader ? n.leader.legitimacy : 0.3) * 0.5 + (1 - n.gini) * 0.3 + n.foodRatio * 0.2 - n.exhaustion * 0.2);
  n.exhaustion = Math.max(0, n.exhaustion * 0.8);
  const term = { republic: 4, council: 6, technocracy: 8 }[n.gov];
  if (!n.leader) pickLeader(civ, world, n, n.gov === 'monarchy' ? 'inheritance' : term ? 'election' : 'acclaim');
  else if (term && civ.year - n.leader.since >= term) pickLeader(civ, world, n, 'election');
  const g0 = n.gov;
  if (n.leader && inf('War Hawks') > 0.28 && n.leader.legitimacy < 0.4 && n.gov !== 'junta' && R(civ) < 0.25) { n.gov = 'junta'; pickLeader(civ, world, n, 'coup'); }
  else if (n.gini > 0.5 && inf('Union') + inf('Reformists') > 0.4 && ['monarchy', 'junta', 'chiefdom', 'theocracy'].includes(n.gov) && R(civ) < 0.06) { n.gov = 'republic'; pickLeader(civ, world, n, 'revolution'); }
  else if (inf('Faithful') > 0.4 && n.gov !== 'theocracy' && R(civ) < 0.06) { n.gov = 'theocracy'; pickLeader(civ, world, n, 'religious revolution'); }
  else if (inf('Academy') > 0.3 && n.caps.computer && n.gov !== 'technocracy' && R(civ) < 0.05) { n.gov = 'technocracy'; pickLeader(civ, world, n, 'expert takeover'); }
  else if (n.gov === 'chiefdom' && n.pop > 120 && n.caps.metal && R(civ) < 0.12) { n.gov = R(civ) < 0.7 ? 'monarchy' : 'council'; pickLeader(civ, world, n, 'state formation'); }
  else if (n.gov === 'junta' && n.leader && n.leader.legitimacy > 0.7 && R(civ) < 0.08) { n.gov = 'republic'; pickLeader(civ, world, n, 'election'); }
  if (g0 !== n.gov && n.leader) log(civ, 'politics', `${civ.year}: ${n.name} becomes a ${n.gov} (${n.leader.how}); ${n.leader.title} ${n.leader.name} takes power.`, [n.id]);
  laws(civ, n);
}
function pickLeader(civ, world, n, how) {
  const P_ = civ.people, cands = [];
  for (const m of world.minds) { if (!m.alive || m.age < 25) continue; const p = P_[m.id]; if (p && p.nat === n.id && p.died == null) cands.push([p, m]); }
  if (!cands.length) return;
  let best = null;
  const old = n.leader || n.pastLeaders[n.pastLeaders.length - 1];
  if (how === 'inheritance' && old) {   // dynasty: eldest living child, else eldest kin
    const op = P_[old.id];
    const kids = (op?.kids || []).map((k) => cands.find(([p]) => p.id === k)).filter(Boolean).sort((a, b) => b[1].age - a[1].age);
    best = kids[0] || cands.filter(([p]) => p.fam === op?.fam).sort((a, b) => b[1].age - a[1].age)[0];
    if (!best) how = 'succession crisis';
  }
  if (!best) {
    const sc = ([p, m]) => {
      let s = m.traits.ambition + Math.min(2, p.w / 150) + R(civ) * 0.5;
      if (how === 'coup' || n.gov === 'junta') s += p.job === 'soldier' ? 2 + m.traits.courage : 0;
      if (n.gov === 'theocracy') s += m.faith * 2 + (p.job === 'priest' ? 2 : 0);
      if (n.gov === 'technocracy') s += ['engineer', 'scholar', 'programmer'].includes(p.job) ? 2 : 0;
      if (how === 'election') { const f = n.factions.find((x) => x.id === p.fac); s += (f ? f.influence * 4 : 0) + m.traits.sociability; }
      if (n.gov === 'chiefdom') s += m.traits.courage + (m.age > 40 ? 0.5 : 0);
      return s;
    };
    let bs = -1e9; for (const c of cands) { const s = sc(c); if (s > bs) { bs = s; best = c; } }
  }
  const [p, m] = best, prev = n.leader;
  if (prev) n.pastLeaders = n.pastLeaders.concat([{ ...prev, until: civ.year }]).slice(-30);
  n.leader = C.makeLeader(rf(civ), n, p, m, fullName(civ, p), civ.year, how);
  if (how === 'election' && prev && prev.id === p.id) { n.leader = { ...prev, how: 're-election', legitimacy: clamp(prev.legitimacy + 0.1) }; n.leader.since = prev.since; n.leader.bio = prev.bio.concat([`Re-elected in ${civ.year}.`]).slice(-10); n.leader.sinceTerm = civ.year; n.leader.since = civ.year; }
  const f = civ.families[p.fam];
  if (f && (!prev || prev.id !== p.id)) { f.rulers.push(`${n.leader.title} ${p.name} of ${n.name} (${civ.year})`); if (f.rulers.length > 15) f.rulers.shift(); }
  if (how !== 'founding' && (!prev || prev.id !== p.id)) log(civ, 'leader', `${civ.year}: ${n.leader.title} ${n.leader.name} rules ${n.name} (${how}).`, [n.id]);
}
function laws(civ, n) {
  const L = n.leader; if (!L) return; const P_ = L.policies;
  const out = [`Tax rate ${(P_.tax * 100).toFixed(0)}%`];
  out.push(P_.faith > 0.6 ? 'State religion of the true god' : P_.faith < 0.3 ? 'Freedom of worship' : 'Temples are tax-exempt');
  out.push(P_.trade > 0.6 ? 'Open markets' : 'Tariffs on foreign goods');
  if (P_.war > 0.55 || n.atWar) out.push('Conscription of adults');
  if (n.gov === 'republic' || n.gov === 'council') out.push('Elections every ' + (n.gov === 'republic' ? 4 : 6) + ' years');
  if (n.gov === 'monarchy') out.push('Crown passes to the eldest child');
  if (n.caps.metal) out.push('Weights and measures standardised');
  if (n.inventions > 10 && P_.research > 0.5) out.push('Inventors hold patents');
  if (n.caps.ledger && civ.coin) out.push(P_.trade > 0.5 ? `${civ.coin.name} is legal tender` : `${civ.coin.name} mining is taxed`);
  if (n.caps.machines) out.push('Machines may not harm a citizen');
  n.laws = out;
}

// ---------- diplomacy & war ----------
function power(n) { return ((n.jobs.soldier || 0) + n.pop * 0.03) * (1 + 2 * (n.best.tool || 0)) * (1 + (n.best.motion || 0)) * (1 + (n.best.compute || 0)) * (0.5 + n.stability) * (1 + Math.min(1, n.machines / 50) * (n.best.auto || 0)); }
function diplomacy(civ, world, L) {
  const NS = civ.nations.filter((n) => n.alive), cnt = {};
  for (const [p, m] of L) { const k = p.nat + '|' + (m.allegiance || 'none'); cnt[k] = (cnt[k] || 0) + 1; }
  const faith = {}; for (const n of NS) { let b = 'none', v = -1; for (const k in cnt) { const [id, a] = k.split('|'); if (+id === n.id && cnt[k] > v) { v = cnt[k]; b = a; } } faith[n.id] = b; }
  civ.faithOf = faith;
  for (const a of NS) for (const b of NS) {
    if (b.id <= a.id) continue;
    const r = rel(civ, a.id, b.id), s = rel(civ, b.id, a.id); const contact = r.border > 0 || s.border > 0;
    const crowd = (a.pop / Math.max(1, a.tiles) + b.pop / Math.max(1, b.tiles)) / 8;
    const d = (r.trade ? 0.03 : 0) + (faith[a.id] === faith[b.id] ? 0.02 : -0.02) + (a.lang.family === b.lang.family ? 0.02 : 0) - (contact ? 0.012 * Math.min(3, crowd) + 0.02 * Math.min(3, (r.border + s.border) / 12) : 0) - r.grudge * 0.06 - (r.rival ? 0.04 : 0) + (R(civ) - 0.5) * 0.08;
    r.op = s.op = clamp(r.op * 0.95 + d, -1, 1);
    r.grudge = s.grudge = Math.max(r.grudge, s.grudge) * 0.985;
    const both = (k, v) => { r[k] = v; s[k] = v; };
    if (r.war) continue;
    if (!r.trade && !r.embargo && r.op > 0.05 && (contact || R(civ) < 0.2) && R(civ) < 0.3 * (a.leader?.policies.trade || 0.5)) { both('trade', true); r.treaties.push(civ.year); log(civ, 'diplomacy', `${civ.year}: ${a.name} and ${b.name} sign a trade deal.`, [a.id, b.id]); }
    if (r.trade && r.op < -0.3 && R(civ) < 0.4) { both('trade', false); both('embargo', true); log(civ, 'diplomacy', `${civ.year}: ${a.name} places an embargo on ${b.name}.`, [a.id, b.id]); }
    if (r.embargo && r.op > 0 && R(civ) < 0.2) { both('embargo', false); log(civ, 'diplomacy', `${civ.year}: the embargo between ${a.name} and ${b.name} is lifted.`, [a.id, b.id]); }
    if (!r.alliance && r.op > 0.4 && R(civ) < 0.15) { both('alliance', true); log(civ, 'diplomacy', `${civ.year}: ${a.name} and ${b.name} form an alliance.`, [a.id, b.id]); }
    if (r.alliance && r.op < 0.05) { both('alliance', false); log(civ, 'diplomacy', `${civ.year}: the alliance of ${a.name} and ${b.name} collapses.`, [a.id, b.id]); }
    const pa = power(a), pb = power(b);
    if (!r.rival && r.op < -0.25 && Math.min(pa, pb) / Math.max(pa, pb, 1) > 0.5) { both('rival', true); log(civ, 'diplomacy', `${civ.year}: ${a.name} and ${b.name} become rivals.`, [a.id, b.id]); }
    if (r.rival && r.op > 0.1) both('rival', false);
    if (contact && r.op < -0.15 && !r.alliance && !(r.truce > civ.year)) {
      for (const [x, y, px, py] of [[a, b, pa, pb], [b, a, pb, pa]]) {
        const lw = x.leader?.policies.war ?? 0.4, ratio = px / Math.max(1, py);
        const needOre = !(x.res.ore > 0) && y.res.ore > 0, holy = faith[x.id] !== faith[y.id] && (x.leader?.policies.faith || 0) > 0.6;
        const pr = TUNING.warChance * lw * (1 + r.grudge * 2) * clamp(ratio, 0.2, 2) * (needOre ? 1.6 : 1) * (holy ? 1.4 : 1) * (x.pop > 30 ? 1 : 0);
        if (R(civ) < pr) {
          const cause = r.grudge > 0.3 ? `an old grudge from ${r.lastWar != null ? 'the war of ' + r.lastWar : 'past wrongs'}` : needOre ? `the ore mines of ${y.name}` : holy ? 'a holy war over the gods' : 'a border dispute';
          startWar(civ, world, x, y, cause); break;
        }
      }
    }
  }
}
function startWar(civ, world, a, b, cause) {
  if (rel(civ, a.id, b.id).war) return;
  const w = { id: civ.nextWar++, a: a.id, b: b.id, cause, start: civ.year, on: true, score: 0, casA: 0, casB: 0, months: 0, name: `${C.word(a.lang, 'war' + b.id, rf(civ)).replace(/^./, (c) => c.toUpperCase())} War` };
  civ.wars.push(w); if (civ.wars.length > 300) civ.wars.splice(0, civ.wars.findIndex((x) => x.on) > 50 ? 50 : 0);
  const r = rel(civ, a.id, b.id), s = rel(civ, b.id, a.id); r.war = s.war = true; r.trade = s.trade = false; a.atWar = b.atWar = true;
  log(civ, 'war', `${civ.year}: ${a.name} declares war on ${b.name} over ${cause} — the ${w.name}.`, [a.id, b.id]);
  const ma = [], mb = [];
  for (const m of world.minds) { if (!m.alive) continue; const p = civ.people[m.id]; if (!p) continue; if (p.nat === a.id) { ma.push(m); if (p.job === 'soldier') m.enemyGroup = b.id; } else if (p.nat === b.id) { mb.push(m); if (p.job === 'soldier') m.enemyGroup = a.id; } }
  if (ma.length) M.notify(ma, { type: 'war', intensity: 0.6 }, world); if (mb.length) M.notify(mb, { type: 'war', intensity: 0.8 }, world);
  for (const id in b.rel) { const o = civ.nations[id]; if (b.rel[id].alliance && +id !== a.id && o.alive && !rel(civ, +id, a.id).war && R(civ) < 0.5) { log(civ, 'war', `${civ.year}: ${o.name} honours its alliance and joins ${b.name}.`, [+id, a.id, b.id]); startWar(civ, world, o, a, `defence of its ally ${b.name}`); } }
}
function war(civ, world, byN) {
  for (const w of civ.wars) {
    if (!w.on) continue;
    const a = civ.nations[w.a], b = civ.nations[w.b];
    if (!a.alive || !b.alive) { w.on = false; w.end = civ.year; continue; }
    w.months++;
    if (R(civ) > 0.5) continue;
    const S = (n) => byN[n.id].filter(([p]) => p.job === 'soldier');
    const sa = S(a), sb = S(b), A = power(a), B = power(b);
    const aWins = R(civ) < A / (A + B + 1e-9), [win, lose, ws, ls] = aWins ? [a, b, sa, sb] : [b, a, sb, sa];
    const killN = (arr, frac, enemy, foe) => { let k = 0; for (const [p, m] of arr) if (m.alive && R(civ) < frac) { kill(civ, world, p, m, `fell in the ${w.name}`, enemy[0]?.[0].id); k++; const f = civ.families[p.fam]; if (f) { f.grudges[foe.id] = Math.min(2, (f.grudges[foe.id] || 0) + 0.5); if (R(civ) < 0.15) { f.heroes.push(`${civ.year}: ${fullName(civ, p)} died a hero in the ${w.name}`); if (f.heroes.length > 12) f.heroes.shift(); } } } return k; };
    const kl = killN(ls, 0.08, ws, win), kw = killN(ws, 0.03, ls, lose);
    if (aWins) { w.casB += kl; w.casA += kw; w.score++; } else { w.casA += kl; w.casB += kw; w.score--; }
    const m = civ.map; let taken = 0;
    for (let t = 0; t < m.own.length && taken < 2; t++) {
      if (m.own[t] !== lose.id || t === lose.capital) continue;
      const x = t % m.gw, y = (t / m.gw) | 0;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => x + dx >= 0 && x + dx < m.gw && m.own[(y + dy) * m.gw + x + dx] === win.id) && R(civ) < 0.4) { m.own[t] = win.id; taken++; annexTile(civ, world, t, lose, win); }
    }
    a.exhaustion += (kw + kl) / Math.max(10, a.pop) * 3 + 0.02; b.exhaustion += (kw + kl) / Math.max(10, b.pop) * 3 + 0.02;
    if (Math.abs(w.score) >= 6 || w.months > 60 || a.exhaustion + b.exhaustion > 2.2 || lose.pop < 20) endWar(civ, world, w, win, lose);
  }
}
function annexTile(civ, world, t, from, to) {
  for (const m of world.minds) { if (!m.alive) continue; const p = civ.people[m.id]; if (p && p.nat === from.id && tileOf(civ, m.x, m.y) === t) { p.nat = to.id; m.group = to.id; m.enemyGroup = null; } }
}
function endWar(civ, world, w, win, lose) {
  if (!w.on) return;
  w.on = false; w.end = civ.year; w.winner = win.id;
  const r = rel(civ, win.id, lose.id), s = rel(civ, lose.id, win.id); r.war = s.war = false; r.lastWar = s.lastWar = w.start;
  s.grudge = r.grudge = Math.min(2, r.grudge + 0.3); r.op = s.op = Math.max(-0.2, Math.min(r.op, 0)); r.truce = s.truce = civ.year + 12;
  for (const m of world.minds) { const p = civ.people[m.id]; if (p && (p.nat === win.id || p.nat === lose.id)) m.enemyGroup = null; }
  const trib = lose.treasury * 0.3; lose.treasury -= trib; win.treasury += trib;
  const lk = [...lose.K].filter((id) => !win.K.has(id) && !civ.items[id].base), stolen = [];
  for (let i = 0; i < 3 && lk.length; i++) { const id = lk.splice((R(civ) * lk.length) | 0, 1)[0]; learn(civ, win, civ.items[id]); stolen.push(civ.items[id].name); }
  if (lose.leader) lose.leader.legitimacy = clamp(lose.leader.legitimacy - 0.25); if (win.leader) win.leader.legitimacy = clamp(win.leader.legitimacy + 0.15);
  log(civ, 'war', `${civ.year}: the ${w.name} ends, ${win.name} victorious (${w.casA + w.casB} dead). Treaty of ${C.placeName(win.lang, rf(civ))}${trib > 1 ? `: tribute of ${trib.toFixed(0)}` : ''}${stolen.length ? '; ' + win.name + ' seizes the secrets of the ' + stolen.join(', ') : ''}.`, [win.id, lose.id]);
  r.treaties.push(civ.year);
  const ms = world.minds.filter((m) => { const p = civ.people[m.id]; return m.alive && p && (p.nat === win.id || p.nat === lose.id); });
  if (ms.length) M.notify(ms, { type: 'peace' }, world);
  if (lose.pop < 25 || lose.tiles < 3) mergeInto(civ, world, lose, win, 'conquered');
  for (const n of [win, lose]) n.atWar = civ.wars.some((x) => x.on && (x.a === n.id || x.b === n.id));
}
function mergeInto(civ, world, from, to, how) {
  if (!from.alive) return;
  for (const m of world.minds) { const p = civ.people[m.id]; if (p && p.nat === from.id) { p.nat = to.id; m.group = to.id; } }
  for (let t = 0; t < civ.map.own.length; t++) if (civ.map.own[t] === from.id) civ.map.own[t] = to.id;
  for (const id of from.K) if (R(civ) < 0.6) learn(civ, to, civ.items[id]);
  for (const g of GOODS) to.stock[g] += from.stock[g];
  to.bank += from.bank; to.treasury += from.treasury; to.replicators += from.replicators; to.pop += from.pop;
  for (const k in civ.families) if (civ.families[k].nat === from.id) civ.families[k].nat = to.id;
  for (let i = 0; i < 4; i++) C.borrowWord(to.lang, from.lang, pick(civ, Object.keys(from.lang.lex)));
  collapse(civ, from, `${how} ${to.name}`);
}
function collapse(civ, n, why) {
  n.alive = false; n.died = civ.year; n.pop = 0;
  for (const w of civ.wars) if (w.on && (w.a === n.id || w.b === n.id)) { w.on = false; w.end = civ.year; }
  for (const o of civ.nations) if (o.rel[n.id]) { Object.assign(o.rel[n.id], { war: false, alliance: false, trade: false }); }
  const lost = [];
  for (const id of n.K) { const it = civ.items[id]; it.known--; if (it.known <= 0 && !it.base) { it.lost = true; lost.push(it.name); } }
  log(civ, 'collapse', `${civ.year}: ${n.name} falls (${why}).${lost.length ? ' Knowledge lost unless rediscovered: ' + lost.slice(0, 6).join(', ') + (lost.length > 6 ? '…' : '') + '.' : ''}`, [n.id]);
}
function splits(civ, world, L) {
  for (const n of civ.nations.slice()) {
    if (!n.alive) continue;
    if (n.pop < 12) {
      let near = null, nd = 1e9; for (const o of civ.nations) if (o.alive && o !== n) { const d = Math.hypot(o.capital % 64 - n.capital % 64, ((o.capital / 64) | 0) - ((n.capital / 64) | 0)); if (d < nd) { nd = d; near = o; } }
      if (near) mergeInto(civ, world, n, near, 'absorbed by'); else if (!n.pop) collapse(civ, n, 'its people died out');
      continue;
    }
    const alive = civ.nations.filter((x) => x.alive).length;
    if (n.pop > 450 && alive < 12 && civ.nations.length < 200 && R(civ) < TUNING.splitChance * (1.3 - n.stability) * (n.pop / 400)) secede(civ, world, n, L);
    for (const id in n.rel) {
      const o = civ.nations[id], r = n.rel[id]; if (!o.alive || o.id <= n.id || !r.alliance || r.op < 0.7 || o.lang.family !== n.lang.family) continue;
      if (R(civ) < 0.03) { const [big, small] = n.pop >= o.pop ? [n, o] : [o, n]; log(civ, 'politics', `${civ.year}: ${small.name} and ${big.name} unite as one realm.`, [n.id, o.id]); mergeInto(civ, world, small, big, 'peaceful union with'); break; }
    }
  }
}
function secede(civ, world, n, L) {
  const m = civ.map, cx = n.capital % m.gw, cy = (n.capital / m.gw) | 0;
  let fx = 0, fy = 0, fd = -1; for (let t = 0; t < m.own.length; t++) if (m.own[t] === n.id) { const x = t % m.gw, y = (t / m.gw) | 0, d = Math.hypot(x - cx, y - cy); if (d > fd) { fd = d; fx = x; fy = y; } }
  if (fd < 3) return;
  const ax = (fx - cx) / fd, ay = (fy - cy) / fd, proj = (x, y) => (x - cx) * ax + (y - cy) * ay;
  const mine = L.filter(([p, mi]) => p.nat === n.id && mi.alive).map((pm) => [pm, proj(pm[1].x / m.ts, pm[1].y / m.tsy)]).sort((a, b) => b[1] - a[1]);
  const k = Math.floor(mine.length * (0.25 + R(civ) * 0.15));   // the far quarter-to-two-fifths of the people
  if (k < 40) return;
  const rebels = mine.slice(0, k).map((x) => x[0]), cut = (mine[k - 1][1] + mine[k][1]) / 2;
  const rng = rf(civ), lang = C.splitLanguage(n.lang, rng);
  const cult = JSON.parse(JSON.stringify(n.cult)); C.blendCulture(cult, C.createCulture(rng, lang), 0.35, rng);
  for (const s of cult.sports) { s.adoptedFrom = s.adoptedFrom || n.lang.name; s.champions = []; }
  const fac = n.factions.slice().sort((a, b) => b.influence - a.influence)[0]?.name || '';
  const gov = /Reform|Union|Merchant/.test(fac) ? 'republic' : /Faithful|Old Rite/.test(fac) ? 'theocracy' : /Hawks/.test(fac) ? 'junta' : /Academy/.test(fac) && n.caps.computer ? 'technocracy' : n.gov === 'chiefdom' ? 'chiefdom' : 'monarchy';
  const freqs = n.freqs.map((f) => clamp(f + (R(civ) - 0.5) * 0.04, 0.02, 0.98));
  const nn = makeNation(civ, { tile: null, year: civ.year, lang, cult, parent: n.id, gov, freqs });
  for (let t = 0; t < m.own.length; t++) if (m.own[t] === n.id && proj(t % m.gw, (t / m.gw) | 0) > cut) m.own[t] = nn.id;
  let ct = -1, cb = 1e9; for (let t = 0; t < m.own.length; t++) if (m.own[t] === nn.id) { const d = Math.abs(proj(t % m.gw, (t / m.gw) | 0) - (cut + Math.max(cut + 1, fd)) / 2); if (d < cb) { cb = d; ct = t; } }
  nn.capital = ct < 0 ? n.capital : ct;
  for (const [p, mi] of rebels) { p.nat = nn.id; mi.group = nn.id; }
  for (const id of n.K) learn(civ, nn, civ.items[id]);
  const fr = rebels.length / n.pop;
  for (const g of GOODS) { const h = n.stock[g] * fr; n.stock[g] -= h; nn.stock[g] = h; nn.price[g] = n.price[g]; }
  const bk = n.bank * fr; n.bank -= bk; nn.bank = bk; const tr = n.treasury * fr * 0.5; n.treasury -= tr; nn.treasury = tr;
  const rp = n.replicators * fr; n.replicators -= rp; nn.replicators = rp;
  nn.pop = rebels.length; n.pop -= rebels.length;
  const peaceful = n.stability > 0.45;
  const r = rel(civ, n.id, nn.id), s = rel(civ, nn.id, n.id); r.op = s.op = peaceful ? 0.1 : -0.4; r.grudge = s.grudge = peaceful ? 0 : 0.5;
  pickLeader(civ, world, nn, 'founding');
  log(civ, 'split', `${civ.year}: ${peaceful ? 'the far provinces of' : 'rebels in'} ${n.name} ${peaceful ? 'part ways peacefully' : 'rise up'} and found ${nn.name} (${gov}), speaking ${lang.name}${nn.leader ? `, under ${nn.leader.title} ${nn.leader.name}` : ''}.`, [n.id, nn.id]);
}
function diffuse(civ) {
  for (const a of civ.nations) if (a.alive) for (const id in a.rel) {
    const b = civ.nations[id], r = a.rel[id]; if (!b.alive || r.war || r.embargo) continue;
    const pr = (r.trade ? 0.06 : 0) + (r.border > 0 ? 0.03 : 0) + (r.alliance ? 0.04 : 0); if (!pr) continue;
    for (const iid of a.K) if (!b.K.has(iid) && R(civ) < pr) learn(civ, b, civ.items[iid]);
  }
}
function culture(civ) {
  const rng = rf(civ);
  for (const n of civ.nations) {
    if (!n.alive) continue;
    if (R(civ) < 0.04) { const sh = C.driftLanguage(n.lang, rng); if (R(civ) < 0.2) log(civ, 'culture', `${civ.year}: in ${n.name} a sound shift (${sh}) changes how ${n.lang.name} is spoken.`, [n.id]); }
    for (const s of n.cult.sports) { const ch = C.playSeason(s, rng, civ.year); if (R(civ) < 0.01) log(civ, 'sport', `${civ.year}: the ${ch.name} win the ${s.name} league of ${n.name}.`, [n.id]); }
    if (R(civ) < 0.012 && n.cult.sports.length < 4) { const s = C.createSport(rng, n.lang, n.cult); n.cult.sports.push(s); log(civ, 'culture', `${civ.year}: a new game, ${s.name}, is invented in ${n.name} (${s.players} a side, ${s.equipment}).`, [n.id]); }
    if (R(civ) < 0.01) { const last = n.hist[n.hist.length - 1]; n.cult.festivals.push({ name: C.word(n.lang, 'fest' + civ.year, rng).replace(/^./, (c) => c.toUpperCase()), occasion: last ? 'remembering: ' + last.text.replace(/^-?\d+: /, '').slice(0, 60) : 'the founding', activity: pick(civ, ['bonfires', 'parades', 'feasting', 'games', 'lanterns']) }); if (n.cult.festivals.length > 5) n.cult.festivals.shift(); }
    for (const id in n.rel) {
      const o = civ.nations[id], r = n.rel[id]; if (!o.alive || !(r.trade || r.border)) continue;
      const sp = C.blendCulture(n.cult, o.cult, r.trade ? 0.02 : 0.008, rng);
      if (sp) { n.cult.sports.push(sp); log(civ, 'culture', `${civ.year}: ${n.name} takes up ${sp.name}, a game from ${o.name}.`, [n.id, o.id]); }
      if (r.trade && R(civ) < 0.08) { const w = pick(civ, ['iron', 'coin', 'salt', 'wine', 'glass', 'king', 'machine', 'fire', 'bread']); C.word(o.lang, w, rng); C.borrowWord(n.lang, o.lang, w); }
    }
  }
}

// ---------- god acts ----------
export function godAct(civ, world, event) {
  civ._ev = civ._ev || [];
  M.notify(world, event);
  const inR = (m) => event.x == null || !event.radius || (m.x - event.x) ** 2 + (m.y - event.y) ** 2 <= event.radius ** 2;
  const hit = new Set();
  if (event.x != null) { const o = civ.map.own[tileOf(civ, event.x, event.y)]; if (o >= 0) hit.add(o); } else civ.nations.forEach((n) => n.alive && hit.add(n.id));
  const out = [];
  if (event.type === 'plague') out.push(plague(civ, world, inR, event.intensity ?? 1));
  for (const id of hit) {
    const n = civ.nations[id]; if (!n || !n.alive) continue;
    if (event.type === 'famine' || event.type === 'flood') { n.stock.food *= 0.3; if (event.type === 'flood') n.stock.goods *= 0.6; out.push(log(civ, 'god', `${civ.year}: a ${event.type} sent by the god strikes ${n.name}.`, [id])); }
    if (event.type === 'bless' || event.type === 'feed' || event.type === 'rain') { n.stock.food += n.pop * (event.type === 'feed' ? 3 : 1.5); if (n.leader) n.leader.legitimacy = clamp(n.leader.legitimacy + 0.05); }
    if (event.type === 'miracle') { if (n.leader) n.leader.legitimacy = clamp(n.leader.legitimacy + 0.1); out.push(log(civ, 'god', `${civ.year}: a miracle is witnessed in ${n.name}.`, [id])); }
    if (event.type === 'quake' || event.type === 'fire' || event.type === 'lightning') { n.stock.goods *= 0.7; n.machines *= 0.9; n.replicators *= 0.9; }
    if (event.type === 'war') { let foe = null, fv = 1e9; for (const k in n.rel) { const o = civ.nations[k]; if (o.alive && !n.rel[k].war && n.rel[k].op < fv) { fv = n.rel[k].op; foe = o; } } if (foe) startWar(civ, world, n, foe, 'a command of the god'); }
    if (event.type === 'peace') for (const w of civ.wars) if (w.on && (w.a === id || w.b === id)) endWar(civ, world, w, civ.nations[w.score >= 0 ? w.a : w.b], civ.nations[w.score >= 0 ? w.b : w.a]);
  }
  return out;
}
export function plague(civ, world, filter = () => true, k = 1) {
  let dead = 0, n0 = 0;
  for (const m of world.minds) {
    if (!m.alive || !filter(m)) continue; const p = civ.people[m.id]; if (!p || p.died != null) continue; n0++;
    const g = Gn.phenotype(p.g);
    if (R(civ) < 0.35 * k * (1 - 0.92 * g.resist) * (m.age > 60 || m.age < 5 ? 1.5 : 1)) { kill(civ, world, p, m, 'plague'); dead++; }
  }
  return log(civ, 'plague', `${civ.year}: plague! ${dead} of ${n0} die; those with inherited resistance survive more often.`, []);
}

// ---------- describe / inspect ----------
const pct = (v) => (fin(v) * 100).toFixed(0) + '%';
export function nationInfo(civ, id) {
  const n = civ.nations[id]; if (!n) return null;
  const rels = Object.entries(n.rel).filter(([k]) => civ.nations[k].alive).map(([k, r]) => ({ id: +k, name: civ.nations[k].name, op: r.op, trade: r.trade, alliance: r.alliance, embargo: r.embargo, rival: r.rival, war: r.war, grudge: r.grudge, border: r.border }));
  const fams = Object.values(civ.families).filter((f) => f.nat === n.id && f.living > 0).sort((a, b) => b.living - a.living).slice(0, 10).map((f) => ({ id: f.id, name: f.name, living: f.living }));
  return { id, name: n.name, alive: n.alive, gov: n.gov, pop: n.pop, tiles: n.tiles, color: n.color, leader: n.leader, pastLeaders: n.pastLeaders.slice(-6), factions: n.factions,
    laws: n.laws, rels, families: fams, sports: n.cult.sports.map((s, i) => ({ i, name: s.name })), lang: n.lang.name, gdp: n.gdp, gini: n.gini, treasury: n.treasury, prices: n.price, jobs: n.jobs,
    known: n.K.size, milestones: Object.entries(civ.milestones).filter(([, v]) => n.K.has(v.item)).map(([k]) => k), hist: n.hist.slice(-15), replicators: n.replicators, coinHash: n.coinHash,
    wars: civ.wars.filter((w) => w.a === id || w.b === id).slice(-6).map((w) => ({ name: w.name, foe: civ.nations[w.a === id ? w.b : w.a].name, start: w.start, end: w.end, on: w.on, cause: w.cause, won: w.winner === id })) };
}
export function describeNation(civ, id) {
  const n = civ.nations[id]; if (!n) return 'No such nation.';
  const I = nationInfo(civ, id), rng = rf(civ);
  const jobs = Object.entries(n.jobs).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([j, c]) => `${j} ${c}`).join(', ');
  const rels = I.rels.map((r) => `${r.name}: ${r.war ? 'AT WAR' : r.alliance ? 'ally' : r.embargo ? 'embargo' : r.trade ? 'trade partner' : r.rival ? 'rival' : 'neutral'} (opinion ${r.op.toFixed(2)}${r.grudge > 0.2 ? ', grudge ' + r.grudge.toFixed(2) : ''})`).join('; ');
  const sample = [0, 1, 2].map(() => C.personName(n.lang, rng)).join(', ');
  const gp = (g) => pct(n.freqs[Gn.GROUPS[g][0]]);
  return `${n.name} — ${n.alive ? '' : `fell in ${n.died}; `}${n.gov}, founded ${n.founded}${n.parent != null ? ' (split from ' + civ.nations[n.parent].name + ')' : ''}. Population ${n.pop}, ${n.tiles} lands.\n` +
    `Ruler: ${C.describeLeader(n.leader)}\nPast rulers: ${I.pastLeaders.map((l) => `${l.title} ${l.name} (${l.since}-${l.until})`).join(', ') || 'none'}.\nLaws: ${n.laws.join('; ')}.\n` +
    `Factions: ${n.factions.slice().sort((a, b) => b.influence - a.influence).map((f) => `${f.name} ${pct(f.influence)}`).join(', ')}.\n` +
    `Economy: GDP ${n.gdp.toFixed(0)}/month, inequality (Gini) ${n.gini.toFixed(2)}, treasury ${n.treasury.toFixed(0)}, food ${pct(n.foodRatio)}. Jobs: ${jobs}. Prices: food ${n.price.food.toFixed(2)}, metal ${n.price.metal.toFixed(2)}, power ${n.price.power.toFixed(2)}.` +
    `${n.replicators ? ` Self-replicating factories: ${n.replicators.toFixed(1)}.` : ''}\nTech: knows ${n.K.size} things; milestones: ${I.milestones.join(', ') || 'none'}.\nRelations: ${rels || 'none'}.\n` +
    `Wars: ${I.wars.map((w) => `${w.name} vs ${w.foe} (${w.start}${w.on ? '-ongoing' : '-' + w.end}${w.on ? '' : w.won ? ', won' : ', lost'}; ${w.cause})`).join('; ') || 'none'}.\n` +
    `Culture: ${C.describeCulture(n.cult)}\nLanguage: ${C.describeLanguage(n.lang)} Typical names: ${sample}.\nFounding gene pool: dark skin alleles ${gp('skin')}, tall alleles ${gp('height')}, plague-resistance ${gp('resist')}.\n` +
    `History: ${I.hist.slice(-6).map((e) => e.text).join(' ')}`;
}
export function describeFamily(civ, fid) {
  const f = civ.families[fid]; if (!f) return 'No such family.';
  const members = Object.values(civ.people).filter((p) => p.fam === f.id), living = members.filter((p) => p.died == null);
  const feuds = Object.entries(f.feuds).filter(([, v]) => v > 0.3).map(([k, v]) => `the ${civ.families[k]?.name} (${v.toFixed(1)})`).join(', ');
  const grudges = Object.entries(f.grudges).filter(([, v]) => v > 0.2).map(([k]) => civ.nations[k]?.name).join(', ');
  const g = living.map((p) => p.g);
  const trait = g.length ? `Family genes (living): tall alleles ${pct(Gn.groupFreq(g, 'height'))}, intellect ${pct(Gn.groupFreq(g, 'intel'))}, plague resistance ${pct(Gn.groupFreq(g, 'resist'))}, wasting-sickness allele ${pct(Gn.groupFreq(g, 'dis'))}.` : '';
  return `House ${f.name} of ${civ.nations[f.nat]?.name}, founded ${f.founded}. ${members.length} members over ${f.gen} generations, ${living.length} living` +
    `${living.length ? ' (' + living.slice(0, 6).map((p) => `${p.name}, ${p.job}`).join('; ') + (living.length > 6 ? '…' : '') + ')' : ''}. ` +
    `${f.rulers.length ? 'Rulers: ' + f.rulers.join('; ') + '. ' : ''}${f.heroes.length ? 'Heroes: ' + f.heroes.slice(-4).join('; ') + '. ' : ''}${f.legends.length ? 'Legends: ' + f.legends.slice(-3).join('; ') + '. ' : ''}` +
    `${feuds ? 'Feuds with ' + feuds + '. ' : ''}${grudges ? 'Remembers kin lost to ' + grudges + '. ' : ''}${trait}`;
}
export function familyInfo(civ, fid) {
  const f = civ.families[fid]; if (!f) return null;
  const members = Object.values(civ.people).filter((p) => p.fam === f.id);
  const nm = (i) => (civ.people[i] ? fullName(civ, civ.people[i]) : null);
  return { ...f, members: members.slice(-40).map((p) => ({ id: p.id, name: p.name, born: p.born, died: p.died, job: p.job, par: p.par, father: p.par[0] != null ? { id: p.par[0], name: nm(p.par[0]) } : null, mother: p.par[1] != null ? { id: p.par[1], name: nm(p.par[1]) } : null })) };
}
export function personInfo(civ, world, id) {
  const p = civ.people[id]; if (!p) return null; const m = world.byId.get(+id);
  const nm = (i) => fullName(civ, civ.people[i]);
  return { id: p.id, name: fullName(civ, p), sex: p.sex, born: p.born, died: p.died, cause: p.cause, age: m ? m.age : null, nation: p.nat, nationName: civ.nations[p.nat]?.name, fam: p.fam, famName: civ.families[p.fam]?.name,
    job: p.job, wealth: p.w, coins: p.coins, faction: civ.nations[p.nat]?.factions.find((f) => f.id === p.fac)?.name, factionId: p.fac, parents: p.par.map((i, k) => ({ id: i, name: nm(i), role: k === 0 ? 'father' : 'mother', parents: (civ.people[i]?.par || []).map((j, q) => ({ id: j, name: nm(j), role: q === 0 ? 'grandfather' : 'grandmother' })) })), kids: p.kids.map((i) => ({ id: i, name: nm(i) })),
    spouse: m && m.spouse != null ? { id: m.spouse, name: nm(m.spouse) } : null, appearance: personAppearance(civ, id), phenotype: Gn.phenotype(p.g) };
}
export function describePerson(civ, world, id) {
  const p = civ.people[id]; if (!p) return 'Unknown person.'; const m = world.byId.get(+id), I = personInfo(civ, world, id), ph = I.phenotype;
  const inh = p.par.map((i) => civ.people[i]).filter(Boolean).map((q) => { const f = Gn.phenotype(q.g); return `${q.sex === 'f' ? 'mother' : 'father'} ${q.name}: ${f.heightCm} cm, ${f.hair} hair, ${f.eye} eyes, resistance ${pct(f.resist)}${f.disease ? ', wasting sickness' : ''}`; }).join('; ');
  let s = `${I.name} (${p.sex}), born ${p.born}${p.died != null ? `, died ${p.died} (${p.cause})` : `, age ${I.age}`}, of House ${I.famName} in ${I.nationName}. Works as a ${p.job}${p.lastW ? ` earning ${p.lastW.toFixed(1)}/month` : ''}; wealth ${p.w.toFixed(0)}${p.coins ? `, ${p.coins.toFixed(3)} ${civ.coin?.name}` : ''}. ` +
    `${I.faction ? 'Sides with the ' + I.faction + '. ' : ''}${I.parents.length ? 'Child of ' + I.parents.map((x) => x.name).join(' and ') + '. ' : ''}${I.spouse ? 'Spouse: ' + I.spouse.name + '. ' : ''}${I.kids.length ? 'Children: ' + I.kids.map((x) => x.name).join(', ') + '. ' : ''}\n`;
  if (m) s += 'Mind & beliefs: ' + M.describe(m, world) + '\n';
  s += 'Genome: ' + Gn.describeGenome(p.g) + (inh ? `\nInheritance — self: ${ph.heightCm} cm, ${ph.hair} hair, ${ph.eye} eyes; ${inh}.` : '');
  return s;
}
export function describeFaction(civ, fid) { for (const n of civ.nations) { const f = n.factions.find((x) => x.id === fid); if (f) return `${C.describeFaction(f)} (in ${n.name})`; } return 'No such faction.'; }
export function describeSport(civ, nid, i) { const s = civ.nations[nid]?.cult.sports[i]; return s ? C.describeSport(s) : 'No such sport.'; }
export function describeLanguageOf(civ, nid) { const n = civ.nations[nid]; return n ? C.describeLanguage(n.lang) : ''; }
export function describeInvention(civ, iid) {
  const it = civ.items[iid]; if (!it) return 'Unknown.';
  const f = Object.entries(it.F).filter(([, v]) => v > 0.01).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ');
  const parts = it.parts.map((x) => (x === it.id ? 'ITSELF' : civ.items[x]?.name)).join(' + ');
  return `${it.name} (${it.noun}${it.milestone ? ', milestone: ' + it.milestone : ''}). ${it.base ? 'A raw material.' : `Made by ${it.op}: ${parts}. Invented ${it.year} in ${civ.nations[it.by]?.name}${it.inventor != null ? ' by ' + fullName(civ, civ.people[it.inventor]) : ''}.`} ` +
    `Function: ${f || 'none'}${it.p.gates ? `, ${it.p.gates} logic gates` : ''}. Known to ${it.known} nation(s)${it.lost ? ' — LOST' : ''}.${it.self ? ' Its recipe includes itself: it builds copies of itself, limited by metal, silicon and power.' : ''}`;
}
export function personAppearance(civ, id) {
  const p = civ.people[id]; if (!p) return null; const n = civ.nations[p.nat], b = n?.best || {};
  const era = (b.compute || 0) > 0.4 ? 'modern synthetics' : b.current ? 'industrial cotton' : b.metal ? 'tailored wool' : b.heat ? 'woven tunic' : 'hides';
  const JOBC = { soldier: 'armour', priest: 'robe', farmer: 'smock', miner: 'leather apron', smith: 'leather apron', scholar: 'long coat', engineer: 'overalls', programmer: 'hoodie', coinminer: 'hoodie', trader: 'fine coat', child: 'smock', elder: 'shawl' };
  return Gn.appearance(p.g, { clothing: { style: era, garment: JOBC[p.job] || 'tunic', color: n?.color || '#888', pattern: n?.cult.art.motif } });
}
export function techTree(civ) {
  const nodes = civ.items.map((it) => ({ id: it.id, name: it.name, noun: it.noun, op: it.op, year: it.year, nation: it.by, base: !!it.base, milestone: it.milestone || null, lost: it.lost, known: it.known, self: !!it.self }));
  const edges = []; for (const it of civ.items) for (const p of it.parts) edges.push([p, it.id]);
  return { nodes, edges, milestones: civ.milestones };
}
export const chronicle = (civ, n) => (n ? civ.chron.slice(-n) : civ.chron.slice());
export const stats = (civ) => civ.stats;
export const nationAt = (civ, x, y) => civ.map.own[tileOf(civ, x, y)];

// ---------- persistence ----------
export function serialize(civ) {
  const o = {}; for (const k in civ) if (k[0] !== '_') o[k] = civ[k];
  return JSON.stringify(o, (k, v) => (v instanceof Set ? { __set: [...v] } : v));
}
export function deserialize(str) {
  const c = JSON.parse(str, (k, v) => (v && typeof v === 'object' && Array.isArray(v.__set) ? new Set(v.__set) : v));
  c._ev = []; return c;
}
// exposed for tests and tooling (not part of the stable API)
export const _internals = { OPS, simCircuit, assemble, Fn, P };
