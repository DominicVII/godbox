/**
 * godbox-minds.js — NPC minds for a god-sim (pure ES module, no deps, no rendering)
 * =================================================================================
 * Every person has: traits (0..1), needs (0 = satisfied .. 1 = desperate), goals, fears,
 * decaying emotional memories, relationships to specific people, and FAITH in the player-god.
 *
 * API
 *   createMind(opts)                 -> mind   opts: {id,name,x,y,age,sex,traits,faith,seed,group}
 *   createWorldMinds(seed, opts)     -> world  {seed,t,minds[],byId:Map,rng}  opts:{count=0,width,height,groups}
 *   addMind(world, mind)
 *   tick(world, worldState, dt)      -> actions[]  [{id, action, target, x, y}]  (only minds that decided)
 *   notify(target, event, world?)    target = mind | mind[] | world | 'all' (then pass world)
 *       event: {type, x?, y?, radius?, intensity?, text?, about?(id), cruel?}
 *       types: bless, heal, feed, rain, miracle, plague, flood, famine, lightning, fire, quake,
 *              speak, silence, war, peace, death (of `about`), birth, attack, gift
 *   respond(mind, text)              -> {obey:boolean, reply:string}
 *   describe(mind, world?)           -> short life story / inner state
 *   aggregates(world)                -> {population, morale, faith, believers, doubters, apostates, byGroup}
 *   serialize(world) -> string,  deserialize(string) -> world
 *   ACTIONS (string list), FAITH_STATES
 *
 * RIVAL GODS (v2 — the player is the only real god; rivals NEVER act)
 *   world.gods: [{id:'g1', name, kind:'idol'|'ancestor'|'nature'|'war'|'harvest', domain, followers, color, discredited}]
 *     seeded per world: createWorldMinds(seed, {gods: 3})  (default 3; 0 = none)
 *   addGod(world, {name?, kind?, domain?, id?}) -> god      removeGod(world, id) -> boolean
 *   smiteGod(world, id, opts?) == notify(world, {type:'smite', about:id, ...})  -> discredit an idol;
 *       followers waver (stubborn/zealous ones harden instead)
 *   mind.devotion: {godId: 0..1}   mind.allegiance: 'true' | godId | null   (mind.faith = faith in the TRUE god)
 *   allegianceName(mind, world) -> string
 *   Drift: silence, cruelty, unanswered prayer, hunger/danger, coincidence after offerings, and social
 *   pull (neighbours, spouse x3, preaching priests x3) erode the true faith toward a rival; answered prayers,
 *   miracles and failed idols bring people back. Fear of the player pulls the meek/pious toward obedience
 *   and the brave/stubborn toward resentment. Good events (rain, feed, gift, bless) may be credited to
 *   the rival a person already follows. New actions: 'offer' (to a rival), 'preach' (for one's god).
 *   aggregates(world).followers = {true, none, <godId>...}
 *
 * TUNING (exported, mutable; change at runtime, e.g. TUNING.drift *= 2). Rates are per decision (~1/day).
 *   drift          base pull of silence/cruelty/distress toward a rival           (0.012)
 *   fearDrift      resentful fear (brave/stubborn) toward a rival                 (0.004)
 *   social         neighbour/spouse/priest pull toward their rival                (0.0025)
 *   socialCap      max fraction of social signal used (bounds cascades)           (0.4)
 *   socialTrue     pull back to the true god from faithful neighbours             (0.004)
 *   fearPull       meek/pious fear pulling toward obedience                       (0.004)
 *   answeredPull   pull back while a recent prayer/miracle is fresh               (0.03)
 *   answeredDays   how long that afterglow lasts, days                            (7)
 *   devotionDecay  passive decay of every rival devotion                          (0.003)
 *   faithErosion   share of rival pull that also erodes true faith                (0.35)
 *   silenceFaith   faith lost per 'silence' event                                 (0.006)
 *   miracleDevotion fraction of each rival devotion a miracle strips (x(1-0.4*stubbornness)) (0.6)
 *   miracleFaith   extra faith a miracle gives a rival follower                   (0.35)
 *   silenceRamp    silences needed before silence pressure is full (ramp, cap 1.5x)  (45)
 *   preachSway     direct sway of one sermon on a listener                        (0.012)
 *   offerReward    devotion gained when an offering "works" by coincidence        (0.04)
 *   creditRain     devotion gained crediting rain/food/gifts to a rival           (0.03)
 *  Holding out (emergent, per mind; nobody is guaranteed to stay):
 *   resolve = [grace>0 ? piety*stubbornness*resolveTraits + min(1,grace)*resolveGrace + faithfulSpouse*resolveKin
 *              + personal noise (from mind.seed, +-resolveNoise/2) : 0] - tragedy*resolveTragedy - wrath*resolveWrath
 *   mind.grace accrues from answered prayers (graceAnswered 0.5, natural relief graceNatural 0.08) and
 *   miracles (graceMiracle 0.6), decays graceDecay (0.0008)/decision. With no grace, resolve is 0: no holdout.
 *   If resolve > resolveThreshold (0.72), mind.hold (0..1) shields silence/distress/social drift by holdShield (0.97).
 *   Cruelty (wrath) and tragedy (grief, attacks, plagues) are NOT shielded and also lower resolve.
 *   graceMin 0.05 = grace needed before resolve counts at all. historyGraceChance 0.35 (x(0.3+piety)) = seeded
 *   chance a starting mind already has grace (0.15..1) from past answered prayers.
 *   Defaults: resolveTraits 0.9, resolveGrace 0.35, resolveKin 0.12, resolveNoise 0.5, resolveTragedy 0.6, resolveWrath 0.8
 *
 * worldState (abstract; every field optional — host adapts)
 *   nearby(mind, radius) -> mind[]      spatial hint. If absent, tick builds a uniform grid (O(n)).
 *   food(mind)   -> 0..1 local food availability      (default 0.5)
 *   danger(mind) -> 0..1 local threat                 (default 0)
 *   shelter(mind)-> 0..1                              (default 0.5)
 *   time         -> seconds (default internal clock)
 *   stride       -> {k, of} optional: tick only minds i % of == k, with dt*of (spread a crowd over frames)
 * dt is in "days" (1 = one in-game day). Decisions happen every ~0.5–1.5 days per mind,
 * so per-tick cost is O(n * k) with k = capped neighbour count. Deterministic given seed.
 */

export const ACTIONS = ['work', 'farm', 'build', 'wander', 'court', 'marry', 'feud', 'fight',
  'flee', 'pray', 'migrate', 'found', 'rest', 'socialize', 'offer', 'preach'];
export const GOD_KINDS = ['idol', 'ancestor', 'nature', 'war', 'harvest'];
export const FAITH_STATES = ['devout', 'believer', 'doubter', 'apostate'];

