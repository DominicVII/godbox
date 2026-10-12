/**
 * godbox-assets.js — procedural low-poly 3D assets for a god-sim (three.js r160, ES module)
 * ======================================================================================
 * No textures: all colour comes from per-vertex colours. Every builder returns an object
 *   { geometry, material, update?(t), animated?: boolean }
 * - geometry: ONE merged, non-indexed BufferGeometry with `position`, `normal`, `color`.
 * - material: a SHARED MeshStandardMaterial (vertexColors, flatShading). Builders reuse it
 *   so many asset types can batch on one material.
 * Use directly:  new THREE.InstancedMesh(a.geometry, a.material, count)
 * Origin of every asset sits on the ground (y = 0), roughly 1 unit = 1 metre.
 *
 * STATIC BUILDERS
 *   buildHouse({ era='hut'|'timber'|'stone'|'brick'|'industrial'|'modern', roofColor, seed })
 *   buildTemple({ color, roofColor })
 *   buildWall({ length=6, height=2.2, color })          wall segment along +X, centred
 *   buildTower({ color })                               round wall tower / corner piece
 *   buildRoad({ length=6, width=2, style='dirt'|'cobble'|'paved' })  along +X, centred
 *   buildFarmPlot({ size=6, crop='wheat'|'cabbage'|'corn', growth=1 })
 *   buildTree({ species='oak'|'pine'|'birch'|'palm'|'willow', snow=false, seed })
 *   TREE_SPECIES, HOUSE_ERAS  (string arrays)
 *
 * ANIMATED BUILDERS (vertex-shader skinning, works with InstancedMesh)
 *   buildHuman({ clothingColor })   -> { geometry, material, update(t), animated:true }
 *   buildSheep(), buildDeer()       -> same shape
 *   createAnimatedInstances(asset, count) -> THREE.InstancedMesh with per-instance attributes
 *   rigDepthMaterial(asset) -> MeshDepthMaterial for mesh.customDepthMaterial (shadows follow the animation)
 *   setInstanceAnim(mesh, i, { state, phase, color })   then mesh.userData.flagAnim()
 *   ANIM = { IDLE:0, WALK:1, PRAY:2, FIGHT:3 }   (animals: IDLE=graze, WALK=walk, 2/3 = run/alert)
 *
 * HOW THE ANIMATION WORKS
 *   Each vertex carries `aPart` (rigid body-part id) and `aPivot` (that part's joint).
 *   A tiny shader injected via onBeforeCompile rotates each part about its pivot using a
 *   shared `uTime` uniform plus per-instance attributes:
 *     iAnim  vec2 (state, phase offset seconds)   iCloth vec3 (clothing / fleece colour)
 *   Vertices with `aTint`=1 take iCloth instead of their vertex colour, so one geometry
 *   [earth patch] aTint=2 (skin) / 3 (hair) vertices take per-instance iSkin / iHair when set via
 *   setInstanceAnim(mesh,i,{skin:'#c8a080', hair:'#222'}); unset (alpha=1) keeps the baked colour.
 *   gives per-instance clothing colours. `clothingColor` in buildHuman is the default
 *   used when no per-instance colour is set. update(t) just writes uTime (shared by all
 *   instances of that material). Normals are rotated too, so lighting stays correct.
 *   Instance matrices (position/heading) are normal InstancedMesh.setMatrixAt.
 *
 * EXAMPLE
 *   const h = buildHuman();
 *   const crowd = createAnimatedInstances(h, 50);
 *   for (let i=0;i<50;i++){ crowd.setMatrixAt(i, m); setInstanceAnim(crowd,i,{state:ANIM.WALK, phase:Math.random()*9, color:0x3355aa}); }
 *   crowd.userData.flagAnim(); scene.add(crowd);   // each frame: h.update(clock.elapsedTime)
 */
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { mergeGeometries } from 'https://unpkg.com/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js';

export const HOUSE_ERAS = ['hut', 'timber', 'stone', 'brick', 'industrial', 'modern'];
export const TREE_SPECIES = ['oak', 'pine', 'birch', 'palm', 'willow'];
export const ANIM = { IDLE: 0, WALK: 1, PRAY: 2, FIGHT: 3 };

