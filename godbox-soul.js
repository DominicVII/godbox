// GODBOX soul — deep inspection of one person: identity, body, mind, family, faith, timeline,
// the god's whisper, renaming and god-given traits. Deterministic (no Math.random). Reads world (minds),
// civ (people/families/nations/items/chron) and powers when present; degrades gracefully without civ.
import * as M from './godbox-minds.js';
import * as Gn from './godbox-genetics.js';
import * as C from './godbox-culture.js';

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const pct = (v) => Math.round((v || 0) * 100);
const r3 = (v) => Math.round((v || 0) * 1000) / 1000;
const hash = (...xs) => { let h = 2166136261; for (const x of xs) { const s = String(x); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } } return h >>> 0; };
const pickH = (arr, ...k) => arr[hash(...k) % arr.length];
const YEAR = 360;

// ---------- time scale ----------
// days of game time per real second. civ.t is in days (360/year).
export const TIME_SCALES = {
  intimate: { daysPerSecond: 1 / 3, label: 'Intimate — one day every ~3 s; watch single lives' },
  normal: { daysPerSecond: 6, label: 'Normal — a month every ~5 s' },
  fast: { daysPerSecond: 60, label: 'Fast — a year every 6 s' },
};
export function timeScale(preset = 'normal') { const p = TIME_SCALES[preset] || TIME_SCALES.normal; return { preset: TIME_SCALES[preset] ? preset : 'normal', ...p, secondsPerDay: 1 / p.daysPerSecond }; }
// how many fixed steps of `stepDays` to run for a frame of realSeconds; carry fractional remainder in acc.
export function stepsFor(preset, realSeconds, acc = { carry: 0 }, stepDays = 1) {
  const d = timeScale(preset).daysPerSecond * Math.min(realSeconds, 0.25) + acc.carry;
  const n = Math.floor(d / stepDays); acc.carry = d - n * stepDays; return n;
}

// ---------- stats ----------
// WorldBox-style stat block. base derives from genome / mind traits / civ skill; trait mods are added on top.
export const STATS = ['health', 'damage', 'armor', 'speed', 'lifespan', 'fertility', 'intelligence', 'strength', 'charisma',
  'diplomacy', 'warfare', 'stewardship', 'faithTendency', 'aggression', 'loyalty', 'stress'];

// ---------- trait catalog ----------
// mods: stat deltas (stat block) — `mind` deltas are applied to the minds' 9 behaviour traits (drive real choices),
// `faith` is a daily drift on faith, `skill` multiplies civ wage-skill, `genes` overwrites allele groups (real, inheritable).
const T = (id, name, icon, category, description, o) => ({ id, name, icon, category, description, opposites: o.opp || [], mods: o.mods || {},
  mind: o.mind || {}, faith: o.faith || 0, skill: o.skill || 0, genes: o.genes || null, inheritable: !!o.inh, source: o.src });