// ---------- RNG ----------
export function mulberry32(a) {
  a >>>= 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const T_ = (m) => m.traits;
export const TUNING = {
  drift: 0.012, fearDrift: 0.004, social: 0.0025, socialCap: 0.4, socialTrue: 0.004, fearPull: 0.004,
  answeredPull: 0.03, answeredDays: 7, devotionDecay: 0.003, faithErosion: 0.35, silenceFaith: 0.006,
  miracleDevotion: 0.6, miracleFaith: 0.35, silenceRamp: 45, preachSway: 0.012, offerReward: 0.04, creditRain: 0.03,
  resolveTraits: 0.9, resolveGrace: 0.35, resolveKin: 0.12, resolveNoise: 0.5, resolveTragedy: 0.6, resolveWrath: 0.8,
  resolveThreshold: 0.72, holdShield: 0.97, graceAnswered: 0.5, graceNatural: 0.08, graceMiracle: 0.6, graceDecay: 0.0008, graceMin: 0.05, historyGraceChance: 0.35,
};
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : (v === v ? v : a));
const NAMES_A = ['Ar', 'Bel', 'Cor', 'Da', 'El', 'Fen', 'Gar', 'Hal', 'Is', 'Jor', 'Ka', 'Lu', 'Mi', 'Nor', 'Os', 'Pe', 'Ri', 'Sa', 'Tor', 'Ul', 'Ve', 'Wyn', 'Ya', 'Zel'];
const NAMES_B = ['a', 'en', 'ric', 'wyn', 'ia', 'o', 'is', 'eth', 'an', 'ra', 'mund', 'ys', 'el', 'ka', 'th'];
const TRAITS = ['piety', 'courage', 'sociability', 'ambition', 'kindness', 'stubbornness', 'curiosity', 'temper', 'diligence'];
const GOALS = ['prosper', 'family', 'glory', 'knowledge', 'peace', 'faith', 'land', 'revenge'];
const FEARS = ['hunger', 'death', 'the god', 'loneliness', 'strangers', 'water', 'fire', 'sickness'];
const MAX_MEM = 12, MAX_REL = 16;

let _anonRng = mulberry32(12345);

// ---------- minds ----------
export function createMind(opts = {}) {
  const rng = opts.rng || (opts.seed != null ? mulberry32(opts.seed) : _anonRng);
  const traits = {};
  for (const k of TRAITS) traits[k] = clamp(opts.traits?.[k] ?? (rng() + rng()) / 2);
  const name = opts.name || NAMES_A[(rng() * NAMES_A.length) | 0] + NAMES_B[(rng() * NAMES_B.length) | 0];
  const faith = clamp(opts.faith ?? 0.35 + traits.piety * 0.45 + (rng() - 0.5) * 0.2);
  return {
    id: opts.id ?? ((rng() * 1e9) | 0), name,
    age: opts.age ?? 16 + ((rng() * 50) | 0), sex: opts.sex || (rng() < 0.5 ? 'f' : 'm'),
    x: opts.x ?? 0, y: opts.y ?? 0, group: opts.group ?? 0, home: { x: opts.x ?? 0, y: opts.y ?? 0 },
    traits,
    needs: { hunger: rng() * 0.3, safety: 0.1, rest: rng() * 0.3, belonging: 0.3 + rng() * 0.3, meaning: 0.3 + rng() * 0.3 },
    goal: opts.goal || GOALS[(rng() * GOALS.length) | 0],
    fear: opts.fear || FEARS[(rng() * FEARS.length) | 0],
    faith, faithState: 'believer', fearOfGod: 0.1, lastAnswered: 0, silence: 0,
    prayer: null,          // {need, t}
    memories: [],          // {type, weight, t, about, text}
    relations: {},         // id -> {love, friend, grudge, rival}
    spouse: null, alive: true, action: 'rest', target: null, cooldown: rng(),
    mood: 0.5, history: [], faithLog: [faith], seed: (rng() * 4294967296) >>> 0,
    devotion: { ...(opts.devotion || {}) }, allegiance: opts.allegiance !== undefined ? opts.allegiance : (faith > 0.25 ? 'true' : null),
    wrath: 0, offering: null, preached: 0, priest: false,
  };
}

// ---------- rival gods (never act; perceived only) ----------
const GSYL = ['Zor', 'Ama', 'Bra', 'Keth', 'Mor', 'Ish', 'Vul', 'Ten', 'Ora', 'Gul', 'Sef', 'Dra', 'Nim', 'Ux'];
const GEND = ['ak', 'un', 'is', 'oth', 'a', 'el', 'ix', 'ar', 'em', 'u'];
const GDOM = {
  idol: ['fortune', 'gold', 'the hearth', 'fertility'], ancestor: ['lineage', 'memory', 'the dead'],
  nature: ['the river', 'the old oak', 'the mountain', 'the storm', 'the moon'], war: ['battle', 'the spear', 'blood'],
  harvest: ['grain', 'the sheaf', 'rain', 'the orchard'],
};
const GCOL = ['#e5533d', '#4fb3ff', '#b46cff', '#ff9f1c', '#3ddc84', '#ff5fa2', '#c9b458', '#00c2b8'];
function godName(rng, kind, domain) {
  const b = GSYL[(rng() * GSYL.length) | 0] + GEND[(rng() * GEND.length) | 0];
  switch (kind) {
    case 'idol': return `${b} the Gilded`;
    case 'ancestor': return `${rng() < 0.5 ? 'Grandmother' : 'Grandfather'} ${b}`;
    case 'nature': return `${b}, Spirit of ${domain.replace(/^the (.)/, (_, c) => 'the ' + c.toUpperCase())}`;
    case 'war': return `${b} Spear-Father`;
    default: return `${b} of ${domain.replace(/^the /, 'the ')}`;
  }
}
export function addGod(world, opts = {}) {
  world.gods = world.gods || [];
  const rng = world.godRng || (world.godRng = mulberry32((world.seed ^ 0x5bd1e995) >>> 0));
  const kind = GOD_KINDS.includes(opts.kind) ? opts.kind : GOD_KINDS[(rng() * GOD_KINDS.length) | 0];
  const doms = GDOM[kind], domain = opts.domain || doms[(rng() * doms.length) | 0];
  world.nextGodId = world.nextGodId || 1;
  let id = opts.id != null ? String(opts.id) : 'g' + world.nextGodId;
  while (id === 'true' || world.gods.some((g) => g.id === id)) id = 'g' + ++world.nextGodId;
  world.nextGodId++;
  const g = { id, name: opts.name || godName(rng, kind, domain), kind, domain, followers: 0,
    color: opts.color || GCOL[(world.gods.length) % GCOL.length], discredited: 0 };
  world.gods.push(g); return g;
}
export function removeGod(world, id) {
  const i = (world.gods || []).findIndex((g) => g.id === id); if (i < 0) return false;
  world.gods.splice(i, 1);
  for (const m of world.minds) if (m.devotion && id in m.devotion) { delete m.devotion[id]; updateAllegiance(m, world, world.t); }
  return true;
}
function godById(world, id) { if (!world || !world.gods) return null; for (const g of world.gods) if (g.id === id) return g; return null; }
export function allegianceName(m, world) {
  if (m.allegiance === 'true') return 'the true god';
  if (m.allegiance == null) return 'no god';
  return godById(world, m.allegiance)?.name || 'a forgotten god';
}
function updateAllegiance(m, world, t) {
  const dv = m.devotion || (m.devotion = {});
  let bg = null, bv = 0;
  for (const k in dv) { if (world && world.gods && !godById(world, k)) { delete dv[k]; continue; } if (dv[k] > bv) { bv = dv[k]; bg = k; } }
  const prev = m.allegiance, cur = prev === 'true' ? m.faith : prev ? (dv[prev] || 0) : 0, H = 0.06;
  let next;
  const bestV = Math.max(m.faith, bv), bestId = m.faith >= bv ? 'true' : bg;
  if (bestV < 0.2) next = null;
  else if (prev && prev === bestId) next = prev;
  else if (prev && cur + H > bestV && cur >= 0.2) next = prev;  // hysteresis
  else next = bestId;
  if (next !== prev) {
    m.allegiance = next;
    const nm = next === 'true' ? 'the true god' : next ? (godById(world, next)?.name || next) : null;
    remember(m, next === 'true' ? 'returned to the true god' : next ? 'turned to ' + nm : 'lost all gods', 0.7, t || 0, null, nm);
  }
}
function addDev(m, id, d) { if (id == null || id === 'true') return; const dv = m.devotion || (m.devotion = {}); dv[id] = clamp((dv[id] || 0) + d); if (dv[id] < 0.01) delete dv[id]; }

