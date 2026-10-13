// GODBOX law — the true god's commandments, the transgressions the ledger reveals, blood guilt, and judgment.
// Pure ES module (state = {world, civ, soul, ledger, law}). The page performs what needs the world itself
// (a lightning strike, a march into exile) from what sentence() returns.
//
// API
//   COMMANDMENTS, VERDICTS
//   ensureLaw(state) · setCommandment(state, id, on) · proclaim(state, nationId | 'all') -> number told
//   knows(state, pid) · isHoly(state, pid)  (a prophet, priest or chosen one of the true god)
//   check(state, ev) -> transgression events     call for every ledger event; records them, keeps blood guilt
//   cases(state, {open=true}) -> [{offender, name, alive, items[], sev, gravest, knew}]  gravest first
//   sentence(state, offender, verdict, S) -> {ok, message, reply?, kill?, exile?, sick?, avenger?, repented?}
//   tickLaw(state, dt)   blood guilt weighs on the guilty; some confess on their own
import * as LG from './godbox-ledger.js';
import * as M from './godbox-minds.js';

export const COMMANDMENTS = [
  { id: 'murder', text: 'You shall not murder.', sev: 3, on: true },
  { id: 'prophets', text: 'Lay no hand on my prophets, my priests, or my chosen.', sev: 5, on: true },
  { id: 'kin', text: 'Honour your father and mother; raise no hand against your own blood.', sev: 3, on: true },
  { id: 'idols', text: 'You shall have no other gods before me.', sev: 1, on: false },
  { id: 'blasphemy', text: 'You shall not curse my name.', sev: 1, on: false },
  { id: 'falsegods', text: 'Make no god of yourself or of your hands, and speak no lies in my name.', sev: 3, on: false },
  { id: 'conquest', text: 'Take up no sword for conquest.', sev: 2, on: false },
  { id: 'obey', text: 'When I speak to you, heed me.', sev: 1, on: false },
];
const CBY = Object.fromEntries(COMMANDMENTS.map((c) => [c.id, c]));
export const VERDICTS = [
  { id: 'smite', icon: '⚡', name: 'Strike down', hint: 'Death by your lightning, before witnesses.' },
  { id: 'avenger', icon: '🗡', name: 'Raise an avenger', hint: 'One of the victim\'s blood will hunt them — or, if none remains, a zealot of yours.' },
  { id: 'curse', icon: '☠', name: 'Curse', hint: 'Sickness of body and spirit; milk sours where they pass.' },
  { id: 'mark', icon: '🩸', name: 'Mark', hint: 'Like Cain: none may kill them, and everyone turns away.' },
  { id: 'exile', icon: '🚶', name: 'Cast out', hint: 'Driven from their people and their home.' },
  { id: 'plague', icon: '🦠', name: 'Afflict', hint: 'A wasting sickness, on them alone.' },
  { id: 'repent', icon: '🙇', name: 'Call to repent', hint: 'Speak to their conscience. They may bow, or harden.' },
  { id: 'forgive', icon: '🕊', name: 'Forgive', hint: 'Mercy. The book remembers; the debt is lifted.' },
];
const VBY = Object.fromEntries(VERDICTS.map((v) => [v.id, v]));
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const mindOf = (state, id) => state.world?.byId?.get(id) || null;
const yearOf = (state) => state.civ ? state.civ.year : Math.floor((state.world?.t || 0) / 360);
const first = (s) => String(s || '').split(' ')[0];
const pick = (arr, k) => arr[Math.abs(k | 0) % arr.length];