export const TRAITS = [
  // body
  T('strong', 'Strong', '💪', 'body', 'Thick arms; opens every jar first try.', { opp: ['weak'], mods: { strength: 3, damage: 3, warfare: 2, fertility: 0.2, lifespan: 3 }, mind: { courage: 0.1 }, genes: { strength: 1 }, inh: true, src: 'WorldBox Strong' }),
  T('weak', 'Weak', '🥀', 'body', 'Frail of limb, tires quickly.', { opp: ['strong', 'tough'], mods: { strength: -2, damage: -1, warfare: -2, diplomacy: -2, lifespan: -6 }, mind: { courage: -0.1 }, genes: { strength: 0 }, inh: true, src: 'WorldBox Weak' }),
  T('tough', 'Tough', '🛡️', 'body', 'Shrugs off blows and fevers.', { opp: ['weak', 'sickly'], mods: { armor: 10, health: 30 }, genes: { resist: 1 }, inh: true, src: 'WorldBox Tough / RimWorld Tough' }),
  T('sickly', 'Sickly', '🤒', 'body', 'Always coughing; plague finds them first.', { opp: ['tough', 'blessed_health'], mods: { health: -30, lifespan: -10, fertility: -0.2 }, genes: { resist: 0 }, inh: true, src: 'RimWorld Sickly / CK Infirm' }),
  T('long_lived', 'Long-lived', '🌳', 'body', 'Their line ages slowly.', { opp: ['short_lived'], mods: { lifespan: 15 }, genes: { longevity: 1 }, inh: true, src: 'WorldBox Long Liver / CK Long-lived' }),
  T('short_lived', 'Short-lived', '🕯️', 'body', 'Burns bright, burns short.', { opp: ['long_lived'], mods: { lifespan: -15 }, genes: { longevity: 0 }, inh: true, src: 'WorldBox Short life' }),
  T('fertile', 'Fertile', '🌸', 'body', 'Many children will come.', { opp: ['infertile'], mods: { fertility: 0.5 }, mind: { sociability: 0.05 }, inh: true, src: 'CK Fecund / WorldBox Fertile' }),
  T('infertile', 'Infertile', '🍂', 'body', 'No child will be born of them.', { opp: ['fertile'], mods: { fertility: -1 }, src: 'CK Infertile / RimWorld Sterile' }),
  T('beautiful', 'Attractive', '✨', 'body', 'Heads turn in the market.', { opp: ['ugly'], mods: { charisma: 3, diplomacy: 2, stewardship: 1, fertility: 0.5 }, mind: { sociability: 0.1 }, inh: true, src: 'WorldBox Attractive / RimWorld Beautiful / CK Beautiful' }),
  T('ugly', 'Ugly', '🗿', 'body', 'Children stare.', { opp: ['beautiful'], mods: { charisma: -3, diplomacy: -1, fertility: -0.2 }, mind: { sociability: -0.05 }, inh: true, src: 'RimWorld Ugly / CK Hideous' }),
  T('fast', 'Fast walker', '🦶', 'body', 'Always arrives first.', { opp: ['slow'], mods: { speed: 5 }, src: 'WorldBox Fast / RimWorld Jogger' }),
  T('slow', 'Slow', '🐢', 'body', 'Takes the long way, slowly.', { opp: ['fast'], mods: { speed: -4 }, src: 'RimWorld Slowpoke' }),
  // mind
  T('genius', 'Genius', '🧠', 'mind', 'Overthinking is just thinking. Invents and rules well.', { opp: ['stupid'], mods: { intelligence: 10, diplomacy: 5, stewardship: 7, warfare: 5, loyalty: -10, fertility: 0.1 }, mind: { curiosity: 0.25, ambition: 0.1 }, skill: 0.35, genes: { intel: 1 }, inh: true, src: 'WorldBox Genius / CK Genius' }),
  T('stupid', 'Dim', '🪨', 'mind', 'Not the sharpest tool in the shed.', { opp: ['genius', 'wise'], mods: { intelligence: -5, diplomacy: -2, warfare: -2, stewardship: -5, loyalty: -15, damage: 5, fertility: -0.1 }, mind: { curiosity: -0.2 }, skill: -0.25, genes: { intel: 0 }, inh: true, src: 'WorldBox Stupid / CK Imbecile' }),
  T('wise', 'Wise', '🦉', 'mind', 'Has seen some things.', { opp: ['stupid'], mods: { intelligence: 1, diplomacy: 1, stewardship: 1, warfare: 1 }, mind: { temper: -0.1, kindness: 0.05 }, skill: 0.1, src: 'WorldBox Wise' }),
  T('curious', 'Curious', '🔭', 'mind', 'Takes apart everything to see how it works.', { opp: ['incurious'], mods: { intelligence: 2 }, mind: { curiosity: 0.3 }, src: 'DF curiosity facet / Sims Geek' }),
  T('incurious', 'Incurious', '😑', 'mind', 'The world is as it is.', { opp: ['curious'], mind: { curiosity: -0.3 }, src: 'DF curiosity facet (low)' }),
  T('industrious', 'Industrious', '⚒️', 'mind', 'Works from dawn to dusk.', { opp: ['lazy'], mods: { stewardship: 3, stress: 1 }, mind: { diligence: 0.3 }, skill: 0.2, src: 'RimWorld Industrious / CK Diligent' }),
  T('lazy', 'Lazy', '🛌', 'mind', 'Tomorrow, perhaps.', { opp: ['industrious'], mods: { stewardship: -3, stress: -1 }, mind: { diligence: -0.3 }, skill: -0.2, src: 'RimWorld Lazy / CK Lazy / Sims Lazy' }),
  T('paranoid', 'Paranoid', '👁️', 'mind', 'Sleeps with a knife.', { opp: ['trusting'], mods: { warfare: 4, diplomacy: 2, loyalty: -15, stress: 2 }, mind: { sociability: -0.15, courage: -0.1 }, src: 'WorldBox Paranoid / CK Paranoid' }),
  T('trusting', 'Trusting', '🤲', 'mind', 'Believes every traveller.', { opp: ['paranoid', 'deceitful'], mods: { diplomacy: 2, loyalty: 5 }, mind: { sociability: 0.1, kindness: 0.05 }, src: 'CK Trusting / DF trust facet' }),
  T('madness', 'Madness', '🌀', 'mind', 'Hears colours. Speaks to stones.', { opp: ['wise'], mods: { diplomacy: -100, loyalty: -100, speed: 5, damage: 1, aggression: 3 }, mind: { temper: 0.4, stubbornness: 0.2 }, faith: -0.002, src: 'WorldBox Madness / CK Lunatic' }),
  // spirit
  T('zealous', 'Zealous', '🔥', 'spirit', 'Faith burns in them like a forge.', { opp: ['cynical'], mods: { faithTendency: 3, warfare: 1 }, mind: { piety: 0.35, stubbornness: 0.1 }, faith: 0.004, src: 'CK Zealous / RimWorld Ascetic-adjacent' }),
  T('cynical', 'Cynical', '🙄', 'spirit', 'Gods are stories told to children.', { opp: ['zealous', 'devoted'], mods: { faithTendency: -3, intelligence: 1 }, mind: { piety: -0.35 }, faith: -0.004, src: 'CK Cynical' }),
  T('devoted', 'Devoted to God', '🙏', 'spirit', 'Their heart turns always to the true god.', { opp: ['cynical', 'heretic'], mods: { faithTendency: 2, loyalty: 5 }, mind: { piety: 0.2 }, faith: 0.006, src: 'GODBOX original' }),
  T('heretic', 'Heretic', '🜏', 'spirit', 'Doubts the sky-voice; drawn to idols.', { opp: ['devoted'], mods: { faithTendency: -2 }, mind: { stubbornness: 0.15 }, faith: -0.005, src: 'CK Heretic' }),
  T('brave', 'Brave', '🦁', 'spirit', 'Walks toward the fire.', { opp: ['craven'], mods: { warfare: 3, damage: 1 }, mind: { courage: 0.3 }, src: 'CK Brave / RimWorld Brawler-ish' }),
  T('craven', 'Craven', '🐇', 'spirit', 'Walks away from the fire, quickly.', { opp: ['brave'], mods: { warfare: -3 }, mind: { courage: -0.3 }, src: 'CK Craven' }),
  T('content', 'Content', '🍵', 'spirit', 'Wants little; is glad of it.', { opp: ['ambitious', 'greedy'], mods: { loyalty: 10, diplomacy: 2, stewardship: 2, warfare: -2, stress: -2 }, mind: { ambition: -0.25 }, src: 'WorldBox Content / CK Content' }),
  T('ambitious', 'Ambitious', '👑', 'spirit', 'Dreams of a crown.', { opp: ['content'], mods: { diplomacy: 2, warfare: 4, stewardship: 1, damage: 1, loyalty: -15 }, mind: { ambition: 0.3 }, src: 'WorldBox Ambitious / CK Ambitious' }),
  // social
  T('kind', 'Kind', '💗', 'social', 'Shares bread with strangers.', { opp: ['cruel', 'evil'], mods: { diplomacy: 3, charisma: 1, aggression: -2 }, mind: { kindness: 0.3, temper: -0.1 }, src: 'RimWorld Kind / CK Compassionate' }),
  T('cruel', 'Cruel', '🗡️', 'social', 'Enjoys the weeping of others.', { opp: ['kind'], mods: { warfare: 3, diplomacy: -3, aggression: 3 }, mind: { kindness: -0.3, temper: 0.15 }, src: 'CK Sadistic/Callous' }),
  T('hot_headed', 'Hot-headed', '🌋', 'social', 'Flies into a rage at a word.', { opp: ['calm'], mods: { aggression: 3, diplomacy: -2 }, mind: { temper: 0.35 }, src: 'RimWorld Volatile / CK Wrathful' }),
  T('calm', 'Calm', '🌊', 'social', 'Still water.', { opp: ['hot_headed', 'madness'], mods: { aggression: -3, diplomacy: 2, stress: -1 }, mind: { temper: -0.35 }, src: 'CK Calm / RimWorld Steadfast' }),
  T('gregarious', 'Gregarious', '🎉', 'social', 'Knows everyone in town by name.', { opp: ['shy'], mods: { charisma: 2, diplomacy: 2 }, mind: { sociability: 0.3 }, src: 'CK Gregarious / Sims Outgoing' }),
  T('shy', 'Shy', '🫣', 'social', 'Speaks only to the goats.', { opp: ['gregarious'], mods: { charisma: -2 }, mind: { sociability: -0.3 }, src: 'CK Shy / Sims Loner' }),
  T('honest', 'Honest', '⚖️', 'social', 'Cannot tell a lie, even a kind one.', { opp: ['deceitful'], mods: { stewardship: 3, diplomacy: 2, loyalty: 5, warfare: -2 }, mind: { kindness: 0.05 }, src: 'WorldBox Honest / CK Honest' }),
  T('deceitful', 'Deceitful', '🎭', 'social', 'They weave webs of lies.', { opp: ['honest', 'trusting'], mods: { stewardship: 4, diplomacy: 1, loyalty: -20 }, mind: { ambition: 0.1 }, src: 'WorldBox Deceitful / CK Deceitful' }),
  T('greedy', 'Greedy', '💰', 'social', 'Counts coins in their sleep.', { opp: ['generous', 'content'], mods: { warfare: 4, diplomacy: -2, stewardship: -3, loyalty: -5 }, mind: { ambition: 0.2, kindness: -0.1 }, src: 'WorldBox Greedy / CK Greedy / RimWorld Greedy' }),
  T('generous', 'Generous', '🎁', 'social', 'Gives away the last loaf.', { opp: ['greedy'], mods: { diplomacy: 3, loyalty: 5 }, mind: { kindness: 0.2 }, src: 'CK Generous' }),
  // gift / curse (usually from the god)
  T('blessed', 'Blessed', '🌟', 'gift', 'Touched by the true god; light follows them.', { opp: ['cursed'], mods: { health: 50, lifespan: 10, charisma: 3, faithTendency: 3, loyalty: 10 }, mind: { piety: 0.2, kindness: 0.1 }, faith: 0.008, src: 'WorldBox Blessed' }),
  T('cursed', 'Cursed', '☠️', 'curse', 'Marked by the god. Milk sours as they pass.', { opp: ['blessed'], mods: { health: -40, lifespan: -15, charisma: -4, fertility: -0.5, stress: 3 }, mind: { temper: 0.15 }, faith: -0.003, src: 'WorldBox Cursed' }),
  T('blessed_health', 'Unaging', '♾️', 'gift', 'Sickness and years pass them by.', { opp: ['sickly'], mods: { lifespan: 40, health: 100 }, genes: { longevity: 1, resist: 1, dis: 0 }, inh: true, src: 'WorldBox Immortal (softened) / Boosted Vitality' }),
  T('prophet', 'Prophet', '📜', 'gift', 'Speaks for the god; others listen.', { opp: ['heretic'], mods: { charisma: 5, diplomacy: 3, faithTendency: 4 }, mind: { piety: 0.3, sociability: 0.15 }, faith: 0.01, src: 'GODBOX original / CK Saint' }),
  T('veteran', 'Veteran', '🎖️', 'gift', 'Has survived many battles.', { opp: [], mods: { warfare: 5, damage: 3, armor: 1, health: 30 }, mind: { courage: 0.15 }, src: 'WorldBox Veteran' }),
  T('bloodlust', 'Bloodlust', '🩸', 'curse', 'The god has put war in their blood.', { opp: ['kind', 'calm'], mods: { aggression: 5, warfare: 4, diplomacy: -4 }, mind: { temper: 0.3, kindness: -0.2, courage: 0.15 }, src: 'WorldBox Bloodlust / RimWorld Bloodlust' }),
  T('evil', 'Evil', '😈', 'curse', 'Something rotten looks out of their eyes.', { opp: ['kind', 'blessed'], mods: { warfare: 10, aggression: 4, diplomacy: -3 }, mind: { kindness: -0.4, temper: 0.2 }, faith: -0.004, src: 'WorldBox Evil' }),
  T('voices', 'Voices in my head', '🗯️', 'curse', 'Mutters at night to someone who is not there.', { opp: [], mods: { diplomacy: -1, stress: 2 }, mind: { stubbornness: 0.1 }, faith: 0.002, src: 'WorldBox Voices in my head' }),
];
const BYID = Object.fromEntries(TRAITS.map((t) => [t.id, t]));
export const TRAIT_CATEGORIES = ['body', 'mind', 'spirit', 'social', 'gift', 'curse'];
export function listTraits(category) {
  return TRAITS.filter((t) => !category || t.category === category || (category === 'gift/curse' && (t.category === 'gift' || t.category === 'curse')))
    .map((t) => ({ id: t.id, name: t.name, icon: t.icon, category: t.category, description: t.description, opposites: t.opposites.slice(), mods: { ...t.mods }, mind: { ...t.mind }, faithDrift: t.faith, skill: t.skill, inheritable: t.inheritable, genetic: !!t.genes, source: t.source }));
}