export function createWorldMinds(seed = 1, opts = {}) {
  const rng = mulberry32(seed);
  const world = { seed, t: 0, minds: [], byId: new Map(), rng, nextId: 1, width: opts.width || 1000, height: opts.height || 1000,
    gods: [], nextGodId: 1, godRng: mulberry32((seed ^ 0x5bd1e995) >>> 0) };
  const ng = opts.gods ?? 3;
  for (let i = 0; i < ng; i++) addGod(world, { kind: GOD_KINDS[(i * 2 + ((world.godRng() * 5) | 0)) % 5] });
  const groups = opts.groups || 1;
  for (let i = 0; i < (opts.count || 0); i++) {
    const g = i % groups;
    const cx = world.width * (g + 0.5) / groups, cy = world.height / 2;
    addMind(world, createMind({ id: world.nextId, rng, group: g,
      x: cx + (rng() - 0.5) * world.width * 0.4 / groups, y: cy + (rng() - 0.5) * world.height * 0.4 }));
  }
  // a seeded minority already keeps older gods (separate rng: mind generation is unchanged from v1)
  const gr = world.godRng;
  // seeded personal history: some remember answered prayers from before the story begins
  for (const m of world.minds) if (gr() < TUNING.historyGraceChance * (0.3 + m.traits.piety)) m.grace = 0.15 + gr() * 0.85;
  if (world.gods.length) for (const m of world.minds) {
    if (gr() < 0.45 * (1 - m.faith) + 0.08) {
      const g = world.gods[(gr() * world.gods.length) | 0]; m.devotion[g.id] = 0.3 + gr() * 0.45; updateAllegiance(m, world, 0);
    }
  }
  countFollowers(world);
  return world;
}
function countFollowers(world) {
  if (!world.gods) return;
  const c = {}; for (const m of world.minds) if (m.alive && m.allegiance && m.allegiance !== 'true') c[m.allegiance] = (c[m.allegiance] || 0) + 1;
  for (const g of world.gods) g.followers = c[g.id] || 0;
}
export function addMind(world, m) {
  if (m.id == null || world.byId.has(m.id)) m.id = world.nextId;
  world.nextId = Math.max(world.nextId, m.id + 1);
  world.minds.push(m); world.byId.set(m.id, m); return m;
}

function remember(m, type, weight, t, about, text) {
  const mem = m.memories;
  if (mem.length >= MAX_MEM) {
    let lo = 0; for (let i = 1; i < mem.length; i++) if (Math.abs(mem[i].weight) < Math.abs(mem[lo].weight)) lo = i;
    if (Math.abs(mem[lo].weight) > Math.abs(weight)) return;
    mem.splice(lo, 1);
  }
  mem.push({ type, weight, t, about: about ?? null, text: text || null });
  if (Math.abs(weight) > 0.5) { m.history.push(`${type}@${t.toFixed(0)}`); if (m.history.length > 20) m.history.shift(); }
}
function rel(m, id) {
  let r = m.relations[id];
  if (!r) {
    const keys = Object.keys(m.relations);
    if (keys.length >= MAX_REL) { // forget weakest
      let wk = keys[0], ws = 9;
      for (const k of keys) { const q = m.relations[k], s = q.love + q.friend + q.grudge + q.rival; if (s < ws) { ws = s; wk = k; } }
      if (+wk === m.spouse) return { love: 0, friend: 0, grudge: 0, rival: 0 };
      delete m.relations[wk];
    }
    r = m.relations[id] = { love: 0, friend: 0, grudge: 0, rival: 0 };
  }
  return r;
}
function faithChange(m, d, t) {
  // steadfast believers resist loss; apostates resist gain
  if (d < 0) d *= 1 - 0.6 * m.traits.piety * m.traits.stubbornness - (m.faith > 0.8 ? 0.25 : 0);
  else if (m.faithState === 'apostate') d *= 0.4 + 0.6 * (1 - m.traits.stubbornness);
  m.faith = clamp(m.faith + d);
  const f = m.faith, prev = m.faithState;
  m.faithState = f > 0.75 ? 'devout' : f > 0.45 ? 'believer' : f > (prev === 'apostate' ? 0.3 : 0.15) ? 'doubter' : 'apostate';
  if (prev !== m.faithState) remember(m, m.faithState === 'apostate' ? 'left the faith' : m.faithState === 'devout' ? 'became devout' : m.faithState === 'doubter' ? 'began to doubt' : 'believed again', 0.6, t);
}

