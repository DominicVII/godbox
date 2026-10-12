/**
 * godbox-culture.js — languages, culture, sports, factions and leaders for godbox-civ.js
 * =====================================================================================
 * Pure ES module, no deps. Every function takes an explicit rng() (0..1) so the caller
 * (godbox-civ.js, which owns a serializable seeded RNG) stays deterministic.
 *
 * LANGUAGE   createLanguage(rng) -> lang {name, C[], V[], pats[], lex{meaning:word}, shifts[], family, borrowed{}}
 *   word(lang, meaning, rng)   memoised lexicon lookup (generated from the phonology on first use)
 *   personName / placeName / godName / inventionName(lang, rng, noun)
 *   driftLanguage(lang, rng)   a regular sound shift applied to the whole lexicon (recorded in lang.shifts)
 *   splitLanguage(lang, rng)   daughter language (copy + 2 shifts), same family
 *   borrowWord(to, from, meaning)  loanword through trade (recorded in to.borrowed)
 * CULTURE    createCulture(rng, lang, env) -> {values{}, cuisine[], art, customs[], festivals[], sports[]}
 *   blendCulture(a, b, rate, rng)  values converge, dishes / sports / words may be adopted
 *   createSport(rng, lang, culture), playSeason(sport, rng, year) -> champion team
 * POLITICS   TITLES[gov], createFactions(rng, lang, nation), factionAffinity(f, person, mind)
 *   makeLeader(rng, nation, person, mind, fullName, year, how) -> leader {id,name,title,since,bio[],policies{},legitimacy}
 * DESCRIBE   describeLanguage, describeCulture, describeSport, describeFaction, describeLeader (strings)
 */
const pick = (rng, a) => a[(rng() * a.length) | 0];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const C_POOL = ['p', 'b', 't', 'd', 'k', 'g', 'm', 'n', 's', 'z', 'r', 'l', 'v', 'f', 'h', 'sh', 'th', 'kh', 'ts', 'y', 'w', 'q', 'j', 'ng'];
const V_POOL = ['a', 'e', 'i', 'o', 'u', 'ae', 'ou', 'ai', 'a', 'e', 'ei', 'o'];
const PATS = ['CV', 'CVC', 'V', 'VC', 'CV', 'CLV', 'CVN'];
const SHIFT_PAIRS = [['p', 'f'], ['t', 'th'], ['k', 'kh'], ['k', 'h'], ['s', 'sh'], ['d', 't'], ['g', 'k'], ['b', 'v'], ['o', 'u'], ['e', 'i'], ['a', 'ae'], ['ts', 's'], ['l', 'r'], ['ou', 'o'], ['ai', 'e']];

