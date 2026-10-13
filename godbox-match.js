// GODBOX match — the god's hand in the heart: weddings, partings, a child, a peace between enemies, a spark of love.
// Pure ES module (state = {world, civ, soul}); deterministic (hash-seeded, no Math.random).
// People keep their free will. Each one weighs how they feel about the other (love, friendship, old grudges), whether they
// heed the god at all, whether their heart is elsewhere or still in mourning, and the years between them. They answer in
// three ways — eager, consenting (they obey, their heart not in it) or refusing — and say so in their own words.
// The god may read every heart first (propose), and may decree a match anyway (wed with force) — at a price.
//
// API
//   status(state, id)                         -> {kind:'single'|'married'|'widowed'|'parted'|'child'|'dead', spouse?, since?}
//   propose(state, a, b)                      -> {blocked?, a:{tier,why,reply,...}, b:{...}, outcome, refusers[]}  (reads hearts; changes nothing)
//   wed(state, a, b, {force})                 -> {ok, how, refused?, replies, message, ripple}
//   part(state, id)                           -> {ok, message, ...}   release a couple from their vows
//   giveChild(state, id)                      -> {ok, child, message} a child, the god's gift to a married couple
//   reconcile(state, a, b)                    -> {ok, replies, message}  ask two enemies to make peace (they may refuse)
//   kindle(state, a, b)                       -> {ok, message}  a stirring of love (it never forces a marriage)
//   candidates(state, id, {n, sameSex})       -> suggested matches with both hearts read
//   guests(state, a, b, {reach, max})         -> ids of the couple's children, then the kin and friends closest to them (max 14)
//   TIERS
import * as M from './godbox-minds.js';
import * as V from './godbox-civ.js';

export const MIN_AGE = 16;
export const TIERS = { eager: 'eager', consent: 'reluctant', refuse: 'refuses' };
const ZERO = { love: 0, friend: 0, grudge: 0, rival: 0 };
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const first = (s) => String(s || '').split(' ')[0];
const hash = (...xs) => { let h = 2166136261; for (const x of xs) { const s = String(x); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } } return h >>> 0; };
const pick = (arr, ...k) => arr[hash(...k) % arr.length];
const mindOf = (st, id) => st.world?.byId?.get(id) || null;
const personOf = (st, id) => st.civ?.people?.[id] || null;
const rel = (m, id) => m.relations[id] || ZERO;
const pr = (m) => (m?.sex === 'f' ? { s: 'she', o: 'her', p: 'her' } : { s: 'he', o: 'him', p: 'his' });
function nameOf(st, id) { const p = personOf(st, id), m = mindOf(st, id), f = p && st.civ.families?.[p.fam]?.name; return `${m?.name || p?.name || '#' + id}${f ? ' ' + f : ''}`; }
const day = (st) => Math.floor((st.world?.t || 0) / 90); // moods and words hold for a season

// ---------- status ----------
export function status(state, id) {
  const m = mindOf(state, id), p = personOf(state, id);
  if (!m || !m.alive || (p && p.died != null)) return { kind: 'dead' };
  if (m.age < MIN_AGE) return { kind: 'child' };
  if (m.spouse != null) { const e = (p?.mar || []).slice().reverse().find((x) => x.to === m.spouse && x.end == null); return { kind: 'married', spouse: m.spouse, since: e ? e.y : p?.wed ?? null, how: e?.how || null }; }
  const last = p?.mar?.[p.mar.length - 1];
  if (last && last.end != null) return { kind: last.endHow === 'widowed' ? 'widowed' : 'parted', spouse: last.to, since: last.end };
  return { kind: 'single' };
}
// why two people cannot be wed (null if they can)
function blocked(state, a, b) {
  const x = mindOf(state, a), y = mindOf(state, b);
  if (!state.civ) return 'Weddings need the civilization layer.';
  if (!x || !y) return 'No such person.';
  if (a === b) return 'No one can be wed to themselves.';
  for (const m of [x, y]) {
    if (!m.alive) return `${first(m.name)} is dead.`;
    if (m.age < MIN_AGE) return `${first(m.name)} is still a child.`;
    if (m.spouse != null) return `${first(m.name)} is already married to ${first(nameOf(state, m.spouse))} — part them first.`;
  }
  const kin = V.related(state.civ, state.world, a, b);
  if (kin) return `${first(x.name)} and ${first(y.name)} are of one blood.`;
  return null;
}