// ---------- notify ----------
const EVENTS = {
  bless:     { good: 1, hunger: -0.3, safety: -0.2, meaning: -0.3, faith: 0.08, mood: 0.3 },
  heal:      { good: 1, safety: -0.3, faith: 0.1, mood: 0.3 },
  feed:      { good: 1, hunger: -0.6, faith: 0.06, mood: 0.2 },
  rain:      { good: 1, hunger: -0.15, faith: 0.03, mood: 0.1 },
  miracle:   { good: 1, meaning: -0.5, faith: 0.15, mood: 0.3, awe: 0.2 },
  gift:      { good: 1, hunger: -0.2, faith: 0.05, mood: 0.2 },
  plague:    { cruel: 1, safety: 0.5, rest: 0.3, faith: -0.08, mood: -0.4, awe: 0.15 },
  flood:     { cruel: 1, safety: 0.6, hunger: 0.3, faith: -0.06, mood: -0.4, awe: 0.15 },
  famine:    { cruel: 1, hunger: 0.6, faith: -0.05, mood: -0.3 },
  lightning: { cruel: 1, safety: 0.5, faith: -0.04, mood: -0.3, awe: 0.3 },
  fire:      { cruel: 1, safety: 0.5, faith: -0.05, mood: -0.3, awe: 0.1 },
  quake:     { cruel: 1, safety: 0.6, faith: -0.05, mood: -0.3, awe: 0.25 },
  war:       { safety: 0.6, mood: -0.3, meaning: -0.1 },
  peace:     { safety: -0.5, mood: 0.3 },
  death:     { belonging: 0.4, mood: -0.5, meaning: 0.2 },
  birth:     { belonging: -0.3, meaning: -0.3, mood: 0.3 },
  attack:    { safety: 0.4, mood: -0.3 },
  speak:     { meaning: -0.2, faith: 0.04, awe: 0.1 },
  silence:   {},
  smite:     { awe: 0.25 },
};
export function smiteGod(world, id, opts = {}) { notify(world, { ...opts, type: 'smite', about: id }); }
const CREDITABLE = { rain: 1, feed: 1, gift: 1, bless: 1, heal: 0.5 };
export function notify(target, event, world) {
  if (target === 'all') target = world.minds;
  else if (target && target.minds) { world = target; target = target.minds; }
  const list = Array.isArray(target) ? target : [target];
  const e = EVENTS[event.type] || {}, t = world ? world.t : (event.t || 0);
  const k = event.intensity ?? 1, r2 = event.radius ? event.radius * event.radius : Infinity;
  if (event.type === 'smite' && world) { const g = godById(world, event.about); if (g) g.discredited = (g.discredited || 0) + 1; }
  for (const m of list) {
    if (!m || !m.alive) continue;
    let w = k;
    if (event.x != null && r2 !== Infinity) {
      const dx = m.x - event.x, dy = m.y - event.y, d2 = dx * dx + dy * dy;
      if (d2 > r2 * 4) continue;            // heard of it only nearby
      w *= d2 <= r2 ? 1 : 0.3;               // rumor
    }
    const n = m.needs;
    for (const key of ['hunger', 'safety', 'rest', 'belonging', 'meaning']) if (e[key]) n[key] = clamp(n[key] + e[key] * w);
    m.mood = clamp(m.mood + (e.mood || 0) * w);
    if (e.awe) m.fearOfGod = clamp(m.fearOfGod + e.awe * w);
    if (!m.devotion) m.devotion = {};
    if (m.allegiance === undefined) m.allegiance = m.faith > 0.25 ? 'true' : null;
    if (event.type === 'smite') {
      const id = event.about, dv = m.devotion[id] || 0;
      if (dv > 0.01) {
        const follower = m.allegiance === id;
        const hard = T_(m).stubbornness * 0.55 + dv * 0.35 + T_(m).temper * 0.2 - m.fearOfGod * 0.3;
        if (follower && hard > 0.55) { addDev(m, id, 0.08 * w); faithChange(m, -0.04 * w, t); m.wrath = clamp((m.wrath || 0) + 0.2 * w); remember(m, 'hardened for ' + id, 0.7 * w, t); }
        else { addDev(m, id, -(0.25 + 0.3 * (1 - T_(m).stubbornness)) * w); faithChange(m, (0.05 + 0.1 * m.fearOfGod) * w, t); remember(m, 'idol failed', -0.6 * w, t); }
      }
      updateAllegiance(m, world, t); continue;
    }
    if (event.type === 'silence') { m.silence += 1 * w; faithChange(m, -TUNING.silenceFaith * w * (1 - m.traits.piety * 0.5) * (1 - (m.hold || 0) * TUNING.holdShield), t); continue; }
    if (e.good) {
      let d = e.faith * w;
      if (m.prayer) { d += 0.12 * w; remember(m, 'prayer answered', 0.9 * w, t); m.grace = clamp((m.grace || 0) + TUNING.graceAnswered * w, 0, 3); m.prayer = null; m.lastAnswered = t; m._answered = true; }
      else remember(m, event.type, 0.5 * w, t);
      // perception: who gets the credit? rival followers may thank their own god for rain or bread
      const ra = m.allegiance;
      if (CREDITABLE[event.type] && ra && ra !== 'true' && !m._answered && (m.devotion[ra] || 0) * CREDITABLE[event.type] + (m.offering ? 0.2 : 0) > m.faith * 0.8) {
        addDev(m, ra, TUNING.creditRain * w); d *= 0.2; remember(m, 'blessed by ' + ra, 0.5 * w, t); m.offering = null;
      } else if (event.type === 'miracle' || m._answered) {
        for (const id in m.devotion) { const k = (event.type === 'miracle' ? TUNING.miracleDevotion : 0.12) * Math.min(1, w) * (1 - 0.4 * m.traits.stubbornness); addDev(m, id, -m.devotion[id] * k - 0.05 * k); }
        if (event.type === 'miracle') { m.lastAnswered = t || 1e-9; m.grace = clamp((m.grace || 0) + TUNING.graceMiracle * Math.min(1, w), 0, 3); }
        if (event.type === 'miracle' && m.allegiance !== 'true') { m.faith = clamp(m.faith + TUNING.miracleFaith * w); remember(m, 'witnessed a miracle', 0.8 * w, t); }
      }
      m._answered = false;
      m.silence = 0; m.wrath = clamp((m.wrath || 0) - 0.1 * w); faithChange(m, d, t); updateAllegiance(m, world, t);
    } else if (e.cruel || event.cruel) {
      // devout & fearful may read cruelty as just punishment
      const justified = m.traits.piety * 0.6 + m.fearOfGod * 0.4;
      const d = (e.faith ?? -0.05) * w * (justified > 0.6 ? -0.4 : 1);
      faithChange(m, d, t); remember(m, event.type, -0.7 * w, t);
      if (justified <= 0.6) m.wrath = clamp((m.wrath || 0) + 0.25 * w);
      if (m.prayer) remember(m, 'prayer met with wrath', -0.8, t);
    } else if (event.type === 'death' && event.about != null) {
      const r = m.relations[event.about];
      if (r && (r.love + r.friend) > 0.3) {
        remember(m, 'grief', -0.9 * w, t, event.about); n.belonging = clamp(n.belonging + 0.3);
        if (m.spouse === event.about) m.spouse = null;
        if (event.killer != null) { const g = rel(m, event.killer); g.grudge = clamp(g.grudge + 0.7); m.goal = 'revenge'; }
        if (m.prayer) faithChange(m, -0.1, t);
      }
      delete m.relations[event.about];
    } else if (event.type === 'speak') {
      remember(m, 'heard the god', 0.6 * w, t, null, event.text);
      m.silence = 0; faithChange(m, e.faith * w * (m.faithState === 'apostate' ? 0.3 : 1), t);
    } else if (event.type === 'attack' && event.about != null) {
      const g = rel(m, event.about); g.grudge = clamp(g.grudge + 0.5 * w); remember(m, 'attacked', -0.7, t, event.about);
    } else if (e.mood) remember(m, event.type, e.mood * w, t);
    if (event.type === 'war' && event.about != null && event.about !== m.group) m.enemyGroup = event.about;
    if (event.type === 'peace') m.enemyGroup = null;
  }
}