const CORE = ['sun', 'water', 'god', 'king', 'war', 'love', 'fire', 'iron', 'town', 'land', 'mother', 'bread'];
export function createLanguage(rng, family) {
  const C = C_POOL.filter(() => rng() < 0.5); while (C.length < 7) C.push(pick(rng, C_POOL));
  const V = V_POOL.filter(() => rng() < 0.45); while (V.length < 3) V.push(pick(rng, V_POOL));
  const pats = PATS.filter((_, i) => i < 2 || rng() < 0.4);
  const lang = { name: '', C: [...new Set(C)], V: [...new Set(V)], pats, syl: [1 + (rng() < 0.5), 2 + (rng() * 2 | 0)], lex: {}, shifts: [], borrowed: {}, family: family || null };
  lang.name = cap(short(word(lang, 'tongue', rng), 8)) + pick(rng, ['ic', 'ish', 'an', 'i', 'ese', '']);
  if (!lang.family) lang.family = lang.name;
  for (const k of CORE) word(lang, k, rng);
  return lang;
}
function gen(lang, rng, n) {
  let s = ''; const k = n ?? lang.syl[0] + ((rng() * (lang.syl[1] - lang.syl[0] + 1)) | 0);
  for (let i = 0; i < k; i++) for (const ch of pick(rng, lang.pats)) s += ch === 'C' ? pick(rng, lang.C) : ch === 'L' ? pick(rng, ['r', 'l']) : ch === 'N' ? pick(rng, ['n', 'm', 'r', 's']) : pick(rng, lang.V);
  return s.replace(/(.)\1+/g, '$1').replace(/([^aeiou]{2})[^aeiou]+/g, '$1');
}
export function word(lang, meaning, rng) { return lang.lex[meaning] || (lang.lex[meaning] = gen(lang, rng)); }
const short = (w, n) => (w.length > n ? w.slice(0, n).replace(/[^aeiou]+$/, '') || w.slice(0, n) : w);
export const personName = (lang, rng) => cap(short(gen(lang, rng, 1 + (rng() < 0.7)), 8));
export const placeName = (lang, rng) => cap(short(gen(lang, rng, 2) + pick(rng, ['', '', word(lang, 'town', rng), word(lang, 'land', rng)]), 11));
export const godName = (lang, rng) => cap(gen(lang, rng, 2));
export function inventionName(lang, rng, noun) { return `${cap(short(gen(lang, rng, 1 + (rng() < 0.5)), 8))} ${noun}`; }
export function driftLanguage(lang, rng) {
  const all = Object.values(lang.lex).join(' ');
  const opts = SHIFT_PAIRS.flatMap((p) => [p, [p[1], p[0]]]).filter((p) => all.includes(p[0]));
  const [a, b] = opts.length ? pick(rng, opts) : pick(rng, SHIFT_PAIRS);
  const re = new RegExp(a, 'g');
  for (const k in lang.lex) if (!lang.borrowed[k]) lang.lex[k] = lang.lex[k].replace(re, b).replace(/(.)\1+/g, '$1');
  lang.C = lang.C.map((c) => (c === a ? b : c)); lang.V = lang.V.map((v) => (v === a ? b : v));
  lang.shifts.push(`${a}>${b}`); if (lang.shifts.length > 30) lang.shifts.shift();
  return `${a}>${b}`;
}
export function splitLanguage(lang, rng) {
  const d = JSON.parse(JSON.stringify(lang)); d.shifts = []; d.borrowed = {};
  driftLanguage(d, rng); driftLanguage(d, rng);
  d.name = cap(short(word(d, 'tongue', rng), 8)) + pick(rng, ['ic', 'ish', 'an', 'i']) + (d.name === lang.name ? ' ' + pick(rng, ['Nova', 'Minor', 'Low']) : '');
  d.parent = lang.name; return d;
}
export function borrowWord(to, from, meaning) {
  if (!from.lex[meaning] || to.borrowed[meaning]) return null;
  to.lex[meaning] = from.lex[meaning]; to.borrowed[meaning] = from.name; return to.lex[meaning];
}