// ---------- helpers ----------
function rng(seed = 1) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const _c = new THREE.Color();
/** Prepare a primitive: non-indexed, transformed, coloured, optional rig attributes. */
function P(geo, color, { pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1], part = 0, pivot = [0, 0, 0], tint = 0, jitter = 0, r } = {}) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scl));
  g.applyMatrix4(m);
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i += 3) { // per-face jitter for a hand-made look
    const j = jitter ? 1 + (r() - 0.5) * jitter : 1;
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = _c.r * j; col[(i + k) * 3 + 1] = _c.g * j; col[(i + k) * 3 + 2] = _c.b * j; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.userData.rig = { part, pivot, tint };
  return g;
}
function merge(parts, rigged = false) {
  if (rigged) for (const g of parts) {
    const n = g.attributes.position.count, { part, pivot, tint } = g.userData.rig;
    g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
    const pv = new Float32Array(n * 3); for (let i = 0; i < n; i++) pv.set(pivot, i * 3);
    g.setAttribute('aPivot', new THREE.BufferAttribute(pv, 3));
    g.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(n).fill(tint), 1));
  }
  const out = mergeGeometries(parts, false);
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 6) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r, h, s = 6) => new THREE.ConeGeometry(r, h, s);
const ico = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);

let _staticMat;
/** Shared static material (all static builders return this same instance). */
export function getStaticMaterial() {
  return _staticMat ||= new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.0 });
}
const out = (parts) => ({ geometry: merge(parts), material: getStaticMaterial() });

// gable roof (triangular prism) of width w (x), depth d (z), height h
function gable(w, d, h, over = 0.15) {
  const W = w / 2 + over, D = d / 2 + over;
  const v = [ // two slopes + two gable ends
    -W, 0, D, W, 0, D, 0, h, D,   W, 0, -D, -W, 0, -D, 0, h, -D,
    -W, 0, -D, -W, 0, D, 0, h, D,  -W, 0, -D, 0, h, D, 0, h, -D,
    W, 0, D, W, 0, -D, 0, h, -D,   W, 0, D, 0, h, -D, 0, h, D];
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals(); return g;
}

// ---------- houses ----------
const ERA = {
  hut:        { wall: 0x9a7a52, w: 2.2, d: 2.2, h: 1.3, roof: 0xc9a85a, round: true },
  timber:     { wall: 0xe8dcc0, w: 3, d: 2.4, h: 2.0, roof: 0x8a4b2a, beams: 0x4a2f1c },
  stone:      { wall: 0x9b9890, w: 3.2, d: 2.6, h: 2.2, roof: 0x5a5f6a },
  brick:      { wall: 0xa0442e, w: 3, d: 2.8, h: 4.0, roof: 0x3d3f47, floors: 2 },
  industrial: { wall: 0x7a5040, w: 5, d: 3.4, h: 3.6, roof: 0x55595e, saw: true },
  modern:     { wall: 0xeeeeea, w: 4, d: 3, h: 3.2, roof: 0x333336, flat: true },
};
export function buildHouse({ era = 'timber', roofColor, seed = 1 } = {}) {
  const E = ERA[era] || ERA.timber, r = rng(seed), roof = roofColor ?? E.roof, p = [];
  const { w, d, h } = E, J = { jitter: 0.12, r };
  if (E.round) { // hut: round mud wall + thatched cone
    p.push(P(cyl(1.1, 1.15, h, 9), E.wall, { pos: [0, h / 2, 0], ...J }));
    p.push(P(cone(1.55, 1.6, 9), roof, { pos: [0, h + 0.8, 0], ...J }));
    p.push(P(box(0.5, 0.85, 0.1), 0x3a2618, { pos: [0, 0.42, 1.12] }));
    return out(p);
  }
  p.push(P(box(w, h, d), E.wall, { pos: [0, h / 2, 0], ...J }));
  p.push(P(box(w + 0.1, 0.25, d + 0.1), 0x6b665e, { pos: [0, 0.12, 0] })); // plinth
  // door
  p.push(P(box(0.6, 1.1, 0.08), era === 'modern' ? 0x2b2b30 : 0x4a2f1c, { pos: [era === 'industrial' ? -1.2 : 0, 0.55, d / 2 + 0.03] }));
  // windows
  const winC = era === 'modern' ? 0x7fb7d8 : 0xf3d58a, floors = E.floors || 1;
  for (let f = 0; f < floors; f++) {
    const y = floors > 1 ? 1.1 + f * 1.8 : h * 0.6;
    for (const sx of [-1, 1]) {
      if (era === 'modern') continue;
      p.push(P(box(0.45, 0.5, 0.06), winC, { pos: [sx * w * 0.3, y + (f == 0 && floors > 1 ? 0.2 : 0), d / 2 + 0.03] }));
      p.push(P(box(0.06, 0.5, 0.45), winC, { pos: [w / 2 + 0.03, y, sx * d * 0.25] }));
    }
  }
  if (era === 'modern') { // big glass band
    p.push(P(box(w * 0.55, 1.4, 0.06), winC, { pos: [w * 0.18, h * 0.55, d / 2 + 0.03] }));
    p.push(P(box(0.06, 1.0, d * 0.7), winC, { pos: [w / 2 + 0.03, h * 0.6, 0] }));
    p.push(P(box(w + 0.3, 0.18, d + 0.3), roof, { pos: [0, h + 0.09, 0] }));
    p.push(P(box(w * 0.5, 1.2, d * 0.7), E.wall, { pos: [-w * 0.2, h + 0.7, -0.1] }));
    p.push(P(box(w * 0.5 + 0.2, 0.12, d * 0.7 + 0.2), roof, { pos: [-w * 0.2, h + 1.36, -0.1] }));
    return out(p);
  }
  if (E.beams) { // timber framing
    for (const sx of [-1, 0, 1]) p.push(P(box(0.12, h, 0.06), E.beams, { pos: [sx * (w / 2 - 0.06), h / 2, d / 2 + 0.02] }));
    p.push(P(box(w, 0.12, 0.06), E.beams, { pos: [0, h * 0.95, d / 2 + 0.02] }));
    p.push(P(box(w, 0.12, 0.06), E.beams, { pos: [0, h * 0.42, d / 2 + 0.02] }));
  }
  if (E.saw) { // industrial: saw-tooth roof + smokestack
    for (let i = 0; i < 3; i++) p.push(P(gable(d, w / 3, 0.9, 0.05), roof, { pos: [-w / 2 + w / 6 + i * w / 3, h, 0], rot: [0, Math.PI / 2, 0] }));
    p.push(P(cyl(0.3, 0.4, 4.5, 8), 0x6a3a2c, { pos: [w / 2 - 0.6, h + 1.6, -d / 2 + 0.6], ...J }));
    p.push(P(cyl(0.36, 0.36, 0.25, 8), 0x333333, { pos: [w / 2 - 0.6, h + 3.9, -d / 2 + 0.6] }));
    for (const sx of [-0.3, 0.6]) p.push(P(box(0.9, 1.4, 0.06), 0x8fa9b8, { pos: [sx * w * 0.5, h * 0.55, d / 2 + 0.03] }));
    return out(p);
  }
  p.push(P(gable(w, d, era === 'stone' ? 1.1 : 1.4), roof, { pos: [0, h, 0], ...J }));
  if (era !== 'stone' || r() > 0.3) p.push(P(box(0.35, 1.2, 0.35), era === 'brick' ? 0x7a3322 : 0x77736c, { pos: [w * 0.28, h + 0.9, -d * 0.2] }));
  return out(p);
}