// ---------- spatial fallback ----------
function buildGrid(minds, cell) {
  const g = new Map();
  for (const m of minds) {
    if (!m.alive) continue;
    const k = ((m.x / cell) | 0) * 73856093 ^ ((m.y / cell) | 0) * 19349663;
    let a = g.get(k); if (!a) g.set(k, a = []); a.push(m);
  }
  return g;
}
const _nb = [];
function gridNearby(g, cell, m, cap) {
  _nb.length = 0;
  const cx = (m.x / cell) | 0, cy = (m.y / cell) | 0;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const a = g.get((cx + dx) * 73856093 ^ (cy + dy) * 19349663);
    if (a) for (let i = 0; i < a.length && _nb.length < cap; i++) if (a[i] !== m) _nb.push(a[i]);
  }
  return _nb;
}

// ---------- tick ----------
const U = new Float64Array(ACTIONS.length), _soc = new Map();
export function tick(world, ws = {}, dt = 0.1) {
  world.t += dt;
  // optional hook (ws.stride = {k, of}): update only every of-th mind, starting at k, with dt*of —
  // spreads a big crowd over several frames. Absent = original behaviour.
  const S0 = ws.stride && ws.stride.of > 1 ? ws.stride : null, i0 = S0 ? S0.k % S0.of : 0, di = S0 ? S0.of : 1;
  if (S0) dt *= S0.of;
  const t = ws.time ?? world.t, out = [], CELL = ws.cell || 40, CAP = 12;
  const grid = ws.nearby ? null : buildGrid(world.minds, CELL);
  const rng = world.rng, hasGods = !!(world.gods && world.gods.length);
  for (let i = i0; i < world.minds.length; i += di) {
    const m = world.minds[i];
    if (!m.alive) continue;
    const n = m.needs, T = m.traits;
    const food = ws.food ? ws.food(m) : 0.5, danger = ws.danger ? ws.danger(m) : 0, shelter = ws.shelter ? ws.shelter(m) : 0.5;
    // needs drift
    n.hunger = clamp(n.hunger + dt * (0.18 - food * 0.1));
    n.rest = clamp(n.rest + dt * 0.1);
    n.safety = clamp(n.safety + dt * (danger * 0.5 - 0.15 * shelter));
    n.belonging = clamp(n.belonging + dt * 0.04);
    n.meaning = clamp(n.meaning + dt * 0.03 * (0.5 + T.ambition));
    // memory decay (half-life ~ 20 days, strong memories slower)
    for (let j = m.memories.length - 1; j >= 0; j--) {
      const me = m.memories[j]; me.weight *= Math.exp(-dt / (12 + 30 * Math.abs(me.weight)));
      if (Math.abs(me.weight) < 0.05) m.memories.splice(j, 1);
    }
    m.fearOfGod = clamp(m.fearOfGod - dt * 0.01);
    if (m.wrath) m.wrath = clamp(m.wrath - dt * 0.02);
    if (!m.devotion) m.devotion = {};
    // offering outcome: coincidence decides whether the idol "worked"
    if (m.offering) {
      const o = m.offering;
      if (n[o.need] < 0.3) { addDev(m, o.god, TUNING.offerReward); remember(m, 'favored by ' + o.god, 0.6, t); m.offering = null; }
      else if (t - o.t > 3) { addDev(m, o.god, -0.05 * (1 - 0.5 * T.stubbornness)); faithChange(m, 0.01, t); remember(m, 'idol failed', -0.4, t); m.offering = null; }
    }
    // unanswered prayer -> silence
    if (m.prayer && t - m.prayer.t > 3) {
      m.silence += 1; remember(m, 'unanswered prayer', -0.4, t);
      faithChange(m, -0.04 * (1 - 0.5 * T.piety), t); m.prayer = null;
    }
    // need relieved "naturally" after praying counts weakly as answered
    if (m.prayer && n[m.prayer.need] < 0.3) { faithChange(m, 0.03, t); remember(m, 'prayer answered', 0.5, t); m.grace = clamp((m.grace || 0) + TUNING.graceNatural, 0, 3); m.prayer = null; m.lastAnswered = t; }
    const urgency = (n.hunger + n.safety + n.rest + n.belonging + n.meaning) / 5;
    m.mood = clamp(m.mood + dt * ((0.6 - urgency) * 0.2));
    m.cooldown -= dt;
    if (m.cooldown > 0) continue;
    m.cooldown = 0.5 + rng();

    const nb = ws.nearby ? ws.nearby(m, CELL) : gridNearby(grid, CELL, m, CAP);
    let bestMate = null, bestMateS = 0.15, foe = null, foeS = 0.35, friendS = 0;
    let socTrue = 0, socW = 0, socG = null, socGV = 0; const soc = hasGods ? _soc : null; if (soc) soc.clear();
    for (let j = 0, L = Math.min(nb.length, CAP); j < L; j++) {
      const o = nb[j]; if (!o.alive) continue;
      const r = m.relations[o.id];
      if (r) {
        r.love *= 0.995; r.friend *= 0.998; r.grudge *= 0.99; r.rival *= 0.995;
        friendS += r.friend + r.love;
        const fs = r.grudge + r.rival * 0.5 + (m.enemyGroup != null && o.group === m.enemyGroup ? 0.4 : 0);
        if (fs > foeS) { foeS = fs; foe = o; }
      } else if (m.enemyGroup != null && o.group === m.enemyGroup && 0.4 > foeS) { foeS = 0.4; foe = o; }
      if (o.sex !== m.sex && !m.spouse && !o.spouse && m.age > 16 && o.age > 16 && Math.abs(m.age - o.age) < 15) {
        const s = (r ? r.love : 0) + 0.2 * (1 - Math.abs(T.kindness - o.traits.kindness)) + rng() * 0.1;
        if (s > bestMateS) { bestMateS = s; bestMate = o; }
      }
      if (soc) {
        const al = o.allegiance; if (al === undefined || al === null) { socW += 0.3; continue; }
        let wt = 0.3 + (r ? r.friend + r.love : 0) + (o.id === m.spouse ? 3 : 0) + (o.priest || o.action === 'preach' ? 3 : 0);
        socW += wt;
        if (al === 'true') socTrue += wt * o.faith;
        else { const v = (soc.get(al) || 0) + wt * (o.devotion?.[al] || 0.4); soc.set(al, v); if (v > socGV) { socGV = v; socG = al; } }
      }
    }
    if (soc) {
      // ---- conversion dynamics (rival gods never act: everything below is perception) ----
      const P = TUNING, sT = socW ? socTrue / socW : 0, sG = Math.min(P.socialCap, socW ? socGV / socW : 0);
      let cand = socG, cv = socGV ? 0.001 : -1; for (const k in m.devotion) if (m.devotion[k] + (k === socG ? sG : 0) > cv) { cv = m.devotion[k] + (k === socG ? sG : 0); cand = k; }
      if (cand == null && (m.silence > 1 || m.wrath > 0.2 || n.hunger > 0.7 || n.safety > 0.7) && rng() < 0.05) cand = world.gods[(rng() * world.gods.length) | 0].id;
      const fearDir = (1 - T.courage) * 0.5 + T.piety * 0.4 + (1 - T.stubbornness) * 0.3 - 0.6;  // >0 fear -> submission
      const silenceF = Math.min(1.5, m.silence / TUNING.silenceRamp), distress = Math.max(n.hunger, n.safety);
      const answered = m.lastAnswered > 0 && t - m.lastAnswered < P.answeredDays ? 1 : 0;
      // personal resolve: an emergent, individual choice to keep faith through silence (never guaranteed)
      if (m.grace) m.grace = Math.max(0, m.grace - P.graceDecay);
      let tragedy = 0; for (const me of m.memories) if (me.weight < -0.5 && (me.type === 'grief' || me.type === 'attacked' || me.type === 'prayer met with wrath' || EVENTS[me.type]?.cruel)) tragedy -= me.weight;
      const kin = m.spouse != null ? (world.byId.get(m.spouse)?.allegiance === 'true' ? 1 : 0) : 0;
      const resolve = (m.grace > P.graceMin ? T.piety * T.stubbornness * P.resolveTraits + Math.min(1, m.grace) * P.resolveGrace + kin * P.resolveKin
        + ((((m.seed * 2654435761) >>> 0) % 1000) / 1000 - 0.5) * P.resolveNoise : 0) - tragedy * P.resolveTragedy - (m.wrath || 0) * P.resolveWrath;
      m.hold = m.allegiance === 'true' && resolve > P.resolveThreshold ? clamp((resolve - P.resolveThreshold) * 4) : 0;
      const shield = 1 - m.hold * P.holdShield;
      const push = (P.drift * (silenceF * shield + (m.wrath || 0) + distress * distress * 0.8 * shield) + (fearDir < 0 ? -fearDir * m.fearOfGod * P.fearDrift : 0)) * (1 - 0.5 * T.piety) * (1 - 0.8 * answered);
      const pull = P.socialTrue * sT + (fearDir > 0 ? fearDir * m.fearOfGod * P.fearPull : 0) + P.answeredPull * answered;
      const toRival = push + P.social * sG * shield;
      if (cand) addDev(m, cand, toRival - pull * 0.5 - P.devotionDecay);
      for (const k in m.devotion) if (k !== cand) addDev(m, k, -P.devotionDecay * 1.5);
      faithChange(m, pull * 0.6 - toRival * P.faithErosion, t);
      updateAllegiance(m, world, t);
    }
    const lonely = nb.length < 2;
    // utilities
    const noise = () => (rng() - 0.5) * (0.15 + 0.2 * T.curiosity);
    const hungerU = n.hunger * n.hunger * 2;
    U[0] = 0.25 + T.diligence * 0.3 + n.meaning * 0.2 + hungerU * 0.3;                 // work
    U[1] = hungerU * (0.6 + food * 0.6) + T.diligence * 0.1;                             // farm
    U[2] = shelter < 0.4 ? 0.3 + T.ambition * 0.3 + n.safety * 0.3 : 0.1 + T.ambition * 0.15; // build
    U[3] = 0.1 + T.curiosity * 0.4 + (lonely ? 0.2 : 0);                                  // wander
    U[4] = bestMate ? n.belonging * 0.6 + T.sociability * 0.3 + bestMateS * 0.5 : 0;      // court
    U[5] = bestMate && m.relations[bestMate.id]?.love > 0.6 ? 0.9 + n.belonging : 0;      // marry
    U[6] = foe ? foeS * 0.6 + T.temper * 0.3 - T.kindness * 0.2 : 0;                      // feud
    U[7] = foe ? (foeS - 0.4) * (T.courage + T.temper) - n.safety * 0.3 + (m.goal === 'revenge' ? 0.4 : 0) : 0; // fight
    U[8] = n.safety * n.safety * (1.6 - T.courage) + danger;                              // flee
    U[9] = (m.faithState === 'apostate' ? 0.02 : m.faith * (0.25 + urgency * 1.2) * (0.5 + T.piety)) - (m.prayer ? 0.5 : 0); // pray
    U[10] = (n.hunger > 0.7 && food < 0.3 ? 0.6 : 0) + (n.safety > 0.7 ? 0.4 : 0) + T.curiosity * 0.1 + (m.mood < 0.2 ? 0.2 : 0); // migrate
    U[11] = nb.length > 10 && T.ambition > 0.7 && m.age > 20 ? T.ambition * 0.6 + n.meaning * 0.3 : 0; // found
    U[12] = n.rest * n.rest * 1.5;                                                         // rest
    U[13] = n.belonging * 0.5 * T.sociability + (lonely ? 0 : 0.1);                        // socialize
    const rival = hasGods && m.allegiance && m.allegiance !== 'true' ? m.allegiance : null, rdv = rival ? m.devotion[rival] || 0 : 0;
    if (rival) U[9] *= 0.3;
    U[14] = rival && !m.offering ? rdv * (0.25 + urgency * 1.2) * (0.5 + T.piety) : 0;      // offer
    const zeal = m.allegiance === 'true' ? m.faith : rdv;
    U[15] = hasGods && zeal > 0.6 && nb.length >= 3 ? (zeal - 0.3) * T.sociability * (T.piety + T.ambition) * 1.3 + (m.priest ? 0.15 : 0) : 0; // preach
    let best = 0, bv = -1e9;
    for (let a = 0; a < U.length; a++) { const v = U[a] + noise(); if (v > bv) { bv = v; best = a; } }
    const act = ACTIONS[best]; let target = null;
    // consequences
    switch (act) {
      case 'work': n.meaning = clamp(n.meaning - 0.1); n.hunger = clamp(n.hunger - 0.1 * food); n.rest = clamp(n.rest + 0.05); break;
      case 'farm': n.hunger = clamp(n.hunger - 0.35 * (0.3 + food)); n.rest = clamp(n.rest + 0.08); break;
      case 'build': n.safety = clamp(n.safety - 0.15); n.meaning = clamp(n.meaning - 0.1); break;
      case 'wander': n.meaning = clamp(n.meaning - 0.05 * T.curiosity); break;
      case 'rest': n.rest = clamp(n.rest - 0.5); break;
      case 'socialize': case 'court': {
        const o = act === 'court' ? bestMate : nb[(rng() * Math.min(nb.length, CAP)) | 0];
        if (o) {
          target = o.id; const r = rel(m, o.id), r2 = rel(o, m.id);
          if (act === 'court') { r.love = clamp(r.love + 0.15); r2.love = clamp(r2.love + 0.1 * o.traits.sociability + 0.05); }
          r.friend = clamp(r.friend + 0.08); r2.friend = clamp(r2.friend + 0.05);
          if (o.traits.ambition > 0.7 && T.ambition > 0.7 && rng() < 0.1) { r.rival = clamp(r.rival + 0.2); }
          n.belonging = clamp(n.belonging - 0.2);
        }
        break;
      }
      case 'marry': {
        const o = bestMate; target = o.id; m.spouse = o.id; o.spouse = m.id;
        rel(m, o.id).love = 1; rel(o, m.id).love = clamp(rel(o, m.id).love + 0.5);
        remember(m, 'married', 1, t, o.id); remember(o, 'married', 1, t, m.id);
        n.belonging = 0; n.meaning = clamp(n.meaning - 0.3); break;
      }
      case 'feud': { target = foe.id; const r = rel(foe, m.id); r.grudge = clamp(r.grudge + 0.15); rel(m, foe.id).grudge += 0.02; break; }
      case 'fight': {
        target = foe.id; const r = rel(foe, m.id); r.grudge = clamp(r.grudge + 0.4);
        n.safety = clamp(n.safety + 0.2); remember(foe, 'attacked', -0.7, t, m.id);
        const g = rel(m, foe.id); g.grudge = clamp(g.grudge * 0.6); if (m.goal === 'revenge' && rng() < 0.3) m.goal = 'peace';
        break;
      }
      case 'flee': n.safety = clamp(n.safety - 0.1); break;
      case 'pray': {
        let need = 'meaning', v = -1; for (const k in n) if (n[k] > v) { v = n[k]; need = k; }
        m.prayer = { need, t }; n.meaning = clamp(n.meaning - 0.1 * m.faith); break;
      }
      case 'offer': {
        let need = 'meaning', v = -1; for (const k in n) if (n[k] > v) { v = n[k]; need = k; }
        m.offering = { god: rival, need, t }; n.meaning = clamp(n.meaning - 0.1 * rdv); n.hunger = clamp(n.hunger + 0.03); target = rival; break;
      }
      case 'preach': {
        const god = m.allegiance; target = god; m.preached++; if (m.preached >= 3) m.priest = true; n.meaning = clamp(n.meaning - 0.15);
        for (let j = 0, L = Math.min(nb.length, 4); j < L; j++) {
          const o = nb[(rng() * Math.min(nb.length, CAP)) | 0]; if (!o || !o.alive || o === m) continue;
          const sway = TUNING.preachSway * (1 - o.traits.stubbornness) * (0.5 + zeal);
          if (o.allegiance === god) { if (god === 'true') faithChange(o, sway * 0.5, t); else addDev(o, god, sway * 0.5); continue; }
          if (god === 'true') faithChange(o, sway, t); else { addDev(o, god, sway); if (!o.devotion) o.devotion = {}; }
          if (o.allegiance && o.allegiance !== god && o.allegiance !== 'true') addDev(o, o.allegiance, -sway * 0.5);
          if (o.allegiance === 'true' && god !== 'true') faithChange(o, -sway * 0.3, t);
          updateAllegiance(o, world, t);
        }
        break;
      }
      case 'migrate': n.safety = clamp(n.safety - 0.1); m.home = null; remember(m, 'left home', 0.4, t); break;
      case 'found': m.home = { x: m.x, y: m.y }; m.group = world.nextGroup = (world.nextGroup || 100) + 1; n.meaning = 0; remember(m, 'founded a settlement', 1, t); break;
    }
    m.action = act; m.target = target;
    if (m.faithLog.length === 0 || t - (m._flt || 0) >= 1) { m.faithLog.push(+m.faith.toFixed(3)); m._flt = t; if (m.faithLog.length > 120) m.faithLog.shift(); }
    out.push({ id: m.id, action: act, target, x: m.x, y: m.y });
  }
  if (hasGods) countFollowers(world);
  return out;
}