// ---------- culture ----------
const VALUES = ['honor', 'wealth', 'piety', 'freedom', 'tradition', 'innovation', 'martial', 'harmony'];
const METHODS = ['stew', 'flatbread', 'roast', 'porridge', 'dumplings', 'skewers', 'pickles', 'fermented paste', 'honey cakes', 'broth'];
const SPICE = ['salt', 'wild garlic', 'pepperleaf', 'smoked chili', 'river mint', 'ash-salt', 'sour berries', 'sesame'];
const MOTIF = ['spirals', 'geometric lattices', 'animal friezes', 'ancestor masks', 'river scenes', 'star maps', 'interlaced knots', 'colour fields'];
const MEDIUM = ['carved wood', 'painted clay', 'woven cloth', 'bronze relief', 'stone mosaic', 'glass beads', 'ink scrolls'];
const CUSTOM_T = [
  (w) => `guests are greeted with ${w.spice}`, () => 'the dead are burned at dawn', () => 'the dead are buried facing the river',
  () => 'elders choose the names of children', () => 'debts are forgiven every seventh year', () => 'marriages are sealed by exchanging knives',
  () => 'nobody eats before the eldest', () => 'disputes are settled by public debate', () => 'a stranger may claim three nights of shelter',
  () => 'oaths are sworn on family names', () => 'children are tattooed when they come of age', () => 'craftsmen sign their work',
];
const OCCASION = ['the harvest', 'midwinter', 'the first rain', 'the founding of the nation', 'a great victory', 'the ancestors', 'the true god', 'the new year', 'the river flood'];
const ACTIV = ['bonfires', 'masked dances', 'feasting', 'boat races', 'lantern processions', 'singing contests', 'gift giving', 'fasting', 'mock battles'];
export function createCulture(rng, lang, env = {}) {
  const values = {}; for (const v of VALUES) values[v] = +(0.2 + rng() * 0.6).toFixed(3);
  const staple = env.staple || pick(rng, ['grain', 'rice', 'fish', 'roots', 'goat meat', 'beans', 'maize']);
  const spice = pick(rng, SPICE);
  const cuisine = [0, 1, 2].map(() => `${cap(word(lang, 'dish' + ((rng() * 99) | 0), rng))} (${staple} ${pick(rng, METHODS)} with ${pick(rng, SPICE)})`);
  const art = { motif: pick(rng, MOTIF), medium: pick(rng, MEDIUM), name: cap(word(lang, 'art', rng)) + ' style' };
  const customs = []; while (customs.length < 3) { const c = pick(rng, CUSTOM_T)({ spice }); if (!customs.includes(c)) customs.push(c); }
  const festivals = [0, 1].map(() => ({ name: cap(word(lang, 'fest' + ((rng() * 99) | 0), rng)), occasion: pick(rng, OCCASION), activity: pick(rng, ACTIV) }));
  const c = { values, staple, cuisine, art, customs, festivals, sports: [] };
  c.sports.push(createSport(rng, lang, c));
  return c;
}
export function blendCulture(a, b, rate, rng) {
  for (const v of VALUES) { const d = (b.values[v] - a.values[v]) * rate; a.values[v] = +(a.values[v] + d).toFixed(3); }
  if (rng() < rate * 3 && b.cuisine.length && a.cuisine.length < 6) { const d = pick(rng, b.cuisine); if (!a.cuisine.includes(d)) a.cuisine.push(d); }
  if (rng() < rate * 2 && b.sports.length && a.sports.length < 4) { const s = pick(rng, b.sports); if (!a.sports.find((x) => x.name === s.name)) { const cp = JSON.parse(JSON.stringify(s)); cp.adoptedFrom = s.origin; cp.champions = []; return cp; } }
  return null;
}

// ---------- sports ----------
const EQUIP = ['a leather ball', 'a wooden hoop', 'stone discs', 'a feathered shuttle', 'a pair of sticks and a knot of rope', 'a bladder ball', 'a bronze ring', 'clay pins'];
const FIELD = ['a sand court', 'a shallow river', 'a long meadow', 'a walled yard', 'the town square', 'a frozen lake', 'a hillside'];
const GOAL = ['through a raised hoop', 'across the far line', 'knocking down the opposing pins', 'into a basket held by a teammate', 'onto a painted target', 'around three posts'];
const TWIST = ['players may not use their hands', 'the ball must bounce once before scoring', 'a match lasts until sunset', 'the losing side cooks the feast',
  'captains may swap one player at half time', 'scoring twice in a row counts triple', 'players are tied in pairs at the ankle', 'only the eldest may shout'];
export function createSport(rng, lang, culture, origin) {
  const s = { name: cap(word(lang, 'game' + ((rng() * 999) | 0), rng)), equipment: pick(rng, EQUIP), field: pick(rng, FIELD), players: 2 + ((rng() * 12) | 0),
    goal: pick(rng, GOAL), points: 1 + ((rng() * 3) | 0), rules: [pick(rng, TWIST)], teams: [], champions: [], origin: origin || lang.name };
  if (rng() < 0.5) { const t = pick(rng, TWIST); if (!s.rules.includes(t)) s.rules.push(t); }
  if (culture && culture.values.martial > 0.6) s.rules.push('tackling is allowed');
  for (let i = 0; i < 4; i++) s.teams.push({ name: `${placeName(lang, rng)} ${pick(rng, ['Hawks', 'Rams', 'Rivermen', 'Lanterns', 'Wolves', 'Smiths', 'Stars', 'Oaks'])}`, strength: rng(), titles: 0 });
  return s;
}
export function playSeason(s, rng, year) {
  let best = null, bs = -1;
  for (const t of s.teams) { t.strength = Math.min(1, Math.max(0, t.strength + (rng() - 0.5) * 0.2)); const sc = t.strength + rng() * 0.6; if (sc > bs) { bs = sc; best = t; } }
  best.titles++; s.champions.push({ year, team: best.name }); if (s.champions.length > 40) s.champions.shift();
  return best;
}

