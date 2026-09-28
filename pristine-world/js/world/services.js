// SERVICES department of Pristine Home Services.
//  Part A: the services wall inside the garage (left wall x = -3.6): workbench, pegboard with
//          tools (each a service), lawn mower, paver pallet and a wheelie bin.
//  Part B: the 20-yard roll-off dumpster on the driveway, heaped with junk where every piece
//          is one of the services.
// Everything is procedural: rounded / lathed / swept / extruded geometry and canvas textures.
// Parts that share a material are merged per hotspot to keep draw calls low.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PI = Math.PI;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const V2 = (x, y) => new THREE.Vector2(x, y);

// ---------------------------------------------------------------- math helpers
function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, order = 'XYZ') {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, order));
  const sc = Array.isArray(s) ? V(...s) : V(s, s, s);
  return new THREE.Matrix4().compose(V(x, y, z), q, sc);
}
function hash3(x, y, z, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, z, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  const h = (i, j, k) => hash3(xi + i, yi + j, zi + k, s);
  return L(L(L(h(0, 0, 0), h(1, 0, 0), u), L(h(0, 1, 0), h(1, 1, 0), u), v),
           L(L(h(0, 0, 1), h(1, 0, 1), u), L(h(0, 1, 1), h(1, 1, 1), u), v), w);
}
const fbm = (x, y, z, s = 0) => vnoise(x, y, z, s) * 0.57 + vnoise(x * 2.1, y * 2.1, z * 2.1, s + 1) * 0.29 + vnoise(x * 4.3, y * 4.3, z * 4.3, s + 2) * 0.14;

// ---------------------------------------------------------------- geometry helpers
const rbox = (w, h, d, r = 0.01, seg = 2) =>
  new RoundedBoxGeometry(w, h, d, seg, Math.max(0.0006, Math.min(r, Math.min(w, h, d) / 2 - 0.0003)));
const cyl = (rt, rb, h, seg = 16, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const lathe = (pts, seg = 24) => new THREE.LatheGeometry(pts.map((p) => V2(p[0], p[1])), seg);
const curve = (pts, closed = false) => new THREE.CatmullRomCurve3(pts.map((p) => V(...p)), closed, 'catmullrom', 0.5);
const tube = (pts, r, seg = 32, rad = 8, closed = false) => new THREE.TubeGeometry(curve(pts, closed), seg, r, rad, closed);

// A tapered cylinder spanning two points.
function segCyl(a, b, r0, r1, rad = 7) {
  const A = V(...a), d = V(...b).sub(A);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, rad, 1, false);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
  g.translate(A.x, A.y, A.z);
  return g;
}