// ---------- respond to god's commands ----------
const CMD = [
  [/\b(kill|murder|slay|attack|burn)\b/, 'violence'], [/\b(pray|worship|kneel|praise)\b/, 'worship'],
  [/\b(build|temple|house|wall)\b/, 'build'], [/\b(farm|plant|sow|harvest|work)\b/, 'work'],
  [/\b(leave|go|migrate|move|journey)\b/, 'migrate'], [/\b(love|marry|forgive|peace|share|help)\b/, 'kind'],
  [/\b(sacrifice|give up|offer)\b/, 'sacrifice'], [/\b(war|fight)\b/, 'violence'], [/\b(rest|sleep)\b/, 'rest'],
];
export function respond(mind, text = '', world) {
  respond.world = world || respond.world || null;
  const m = mind, T = m.traits, s = String(text).toLowerCase();
  let kind = 'other'; for (const [re, k] of CMD) if (re.test(s)) { kind = k; break; }
  const r = mulberry32((m.seed ^ (s.length * 2654435761) ^ ((m.faith * 1e4) | 0)) >>> 0);
  let p = m.faith * 0.75 + m.fearOfGod * 0.25 + (1 - T.stubbornness) * 0.15 - 0.2;
  if (kind === 'violence') p += (T.temper - T.kindness) * 0.6 - 0.1;
  if (kind === 'kind') p += T.kindness * 0.3;
  if (kind === 'worship') p += T.piety * 0.3;
  if (kind === 'work') p += T.diligence * 0.2;
  if (kind === 'migrate') p += T.curiosity * 0.3 - (m.spouse ? 0.2 : 0);
  if (kind === 'sacrifice') p += T.piety * 0.4 - 0.3;
  if (kind === 'rest') p += m.needs.rest * 0.4;
  if (m.faithState === 'apostate') p -= 0.4;
  const rv = m.allegiance && m.allegiance !== 'true' ? m.allegiance : null;
  const rvName = rv ? (respond.world && godById(respond.world, rv)?.name) || m._godName?.[rv] || 'another' : null;
  if (rv) p -= (m.devotion?.[rv] || 0) * 0.45 + (kind === 'worship' ? 0.25 : 0);
  if (rv && m.fearOfGod > 0.5) p += (1 - T.courage) * 0.25;   // the meek obey out of fear, not belief
  const obey = r() < clamp(p, 0.02, 0.98);
  const pick = (a) => a[(r() * a.length) | 0];
  let reply;
  if (obey) {
    reply = rv ? (m.fearOfGod > 0.5 ? pick([`I will... but ${rvName} protects me, not you.`, 'Do not strike me — I will do it.'])
        : pick([`Very well, though I keep faith with ${rvName}.`, `I will do it. ${rvName} would not mind.`]))
      : m.faithState === 'devout' ? pick(['Your will be done.', 'I hear and obey, Holy One.', 'At once — I am yours.'])
      : m.fearOfGod > 0.5 ? pick(['Y-yes... please, no more storms.', 'I will. Do not strike me.'])
      : pick(['Alright. If it is truly you.', 'Fine, I will do it.', 'As you say.']);
    remember(m, 'obeyed the god', 0.5, 0, null, text); faithChange(m, 0.02, 0);
  } else {
    if (rv) reply = pick([`Our god is ${rvName}; why should I heed you?`, `${rvName} feeds us. Who are you?`, `I have made my offerings to ${rvName}. Leave me be.`]);
    else if (m.faithState === 'apostate') reply = pick(['Voices in the sky do not command me.', 'You were silent when I begged. Now I am silent.', 'There is no god — only wind.']);
    else if (kind === 'violence' && T.kindness > 0.55) reply = pick(['I will not shed blood, not even for you.', 'If this is godhood, I want none of it.']);
    else if (kind === 'migrate' && m.spouse) reply = 'I cannot leave my family.';
    else if (m.faithState === 'doubter') reply = pick(['Why should I? Where were you when we starved?', 'Prove yourself first.', 'Perhaps. Perhaps not.']);
    else reply = pick(['Forgive me, I cannot.', 'Not now — my own needs press on me.', 'I... I do not think that is right.']);
    remember(m, 'refused the god', -0.4, 0, null, text);
  }
  return { obey, reply, kind };
}