// ---------- state helpers ----------
export function ensureSoul(state) {
  if (!state.soul) state.soul = { v: 1, log: [], whispers: 0 };
  return state.soul;
}
const mindOf = (state, id) => state.world?.byId?.get(+id) || state.world?.minds?.find((m) => m.id === +id) || null;
const personOf = (state, id) => state.civ?.people?.[id] || null;
const tnow = (state) => state.civ ? state.civ.t : state.world?.t || 0;
const yearNow = (state) => state.civ ? state.civ.year : Math.floor((state.world?.t || 0) / YEAR);
const fullName = (state, p, m) => { const fam = p && state.civ?.families?.[p.fam]?.name; return `${(m || p)?.name || '?'}${fam ? ' ' + fam : ''}`; };
const nameOfId = (state, id) => { const p = personOf(state, id), m = mindOf(state, id); return p || m ? fullName(state, p, m) : `#${id}`; };
const aliveOf = (state, id) => { const p = personOf(state, id), m = mindOf(state, id); return p ? p.died == null : m ? !!m.alive : false; };
const pron = (m) => (m?.sex === 'f' ? { s: 'she', o: 'her', p: 'her', S: 'She' } : { s: 'he', o: 'him', p: 'his', S: 'He' });
const godNm = (state, gid) => state.world?.gods?.find((g) => g.id === gid)?.name || null;
function soulMem(state, m, type, weight, text) { // store into the mind's real memory list (same shape as minds' remember)
  const mem = m.memories || (m.memories = []);
  const e = { type, weight, t: state.world?.t || 0, about: null, text: text || null };
  if (mem.length >= 12) { let lo = 0; for (let i = 1; i < mem.length; i++) if (Math.abs(mem[i].weight) < Math.abs(mem[lo].weight)) lo = i; mem.splice(lo, 1); }
  mem.push(e);
  // also an uncapped personal soul diary, so the timeline never forgets the god's touch
  const d = m.soulDiary || (m.soulDiary = []); d.push({ type, weight, t: tnow(state), year: yearNow(state), text: text || null }); if (d.length > 60) d.shift();
}

