// GODBOX soul panel — the earth page's person inspector, built on godbox-soul.js (layout follows godbox-soul-demo.html).
// Pure DOM; knows nothing about meshes/assets. Host passes: S (soul module), el (container), state() -> {world,civ,soul},
// and callbacks: follow(id), go(id), close(), changed(id) (e.g. after a rename), isFollowing().
// Optional: K (godbox-match, to read hearts and suggest matches) and match(op, a, b) — the host performs the god's act
// (op: 'wed' | 'part' | 'child' | 'reconcile' | 'kindle'), with its dialogs, ceremony and logging.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '\x26amp;', '<': '\x26lt;', '>': '\x26gt;', '"': '\x26quot;' }[c]));
const CSS = `
#soulbox .soul{--gold:#d8b45a;--dim:#a8977a;--line:#4a3a26;font:12.5px/1.45 Georgia,'Palatino Linotype',serif;color:#e9dcc0}
#soulbox .soul h3{margin:8px 0 4px;color:var(--gold);font-size:12px;letter-spacing:1px;font-variant:small-caps}
#soulbox .soul .hd{display:flex;gap:10px;align-items:center}#soulbox .soul canvas{width:56px;height:56px;border-radius:50%;border:2px solid var(--gold);flex:none}
#soulbox .soul .nm{font-size:17px;color:#f4e6c4}#soulbox .soul .sub,#soulbox .soul .k{color:var(--dim)}
#soulbox .soul .think{font-style:italic;color:#f0d9a0;margin-top:6px;border-left:3px solid var(--gold);padding-left:8px}
#soulbox .soul .row{display:flex;gap:4px;margin-top:6px}#soulbox .soul input{flex:1;min-width:0;background:#120d08;color:#e9dcc0;border:1px solid var(--line);border-radius:5px;padding:3px 6px;font:inherit}
#soulbox .soul button{background:#120d08;color:var(--gold);border:1px solid var(--line);border-radius:5px;padding:3px 7px;font:inherit;cursor:pointer}
#soulbox .soul .reply{margin-top:4px;color:#f0d9a0;font-style:italic;min-height:16px}
#soulbox .soul .tabs{display:flex;gap:2px;margin-top:8px;flex-wrap:wrap}#soulbox .soul .tabs button{border-radius:6px 6px 0 0;color:var(--dim);padding:3px 8px}#soulbox .soul .tabs button.on{color:var(--gold);background:#2a2017}
#soulbox .soul .body{border:1px solid var(--line);border-radius:0 6px 6px 6px;padding:6px 8px;background:#1c150e}
#soulbox .soul .bar{height:6px;background:#0007;border-radius:3px;overflow:hidden;margin:2px 0 5px}#soulbox .soul .bar i{display:block;height:100%;background:linear-gradient(90deg,#8a6a2a,#d8b45a)}
#soulbox .soul .badge{display:inline-block;margin:2px;padding:1px 7px;border-radius:10px;border:1px solid var(--line);background:#1a130c;font-size:11.5px}
#soulbox .soul .badge.given{border-color:var(--gold);color:var(--gold)}#soulbox .soul .badge.curse{border-color:#a33;color:#e88}
#soulbox .soul .picker{display:flex;flex-wrap:wrap;gap:2px;max-height:130px;overflow:auto;overscroll-behavior:contain}#soulbox .soul .picker .badge{cursor:pointer}
#soulbox .soul .link{color:#9fc6ff;cursor:pointer}#soulbox .soul .dead{opacity:.55;text-decoration:line-through}
#soulbox .soul .tl{border-left:2px solid var(--line);margin-left:4px;padding-left:10px}#soulbox .soul .tl div{position:relative;margin:3px 0}
#soulbox .soul .tl div:before{content:'';position:absolute;left:-15px;top:6px;width:8px;height:8px;border-radius:50%;background:var(--gold)}
#soulbox .soul .tl .divine:before{background:#b98cff}#soulbox .soul .tl .loss:before,#soulbox .soul .tl .death:before{background:#c44}#soulbox .soul .tl .war:before{background:#e7712d}#soulbox .soul .tl .whisper:before{background:#7fd0ff}
#soulbox .soul .cols{columns:2;font-size:11.5px}
#soulbox .soul .mrow{display:flex;gap:5px;align-items:center;margin:3px 0;padding:2px 5px;border-radius:5px;background:#16100a;border:1px solid #2f2417}
#soulbox .soul .mrow .nmx{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#soulbox .soul .mrow button{padding:1px 6px}
#soulbox .soul .mrow.love{border-color:#6a8a3a}#soulbox .soul .mrow.refused{opacity:.8}#soulbox .soul .tier{cursor:help;font-size:12px}
#soulbox .soul .mbtn{cursor:pointer;margin-left:3px}#soulbox .soul label{font-size:11px;color:var(--dim);cursor:pointer}
#soulbox .soul .tl .marriage:before{background:#ff8fb3}#soulbox .soul .tl .parting:before{background:#8a97a8}
.pray div{font-size:12px;border-bottom:1px dashed #3a2c1b;padding:2px 0}.pray b{color:#d8b45a;cursor:pointer}`;
export function createSoulPanel({ S, K, el, state, follow, go, close, changed, isFollowing, select, match }) {
  if (!document.getElementById('soul-css')) { const st = document.createElement('style'); st.id = 'soul-css'; st.textContent = CSS; document.head.appendChild(st); }
  let id = null, tab = 'Life', last = null, anySex = false;
  const lk = (p) => p ? `<span class="link ${p.alive ? '' : 'dead'}" data-id="${p.id}">${esc(p.name)}</span>` : '—';
  const bar = (l, v) => `<div><span class="k">${esc(l)}</span> ${Math.round(v * 100)}%<div class="bar"><i style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%"></i></div></div>`;
  const badge = (t) => `<span class="badge ${t.given ? 'given' : ''} ${t.category === 'curse' ? 'curse' : ''}" title="${esc(t.description)} (${esc(t.source)})">${t.icon || ''} ${esc(t.name)}${t.given ? ' ✦' : ''}</span>`;
  const first = (n) => String(n || '').split(' ')[0];
  const TIER = { eager: ['💚', 'eager'], consent: ['🟡', 'reluctant'], refuse: ['🔴', 'refuses'] };
  const chip = (s, who) => `<span class="tier ${s.tier}" title="${esc(`${who}: ${TIER[s.tier][1]}${s.why.length ? ' — ' + s.why.join(', ') : ''}\n“${s.reply || ''}”`)}">${TIER[s.tier][0]}</span>`;
  const STATUS = { single: 'Unmarried', widowed: 'Widowed', parted: 'Parted from a spouse', child: 'A child', married: 'Married' };
  function hand(P) {
    if (!K || !P.alive || !match) return '';
    const F = P.family, st = state();
    let h = `<h3>💍 The god's hand</h3>`;
    if (F.status === 'child') return h + '<div class="k">Too young to wed.</div>';
    if (F.status === 'married' && F.spouse) {
      const cur = (F.marriages || []).slice().reverse().find((m) => m.end == null);
      return h + `<div>Wed to ${lk(F.spouse)}${cur ? ` <span class="k">since year ${cur.y}${cur.how === 'decree' ? ', by your decree' : cur.how === 'love' ? ', for love' : ''}</span>` : ''}.</div>
        <div class="row"><button data-m="part" data-b="${F.spouse.id}" title="Release them from their vows">💔 Part them</button><button data-m="child" data-b="${F.spouse.id}" title="A child, the gift of the god">👶 Bless with a child</button><button data-m="kindle" data-b="${F.spouse.id}" title="Remind them why they married">💞 Rekindle</button></div>`;
    }
    let list = []; try { list = K.candidates(st, P.id, { n: 6, sameSex: anySex }); } catch (e) { console.warn('candidates', e); }
    h += `<div class="k">${STATUS[F.status] || ''}. Hearts read — 💚 eager · 🟡 reluctant · 🔴 refuses (hover for why). First this soul, then the match.</div>`;
    h += list.map((c) => `<div class="mrow ${c.outcome}"><span class="nmx"><span class="link" data-id="${c.id}">${esc(first(c.name))}</span> <span class="k">${c.age}${c.sex === 'f' ? '♀' : '♂'} · ${c.pct}%</span></span>${chip(c.a, first(P.identity.name))}${chip(c.b, first(c.name))}<button data-m="wed" data-b="${c.id}" title="Wed them (you will see what each says first)">💍</button><button data-m="kindle" data-b="${c.id}" title="Kindle a spark of love — they decide the rest">💞</button></div>`).join('')
      || '<div class="k">No one suitable and unmarried is near.</div>';
    h += `<label><input type="checkbox" data-any ${anySex ? 'checked' : ''}> include same-sex matches</label> <span class="k" style="font-size:11px">· or pick the 💍 Matchmaker tool and click any two people.</span>`;
    return h;
  }
  const TABS = {
    Life: (P) => `<h3>Identity</h3>${[['Age', P.identity.age], ['Sex', P.identity.sex], ['Nation', P.identity.nation], ['Home town', P.identity.homeTown], ['Work', P.identity.job], ['Standing', P.identity.standing?.text], ['Faction', P.identity.faction || '—'], ['Former names', (P.identity.formerNames || []).join(', ') || '—']].map(([k, v]) => `<div><span class="k">${k}:</span> ${esc(v)}</div>`).join('')}
      <h3>Appearance</h3><div>${esc(P.appearance.text)}</div><div class="k" style="font-size:11px">${esc(P.appearance.genetics)}</div>
      <h3>Daily routine</h3>${(P.routine || []).map((r) => `<div><span class="k">${esc(r.time)}</span> — ${esc(r.activity)}</div>`).join('')}
      <h3>Skills & inventions</h3>${P.skills.map((s) => `<div>${esc(s.name)} <span class="k">(${esc(s.text)})</span></div>`).join('')}${P.inventions.map((i) => `<div>💡 ${esc(i.name)} (${i.year})</div>`).join('') || '<div class="k">No inventions yet.</div>'}
      <h3>Stats</h3><div class="cols">${Object.entries(P.stats || {}).map(([k, v]) => `<div><span class="k">${esc(k)}</span> ${esc(v)}</div>`).join('')}</div>`,
    Family: (P) => { const F = P.family, R = P.relationships, row = (t, a) => `<div><span class="k">${t}:</span> ${a && a.length ? a.map(lk).join(', ') : '—'}</div>`;
      return `<h3>House ${esc(F.house || '')}</h3>${row('Grandparents', F.grandparents)}${row('Parents', F.parents)}${row('Siblings', F.siblings)}${row('Spouse', F.spouse ? [F.spouse] : [])}${row('Children', F.children)}
      <h3>Bonds</h3>${['loves', 'friends', 'rivals', 'grudges'].map((k) => `<div><span class="k">${k}:</span> ${(R[k] || []).slice(0, 5).map((r) => `${lk(r)} <span class="k">${Math.round(r.strength * 100)}%</span>${(k === 'rivals' || k === 'grudges') && r.alive && match && P.alive ? `<span class="mbtn" data-m="reconcile" data-b="${r.id}" title="Ask them to make peace">🤝</span>` : ''}`).join(', ') || '—'}</div>`).join('')}
      ${F.marriages && F.marriages.length > 1 ? `<h3>Marriages</h3>${F.marriages.map((m) => `<div>${lk({ id: m.id, name: m.name, alive: m.alive })} <span class="k">year ${m.y}${m.end != null ? '–' + m.end + (m.endHow === 'widowed' ? ', widowed' : m.endHow === 'parted' ? ', parted' : '') : ', now'}</span></div>`).join('')}` : ''}${hand(P)}`; },
    Mind: (P) => `<h3>Traits</h3><div>${P.personality.traitBadges.map(badge).join('') || '<span class="k">None notable.</span>'}</div>
      <h3>Give or take a trait</h3><div class="picker">${S.listTraits().map((t) => { const has = P.personality.traitBadges.some((b) => b.id === t.id && b.given); return `<span class="badge ${has ? 'given' : ''} ${t.category === 'curse' ? 'curse' : ''}" data-trait="${t.id}" title="${esc(t.category + ': ' + t.description)}">${t.icon} ${esc(t.name)}</span>`; }).join('')}</div>
      <h3>Personality</h3>${P.personality.traits.map((t) => `<div><span class="k">${esc(t.trait)}</span> — ${esc(t.text)}<div class="bar"><i style="width:${t.value * 100}%"></i></div></div>`).join('')}
      <h3>Needs · mood ${esc(P.mood.text)}</h3>${Object.entries(P.needs).map(([k, v]) => bar(k, v)).join('')}
      <h3>Hopes</h3>${P.hopesAndFears.hopes.map((h) => `<div>✧ ${esc(h)}</div>`).join('')}<h3>Fears</h3>${P.hopesAndFears.fears.map((h) => `<div>✗ ${esc(h)}</div>`).join('')}`,
    Faith: (P) => { const B = P.beliefs; return `${bar('Faith in the true god', B.faithInTrueGod)}${bar('Fear of god', B.fearOfGod)}${bar('Grace', Math.min(1, B.grace))}
      <div><span class="k">State:</span> ${esc(B.faithState)}${B.priest ? ' · priest' : ''}</div><div><span class="k">Allegiance:</span> ${esc(B.allegiance)}</div>
      ${B.rivalGod ? `<div><span class="k">Rival god:</span> ${esc(B.rivalGod.name)}, ${esc(B.rivalGod.kind)} of ${esc(B.rivalGod.domain)} (${Math.round(B.rivalGod.devotion * 100)}%)</div>` : ''}
      <div><span class="k">Praying for:</span> ${B.prayer ? esc(B.prayer.text) : '—'}</div>
      <h3>Doubts</h3>${B.doubts.map((d) => `<div>• ${esc(d)}</div>`).join('') || '<div class="k">None.</div>'}
      <h3>Memories</h3>${P.memories.slice(-8).reverse().map((m) => `<div style="font-size:11.5px">${m.weight > 0 ? '☀' : '☁'} ${esc(m.type)}${m.aboutName ? ' — ' + esc(m.aboutName) : ''}${m.text ? ` <i class="k">“${esc(m.text)}”</i>` : ''}</div>`).join('')}`; },
    Timeline: (P) => `<div class="tl">${P.timeline.map((e) => `<div class="${esc(e.type)}"><b>Year ${e.year}</b> <span class="k">${esc(e.type)}</span> — ${esc(e.text)}${e.feeling ? ` <i class="k">(${esc(e.feeling)})</i>` : ''}</div>`).join('')}</div>`,
  };
  el.innerHTML = `<div class="soul"><div class="hd"><canvas width="56" height="56"></canvas><div style="flex:1;min-width:0"><div class="nm"></div><div class="sub"></div></div></div>
   <div class="think"></div>
   <div class="row"><button data-a="follow"></button><button data-a="go">📍 Go to</button><button data-a="close" title="Close — Esc">✕</button></div>
   <div class="row"><input class="wt" maxlength="200" placeholder="Whisper to this soul…" value="Fear not, I am with you."><button data-a="whisper">🕊 Whisper</button></div>
   <div class="row"><input class="rn" maxlength="24" placeholder="new name"><button data-a="rename">Rename</button></div>
   <div class="reply"></div><div class="tabs">${Object.keys(TABS).map((t) => `<button data-tab="${t}">${t}</button>`).join('')}</div><div class="body"></div></div>`;
  const q = (s) => el.querySelector(s);
  for (const i of el.querySelectorAll('input')) { i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') act(i.classList.contains('wt') ? 'whisper' : 'rename'); if (e.key === 'Escape') i.blur(); }); }
  function portrait(P) {
    const c = q('canvas').getContext('2d'), col = P.appearance.colors || { skin: '#c8a27a', hair: '#4a3020', eyes: '#333' };
    c.fillStyle = '#1a130c'; c.fillRect(0, 0, 56, 56); c.fillStyle = col.hair; c.beginPath(); c.arc(28, 26, 18, Math.PI, 0); c.fill();
    c.fillStyle = col.skin; c.beginPath(); c.ellipse(28, 30, 13.5, 16.5, 0, 0, 7); c.fill(); c.fillStyle = col.eyes; c.fillRect(22, 28, 3, 2); c.fillRect(31, 28, 3, 2); c.fillStyle = '#7a3d2a'; c.fillRect(24, 38, 8, 2);
  }
  function render(P) {
    if (!P) return false; last = P;
    q('.nm').textContent = P.identity.name + (P.alive ? '' : ' ✝');
    q('.sub').textContent = `${P.identity.age}, ${P.identity.sex} · ${P.identity.job} of ${P.identity.homeTown}, ${P.identity.nation} · ${P.identity.standing?.text || ''}`;
    portrait(P); const fb = q('[data-a=follow]'); fb.style.display = P.alive ? '' : 'none'; fb.textContent = isFollowing() ? '⏹ Stop following' : '🎥 Follow (F)';
    q('.wt').disabled = !P.alive;
    el.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const body = q('.body'), sc = body.scrollTop, pk = body.querySelector('.picker'), psc = pk ? pk.scrollTop : 0;
    body.innerHTML = TABS[tab](P); body.scrollTop = sc; const pk2 = body.querySelector('.picker'); if (pk2) pk2.scrollTop = psc;
    return true;
  }
  function refresh(withThought) {
    if (id == null) return; let P = null; try { P = S.inspectPerson(state(), id); } catch (e) { console.warn('inspectPerson', e); }
    if (!render(P)) return; if (withThought) q('.think').textContent = '“' + S.listenTo(state(), id) + '”';
  }
  function open(pid) { if (pid !== id) { q('.reply').textContent = ''; q('.rn').value = ''; } id = pid; refresh(true); return !!last; }
  function act(a) {
    const st = state(), say = (s) => (q('.reply').textContent = s);
    if (a === 'whisper') { const r = S.whisper(st, id, q('.wt').value); say(r.ok ? `(${r.reaction}) “${r.reply}”` : r.message); refresh(true); }
    else if (a === 'rename') { const r = S.renamePerson(st, id, q('.rn').value); say(r.ok ? `${r.message} ${r.reaction}` : r.message); if (r.ok) { q('.rn').value = ''; changed && changed(id, r); } refresh(true); }
    else if (a === 'follow') { follow(id); refresh(); } else if (a === 'go') go(id); else if (a === 'close') close();
  }
  el.addEventListener('change', (e) => { if (e.target.matches('[data-any]')) { anySex = e.target.checked; refresh(); } });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'), t = e.target.closest('[data-tab]'), tr = e.target.closest('[data-trait]'), lid = e.target.closest('[data-id]'), mb = e.target.closest('[data-m]');
    if (mb) { if (match) Promise.resolve(match(mb.dataset.m, id, +mb.dataset.b)).catch((err) => console.warn('match', err)).finally(() => refresh(true)); }
    else if (b) act(b.dataset.a);
    else if (t) { tab = t.dataset.tab; q('.body').scrollTop = 0; refresh(); }
    else if (tr) { const has = S.personTraits(state(), id).includes(tr.dataset.trait); const r = has ? S.removeTrait(state(), id, tr.dataset.trait) : S.giveTrait(state(), id, tr.dataset.trait); q('.reply').textContent = r.message || ''; refresh(true); }
    else if (lid && select) select(+lid.dataset.id);
  });
  return { open, refresh, get id() { return id; }, clear() { id = null; last = null; }, get tab() { return tab; }, setTab(t) { if (TABS[t]) { tab = t; refresh(); } }, say(text) { q('.reply').textContent = text; } };
}
export function prayerFeed(S, st, n = 12) {
  let L = []; try { L = S.recentPrayers(st, n); } catch (e) { }
  return L.map((p) => `<div><b data-pid="${p.id}">${esc(p.name)}</b> <span style="opacity:.6">to ${esc(p.to)}</span><br>“${esc(p.text)}”</div>`).join('') || '<div style="opacity:.6">The sky is quiet.</div>';
}