// ---------- describe ----------
const ING = { work: 'working', farm: 'farming', build: 'building', wander: 'wandering', court: 'courting someone', marry: 'getting married', feud: 'feuding', fight: 'fighting', flee: 'fleeing', pray: 'praying', migrate: 'migrating', found: 'founding a settlement', rest: 'resting', socialize: 'chatting with neighbours' };
export function describe(m, world) {
  const T = m.traits, top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map((e) => e[0]);
  const nm = (id) => (world && world.byId.get(+id)?.name) || `#${id}`;
  const urgent = top(m.needs, 1)[0];
  const ADJ = { piety: 'pious', courage: 'brave', sociability: 'sociable', ambition: 'ambitious', kindness: 'kind', stubbornness: 'stubborn', curiosity: 'curious', temper: 'hot-tempered', diligence: 'diligent' };
  const tr = top(T, 2).map((k) => ADJ[k]).join(' and ');
  let s = `${m.name}, ${m.age}, is ${tr}. ${m.sex === 'f' ? 'She' : 'He'} wants ${m.goal} and fears ${m.fear}. `;
  s += `Right now ${m.sex === 'f' ? 'she' : 'he'} is ${ING[m.action] || m.action} and most needs ${urgent}. `;
  s += `Faith: ${m.faithState} (${(m.faith * 100) | 0}%)${m.silence > 2 ? ', wounded by the god\'s silence' : ''}${m.fearOfGod > 0.5 ? ', afraid of divine wrath' : ''}. `;
  if (m.allegiance !== undefined) {
    const an = allegianceName(m, world), g = m.allegiance && m.allegiance !== 'true' ? godById(world, m.allegiance) : null;
    s += m.allegiance === 'true' ? 'Keeps faith with the true god' + (m.priest ? ' and preaches it' : '') + '. '
      : g ? `Worships ${an}${g ? `, ${g.kind} of ${g.domain}` : ''}${m.priest ? ', as a priest' : ''}. ` : m.allegiance ? `Worships ${an}. ` : 'Follows no god. ';
  }
  if (m.spouse != null) s += `Married to ${nm(m.spouse)}. `;
  let g = null, gv = 0.3; for (const k in m.relations) if (m.relations[k].grudge > gv) { gv = m.relations[k].grudge; g = k; }
  if (g) s += `Holds a grudge against ${nm(g)}. `;
  const mem = m.memories.slice().sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 3);
  if (mem.length) s += 'Remembers: ' + mem.map((x) => x.type + (x.about != null ? ` (${nm(x.about)})` : '')).join('; ') + '.';
  return s;
}