// ---------- traits on a person ----------
export function personTraits(state, id) { const m = mindOf(state, id); return (m?.soulTraits || []).map((x) => x.id); }
export function giveTrait(state, id, traitId, opts = {}) {
  const m = mindOf(state, id), t = BYID[traitId]; if (!m) return { ok: false, message: 'No such person.' }; if (!t) return { ok: false, message: `No trait "${traitId}".` };
  const list = m.soulTraits || (m.soulTraits = []);
  if (list.some((x) => x.id === traitId)) return { ok: false, message: `${m.name} already has ${t.name}.` };
  const removed = [];
  for (const o of t.opposites) if (list.some((x) => x.id === o)) { removeTrait(state, id, o, { silent: true }); removed.push(o); }
  const rec = { id: traitId, mind: {}, sk: 0, genes: null, by: opts.by || 'god', year: yearNow(state) };
  for (const k in t.mind) { if (m.traits[k] == null) continue; const before = m.traits[k]; m.traits[k] = clamp(before + t.mind[k]); rec.mind[k] = m.traits[k] - before; }
  const p = personOf(state, id);
  if (p && t.skill) { const before = p.sk; p.sk = clamp(p.sk * (1 + t.skill), 0.1, 3); rec.sk = p.sk - before; }
  if (p && t.genes && typeof p.g === 'string') { // real genome edit: inheritable through godbox-genetics.inherit
    rec.genes = p.g; const g = p.g.split('');
    for (const grp in t.genes) for (const i of Gn.GROUPS[grp] || []) g[2 * i] = g[2 * i + 1] = t.genes[grp] ? '1' : '0';
    p.g = g.join('');
  }
  list.push(rec);
  if (!opts.silent) {
    const good = t.category !== 'curse';
    soulMem(state, m, good ? `touched by god: ${t.name}` : `cursed by god: ${t.name}`, good ? 0.8 : -0.8, t.description);
    if (good) m.faith = clamp(m.faith + 0.04 * (0.5 + m.traits.piety)); else { m.fearOfGod = clamp((m.fearOfGod || 0) + 0.2); m.mood = clamp(m.mood - 0.15); }
    ensureSoul(state).log.push({ t: tnow(state), year: yearNow(state), id: m.id, kind: 'giveTrait', trait: traitId });
  }
  return { ok: true, message: `${m.name} is now ${t.name}${removed.length ? ` (no longer ${removed.map((r) => BYID[r].name).join(', ')})` : ''}.`, removed, traits: personTraits(state, id) };
}
export function removeTrait(state, id, traitId, opts = {}) {
  const m = mindOf(state, id); if (!m) return { ok: false, message: 'No such person.' };
  const list = m.soulTraits || [], i = list.findIndex((x) => x.id === traitId);
  if (i < 0) return { ok: false, message: `${m.name} does not have that trait.` };
  const rec = list[i], t = BYID[traitId]; list.splice(i, 1);
  for (const k in rec.mind) m.traits[k] = clamp(m.traits[k] - rec.mind[k]);
  const p = personOf(state, id);
  if (p && rec.sk) p.sk = clamp(p.sk - rec.sk, 0.1, 3);
  if (p && rec.genes) p.g = rec.genes; // restore the genome they were born with (children already born keep theirs)
  if (!opts.silent) {
    soulMem(state, m, t.category === 'curse' ? `freed by god from ${t.name}` : `god took away ${t.name}`, t.category === 'curse' ? 0.7 : -0.5, null);
    ensureSoul(state).log.push({ t: tnow(state), year: yearNow(state), id: m.id, kind: 'removeTrait', trait: traitId });
  }
  return { ok: true, message: `${m.name} is no longer ${t.name}.`, traits: personTraits(state, id) };
}
// Natural traits read from genome + mind (not stored; shown alongside god-given ones).
function innateTraits(state, m, p) {
  const out = [], T_ = m.traits, ph = p && typeof p.g === 'string' ? Gn.phenotype(p.g) : null;
  const add = (id, w) => { if (BYID[id]) out.push({ id, innate: true, why: w }); };
  if (ph) { if (ph.strength > 0.8) add('strong', 'genes'); else if (ph.strength < 0.2) add('weak', 'genes');
    if (ph.intel > 0.85) add('genius', 'genes'); else if (ph.intel < 0.15) add('stupid', 'genes');
    if (ph.longevity > 0.85) add('long_lived', 'genes'); else if (ph.longevity < 0.15) add('short_lived', 'genes');
    if (ph.resist > 0.8) add('tough', 'genes'); if (ph.disease) add('sickly', 'inherited wasting sickness'); }
  const tm = { piety: ['zealous', 'cynical'], courage: ['brave', 'craven'], sociability: ['gregarious', 'shy'], ambition: ['ambitious', 'content'], kindness: ['kind', 'cruel'], temper: ['hot_headed', 'calm'], curiosity: ['curious', 'incurious'], diligence: ['industrious', 'lazy'] };
  for (const k in tm) { if (T_[k] > 0.78) add(tm[k][0], 'temperament'); else if (T_[k] < 0.22) add(tm[k][1], 'temperament'); }
  if (m.age > 55 && hash(m.id, 'wise') % 10 < 3) add('wise', 'age');
  const given = new Set((m.soulTraits || []).map((x) => x.id));
  return out.filter((x) => !given.has(x.id) && !(BYID[x.id].opposites.some((o) => given.has(o))));
}
export function stats(state, id) {
  const m = mindOf(state, id); if (!m) return null; const p = personOf(state, id), T_ = m.traits;
  const ph = p && typeof p.g === 'string' ? Gn.phenotype(p.g) : { strength: 0.5, intel: 0.5, longevity: 0.5, resist: 0.3, heightCm: 168, disease: false };
  const sk = p ? p.sk : 1;
  const s = {
    health: Math.round(100 + ph.resist * 40 - (ph.disease ? 30 : 0)), damage: Math.round(10 + ph.strength * 10), armor: 0, speed: Math.round(10 + (ph.heightCm - 165) / 8),
    lifespan: Math.round(70 + (ph.longevity - 0.5) * 16 - (ph.disease ? 15 : 0)), fertility: 1, intelligence: Math.round(1 + ph.intel * 6 + T_.curiosity * 3),
    strength: Math.round(1 + ph.strength * 9), charisma: Math.round(1 + T_.sociability * 5 + T_.kindness * 2), diplomacy: Math.round(1 + T_.kindness * 3 + T_.sociability * 3 - T_.temper * 2),
    warfare: Math.round(1 + T_.courage * 4 + T_.temper * 2), stewardship: Math.round(1 + T_.diligence * 4 + sk * 2), faithTendency: Math.round((T_.piety - 0.5) * 6),
    aggression: Math.round(T_.temper * 5 + (1 - T_.kindness) * 3), loyalty: Math.round(50 + (m.faith - 0.5) * 20), stress: Math.round((m.needs?.safety || 0) * 5 + (m.needs?.hunger || 0) * 3),
  };
  const all = [...innateTraits(state, m, p).map((x) => x.id), ...personTraits(state, id)];
  for (const tid of all) { const md = BYID[tid].mods; for (const k in md) s[k] = (s[k] || 0) + md[k]; }
  s.fertility = r3(Math.max(0, s.fertility)); s.lifespan = Math.max(15, s.lifespan);
  return s;
}

// Daily hook: god-given traits keep acting (faith drift; infertility & bloodlust behaviours). Call after civ step.
export function tickSoul(state, dt = 1) {
  const W = state.world; if (!W) return;
  for (const m of W.minds) {
    if (!m.alive || !m.soulTraits || !m.soulTraits.length) continue;
    let fd = 0; for (const r of m.soulTraits) fd += BYID[r.id]?.faith || 0;
    if (fd) m.faith = clamp(m.faith + fd * dt);
    const ids = new Set(m.soulTraits.map((r) => r.id));
    if (ids.has('bloodlust') || ids.has('evil')) { if (m.action === 'socialize' && hash(m.id, Math.floor(W.t)) % 5 === 0) m.action = 'feud'; }
    if (ids.has('madness') && hash(m.id, Math.floor(W.t), 'mad') % 7 === 0) m.action = 'wander';
    if (ids.has('blessed') || ids.has('blessed_health')) { m.needs.safety = clamp(m.needs.safety - 0.01 * dt); }
    if (ids.has('cursed')) m.mood = clamp(m.mood - 0.003 * dt);
  }
}