// Planar UVs normalised to the geometry's bounds on two axes.
function planarUV(g, au = 'x', av = 'y') {
  g.computeBoundingBox();
  const b = g.boundingBox, p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const k = { x: 0, y: 1, z: 2 };
  const get = (i, a) => p.array[i * 3 + k[a]];
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = (get(i, au) - b.min[au]) / (b.max[au] - b.min[au] || 1);
    uv[i * 2 + 1] = (get(i, av) - b.min[av]) / (b.max[av] - b.min[av] || 1);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
// Box projection by dominant normal axis: u,v in "meters * scale".
function boxUV(g, su = 1, sv = su, ou = 0, ov = 0) {
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) { u = z; v = y; } else if (az >= ay) { u = x; v = y; } else { u = x; v = z; }
    uv[i * 2] = u * su + ou; uv[i * 2 + 1] = v * sv + ov;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
// Displace along normals with fbm noise (lumpy upholstery, bags).
function lumpify(g, amp, freq, seed = 0, fn) {
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let d = (fbm(x * freq + 11, y * freq + 7, z * freq + 3, seed) - 0.5) * 2 * amp;
    if (fn) d += fn(x, y, z);
    p.setXYZ(i, x + n.getX(i) * d, y + n.getY(i) * d, z + n.getZ(i) * d);
  }
  p.needsUpdate = true;
  return g;
}
// Recompute smooth normals, welding vertices that share a position (works for non-indexed).
function smoothNormals(g) {
  const p = g.attributes.position, idx = g.index;
  const keys = new Array(p.count), acc = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${Math.round(p.getX(i) * 2e3)},${Math.round(p.getY(i) * 2e3)},${Math.round(p.getZ(i) * 2e3)}`;
    keys[i] = k; if (!acc.has(k)) acc.set(k, V());
  }
  const a = V(), b = V(), c = V(), e1 = V(), e2 = V();
  const tris = idx ? idx.count / 3 : p.count / 3;
  for (let t = 0; t < tris; t++) {
    const ia = idx ? idx.getX(t * 3) : t * 3, ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(p, ia); b.fromBufferAttribute(p, ib); c.fromBufferAttribute(p, ic);
    e1.subVectors(b, a); e2.subVectors(c, a); e1.cross(e2);
    acc.get(keys[ia]).add(e1); acc.get(keys[ib]).add(e1); acc.get(keys[ic]).add(e1);
  }
  const nrm = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const v = acc.get(keys[i]).clone().normalize(); nrm[i * 3] = v.x; nrm[i * 3 + 1] = v.y; nrm[i * 3 + 2] = v.z; }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}
// A straight sweep of an open 2D profile (x = depth, y = height) along +z. Single sided surface.
function profileSweep(pts, L) {
  const n = pts.length;
  const pos = [], uv = [], index = [];
  let s = 0; const arc = [0];
  for (let i = 1; i < n; i++) { s += pts[i].distanceTo(pts[i - 1]); arc.push(s); }
  for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) { pos.push(pts[i].x, pts[i].y, j * L); uv.push(arc[i] / s, j); }
  for (let i = 0; i < n - 1; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; index.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index); g.computeVertexNormals();
  return g;
}

// Collects geometry per material, merges at the end: one draw call per material per group.
class Bag {
  constructor() { this.parts = new Map(); this.stack = [new THREE.Matrix4()]; }
  get top() { return this.stack[this.stack.length - 1]; }
  push(m) { this.stack.push(this.top.clone().multiply(m)); return this; }
  pop() { this.stack.pop(); return this; }
  add(geom, mat, m) {
    let g = geom.index ? geom.toNonIndexed() : geom.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.morphAttributes = {}; g.clearGroups();
    g.applyMatrix4(m ? this.top.clone().multiply(m) : this.top);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    geom.dispose?.();
    return g;
  }
  build({ cast = true, receive = true, name = '' } = {}) {
    const grp = new THREE.Group(); grp.name = name;
    for (const [mat, list] of this.parts) {
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = cast && !mat.transparent; mesh.receiveShadow = receive;
      grp.add(mesh);
    }
    return grp;
  }
}

// =====================================================================================
export function build(ctx) {
  const tex = ctx.tex;
  const add = ctx.add ? ctx.add : (o) => (ctx.scene.add(o), o);
  const hotspot = ctx.hotspot || ((o) => o);
  const HQ = ctx.quality !== 'low';
  const aniso = Math.min(8, ctx.renderer?.capabilities?.getMaxAnisotropy?.() || 8);
  const CT = (w, h, draw, o = {}) => tex.canvasTexture(w, h, draw, { anisotropy: aniso, ...o });
  const rng = tex.rng;
  const SEG = HQ ? 1 : 0.6;
  // Grain: one shared random-pixel tile drawn as a pattern (no per-pixel canvas calls, no readback).
  let noiseTile = null;
  const grainFx = (g, w, h, { amount = 0.08, seed = 7 } = {}) => {
    if (!noiseTile) {
      noiseTile = document.createElement('canvas'); noiseTile.width = noiseTile.height = 256;
      const nt = noiseTile.getContext('2d'), img = nt.createImageData(256, 256), d = img.data, r = rng(4242);
      for (let i = 0; i < d.length; i += 4) { const v = r() < 0.5 ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = r() * 255; }
      nt.putImageData(img, 0, 0);
    }
    const r = rng(seed);
    g.save();
    g.globalAlpha = Math.min(1, amount * 1.6);
    g.fillStyle = g.createPattern(noiseTile, 'repeat');
    g.translate(-Math.floor(r() * 256), -Math.floor(r() * 256));
    g.fillRect(0, 0, w + 256, h + 256);
    g.restore();
  };

  const sg = (n) => Math.max(5, Math.round(n * SEG));

  // ---------------------------------------------------------------- textures
  function surfaceTex(base, { seed = 1, size = 512, grain = 0.06, dirt = 0.08, dirtColor = '40,32,24', light = 0.04, scratches = 0, scratchColor = 'rgba(255,255,255,0.14)', extra } = {}) {
    return CT(size, size, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      tex.blotches(g, w, h, { count: 30, min: 20, max: size / 4, color: dirtColor, alpha: dirt, seed });
      tex.blotches(g, w, h, { count: 20, min: 20, max: size / 5, color: '255,255,255', alpha: light, seed: seed + 1 });
      grainFx(g, w, h, { amount: grain, size: 1, seed: seed + 2 });
      const r = rng(seed + 3);
      g.strokeStyle = scratchColor; g.lineWidth = 1;
      for (let i = 0; i < scratches; i++) {
        const x = r() * w, y = r() * h, a = r() * 6.28, l = 5 + r() * 40;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      }
      if (extra) extra(g, w, h, r);
    });
  }
  function woodTex({ seed = 1, base = '#b88a55', dark = '80,50,25', light = '255,235,200', w = 512, h = 128, rings = 70, knots = 1, weather = 0 } = {}) {
    return CT(w, h, (g) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      const r = rng(seed);
      for (let i = 0; i < rings; i++) {
        const y0 = r() * h, a = 0.05 + r() * 0.2, amp = 0.5 + r() * 3, f = 0.004 + r() * 0.012, ph = r() * 6;
        g.strokeStyle = `rgba(${r() < 0.75 ? dark : light},${a})`; g.lineWidth = 0.5 + r() * 1.8;
        g.beginPath();
        for (let x = -8; x <= w + 8; x += 8) { const y = y0 + Math.sin(x * f + ph) * amp; x < 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
        g.stroke();
      }
      for (let k = 0; k < knots; k++) {
        const x = r() * w, y = r() * h, rr = 3 + r() * 6;
        const gr = g.createRadialGradient(x, y, 0, x, y, rr * 2.2);
        gr.addColorStop(0, `rgba(${dark},0.8)`); gr.addColorStop(0.5, `rgba(${dark},0.35)`); gr.addColorStop(1, `rgba(${dark},0)`);
        g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rr * 3, rr * 1.6, 0, 0, 7); g.fill();
      }
      grainFx(g, w, h, { amount: 0.06, seed: seed + 2 });
      if (weather) {
        g.fillStyle = `rgba(128,122,110,${weather})`; g.fillRect(0, 0, w, h);
        tex.blotches(g, w, h, { count: 20, min: 8, max: 50, color: '30,26,20', alpha: 0.12, seed: seed + 5 });
        grainFx(g, w, h, { amount: 0.1, seed: seed + 6 });
      }
    });
  }
  const vertical = (t) => { t.center.set(0.5, 0.5); t.rotation = PI / 2; return t; };

  // Pegboard: painted hardboard with 1" hole grid. Colour + bump from the same layout.
  const PEG_W = 2.3, PEG_H = 1.3;
  function pegboardMaps() {
    const pitch = 22, W = Math.round(PEG_W / 0.0254 * pitch), H = Math.round(PEG_H / 0.0254 * pitch), r = 3.0;
    const tile = (dark, rim) => {
      const c = document.createElement('canvas'); c.width = c.height = pitch;
      const t = c.getContext('2d');
      if (rim) { t.fillStyle = rim; t.beginPath(); t.arc(pitch / 2, pitch / 2 + 0.9, r + 0.7, 0, 7); t.fill(); }
      t.fillStyle = dark; t.beginPath(); t.arc(pitch / 2, pitch / 2 - 0.3, r, 0, 7); t.fill();
      return c;
    };
    const holes = (g, dark, rim) => { g.fillStyle = g.createPattern(tile(dark, rim), 'repeat'); g.fillRect(0, 0, W, H); };
    const map = CT(W, H, (g) => {
      g.fillStyle = '#cfcabe'; g.fillRect(0, 0, W, H);
      tex.blotches(g, W, H, { count: 22, min: 60, max: 200, color: '95,85,65', alpha: 0.07, seed: 11 });
      grainFx(g, W, H, { amount: 0.07, seed: 12 });
      const gr = g.createLinearGradient(0, H, 0, H * 0.72);
      gr.addColorStop(0, 'rgba(70,55,35,0.25)'); gr.addColorStop(1, 'rgba(70,55,35,0)');
      g.fillStyle = gr; g.fillRect(0, H * 0.72, W, H * 0.28);
      const r2 = rng(13);
      g.strokeStyle = 'rgba(60,60,70,0.35)'; g.lineWidth = 1.2;
      for (let i = 0; i < 9; i++) { const x = r2() * W, y = r2() * H * 0.8; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 20 + r2() * 60, y + (r2() - 0.5) * 8); g.stroke(); }
      holes(g, '#1c1a18', 'rgba(255,255,255,0.33)');
    }, { wrap: false });
    const bump = CT(W, H, (g) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
      grainFx(g, W, H, { amount: 0.18, seed: 14 });
      holes(g, '#000', null);
    }, { wrap: false, srgb: false });
    return { map, bump };
  }

  function butcherTex() {
    const W = 2048, H = 556;
    return CT(W, H, (g) => {
      const r = rng(21);
      const tones = ['#c99a62', '#b88650', '#d2a56e', '#bf8f58', '#ad7c48', '#c7955c'];
      const strip = H / 16;
      for (let i = 0; i < 16; i++) {
        let x = 0;
        while (x < W) {
          const len = 250 + r() * 700;
          g.fillStyle = tones[Math.floor(r() * tones.length)];
          g.fillRect(x, i * strip, len, strip + 1);
          for (let k = 0; k < 7; k++) {
            g.strokeStyle = `rgba(90,55,25,${0.06 + r() * 0.16})`; g.lineWidth = 0.6 + r() * 1.4;
            const y0 = i * strip + r() * strip, ph = r() * 6;
            g.beginPath();
            for (let xx = x; xx <= x + len; xx += 10) { const yy = y0 + Math.sin(xx * 0.01 + ph) * 1.4; xx === x ? g.moveTo(xx, yy) : g.lineTo(xx, yy); }
            g.stroke();
          }
          // finger joint
          g.strokeStyle = 'rgba(70,45,20,0.45)'; g.lineWidth = 1;
          g.beginPath(); for (let k = 0; k <= 6; k++) g.lineTo(x + (k % 2) * 7, i * strip + k * strip / 6); g.stroke();
          x += len;
        }
        g.fillStyle = 'rgba(60,35,15,0.35)'; g.fillRect(0, i * strip, W, 1);
      }
      grainFx(g, W, H, { amount: 0.05, seed: 22 });
      tex.blotches(g, W, H, { count: 30, min: 10, max: 70, color: '50,30,10', alpha: 0.12, seed: 23 });
      // can rings, oil stain, scratches, cut marks
      for (let i = 0; i < 4; i++) {
        const x = 150 + r() * (W - 300), y = 60 + r() * (H - 120), rr = 22 + r() * 30;
        g.strokeStyle = `rgba(55,35,20,${0.25 + r() * 0.2})`; g.lineWidth = 3 + r() * 3;
        g.beginPath(); g.arc(x, y, rr, r() * 2, 5 + r() * 1.3); g.stroke();
      }
      const ox = W * 0.62, oy = H * 0.55, og = g.createRadialGradient(ox, oy, 0, ox, oy, 90);
      og.addColorStop(0, 'rgba(40,25,10,0.45)'); og.addColorStop(1, 'rgba(40,25,10,0)');
      g.fillStyle = og; g.beginPath(); g.ellipse(ox, oy, 120, 70, 0.3, 0, 7); g.fill();
      for (let i = 0; i < 160; i++) {
        const x = r() * W, y = r() * H, a = (r() - 0.5) * 0.8 + (r() < 0.5 ? 0 : PI / 2), l = 6 + r() * 50;
        g.strokeStyle = r() < 0.5 ? 'rgba(255,240,215,0.25)' : 'rgba(60,35,15,0.3)'; g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      }
      // hand-wear darkening along the front edge (bottom of canvas = +d front edge)
      const fe = g.createLinearGradient(0, H, 0, H * 0.8);
      fe.addColorStop(0, 'rgba(60,40,20,0.25)'); fe.addColorStop(1, 'rgba(60,40,20,0)');
      g.fillStyle = fe; g.fillRect(0, H * 0.8, W, H * 0.2);
    }, { wrap: false });
  }

  function shovelMaps() {
    const draw = (P) => (g, w, h) => {
      const r = rng(77);
      g.fillStyle = P.paint; g.fillRect(0, 0, w, h);
      // bare steel worn through near the tip and along the edges
      g.fillStyle = P.steel;
      g.beginPath(); g.moveTo(0, h);
      for (let x = 0; x <= w; x += 6) g.lineTo(x, h * (0.56 + 0.07 * Math.sin(x * 0.045 + 1.3)) + (r() - 0.5) * 22);
      g.lineTo(w, h); g.closePath(); g.fill();
      for (const x0 of [0, w * 0.93]) { g.beginPath(); g.moveTo(x0, h); for (let y = h; y > h * 0.18; y -= 6) g.lineTo(x0 + (r()) * w * 0.07, y); g.lineTo(x0, h * 0.18); g.fill(); }
      // paint flakes left on steel, and steel dots through paint
      for (let i = 0; i < 90; i++) {
        const x = r() * w, y = h * (0.35 + r() * 0.45);
        g.fillStyle = r() < 0.5 ? P.paint : P.steel;
        g.beginPath(); g.ellipse(x, y, 1 + r() * 7, 1 + r() * 4, r() * 3, 0, 7); g.fill();
      }
      g.strokeStyle = P.scratch; g.lineWidth = 1;
      for (let i = 0; i < 170; i++) {
        const x = r() * w, y = h * (0.4 + r() * 0.6), l = 8 + r() * 60;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 10, y - l); g.stroke();
      }
      for (let i = 0; i < 45; i++) {
        g.fillStyle = P.rust; const x = r() * w, y = h * (0.45 + r() * 0.3);
        g.beginPath(); g.ellipse(x, y, 1 + r() * 5, 1 + r() * 3, r() * 3, 0, 7); g.fill();
      }
      // soil caked on the lower blade and in the dish
      for (let i = 0; i < 120; i++) {
        const x = w * (0.1 + r() * 0.8), y = h * (0.5 + Math.pow(r(), 0.7) * 0.5), rr = 3 + r() * 20;
        g.fillStyle = P.dirt(0.35 + r() * 0.6);
        g.beginPath(); g.ellipse(x, y, rr, rr * (0.5 + r() * 0.6), r() * 3, 0, 7); g.fill();
      }
      for (let i = 0; i < 260; i++) {
        g.fillStyle = P.dirt2(0.4 + r() * 0.5);
        g.fillRect(w * (0.05 + r() * 0.9), h * (0.45 + r() * 0.55), 1 + r() * 3, 1 + r() * 3);
      }
    };
    const map = CT(256, 384, draw({
      paint: '#232826', steel: '#8b8e91', scratch: 'rgba(220,222,225,0.45)', rust: 'rgba(125,64,28,0.85)',
      dirt: (a) => `rgba(72,52,34,${a})`, dirt2: (a) => `rgba(120,95,68,${a})`,
    }), { wrap: false });
    const rm = CT(256, 384, draw({
      paint: 'rgb(0,115,25)', steel: 'rgb(0,95,235)', scratch: 'rgba(0,70,255,0.45)', rust: 'rgba(0,215,50,0.85)',
      dirt: (a) => `rgba(0,245,0,${a})`, dirt2: (a) => `rgba(0,235,0,${a})`,
    }), { wrap: false, srgb: false });
    return { map, rm };
  }

  function solarTex(cols, rows, px = 96) {
    const gap = Math.round(px * 0.05), W = cols * px, H = rows * px;
    return CT(W, H, (g) => {
      g.fillStyle = '#d7dbe0'; g.fillRect(0, 0, W, H);
      const r = rng(cols * 7 + rows);
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const x = i * px + gap / 2, y = j * px + gap / 2, s = px - gap, c = s * 0.12;
        const gr = g.createLinearGradient(x, y, x + s, y + s);
        const k = r() * 0.25;
        gr.addColorStop(0, `rgb(${14 + k * 20},${28 + k * 25},${62 + k * 40})`);
        gr.addColorStop(1, `rgb(${10 + k * 10},${20 + k * 14},${44 + k * 20})`);
        g.fillStyle = gr;
        g.beginPath(); g.moveTo(x + c, y); g.lineTo(x + s - c, y); g.lineTo(x + s, y + c); g.lineTo(x + s, y + s - c);
        g.lineTo(x + s - c, y + s); g.lineTo(x + c, y + s); g.lineTo(x, y + s - c); g.lineTo(x, y + c); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(90,110,150,0.18)'; g.lineWidth = 0.6;
        for (let f = 1; f < 22; f++) { g.beginPath(); g.moveTo(x, y + f * s / 22); g.lineTo(x + s, y + f * s / 22); g.stroke(); }
        g.fillStyle = 'rgba(195,200,208,0.9)';
        for (let b = 1; b <= 3; b++) g.fillRect(x + b * s / 4 - 1, y, 2, s);
      }
      // ribbon tabs across cell gaps
      g.fillStyle = 'rgba(185,190,198,0.9)';
      for (let i = 0; i < cols; i++) for (let b = 1; b <= 3; b++) g.fillRect(i * px + gap / 2 + b * (px - gap) / 4 - 1, 0, 2, H);
    }, { wrap: false });
  }

  function treadBump() {
    return CT(512, 64, (g, w, h) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#000';
      for (let i = 0; i < 44; i++) {
        const x = i * w / 44;
        g.beginPath(); g.moveTo(x, h * 0.3); g.lineTo(x + 5, h * 0.5); g.lineTo(x, h * 0.7); g.lineTo(x + 3, h * 0.7); g.lineTo(x + 8, h * 0.5); g.lineTo(x + 3, h * 0.3); g.closePath(); g.fill();
      }
      grainFx(g, w, h, { amount: 0.3, seed: 31 });
    }, { srgb: false });
  }

  function stencilTex(text, { w = 2048, h = 400, color = '#f3f1ea', seed = 5, wear = 1, font = '"Saira Stencil One", "Liberation Sans Narrow", "Liberation Sans", Impact, sans-serif', weight = 800, fill = 0.9, spacing = 0.06, bridgeSet = 'OQD0' } = {}) {
    return CT(w, h, (g) => {
      const r = rng(seed);
      let px = h * 0.78;
      const setF = () => (g.font = `${weight} ${px}px ${font}`);
      setF();
      const measure = () => [...text].reduce((s, ch) => s + g.measureText(ch).width + px * spacing, -px * spacing);
      let tw = measure();
      if (tw > w * fill) { px *= (w * fill) / tw; setF(); tw = measure(); }
      g.fillStyle = color; g.textBaseline = 'middle';
      let x = (w - tw) / 2;
      const bridges = [];
      for (const ch of text) {
        const cw = g.measureText(ch).width;
        g.fillText(ch, x, h / 2 + px * 0.04);
        if (bridgeSet.includes(ch)) bridges.push(x + cw * 0.5);
        x += cw + px * spacing;
      }
      g.globalCompositeOperation = 'destination-out';
      for (const bx of bridges) g.fillRect(bx - px * 0.035, 0, px * 0.07, h);
      for (let i = 0; i < 2600 * wear; i++) {
        g.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.7})`;
        const rr = 0.6 + r() * r() * r() * 7;
        g.beginPath(); g.ellipse(r() * w, r() * h, rr * (0.6 + r()), rr * (0.3 + r() * 0.5), r() * 3, 0, 7); g.fill();
      }
      g.strokeStyle = 'rgba(0,0,0,0.8)';
      for (let i = 0; i < 60 * wear; i++) {
        g.lineWidth = 0.6 + r() * 2; const x0 = r() * w, y0 = r() * h, a = (r() - 0.5) * 0.6;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(a) * 140, y0 + Math.sin(a) * 140); g.stroke();
      }
      g.globalCompositeOperation = 'source-over';
      // overspray haze + drips
      g.fillStyle = color;
      for (let i = 0; i < 7 * wear; i++) {
        const dx = (w - tw) / 2 + r() * tw, dy = h / 2 + px * 0.35, dl = 8 + r() * 40;
        g.globalAlpha = 0.7; g.fillRect(dx, dy, 2 + r() * 2, dl); g.beginPath(); g.arc(dx + 1.5, dy + dl, 2.5, 0, 7); g.fill();
      }
      g.globalAlpha = 1;
    }, { wrap: false });
  }

  // Blue roll-off paint with chips, rust streaks, scratches and ground splash.
  function dumpsterPaint() {
    const W = 2048, H = 560;
    return CT(W, H, (g) => {
      const r = rng(404);
      const base = g.createLinearGradient(0, 0, 0, H);
      base.addColorStop(0, '#24568f'); base.addColorStop(1, '#1b4476');
      g.fillStyle = base; g.fillRect(0, 0, W, H);
      tex.blotches(g, W, H, { count: 80, min: 30, max: 200, color: '10,20,35', alpha: 0.1, seed: 405 });
      tex.blotches(g, W, H, { count: 50, min: 30, max: 160, color: '150,170,190', alpha: 0.06, seed: 406 });
      grainFx(g, W, H, { amount: 0.06, size: 2, seed: 407 });
      // rust streaks running down from the top rail and from chips
      const streak = (x, y, len, wid, a) => {
        const gr = g.createLinearGradient(0, y, 0, y + len);
        gr.addColorStop(0, `rgba(118,58,24,${a})`); gr.addColorStop(0.4, `rgba(105,55,26,${a * 0.6})`); gr.addColorStop(1, 'rgba(100,55,30,0)');
        g.fillStyle = gr;
        g.beginPath(); g.moveTo(x - wid / 2, y); g.lineTo(x + wid / 2, y);
        g.lineTo(x + wid * 0.2 + (r() - 0.5) * 6, y + len); g.lineTo(x - wid * 0.2, y + len); g.closePath(); g.fill();
      };
      for (let i = 0; i < 70; i++) streak(r() * W, 0, 60 + r() * 330, 3 + r() * 16, 0.25 + r() * 0.5);
      // chips: primer ring, rust core, some bare steel
      const chip = (x, y, s) => {
        const pts = []; const n = 7 + Math.floor(r() * 5);
        for (let k = 0; k < n; k++) { const a = k / n * 6.283, rr = s * (0.5 + r() * 0.7); pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.7]); }
        const poly = (sc, col) => { g.fillStyle = col; g.beginPath(); pts.forEach(([px, py], k) => { const X = x + (px - x) * sc, Y = y + (py - y) * sc; k ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.closePath(); g.fill(); };
        poly(1.25, 'rgba(60,66,72,0.9)');
        poly(1.0, r() < 0.7 ? '#6d3b1d' : '#7d7a74');
        poly(0.5, 'rgba(140,72,30,0.8)');
        if (r() < 0.5) streak(x, y, 30 + r() * 150, s * 0.8, 0.35 + r() * 0.35);
      };
      for (let i = 0; i < 90; i++) chip(r() * W, r() < 0.5 ? r() * 60 : r() * H, 2 + r() * 11);
      for (let i = 0; i < 70; i++) chip(r() * W, H - r() * 70, 2 + r() * 9);
      // scratches (loading damage) mostly upper half
      for (let i = 0; i < 260; i++) {
        const x = r() * W, y = r() * H * 0.7, a = (r() - 0.5) * 1.2, l = 10 + r() * 120;
        g.strokeStyle = r() < 0.6 ? 'rgba(170,190,210,0.25)' : 'rgba(80,50,30,0.35)'; g.lineWidth = 0.7 + r();
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      }
      // ground splash / mud along the bottom
      const mud = g.createLinearGradient(0, H, 0, H * 0.72);
      mud.addColorStop(0, 'rgba(70,55,40,0.55)'); mud.addColorStop(1, 'rgba(70,55,40,0)');
      g.fillStyle = mud; g.fillRect(0, H * 0.72, W, H * 0.28);
      tex.blotches(g, W, H, { count: 60, min: 6, max: 30, color: '65,50,35', alpha: 0.2, seed: 408 });
    });
  }

  function plaidTex() {
    return CT(512, 512, (g, w, h) => {
      g.fillStyle = '#5d4128'; g.fillRect(0, 0, w, h);
      const bands = [[0, 70, 'rgba(176,112,48,0.55)'], [90, 16, 'rgba(214,196,150,0.5)'], [150, 50, 'rgba(92,98,44,0.6)'], [230, 8, 'rgba(214,196,150,0.5)'], [300, 90, 'rgba(150,80,40,0.5)'], [420, 30, 'rgba(92,98,44,0.5)']];
      for (const [p, s, c] of bands) { g.fillStyle = c; g.fillRect(p, 0, s, h); g.fillRect(0, p, w, s); }
      // woven texture
      for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(0,0,0,${y % 4 ? 0.08 : 0.02})`; g.fillRect(0, y, w, 1); }
      for (let x = 0; x < w; x += 2) { g.fillStyle = `rgba(255,255,255,${x % 4 ? 0.04 : 0.0})`; g.fillRect(x, 0, 1, h); }
      grainFx(g, w, h, { amount: 0.15, seed: 51 });
      tex.blotches(g, w, h, { count: 26, min: 20, max: 90, color: '30,20,10', alpha: 0.2, seed: 52 });
      tex.blotches(g, w, h, { count: 14, min: 30, max: 110, color: '230,215,180', alpha: 0.09, seed: 53 });
    });
  }

  function debrisTex() {
    return CT(1024, 1024, (g, w, h) => {
      g.fillStyle = '#2b2824'; g.fillRect(0, 0, w, h);
      const r = rng(61);
      const cols = ['#7a5d3b', '#86694a', '#4b4e51', '#9d988e', '#141516', '#3f5526', '#5a3420', '#8c7658', '#33363b', '#6b5236', '#1d1e20'];
      for (let i = 0; i < 700; i++) {
        const x = r() * w, y = r() * h, s = 14 + r() * r() * 110, a = r() * 6.28;
        g.save(); g.translate(x, y); g.rotate(a);
        g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(-s / 2 + 3, -s * 0.3 + 3, s, s * (0.2 + r() * 0.5));
        g.fillStyle = cols[Math.floor(r() * cols.length)];
        g.fillRect(-s / 2, -s * 0.3, s, s * (0.2 + r() * 0.5));
        g.fillStyle = `rgba(255,255,255,${r() * 0.12})`; g.fillRect(-s / 2, -s * 0.3, s, 2);
        g.restore();
      }
      grainFx(g, w, h, { amount: 0.2, seed: 62 });
      tex.blotches(g, w, h, { count: 60, min: 20, max: 90, color: '0,0,0', alpha: 0.25, seed: 63 });
    });
  }

  function leafTex() {
    return CT(128, 128, (g) => {
      g.clearRect(0, 0, 128, 128);
      g.fillStyle = '#d8e6c4';
      g.beginPath(); g.moveTo(64, 4); g.quadraticCurveTo(122, 50, 64, 124); g.quadraticCurveTo(6, 50, 64, 4); g.fill();
      g.strokeStyle = 'rgba(120,140,90,0.9)'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(64, 8); g.lineTo(64, 122); g.stroke();
      g.lineWidth = 1.2;
      for (let y = 30; y < 110; y += 14) { g.beginPath(); g.moveTo(64, y); g.lineTo(38, y - 12); g.moveTo(64, y); g.lineTo(90, y - 12); g.stroke(); }
    }, { wrap: false });
  }

  function tapeTex() {
    return CT(64, 256, (g, w, h) => {
      g.fillStyle = '#f1f1ee'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c4161c';
      for (let y = -64; y < h + 64; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + 32); g.lineTo(w, y + 64); g.lineTo(0, y + 32); g.closePath(); g.fill(); }
      grainFx(g, w, h, { amount: 0.2, seed: 71 });
    }, { wrap: false });
  }

  function labelPlate(lines, { w = 512, h = 256, bg = '#f2c21b', fg = '#151515', seed = 9 } = {}) {
    return CT(w, h, (g) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.strokeStyle = fg; g.lineWidth = 10; g.strokeRect(14, 14, w - 28, h - 28);
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      lines.forEach(([t, s], i) => { g.font = `800 ${s}px "Liberation Sans", sans-serif`; g.fillText(t, w / 2, h * (i + 1) / (lines.length + 1)); });
      tex.blotches(g, w, h, { count: 20, min: 10, max: 60, color: '60,40,20', alpha: 0.2, seed });
      grainFx(g, w, h, { amount: 0.12, seed: seed + 1 });
    }, { wrap: false });
  }

  // ---------------------------------------------------------------- materials
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const phys = (o) => new THREE.MeshPhysicalMaterial(o);
  const peg = pegboardMaps();
  const woodPine = woodTex({ seed: 3, base: '#c9a06a', rings: 60 });
  const woodAsh = vertical(woodTex({ seed: 4, base: '#b98d58', rings: 90, knots: 0 }));
  const woodPallet = woodTex({ seed: 5, base: '#a58459', rings: 80, knots: 2, weather: 0.35 });
  const shv = shovelMaps();
  const tread = treadBump();

  const mat = {
    pegboard: std({ map: peg.map, bumpMap: peg.bump, bumpScale: 3, roughness: 0.78 }),
    butcher: std({ map: butcherTex(), roughness: 0.52 }),
    pine: std({ map: woodPine, roughness: 0.7 }),
    ash: std({ map: woodAsh, roughness: 0.55 }),
    pallet: std({ map: woodPallet, roughness: 0.92 }),
    powder: std({ map: surfaceTex('#34383c', { seed: 81, scratches: 60, dirt: 0.12 }), roughness: 0.55, metalness: 0.35 }),
    zinc: std({ color: 0xb4b8bb, roughness: 0.32, metalness: 1 }),
    chrome: std({ color: 0xd9dde2, roughness: 0.14, metalness: 1 }),
    alu: std({ color: 0xc3c7cb, roughness: 0.3, metalness: 1 }),
    brass: std({ color: 0xb58b3c, roughness: 0.3, metalness: 1 }),
    steelDark: std({ map: surfaceTex('#34302c', { seed: 82, dirt: 0.25, dirtColor: '110,60,25', scratches: 40 }), roughness: 0.78, metalness: 0.45 }),
    blade: std({ map: shv.map, roughnessMap: shv.rm, metalnessMap: shv.rm, roughness: 1, metalness: 1 }),
    rubber: std({ color: 0x151515, roughness: 0.93 }),
    tire: std({ color: 0x161616, roughness: 0.9, bumpMap: tread, bumpScale: 2 }),
    blackPlastic: std({ color: 0x1b1c1d, roughness: 0.55 }),
    greyPlastic: std({ color: 0x6a6d70, roughness: 0.6 }),
    yellowPlastic: std({ color: 0xe0b020, roughness: 0.45 }),
    orangePlastic: std({ map: surfaceTex('#d8641c', { seed: 83, dirt: 0.12 }), roughness: 0.5 }),
    scoop: std({ color: 0xe0701f, roughness: 0.45, side: THREE.DoubleSide }),
    redPlastic: std({ map: surfaceTex('#b3261d', { seed: 84, dirt: 0.12 }), roughness: 0.45 }),
    whitePlastic: std({ map: surfaceTex('#e2dfd8', { seed: 85, dirt: 0.12 }), roughness: 0.55 }),
    greenNozzle: std({ color: 0x2f9a45, roughness: 0.45 }),
    hose: std({ color: 0x121212, roughness: 0.5 }),
    gutter: std({ color: 0xf0efea, roughness: 0.32, metalness: 0.15, side: THREE.DoubleSide }),
    gunk: std({ color: 0x3a2e1f, roughness: 0.95 }),
    toolRed: std({ map: surfaceTex('#9f2219', { seed: 86, scratches: 80, dirt: 0.14 }), roughness: 0.38, metalness: 0.4 }),
    leather: std({ map: surfaceTex('#b48958', { seed: 87, dirt: 0.25, grain: 0.14 }), roughness: 0.85 }),
    cuff: std({ map: surfaceTex('#2c4f79', { seed: 88, grain: 0.2 }), roughness: 0.95 }),
    tapeYellow: std({ color: 0xe8b61c, roughness: 0.4 }),
    solarCellsSmall: phys({ map: solarTex(6, 5, 96), roughness: 0.2, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.04 }),
    solarCellsBig: phys({ map: solarTex(6, 10, 96), roughness: 0.2, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.06 }),
    mowerPaint: phys({ map: surfaceTex('#2f7b34', { seed: 89, dirt: 0.2, dirtColor: '50,45,25', scratches: 50, light: 0.03 }), roughness: 0.42, metalness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
    engineGrey: std({ color: 0x9a9d9f, roughness: 0.5, metalness: 0.6 }),
    fabricMesh: std({ map: surfaceTex('#2e3032', { seed: 90, grain: 0.3, dirt: 0.15, dirtColor: '60,70,30', extra: (g, w, h) => { g.strokeStyle = 'rgba(0,0,0,0.35)'; for (let i = 0; i < w; i += 4) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke(); } } }), roughness: 0.95 }),
    paver: std({ map: surfaceTex('#d2d0cc', { seed: 91, grain: 0.28, dirt: 0.12, light: 0.06, size: 256 }), roughness: 0.92 }),
    wrap: phys({ color: 0xe6edf2, transparent: true, opacity: 0.3, roughness: 0.12, side: THREE.DoubleSide, depthWrite: false, clearcoat: 0.6 }),
    binBody: std({ map: surfaceTex('#314638', { seed: 92, scratches: 90, dirt: 0.2, scratchColor: 'rgba(180,190,180,0.15)' }), roughness: 0.62 }),
    binLid: std({ map: surfaceTex('#364c3d', { seed: 93, scratches: 40, dirt: 0.15 }), roughness: 0.55 }),
    binInside: std({ color: 0x0b0d0c, roughness: 1 }),
    cardboard: std({ map: surfaceTex('#9d774a', { seed: 94, grain: 0.15, dirt: 0.2 }), roughness: 0.9 }),
    dumpPaint: std({ map: dumpsterPaint(), roughness: 0.62, metalness: 0.2 }),
    fabric: std({ map: plaidTex(), roughness: 0.95 }),
    couchLeg: std({ color: 0x3b2616, roughness: 0.6 }),
    enamel: phys({ map: surfaceTex('#e7e1d1', { seed: 95, dirt: 0.14, dirtColor: '90,70,40', scratches: 60, scratchColor: 'rgba(90,80,70,0.25)' }), roughness: 0.35, clearcoat: 0.4 }),
    bark: std({ map: vertical(woodTex({ seed: 96, base: '#5c4a3a', dark: '30,22,15', light: '140,125,105', rings: 110, knots: 0 })), roughness: 0.95 }),
    leaf: std({ map: leafTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 }),
    bagPlastic: phys({ color: 0x0c0d0e, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.25 }),
    grass: std({ map: surfaceTex('#4f7a2c', { seed: 97, grain: 0.35, dirt: 0.2, light: 0.08 }), roughness: 0.9 }),
    debris: std({ map: debrisTex(), roughness: 0.92 }),
    washerRed: phys({ map: surfaceTex('#b2231b', { seed: 98, dirt: 0.2, scratches: 60 }), roughness: 0.4, clearcoat: 0.4 }),
    tapeReflect: std({ map: tapeTex(), roughness: 0.3, metalness: 0.1 }),
    carpet: std({ map: surfaceTex('#8a7b62', { seed: 99, grain: 0.3, dirt: 0.2 }), roughness: 1 }),
    drywall: std({ map: surfaceTex('#dedbd3', { seed: 100, grain: 0.1, dirt: 0.1 }), roughness: 0.95 }),
  };
  mat.paver.map.repeat.set(4, 4);
  mat.fabric.map.repeat.set(1, 1);
  const decalMat = (map, o = {}) => std({ map, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false, ...o });

  // ---------------------------------------------------------------- shared part builders
  // Pegboard J-hook in the wall frame (x = along wall, z = out of wall).
  const hook = (b, u, y, len = 0.07, rise = 0.018) =>
    b.add(tube([[u, y, 0.028], [u, y, 0.031 + len * 0.6], [u, y + rise * 0.3, 0.031 + len], [u, y + rise, 0.031 + len + 0.004]], 0.0024, 12, 6), mat.zinc);

  // Tyre with tread (axis along x); hub cap on +side or -side.
  function wheel(b, r, w, side = 1, hubMat = mat.greyPlastic, x = 0, y = 0, z = 0) {
    const ri = r * 0.6;
    b.push(M(x, y, z));
    const prof = [[ri, -w / 2], [r - 0.014, -w / 2], [r - 0.004, -w / 2 + 0.007], [r, -w / 2 + 0.016], [r, w / 2 - 0.016], [r - 0.004, w / 2 - 0.007], [r - 0.014, w / 2], [ri, w / 2]];
    b.add(lathe(prof, sg(30)), mat.tire, M(0, 0, 0, 0, 0, -side * PI / 2));
    b.add(cyl(ri + 0.002, ri + 0.002, w * 0.92, sg(20)), hubMat, M(0, 0, 0, 0, 0, PI / 2));
    b.add(lathe([[ri + 0.001, w * 0.46], [ri * 0.8, w * 0.46 + 0.01], [ri * 0.35, w * 0.46 + 0.016], [0.0, w * 0.46 + 0.017]], sg(20)), hubMat, M(0, 0, 0, 0, 0, -side * PI / 2));
    b.pop();
  }

  // Small four-stroke engine (mower / pressure washer). Origin = base centre.
  function smallEngine(b, shroud = mat.blackPlastic, tank = mat.whitePlastic) {
    b.add(rbox(0.26, 0.1, 0.24, 0.02), mat.engineGrey, M(0, 0.05, 0));
    b.add(cyl(0.055, 0.055, 0.12, sg(14)), mat.engineGrey, M(0.13, 0.1, -0.03, 0, 0, PI / 2));
    for (let i = 0; i < 5; i++) b.add(cyl(0.07, 0.07, 0.006, sg(14)), mat.engineGrey, M(0.1 + i * 0.016, 0.1, -0.03, 0, 0, PI / 2));
    b.add(lathe([[0.135, 0.09], [0.14, 0.13], [0.136, 0.17], [0.12, 0.198], [0.08, 0.214], [0.0, 0.219]], sg(24)), shroud);
    b.add(cyl(0.07, 0.072, 0.014, sg(20)), mat.blackPlastic, M(0, 0.224, 0));
    b.add(rbox(0.1, 0.11, 0.075, 0.018), mat.blackPlastic, M(0.14, 0.14, 0.1));
    b.add(rbox(0.15, 0.075, 0.11, 0.022), tank, M(-0.08, 0.2, 0.12));
    b.add(cyl(0.022, 0.024, 0.02, 12), mat.blackPlastic, M(-0.08, 0.247, 0.13));
    b.add(rbox(0.09, 0.075, 0.11, 0.01), mat.steelDark, M(0.13, 0.08, -0.14));
    b.add(cyl(0.008, 0.008, 0.05, 8), mat.blackPlastic, M(0.2, 0.11, -0.03, 0, 0, PI / 2));
    b.add(cyl(0.012, 0.012, 0.03, 10), mat.yellowPlastic, M(-0.12, 0.1, -0.1));
  }

  // Pressure-washer wand (along -y from the gun outlet).
  function wand(b, len) {
    b.add(cyl(0.0075, 0.0075, len, 10), mat.zinc, M(0, -len / 2, 0));
    b.add(cyl(0.018, 0.017, 0.2, 14), mat.blackPlastic, M(0, -0.18, 0));
    b.add(cyl(0.012, 0.012, 0.035, 12), mat.brass, M(0, -len + 0.01, 0));
    b.add(cyl(0.011, 0.009, 0.03, 6), mat.greenNozzle, M(0, -len - 0.02, 0));
  }
  function sprayGun(b) {
    b.add(rbox(0.045, 0.2, 0.042, 0.014), mat.blackPlastic, M(0, 0.1, 0));
    b.add(rbox(0.04, 0.13, 0.036, 0.014), mat.yellowPlastic, M(0.068, 0.16, 0, 0, 0, PI / 2 - 0.35));
    b.add(rbox(0.012, 0.085, 0.022, 0.005), mat.blackPlastic, M(0.052, 0.1, 0, 0, 0, 0.35));
    b.add(tube([[0.02, 0.2, 0], [0.12, 0.2, 0], [0.13, 0.1, 0], [0.1, 0.07, 0]], 0.005, 16, 6), mat.blackPlastic);
    b.add(cyl(0.011, 0.011, 0.04, 12), mat.brass, M(0, 0.215, 0));
  }

  // Dogbone interlocking paver: extruded outline with a chamfer. Bottom at y=0.
  function paverGeometry() {
    const L = 0.225 - 0.008, W = 0.1125 - 0.008, n = 0.011, hl = L / 2, hw = W / 2, a = L / 6;
    const s = new THREE.Shape();
    s.moveTo(-hl, -hw); s.lineTo(-a - 0.014, -hw); s.lineTo(-a, -hw + n); s.lineTo(a, -hw + n); s.lineTo(a + 0.014, -hw); s.lineTo(hl, -hw);
    s.lineTo(hl, hw); s.lineTo(a + 0.014, hw); s.lineTo(a, hw - n); s.lineTo(-a, hw - n); s.lineTo(-a - 0.014, hw); s.lineTo(-hl, hw); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.052, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 2 });
    g.rotateX(-PI / 2); g.translate(0, 0.004, 0);
    boxUV(g, 2, 2);
    return g;
  }
  const paverColors = (r) => {
    const pal = [[0.74, 0.64, 0.5], [0.6, 0.59, 0.57], [0.36, 0.35, 0.34], [0.68, 0.56, 0.44]];
    const p = pal[Math.floor(r() * pal.length)], j = 0.92 + r() * 0.14;
    return new THREE.Color().setRGB(p[0] * j, p[1] * j, p[2] * j, THREE.SRGBColorSpace);
  };

  // Solar panel: frame + glossy cell sheet. Origin bottom-centre, face +z.
  function solarPanel(b, w, h, cells, frameD = 0.035) {
    const f = 0.022;
    b.add(rbox(w - 2 * f + 0.002, h - 2 * f + 0.002, 0.006, 0.002), cells, M(0, h / 2, frameD / 2 - 0.006));
    for (const s of [-1, 1]) {
      b.add(rbox(f, h, frameD, 0.003), mat.alu, M(s * (w / 2 - f / 2), h / 2, 0));
      b.add(rbox(w - 2 * f, f, frameD, 0.003), mat.alu, M(0, h / 2 + s * (h / 2 - f / 2), 0));
    }
    b.add(rbox(w - 0.05, h - 0.05, 0.004, 0.002), mat.whitePlastic, M(0, h / 2, -frameD / 2 + 0.006));
    b.add(rbox(0.1, 0.07, 0.025, 0.006), mat.blackPlastic, M(0, h * 0.8, -frameD / 2 - 0.006));
  }

  // K-style gutter profile (x = depth from back, y = height), smoothed.
  const gutterProfile = (() => {
    const pts = [[0.008, 0.112], [0, 0.108], [0, 0.012], [0.005, 0.001], [0.068, 0], [0.077, 0.006], [0.086, 0.028], [0.096, 0.044], [0.108, 0.051],
      [0.111, 0.061], [0.104, 0.071], [0.108, 0.082], [0.12, 0.09], [0.126, 0.101], [0.127, 0.113], [0.122, 0.117], [0.117, 0.112]].map((p) => V2(p[0], p[1]));
    return new THREE.SplineCurve(pts).getPoints(90);
  })();
  function gutterSection(b, L, { cap = true, gunk = false } = {}) {
    // runs along -x from x=0 in local; back of gutter at z=0, opening up.
    b.add(profileSweep(gutterProfile, L), mat.gutter, M(0, 0, 0, 0, -PI / 2, 0));
    if (cap) {
      const s = new THREE.Shape(gutterProfile);
      b.add(new THREE.ShapeGeometry(s, 1), mat.gutter, M(-L, 0, 0, 0, -PI / 2, 0));
    }
    for (let x = 0.2; x < L; x += 0.6) b.add(rbox(0.014, 0.008, 0.125, 0.002), mat.alu, M(-x, 0.108, 0.063));
    if (gunk) {
      const g = rbox(L * 0.9, 0.03, 0.06, 0.012);
      lumpify(g, 0.012, 9, 3);
      b.add(g, mat.gunk, M(-L / 2, 0.012, 0.038));
    }
  }

  // Branch generator for the tree limbs (bark merged, leaves instanced).
  function branches(b, seed, roots, leafList) {
    const r = rng(seed);
    const grow = (p, dir, len, rad, depth) => {
      const bend = V((r() - 0.5) * 0.3, (r() - 0.3) * 0.2, (r() - 0.5) * 0.3);
      const mid = p.clone().addScaledVector(dir, len * 0.5).addScaledVector(bend, len * 0.3);
      const end = p.clone().addScaledVector(dir, len).addScaledVector(bend, len * 0.2);
      const rm = rad * 0.82, re = rad * 0.65;
      b.add(segCyl(p.toArray(), mid.toArray(), rad, rm, depth > 1 ? 7 : 5), mat.bark);
      b.add(segCyl(mid.toArray(), end.toArray(), rm, re, depth > 1 ? 7 : 5), mat.bark);
      if (depth === 0) {
        for (let i = 0; i < 22; i++) {
          const q = end.clone().add(V((r() - 0.5) * 0.26, (r() - 0.4) * 0.24, (r() - 0.5) * 0.26));
          leafList.push({ p: q, rot: [r() * 6.3, r() * 6.3, r() * 6.3], s: 0.75 + r() * 0.5, t: r() });
        }
        return;
      }
      const n = 2 + (r() < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const nd = dir.clone().add(V((r() - 0.5) * 1.3, 0.25 + r() * 0.4, (r() - 0.5) * 1.3)).normalize();
        const st = p.clone().lerp(end, 0.55 + r() * 0.45);
        grow(st, nd, len * (0.55 + r() * 0.2), re * 0.85, depth - 1);
      }
      if (depth <= 1) for (let i = 0; i < 6; i++) {
        const q = mid.clone().add(V((r() - 0.5) * 0.18, (r() - 0.5) * 0.15, (r() - 0.5) * 0.18));
        leafList.push({ p: q, rot: [r() * 6.3, r() * 6.3, r() * 6.3], s: 0.7 + r() * 0.4, t: r() });
      }
    };
    for (const [p, d, len, rad, depth] of roots) grow(V(...p), V(...d).normalize(), len, rad, depth);
  }
  function leafMesh(list) {
    const g = new THREE.PlaneGeometry(0.12, 0.085);
    g.translate(0, 0.04, 0);
    const im = new THREE.InstancedMesh(g, mat.leaf, list.length);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    list.forEach((l, i) => {
      im.setMatrixAt(i, M(l.p.x, l.p.y, l.p.z, ...l.rot, l.s));
      if (l.t < 0.75) c.setRGB(0.42 + l.t * 0.2, 0.62 + l.t * 0.12, 0.24, THREE.SRGBColorSpace);
      else c.setRGB(0.62 + (l.t - 0.75) * 0.5, 0.55, 0.22, THREE.SRGBColorSpace);
      im.setColorAt(i, c);
    });
    im.castShadow = true; im.receiveShadow = true;
    return im;
  }

  // Contractor bag: lumpy glossy black sack with a tied neck. Origin bottom-centre, neck toward +z.
  function contractorBag(b, seed, sx = 1, sy = 1, sz = 1) {
    const g = new THREE.SphereGeometry(0.3, sg(26), sg(18));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i) * sx, y = p.getY(i) * 0.78 * sy, z = p.getZ(i) * 1.25 * sz;
      if (y < -0.17 * sy) y = -0.17 * sy + (y + 0.17 * sy) * 0.15;
      const neck = Math.max(0, (z / (0.375 * sz)) - 0.7) / 0.3;
      x *= 1 - neck * 0.75; y *= 1 - neck * 0.75;
      p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    lumpify(g, 0.035, 5, seed, (x, y, z) => Math.sin(x * 60 + z * 25) * 0.004 + Math.sin(y * 70 - z * 40) * 0.003);
    smoothNormals(g);
    b.add(g, mat.bagPlastic, M(0, 0.17 * sy, 0));
    const neck = cyl(0.012, 0.03, 0.12, 10);
    lumpify(neck, 0.008, 30, seed + 1);
    b.add(neck, mat.bagPlastic, M(0, 0.17 * sy, 0.375 * sz + 0.04, PI / 2, 0, 0));
    b.add(lathe([[0.001, -0.02], [0.03, -0.01], [0.035, 0.0], [0.028, 0.012], [0.001, 0.02]], 10), mat.bagPlastic, M(0, 0.17 * sy, 0.375 * sz + 0.1, PI / 2, 0, 0));
    b.add(tube([[0, 0.17 * sy, 0.375 * sz + 0.02], [0.03, 0.17 * sy + 0.02, 0.375 * sz + 0.04], [0.02, 0.17 * sy - 0.02, 0.375 * sz + 0.07], [-0.04, 0.17 * sy - 0.05, 0.375 * sz + 0.09]], 0.004, 12, 5), mat.yellowPlastic);
  }

  const place = (grp, x, y, z, rx = 0, ry = 0, rz = 0, order = 'YXZ') => {
    grp.position.set(x, y, z); grp.rotation.set(rx, ry, rz, order); return grp;
  };

  // =============================================================== PART A: services wall
  // Wall frame: local x runs along the wall toward the back of the garage (world -z),
  // local z comes out of the wall (world +x), y is up. u = -worldZ, d = worldX + 3.6.
  const wall = new THREE.Group();
  wall.name = 'services-wall';
  wall.position.set(-3.6, 0, 0); wall.rotation.y = PI / 2;
  add(wall);

  // ---- workbench + pegboard + dressing (not clickable individually)
  {
    const b = new Bag();
    const U0 = 2.2, U1 = 4.6, UC = 3.4, BL = U1 - U0, BD = 0.62, DC = 0.02 + BD / 2;
    const top = rbox(BL, 0.045, BD, 0.006);
    planarUV(top, 'x', 'z');
    b.add(top, mat.butcher, M(UC, 0.8975, DC));
    // steel legs, aprons, lower shelf
    for (const u of [U0 + 0.06, UC, U1 - 0.06]) for (const d of [0.07, BD - 0.03]) {
      b.add(rbox(0.045, 0.83, 0.045, 0.004), mat.powder, M(u, 0.44, d));
      b.add(cyl(0.022, 0.026, 0.025, 12), mat.rubber, M(u, 0.0125, d));
    }
    for (const d of [0.07, BD - 0.03]) {
      b.add(rbox(BL - 0.04, 0.07, 0.03, 0.004), mat.powder, M(UC, 0.84, d));
      b.add(rbox(BL - 0.04, 0.04, 0.03, 0.004), mat.powder, M(UC, 0.16, d));
    }
    for (const u of [U0 + 0.06, UC, U1 - 0.06]) b.add(rbox(0.035, 0.035, BD - 0.1, 0.004), mat.powder, M(u, 0.84, DC));
    const shelf = rbox(BL - 0.06, 0.018, BD - 0.06, 0.003); boxUV(shelf, 1, 1);
    b.add(shelf, mat.pine, M(UC, 0.185, DC));

    // pegboard + pine trim frame
    const board = rbox(PEG_W, PEG_H, 0.006, 0.002, 1); planarUV(board, 'x', 'y');
    b.add(board, mat.pegboard, M(UC, 1.0 + PEG_H / 2, 0.028));
    for (const s of [-1, 1]) {
      b.add(rbox(PEG_W + 0.09, 0.045, 0.02, 0.004), mat.pine, M(UC, 1.65 + s * (PEG_H / 2 + 0.0225), 0.035));
      b.add(boxUV(rbox(0.045, PEG_H + 0.001, 0.02, 0.004), 1, 1), mat.pine, M(UC + s * (PEG_W / 2 + 0.0225), 1.65, 0.035));
    }
    // stencil sign
    b.add(rbox(0.66, 0.13, 0.012, 0.004), mat.blackPlastic, M(UC, 2.205, 0.037));
    for (const s of [-1, 1]) b.add(cyl(0.006, 0.006, 0.006, 8), mat.zinc, M(UC + s * 0.3, 2.205, 0.045, PI / 2, 0, 0));

    // ---- dressing hooks + small tools
    hook(b, 3.93, 1.735, 0.06); // gloves
    hook(b, 4.2, 1.66, 0.05); // pruners
    hook(b, 4.42, 1.72, 0.05); // trowel
    // work gloves hanging (fingers down)
    b.push(M(3.93, 1.72, 0.05, 0, 0, 0.08));
    for (const [dx, dz, rot] of [[-0.012, 0, 0.05], [0.02, 0.022, -0.12]]) {
      b.push(M(dx, 0, dz, 0, 0.1, rot));
      b.add(rbox(0.1, 0.07, 0.03, 0.012), mat.cuff, M(0, -0.04, 0));
      b.add(rbox(0.095, 0.1, 0.024, 0.012), mat.leather, M(0, -0.12, 0));
      [[-0.033, 0.06], [-0.011, 0.07], [0.011, 0.068], [0.032, 0.058]].forEach(([fx, fl]) => b.add(new THREE.CapsuleGeometry(0.0105, fl, 4, 8), mat.leather, M(fx, -0.17 - fl / 2, 0)));
      b.add(new THREE.CapsuleGeometry(0.011, 0.045, 4, 8), mat.leather, M(-0.058, -0.13, 0.004, 0, 0, -0.5));
      b.pop();
    }
    b.pop();
    // bypass pruners
    b.push(M(4.2, 1.62, 0.05, 0, 0, 0.1));
    b.add(rbox(0.022, 0.12, 0.012, 0.005), mat.redPlastic, M(-0.012, -0.08, 0, 0, 0, 0.12));
    b.add(rbox(0.022, 0.12, 0.012, 0.005), mat.redPlastic, M(0.012, -0.08, 0.004, 0, 0, -0.12));
    b.add(rbox(0.018, 0.07, 0.004, 0.002), mat.chrome, M(-0.004, 0.03, 0.002, 0, 0, 0.05));
    b.add(rbox(0.012, 0.06, 0.006, 0.002), mat.zinc, M(0.006, 0.025, 0.006, 0, 0, -0.08));
    b.pop();
    // hand trowel
    b.push(M(4.42, 1.705, 0.05));
    b.add(cyl(0.013, 0.015, 0.12, 12), mat.ash, M(0, -0.06, 0));
    b.add(cyl(0.004, 0.004, 0.05, 6), mat.zinc, M(0, -0.14, 0.004));
    const ts = new THREE.Shape();
    ts.moveTo(-0.012, 0); ts.lineTo(0.012, 0); ts.bezierCurveTo(0.04, -0.01, 0.042, -0.06, 0.03, -0.11);
    ts.quadraticCurveTo(0.012, -0.15, 0, -0.165); ts.quadraticCurveTo(-0.012, -0.15, -0.03, -0.11); ts.bezierCurveTo(-0.042, -0.06, -0.04, -0.01, -0.012, 0);
    const trowel = new THREE.ExtrudeGeometry(ts, { depth: 0.002, bevelEnabled: false, curveSegments: 8 });
    planarUV(trowel, 'x', 'y');
    const tp = trowel.attributes.position;
    for (let i = 0; i < tp.count; i++) tp.setZ(i, tp.getZ(i) + tp.getX(i) ** 2 * 3);
    trowel.computeVertexNormals();
    b.add(trowel, mat.blade, M(0, -0.16, 0.004));
    b.pop();

    // leaf blower on the bench
    b.push(M(3.25, 0.92, 0.36, 0, 0.35, 0));
    b.add(rbox(0.22, 0.2, 0.2, 0.05), mat.orangePlastic, M(0.1, 0.11, 0));
    b.add(rbox(0.16, 0.08, 0.2, 0.03), mat.blackPlastic, M(0.13, 0.04, 0));
    b.add(cyl(0.085, 0.085, 0.07, sg(20)), mat.blackPlastic, M(-0.02, 0.11, 0, 0, 0, PI / 2));
    b.add(tube([[0.05, 0.2, 0], [0.12, 0.29, 0], [0.22, 0.28, 0], [0.24, 0.2, 0]], 0.015, 16, 8), mat.blackPlastic);
    b.add(cyl(0.036, 0.042, 0.3, sg(16)), mat.orangePlastic, M(-0.2, 0.08, 0, 0, 0, PI / 2 - 0.12));
    b.add(cyl(0.028, 0.035, 0.28, sg(16)), mat.orangePlastic, M(-0.48, 0.045, 0, 0, 0, PI / 2 - 0.12));
    b.add(cyl(0.03, 0.03, 0.02, sg(16)), mat.blackPlastic, M(-0.62, 0.028, 0, 0, 0, PI / 2 - 0.12));
    b.pop();
    // tape measure on bench
    b.push(M(4.46, 0.92, 0.46, 0, 0.6, 0));
    b.add(rbox(0.075, 0.035, 0.075, 0.014), mat.tapeYellow, M(0, 0.0185, 0));
    b.add(rbox(0.06, 0.037, 0.06, 0.02), mat.blackPlastic, M(0.004, 0.0186, 0.004));
    b.add(rbox(0.018, 0.001, 0.022, 0.0004), mat.tapeYellow, M(0.045, 0.004, -0.028));
    b.add(rbox(0.004, 0.008, 0.024, 0.001), mat.zinc, M(0.055, 0.007, -0.028));
    b.pop();
    // coffee mug
    b.add(lathe([[0.001, 0], [0.04, 0], [0.042, 0.005], [0.043, 0.095], [0.038, 0.095], [0.037, 0.01], [0.001, 0.01]], 20), mat.whitePlastic, M(2.45, 0.92, 0.48));
    b.add(new THREE.TorusGeometry(0.025, 0.006, 6, 14), mat.whitePlastic, M(2.495, 0.97, 0.48, 0, 0, 0));
    b.add(cyl(0.037, 0.037, 0.002, 16), mat.gunk, M(2.45, 1.0, 0.48));

    // shelf: toolbox, buckets, gas can
    b.push(M(2.6, 0.194, 0.36));
    b.add(rbox(0.5, 0.2, 0.24, 0.012), mat.toolRed, M(0, 0.1, 0));
    b.add(rbox(0.505, 0.012, 0.245, 0.004), mat.blackPlastic, M(0, 0.16, 0));
    b.add(rbox(0.5, 0.05, 0.24, 0.012), mat.toolRed, M(0, 0.215, 0));
    b.add(tube([[-0.12, 0.24, 0], [-0.1, 0.29, 0], [0.1, 0.29, 0], [0.12, 0.24, 0]], 0.008, 16, 8), mat.blackPlastic);
    for (const s of [-1, 1]) b.add(rbox(0.04, 0.05, 0.012, 0.003), mat.chrome, M(s * 0.18, 0.165, 0.123));
    b.pop();
    const bucket = (mt, u, d, fill) => {
      b.push(M(u, 0.194, d));
      b.add(lathe([[0.001, 0], [0.122, 0], [0.13, 0.006], [0.148, 0.34], [0.156, 0.345], [0.158, 0.36], [0.152, 0.368], [0.146, 0.362], [0.128, 0.014], [0.001, 0.014]], sg(32)), mt);
      for (const y of [0.3, 0.32]) b.add(new THREE.TorusGeometry(0.149 + (y - 0.3) * 0.05, 0.004, 5, sg(32)), mt, M(0, y, 0, PI / 2, 0, 0));
      b.add(tube([[-0.155, 0.32, 0], [-0.1, 0.44, 0.05], [0, 0.47, 0.07], [0.1, 0.44, 0.05], [0.155, 0.32, 0]], 0.0025, 20, 5), mat.zinc);
      if (fill) b.add(cyl(0.14, 0.14, 0.01, sg(24)), fill, M(0, 0.25, 0));
      b.pop();
    };
    bucket(mat.orangePlastic, 3.3, 0.33, mat.gunk);
    bucket(mat.whitePlastic, 3.68, 0.36, mat.grass);
    b.push(M(4.18, 0.194, 0.34, 0, 0.3, 0));
    b.add(rbox(0.3, 0.26, 0.17, 0.035), mat.redPlastic, M(0, 0.13, 0));
    b.add(tube([[-0.08, 0.24, 0], [-0.05, 0.3, 0], [0.05, 0.3, 0], [0.08, 0.24, 0]], 0.012, 12, 8), mat.redPlastic);
    b.add(cyl(0.018, 0.02, 0.12, 10), mat.yellowPlastic, M(0.14, 0.3, 0, 0, 0, -0.7));
    b.pop();

    // bow rake leaning against the wall past the bench
    b.push(M(4.78, 0, 0.42, -0.27, 0, 0.04));
    b.add(cyl(0.014, 0.015, 1.5, 12), mat.ash, M(0, 0.82, 0));
    b.add(cyl(0.017, 0.015, 0.1, 10), mat.powder, M(0, 0.1, 0));
    b.add(rbox(0.4, 0.016, 0.016, 0.004), mat.powder, M(0, 0.07, 0.0));
    for (const s of [-1, 1]) b.add(tube([[0, 0.14, 0], [s * 0.1, 0.12, 0], [s * 0.18, 0.08, 0]], 0.005, 8, 6), mat.powder);
    for (let i = 0; i < 14; i++) b.add(cyl(0.004, 0.003, 0.07, 6), mat.powder, M(-0.182 + i * 0.028, 0.035, 0.012, 0.4, 0, 0));
    b.pop();

    const g = b.build({ name: 'services-bench' });
    wall.add(g);
    // stencil sign face
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.11), decalMat(stencilTex('SERVICES', { w: 1024, h: 180, color: '#f2c21b', seed: 17, wear: 0.4 })));
    sign.position.set(UC, 2.205, 0.0442);
    wall.add(sign);
  }

  // ---- round point shovel -> landscaping
  {
    const b = new Bag();
    hook(b, 2.43, 2.12, 0.075, 0.02);
    b.push(M(2.43, 1.115, 0.07));
    // blade: extruded outline, dished and lifted
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(0.05, 0.004, 0.105, 0.05, 0.112, 0.13);
    s.lineTo(0.114, 0.276); s.lineTo(0.03, 0.29); s.lineTo(-0.03, 0.29); s.lineTo(-0.114, 0.276); s.lineTo(-0.112, 0.13);
    s.bezierCurveTo(-0.105, 0.05, -0.05, 0.004, 0, 0);
    const bl = new THREE.ExtrudeGeometry(s, { depth: 0.0025, bevelEnabled: false, curveSegments: 10 });
    planarUV(bl, 'x', 'y');
    const p = bl.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, p.getZ(i) + 1.0 * x * x + (0.29 - y) * 0.16); }
    bl.computeVertexNormals();
    b.add(bl, mat.blade);
    b.add(cyl(0.006, 0.006, 0.228, 8), mat.blade, M(0, 0.283, 0.003, 0, 0, PI / 2));
    b.add(rbox(0.03, 0.14, 0.012, 0.005), mat.blade, M(0, 0.23, 0.0, -0.05, 0, 0));
    b.add(cyl(0.019, 0.026, 0.17, 12), mat.steelDark, M(0, 0.37, -0.004));
    b.add(cyl(0.018, 0.018, 0.47, sg(14)), mat.ash, M(0, 0.68, -0.004));
    // D-grip: steel Y arms + ash crossbar
    b.add(tube([[-0.052, 1.02, -0.004], [-0.05, 0.96, -0.004], [-0.025, 0.9, -0.004], [0, 0.87, -0.004], [0.025, 0.9, -0.004], [0.05, 0.96, -0.004], [0.052, 1.02, -0.004]], 0.009, 24, 8), mat.steelDark);
    b.add(cyl(0.02, 0.02, 0.05, 10), mat.steelDark, M(0, 0.86, -0.004));
    b.add(cyl(0.016, 0.016, 0.1, 12), mat.ash, M(0, 1.025, -0.004, 0, 0, PI / 2));
    b.add(rbox(0.115, 0.022, 0.024, 0.008), mat.steelDark, M(0, 1.025, -0.004));
    b.pop();
    const g = b.build({ name: 'svc-shovel' });
    // crossbar sleeve drawn last so wood shows between the steel tabs
    wall.add(g);
    hotspot(g, { id: 'svc-landscaping', views: { services: { item: 'landscaping', label: 'Landscaping' } } });
  }

  // ---- pressure washer gun + wand + coiled hose -> washing
  {
    const b = new Bag();
    hook(b, 2.745, 2.0, 0.06);
    b.push(M(2.72, 1.88, 0.062, 0, 0, 0.03));
    sprayGun(b); wand(b, 0.82);
    b.pop();
    // coiled high-pressure hose on a large hook
    b.add(tube([[3.04, 2.03, 0.028], [3.04, 2.03, 0.09], [3.04, 2.06, 0.1]], 0.004, 10, 6), mat.zinc);
    const pts = [];
    const loops = 6, N = 260;
    for (let i = 0; i <= N; i++) {
      const t = i / N, th = 2 * PI * loops * t, rr = 0.165 + 0.012 * Math.sin(t * 17) + 0.01 * (t - 0.5);
      pts.push([3.04 + rr * Math.sin(th) * 0.92, 2.03 - rr * (1 - Math.cos(th)) * 1.12, 0.05 + t * 0.045 + 0.006 * Math.sin(th * 1.5)]);
    }
    const head = [[2.95, 1.38, 0.06], [2.97, 1.55, 0.055], [2.99, 1.8, 0.052], [3.02, 1.97, 0.05]];
    const tail = [[3.1, 1.95, 0.1], [3.13, 1.7, 0.1], [3.16, 1.45, 0.094], [3.17, 1.32, 0.09]];
    b.add(tube([...head, ...pts.slice(4, -4), ...tail], 0.0058, HQ ? 900 : 500, 6), mat.hose);
    b.add(cyl(0.011, 0.011, 0.05, 12), mat.brass, M(2.95, 1.355, 0.06));
    b.add(cyl(0.011, 0.011, 0.05, 12), mat.brass, M(3.17, 1.295, 0.09));
    const g = b.build({ name: 'svc-washer' });
    wall.add(g);
    hotspot(g, { id: 'svc-washing', views: { services: { item: 'washing', label: 'Pressure washing' } } });
  }

  // ---- K-style gutter section + scoop -> gutters
  {
    const b = new Bag();
    for (const u of [3.52, 4.28]) hook(b, u, 1.83, 0.07, 0.03);
    b.push(M(4.43, 1.832, 0.034));
    gutterSection(b, 1.06, { cap: true });
    b.pop();
    // gutter scoop (orange plastic)
    hook(b, 3.66, 1.72, 0.05);
    b.push(M(3.66, 1.62, 0.0, 0, 0, 0.1));
    const scoopProf = []; for (let i = 0; i <= 18; i++) { const a = PI * i / 18; scoopProf.push(V2(Math.cos(a) * 0.045, -Math.sin(a) * 0.04)); }
    const sc = profileSweep(scoopProf, 0.17);
    const sp = sc.attributes.position; // taper the scoop toward its rounded front lip
    for (let i = 0; i < sp.count; i++) { const t = sp.getZ(i) / 0.17; sp.setX(i, sp.getX(i) * (1 - 0.25 * t)); sp.setY(i, sp.getY(i) * (1 - 0.45 * t)); }
    sc.computeVertexNormals();
    b.push(M(0, 0, 0.055, -0.3, 0, 0));
    b.add(sc, mat.scoop, M(0, -0.06, 0, PI / 2, 0, 0));
    b.add(rbox(0.09, 0.012, 0.045, 0.004), mat.orangePlastic, M(0, -0.058, -0.02));
    const dirt = rbox(0.06, 0.05, 0.025, 0.01); lumpify(dirt, 0.008, 25, 4);
    b.add(dirt, mat.gunk, M(0, -0.16, -0.018));
    b.pop();
    b.add(rbox(0.026, 0.13, 0.016, 0.007), mat.orangePlastic, M(0, 0.01, 0.045));
    b.add(new THREE.TorusGeometry(0.013, 0.0045, 6, 12), mat.orangePlastic, M(0, 0.085, 0.045));
    b.pop();
    const g = b.build({ name: 'svc-gutter' });
    wall.add(g);
    hotspot(g, { id: 'svc-gutters', views: { services: { item: 'gutters', label: 'Gutter cleaning' } } });
  }

  // ---- sample solar panel on the bench -> solar-svc
  {
    const b = new Bag();
    b.push(M(4.12, 0.922, 0.12, -0.2, 0, 0));
    solarPanel(b, 0.5, 0.4, mat.solarCellsSmall, 0.03);
    b.pop();
    b.add(rbox(0.5, 0.012, 0.03, 0.004), mat.rubber, M(4.12, 0.926, 0.135));
    const g = b.build({ name: 'svc-solar' });
    wall.add(g);
    hotspot(g, { id: 'svc-solar', views: { services: { item: 'solar-svc', label: 'Solar' } } });
  }

  // ---- walk-behind mower -> lawn
  {
    const b = new Bag();
    // deck
    const deck = rbox(0.54, 0.11, 0.6, 0.045); boxUV(deck, 2);
    b.add(deck, mat.mowerPaint, M(0, 0.155, 0.01));
    const dome = lathe([[0.25, 0.0], [0.246, 0.018], [0.225, 0.042], [0.175, 0.062], [0.09, 0.074], [0.0, 0.077]], sg(40)); boxUV(dome, 2);
    b.add(dome, mat.mowerPaint, M(0, 0.205, -0.01, 0, 0, 0, [1.02, 1, 1.1]));
    b.add(rbox(0.5, 0.05, 0.05, 0.02), mat.mowerPaint, M(0, 0.14, 0.31));
    b.add(rbox(0.28, 0.12, 0.03, 0.01), mat.blackPlastic, M(0, 0.2, -0.3, -0.15, 0, 0));
    b.add(rbox(0.52, 0.02, 0.58, 0.008), mat.steelDark, M(0, 0.095, 0.01));
    // wheels + height levers
    for (const s of [-1, 1]) {
      wheel(b, 0.09, 0.045, s, mat.greyPlastic, s * 0.3, 0.09, 0.21);
      wheel(b, 0.1, 0.048, s, mat.greyPlastic, s * 0.3, 0.1, -0.22);
      b.add(rbox(0.012, 0.1, 0.02, 0.004), mat.zinc, M(s * 0.275, 0.2, -0.2, 0.3, 0, 0));
      b.add(cyl(0.012, 0.012, 0.03, 10), mat.greyPlastic, M(s * 0.275, 0.25, -0.18));
    }
    // engine
    b.push(M(0, 0.278, -0.02, 0, 0.3, 0)); smallEngine(b); b.pop();
    // handle (one bent tube), knobs, bail
    b.add(tube([[-0.235, 0.21, -0.27], [-0.235, 0.55, -0.6], [-0.235, 0.9, -0.9], [-0.2, 0.99, -0.965], [0, 1.0, -0.98], [0.2, 0.99, -0.965], [0.235, 0.9, -0.9], [0.235, 0.55, -0.6], [0.235, 0.21, -0.27]], 0.0125, 90, 8), mat.powder);
    for (const s of [-1, 1]) {
      b.add(cyl(0.024, 0.024, 0.035, 12), mat.blackPlastic, M(s * 0.262, 0.57, -0.615, 0, 0, PI / 2));
      b.add(rbox(0.03, 0.05, 0.05, 0.01), mat.blackPlastic, M(s * 0.235, 0.22, -0.27));
    }
    b.add(tube([[-0.235, 0.93, -0.905], [-0.2, 1.0, -0.87], [0, 1.012, -0.86], [0.2, 1.0, -0.87], [0.235, 0.93, -0.905]], 0.007, 30, 6), mat.chrome);
    // pull cord: engine -> rope guide -> T handle
    b.add(tube([[0.03, 0.51, -0.05], [0.12, 0.6, -0.35], [0.2, 0.69, -0.64], [0.228, 0.72, -0.715]], 0.0025, 24, 5), mat.whitePlastic);
    b.add(rbox(0.02, 0.03, 0.02, 0.005), mat.blackPlastic, M(0.235, 0.72, -0.72));
    b.add(rbox(0.1, 0.022, 0.03, 0.009), mat.blackPlastic, M(0.19, 0.735, -0.7, 0, 0.3, 0.2));
    b.add(tube([[-0.225, 0.93, -0.9], [-0.215, 0.6, -0.62], [-0.14, 0.36, -0.25], [-0.1, 0.33, -0.1]], 0.003, 24, 5), mat.blackPlastic);
    // grass bag: rigid top + saggy mesh fabric
    const bag = rbox(0.42, 0.28, 0.46, 0.07, 3);
    lumpify(bag, 0.015, 7, 5, (x, y, z) => (y < 0 ? -0.02 * (1 - (x / 0.21) ** 2) : 0));
    smoothNormals(bag); boxUV(bag, 5);
    b.add(bag, mat.fabricMesh, M(0, 0.38, -0.55, 0.12, 0, 0));
    b.add(rbox(0.44, 0.03, 0.47, 0.012), mat.blackPlastic, M(0, 0.53, -0.53, 0.12, 0, 0));
    b.add(rbox(0.1, 0.03, 0.03, 0.01), mat.blackPlastic, M(0, 0.56, -0.74, 0.12, 0, 0));
    const g = b.build({ name: 'svc-mower' });
    place(g, -2.95, 0, -1.85, 0, PI + 0.35, 0);
    add(g);
    hotspot(g, { id: 'svc-lawn', views: { services: { item: 'lawn', label: 'Lawn care' } } });
  }

  // ---- paver pallet -> pavers
  {
    const b = new Bag();
    // stringer pallet 1.0 (x) x 1.2 (z)
    const board = (len, w, t) => { const g = rbox(len, t, w, 0.004); boxUV(g, 1.2, 4); return g; };
    for (let i = 0; i < 7; i++) b.add(board(1.0, 0.095, 0.02), mat.pallet, M(0, 0.13, -0.55 + i * (1.1 / 6), 0, 0, (i % 3 - 1) * 0.004));
    for (const x of [-0.45, 0, 0.45]) b.add(board(1.2, 0.09, 0.1), mat.pallet, M(x, 0.07, 0, 0, PI / 2, 0));
    for (const z of [-0.55, 0, 0.55]) b.add(board(1.0, 0.095, 0.02), mat.pallet, M(0, 0.01, z));
    // torn stretch wrap around the stack
    {
      const hx = 0.463, hz = 0.575, N = 150, R = 7, r = rng(55);
      const per = 2 * (2 * hx + 2 * hz);
      const pos = [], uv = [], idx = [];
      const perim = (t) => {
        let d = t * per;
        if (d < 2 * hx) return [-hx + d, hz, 0, 1]; d -= 2 * hx;
        if (d < 2 * hz) return [hx, hz - d, 1, 0]; d -= 2 * hz;
        if (d < 2 * hx) return [hx - d, -hz, 0, -1]; d -= 2 * hx;
        return [-hx, -hz + d, -1, 0];
      };
      const tops = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        let top = 0.54 + 0.12 * Math.sin(t * 13.1) + (r() - 0.5) * 0.05;
        if (t > 0.3 && t < 0.42) top = 0.1 + (r()) * 0.05;
        if (t > 0.27 && t <= 0.3) top = 0.54 - (t - 0.27) / 0.03 * 0.4;
        if (t >= 0.42 && t < 0.45) top = 0.14 + (t - 0.42) / 0.03 * 0.4;
        tops.push(top);
      }
      for (let i = 0; i <= N; i++) {
        const [x, z, nx, nz] = perim(i / N);
        for (let j = 0; j <= R; j++) {
          const y = 0.08 + tops[i] * j / R;
          const bulge = 0.006 + 0.01 * Math.sin(y * 40 + i * 0.7) * (j / R);
          pos.push(x + nx * bulge, y, z + nz * bulge); uv.push(i / N, j / R);
        }
      }
      for (let i = 0; i < N; i++) for (let j = 0; j < R; j++) {
        const a = i * (R + 1) + j, c = a + R + 1;
        idx.push(a, c, a + 1, a + 1, c, c + 1);
      }
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      wg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      wg.setIndex(idx); wg.computeVertexNormals();
      b.add(wg, mat.wrap, M(0, 0.06, 0));
      // loose torn flap on the floor
      const fl = new THREE.PlaneGeometry(0.4, 0.25, 6, 4);
      lumpify(fl, 0.02, 8, 5);
      b.add(fl, mat.wrap, M(0.62, 0.012, -0.2, -PI / 2, 0, 0.5));
    }
    const g = b.build({ name: 'svc-pavers' });
    // instanced pavers
    const pg = paverGeometry();
    const inst = [];
    const r = rng(42);
    const layers = 10;
    for (let k = 0; k < layers; k++) {
      const alongX = k % 2 === 0;
      const nx = alongX ? 4 : 8, nz = alongX ? 10 : 5;
      const sx = alongX ? 0.225 : 0.1125, sz = alongX ? 0.1125 : 0.225;
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const edge = i === 0 || j === 0 || i === nx - 1 || j === nz - 1;
        if (k < layers - 1 && !edge) continue;
        if (k === layers - 1 && r() < 0.3) continue;
        const x = -0.45 + sx * (i + 0.5) + (r() - 0.5) * 0.004, z = -0.5625 + sz * (j + 0.5) + (r() - 0.5) * 0.004;
        inst.push([x, 0.14 + k * 0.06, z, 0, alongX ? 0 : PI / 2 + (r() - 0.5) * 0.02, 0]);
      }
    }
    // a few loose ones on top and leaning against the pallet
    inst.push([0.1, 0.14 + layers * 0.06, 0.1, 0, 0.7, 0], [-0.2, 0.14 + layers * 0.06, -0.25, 0, 2.1, 0]);
    inst.push([0.58, 0.0, 0.3, 0, 0.2, 1.2], [0.56, 0.0, 0.08, 0, -0.1, 1.25], [0.62, 0, -0.45, 0, 0.9, 0]);
    const im = new THREE.InstancedMesh(pg, mat.paver, inst.length);
    inst.forEach((t, i) => { im.setMatrixAt(i, M(...t)); im.setColorAt(i, paverColors(r)); });
    im.castShadow = true; im.receiveShadow = true;
    g.add(im);
    place(g, -2.9, 0, -5.9, 0, 0.04, 0);
    add(g);
    hotspot(g, { id: 'svc-pavers', views: { services: { item: 'pavers', label: 'Pavers & hardscape' } } });
  }

  // ---- wheelie bin, lid propped open by junk -> go to dumpster
  {
    const b = new Bag();
    // body: tapered rounded box (front = local +z)
    const body = rbox(0.58, 0.96, 0.72, 0.045, 3);
    const p = body.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) + 0.48) / 0.96;
      p.setX(i, p.getX(i) * (0.84 + 0.16 * t));
      p.setZ(i, p.getZ(i) * (0.8 + 0.2 * t) + (1 - t) * -0.04);
    }
    smoothNormals(body); boxUV(body, 1.5);
    b.add(body, mat.binBody, M(0, 0.5, 0));
    for (const s of [-1, 1]) b.add(rbox(0.1, 0.03, 0.06, 0.01), mat.binBody, M(s * 0.17, 0.015, 0.26));
    b.add(rbox(0.62, 0.05, 0.76, 0.015), mat.binBody, M(0, 0.99, 0));
    b.add(rbox(0.55, 0.004, 0.68, 0.002), mat.binInside, M(0, 1.016, 0.005));
    for (const x of [-0.12, 0.12]) b.add(rbox(0.05, 0.7, 0.02, 0.01), mat.binBody, M(x, 0.56, 0.34, -0.1, 0, 0));
    // wheels + axle + handle at the back
    for (const s of [-1, 1]) wheel(b, 0.1, 0.05, s, mat.greyPlastic, s * 0.265, 0.1, -0.33);
    b.add(cyl(0.01, 0.01, 0.56, 8), mat.zinc, M(0, 0.1, -0.33, 0, 0, PI / 2));
    b.add(cyl(0.017, 0.017, 0.5, 10), mat.binLid, M(0, 1.0, -0.42, 0, 0, PI / 2));
    for (const s of [-1, 1]) b.add(rbox(0.03, 0.06, 0.06, 0.01), mat.binBody, M(s * 0.25, 0.99, -0.4));
    // lid, hinged at the back, propped up
    b.push(M(0, 1.02, -0.39, -0.3, 0, 0));
    const lid = rbox(0.64, 0.035, 0.8, 0.015); boxUV(lid, 1.5);
    b.add(lid, mat.binLid, M(0, 0.017, 0.4));
    b.add(rbox(0.62, 0.05, 0.02, 0.008), mat.binLid, M(0, -0.01, 0.795));
    b.add(rbox(0.16, 0.012, 0.03, 0.006), mat.binLid, M(0, -0.03, 0.8));
    b.pop();
    // junk propping the lid: a broken board, a cardboard flap, a bag, a chair leg
    b.add(boxUV(rbox(0.085, 0.022, 0.6, 0.004), 2), mat.pine, M(0.13, 1.1, 0.12, -0.42, 0.25, 0.1));
    const flap = rbox(0.3, 0.004, 0.25, 0.001); boxUV(flap, 2);
    b.add(flap, mat.cardboard, M(-0.12, 1.07, 0.3, -0.5, -0.2, 0.15));
    const jb = new THREE.SphereGeometry(0.2, 16, 12); lumpify(jb, 0.03, 6, 8); smoothNormals(jb);
    b.add(jb, mat.bagPlastic, M(-0.06, 1.0, 0.05, 0, 0, 0, [1.2, 0.55, 1.1]));
    b.add(cyl(0.015, 0.012, 0.42, 8), mat.couchLeg, M(0.22, 1.12, 0.28, 0.9, 0, -0.3));
    const g = b.build({ name: 'svc-bin' });
    place(g, -3.15, 0, -0.55, 0, PI / 2 - 0.15, 0);
    add(g);
    hotspot(g, { id: 'hot-bin', views: { services: { go: 'dumpster', label: 'See every service' } } });
  }

  // ---- group hotspot for the whole services area (street view)
  {
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.35, 5.7), new THREE.MeshBasicMaterial({ visible: false }));
    box.name = 'hot-services-volume';
    box.position.set(-2.9, 1.175, -3.65);
    add(box);
    hotspot(box, { id: 'hot-services', anchor: [-3.3, 2.45, -3.4], views: { garage: { go: 'services', label: 'Services' } } });
  }

  // =============================================================== PART B: roll-off dumpster
  const DX = -5.0, DZ = 5.0;
  const dump = new THREE.Group();
  dump.name = 'dumpster';
  dump.position.set(DX, 0, DZ);
  add(dump);

  const FLOOR = 0.14, TOP = 1.39, SV = 1 / (1.45 - FLOOR);
  const paintUV = (g) => boxUV(g, 1 / 5, SV, 0.5, -FLOOR * SV);
  const placed = (g, m) => g.applyMatrix4(m);
  const heapY = (x, z) => 0.94 + 0.3 * (1 - 0.45 * (x / 1.1) ** 2 - 0.55 * (z / 2.3) ** 4) + (fbm(x * 1.7 + 5, 0, z * 1.7 + 5, 9) - 0.5) * 0.24;

  {
    const b = new Bag();
    const P = (g, m) => b.add(paintUV(placed(g, m)), mat.dumpPaint);
    // floor
    P(rbox(2.24, 0.03, 4.64, 0.006), M(0, FLOOR + 0.015, 0.11));
    // side walls (trapezoid profile, extruded 12 mm)
    const side = new THREE.Shape([V2(-2.2, FLOOR), V2(2.42, FLOOR), V2(2.5, TOP), V2(-2.5, TOP)]);
    for (const s of [-1, 1]) {
      const g = new THREE.ExtrudeGeometry(side, { depth: 0.012, bevelEnabled: false });
      P(g, M(s > 0 ? 1.12 : -1.108, 0, 0, 0, -PI / 2, 0));
      // vertical ribs
      for (const z of [-1.9, -1.27, -0.63, 0, 0.63, 1.27, 1.9]) P(rbox(0.055, TOP - FLOOR - 0.08, 0.085, 0.008), M(s * 1.147, (TOP + FLOOR) / 2 - 0.02, z));
      // top rail and bottom sill
      P(rbox(0.1, 0.1, 5.04, 0.012), M(s * 1.155, 1.4, 0));
      P(rbox(0.08, 0.1, 4.64, 0.01), M(s * 1.145, FLOOR + 0.05, 0.11));
    }
    // slanted front wall with ribs
    const fa = -Math.atan2(0.3, TOP - FLOOR), flen = Math.hypot(0.3, TOP - FLOOR);
    P(rbox(2.25, flen, 0.012, 0.004), M(0, (TOP + FLOOR) / 2, -2.35, fa, 0, 0));
    const fn = V(0, Math.sin(fa), -Math.cos(fa));
    for (const x of [-0.7, 0, 0.7]) P(rbox(0.085, flen - 0.08, 0.05, 0.008), M(x + fn.x * 0.03, (TOP + FLOOR) / 2 + fn.y * 0.03, -2.35 + fn.z * 0.03, fa, 0, 0));
    P(rbox(2.42, 0.1, 0.1, 0.012), M(0, 1.4, -2.52));
    // rear double doors (slight slant)
    const ra = Math.atan2(0.08, TOP - FLOOR);
    const zc = (y) => 2.435 + (y - FLOOR) * (0.08 / (TOP - FLOOR));
    for (const s of [-1, 1]) {
      const cx = s * 0.5525;
      P(rbox(1.1, 1.22, 0.03, 0.006), M(cx, 0.765, zc(0.765), ra, 0, 0));
      for (const y of [0.45, 0.8, 1.17]) P(rbox(1.0, 0.07, 0.045, 0.008), M(cx, y, zc(y) + 0.02, ra, 0, 0));
      P(rbox(0.06, 1.2, 0.05, 0.008), M(s * 0.03, 0.765, zc(0.765) + 0.02, ra, 0, 0));
      P(rbox(0.09, 1.22, 0.09, 0.01), M(s * 1.16, 0.765, zc(0.765), ra, 0, 0));
      // hinges: knuckles on the corner post + straps across the leaf
      for (const y of [0.35, 0.8, 1.22]) {
        b.add(cyl(0.028, 0.028, 0.13, 12), mat.steelDark, M(s * 1.125, y, zc(y) + 0.055));
        P(rbox(0.36, 0.06, 0.014, 0.004), M(s * 0.93, y, zc(y) + 0.045, ra, 0, 0));
      }
      // cam-lock rod + handle on each leaf
      b.add(cyl(0.017, 0.017, 1.2, 10), mat.steelDark, M(s * 0.14, 0.76, zc(0.76) + 0.06, ra, 0, 0));
      for (const y of [0.22, 1.3]) b.add(rbox(0.07, 0.04, 0.05, 0.006), mat.steelDark, M(s * 0.14, y, zc(y) + 0.05));
      b.add(rbox(0.035, 0.3, 0.03, 0.008), mat.steelDark, M(s * 0.14 + s * 0.05, 0.36, zc(0.36) + 0.085, ra, 0, s * 0.35));
    }
    P(rbox(2.42, 0.1, 0.1, 0.012), M(0, 1.4, 2.53));
    // reflective tape on the rear posts
    for (const s of [-1, 1]) b.add(rbox(0.06, 0.45, 0.004, 0.001), mat.tapeReflect, M(s * 1.16, 1.0, zc(1.0) + 0.048, ra, 0, 0));

    // undercarriage: hook rails, cross members, rollers, lift hook
    const D = mat.steelDark;
    for (const s of [-1, 1]) {
      const x = s * 0.52;
      b.add(rbox(0.014, 0.1, 4.75, 0.003), D, M(x, 0.075, 0.08));
      b.add(rbox(0.1, 0.014, 4.75, 0.003), D, M(x, 0.13, 0.08));
      b.add(rbox(0.1, 0.014, 4.75, 0.003), D, M(x, 0.025, 0.08));
      b.add(cyl(0.1, 0.1, 0.16, sg(20)), D, M(x, 0.1, 2.3, 0, 0, PI / 2));
      for (const o of [-1, 1]) b.add(rbox(0.012, 0.2, 0.3, 0.004), D, M(x + o * 0.09, 0.12, 2.3));
    }
    for (let z = -2.0; z <= 2.2; z += 0.6) b.add(rbox(2.2, 0.07, 0.07, 0.006), D, M(0, 0.1, z));
    b.add(tube([[-0.2, 0.2, -2.27], [-0.16, 0.5, -2.45], [0, 0.62, -2.56], [0.16, 0.5, -2.45], [0.2, 0.2, -2.27]], 0.03, 24, 8), D);
    b.add(rbox(1.2, 0.12, 0.08, 0.01), D, M(0, 0.1, -2.3));

    const g = b.build({ name: 'dumpster-body' });
    dump.add(g);

    // decals: +x side (driveway) and +z end (street)
    const main = stencilTex('PRISTINE', { seed: 31, h: 380 });
    const sub = stencilTex('JUNK REMOVAL · 20 YD', { seed: 32, h: 200, w: 2048, weight: 700 });
    const warn = labelPlate([['NO HAZARDOUS', 52], ['WASTE · NO PAINT', 44], ['NO TIRES', 44]]);
    // All decals merged per material (one draw call each).
    const db = new Bag();
    const addDecal = (m, w, h, x, y, z, ry, rx = 0, geo) => db.add(geo || new THREE.PlaneGeometry(w, h), m, M(x, y, z, rx, ry, 0, 1, 'YXZ'));
    // Side stencils are painted over the ribs too: the wall plane plus a cropped strip on each rib face.
    const RIBS = [-1.9, -1.27, -0.63, 0, 0.63, 1.27, 1.9];
    const sideDecal = (m, w, h, y, s, zc = 0) => {
      addDecal(m, w, h, s * 1.1213, y, zc, s * PI / 2);
      for (const z of RIBS) {
        if (Math.abs(z - zc) > w / 2 - 0.035) continue;
        const pg = new THREE.PlaneGeometry(0.07, h);
        const uv = pg.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
          const lx = (uv.getX(i) - 0.5) * 0.07; // local x offset of this vertex
          const wz = z - s * lx; // world z (local +x maps to -s*z)
          uv.setX(i, 0.5 - s * (wz - zc) / w);
        }
        addDecal(m, 0, 0, s * 1.1757, y, z, s * PI / 2, 0, pg);
      }
    };
    const mMain = decalMat(main), mSub = decalMat(sub);
    sideDecal(mMain, 3.3, 0.61, 0.98, 1);
    sideDecal(mSub, 2.7, 0.26, 0.55, 1, 0.16);
    sideDecal(mMain, 3.3, 0.61, 0.98, -1);
    addDecal(decalMat(warn, { transparent: false }), 0.34, 0.2, 1.1215, 0.55, -1.585, PI / 2);
    addDecal(mMain, 1.75, 0.28, 0, 1.0, zc(1.0) + 0.0158, 0, ra);
    addDecal(mSub, 1.7, 0.15, 0, 0.64, zc(0.64) + 0.0158, 0, ra);
    const decals = db.build({ cast: false, name: 'dumpster-decals' });
    dump.add(decals);
  }

  // ---- junk heap base + filler (not clickable individually)
  {
    const b = new Bag();
    const heap = new THREE.PlaneGeometry(2.2, 4.62, 24, 48);
    heap.rotateX(-PI / 2);
    const p = heap.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, heapY(p.getX(i), p.getZ(i)));
    heap.computeVertexNormals();
    heap.attributes.uv.array.forEach((v, i, a) => (a[i] = v * (i % 2 ? 4 : 2)));
    b.add(heap, mat.debris, M(0, 0, 0.06));
    mat.debris.map.wrapS = mat.debris.map.wrapT = THREE.RepeatWrapping;
    const r = rng(808);
    // cardboard boxes
    for (const [x, z, s] of [[0.68, -0.95, 0.4], [-0.75, 0.9, 0.45], [0.66, 2.15, 0.35], [-0.2, -2.15, 0.42], [0.72, 0.95, 0.3]]) {
      const g = rbox(s, s * 0.8, s * 1.2, 0.01); lumpify(g, 0.012, 6, Math.floor(r() * 100)); boxUV(g, 2);
      b.add(g, mat.cardboard, M(x, heapY(x, z) + s * 0.25, z, (r() - 0.5) * 0.6, r() * 3, (r() - 0.5) * 0.6));
    }
    // lumber offcuts sticking out
    for (const [x, z, l, rx, ry, rz] of [[-0.85, -0.3, 1.6, 0.05, 0.08, -0.4], [0.6, 1.3, 1.2, 0.45, 0.3, 0.15], [-0.4, -1.3, 1.0, -0.25, 1.2, 0.3], [0.1, 2.2, 1.6, 0.05, 1.45, 0.12], [0.85, -2.05, 1.0, 0.35, 0.1, 0.5]]) {
      const g = rbox(0.089, 0.038, l, 0.004); boxUV(g, 2, 1).attributes.uv.array.forEach((v, i, a) => (a[i] = i % 2 ? v : v));
      b.add(g, mat.pine, M(x, heapY(x, z) + 0.12, z, rx, ry, rz));
    }
    // drywall scraps, an old tyre, a rolled carpet
    b.add(boxUV(rbox(0.9, 0.013, 0.6, 0.003), 2), mat.drywall, M(0.7, heapY(0.7, 1.0) + 0.1, 1.0, 0.3, 0.4, -0.25));
    b.add(boxUV(rbox(0.7, 0.013, 0.5, 0.003), 2), mat.drywall, M(-0.9, heapY(-0.9, -0.6) + 0.25, -0.6, 0.1, 0.2, 1.1));
    const tl = [[0.19, -0.09], [0.29, -0.09], [0.31, -0.07], [0.32, -0.03], [0.32, 0.03], [0.31, 0.07], [0.29, 0.09], [0.19, 0.09]];
    b.add(lathe(tl, sg(32)), mat.tire, M(0.6, heapY(0.6, 2.05) + 0.05, 2.05, 0.35, 0, 0.2));
    b.add(cyl(0.12, 0.12, 1.5, sg(18)), mat.carpet, M(-0.85, heapY(-0.85, 0.2) + 0.2, 0.2, 0.2, 0, 0.3));
    // assorted chunks: plywood, drywall, a mattress, a broken chair, more bags of debris
    const mt = new THREE.MeshStandardMaterial({ map: surfaceTex('#d8d2c4', { seed: 101, dirt: 0.25, dirtColor: '90,70,40', extra: (g, w, h) => { g.strokeStyle = 'rgba(80,90,120,0.35)'; g.lineWidth = 6; for (let x = 0; x < w; x += 48) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } } }), roughness: 0.95 });
    const mattress = rbox(1.35, 0.2, 1.9, 0.07, 3); lumpify(mattress, 0.02, 3, 12); smoothNormals(mattress); boxUV(mattress, 1.2);
    b.add(mattress, mt, M(-0.55, heapY(-0.55, -0.9) - 0.12, -0.9, 0.35, 0.1, 0.9));
    for (let i = 0; i < 12; i++) {
      const x = (r() - 0.5) * 1.8, z = (r() - 0.5) * 4.2, k = r();
      const w = 0.2 + r() * 0.5, d = 0.2 + r() * 0.6;
      const g = k < 0.35 ? rbox(w, 0.018, d, 0.004) : k < 0.6 ? rbox(w * 0.6, w * 0.5, d * 0.7, 0.01) : rbox(0.09, 0.04, d + 0.4, 0.004);
      if (k >= 0.35 && k < 0.6) lumpify(g, 0.01, 6, i);
      boxUV(g, 2);
      b.add(g, k < 0.35 ? mat.drywall : k < 0.6 ? mat.cardboard : mat.pine, M(x, heapY(x, z) + 0.03, z, (r() - 0.5) * 0.8, r() * 6, (r() - 0.5) * 0.8));
    }
    b.push(M(0.72, heapY(0.72, -1.95) + 0.1, -1.95, 0.9, 0.4, 0.3));
    b.add(boxUV(rbox(0.42, 0.03, 0.4, 0.006), 2), mat.pine);
    for (const [x, z] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]]) b.add(cyl(0.017, 0.014, 0.42, 8), mat.couchLeg, M(x, -0.22, z));
    b.add(boxUV(rbox(0.42, 0.4, 0.03, 0.006), 2), mat.pine, M(0, 0.2, -0.19));
    b.pop();
    const g = b.build({ name: 'dumpster-heap' });
    dump.add(g);
  }

  // ---- junk items: each one a service
  const junk = (name, id, item, label, g, [x, y, z], [rx, ry, rz]) => {
    place(g, x, y, z, rx, ry, rz); g.name = name;
    dump.add(g);
    hotspot(g, { id, views: { dumpster: { item, label } } });
    return g;
  };

  // old plaid couch -> junk
  {
    const b = new Bag();
    const up = (w, h, d, r, x, y, z, rx = 0, ry = 0, rz = 0, amp = 0.012, seed = 1) => {
      const g = rbox(w, h, d, r, 3); lumpify(g, amp, 5, seed); smoothNormals(g); boxUV(g, 1.8);
      b.add(g, mat.fabric, M(x, y, z, rx, ry, rz));
    };
    up(1.9, 0.3, 0.86, 0.05, 0, 0.22, 0, 0, 0, 0, 0.01, 1);
    for (const s of [-1, 1]) up(0.2, 0.62, 0.9, 0.08, s * 0.85, 0.35, 0.01, 0, 0, s * 0.03, 0.015, 2 + s);
    up(1.52, 0.55, 0.22, 0.08, 0, 0.6, -0.33, -0.18, 0, 0, 0.015, 5);
    [[-0.5, 0.02, 0], [0, 0, 0.02], [0.5, 0.05, -0.06]].forEach(([x, dy, rz], i) => up(0.5, 0.16, 0.64, 0.06, x, 0.445 + dy, 0.08, 0.03 * i, 0, rz, 0.02, 10 + i));
    [[-0.5, 0], [0, 0.05], [0.5, -0.1]].forEach(([x, rz], i) => up(0.5, 0.42, 0.17, 0.07, x, 0.74, -0.2, -0.25, 0, rz, 0.022, 20 + i));
    for (const sx of [-0.85, 0.85]) for (const sz of [-0.36, 0.36]) b.add(cyl(0.022, 0.015, 0.08, 8), mat.couchLeg, M(sx, 0.04, sz));
    junk('junk-couch', 'dump-junk', 'junk', 'Junk removal', b.build(), [-0.42, heapY(-0.4, 0.3) - 0.02, 0.3], [-0.38, PI / 2, 0.06]);
  }

  // fridge lying tilted -> cleanouts
  {
    const b = new Bag();
    const g0 = rbox(0.72, 1.72, 0.64, 0.035); boxUV(g0, 1.2); b.add(g0, mat.enamel, M(0, 0.86, -0.03));
    const d1 = rbox(0.71, 0.47, 0.06, 0.022); boxUV(d1, 1.2); b.add(d1, mat.enamel, M(0, 1.47, 0.32));
    const d2 = rbox(0.71, 1.11, 0.06, 0.022); boxUV(d2, 1.2); b.add(d2, mat.enamel, M(0, 0.665, 0.32));
    b.add(rbox(0.03, 0.3, 0.035, 0.01), mat.greyPlastic, M(0.3, 1.36, 0.37));
    b.add(rbox(0.03, 0.45, 0.035, 0.01), mat.greyPlastic, M(0.3, 1.0, 0.37));
    b.add(rbox(0.66, 0.08, 0.02, 0.005), mat.blackPlastic, M(0, 0.055, 0.3));
    for (let i = 0; i < 12; i++) b.add(cyl(0.004, 0.004, 0.6, 5), mat.steelDark, M(0, 0.3 + i * 0.1, -0.37, 0, 0, PI / 2));
    junk('junk-fridge', 'dump-cleanouts', 'cleanouts', 'Cleanouts', b.build(), [-0.43, heapY(-0.43, -0.62) + 0.32, -0.62], [-PI / 2 + 0.38, -0.82, 0.15]);
  }

  // tree limbs with leaves -> landscaping
  {
    const b = new Bag();
    const leaves = [];
    branches(b, 7, [
      [[0, 0, 0], [-0.35, 1, -0.25], 1.0, 0.045, 3],
      [[0.05, 0, 0.05], [0.1, 0.9, -0.7], 0.9, 0.04, 3],
      [[-0.05, 0, 0.1], [-0.8, 0.7, 0.35], 0.8, 0.035, 2],
      [[0.1, 0, -0.05], [0.7, 0.9, 0.5], 0.9, 0.035, 3],
    ], leaves);
    const g = b.build();
    g.add(leafMesh(leaves));
    junk('junk-branches', 'dump-landscaping', 'landscaping', 'Landscaping', g, [-0.62, heapY(-0.62, -1.75) - 0.05, -1.75], [0, 0.3, 0]);
  }

  // contractor bags of grass clippings -> lawn
  {
    const b = new Bag();
    b.push(M(0, 0, 0, 0, 0.3, 0.05)); contractorBag(b, 3, 1, 1, 1); b.pop();
    b.push(M(0.35, 0.02, -0.5, 0.05, -0.9, -0.08)); contractorBag(b, 4, 0.95, 0.9, 0.9); b.pop();
    b.push(M(-0.35, 0.16, -0.35, 0.3, 2.2, 0.2)); contractorBag(b, 5, 0.85, 0.85, 0.85); b.pop();
    const cl = new THREE.SphereGeometry(0.12, 14, 10); lumpify(cl, 0.04, 14, 6); smoothNormals(cl);
    b.add(cl, mat.grass, M(0.12, 0.33, 0.42, 0, 0, 0, [1.3, 0.6, 1]));
    const g = b.build();
    junk('junk-bags', 'dump-lawn', 'lawn', 'Lawn care', g, [0.12, heapY(0.12, 1.8) - 0.02, 1.8], [0, 0, 0]);
  }

  // full-size solar panel leaning on the far wall -> solar-svc
  {
    const b = new Bag();
    solarPanel(b, 0.99, 1.65, mat.solarCellsBig, 0.035);
    junk('junk-solar', 'dump-solar', 'solar-svc', 'Solar', b.build(), [-0.5, heapY(-0.5, 1.85) - 0.02, 1.85], [-0.42, PI / 2, 0.05]);
  }

  // stack of pavers -> pavers
  {
    const g = new THREE.Group();
    const pg = paverGeometry(), r = rng(99), list = [];
    for (let k = 0; k < 3; k++) for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) {
      if (k === 2 && r() < 0.35) continue;
      list.push([-0.1125 + i * 0.225, 0.125 + k * 0.06, -0.169 + j * 0.1125, 0, (r() - 0.5) * 0.06, 0]);
    }
    list.push([0.36, 0.06, 0.12, 0.3, 1.2, 0.35], [-0.2, 0.31, 0.05, 0.05, 0.9, 0.08]);
    // broken pallet chunk underneath
    const pb = new Bag();
    for (let i = 0; i < 4; i++) pb.add(boxUV(rbox(0.62, 0.02, 0.095, 0.004), 1.2, 4), mat.pallet, M(0.02, 0.11, -0.2 + i * 0.14, 0, (i - 1.5) * 0.03, 0));
    for (const x of [-0.24, 0.26]) pb.add(boxUV(rbox(0.09, 0.1, 0.58, 0.004), 1.2, 4), mat.pallet, M(x, 0.05, 0));
    g.add(pb.build());
    const im = new THREE.InstancedMesh(pg, mat.paver, list.length);
    list.forEach((t, i) => { im.setMatrixAt(i, M(...t)); im.setColorAt(i, paverColors(r)); });
    im.castShadow = true; im.receiveShadow = true;
    g.add(im);
    junk('junk-pavers', 'dump-pavers', 'pavers', 'Pavers & hardscape', g, [0.5, heapY(0.5, 0.12) - 0.02, 0.12], [0.06, 0.3, -0.1]);
  }

  // gas pressure washer -> washing
  {
    const b = new Bag();
    // frame: base rails + U handle
    b.add(tube([[-0.22, 0.13, 0.28], [-0.22, 0.08, 0.1], [-0.22, 0.12, -0.2], [-0.22, 0.55, -0.28], [-0.22, 0.95, -0.34], [0, 0.97, -0.35], [0.22, 0.95, -0.34], [0.22, 0.55, -0.28], [0.22, 0.12, -0.2], [0.22, 0.08, 0.1], [0.22, 0.13, 0.28]], 0.014, 80, 8), mat.blackPlastic);
    b.add(cyl(0.014, 0.014, 0.44, 8), mat.blackPlastic, M(0, 0.13, 0.28, 0, 0, PI / 2));
    b.add(rbox(0.4, 0.012, 0.36, 0.004), mat.steelDark, M(0, 0.15, 0.04));
    for (const s of [-1, 1]) wheel(b, 0.13, 0.06, s, mat.greyPlastic, s * 0.27, 0.13, -0.18);
    b.add(cyl(0.012, 0.012, 0.6, 8), mat.zinc, M(0, 0.13, -0.18, 0, 0, PI / 2));
    b.push(M(0, 0.156, 0.06, 0, PI, 0)); smallEngine(b, mat.washerRed, mat.blackPlastic); b.pop();
    // pump
    b.add(rbox(0.12, 0.1, 0.12, 0.015), mat.brass, M(0, 0.2, -0.13));
    b.add(cyl(0.02, 0.02, 0.06, 10), mat.brass, M(0.07, 0.22, -0.13, 0, 0, PI / 2));
    // hose coil on the handle and wand clipped to the frame
    for (let i = 0; i < 5; i++) b.add(new THREE.TorusGeometry(0.15 + i * 0.006, 0.0055, 5, sg(40)), mat.hose, M(-0.235, 0.62 - i * 0.012, -0.31 + i * 0.004, 0, PI / 2 + 0.1, 0.35 + i * 0.1));
    b.push(M(0.24, 0.9, -0.3, 0.05, 0, 0)); sprayGun(b); wand(b, 0.72); b.pop();
    junk('junk-washer', 'dump-washing', 'washing', 'Pressure washing', b.build(), [0.6, heapY(0.6, -0.62) + 0.05, -0.62], [-0.22, -0.9, 0.3]);
  }

  // length of gutter -> gutters
  {
    const b = new Bag();
    gutterSection(b, 2.6, { cap: true, gunk: true });
    const g = b.build();
    junk('junk-gutter', 'dump-gutters', 'gutters', 'Gutter cleaning', g, [1.3, 1.53, 1.2], [0.1, -0.56, -0.2]);
  }

  // ---- dumpster group hotspot for the street view (body + an invisible volume over the pile)
  {
    const vol = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.7, 5.3), new THREE.MeshBasicMaterial({ visible: false }));
    vol.position.set(0, 1.35, 0); vol.name = 'hot-dumpster-volume';
    dump.add(vol);
    const body = dump.getObjectByName('dumpster-body');
    const grp = new THREE.Group(); grp.name = 'dumpster-hot';
    dump.add(grp); grp.add(vol);
    hotspot(grp, { id: 'hot-dumpster', anchor: [DX, 2.75, DZ], views: { garage: { go: 'dumpster', label: 'Junk removal: every service' } } });
    void body;
  }

  wall.updateMatrixWorld(true);
  dump.updateMatrixWorld(true);
  ctx.scene?.updateMatrixWorld?.(true);

  ctx.api.services = { dumpster: dump, wall, dumpsterCenter: [DX, 0, DZ] };
}