// ---------- politics ----------
export const TITLES = { chiefdom: 'Chief', monarchy: 'Monarch', republic: 'President', council: 'First Speaker', theocracy: 'High Priest', junta: 'General', technocracy: 'Chief Engineer' };
const FTPL = [
  { kind: 'political', goal: 'expand the realm by force', ideo: { war: 0.8, tax: 0.5, faith: 0.4, tech: 0.4 }, n: 'War Hawks', fit: (p, m) => m.traits.courage + m.traits.temper + (p.job === 'soldier' ? 1 : 0) },
  { kind: 'political', goal: 'reform the government and widen the vote', ideo: { war: 0.2, tax: 0.4, faith: 0.3, tech: 0.7 }, n: 'Reformists', fit: (p, m) => m.traits.curiosity + (1 - m.traits.stubbornness) + (p.wealth < 50 ? 0.5 : 0) },
  { kind: 'political', goal: 'preserve tradition and the ruling house', ideo: { war: 0.5, tax: 0.6, faith: 0.6, tech: 0.3 }, n: 'Loyalists', fit: (p, m) => m.traits.stubbornness + m.traits.piety * 0.5 + (p.wealth > 200 ? 0.6 : 0) },
  { kind: 'religious', goal: 'make the nation obey the true god', ideo: { war: 0.4, tax: 0.5, faith: 1, tech: 0.3 }, n: 'Faithful', fit: (p, m) => m.faith * 2 + (p.job === 'priest' ? 1 : 0) },
  { kind: 'religious', goal: 'restore the old gods', ideo: { war: 0.5, tax: 0.5, faith: 0.8, tech: 0.2 }, n: 'Old Rite', fit: (p, m) => (m.allegiance && m.allegiance !== 'true' ? 1.6 : 0) + m.traits.piety * 0.5 },
  { kind: 'economic', goal: 'free trade and low taxes', ideo: { war: 0.2, tax: 0.1, faith: 0.3, tech: 0.7 }, n: 'Merchant Guild', fit: (p, m) => (p.job === 'trader' ? 1.5 : 0) + m.traits.ambition + Math.min(1, p.wealth / 300) },
  { kind: 'economic', goal: 'fair wages and shared wealth', ideo: { war: 0.3, tax: 0.8, faith: 0.4, tech: 0.5 }, n: 'Workers\' Union', fit: (p, m) => (['miner', 'farmer', 'builder', 'smith', 'woodcutter'].includes(p.job) ? 1 : 0) + m.traits.kindness + (p.wealth < 40 ? 0.8 : 0) },
  { kind: 'economic', goal: 'invest in science and machines', ideo: { war: 0.3, tax: 0.5, faith: 0.1, tech: 1 }, n: 'Academy', fit: (p, m) => (['scholar', 'engineer', 'programmer'].includes(p.job) ? 1.5 : 0) + m.traits.curiosity },
];
export function createFactions(rng, lang, nation) {
  return FTPL.map((t, i) => ({ id: `${nation.id}-f${i}`, tpl: i, kind: t.kind, name: `${cap(word(lang, 'faction' + i, rng))} ${t.n}`, goal: t.goal,
    ideology: { ...t.ideo }, members: 0, top: [], influence: 0, leaderId: null, founded: nation.founded }));
}
export const factionAffinity = (f, p, m) => FTPL[f.tpl].fit(p, m);
export function makeLeader(rng, nation, p, m, fullName, year, how) {
  const T = m.traits, fa = nation.factions?.find((f) => f.id === p.faction);
  const ide = fa ? fa.ideology : { war: 0.4, tax: 0.5, faith: 0.5, tech: 0.5 };
  const policies = {
    tax: +(Math.min(0.45, Math.max(0.03, 0.1 + ide.tax * 0.25 + (T.ambition - 0.5) * 0.1))).toFixed(3),
    war: +(ide.war * 0.6 + T.temper * 0.25 + T.courage * 0.15).toFixed(3),
    trade: +(0.3 + (1 - ide.war) * 0.3 + T.sociability * 0.3).toFixed(3),
    faith: +(ide.faith * 0.6 + T.piety * 0.4).toFixed(3),
    research: +(ide.tech * 0.6 + T.curiosity * 0.4).toFixed(3),
  };
  const title = TITLES[nation.gov] === 'Monarch' ? (m.sex === 'f' ? 'Queen' : 'King') : TITLES[nation.gov];
  const bio = [`Born ${p.born} to the ${fullName.split(' ').slice(1).join(' ') || 'common'} family; worked as a ${p.job}.`,
    `Became ${title} of ${nation.name} in ${year} (${how}).`];
  if (fa) bio.push(`Backed by the ${fa.name}, who want to ${fa.goal}.`);
  return { id: p.id, name: fullName, title, since: year, how, bio, policies, legitimacy: how === 'coup' ? 0.35 : how === 'election' ? 0.8 : 0.65 };
}

