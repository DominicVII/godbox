// GODBOX ledger — the god's book. Every death and birth, wedding, grudge and feud, war, conversion, blasphemy, sermon,
// act of the god and judgment: who did it, to whom, where, and what came of it (cause links run both ways).
// Pure ES module, no deps. Plain JSON state in state.ledger (state = {world, civ, soul, ...}).
//
// API
//   ensureLedger(state) -> L
//   record(state, e) -> event     e: {type, who:[ids], by?, about?, nat?:[nationIds], cause?:eventId, d?:{...}, at?:[x,y]}
//                                 stamps id, t (day) and yr; indexes it by every person named; links it to its cause
//   get(state, id) · eventsOf(state, pid, n?) · consequences(state, id, depth?) · causes(state, id)
//   range(state, y0, y1, types?) · latest(state, n, types?) · lastDeathOf(state, pid)
//   describe(state, e) -> text (names as they are now) · TYPES (icon and label per type)
//   kinOf(state, a, b) -> 'parent'|'child'|'sibling'|'spouse'|null
//   serialize(L) / deserialize(o)
// Sources: godbox-civ (deaths with killer and cause, births, weddings, feuds, wars, rulers, secessions) and
// godbox-minds (conversions, grudges, vows of vengeance, sermons, blasphemy, new faiths) emit through world._hook /
// civ._hook; the page adds the god's acts, judgments, resurrections and saints.

const MAX_EV = 60000, DROP = 6000, PER_P = 400;
// kept when the book is trimmed: the god's own acts and what the god will want to find again
const KEEP = new Set(['transgression', 'judgment', 'resurrection', 'saint', 'faith', 'god', 'war', 'peace', 'martyr', 'kinstrife', 'ruler', 'secession']);

export const TYPES = {
  birth: ['👶', 'birth'], death: ['✝', 'death'], marriage: ['💍', 'marriage'], grudge: ['💢', 'grudge'], feud: ['⚔', 'feud between houses'],
  vow: ['🩸', 'vow of vengeance'], vengeance: ['🗡', 'vengeance'], attack: ['👊', 'attack'], war: ['🔥', 'war'], peace: ['🕊', 'peace'],
  ruler: ['👑', 'new ruler'], secession: ['🏴', 'secession'], kinstrife: ['🪓', 'brother against brother'], conversion: ['⛩', 'change of faith'],
  prophet: ['📣', 'a prophet rises'], faith: ['🜂', 'a new faith'], blasphemy: ['🗯', 'blasphemy'], debate: ['🗣', 'debate'], sermon: ['📜', 'sermon'],
  god: ['✦', 'act of the god'], whisper: ['🕊', 'the god spoke'], defiance: ['✋', 'defied the god'], repentance: ['🙇', 'repentance'],
  transgression: ['⚖', 'transgression'], judgment: ['⚡', 'judgment'], martyr: ['🕯', 'martyrdom'], resurrection: ['🌅', 'raised from the dead'],
  saint: ['😇', 'made a saint'], exile: ['🚶', 'exile'], miracle: ['✨', 'miracle'],
};

export function ensureLedger(state) {
  if (!state.ledger) state.ledger = { v: 1, next: 1, ev: [], by: {}, kids: {}, lastDeath: {} };
  return state.ledger;
}
const yearOf = (state) => state.civ ? state.civ.year : Math.floor((state.world?.t || 0) / 360);
const nowT = (state) => state.civ ? state.civ.t : state.world?.t || 0;