// ---------- hearts ----------
// do they heed the god?
function heed(m) {
  const T = m.traits;
  return (m.allegiance === 'true' ? m.faith : m.faith * 0.35) * (0.45 + T.piety * 0.4) + (m.fearOfGod || 0) * 0.35 - T.stubbornness * 0.45 - (m.wrath || 0) * 0.6;
}
function mourning(state, m) {
  const p = personOf(state, m.id), last = p?.mar?.[p.mar.length - 1];
  return !!(last && last.endHow === 'widowed' && state.civ.year - last.end < 2);
}
// How person m stands toward being wed to o: score, tier and the reasons, in plain words
function stance(state, m, o) {
  const T = m.traits, r = rel(m, o.id), P = pr(o), why = [];
  const heart = r.love * 0.9 + r.friend * 0.4 - r.grudge - r.rival * 0.3;
  let other = 0, otherId = null;
  for (const k in m.relations) {
    const q = m.relations[k]; if (+k === o.id || q.kin) continue;
    const t = mindOf(state, +k); if (!t || !t.alive) continue;
    if (q.love > other) { other = q.love; otherId = +k; }
  }
  other = Math.max(0, other - 0.4);
  const h = heed(m), gap = Math.abs(m.age - o.age), mourn = mourning(state, m);
  const ageFit = gap <= 8 ? 0.08 : gap <= 15 ? -0.05 : gap <= 25 ? -0.3 : -0.6;
  const noise = ((hash(m.seed, o.id, day(state)) % 1000) / 1000 - 0.5) * 0.2;
  const open = clamp((m.needs.belonging - 0.4) * 0.35 + (m.goal === 'family' ? 0.1 : 0), -0.1, 0.3); // the lonely and the family-minded are more open to a match
  const score = heart * 1.1 + h * 0.85 + ageFit + open - other * 0.9 - (mourn ? 0.3 : 0) + noise;
  const tier = score > 0.42 ? 'eager' : score > 0 ? 'consent' : 'refuse';
  if (r.love > 0.45) why.push(`loves ${P.o}`); else if (r.friend > 0.4) why.push(`fond of ${P.o}`); else if (heart > -0.05 && heart < 0.12) why.push(`hardly knows ${P.o}`);
  if (r.grudge > 0.3) why.push(`cannot forgive ${P.o}`);
  if (other > 0.1) why.push(`heart is with ${first(nameOf(state, otherId))}`);
  if (mourn) why.push('still mourning');
  if (h > 0.3) why.push('heeds you'); else if (h < 0) why.push('defiant');
  if (ageFit < -0.2) why.push(`${gap} years between them`);
  return { id: m.id, name: nameOf(state, m.id), tier, score: Math.round(score * 100) / 100, why, heart, heed: h, love: r.love, other: otherId, mourning: mourn, gap, age: m.age };
}
// their own words
function lineFor(state, m, o, st) {
  const P = pr(o), rn = first(o.name), k = [m.seed, o.id, day(state)];
  if (st.tier === 'eager') {
    if (st.love > 0.45) return pick([`Yes! I have hoped for this since ${rn}'s name first made me smile.`, `You have heard my heart. Yes.`, `${rn}... yes. Yes, a thousand times.`, `I would have asked ${P.o} myself, if I dared.`], ...k);
    if (rel(m, o.id).friend > 0.4) return pick([`${rn} is the kindest soul I know. Yes.`, `I never dared hope for it. Yes.`, `A friend first, and now more. Yes.`], ...k);
    return pick([`If you ask it, I will — gladly.`, `Your will is a gift. Yes.`], ...k);
  }
  if (st.tier === 'consent') {
    if (m.faithState === 'devout') return pick(['Your will be done.', `I hear and obey, Holy One. ${rn} it is.`], ...k);
    if (rel(m, o.id).friend > 0.3) return pick([`${rn} is a good friend. Perhaps that is enough to begin.`, `I could do worse than ${rn}. I will.`], ...k);
    return pick([`If it is your will, I will do it.`, `I hardly know ${P.o} — but I trust you.`, `The god asks; I obey. Love may come after.`, `You have never led us wrong. I will wed ${rn}.`], ...k);
  }
  if (st.other != null && st.why.some((w) => w.startsWith('heart'))) return `My heart belongs to ${first(nameOf(state, st.other))}. Do not ask this of me.`;
  if (st.why.includes(`cannot forgive ${P.o}`)) return pick([`Never. Not while I remember what ${P.s} did.`, `${rn}? After everything? No.`], ...k);
  if (st.mourning) return `I buried my love so lately. Do not ask me yet.`;
  if (st.why.includes('defiant')) return pick(['I answer to no voice in the sky.', 'My life is mine to give.', 'Let the god strike me down; I will not.', 'You were silent when I begged. I owe you no obedience.'], ...k);
  if (st.gap > 15) return `${rn} and I are of different ages entirely. No.`;
  return pick([`No. I do not know ${P.o}; I will not wed a stranger.`, 'Forgive me, I cannot.', `I do not love ${P.o}. I cannot.`], ...k);
}