// ---------- rename ----------
export function renamePerson(state, id, name) {
  const m = mindOf(state, id); const clean = String(name || '').replace(/[<>\n\r\t]/g, '').trim().slice(0, 24);
  if (!m) return { ok: false, message: 'No such person.' }; if (!clean) return { ok: false, message: 'A name cannot be empty.' };
  const old = m.name; if (clean === old) return { ok: false, message: 'That is already their name.' };
  m.name = clean; const p = personOf(state, id); if (p) p.name = clean;
  (m.formerNames || (m.formerNames = [])).push(old);
  const T_ = m.traits, proud = T_.stubbornness > 0.6 && m.faith < 0.5;
  soulMem(state, m, 'renamed by god', proud ? -0.4 : 0.7, `I was ${old}; the god named me ${clean}.`);
  if (!proud) m.faith = clamp(m.faith + 0.03);
  ensureSoul(state).log.push({ t: tnow(state), year: yearNow(state), id: m.id, kind: 'rename', from: old, to: clean });
  const reaction = proud ? `"My mother named me ${old}. Call me what you like."` : m.faith > 0.6 ? `"${clean}... I will carry it with honour."` : `"${clean}? So be it, voice."`;
  return { ok: true, message: `${old} is now ${clean}.`, from: old, to: clean, reaction };
}

// ---------- text helpers ----------
const ADJ = { piety: ['devout', 'irreverent'], courage: ['brave', 'timid'], sociability: ['warm', 'solitary'], ambition: ['ambitious', 'unassuming'], kindness: ['kind', 'hard-hearted'], stubbornness: ['stubborn', 'yielding'], curiosity: ['curious', 'incurious'], temper: ['hot-tempered', 'even-tempered'], diligence: ['diligent', 'idle'] };
function traitText(m) {
  return Object.entries(m.traits).map(([k, v]) => {
    const [hi, lo] = ADJ[k] || [k, 'not ' + k];
    const word = v > 0.8 ? `deeply ${hi}` : v > 0.62 ? hi : v < 0.2 ? `utterly ${lo}` : v < 0.38 ? lo : `balanced in ${k}`;
    return { trait: k, value: r3(v), text: word };
  });
}
const NEED_WORD = { hunger: 'hungry', safety: 'afraid for their safety', rest: 'tired', belonging: 'lonely', meaning: 'searching for meaning' };
const NEED_THINK = {
  hunger: ['My belly aches. Will there be bread tomorrow?', 'If the harvest fails again, the children go hungry.'],
  safety: ['Every shadow could be a spear.', 'I keep the door barred at night now.'],
  rest: ['My bones are heavy. Just one day of rest.', 'I could sleep a whole season.'],
  belonging: ['No one would notice if I were gone.', 'I miss the sound of a full table.'],
  meaning: ['What is all this labour for?', 'There must be something more than fields and smoke.'],
};
const MOODW = (v) => (v > 0.75 ? 'joyful' : v > 0.58 ? 'content' : v > 0.42 ? 'steady' : v > 0.25 ? 'low' : 'despairing');
function topNeed(m) { let k = 'meaning', v = -1; for (const n in m.needs) if (m.needs[n] > v) { v = m.needs[n]; k = n; } return [k, v]; }
function strongestMem(m) { return (m.memories || []).slice().sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))[0] || null; }

function thought(state, m) {
  const [need, nv] = topNeed(m), mem = strongestMem(m), k = Math.floor((state.world?.t || 0) * 2);
  const parts = [];
  if (m.prayer) parts.push(`God, I need ${m.prayer.need === 'hunger' ? 'food' : m.prayer.need === 'safety' ? 'protection' : m.prayer.need === 'belonging' ? 'someone' : m.prayer.need}. Are you listening?`);
  else if (nv > 0.45) parts.push(pickH(NEED_THINK[need] || NEED_THINK.meaning, m.id, k));
  if (mem) {
    const who = mem.about != null ? nameOfId(state, mem.about).split(' ')[0] : null;
    const tx = /grief/.test(mem.type) ? `I still see ${who || 'them'} in my dreams.` : /married/.test(mem.type) ? `${who || 'My love'} — the best day of my life.` :
      /prayer answered/.test(mem.type) ? 'The god answered me once. I have not forgotten.' : /unanswered/.test(mem.type) ? 'I begged and the sky said nothing.' :
      /renamed/.test(mem.type) ? 'I still turn my head when someone calls my old name.' : /touched by god/.test(mem.type) ? `Since the god touched me I feel ${mem.type.split(': ')[1]?.toLowerCase() || 'changed'}.` :
      /cursed/.test(mem.type) ? 'Why did the god mark me? What did I do?' : /miracle/.test(mem.type) ? 'I saw the sky open. Nothing is the same.' :
      /heard the god|whisper/.test(mem.type) ? `The voice said: "${(mem.text || '').slice(0, 40)}"` : /attacked/.test(mem.type) ? `${who || 'They'} will pay for what they did.` : null;
    if (tx && parts.length < 2) parts.push(tx);
  }
  if (parts.length < 2) {
    const rv = m.allegiance && m.allegiance !== 'true' ? godNm(state, m.allegiance) : null;
    parts.push(rv ? `${rv} will provide. ${rv} always provides.` : m.faithState === 'devout' ? 'The true god watches over us. I can feel it.' : m.faithState === 'doubter' ? 'Is anyone up there at all?' : m.faithState === 'apostate' ? 'There are no gods. Only us.' : 'Perhaps the god will smile on us today.');
  }
  return parts.join(' ');
}

const ROUT = {
  farmer: ['tends the fields', 'carries water to the rows', 'threshes grain'], soldier: ['drills with spear and shield', 'stands watch on the wall', 'sharpens blades'], priest: ['leads the morning rite', 'hears confessions', 'tends the shrine'],
  miner: ['descends into the pit', 'hauls ore', 'props the tunnels'], smith: ['works the forge', 'hammers tools', 'quenches iron'], scholar: ['copies scrolls', 'teaches the young', 'argues about the stars'],
  engineer: ['designs machines', 'repairs the mill', 'tests new parts'], trader: ['haggles at market', 'counts the day\'s coin', 'loads the carts'], child: ['plays by the river', 'helps with chores', 'listens to stories'], elder: ['sits in the sun', 'tells old stories', 'advises the young'],
};
function routine(state, m, p) {
  const job = p?.job || ({ farm: 'farmer', work: 'farmer', build: 'builder', pray: 'priest', fight: 'soldier' }[m.action] || 'farmer');
  const r = ROUT[job] || ['works at the trade of ' + job, 'mends tools', 'meets with clients'], T_ = m.traits, h = m.id;
  return [
    { time: T_.diligence > 0.6 ? 'before dawn' : 'dawn', activity: T_.piety > 0.6 || m.faithState === 'devout' ? 'wakes and kneels in prayer' : 'wakes, stretches, eats a little bread' },
    { time: 'morning', activity: pickH(r, h, 1) },
    { time: 'midday', activity: T_.sociability > 0.55 ? 'eats with neighbours and trades gossip' : 'eats alone in the shade' },
    { time: 'afternoon', activity: pickH(r, h, 2) },
    { time: 'evening', activity: m.spouse != null ? 'shares supper with family' : T_.sociability > 0.6 ? 'drinks at the fire with friends' : 'walks the edge of town' },
    { time: 'night', activity: m.prayer ? `prays for ${m.prayer.need}` : T_.curiosity > 0.65 ? 'stays up watching the stars' : 'sleeps' },
  ];
}