// ---------- temple ----------
export function buildTemple({ color = 0xe9e2cf, roofColor = 0xb0563a } = {}) {
  const p = [], r = rng(7);
  for (let i = 0; i < 3; i++) p.push(P(box(9 - i * 0.6, 0.3, 6 - i * 0.6), 0xcfc7b0, { pos: [0, 0.15 + i * 0.3, 0] }));
  const y0 = 0.9, H = 3.2;
  for (let ix = 0; ix < 6; ix++) for (const z of [-2.3, 2.3]) p.push(P(cyl(0.22, 0.26, H, 8), color, { pos: [-3.5 + ix * 1.4, y0 + H / 2, z], jitter: 0.06, r }));
  for (const x of [-3.5, 3.5]) for (const z of [-0.8, 0.8]) p.push(P(cyl(0.22, 0.26, H, 8), color, { pos: [x, y0 + H / 2, z] }));
  p.push(P(box(5.6, H * 0.9, 3), 0xd8cfb8, { pos: [0, y0 + H * 0.45, 0] })); // cella
  p.push(P(box(0.9, 1.8, 0.05), 0x3b2a1a, { pos: [3.0 - 0.2, y0 + 0.9, 0], rot: [0, Math.PI / 2, 0] }));
  p.push(P(box(8, 0.45, 5.2), color, { pos: [0, y0 + H + 0.22, 0] })); // entablature
  p.push(P(gable(5.2, 8, 1.3, 0.2), roofColor, { pos: [0, y0 + H + 0.45, 0], rot: [0, Math.PI / 2, 0], jitter: 0.08, r }));
  p.push(P(ico(0.35, 0), 0xf2c94c, { pos: [0, y0 + H + 2.0, 0] })); // gold finial
  return out(p);
}