// ---------- propose (reads the heart; changes nothing) ----------
export function propose(state, aId, bId) {
  const why = blocked(state, aId, bId);
  if (why) return { blocked: why, outcome: 'blocked', refusers: [] };
  const x = mindOf(state, aId), y = mindOf(state, bId), a = stance(state, x, y), b = stance(state, y, x);
  a.reply = lineFor(state, x, y, a); b.reply = lineFor(state, y, x, b);
  const refusers = [a, b].filter((s) => s.tier === 'refuse').map((s) => s.id);
  const outcome = refusers.length ? 'refused' : a.tier === 'eager' && b.tier === 'eager' ? 'love' : a.tier === 'eager' || b.tier === 'eager' ? 'glad' : 'arranged';
  return { blocked: null, a, b, outcome, refusers };
}

// ---------- wed ----------
export function wed(state, aId, bId, opts = {}) {
  const pp = propose(state, aId, bId);
  if (pp.blocked) return { ok: false, message: pp.blocked, ...pp };
  const { civ, world } = state, x = mindOf(state, aId), y = mindOf(state, bId), T = world.t;
  const forced = pp.refusers.length > 0;
  if (forced && !opts.force) { // they were asked, and said no
    for (const s of [pp.a, pp.b]) {
      const m = s.id === aId ? x : y, o = m === x ? y : x;
      if (s.tier === 'refuse') {
        M.remember(m, "refused the god's match", -0.3, T, o.id, s.reply);
        if (s.why.includes('defiant')) m.wrath = clamp((m.wrath || 0) + 0.08);
      } else M.remember(m, 'was refused', -0.3, T, o.id);
    }
    return { ok: false, refused: pp.refusers.map((id) => ({ id, name: nameOf(state, id), reply: id === aId ? pp.a.reply : pp.b.reply })), message: `${pp.refusers.map((id) => first(nameOf(state, id))).join(' and ')} would not be wed.`, ...pp };
  }
  const g0 = [rel(x, y.id).grudge, rel(y, x.id).grudge];
  const how = forced ? 'decree' : pp.outcome === 'love' ? 'love' : 'god';
  const sides = [[pp.a, x, y], [pp.b, y, x]];
  const love = sides.map(([s]) => (s.tier === 'eager' ? 0.8 : s.tier === 'consent' ? 0.3 : 0.05));
  const mem = sides.map(([s, m, o], i) => s.tier === 'refuse' ? { type: 'wed against my will', weight: -0.8, text: 'the god gave me away' }
    : s.tier === 'eager' ? { type: 'married', weight: 1, text: null }
    : { type: 'married', weight: forced ? 0.3 : 0.6, text: forced ? "the god's decree" : 'a match the god made' });
  V.marry(civ, world, aId, bId, { how, love, mem });
  sides.forEach(([s, m, o], i) => {
    const r = m.relations[o.id];
    if (s.tier === 'refuse') { r.grudge = Math.max(r.grudge, g0[i]); m.mood = clamp(m.mood - 0.25); m.wrath = clamp((m.wrath || 0) + 0.3); m.faith = clamp(m.faith - 0.05 * (0.5 + m.traits.stubbornness)); }
    else if (s.tier === 'eager') { m.mood = clamp(m.mood + 0.3); m.goal = 'family'; if (m.allegiance === 'true') m.faith = clamp(m.faith + 0.05); else m.faith = clamp(m.faith + 0.02); }
    else { m.mood = clamp(m.mood + 0.05); m.faith = clamp(m.faith + 0.01); }
  });
  const ripple = ripples(state, x, y);
  const A = first(x.name), B = first(y.name);
  return { ok: true, how, forced, message: forced ? `${A} and ${B} are wed by your decree. ${pp.refusers.map((id) => first(nameOf(state, id))).join(' and ')} did not want it.`
    : how === 'love' ? `${A} and ${B} are wed — a love match.` : `${A} and ${B} are wed by your word.`, replies: { [aId]: pp.a.reply, [bId]: pp.b.reply }, ripple, ...pp };
}
// those who loved one of the couple and hoped feel it
function ripples(state, x, y) {
  const out = [];
  for (const m of state.world.minds) {
    if (!m.alive || m.id === x.id || m.id === y.id || m.spouse != null || m.age < MIN_AGE) continue;
    for (const [a, b] of [[x, y], [y, x]]) {
      const r = m.relations[a.id]; if (!r || r.love <= 0.5 || r.kin) continue;
      M.remember(m, `lost ${first(a.name)} to ${first(b.name)}`, -0.5, state.world.t, a.id);
      m.mood = clamp(m.mood - 0.12);
      const g = m.relations[b.id] || (m.relations[b.id] = { ...ZERO }); g.rival = clamp(g.rival + 0.25); g.grudge = clamp(g.grudge + 0.1);
      out.push(m.id); break;
    }
  }
  return out;
}
// kin and friends of the couple (and their children) within reach: who would come to the wedding
export function guests(state, aId, bId, { reach = 30, max = 14 } = {}) {
  const x = mindOf(state, aId), y = mindOf(state, bId); if (!x || !y) return [];
  const pa = personOf(state, aId), pb = personOf(state, bId), kids = [...(pa?.kids || []), ...(pb?.kids || [])].filter((id) => { const m = mindOf(state, id); return m && m.alive; });
  const near = [];
  for (const m of state.world.minds) {
    if (!m.alive || m.id === aId || m.id === bId || m.age < 5 || kids.includes(m.id)) continue;
    if (Math.hypot(m.x - x.x, m.y - x.y) > reach) continue;
    let v = 0; for (const r of [m.relations[aId], m.relations[bId]]) if (r) v = Math.max(v, (r.kin ? 1 : 0) + r.friend + r.love);
    if (v > 0.45) near.push([v, m.id]);
  }
  near.sort((p, q) => q[0] - p[0]);
  return [...kids, ...near.map((e) => e[1])].slice(0, max);
}