function homeTown(state, m, p) {
  const n = p && state.civ?.nations?.[p.nat];
  if (!n || !n.lang) return 'a nameless village';
  const hx = Math.round((m.home?.x ?? m.x) / 120), hy = Math.round((m.home?.y ?? m.y) / 120);
  const lang = { ...n.lang, lex: { ...(n.lang.lex || {}) } }; // clone: never mutate the nation's language
  try { return C.placeName(lang, M.mulberry32(hash(n.id, hx, hy))); } catch { return n.name + ' outskirts'; }
}
function standing(state, m, p) {
  const civ = state.civ, n = p && civ?.nations?.[p.nat];
  if (n?.leader && (n.leader.id === m.id || n.leader.person === m.id)) return { rank: 'ruler', text: `${n.leader.title || 'Ruler'} of ${n.name}` };
  if (m.priest) return { rank: 'clergy', text: 'a respected priest' };
  if (!p) return { rank: 'commoner', text: 'a commoner' };
  const ws = Object.values(civ.people).filter((q) => q.died == null && q.nat === p.nat).map((q) => q.w).sort((a, b) => a - b);
  const rank = ws.length ? ws.findIndex((w) => w >= p.w) / ws.length : 0.5;
  return rank > 0.9 ? { rank: 'elite', text: 'one of the wealthiest in the land', percentile: r3(rank) } : rank > 0.6 ? { rank: 'comfortable', text: 'comfortable, respected', percentile: r3(rank) }
    : rank > 0.25 ? { rank: 'commoner', text: 'an ordinary working life', percentile: r3(rank) } : { rank: 'poor', text: 'poor, living hand to mouth', percentile: r3(rank) };
}

function family(state, m, p) {
  const node = (id, role) => (id == null ? null : { id, name: nameOfId(state, id), role, alive: aliveOf(state, id) });
  const parents = p ? p.par.map((id, i) => node(id, i ? 'mother' : 'father')).filter(Boolean) : [];
  const siblings = [];
  if (p && p.par.length) { const seen = new Set(); for (const pid of p.par) for (const k of personOf(state, pid)?.kids || []) if (k !== p.id && !seen.has(k)) { seen.add(k); siblings.push(node(k, personOf(state, k)?.sex === 'f' ? 'sister' : 'brother')); } }
  const grandparents = []; for (const pp of parents) for (const [i, g] of (personOf(state, pp.id)?.par || []).entries()) grandparents.push(node(g, i ? 'grandmother' : 'grandfather'));
  const children = (p?.kids || []).map((k) => node(k, personOf(state, k)?.sex === 'f' ? 'daughter' : 'son'));
  let spouse = m.spouse != null ? node(m.spouse, 'spouse') : null;
  return { house: p ? state.civ.families?.[p.fam]?.name || null : null, houseId: p?.fam ?? null, parents, grandparents, siblings, spouse, children };
}
function relationships(state, m) {
  const out = { friends: [], rivals: [], loves: [], grudges: [] };
  for (const k in m.relations || {}) {
    const r = m.relations[k], b = { id: +k, name: nameOfId(state, k), alive: aliveOf(state, k) };
    if (r.friend > 0.15) out.friends.push({ ...b, strength: r3(r.friend) });
    if (r.love > 0.15) out.loves.push({ ...b, strength: r3(r.love) });
    if (r.rival > 0.15) out.rivals.push({ ...b, strength: r3(r.rival) });
    if (r.grudge > 0.15) out.grudges.push({ ...b, strength: r3(r.grudge) });
  }
  for (const k in out) out[k].sort((a, b) => b.strength - a.strength);
  return out;
}

const DIVINE = /bless|curse|rain|drought|plague|heal|lightning|feast|vision|miracle|flood|quake|fire|smite|god/i;
function timeline(state, m, p) {
  const ev = [], civ = state.civ, born = p ? p.born : yearNow(state) - m.age, died = p?.died;
  const pr = pron(m);
  ev.push({ year: born, type: 'birth', text: `Born${p && p.par.length ? ' to ' + p.par.map((i) => nameOfId(state, i)).join(' and ') : ''}${p ? ' in ' + (civ.nations[p.nat]?.name || 'the wilds') : ''}.` });
  for (const k of p?.kids || []) { const c = personOf(state, k); if (c) { ev.push({ year: c.born, type: 'child', id: k, text: `A ${c.sex === 'f' ? 'daughter' : 'son'}, ${nameOfId(state, k)}, was born.` }); if (c.died != null) ev.push({ year: c.died, type: 'loss', id: k, text: `Lost ${pr.p} child ${nameOfId(state, k)} (${c.cause || 'unknown'}).`, feeling: 'grief' }); } }
  if (m.spouse != null) { const sp = personOf(state, m.spouse); const mar = (m.memories || []).find((x) => x.type === 'married'); ev.push({ year: mar ? Math.floor(mar.t / YEAR) : Math.max(born + 18, (p?.kids?.length ? personOf(state, p.kids[0])?.born - 1 : born + 20)), type: 'marriage', id: m.spouse, text: `Married ${nameOfId(state, m.spouse)}.` }); if (sp && sp.died != null) ev.push({ year: sp.died, type: 'loss', id: m.spouse, text: `Widowed: ${nameOfId(state, m.spouse)} died (${sp.cause}).`, feeling: 'grief' }); }
  for (const pid of p?.par || []) { const q = personOf(state, pid); if (q && q.died != null && q.died >= born) ev.push({ year: q.died, type: 'loss', id: pid, text: `${q.sex === 'f' ? 'Mother' : 'Father'} ${nameOfId(state, pid)} died (${q.cause}).`, feeling: 'grief' }); }
  if (civ) {
    const end = died ?? civ.year, faith = m.faith;
    for (const e of civ.chron) {
      if (e.y < born || e.y > end) continue; if (p && e.n?.length && !e.n.includes(p.nat)) continue;
      if (e.type === 'war' || e.type === 'invention' || e.type === 'milestone' || e.type === 'plague' || e.type === 'leader') ev.push({ year: e.y, type: e.type === 'milestone' ? 'invention' : e.type, text: e.text.replace(/^-?\d+: /, '') });
      else if (e.type === 'god') { const cruel = /curse|plague|drought|lightning|flood|quake|smite|fire/i.test(e.text); const feeling = cruel ? (faith > 0.6 ? 'awe and dread' : 'terror and anger') : faith > 0.5 ? 'gratitude' : 'suspicion'; ev.push({ year: e.y, type: 'divine', text: `Witnessed: ${e.text.replace(/^-?\d+: /, '')}`, feeling }); }
    }
    for (const it of civ.items || []) if (it.inventor === m.id) ev.push({ year: it.year, type: 'invention', text: `Invented the ${it.name}!`, own: true });
  }
  for (const mm of m.memories || []) if (DIVINE.test(mm.type) && !/god:|renamed|by god/.test(mm.type)) ev.push({ year: Math.floor(mm.t / YEAR), type: 'divine', text: mm.type.replace(/ for \d+$/, ''), feeling: mm.weight > 0 ? 'grateful' : 'hurt', weight: r3(mm.weight) });
  for (const d of m.soulDiary || []) ev.push({ year: d.year, type: /whisper/.test(d.type) ? 'whisper' : 'divine', text: d.type + (d.text ? ` — "${d.text}"` : ''), feeling: d.weight > 0 ? 'moved' : 'shaken' });
  if (died != null) ev.push({ year: died, type: 'death', text: `Died (${p.cause}).` });
  const ord = { birth: 0, death: 9 }; ev.sort((a, b) => a.year - b.year || (ord[a.type] ?? 5) - (ord[b.type] ?? 5));
  const out = []; const seen = new Set(); for (const e of ev) { const k = e.year + e.text; if (!seen.has(k)) { seen.add(k); out.push(e); } }
  return out.length > 80 ? [out[0], ...out.slice(-79)] : out;
}