// ---------- walls / towers ----------
export function buildWall({ length = 6, height = 2.2, color = 0x8f8a80 } = {}) {
  const p = [], r = rng(3);
  p.push(P(box(length, height, 0.8), color, { pos: [0, height / 2, 0], jitter: 0.15, r }));
  p.push(P(box(length, 0.12, 1.0), 0x77736a, { pos: [0, height, 0] }));
  const n = Math.max(2, Math.round(length / 0.8));
  for (let i = 0; i < n; i += 2) p.push(P(box(length / n, 0.4, 0.3), color, { pos: [-length / 2 + (i + 0.5) * length / n, height + 0.26, 0.3], jitter: 0.15, r }));
  return out(p);
}
export function buildTower({ color = 0x8f8a80 } = {}) {
  const p = [], r = rng(5);
  p.push(P(cyl(1.1, 1.3, 4, 10), color, { pos: [0, 2, 0], jitter: 0.12, r }));
  p.push(P(cyl(1.3, 1.2, 0.3, 10), 0x77736a, { pos: [0, 4.15, 0] }));
  for (let i = 0; i < 10; i += 2) { const a = i / 10 * Math.PI * 2; p.push(P(box(0.45, 0.45, 0.3), color, { pos: [Math.cos(a) * 1.15, 4.5, Math.sin(a) * 1.15], rot: [0, -a + Math.PI / 2, 0] })); }
  p.push(P(cone(1.0, 1.6, 10), 0x5a3d2b, { pos: [0, 5.2, 0] }));
  return out(p);
}

// ---------- roads ----------
export function buildRoad({ length = 6, width = 2, style = 'cobble' } = {}) {
  const p = [], r = rng(11);
  const base = { dirt: 0x8a6c48, cobble: 0x6f6a62, paved: 0x3c3d40 }[style] ?? 0x8a6c48;
  p.push(P(box(length, 0.06, width), base, { pos: [0, 0.03, 0] }));
  if (style === 'cobble') {
    for (let x = -length / 2 + 0.2; x < length / 2; x += 0.42) for (let z = -width / 2 + 0.22; z < width / 2 - 0.1; z += 0.42)
      p.push(P(box(0.34, 0.06, 0.34), 0x9a958b, { pos: [x + (r() - 0.5) * 0.05, 0.07, z], rot: [0, (r() - 0.5) * 0.3, 0], jitter: 0.3, r }));
  } else if (style === 'paved') {
    for (let x = -length / 2 + 0.5; x < length / 2; x += 1.4) p.push(P(box(0.7, 0.01, 0.1), 0xe8e2c8, { pos: [x, 0.065, 0] }));
    for (const s of [-1, 1]) p.push(P(box(length, 0.14, 0.2), 0xa8a59c, { pos: [0, 0.07, s * (width / 2 + 0.1)] }));
  } else for (const s of [-1, 1]) p.push(P(box(length, 0.02, 0.18), 0x6e5536, { pos: [0, 0.065, s * width * 0.22] }));
  return out(p);
}

// ---------- farm plots ----------
export function buildFarmPlot({ size = 6, crop = 'wheat', growth = 1 } = {}) {
  const p = [], r = rng(13), g = Math.max(0.05, growth);
  p.push(P(box(size, 0.1, size), 0x5e4029, { pos: [0, 0.05, 0] }));
  const rows = Math.round(size / 0.7);
  for (let i = 0; i < rows; i++) {
    const z = -size / 2 + (i + 0.5) * size / rows;
    p.push(P(box(size - 0.3, 0.1, 0.3), 0x7a5536, { pos: [0, 0.12, z], jitter: 0.2, r }));
    for (let x = -size / 2 + 0.35; x < size / 2 - 0.2; x += 0.45) {
      if (crop === 'wheat') p.push(P(cone(0.16, 0.7 * g, 4), 0xd9b64a, { pos: [x, 0.17 + 0.35 * g, z], jitter: 0.25, r }));
      else if (crop === 'corn') { p.push(P(cyl(0.04, 0.05, 1.3 * g, 4), 0x5f8f2e, { pos: [x, 0.17 + 0.65 * g, z] })); p.push(P(cone(0.2, 0.5 * g, 4), 0x7aa83a, { pos: [x, 0.17 + 1.2 * g, z], jitter: 0.25, r })); }
      else p.push(P(ico(0.18 * g + 0.04, 0), 0x6fae4a, { pos: [x, 0.2 + 0.1 * g, z], jitter: 0.3, r }));
    }
  }
  for (const [x, z, w, d] of [[0, size / 2, size, 0.08], [0, -size / 2, size, 0.08], [size / 2, 0, 0.08, size], [-size / 2, 0, 0.08, size]])
    p.push(P(box(w, 0.08, d), 0x6b4a2c, { pos: [x, 0.55, z] }));
  for (const x of [-1, 1]) for (const z of [-1, 1]) p.push(P(box(0.12, 0.7, 0.12), 0x5a3d24, { pos: [x * size / 2, 0.35, z * size / 2] }));
  return out(p);
}

