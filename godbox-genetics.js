/**
 * godbox-genetics.js — compact diploid genomes for godbox-civ.js (pure ES module, no deps)
 * =======================================================================================
 * A genome is a string of LOCI.length*2 chars '0'/'1' (two biallelic alleles per locus, diploid).
 * Allele '1' raises the quantitative score of that locus group (additive), except:
 *   eye   : '1' = brown allele, dominant over '0' (blue)            (Mendelian dominance)
 *   red   : '1' = red-hair allele, recessive (only 11 shows)
 *   dis   : '1' = a recessive heritable disease ("wasting sickness"); homozygous 11 lowers health a lot
 * Groups: skin(3 loci) hair(2) red(1) eye(1) height(3) build(2) intel(3) strength(2) longevity(2) resist(3) dis(1)
 *         + one locus per minds trait (piety courage sociability ambition kindness stubbornness curiosity temper diligence)
 * API
 *   LOCI, GROUPS
 *   randomGenome(rng, freqs?)          freqs = per-locus allele-'1' frequency (a population's gene pool)
 *   regionalFreqs(rng, spread=0.25)    a founding population's gene pool (regions start apart, drift further)
 *   inherit(g1, g2, rng, mu=0.002)     Mendelian: one random allele per parent per locus (independent assortment), mutation mu
 *   score(g, group) -> 0..1            mean allele dosage for the group
 *   phenotype(g)    -> {skin, hair, eye, heightCm, build, intel, strength, longevity, resist, disease:boolean}
 *   nudgeTraits(traits, g, w=0.3)      genes NUDGE minds traits: trait = (1-w)*trait + w*geneScore (environment keeps 1-w)
 *   appearance(g, extra?) -> {skinColor, hairColor, eyeColor, height, build, ...extra}   params for a renderer's buildHuman()
 *   alleleFreq(genomes, locusIdx) / groupFreq(genomes, group)
 *   describeGenome(g) -> string
 */
const TR = ['piety', 'courage', 'sociability', 'ambition', 'kindness', 'stubbornness', 'curiosity', 'temper', 'diligence'];
const G = [['skin', 3], ['hair', 2], ['red', 1], ['eye', 1], ['height', 3], ['build', 2], ['intel', 3], ['strength', 2], ['longevity', 2], ['resist', 3], ['dis', 1], ...TR.map((t) => [t, 1])];
export const LOCI = []; export const GROUPS = {};
for (const [n, k] of G) { GROUPS[n] = []; for (let i = 0; i < k; i++) { GROUPS[n].push(LOCI.length); LOCI.push(n + i); } }
const L = LOCI.length;
const BASE = { red: 0.15, dis: 0.06, resist: 0.3 };
export function regionalFreqs(rng, spread = 0.25) {
  const f = [];
  for (let i = 0; i < L; i++) { const g = LOCI[i].replace(/\d+$/, ''); const b = BASE[g] ?? 0.5; f.push(Math.min(0.97, Math.max(0.03, b + (rng() - 0.5) * 2 * spread * (BASE[g] != null ? 0.5 : 1)))); }
  return f;
}
export function randomGenome(rng, freqs) {
  let s = ''; for (let i = 0; i < L; i++) { const p = freqs ? freqs[i] : 0.5; s += (rng() < p ? '1' : '0') + (rng() < p ? '1' : '0'); } return s;
}
export function inherit(a, b, rng, mu = 0.002) {
  let s = '';
  for (let i = 0; i < L; i++) {
    let x = a[2 * i + (rng() < 0.5 ? 1 : 0)], y = b[2 * i + (rng() < 0.5 ? 1 : 0)];
    if (rng() < mu) x = x === '1' ? '0' : '1'; if (rng() < mu) y = y === '1' ? '0' : '1';
    s += x + y;
  }
  return s;
}
export function score(g, group) { const ix = GROUPS[group]; let s = 0; for (const i of ix) s += (g[2 * i] === '1') + (g[2 * i + 1] === '1'); return s / (2 * ix.length); }
const hom = (g, group) => { const i = GROUPS[group][0]; return g[2 * i] === '1' && g[2 * i + 1] === '1'; };
const any = (g, group) => { const i = GROUPS[group][0]; return g[2 * i] === '1' || g[2 * i + 1] === '1'; };
export function phenotype(g) {
  return { skin: score(g, 'skin'), hair: hom(g, 'red') ? 'red' : ['blond', 'light brown', 'brown', 'dark brown', 'black'][Math.round(score(g, 'hair') * 4)],
    eye: any(g, 'eye') ? 'brown' : 'blue', heightCm: Math.round(150 + score(g, 'height') * 40), build: ['slight', 'lean', 'average', 'sturdy', 'broad'][Math.round(score(g, 'build') * 4)],
    intel: score(g, 'intel'), strength: score(g, 'strength'), longevity: score(g, 'longevity'), resist: score(g, 'resist'), disease: hom(g, 'dis') };
}
export function nudgeTraits(traits, g, w = 0.3) { for (const t of TR) if (traits[t] != null) traits[t] = +((1 - w) * traits[t] + w * score(g, t)).toFixed(4); return traits; }
const lerpC = (a, b, t) => '#' + [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t).toString(16).padStart(2, '0')).join('');
const HAIRC = { blond: '#e3c16f', 'light brown': '#a7744a', brown: '#6b4428', 'dark brown': '#3d2614', black: '#151010', red: '#b5462a' };
export function appearance(g, extra = {}) {
  const p = phenotype(g);
  return { skinColor: lerpC([246, 222, 200], [74, 46, 30], p.skin), hairColor: HAIRC[p.hair], eyeColor: p.eye === 'brown' ? '#5a3a1e' : '#4f86c6',
    height: +(p.heightCm / 170).toFixed(3), build: p.build, ...extra };
}
export function alleleFreq(gs, i) { let s = 0, n = 0; for (const g of gs) { s += (g[2 * i] === '1') + (g[2 * i + 1] === '1'); n += 2; } return n ? s / n : 0; }
export function groupFreq(gs, group) { let s = 0; for (const i of GROUPS[group]) s += alleleFreq(gs, i); return s / GROUPS[group].length; }
export function describeGenome(g) {
  const p = phenotype(g), pct = (v) => (v * 100).toFixed(0) + '%';
  const carrier = !p.disease && any(g, 'dis');
  return `${p.heightCm} cm, ${p.build} build, ${p.hair} hair, ${p.eye} eyes, skin tone ${pct(p.skin)}. Heritable leanings: intellect ${pct(p.intel)}, strength ${pct(p.strength)}, ` +
    `longevity ${pct(p.longevity)}, plague resistance ${pct(p.resist)}.${p.disease ? ' Has inherited wasting sickness (two recessive copies).' : carrier ? ' Silent carrier of wasting sickness.' : ''}` +
    ` Personality genes: ${TR.map((t) => t.slice(0, 4) + ' ' + pct(score(g, t))).join(', ')}.`;
}