// ---------- part ----------
export function part(state, id) {
  const m = mindOf(state, id); if (!m || !state.civ) return { ok: false, message: 'No such person.' };
  if (m.spouse == null) return { ok: false, message: `${first(m.name)} is not married.` };
  const sp = mindOf(state, m.spouse), T = state.world.t, spId = m.spouse;
  const had = [rel(m, spId).love, sp ? rel(sp, id).love : 0];
  V.part(state.civ, state.world, id);
  const A = first(m.name), B = first(sp?.name || '?');
  [[m, sp, 0], [sp, m, 1]].forEach(([x, y, i]) => {
    if (!x) return;
    const r = x.relations[y?.id]; if (r) { r.love *= 0.4; r.friend *= 0.6; r.grudge = clamp(r.grudge + 0.15); }
    const loved = had[i] > 0.6;
    M.remember(x, loved ? 'was parted from the one I love' : 'parted', loved ? -0.9 : -0.4, T, y?.id, "the god's will");
    x.mood = clamp(x.mood - (loved ? 0.3 : 0.1)); x.needs.belonging = clamp(x.needs.belonging + 0.4);
    if (loved) x.wrath = clamp((x.wrath || 0) + 0.15);
    else if (x.allegiance === 'true') x.faith = clamp(x.faith + 0.005);
  });
  const P = personOf(state, id), kids = new Set([...(P?.kids || []), ...(personOf(state, spId)?.kids || [])]);
  for (const kid of kids) { const km = mindOf(state, kid); if (km && km.alive) { M.remember(km, 'my parents were parted', -0.3, T, id); km.mood = clamp(km.mood - 0.08); } }
  return { ok: true, spouse: spId, message: `${A} and ${B} are released from their vows.`, heartbroken: had.map((l, i) => l > 0.6 ? [id, spId][i] : null).filter((v) => v != null) };
}