function beliefs(state, m) {
  const rv = m.allegiance && m.allegiance !== 'true' ? m.allegiance : null, g = rv ? state.world.gods?.find((x) => x.id === rv) : null;
  const doubts = [];
  if (m.silence > 0) doubts.push(`${m.silence} prayer${m.silence > 1 ? 's' : ''} went unanswered`);
  if ((m.memories || []).some((x) => /wrath|plague|attacked|grief/.test(x.type))) doubts.push('suffering the god allowed');
  if (m.traits.curiosity > 0.7) doubts.push('questions the priests cannot answer');
  if (rv) doubts.push(`${g?.name || 'another god'} seems closer`);
  return {
    faithInTrueGod: r3(m.faith), faithState: m.faithState, fearOfGod: r3(m.fearOfGod), wrath: r3(m.wrath || 0), grace: r3(m.grace || 0), priest: !!m.priest,
    allegiance: m.allegiance === 'true' ? 'the true god' : g ? g.name : 'none',
    rivalGod: g ? { id: g.id, name: g.name, kind: g.kind, domain: g.domain, devotion: r3(m.devotion?.[rv] || 0) } : null,
    devotions: Object.entries(m.devotion || {}).map(([id, v]) => ({ id, name: godNm(state, id) || id, devotion: r3(v) })),
    prayer: m.prayer ? { need: m.prayer.need, since: r3(m.prayer.t), text: prayerText(m) } : null,
    lastAnswered: r3(m.lastAnswered || 0), unansweredPrayers: m.silence || 0, doubts,
    faithHistory: (m.faithLog || []).slice(-20).map(r3),
  };
}
function prayerText(m) {
  const n = m.prayer?.need; const k = m.id;
  const P = { hunger: ['Give us bread, Lord.', 'Let the harvest come in.', 'Feed my children.'], safety: ['Shield us from the raiders.', 'Keep the walls standing.', 'Let my family sleep safe.'],
    rest: ['Grant me rest.', 'Ease my aching back.'], belonging: ['Send me someone to love.', 'Do not let me die alone.', 'Bring my kin home.'], meaning: ['Show me why I am here.', 'Give me a sign.', 'Speak to me, please.'] };
  return pickH(P[n] || P.meaning, k, n);
}

function hopesFears(state, m, p) {
  const GOALH = { prosper: 'to build a fine house and never fear winter', family: 'to see grandchildren around the hearth', glory: 'to be remembered in songs', knowledge: 'to understand how the world works',
    peace: 'a life without war', faith: 'to see the god face to face', land: 'fields of their own', revenge: 'to settle an old score' };
  const hopes = [GOALH[m.goal] || m.goal]; if (m.spouse == null && m.age > 17 && m.age < 45) hopes.push('to find a spouse'); if (m.prayer) hopes.push(`that the god answers: ${prayerText(m)}`);
  if (m.traits.ambition > 0.7) hopes.push('power and a name'); if (p?.kids?.length) hopes.push('that the children outlive them');
  const fears = [m.fear]; if (m.fearOfGod > 0.4) fears.push('the god\'s wrath'); if (m.needs.hunger > 0.5) fears.push('starvation'); if (m.age > 60) fears.push('dying before their work is done');
  const civ = state.civ; if (p && civ?.wars?.some((w) => w.on && (w.a === p.nat || w.b === p.nat))) fears.push('the war reaching home');
  return { hopes, fears, goal: m.goal };
}