// ---------- trees ----------
export function buildTree({ species = 'oak', snow = false, seed = 1 } = {}) {
  const p = [], r = rng(seed * 31 + 7), J = { jitter: 0.25, r };
  const SNOW = 0xf4f7fb;
  const leaf = c => snow ? new THREE.Color(c).lerp(new THREE.Color(SNOW), 0.75).getHex() : c;
  if (species === 'pine') {
    p.push(P(cyl(0.12, 0.18, 1.2, 5), 0x5a3a22, { pos: [0, 0.6, 0] }));
    for (let i = 0; i < 4; i++) {
      const rr = 1.2 - i * 0.25, y = 1.2 + i * 0.75;
      p.push(P(cone(rr, 1.3, 7), 0x2f5d3a, { pos: [0, y, 0], rot: [0, r() * 3, 0], ...J }));
      if (snow) p.push(P(cone(rr * 0.62, 0.55, 7), SNOW, { pos: [0, y + 0.42, 0], rot: [0, r() * 3, 0], jitter: 0.06, r }));
    }
  } else if (species === 'birch') {
    p.push(P(cyl(0.08, 0.12, 3, 5), 0xe8e6df, { pos: [0, 1.5, 0], jitter: 0.2, r }));
    for (let i = 0; i < 4; i++) p.push(P(box(0.18, 0.06, 0.2), 0x2b2b2b, { pos: [0, 0.5 + i * 0.6, 0.06], rot: [0, i, 0] }));
    for (let i = 0; i < 3; i++) p.push(P(ico(0.7 - i * 0.12, 0), leaf(0x9bc85a), { pos: [(r() - 0.5) * 0.4, 2.6 + i * 0.55, (r() - 0.5) * 0.4], scl: [1, 1.3, 1], ...J }));
  } else if (species === 'palm') {
    const n = 6; let x = 0;
    for (let i = 0; i < n; i++) { x = Math.sin(i / n * 1.3) * 0.5; p.push(P(cyl(0.1, 0.13, 0.62, 5), 0x8a6a42, { pos: [x, 0.3 + i * 0.6, 0], rot: [0, 0, -0.15], jitter: 0.2, r })); }
    const top = [x + 0.08, 3.7, 0];
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; p.push(P(box(1.7, 0.04, 0.38), leaf(0x3f8f3a), { pos: [top[0] + Math.cos(a) * 0.8, top[1] - 0.25, Math.sin(a) * 0.8], rot: [0, -a, -0.45], ...J })); }
    p.push(P(ico(0.22, 0), 0x6b4a2a, { pos: [top[0], top[1] - 0.15, 0] }));
  } else if (species === 'willow') {
    p.push(P(cyl(0.16, 0.26, 2.2, 6), 0x5a432c, { pos: [0, 1.1, 0], jitter: 0.2, r }));
    p.push(P(ico(1.3, 0), leaf(0x7fa34a), { pos: [0, 2.6, 0], scl: [1.2, 0.7, 1.2], ...J }));
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; p.push(P(cone(0.38, 1.7, 4), leaf(0x8fb352), { pos: [Math.cos(a) * 1.15, 1.75, Math.sin(a) * 1.15], rot: [Math.PI, a, 0], ...J })); }
  } else { // oak
    p.push(P(cyl(0.18, 0.28, 1.8, 6), 0x5e4029, { pos: [0, 0.9, 0], jitter: 0.2, r }));
    const blobs = [[0, 2.4, 0, 1.1], [0.7, 2.1, 0.3, 0.75], [-0.6, 2.2, -0.3, 0.8], [0.1, 2.9, -0.4, 0.75], [-0.2, 2.0, 0.65, 0.7]];
    for (const [x, y, z, s] of blobs) {
      p.push(P(ico(s, 0), leaf(0x4f8a35), { pos: [x, y, z], rot: [r(), r(), r()], ...J }));
      if (snow) p.push(P(ico(s * 0.8, 0), SNOW, { pos: [x, y + s * 0.35, z], scl: [1, 0.45, 1], jitter: 0.06, r }));
    }
  }
  if (snow && species !== 'pine' && species !== 'oak') p.push(P(cyl(0.6, 0.7, 0.04, 8), SNOW, { pos: [0, 0.02, 0] }));
  return out(p);
}