export function ensureLaw(state) {
  if (!state.law) state.law = { v: 1, on: Object.fromEntries(COMMANDMENTS.map((c) => [c.id, c.on])), known: {}, open: {} };
  return state.law;
}
export function setCommandment(state, id, on) { const L = ensureLaw(state); if (CBY[id]) L.on[id] = !!on; return L.on; }
// make the law known: to one nation or to every people. Believers take it to heart; others merely hear it.
export function proclaim(state, nat = 'all') {
  const L = ensureLaw(state), y = yearOf(state); let n = 0;
  const nations = nat === 'all' ? (state.civ?.nations || []).filter((x) => x.alive).map((x) => x.id) : [nat];
  for (const id of nations) L.known[id] = y;
  if (nat === 'all') L.known.all = y;
  for (const m of state.world?.minds || []) {
    if (!m.alive) continue; const p = state.civ?.people?.[m.id];
    if (nat !== 'all' && (!p || p.nat !== nat)) continue;
    m.lawHeard = y; n++;
    M.remember(m, 'heard the law of the god', m.allegiance === 'true' ? 0.6 : 0.2, state.world.t, null, COMMANDMENTS.filter((c) => L.on[c.id]).map((c) => c.text).join(' '));
    if (m.allegiance === 'true') m.faith = clamp(m.faith + 0.02);
  }
  LG.record(state, { type: 'god', nat: nations, d: { text: `You proclaimed your law to ${nat === 'all' ? 'every people' : state.civ?.nations?.[nat]?.name || 'a people'}: ${COMMANDMENTS.filter((c) => L.on[c.id]).map((c) => c.text).join(' ')}` } });
  return n;
}
export function knows(state, pid) {
  const L = ensureLaw(state), m = mindOf(state, pid), p = state.civ?.people?.[pid];
  return !!(m && (m.lawHeard != null || (m.priest && m.allegiance === 'true'))) || !!(p && (L.known[p.nat] != null || L.known.all != null));
}
export function isHoly(state, pid) {
  const m = mindOf(state, pid); if (!m) return false;
  const gifts = new Set((m.soulTraits || []).map((r) => r.id));
  return gifts.has('prophet') || gifts.has('chosen') || (m.priest && m.allegiance === 'true');
}

function openCase(state, ev, law, offender, about, extra = {}) {
  const L = ensureLaw(state); if (!L.on[law] || offender == null || offender === 'god' || !mindOf(state, offender) && !state.civ?.people?.[offender]) return null;
  const C = CBY[law], knew = knows(state, offender);
  const t = LG.record(state, { type: 'transgression', who: [offender], about, cause: ev.id, d: { law, lawText: C.text, sev: C.sev * (knew ? 1.5 : 1), knew, status: 'open', ...extra } });
  (L.open[offender] || (L.open[offender] = [])).push(t.id);
  return t;
}
// the ledger shows a deed; does it break the law?
export function check(state, ev) {
  const out = [], add = (...a) => { const t = openCase(state, ev, ...a); if (t) out.push(t); };
  switch (ev.type) {
    case 'death': {
      const v = ev.who?.[0], k = ev.by; if (k == null || k === 'god' || ev.d?.sanctioned) break;
      const holy = isHoly(state, v), kin = LG.kinOf(state, k, v), war = !!ev.d?.war;
      if (holy) {
        add('prophets', k, v, { holy: true, war });
        LG.record(state, { type: 'martyr', who: [v], by: k, cause: ev.id, d: { god: 'true' } });
      } else if (kin) add('kin', k, v, { kin });
      else if (!war) add('murder', k, v);
      if (!war || holy) { const km = mindOf(state, k); if (km) (km.bloodguilt || (km.bloodguilt = [])).push(v); }
      break;
    }
    case 'attack': { const a = ev.who?.[0], v = ev.about; if (isHoly(state, v)) add('prophets', a, v, { attack: true }); else if (LG.kinOf(state, a, v) === 'parent') add('kin', a, v, { attack: true, kin: 'parent' }); break; }
    case 'conversion': if (ev.d?.to && ev.d.to !== 'true') add('idols', ev.who[0], null, { god: ev.d.to }); break;
    case 'blasphemy': add('blasphemy', ev.who[0], ev.about ?? null); break;
    case 'faith': add('falsegods', ev.who[0], null, { self: !!ev.d?.self, name: ev.d?.name }); break;
    case 'war': if (ev.d?.aggressor != null) add('conquest', ev.d.aggressor, null, { war: ev.d.name }); break;
    case 'defiance': add('obey', ev.who[0], null, { text: ev.d?.text }); break;
  }
  return out;
}

// the docket: everyone with open (or all) transgressions, gravest first
export function cases(state, { open = true, n = 60 } = {}) {
  const L = ensureLaw(state), out = [];
  for (const k in L.open) {
    const items = L.open[k].map((id) => LG.get(state, id)).filter((e) => e && (!open || e.d.status === 'open'));
    if (!items.length) continue;
    const pid = +k, m = mindOf(state, pid), p = state.civ?.people?.[pid];
    const sev = items.reduce((a, e) => a + e.d.sev, 0), gravest = items.slice().sort((a, b) => b.d.sev - a.d.sev)[0];
    out.push({ offender: pid, name: nameOf(state, pid), alive: m ? !!m.alive : p ? p.died == null : false, items, sev, gravest, knew: items.some((e) => e.d.knew) });
  }
  out.sort((a, b) => b.sev - a.sev || b.gravest.id - a.gravest.id);
  return out.slice(0, n);
}
function nameOf(state, id) { const p = state.civ?.people?.[id], m = mindOf(state, id), f = p && state.civ.families?.[p.fam]?.name; return `${m?.name || p?.name || '#' + id}${f ? ' ' + f : ''}`; }