export function record(state, e) {
  const L = ensureLedger(state);
  const ev = { id: L.next++, t: Math.round(nowT(state) * 10) / 10, yr: yearOf(state), type: e.type };
  for (const k of ['who', 'by', 'about', 'nat', 'cause', 'd', 'at']) if (e[k] != null && !(Array.isArray(e[k]) && !e[k].length)) ev[k] = e[k];
  if (ev.who && !Array.isArray(ev.who)) ev.who = [ev.who];
  L.ev.push(ev);
  const idx = (pid) => { if (pid == null || typeof pid !== 'number') return; const a = L.by[pid] || (L.by[pid] = []); if (a[a.length - 1] !== ev.id) a.push(ev.id); if (a.length > PER_P) a.splice(0, a.length - PER_P); };
  for (const p of ev.who || []) idx(p); idx(ev.by); idx(ev.about);
  if (ev.cause != null) (L.kids[ev.cause] || (L.kids[ev.cause] = [])).push(ev.id);
  if (ev.type === 'death' && ev.who) L.lastDeath[ev.who[0]] = ev.id;
  if (L.ev.length > MAX_EV) trim(L);
  return ev;
}
function trim(L) {
  const out = [], drop = new Set(); let n = 0;
  for (const e of L.ev) { if (n < DROP && !KEEP.has(e.type)) { drop.add(e.id); n++; } else out.push(e); }
  L.ev = out;
  for (const k in L.by) { L.by[k] = L.by[k].filter((id) => !drop.has(id)); if (!L.by[k].length) delete L.by[k]; }
  for (const k in L.kids) { if (drop.has(+k)) { delete L.kids[k]; continue; } L.kids[k] = L.kids[k].filter((id) => !drop.has(id)); }
  for (const k in L.lastDeath) if (drop.has(L.lastDeath[k])) delete L.lastDeath[k];
}
export function get(state, id) { // ids ascend with position: binary search
  const a = ensureLedger(state).ev; let lo = 0, hi = a.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1, v = a[mid].id; if (v === id) return a[mid]; if (v < id) lo = mid + 1; else hi = mid - 1; }
  return null;
}
export function eventsOf(state, pid, n = 200) { const L = ensureLedger(state); return (L.by[pid] || []).slice(-n).map((id) => get(state, id)).filter(Boolean); }
export function lastDeathOf(state, pid) { const id = ensureLedger(state).lastDeath[pid]; return id ? get(state, id) : null; }
// what came of an event: its consequences, and theirs, to `depth` steps
export function consequences(state, id, depth = 3) {
  const L = ensureLedger(state), out = [], seen = new Set([id]);
  let layer = [id];
  for (let d = 0; d < depth && layer.length; d++) {
    const next = [];
    for (const x of layer) for (const k of L.kids[x] || []) if (!seen.has(k)) { seen.add(k); const e = get(state, k); if (e) { out.push({ e, depth: d + 1 }); next.push(k); } }
    layer = next;
  }
  return out;
}
// what led to an event, back along its causes
export function causes(state, id, depth = 12) {
  const out = []; let e = get(state, id), seen = new Set();
  while (e && e.cause != null && depth-- > 0 && !seen.has(e.cause)) { seen.add(e.cause); e = get(state, e.cause); if (e) out.push(e); }
  return out;
}
export function range(state, y0, y1, types) {
  const ts = types ? new Set(types) : null;
  return ensureLedger(state).ev.filter((e) => e.yr >= y0 && e.yr <= y1 && (!ts || ts.has(e.type)));
}
export function latest(state, n = 50, types) {
  const ts = types ? new Set(types) : null, a = ensureLedger(state).ev, out = [];
  for (let i = a.length - 1; i >= 0 && out.length < n; i--) if (!ts || ts.has(a[i].type)) out.push(a[i]);
  return out;
}

// ---------- kinship ----------
export function kinOf(state, a, b) {
  const P = state.civ?.people, pa = P?.[a], pb = P?.[b];
  const ma = state.world?.byId?.get(a);
  if (ma && ma.spouse === b) return 'spouse';
  if (!pa || !pb) return ma?.relations?.[b]?.kin ? 'kin' : null;
  if (pa.par.includes(b)) return 'parent';
  if (pb.par.includes(a)) return 'child';
  if (pa.par.length && pa.par.some((x) => pb.par.includes(x))) return 'sibling';
  return ma?.relations?.[b]?.kin ? 'kin' : null;
}