// ---------- animated (vertex-shader rig) ----------
/*
 Part ids. Human: 0 torso/root, 1 head, 2 L arm, 3 R arm, 4 L leg, 5 R leg.
 Quadruped:  0 body, 1 head/neck, 4 front-L, 5 front-R, 6 back-L, 7 back-R, 8 tail.
 The shader computes per-part X-axis (pitch) angles from state + time, plus a root bob/lean.
*/
const RIG_GLSL = /* glsl */`
uniform float uTime;
attribute float aPart; attribute vec3 aPivot; attribute float aTint;
attribute vec2 iAnim; attribute vec3 iCloth;
varying float vTint; varying vec3 vCloth;
attribute vec4 iSkin; attribute vec4 iHair; varying vec4 vSkin; varying vec4 vHair; // [earth patch] per-instance skin/hair (a=1: keep vertex colour)
mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }
mat3 rotZ(float a){ float c=cos(a), s=sin(a); return mat3(c,s,0., -s,c,0., 0.,0.,1.); }
// returns rotation for this vertex; root offset in rootOff
mat3 rigRot(out vec3 rootOff, out mat3 rootR){
  float st = floor(iAnim.x + 0.5); float t = uTime + iAnim.y;
  float a = 0.0; float az = 0.0; rootOff = vec3(0.); rootR = mat3(1.);
  int p = int(aPart + 0.5);
  if (RIG_KIND == 0) { // human
    if (st < 0.5) {            // idle: breathe, slight arm sway, glance
      rootOff.y = sin(t*2.0)*0.01;
      if (p==2) a = sin(t*1.3)*0.08; if (p==3) a = -sin(t*1.3)*0.08;
      if (p==1) az = sin(t*0.7)*0.15;
    } else if (st < 1.5) {     // walk
      float w = sin(t*7.0);
      rootOff.y = abs(cos(t*7.0))*0.05;
      if (p==4) a = w*0.6; if (p==5) a = -w*0.6;
      if (p==2) a = -w*0.5; if (p==3) a = w*0.5;
    } else if (st < 2.5) {     // pray: kneel-bow with raised arms, rhythmic
      float b = 0.5+0.5*sin(t*1.6);
      rootR = rotX(0.25 + b*0.35);
      if (p==2 || p==3) a = -2.6 + b*0.4;
      if (p==2) az = -0.25; if (p==3) az = 0.25;
      if (p==4 || p==5) a = 0.0;
    } else {                   // fight: stance + fast right-arm strikes
      float k = fract(t*1.6); float strike = smoothstep(0.0,0.15,k)*(1.0-smoothstep(0.15,0.6,k));
      rootOff.y = abs(sin(t*5.0))*0.03;
      rootR = rotX(0.12);
      if (p==3) a = -1.2 - strike*1.6 + 0.6;
      if (p==2) a = -1.0 + sin(t*3.0)*0.1;
      if (p==4) a = 0.35; if (p==5) a = -0.35;
    }
  } else { // quadruped
    if (st < 0.5) {            // graze
      if (p==1) a = 0.7 + sin(t*1.2)*0.15 + 0.1*sin(t*9.0)*step(0.5,sin(t*0.9));
      if (p==8) az = sin(t*3.0)*0.4;
    } else {                   // walk (1) / run (2) / alert (3)
      float sp = st > 1.5 ? 14.0 : 6.0; float amp = st > 1.5 ? 0.75 : 0.45;
      if (st > 2.5) { sp = 0.0; if (p==1) a = -0.35 + sin(t*0.5)*0.05; if (p==8) a = -0.5; }
      float w = sin(t*sp);
      if (sp > 0.0) {
        rootOff.y = abs(cos(t*sp))*(st>1.5?0.12:0.03);
        if (p==4 || p==7) a = w*amp; if (p==5 || p==6) a = -w*amp;
        if (p==1) a = sin(t*sp*2.0)*0.05;
        if (p==8) az = sin(t*sp)*0.3;
      }
    }
  }
  return rotX(a) * rotZ(az);
}
`;
function rigMaterial(kind) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const uniforms = { uTime: { value: 0 } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n#define RIG_KIND ${kind}\n${RIG_GLSL}`)
      .replace('#include <beginnormal_vertex>', `vec3 rigOff; mat3 rigRootR; mat3 rigR = rigRot(rigOff, rigRootR);
        vec3 objectNormal = rigRootR * (rigR * vec3( normal ));
        #ifdef USE_TANGENT
        vec3 objectTangent = vec3( tangent.xyz );
        #endif`)
      .replace('#include <begin_vertex>', `vec3 transformed = rigRootR * (rigR * (position - aPivot) + aPivot) + rigOff;
        vTint = aTint; vCloth = iCloth; vSkin = iSkin; vHair = iHair;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vTint; varying vec3 vCloth; varying vec4 vSkin; varying vec4 vHair;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n if (vTint < 1.5) diffuseColor.rgb = mix(diffuseColor.rgb, vCloth, vTint); else if (vTint < 2.5) diffuseColor.rgb = mix(diffuseColor.rgb, vSkin.rgb, 1.0 - vSkin.a); else diffuseColor.rgb = mix(diffuseColor.rgb, vHair.rgb, 1.0 - vHair.a);');
  };
  mat.customProgramCacheKey = () => 'godbox-rig-' + kind;
  return { mat, uniforms };
}
function animatedAsset(geometry, kind, defaultCloth) {
  const { mat, uniforms } = rigMaterial(kind);
  return { geometry, material: mat, animated: true, kind, defaultColor: new THREE.Color(defaultCloth), uniforms, update(t) { uniforms.uTime.value = t; } };
}
/** Shadow-map depth material for an animated asset (set as mesh.customDepthMaterial): the shadow moves with the rig. */
export function rigDepthMaterial(asset) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = asset.uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n#define RIG_KIND ${asset.kind}\n${RIG_GLSL}`)
      .replace('#include <begin_vertex>', 'vec3 rigOff; mat3 rigRootR; mat3 rigR = rigRot(rigOff, rigRootR);\n vec3 transformed = rigRootR * (rigR * (position - aPivot) + aPivot) + rigOff;');
  };
  mat.customProgramCacheKey = () => 'godbox-rig-depth-' + asset.kind;
  return mat;
}