// the victim's nearest blood (child, sibling, spouse, parent), else a zealot of yours among the offender's people
function avengerFor(state, victim, offender) {
  const P = state.civ?.people || {}, alive = (id) => { const m = mindOf(state, id); return m && m.alive && m.age >= 16 && id !== offender ? m : null; };
  if (victim != null) {
    const v = P[victim], vm = mindOf(state, victim), cands = [];
    for (const c of v?.kids || []) cands.push([c, 3]);
    for (const pid of v?.par || []) for (const s of P[pid]?.kids || []) if (s !== victim) cands.push([s, 2]);
    if (vm?.spouse != null) cands.push([vm.spouse, 2]);
    for (const pid of v?.par || []) cands.push([pid, 1]);
    let best = null, bv = -1;
    for (const [id, w] of cands) { const m = alive(id); if (m) { const s = w + m.traits.courage + m.faith * 0.5; if (s > bv) { bv = s; best = id; } } }
    if (best != null) return { id: best, kin: true };
  }
  const nat = P[offender]?.nat; let best = null, bv = -1;
  for (const m of state.world?.minds || []) {
    if (!m.alive || m.id === offender || m.age < 18 || m.allegiance !== 'true' || m.faith < 0.6) continue;
    if (nat != null && P[m.id]?.nat !== nat) continue;
    const s = m.faith + m.traits.courage + m.traits.piety * 0.5; if (s > bv) { bv = s; best = m.id; }
  }
  return best != null ? { id: best, kin: false } : null;
}
const REPENT = ['Forgive me. I did not know what I had become.', 'I hear you. I will carry this all my days.', 'Let me make it right. Tell me how.', 'I am ashamed before you.'];
const HARDEN = ['I owe you nothing.', 'Then strike me. I will not kneel.', 'Where were you when they needed you?', 'Leave me be, voice.'];
function repent(state, m, gravest) {
  const T = m.traits, guilt = (m.bloodguilt?.length || 0) > 0 ? 0.15 : 0;
  const p = clamp(0.15 + m.faith * 0.35 + T.kindness * 0.2 + T.piety * 0.15 + (m.fearOfGod || 0) * 0.2 + guilt - T.stubbornness * 0.25 - (m.wrath || 0) * 0.3 - (m.allegiance && m.allegiance !== 'true' ? 0.15 : 0));
  const k = (m.seed + (state.world?.t | 0)) >>> 0, roll = ((k * 2654435761) >>> 0) / 4294967296;
  if (roll < p) {
    m.faith = clamp(m.faith + 0.15); m.mood = clamp(m.mood + 0.1); m.wrath = 0; m.bloodguilt = null; m.goal = 'faith';
    M.remember(m, 'repented before the god', 0.9, state.world.t, null, gravest?.d.lawText);
    LG.record(state, { type: 'repentance', who: [m.id], cause: gravest?.id, d: { of: gravest?.d.lawText } });
    return { repented: true, reply: pick(REPENT, k), message: `${first(m.name)} repents.` };
  }
  m.wrath = clamp((m.wrath || 0) + 0.25); m.faith = clamp(m.faith - 0.05);
  M.remember(m, 'refused to repent', -0.6, state.world.t);
  LG.record(state, { type: 'defiance', who: [m.id], cause: gravest?.id, d: { text: 'refused to repent' } });
  return { repented: false, reply: pick(HARDEN, k), message: `${first(m.name)} hardens their heart.` };
}