// ---------- public: inspect ----------
export function inspectPerson(state, personId) {
  const m = mindOf(state, personId); if (!m) return null;
  const p = personOf(state, personId), civ = state.civ, n = p && civ?.nations?.[p.nat], pr = pron(m);
  const ph = p && typeof p.g === 'string' ? Gn.phenotype(p.g) : null;
  const look = ph ? (() => { const a = Gn.appearance(p.g); return { heightCm: ph.heightCm, build: ph.build, hair: ph.hair, eyes: ph.eye, skinTone: ph.skin < 0.3 ? 'fair' : ph.skin < 0.55 ? 'olive' : ph.skin < 0.8 ? 'brown' : 'deep brown', colors: { skin: a.skinColor, hair: a.hairColor, eyes: a.eyeColor },
    text: `${pr.S} stands ${ph.heightCm} cm with a ${ph.build} build, ${ph.hair} hair and ${ph.eye} eyes${m.age > 55 ? ', grey creeping in' : ''}.`, genetics: Gn.describeGenome(p.g),
    heritable: { intellect: r3(ph.intel), strength: r3(ph.strength), longevity: r3(ph.longevity), plagueResistance: r3(ph.resist), wastingSickness: ph.disease ? 'afflicted' : /carrier/i.test(Gn.describeGenome(p.g)) ? 'carrier' : 'none' } }; })()
    : { text: `${pr.S} looks like any other soul of ${pr.p} people.`, genetics: 'No genome recorded.', heritable: null };
  const [need, nv] = topNeed(m);
  const given = (m.soulTraits || []).map((r) => ({ ...listTraits().find((t) => t.id === r.id), given: true, by: r.by, year: r.year }));
  const innate = innateTraits(state, m, p).map((x) => ({ ...listTraits().find((t) => t.id === x.id), innate: true, why: x.why }));
  const skills = [];
  if (p) skills.push({ name: p.job, level: r3(p.sk), text: p.sk > 1.1 ? 'master' : p.sk > 0.8 ? 'skilled' : 'apprentice' });
  if (m.priest) skills.push({ name: 'preaching', level: r3(m.traits.piety), text: 'preaches the faith' });
  if (m.traits.curiosity > 0.65) skills.push({ name: 'tinkering', level: r3(m.traits.curiosity), text: 'always building something' });
  if (m.traits.courage > 0.65 && m.traits.temper > 0.5) skills.push({ name: 'fighting', level: r3((m.traits.courage + m.traits.temper) / 2), text: 'handy in a brawl' });
  const inventions = (civ?.items || []).filter((it) => it.inventor === m.id).map((it) => ({ id: it.id, name: it.name, year: it.year, milestone: it.milestone || null }));
  const prof = {
    id: m.id, alive: p ? p.died == null : !!m.alive,
    identity: { name: fullName(state, p, m), given: m.name, formerNames: (m.formerNames || []).slice(), age: m.age, sex: m.sex === 'f' ? 'female' : 'male', pronoun: pr.s, nation: n?.name || 'no nation', nationId: p?.nat ?? null,
      homeTown: homeTown(state, m, p), job: p?.job || m.action, standing: standing(state, m, p), wealth: p ? r3(p.w) : null, faction: n?.factions?.find((f) => f.id === p.fac)?.name || null,
      born: p ? p.born : null, died: p?.died ?? null, causeOfDeath: p?.cause || null },
    appearance: look,
    personality: { traits: traitText(m), summary: M.describe(m, state.world), traitBadges: [...innate, ...given] },
    stats: stats(state, m.id),
    needs: Object.fromEntries(Object.entries(m.needs).map(([k, v]) => [k, r3(v)])), mostPressing: { need, value: r3(nv), text: NEED_WORD[need] || need },
    mood: { value: r3(m.mood), text: MOODW(m.mood) }, doing: m.action,
    thinking: thought(state, m),
    routine: routine(state, m, p),
    family: family(state, m, p),
    relationships: relationships(state, m),
    timeline: timeline(state, m, p),
    beliefs: beliefs(state, m),
    skills, inventions,
    hopesAndFears: hopesFears(state, m, p),
    memories: (m.memories || []).map((x) => ({ type: x.type, weight: r3(x.weight), about: x.about, aboutName: x.about != null ? nameOfId(state, x.about) : null, text: x.text })),
  };
  return JSON.parse(JSON.stringify(prof));
}

// ---------- prayers feed ----------
export function recentPrayers(state, n = 10) {
  const out = [];
  for (const m of state.world?.minds || []) if (m.alive && m.prayer) out.push({ id: m.id, name: nameOfId(state, m.id), need: m.prayer.need, text: prayerText(m), since: r3(m.prayer.t),
    nation: state.civ?.nations?.[personOf(state, m.id)?.nat]?.name || null, to: m.allegiance === 'true' ? 'the true god' : godNm(state, m.allegiance) || 'anyone listening', faith: r3(m.faith), x: r3(m.x), y: r3(m.y) });
  out.sort((a, b) => b.since - a.since || a.id - b.id);
  return out.slice(0, n);
}

// ---------- inner voice ----------
export function listenTo(state, personId) {
  const m = mindOf(state, personId); if (!m) return '';
  const p = personOf(state, personId);
  if (p && p.died != null) return `Silence. ${m.name} died in year ${p.died} (${p.cause}). Only the memory of ${pron(m).o} remains.`;
  const s = [thought(state, m)];
  const fam = m.spouse != null ? nameOfId(state, m.spouse).split(' ')[0] : null;
  if (fam) s.push(m.mood > 0.5 ? `${fam} laughed today; I hold onto that.` : `I should be kinder to ${fam}.`);
  const kids = (p?.kids || []).filter((k) => aliveOf(state, k)); if (kids.length) s.push(`Little ${nameOfId(state, kids[kids.length - 1]).split(' ')[0]} must eat first.`);
  s.push({ prosper: 'One good year and we will be fine.', family: 'Family is all that lasts.', glory: 'One day they will sing my name.', knowledge: 'If only I could understand how it all fits.', peace: 'Let there be no more fighting.', faith: 'Let me be worthy.', land: 'A field of my own — that is all I ask.', revenge: 'I have not forgotten. I will not forget.' }[m.goal] || '');
  if (m.soulTraits?.length) s.push(`Something the god put in me — ${m.soulTraits.map((r) => BYID[r.id].name.toLowerCase()).join(', ')} — stirs.`);
  return s.filter(Boolean).join(' ');
}

// ---------- whisper ----------
export function whisper(state, personId, text = '') {
  const m = mindOf(state, personId); if (!m) return { ok: false, message: 'No such person.' };
  if (!m.alive || personOf(state, personId)?.died != null) return { ok: false, message: 'The dead do not answer.' };
  const msg = String(text).slice(0, 200);
  const res = M.respond(m, msg, state.world); // real obedience model: uses traits, faith, fear, rival devotion
  const T_ = m.traits; let reaction;
  const sOf = /\b(love|safe|fear not|peace|forgive|with you|comfort|rest)\b/i.test(msg);
  const rv = m.allegiance && m.allegiance !== 'true';
  if (sOf && !rv && m.faithState !== 'apostate' && m.faith > 0.15) reaction = 'comfort';
  else if (res.obey) reaction = m.fearOfGod > 0.45 || T_.courage < 0.3 ? 'fear' : 'obedience';
  else reaction = rv || m.faithState === 'apostate' || T_.stubbornness > 0.55 ? 'refusal' : 'doubt';
  if (reaction === 'comfort' && !res.obey) res.reply = m.faith > 0.5 ? 'I hear you. I am not alone.' : 'Is it... truly you? Then perhaps I can rest.';
  const tail = { comfort: ' Tears come; something heavy lifts.', fear: ' Hands shaking, eyes on the sky.', obedience: '', doubt: ' ...Was that only the wind?', refusal: '' }[reaction];
  const reply = res.reply + tail;
  const w = reaction === 'comfort' ? 0.8 : reaction === 'obedience' ? 0.6 : reaction === 'fear' ? -0.3 : reaction === 'doubt' ? 0.2 : -0.5;
  if (reaction === 'comfort') { m.mood = clamp(m.mood + 0.15); m.needs.meaning = clamp(m.needs.meaning - 0.2); if (m.prayer) { m.prayer = null; m.lastAnswered = state.world.t; } m.silence = Math.max(0, (m.silence || 0) - 1); }
  if (reaction === 'fear') m.fearOfGod = clamp((m.fearOfGod || 0) + 0.08);
  if (reaction === 'doubt') m.faith = clamp(m.faith - 0.01);
  soulMem(state, m, `whisper (${reaction})`, w, msg);
  const S = ensureSoul(state); S.whispers++; S.log.push({ t: tnow(state), year: yearNow(state), id: m.id, kind: 'whisper', text: msg, reaction, obey: res.obey });
  return { ok: true, id: m.id, name: nameOfId(state, m.id), obey: res.obey, kind: res.kind, reaction, reply };
}