// ---------- a child ----------
export function giveChild(state, id) {
  const m = mindOf(state, id); if (!m || !state.civ) return { ok: false, message: 'No such person.' };
  if (m.spouse == null) return { ok: false, message: `${first(m.name)} is not married — a child needs a household.` };
  const sp = mindOf(state, m.spouse); if (!sp || !sp.alive) return { ok: false, message: 'Their spouse is gone.' };
  const carrier = m.sex === 'f' && sp.sex !== 'f' ? m : sp.sex === 'f' && m.sex !== 'f' ? sp : m.age <= sp.age ? m : sp;
  if (carrier.age > 50) return { ok: false, message: `${first(carrier.name)} is too old to bear a child.` };
  if (m.age < MIN_AGE || sp.age < MIN_AGE) return { ok: false, message: 'They are too young.' };
  const kid = V.bear(state.civ, state.world, m.id, sp.id); if (!kid) return { ok: false, message: 'No child came.' };
  const T = state.world.t;
  for (const par of [m, sp]) { M.remember(par, 'a child, the gift of the god', 0.9, T, kid.id); par.mood = clamp(par.mood + 0.25); par.faith = clamp(par.faith + (par.allegiance === 'true' ? 0.05 : 0.02)); par.needs.meaning = clamp(par.needs.meaning - 0.3); }
  const A = first(m.name), B = first(sp.name);
  return { ok: true, child: { id: kid.id, name: kid.name }, message: `${A} and ${B} are given a child, ${kid.name}.` };
}

// ---------- reconcile ----------
export function reconcile(state, aId, bId) {
  const x = mindOf(state, aId), y = mindOf(state, bId);
  if (!x || !y || !state.civ) return { ok: false, message: 'No such person.' };
  if (aId === bId || !x.alive || !y.alive) return { ok: false, message: 'Both must be alive.' };
  const T = state.world.t, kin = !!V.related(state.civ, state.world, aId, bId);
  const sides = [[x, y], [y, x]].map(([m, o]) => {
    const r = rel(m, o.id), Tm = m.traits, bitter = r.grudge * 0.9 + r.rival * 0.3;
    const mercy = Tm.kindness * 0.5 + heed(m) * 0.6 - Tm.stubbornness * 0.35 - Tm.temper * 0.2 + (kin ? 0.25 : 0);
    const noise = ((hash(m.seed, o.id, 'peace', day(state)) % 1000) / 1000 - 0.5) * 0.2, s = mercy - bitter + noise;
    const tier = s > 0.25 ? 'eager' : s > -0.1 ? 'consent' : 'refuse', k = [m.seed, o.id, day(state)];
    const reply = tier === 'eager' ? pick(['I have carried this too long. Yes.', 'Peace. I am tired of hating.', `I miss what we were. Yes.`], ...k)
      : tier === 'consent' ? pick(['If you ask it, I will lay it down.', 'I will try. I make no promise.', 'For you, then. Not for them.'], ...k)
      : pick(['I will not forgive — not even for you.', 'Some things cannot be taken back.', 'Ask me anything else.'], ...k);
    return { id: m.id, name: nameOf(state, m.id), tier, reply, score: s };
  });
  const refusers = sides.filter((s) => s.tier === 'refuse');
  const A = first(x.name), B = first(y.name), replies = { [aId]: sides[0].reply, [bId]: sides[1].reply };
  if (refusers.length) {
    for (const [s, m, o] of [[sides[0], x, y], [sides[1], y, x]]) {
      if (s.tier === 'refuse') { M.remember(m, "refused the god's peace", -0.3, T, o.id); const r = m.relations[o.id]; if (r) r.grudge = clamp(r.grudge + 0.05); }
      else M.remember(m, 'would not make peace with me', -0.2, T, o.id);
    }
    return { ok: false, refused: refusers.map((s) => ({ id: s.id, name: s.name, reply: s.reply })), replies, message: `${refusers.map((s) => first(s.name)).join(' and ')} will not make peace.` };
  }
  for (const [m, o] of [[x, y], [y, x]]) {
    const r = m.relations[o.id] || (m.relations[o.id] = { ...ZERO });
    r.grudge = 0; r.rival = 0; r.friend = clamp(Math.max(r.friend, 0.4) + 0.1); if (kin) r.love = Math.max(r.love, 0.4);
    M.remember(m, 'made peace', 0.6, T, o.id, kin ? 'blood is thicker' : null); m.mood = clamp(m.mood + 0.1);
    if (m.allegiance === 'true') m.faith = clamp(m.faith + 0.01);
  }
  return { ok: true, replies, message: `${A} and ${B} make peace.` };
}