// ---------- reading the book ----------
const nm = (state, id) => {
  if (id == null) return 'someone'; if (id === 'god') return 'you';
  const p = state.civ?.people?.[id], m = state.world?.byId?.get(id);
  const fam = p && state.civ.families?.[p.fam]?.name;
  const base = m?.name || p?.name; return base ? `${base}${fam ? ' ' + fam : ''}` : `#${id}`;
};
const natNm = (state, i) => state.civ?.nations?.[i]?.name || 'a nation';
const godNm = (state, g) => !g ? 'no god' : g === 'true' ? 'you' : state.world?.gods?.find((x) => x.id === g)?.name || g;
export function describe(state, e) {
  const W = (i = 0) => nm(state, e.who?.[i]), B = nm(state, e.by), A = nm(state, e.about), d = e.d || {};
  switch (e.type) {
    case 'birth': return `${W()} was born${d.par ? ' to ' + d.par.map((p) => nm(state, p)).join(' and ') : ''}.`;
    case 'death': return `${W()} died — ${d.cause || 'unknown causes'}${e.by != null && e.by !== 'god' && !/ by /.test(d.cause || '') ? ', at the hand of ' + B : ''}.`;
    case 'marriage': return `${W(0)} and ${W(1)} were married${d.love ? ' for love' : ', a match the families made'}.`;
    case 'grudge': return `${W()} came to hate ${A}${d.why ? ' — ' + d.why : ''}.`;
    case 'feud': return `The houses of ${d.fa || '?'} and ${d.fb || '?'} are at feud${e.who ? ' (' + W(0) + ' and ' + W(1) + ')' : ''}.`;
    case 'vow': return `${W()} swore vengeance on ${A} for ${nm(state, d.for)}.`;
    case 'vengeance': return `${W()} took vengeance on ${A}${d.for != null ? ' for ' + nm(state, d.for) : ''}.`;
    case 'attack': return `${W()} attacked ${A}${d.why ? ' (' + d.why + ')' : ''}.`;
    case 'war': return `${d.name || 'War'}: ${natNm(state, e.nat?.[0])} against ${natNm(state, e.nat?.[1])}${d.cause ? ' — ' + d.cause : ''}.`;
    case 'peace': return `Peace between ${natNm(state, e.nat?.[0])} and ${natNm(state, e.nat?.[1])}${d.text ? ' — ' + d.text : ''}.`;
    case 'ruler': return `${W()} rules ${natNm(state, e.nat?.[0])}${d.how ? ' (' + d.how + ')' : ''}.`;
    case 'secession': return `${natNm(state, e.nat?.[1])} broke away from ${natNm(state, e.nat?.[0])}.`;
    case 'kinstrife': return `Blood against blood: ${W(0)} and ${W(1)} (${d.kin || 'kin'}) ${d.how || 'stand on opposite sides'}.`;
    case 'conversion': return `${W()} turned ${d.to ? 'to ' + godNm(state, d.to) : 'from every god'}${d.from ? ', leaving ' + godNm(state, d.from) : ''}.`;
    case 'prophet': return `${W()} began to preach for ${godNm(state, d.god)}.`;
    case 'faith': return d.self ? `${W()} proclaimed ${state.world?.byId?.get(e.who?.[0])?.sex === 'f' ? 'herself' : 'himself'} a god: "${d.name}".` : `${W()} founded a faith: ${d.name}${d.domain ? ', of ' + d.domain : ''}.`;
    case 'blasphemy': return `${W()} cursed your name${e.about != null ? ' before ' + A : ''}${d.words ? ': "' + d.words + '"' : ''}.`;
    case 'debate': return `${W(0)} and ${W(1)} debated ${d.motion || 'the gods'}; ${d.winner != null ? nm(state, d.winner) + ' carried the crowd' : 'neither yielded'}.`;
    case 'sermon': return `${W()} preached ${d.god ? 'for ' + godNm(state, d.god) : ''}${d.n ? ' to ' + d.n : ''}.`;
    case 'god': return d.text || 'You acted.';
    case 'whisper': return `You spoke to ${W()}: "${d.text || ''}"${d.reaction ? ' — ' + d.reaction : ''}.`;
    case 'defiance': return `${W()} refused your word${d.text ? ': "' + d.text + '"' : ''}.`;
    case 'repentance': return `${W()} repented${d.of ? ' of ' + d.of : ''}.`;
    case 'transgression': return `${W()} broke your law — ${d.lawText || d.law}${e.about != null ? ' (against ' + A + ')' : ''}${d.knew ? ', knowing it' : ''}.`;
    case 'judgment': return `You judged ${W()}: ${d.verdict}${d.law ? ' for ' + (d.lawText || d.law) : ''}.`;
    case 'martyr': return `${W()} died a martyr${d.god ? ' for ' + godNm(state, d.god) : ''}${e.by != null ? ', killed by ' + B : ''}.`;
    case 'resurrection': return `You raised ${W()} from the dead.`;
    case 'saint': return `You made ${W()} a saint.`;
    case 'exile': return `${W()} was cast out${d.from != null ? ' of ' + natNm(state, d.from) : ''}.`;
    case 'miracle': return d.text || `A miracle.`;
    default: return d.text || e.type;
  }
}

export function serialize(L) { return L ? JSON.parse(JSON.stringify(L)) : null; }
export function deserialize(o) { const L = o && o.ev ? o : null; if (L) { L.by ||= {}; L.kids ||= {}; L.lastDeath ||= {}; } return L; }