// ---------- describe ----------
export function describeLanguage(l) {
  const s = ['sun', 'water', 'god', 'king', 'war', 'love', 'fire', 'iron'].map((k) => `${k}: ${l.lex[k] || '—'}`).join(', ');
  const bor = Object.entries(l.borrowed).slice(0, 5).map(([k, v]) => `${k} (from ${v})`).join(', ');
  return `${l.name} (${l.family} family${l.parent ? ', split from ' + l.parent : ''}). Sounds: ${l.C.join(' ')} / ${l.V.join(' ')}; syllables ${l.pats.join(', ')}. ` +
    `Words: ${s}. ${l.shifts.length ? 'Sound shifts: ' + l.shifts.slice(-6).join(', ') + '. ' : ''}${bor ? 'Loanwords: ' + bor + '.' : ''}`;
}
export function describeSport(s) {
  const ch = s.champions.slice(-3).map((c) => `${c.team} (${c.year})`).join(', ');
  return `${s.name}: ${s.players} a side on ${s.field} with ${s.equipment}; score ${s.points} point${s.points > 1 ? 's' : ''} by getting it ${s.goal}. Rules: ${s.rules.join('; ')}. ` +
    `Teams: ${s.teams.map((t) => `${t.name} (${t.titles} titles)`).join(', ')}.${ch ? ' Recent champions: ' + ch + '.' : ''}${s.adoptedFrom ? ' Adopted from the ' + s.adoptedFrom + ' speakers.' : ''}`;
}
export function describeCulture(c) {
  const v = Object.entries(c.values).sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]).join(', ');
  return `Values ${v}. Cuisine: ${c.cuisine.slice(0, 3).join('; ')}. Art: ${c.art.name}, ${c.art.motif} in ${c.art.medium}. Customs: ${c.customs.join('; ')}. ` +
    `Festivals: ${c.festivals.map((f) => `${f.name} for ${f.occasion} (${f.activity})`).join('; ')}. Sports: ${c.sports.map((s) => s.name).join(', ')}.`;
}
export function describeFaction(f) {
  return `${f.name} (${f.kind}) want to ${f.goal}. ${f.members} members, influence ${(f.influence * 100).toFixed(0)}%. ` +
    `Ideology: war ${f.ideology.war}, tax ${f.ideology.tax}, faith ${f.ideology.faith}, tech ${f.ideology.tech}.${f.top.length ? ' Prominent: ' + f.top.join(', ') + '.' : ''}`;
}
export function describeLeader(l) {
  if (!l) return 'No ruler.';
  const p = l.policies;
  return `${l.title} ${l.name}, ruling since ${l.since} (${l.how}), legitimacy ${(l.legitimacy * 100).toFixed(0)}%. ${l.bio.slice(-6).join(' ')} ` +
    `Policies: tax ${(p.tax * 100).toFixed(0)}%, war-lust ${p.war}, trade-openness ${p.trade}, piety ${p.faith}, research ${p.research}.`;
}