/** Make an InstancedMesh for an animated asset (clones geometry to hold per-instance iAnim/iCloth). */
export function createAnimatedInstances(asset, count) {
  const g = asset.geometry.clone();
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
  const cloth = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const dc = asset.defaultColor || new THREE.Color(1, 1, 1);
  for (let i = 0; i < count; i++) { anim.setXY(i, 0, i * 1.7); cloth.setXYZ(i, dc.r, dc.g, dc.b); }
  const skinA = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4), hairA = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  for (let i = 0; i < count; i++) { skinA.setW(i, 1); hairA.setW(i, 1); } // a=1 -> default (baked) colours
  g.setAttribute('iAnim', anim); g.setAttribute('iCloth', cloth); g.setAttribute('iSkin', skinA); g.setAttribute('iHair', hairA);
  const mesh = new THREE.InstancedMesh(g, asset.material, count);
  mesh.frustumCulled = false; // vertex animation moves parts beyond the static bounds
  mesh.userData.flagAnim = () => { anim.needsUpdate = true; cloth.needsUpdate = true; skinA.needsUpdate = true; hairA.needsUpdate = true; };
  return mesh;
}
/** Set per-instance animation state/phase/colour. Call mesh.userData.flagAnim() after a batch. */
export function setInstanceAnim(mesh, i, { state, phase, color, skin, hair } = {}) {
  const a = mesh.geometry.attributes.iAnim, c = mesh.geometry.attributes.iCloth;
  if (state !== undefined) a.setX(i, state);
  if (phase !== undefined) a.setY(i, phase);
  if (color !== undefined) { _c.set(color); c.setXYZ(i, _c.r, _c.g, _c.b); }
  const sa = mesh.geometry.attributes.iSkin, ha = mesh.geometry.attributes.iHair; // [earth patch] optional skin/hair; null resets
  if (skin !== undefined && sa) { if (skin === null) sa.setW(i, 1); else { _c.set(skin); sa.setXYZW(i, _c.r, _c.g, _c.b, 0); } }
  if (hair !== undefined && ha) { if (hair === null) ha.setW(i, 1); else { _c.set(hair); ha.setXYZW(i, _c.r, _c.g, _c.b, 0); } }
}

export function buildHuman({ clothingColor = 0x3b6ea5, skin = 0xe0b48a, hair = 0x3a2a1c } = {}) {
  const p = [], R = (part, pivot, tint = 0) => ({ part, pivot, tint });
  // torso (tinted), belt, head, hair
  p.push(P(box(0.42, 0.55, 0.24), 0xffffff, { pos: [0, 1.12, 0], ...R(0, [0, 0, 0], 1) }));
  p.push(P(box(0.44, 0.07, 0.26), 0x4a3320, { pos: [0, 0.86, 0], ...R(0, [0, 0, 0]) }));
  p.push(P(box(0.24, 0.26, 0.24), skin, { pos: [0, 1.56, 0], ...R(1, [0, 1.42, 0], 2) }));
  p.push(P(box(0.26, 0.08, 0.26), hair, { pos: [0, 1.71, -0.01], ...R(1, [0, 1.42, 0], 3) }));
  p.push(P(box(0.26, 0.18, 0.06), hair, { pos: [0, 1.6, -0.12], ...R(1, [0, 1.42, 0], 3) }));
  for (const [s, id] of [[-1, 2], [1, 3]]) { // arms: sleeve + hand
    const pv = [s * 0.27, 1.36, 0];
    p.push(P(box(0.12, 0.38, 0.13), 0xffffff, { pos: [s * 0.28, 1.17, 0], ...R(id, pv, 1) }));
    p.push(P(box(0.1, 0.16, 0.11), skin, { pos: [s * 0.28, 0.9, 0], ...R(id, pv, 2) }));
  }
  for (const [s, id] of [[-1, 4], [1, 5]]) { // legs + shoes
    const pv = [s * 0.11, 0.84, 0];
    p.push(P(box(0.15, 0.7, 0.16), 0x4b4136, { pos: [s * 0.11, 0.48, 0], ...R(id, pv) }));
    p.push(P(box(0.16, 0.1, 0.24), 0x2a1d12, { pos: [s * 0.11, 0.05, 0.04], ...R(id, pv) }));
  }
  return animatedAsset(merge(p, true), 0, clothingColor);
}