// ---------- aggregates ----------
export function aggregates(world) {
  const out = { population: 0, morale: 0, faith: 0, devout: 0, believers: 0, doubters: 0, apostates: 0, byGroup: {}, followers: { true: 0, none: 0 }, byGod: {} };
  for (const g of world.gods || []) out.followers[g.id] = 0;
  for (const m of world.minds) {
    if (!m.alive) continue;
    out.population++; out.morale += m.mood; out.faith += m.faith;
    if (m.faithState === 'devout') out.devout++; else if (m.faithState === 'believer') out.believers++;
    else if (m.faithState === 'doubter') out.doubters++; else out.apostates++;
    const g = out.byGroup[m.group] || (out.byGroup[m.group] = { population: 0, morale: 0, faith: 0 });
    g.population++; g.morale += m.mood; g.faith += m.faith;
    const al = m.allegiance === undefined ? (m.faith > 0.25 ? 'true' : null) : m.allegiance;
    const key = al == null ? 'none' : al; out.followers[key] = (out.followers[key] || 0) + 1;
  }
  for (const g of world.gods || []) out.byGod[g.id] = { name: g.name, kind: g.kind, domain: g.domain, color: g.color, followers: out.followers[g.id] || 0 };
  const p = out.population || 1; out.morale /= p; out.faith /= p;
  for (const k in out.byGroup) { const g = out.byGroup[k]; g.morale /= g.population; g.faith /= g.population; }
  return out;
}

// ---------- persistence ----------
export function serialize(world) {
  return JSON.stringify({ v: 2, gods: world.gods || [], nextGodId: world.nextGodId || 1, seed: world.seed, t: world.t, nextId: world.nextId, nextGroup: world.nextGroup,
    width: world.width, height: world.height, rngState: (world.rng() * 4294967296) >>> 0, minds: world.minds });
}
export function deserialize(str) {
  const d = typeof str === 'string' ? JSON.parse(str) : str;
  const w = { seed: d.seed, t: d.t, nextId: d.nextId, nextGroup: d.nextGroup, width: d.width, height: d.height,
    rng: mulberry32(d.rngState), minds: [], byId: new Map(), gods: d.gods || [], nextGodId: d.nextGodId || 1,
    godRng: mulberry32(((d.seed ^ 0x5bd1e995) + (d.nextGodId || 1) * 7919) >>> 0) };
  for (const m of d.minds) { w.minds.push(m); w.byId.set(m.id, m); }
  return w;
}