// ---------- kindle ----------
export function kindle(state, aId, bId) {
  const x = mindOf(state, aId), y = mindOf(state, bId);
  if (!x || !y || !state.civ) return { ok: false, message: 'No such person.' };
  if (aId === bId || !x.alive || !y.alive) return { ok: false, message: 'Both must be alive.' };
  if (V.related(state.civ, state.world, aId, bId)) return { ok: false, message: 'They are of one blood — their love is already family love.' };
  for (const m of [x, y]) { if (m.age < MIN_AGE) return { ok: false, message: `${first(m.name)} is too young.` }; if (m.spouse != null && m.spouse !== (m === x ? y : x).id) return { ok: false, message: `${first(m.name)} is married to ${first(nameOf(state, m.spouse))}.` }; }
  const T = state.world.t, married = x.spouse === y.id;
  for (const [m, o] of [[x, y], [y, x]]) {
    const r = m.relations[o.id] || (m.relations[o.id] = { ...ZERO });
    r.love = clamp(r.love + 0.3 * (0.6 + 0.4 * m.traits.sociability)); r.friend = clamp(r.friend + 0.15); r.grudge *= 0.6; r.rival *= 0.7;
    M.remember(m, married ? 'felt the old warmth return' : `a sudden warmth toward ${first(o.name)}`, 0.4, T, o.id, 'a stirring I cannot explain');
    m.mood = clamp(m.mood + 0.1);
  }
  return { ok: true, message: married ? `${first(x.name)} and ${first(y.name)} remember why they married.` : `A warmth stirs between ${first(x.name)} and ${first(y.name)}.` };
}

// ---------- suggestions ----------
export function candidates(state, id, { n = 8, sameSex = false } = {}) {
  const x = mindOf(state, id); if (!x || !state.civ || status(state, id).kind === 'married' || status(state, id).kind === 'child' || status(state, id).kind === 'dead') return [];
  const px = personOf(state, id), out = [];
  for (const o of state.world.minds) {
    if (o.id === id || !o.alive || o.age < MIN_AGE || o.spouse != null) continue;
    if (!sameSex && o.sex === x.sex) continue;
    const po = personOf(state, o.id); if (!po || po.died != null) continue;
    const d = Math.hypot(o.x - x.x, o.y - x.y);
    if (px && po.nat !== px.nat && d > 30) continue;
    if (d > 80) continue;
    if (V.related(state.civ, state.world, id, o.id)) continue;
    const a = stance(state, x, o), b = stance(state, o, x), refusers = [a, b].filter((s) => s.tier === 'refuse').length;
    a.reply = lineFor(state, x, o, a); b.reply = lineFor(state, o, x, b);
    const score = (a.score + b.score) / 2 + Math.min(rel(x, o.id).love, rel(o, x.id).love) * 0.5 - d * 0.004;
    out.push({ id: o.id, name: nameOf(state, o.id), age: o.age, sex: o.sex, dist: Math.round(d), score: Math.round(score * 100) / 100, pct: Math.round(clamp(0.5 + score / 2.5) * 100),
      a, b, outcome: refusers ? 'refused' : a.tier === 'eager' && b.tier === 'eager' ? 'love' : a.tier === 'eager' || b.tier === 'eager' ? 'glad' : 'arranged' });
  }
  out.sort((p, q) => q.score - p.score);
  return out.slice(0, n);
}