export function sentence(state, offender, verdict, S) {
  const L = ensureLaw(state), m = mindOf(state, offender), V = VBY[verdict];
  if (!V) return { ok: false, message: 'No such judgment.' };
  if (!m) return { ok: false, message: 'Their name is all that remains.' };
  const open = (L.open[offender] || []).map((id) => LG.get(state, id)).filter((e) => e && e.d.status === 'open').sort((a, b) => b.d.sev - a.d.sev);
  const gravest = open[0] || null, nm = first(m.name);
  if (!m.alive && verdict !== 'forgive') return { ok: false, message: `${nm} is already dead. Their deeds stay in the book.` };
  let res = { ok: true, verdict };
  switch (verdict) {
    case 'smite': res.kill = true; res.message = `You strike down ${nm}${gravest ? ' for ' + gravest.d.lawText.toLowerCase().replace(/\.$/, '') : ''}.`; break;
    case 'curse': S?.giveTrait(state, offender, 'cursed', { by: 'judgment' }); res.message = `${nm} is cursed.`; break;
    case 'mark': S?.giveTrait(state, offender, 'marked', { by: 'judgment' }); res.message = `${nm} bears your mark. None may kill them; all will turn away.`; break;
    case 'exile': res.exile = true; res.message = `${nm} is cast out.`; break;
    case 'plague': res.sick = true; res.message = `${nm} sickens.`; break;
    case 'avenger': {
      const av = avengerFor(state, gravest?.about ?? null, offender);
      if (!av) return { ok: false, message: 'No one remains to take up your sword against them.' };
      const am = mindOf(state, av.id); am.avenge = offender; am.avengeBy = 'god'; am.goal = 'revenge';
      const r = am.relations[offender] || (am.relations[offender] = { love: 0, friend: 0, grudge: 0, rival: 0 }); r.grudge = 1; r.friend = 0; r.love = 0;
      M.remember(am, av.kin ? 'called by the god to avenge their blood' : 'called by the god to bring justice', 0.9, state.world.t, offender);
      res.avenger = av.id; res.message = `${first(am.name)}${av.kin ? ', of the victim\'s blood,' : ', a zealot of yours,'} rises to hunt ${nm}.`; break;
    }
    case 'repent': Object.assign(res, repent(state, m, gravest)); break;
    case 'forgive':
      if (m.alive) { m.grace = Math.min(3, (m.grace || 0) + 0.6); m.bloodguilt = null; M.remember(m, 'forgiven by the god', 0.9, state.world.t); if (m.allegiance === 'true') m.faith = clamp(m.faith + 0.08); }
      res.message = `You forgive ${nm}.`; break;
  }
  const close = verdict !== 'repent' || res.repented;
  if (close) for (const e of open) { e.d.status = verdict === 'forgive' ? 'forgiven' : verdict === 'repent' ? 'repented' : 'judged'; e.d.verdict = verdict; }
  res.event = LG.record(state, { type: 'judgment', who: [offender], cause: gravest?.id, d: { verdict: V.name, law: gravest?.d.law, lawText: gravest?.d.lawText } });
  // the victim's kin see justice done (or mercy shown)
  const victim = gravest?.about;
  if (victim != null && verdict !== 'repent') for (const id of kinIds(state, victim)) {
    const k = mindOf(state, id); if (!k || !k.alive || id === offender) continue;
    const w = verdict === 'forgive' ? (k.traits.kindness > 0.6 ? 0.3 : -0.4) : 0.6;
    M.remember(k, verdict === 'forgive' ? 'the god forgave the one who wronged us' : 'justice was done', w, state.world.t, offender);
    if (k.allegiance === 'true') k.faith = clamp(k.faith + (w > 0 ? 0.04 : -0.03)); if (w > 0) k.wrath = clamp((k.wrath || 0) - 0.2);
  }
  return res;
}
function kinIds(state, id) {
  const P = state.civ?.people || {}, p = P[id], m = mindOf(state, id), out = new Set();
  for (const k of p?.kids || []) out.add(k); for (const q of p?.par || []) { out.add(q); for (const s of P[q]?.kids || []) if (s !== id) out.add(s); }
  if (m?.spouse != null) out.add(m.spouse);
  return [...out];
}

// blood guilt weighs on the guilty (less on cruel hearts); now and then one confesses unbidden
export function tickLaw(state, dt = 1) {
  const W = state.world; if (!W) return;
  for (const m of W.minds) {
    if (!m.alive || !m.bloodguilt || !m.bloodguilt.length) continue;
    const T = m.traits, weight = 0.3 + T.kindness * 0.7;
    m.mood = clamp(m.mood - 0.004 * weight * dt);
    if (((m.seed + Math.floor(W.t)) % 97) === 0 && T.kindness > 0.55 && m.faith > 0.45) {
      M.remember(m, 'confessed the killing', 0.5, W.t, m.bloodguilt[m.bloodguilt.length - 1]);
      LG.record(state, { type: 'repentance', who: [m.id], about: m.bloodguilt[m.bloodguilt.length - 1], d: { of: 'blood they shed', unbidden: true } });
      m.bloodguilt = null;
    }
  }
}