function quadruped({ body, bodyCol, tintBody, legCol, headCol, legLen, neck, head, horns, tail }) {
  const p = [], R = (part, pivot, tint = 0) => ({ part, pivot, tint });
  const [bw, bh, bl] = body, by = legLen + bh / 2;
  if (tintBody) p.push(P(ico(1, 1), 0xffffff, { pos: [0, by, 0], scl: [bw / 2, bh / 2, bl / 2], ...R(0, [0, 0, 0], 1) }));
  else p.push(P(box(bw, bh, bl), bodyCol, { pos: [0, by, 0], ...R(0, [0, 0, 0]) }));
  const hp = [0, by + bh * 0.2, bl / 2 - 0.05]; // neck pivot
  if (neck) p.push(P(box(0.14, neck, 0.16), bodyCol, { pos: [0, hp[1] + neck / 2 - 0.05, hp[2] + 0.05], rot: [0.35, 0, 0], ...R(1, hp) }));
  const hy = hp[1] + (neck || 0) * 0.9, hz = hp[2] + 0.12 + (neck ? 0.15 : 0.08);
  p.push(P(box(...head), headCol, { pos: [0, hy, hz], ...R(1, hp) }));
  for (const s of [-1, 1]) p.push(P(box(0.12, 0.05, 0.06), headCol, { pos: [s * (head[0] / 2 + 0.05), hy + head[1] * 0.3, hz - head[2] * 0.25], ...R(1, hp) }));
  if (horns) for (const s of [-1, 1]) {
    p.push(P(cyl(0.015, 0.025, 0.35, 4), 0xd9c9a3, { pos: [s * 0.07, hy + 0.25, hz - 0.08], rot: [-0.3, 0, s * 0.35], ...R(1, hp) }));
    p.push(P(cyl(0.01, 0.015, 0.16, 4), 0xd9c9a3, { pos: [s * 0.15, hy + 0.36, hz - 0.03], rot: [0.6, 0, s * 0.9], ...R(1, hp) }));
  }
  const legs = [[-1, 1, 4], [1, 1, 5], [-1, -1, 6], [1, -1, 7]];
  for (const [sx, sz, id] of legs) {
    const pv = [sx * bw * 0.3, legLen, sz * bl * 0.36];
    p.push(P(box(0.08, legLen, 0.08), legCol, { pos: [pv[0], legLen / 2, pv[2]], ...R(id, pv) }));
  }
  const tp = [0, by + bh * 0.25, -bl / 2];
  p.push(P(box(...tail.size), tail.col, { pos: [0, tp[1] - tail.size[1] / 2 + 0.03, tp[2] - 0.03], ...R(8, tp) }));
  return merge(p, true);
}
export function buildSheep({ fleeceColor = 0xf2efe6 } = {}) {
  const g = quadruped({ body: [0.6, 0.5, 0.85], tintBody: true, bodyCol: 0x2a2522, legCol: 0x2a2522, headCol: 0x2a2522, legLen: 0.35, neck: 0, head: [0.2, 0.22, 0.28], tail: { size: [0.1, 0.16, 0.08], col: 0xe8e4da } });
  return animatedAsset(g, 1, fleeceColor);
}
export function buildDeer({ coatColor = 0x9a6a3e } = {}) {
  const g = quadruped({ body: [0.42, 0.42, 1.0], tintBody: true, bodyCol: 0x8a5d36, legCol: 0x6e4a2b, headCol: 0x8a5d36, legLen: 0.75, neck: 0.5, head: [0.18, 0.18, 0.34], horns: true, tail: { size: [0.08, 0.14, 0.05], col: 0xf2ece0 } });
  return animatedAsset(g, 1, coatColor);
}
