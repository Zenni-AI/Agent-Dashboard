// Solar bay: the hero car (a red mid-engine American sports car, C8-like
// proportions, no trademarks) parked mid-garage, plus the solar hardware on the
// right wall (EV charger, home battery + inverter, utility meter).
//
// The car body is a parametric loft: every station along z has a cross-section
// built from two superellipse quarters (lower/upper) whose width, heights and
// exponents follow smooth side/plan profiles. Wheel arches and the side scoops
// are carved by deforming the section. Lights, grilles, door gaps and trim are
// "decals": 2D polygons projected onto the analytic body surface.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const CAR_POS = new THREE.Vector3(0.9, 0, -3.4);
const ZF = 2.315, ZR = -2.315;        // nose / tail (car local, nose toward +z)
const RE = 0.05;                        // edge radius where the body meets its end caps
const AXF = 1.315, AXR = -1.405;        // axles (wheelbase 2.72 m)
const WHEELS = {
  f: { r: 0.327, w: 0.245, track: 0.8215, rim: 0.2413, arch: 0.372, xin: 0.62 },
  r: { r: 0.345, w: 0.305, track: 0.797, rim: 0.254, arch: 0.392, xin: 0.61 },
};
const ARCHES = [
  { z: AXF, y: WHEELS.f.r - 0.012, R: WHEELS.f.arch, xin: WHEELS.f.xin },
  { z: AXR, y: WHEELS.r.r - 0.012, R: WHEELS.r.arch, xin: WHEELS.r.xin },
];

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

// Monotone cubic interpolation through [x, y] pairs (no overshoot).
function pchip(pts) {
  const n = pts.length, xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const h = [], d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

// ---------------------------------------------------------------- profiles
// Lower body: top line along the centre (hood / deck), bottom line, shoulder
// height (widest point), half width, and how far the fender crowns rise above
// the centre line.
const Y1 = pchip([[-2.315, 0.975], [-2.24, 1.03], [-2.05, 1.045], [-1.8, 1.035], [-1.4, 0.995], [-0.7, 0.905], [0.1, 0.855], [0.8, 0.815], [1.3, 0.76], [1.75, 0.685], [2.05, 0.615], [2.23, 0.55], [2.315, 0.49]]);
const Y0 = pchip([[-2.315, 0.40], [-2.2, 0.32], [-2.0, 0.19], [-1.75, 0.13], [1.7, 0.13], [2.05, 0.15], [2.315, 0.19]]);
const YC = pchip([[-2.315, 0.66], [-1.6, 0.60], [-0.9, 0.56], [0, 0.52], [1.2, 0.47], [2.0, 0.42], [2.315, 0.37]]);
const WB = pchip([[-2.315, 0.905], [-2.05, 0.945], [-1.5, 0.966], [-1.0, 0.957], [-0.45, 0.922], [0.35, 0.918], [0.95, 0.94], [1.35, 0.955], [1.85, 0.935], [2.315, 0.87]]);
const RISE = pchip([[-2.315, 0.0], [-2.0, 0.025], [-1.5, 0.035], [-0.8, 0.02], [0.0, 0.018], [0.7, 0.03], [1.3, 0.07], [1.85, 0.06], [2.2, 0.03], [2.315, 0.01]]);
const NU = pchip([[-2.315, 5.0], [-1.0, 4.4], [0.5, 4.2], [1.5, 4.6], [2.315, 3.4]]);
const NL = 2.7;
const TH = 0.07; // tumblehome of the upper quarter

// Plan-view rounding of the nose and tail corners.
function planRound(z) {
  const rcF = 0.55, rcR = 0.2;
  if (z > ZF - rcF) { const s = Math.min(1, (z - (ZF - rcF)) / rcF); return 0.55 + 0.45 * Math.sqrt(1 - s * s); }
  if (z < ZR + rcR) { const s = Math.min(1, ((ZR + rcR) - z) / rcR); return 0.86 + 0.14 * Math.sqrt(1 - s * s); }
  return 1;
}

// Side scoop behind the door (z, y polygon, convex).
const INTAKE = [[-0.30, 0.37], [-0.43, 0.80], [-0.93, 0.80], [-1.05, 0.60], [-0.96, 0.38]];
const INTAKE_EDGES = (() => {
  const n = INTAKE.length, cz = INTAKE.reduce((s, p) => s + p[0], 0) / n, cy = INTAKE.reduce((s, p) => s + p[1], 0) / n;
  return INTAKE.map((p, i) => {
    const q = INTAKE[(i + 1) % n];
    let nz = q[1] - p[1], ny = -(q[0] - p[0]); const l = Math.hypot(nz, ny); nz /= l; ny /= l;
    if (nz * (cz - p[0]) + ny * (cy - p[1]) > 0) { nz = -nz; ny = -ny; }
    return [nz, ny, nz * p[0] + ny * p[1]];
  });
})();
function intakeSD(z, y) { let d = -1e9; for (const [nz, ny, c] of INTAKE_EDGES) d = Math.max(d, nz * z + ny * y - c); return d; }

// Carve wheel wells, flare the arch lips, press in the side scoops.
function deform(ax, y, z) {
  for (const a of ARCHES) {
    const dz = z - a.z, dy = y - a.y, dist = Math.hypot(dz, dy);
    if (dist < a.R && ax > a.xin) return a.xin;
    if (ax > a.xin + 0.08 && dist < a.R + 0.1 && dy > -0.14) { const e = (dist - a.R) / 0.035; ax += 0.013 * Math.exp(-e * e); }
  }
  if (ax > 0.7 && z < -0.2 && z > -1.15) {
    const sd = intakeSD(z, y);
    if (sd < 0.01) {
      const m = 1 - smooth(-0.035, 0.004, sd);
      const f = 0.3 + 0.7 * smooth(-1.0, -0.38, z);
      ax -= 0.10 * m * f * smooth(0.7, 0.86, ax);
    }
  }
  return ax;
}

// Full cross-section loop at station z: NA+1 points (x, y), starting at the
// bottom centre, up the +x side, over the top and down the -x side.
function makeSection(NA) {
  return function section(z, out) {
    const w = WB(z) * planRound(z), y0 = Y0(z), y1 = Y1(z), yc = YC(z), rise = RISE(z), nu = NU(z);
    let dlt = 0;
    if (z > ZF - RE) { const d = Math.min(1, (z - (ZF - RE)) / RE); dlt = RE * (1 - Math.sqrt(1 - d * d)); }
    else if (z < ZR + RE) { const d = Math.min(1, ((ZR + RE) - z) / RE); dlt = RE * (1 - Math.sqrt(1 - d * d)); }
    const ym = (y0 + y1) / 2, hy = (y1 - y0) / 2;
    const sx = 1 - dlt / w, sy = 1 - dlt / hy;
    for (let j = 0; j <= NA; j++) {
      const s = j / NA;
      let sign, phi;
      if (s <= 0.5) { sign = 1; phi = -Math.PI / 2 + s * 2 * Math.PI; } else { sign = -1; phi = Math.PI / 2 - (s - 0.5) * 2 * Math.PI; }
      const c = Math.abs(Math.cos(phi)), sn = Math.sin(phi);
      let x, y;
      if (phi < 0) {
        x = w * Math.pow(c, 2 / NL); y = yc - (yc - y0) * Math.pow(-sn, 2 / NL);
      } else {
        const v = Math.pow(sn, 2 / nu);
        x = w * Math.pow(c, 2 / nu) * (1 - TH * v * v);
        y = yc + (y1 - yc) * v + rise * smooth(0.3, 0.86, x / w) * Math.pow(sn, 0.6);
      }
      x *= sx; y = ym + (y - ym) * sy;
      out[j * 2] = sign * deform(x, y, z); out[j * 2 + 1] = y;
    }
    return out;
  };
}

// ---------------------------------------------------------------- cabin
const CAB_Z0 = 0.80, CAB_Z1 = -1.98;
const CT = pchip([[-1.98, 1.02], [-1.6, 1.075], [-1.1, 1.155], [-0.65, 1.212], [-0.32, 1.23], [-0.08, 1.215], [0.2, 1.12], [0.5, 0.97], [0.80, 0.835]]);
const WCB = pchip([[-1.98, 0.80], [-1.45, 0.855], [-0.75, 0.84], [0.0, 0.80], [0.5, 0.75], [0.80, 0.71]]);
const WCT = pchip([[-1.98, 0.56], [-1.2, 0.56], [-0.6, 0.555], [-0.1, 0.54], [0.4, 0.51], [0.80, 0.49]]);
const NC = 4.2;
const ZA = -0.06;   // windshield header
const ZB = -0.64;   // roof / rear glass break

function cabGroup(z, u, v) { // 0 paint, 1 glass, 2 black trim
  const side = u > 0.9, top = u < 0.8;
  if (v < 0.24) return 0;
  const zRear = -0.62 - 0.14 * (1 - v);
  if (z > ZA) {
    if (top) return 1;
    if (side) return v < 0.3 ? 2 : 1;
    return 2;
  }
  if (z > ZA - 0.055) return top ? 2 : (side && v < 0.3 ? 2 : side ? 1 : 2);
  if (z > zRear && side) return v < 0.3 ? 2 : 1;
  if (z > ZB) return top ? 0 : 2;
  if (z > zRear - 0.03 && side) return 2;
  if (z < -1.86) return 0;
  if (u < 0.62) return 1;
  if (u < 0.7) return 2;
  return 0;
}

// ---------------------------------------------------------------- build
export function build(ctx) {
  const { tex, renderer } = ctx;
  const hi = ctx.quality !== 'low';
  const NA = hi ? 112 : 72;
  const section = makeSection(NA);

  // ---- local reflection environment: garage strip lights + open door
  let envMap = null;
  try { envMap = buildEnv(renderer); } catch (e) { envMap = null; }

  // ---- materials
  const paint = new THREE.MeshPhysicalMaterial({
    color: 0xc1121f, metalness: 0.42, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03,
    envMap, envMapIntensity: 1.15,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x07090c, metalness: 0.0, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02,
    envMap, envMapIntensity: 1.7, ior: 1.52, side: THREE.DoubleSide,
  });
  const trim = new THREE.MeshPhysicalMaterial({ color: 0x0b0c0e, metalness: 0.3, roughness: 0.22, clearcoat: 0.8, clearcoatRoughness: 0.08, envMap, envMapIntensity: 1.0, side: THREE.DoubleSide });
  const matte = new THREE.MeshStandardMaterial({ color: 0x121315, roughness: 0.75, metalness: 0.1 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd9dadd, metalness: 1, roughness: 0.14, envMap, envMapIntensity: 1.2 });
  const decalBase = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide };
  const grilleTex = tex.canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#2a2c30'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#020203';
    const r = 13, dx = r * 1.8, dy = r * 1.56;
    for (let yy = -1; yy < 7; yy++) for (let xx = -1; xx < 7; xx++) {
      const cx = xx * dx + (yy % 2 ? dx / 2 : 0), cy = yy * dy;
      g.beginPath();
      for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
      g.fill();
    }
  });
  const grille = new THREE.MeshStandardMaterial({ map: grilleTex, color: 0xffffff, roughness: 0.55, metalness: 0.4, ...decalBase });
  const decalBlack = new THREE.MeshPhysicalMaterial({ color: 0x0a0b0d, roughness: 0.3, metalness: 0.2, clearcoat: 0.6, envMap, envMapIntensity: 0.8, ...decalBase });
  const gapMat = new THREE.MeshBasicMaterial({ color: 0x050505, ...decalBase });
  const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x15171b, metalness: 0.85, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.02, envMap, envMapIntensity: 1.4, ...decalBase, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const drlMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xe8f1ff, emissiveIntensity: 2.4, ...decalBase, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
  const projMat = new THREE.MeshStandardMaterial({ color: 0x223040, emissive: 0xcfe0ff, emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.2, ...decalBase, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
  const amberMat = new THREE.MeshStandardMaterial({ color: 0x331800, emissive: 0xff8a1a, emissiveIntensity: 0.25, ...decalBase, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
  const tailLens = new THREE.MeshPhysicalMaterial({ color: 0x3a0306, emissive: 0x7a0008, emissiveIntensity: 0.6, roughness: 0.12, clearcoat: 1, envMap, envMapIntensity: 1.2, ...decalBase, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const tailBlade = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff1a22, emissiveIntensity: 3.2, ...decalBase, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });

  const car = new THREE.Group();
  car.name = 'hero-car';
  car.position.copy(CAR_POS);

  // ---- body loft
  const zs = [];
  const NZ = hi ? 210 : 120;
  for (let i = 0; i <= NZ; i++) zs.push({ z: ZR + RE + (ZF - ZR - 2 * RE) * i / NZ });
  for (let k = 1; k <= 8; k++) {
    const th = k / 8 * Math.PI / 2;
    zs.push({ z: ZF - RE + RE * Math.sin(th) });
    zs.push({ z: ZR + RE - RE * Math.sin(th) });
  }
  zs.sort((a, b) => a.z - b.z);
  zs.unshift({ z: ZR, cap: true });
  zs.push({ z: ZF, cap: true });
  const sec = new Float32Array((NA + 1) * 2);
  const body = loftGeometry(zs.map((s) => {
    section(s.z, sec);
    const pts = new Float32Array(sec);
    if (s.cap) {
      let cx = 0, cy = 0; for (let j = 0; j < NA; j++) { cx += sec[j * 2]; cy += sec[j * 2 + 1]; }
      cx /= NA; cy /= NA;
      for (let j = 0; j <= NA; j++) { pts[j * 2] = cx; pts[j * 2 + 1] = cy; }
    }
    return { z: s.z, pts };
  }), NA, null);
  const bodyMesh = new THREE.Mesh(body, paint);
  bodyMesh.castShadow = true; bodyMesh.receiveShadow = true;
  car.add(bodyMesh);

  // ---- cabin / greenhouse loft
  const NAC = hi ? 84 : 56, NZC = hi ? 140 : 80;
  const cabRows = [];
  const cabUV = [];
  for (let i = 0; i <= NZC; i++) {
    const z = CAB_Z1 + (CAB_Z0 - CAB_Z1) * i / NZC;
    const yb = Y1(z) - 0.085, h = Math.max(0.001, CT(z) - yb), wb = WCB(z), wt = WCT(z);
    const pts = new Float32Array((NAC + 1) * 2), uv = new Float32Array((NAC + 1) * 2);
    for (let j = 0; j <= NAC; j++) {
      const phi = j / NAC * Math.PI, c = Math.cos(phi), sn = Math.sin(phi);
      const u = Math.pow(Math.abs(c), 2 / NC), v = Math.pow(sn, 2 / NC);
      pts[j * 2] = Math.sign(c) * (wb + (wt - wb) * v) * u;
      pts[j * 2 + 1] = yb + h * v;
      uv[j * 2] = u; uv[j * 2 + 1] = v;
    }
    cabRows.push({ z, pts, uv });
  }
  const cabin = loftGeometry(cabRows, NAC, (i, j) => {
    const z = (cabRows[i].z + cabRows[i + 1].z) / 2;
    const r = cabRows[i].uv;
    const u = (r[j * 2] + r[j * 2 + 2]) / 2, v = (r[j * 2 + 1] + r[j * 2 + 3]) / 2;
    return cabGroup(z, u, v);
  });
  const cabMesh = new THREE.Mesh(cabin, [paint, glass, trim]);
  cabMesh.castShadow = true; cabMesh.receiveShadow = true;
  car.add(cabMesh);

  // ---- decal projection onto the analytic body surface
  const secCache = new Map();
  const getSec = (z) => {
    const key = Math.round(z * 2000);
    let s = secCache.get(key);
    if (!s) { s = section(key / 2000, new Float32Array((NA + 1) * 2)); secCache.set(key, s); }
    return s;
  };
  const inside = (P) => {
    if (P.z <= ZR || P.z >= ZF || P.y < 0.05 || P.y > 1.2) return false;
    const s = getSec(P.z), px = P.x, py = P.y;
    let c = false;
    for (let i = 0, j = NA - 1; i < NA; j = i++) {
      const xi = s[i * 2], yi = s[i * 2 + 1], xj = s[j * 2], yj = s[j * 2 + 1];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const _S = new THREE.Vector3(), _P = new THREE.Vector3();
  function project(pl, a, b, out) {
    _S.copy(pl.O).addScaledVector(pl.A, a).addScaledVector(pl.B, b);
    if (inside(_S)) return null;
    const step = 0.006;
    for (let t = step; t <= pl.max; t += step) {
      _P.copy(_S).addScaledVector(pl.D, t);
      if (inside(_P)) {
        let lo = t - step, hi2 = t;
        for (let k = 0; k < 14; k++) { const mid = (lo + hi2) / 2; _P.copy(_S).addScaledVector(pl.D, mid); if (inside(_P)) hi2 = mid; else lo = mid; }
        return out.copy(_S).addScaledVector(pl.D, lo);
      }
    }
    return null;
  }
  const PL = {
    R: { O: v3(1.3, 0, 0), A: v3(0, 0, 1), B: v3(0, 1, 0), D: v3(-1, 0, 0), max: 0.95 },
    L: { O: v3(-1.3, 0, 0), A: v3(0, 0, 1), B: v3(0, 1, 0), D: v3(1, 0, 0), max: 0.95 },
    T: { O: v3(0, 1.3, 0), A: v3(1, 0, 0), B: v3(0, 0, 1), D: v3(0, -1, 0), max: 1.25 },
    F: { O: v3(0, 0, 2.45), A: v3(1, 0, 0), B: v3(0, 1, 0), D: v3(0, 0, -1), max: 1.0 },
    K: { O: v3(0, 0, -2.45), A: v3(1, 0, 0), B: v3(0, 1, 0), D: v3(0, 0, 1), max: 0.6 },
  };
  function meshFromPts(pts, faces, pl, eps, uvMode) {
    const pos = [], uv = [], idx = [], map = new Int32Array(pts.length).fill(-1);
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const p of pts) { minA = Math.min(minA, p[0]); maxA = Math.max(maxA, p[0]); minB = Math.min(minB, p[1]); maxB = Math.max(maxB, p[1]); }
    const o = new THREE.Vector3();
    pts.forEach((p, i) => {
      if (!project(pl, p[0], p[1], o)) return;
      o.addScaledVector(pl.D, -eps);
      map[i] = pos.length / 3; pos.push(o.x, o.y, o.z);
      if (uvMode === 'norm') uv.push((p[0] - minA) / (maxA - minA || 1), (p[1] - minB) / (maxB - minB || 1));
      else uv.push(p[0] * uvMode, p[1] * uvMode);
    });
    for (const [a, b, c] of faces) if (map[a] >= 0 && map[b] >= 0 && map[c] >= 0) idx.push(map[a], map[b], map[c]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  function decal(poly, pl, mat, { eps = 0.002, maxEdge = 0.02, uv = 'norm', parent = car } = {}) {
    const tris = THREE.ShapeUtils.triangulateShape(poly.map((p) => new THREE.Vector2(p[0], p[1])), []);
    const pts = poly.map((p) => [p[0], p[1]]);
    let faces = tris.map((t) => [t[0], t[1], t[2]]);
    let maxLen = 0;
    for (const f of faces) for (let k = 0; k < 3; k++) { const p = pts[f[k]], q = pts[f[(k + 1) % 3]]; maxLen = Math.max(maxLen, Math.hypot(p[0] - q[0], p[1] - q[1])); }
    const levels = Math.min(5, Math.max(0, Math.ceil(Math.log2(maxLen / maxEdge))));
    for (let l = 0; l < levels; l++) {
      const mid = new Map(), nf = [];
      const m = (i, j) => {
        const key = i < j ? i * 100000 + j : j * 100000 + i;
        let r = mid.get(key);
        if (r === undefined) { r = pts.length; pts.push([(pts[i][0] + pts[j][0]) / 2, (pts[i][1] + pts[j][1]) / 2]); mid.set(key, r); }
        return r;
      };
      for (const [a, b, c] of faces) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); nf.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]); }
      faces = nf;
    }
    const mesh = new THREE.Mesh(meshFromPts(pts, faces, pl, eps, uv), mat);
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function strip(line, width, pl, mat, { eps = 0.0025, spacing = 0.008, parent = car } = {}) {
    const samples = [];
    for (let i = 0; i < line.length - 1; i++) {
      const [a0, b0] = line[i], [a1, b1] = line[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(a1 - a0, b1 - b0) / spacing));
      for (let k = 0; k < n; k++) samples.push([a0 + (a1 - a0) * k / n, b0 + (b1 - b0) * k / n]);
    }
    samples.push(line[line.length - 1]);
    const pts = [], faces = [];
    samples.forEach((p, i) => {
      const q0 = samples[Math.max(0, i - 1)], q1 = samples[Math.min(samples.length - 1, i + 1)];
      let ta = q1[0] - q0[0], tb = q1[1] - q0[1]; const l = Math.hypot(ta, tb) || 1; ta /= l; tb /= l;
      pts.push([p[0] - tb * width / 2, p[1] + ta * width / 2], [p[0] + tb * width / 2, p[1] - ta * width / 2]);
      if (i > 0) { const a = (i - 1) * 2; faces.push([a, a + 1, a + 2], [a + 1, a + 3, a + 2]); }
    });
    const mesh = new THREE.Mesh(meshFromPts(pts, faces, pl, eps, 'norm'), mat);
    parent.add(mesh);
    return mesh;
  }
  const mx = (poly) => poly.map(([a, b]) => [-a, b]);
  const circle = (ca, cb, r, n = 14) => Array.from({ length: n }, (_, i) => [ca + Math.cos(i / n * Math.PI * 2) * r, cb + Math.sin(i / n * Math.PI * 2) * r]);

  // ---- headlights (projected from above onto the nose corners)
  const HL = [[0.34, 2.215], [0.60, 2.13], [0.80, 1.99], [0.885, 1.80], [0.86, 1.70], [0.74, 1.74], [0.55, 1.93], [0.40, 2.08]];
  const DRL = [[0.37, 2.19], [0.56, 2.035], [0.72, 1.86], [0.83, 1.745]];
  const drls = [];
  for (const s of [1, -1]) {
    const f = (p) => p.map(([a, b]) => [a * s, b]);
    decal(f(HL), PL.T, lensMat, { eps: 0.003, maxEdge: 0.02 });
    drls.push(strip(f(DRL), 0.011, PL.T, drlMat, { eps: 0.0045 }));
    decal(f(circle(0.62, 2.03, 0.028)), PL.T, projMat, { eps: 0.0045, maxEdge: 0.01 });
    decal(f(circle(0.735, 1.93, 0.026)), PL.T, projMat, { eps: 0.0045, maxEdge: 0.01 });
    strip(f([[0.58, 2.115], [0.79, 1.98], [0.87, 1.81]]), 0.008, PL.T, amberMat, { eps: 0.0045 });
  }

  // ---- front fascia: centre intake, corner intakes, splitter
  decal([[-0.46, 0.175], [0.46, 0.175], [0.40, 0.355], [0.26, 0.385], [-0.26, 0.385], [-0.40, 0.355]], PL.F, grille, { uv: 1 / 0.035, maxEdge: 0.03 });
  for (const s of [1, -1]) {
    const p = [[0.50, 0.19], [0.74, 0.25], [0.72, 0.43], [0.62, 0.43], [0.48, 0.34]];
    decal(s > 0 ? p : mx(p), PL.F, grille, { uv: 1 / 0.035, maxEdge: 0.02 });
    strip((s > 0 ? [[0.44, 0.42], [0.62, 0.46], [0.74, 0.46]] : mx([[0.44, 0.42], [0.62, 0.46], [0.74, 0.46]])), 0.006, PL.F, gapMat);
  }
  {
    // splitter plate following the nose outline
    const shape = new THREE.Shape();
    const outline = [];
    for (let i = 0; i <= 24; i++) { const z = 1.72 + (ZF + 0.03 - 1.72) * i / 24; outline.push([WB(z) * planRound(Math.min(z, ZF)) - 0.03 - (z > ZF ? 0.06 : 0), z]); }
    shape.moveTo(outline[0][0], -outline[0][1]);
    for (const [x, z] of outline) shape.lineTo(x, -z);
    for (let i = outline.length - 1; i >= 0; i--) shape.lineTo(-outline[i][0], -outline[i][1]);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 4 });
    g.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(g, trim); m.position.y = 0.135; m.castShadow = hi; car.add(m);
  }

  // ---- side details: scoop grille, door gaps, rocker, charge door
  for (const [pl, s] of [[PL.R, 1], [PL.L, -1]]) {
    decal([[-0.34, 0.405], [-0.455, 0.775], [-0.90, 0.775], [-1.0, 0.61], [-0.93, 0.415]], pl, grille, { uv: 1 / 0.04, maxEdge: 0.03, eps: 0.003 });
    strip([[0.905, 0.25], [0.93, 0.55], [0.905, 0.82]], 0.0045, pl, gapMat);
    strip([[0.905, 0.25], [-0.27, 0.25], [-0.30, 0.37]], 0.0045, pl, gapMat);
    decal([[0.94, 0.135], [0.94, 0.215], [0.2, 0.232], [-0.97, 0.232], [-0.97, 0.135]], pl, decalBlack, { maxEdge: 0.03 });
    strip([[1.64, 0.62], [1.95, 0.58], [2.14, 0.52]], 0.0045, pl, gapMat); // front bumper seam
    strip([[-1.86, 0.70], [-2.06, 0.66], [-2.22, 0.60]], 0.0045, pl, gapMat); // rear bumper seam
    if (s > 0) strip([[-1.70, 0.83], [-1.82, 0.83], [-1.82, 0.93], [-1.70, 0.93], [-1.70, 0.83]], 0.004, pl, gapMat);
  }
  // hood (frunk) shut lines
  strip([[-0.62, 0.93], [-0.66, 1.3], [-0.60, 1.75], [-0.30, 1.98], [0.30, 1.98], [0.60, 1.75], [0.66, 1.3], [0.62, 0.93]], 0.0045, PL.T, gapMat);
  // rear hatch outline on the deck
  strip([[-0.62, -1.93], [0.62, -1.93]], 0.0045, PL.T, gapMat);

  // ---- rear: taillights, black panel, vents, plate
  const TL = [[0.28, 0.935], [0.84, 0.955], [0.905, 0.90], [0.87, 0.80], [0.74, 0.80], [0.66, 0.855], [0.30, 0.875]];
  for (const s of [1, -1]) {
    const f = (p) => p.map(([a, b]) => [a * s, b]);
    decal(f(TL), PL.K, tailLens, { eps: 0.003, maxEdge: 0.02 });
    strip(f([[0.31, 0.905], [0.66, 0.915], [0.86, 0.925], [0.885, 0.86], [0.86, 0.815]]), 0.012, PL.K, tailBlade, { eps: 0.0045 });
    decal(f([[0.55, 0.46], [0.86, 0.50], [0.87, 0.70], [0.70, 0.72], [0.56, 0.62]]), PL.K, grille, { uv: 1 / 0.035, eps: 0.003 });
  }
  decal([[-0.28, 0.86], [0.28, 0.86], [0.28, 0.94], [-0.28, 0.94]], PL.K, decalBlack, { maxEdge: 0.02 });

  const hitPt = (pl, a, b) => project(pl, a, b, new THREE.Vector3());
  const plateTex = (big, small) => tex.canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = '#f3f1ea'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1b1d22'; g.lineWidth = 10; g.strokeRect(12, 12, w - 24, h - 24);
    g.fillStyle = '#1b2a4a'; g.font = '700 34px Arial, sans-serif'; g.textAlign = 'center'; g.fillText(small, w / 2, 62);
    g.fillStyle = '#9b0f18'; g.font = '900 128px Arial Black, Impact, sans-serif'; g.textBaseline = 'middle'; g.fillText(big, w / 2, 160);
  }, { wrap: false });
  const plateMat = (t) => new THREE.MeshStandardMaterial({ map: t, roughness: 0.35, metalness: 0.2 });
  {
    const pr = hitPt(PL.K, 0, 0.56);
    if (pr) {
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.305, 0.152), plateMat(plateTex('SOLAR', 'PRISTINE HOME')));
      pm.position.copy(pr).add(v3(0, 0, -0.008)); pm.rotation.y = Math.PI; car.add(pm);
    }
    const pf = hitPt(PL.F, 0, 0.27);
    if (pf) {
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.15), plateMat(plateTex('SOLAR', 'PRISTINE HOME')));
      pm.position.copy(pf).add(v3(0, 0, 0.012)); pm.rotation.x = -0.12; car.add(pm);
    }
    const pb = hitPt(PL.K, 0, 0.9);
    if (pb) {
      const lb = tex.label('PRISTINE', { font: '700 110px "Helvetica Neue", Arial, sans-serif', color: '#e9ecef', height: 160, pad: 20 });
      const lm = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34 / lb.aspect), new THREE.MeshStandardMaterial({ map: lb.texture, transparent: true, metalness: 0.9, roughness: 0.2, envMap }));
      lm.position.copy(pb).add(v3(0, 0, -0.007)); lm.rotation.y = Math.PI; car.add(lm);
    }
  }

  // ---- diffuser, exhaust, spoiler
  {
    const d = new THREE.Mesh(new RoundedBoxGeometry(1.62, 0.25, 0.52, 3, 0.03), matte);
    d.position.set(0, 0.25, -2.07); d.castShadow = hi; car.add(d);
    for (let i = -3; i <= 3; i++) {
      if (Math.abs(i) === 0) continue;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.17, 0.42), matte);
      fin.position.set(i * 0.2 + (i > 0 ? 0.06 : -0.06), 0.2, -2.12); car.add(fin);
    }
    const tipGeo = new THREE.LatheGeometry([new THREE.Vector2(0.036, -0.08), new THREE.Vector2(0.041, 0), new THREE.Vector2(0.044, 0.01), new THREE.Vector2(0.038, 0.012), new THREE.Vector2(0.033, 0.0), new THREE.Vector2(0.033, -0.08)], 28);
    tipGeo.rotateX(-Math.PI / 2);
    const soot = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 });
    for (const x of [-0.26, -0.13, 0.13, 0.26]) {
      const t = new THREE.Mesh(tipGeo, chrome); t.position.set(x, 0.285, -2.33); car.add(t);
      const inner = new THREE.Mesh(new THREE.CircleGeometry(0.034, 20), soot); inner.position.set(x, 0.285, -2.30); inner.rotation.y = Math.PI; car.add(inner);
    }
    // ducktail spoiler blade
    const sh = new THREE.Shape();
    sh.moveTo(0, 0); sh.lineTo(0.16, 0.0); sh.quadraticCurveTo(0.2, 0.03, 0.19, 0.055); sh.lineTo(0.02, 0.02); sh.lineTo(0, 0);
    const sg = new THREE.ExtrudeGeometry(sh, { depth: 1.62, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2, curveSegments: 8 });
    sg.translate(0, 0, -0.81); sg.rotateY(Math.PI / 2);
    const sp = new THREE.Mesh(sg, trim);
    sp.position.set(0, Y1(-2.1) - 0.01, -2.1); sp.castShadow = true; car.add(sp);
  }

  // ---- mirrors
  for (const s of [1, -1]) {
    const hsg = new THREE.SphereGeometry(1, 28, 18);
    const pos = hsg.attributes.position;
    for (let i = 0; i < pos.count; i++) { if (pos.getZ(i) < 0) pos.setZ(i, pos.getZ(i) * 0.25); }
    hsg.computeVertexNormals();
    const housing = new THREE.Mesh(hsg, paint);
    housing.scale.set(0.085, 0.048, 0.075);
    housing.position.set(s * 0.985, 0.955, 0.50); housing.rotation.z = -s * 0.08; housing.castShadow = true;
    car.add(housing);
    const glassM = new THREE.Mesh(new THREE.CircleGeometry(1, 24), chrome);
    glassM.scale.set(0.078, 0.042, 1); glassM.position.set(s * 0.985, 0.955, 0.479); glassM.rotation.y = Math.PI; car.add(glassM);
    const stalk = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.03, 0.05, 2, 0.012), trim);
    stalk.position.set(s * 0.88, 0.925, 0.52); stalk.rotation.z = s * 0.25; car.add(stalk);
  }
  // wiper
  {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.012, 0.018), matte);
    w.position.set(-0.05, CT(0.74) + 0.005, 0.72); w.rotation.set(-0.42, 0.06, 0); car.add(w);
  }

  // ---- wheels
  const tireTex = makeTireTex(tex);
  const tireMat = new THREE.MeshStandardMaterial({ map: tireTex.map, roughness: 0.86, metalness: 0, bumpMap: tireTex.map, bumpScale: 1.2 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd4d7db, metalness: 1, roughness: 0.24, envMap, envMapIntensity: 1.1, side: THREE.DoubleSide });
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x3c3f44, metalness: 0.8, roughness: 0.45, envMap, envMapIntensity: 0.6, side: THREE.DoubleSide });
  const discTex = makeDiscTex(tex);
  const discMat = new THREE.MeshStandardMaterial({ map: discTex, metalness: 0.85, roughness: 0.38, color: 0xbfc2c6 });
  const caliperMat = new THREE.MeshPhysicalMaterial({ color: 0xf2b705, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 });
  const linerMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.95, side: THREE.DoubleSide });
  const wheelGeo = { f: makeWheelGeos(WHEELS.f, hi), r: makeWheelGeos(WHEELS.r, hi) };
  for (const [key, az] of [['f', AXF], ['r', AXR]]) {
    const W = WHEELS[key], geos = wheelGeo[key];
    for (const s of [1, -1]) {
      const wg = new THREE.Group();
      const add = (geo, mat, shadow) => { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = true; wg.add(m); return m; };
      add(geos.tire, tireMat, true);
      add(geos.spokes, rimMat, true);
      add(geos.lip, rimMat, hi);
      add(geos.barrel, barrelMat, false);
      add(geos.hub, rimMat, false);
      add(geos.nuts, chrome, false);
      add(geos.cap, trim, false);
      add(geos.disc, discMat, false);
      add(geos.hat, barrelMat, false);
      const cal = add(geos.caliper, caliperMat, false);
      // Caliper sits toward the car's centre of mass: behind the front axle, ahead of the rear.
      cal.rotation.z = (key === 'f' ? 1 : -1) * s * 0.55;
      wg.position.set(s * W.track, W.r - 0.012, az);
      wg.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      if (key === 'f') wg.rotation.y += 0.11;
      car.add(wg);
      // wheel-well liner + wall cover
      const a = ARCHES[key === 'f' ? 0 : 1];
      const lg = new THREE.CylinderGeometry(a.R - 0.004, a.R - 0.004, 0.42, 36, 1, true, Math.PI / 2 - Math.PI * 0.62, Math.PI * 1.24);
      lg.rotateZ(Math.PI / 2);
      const liner = new THREE.Mesh(lg, linerMat);
      liner.position.set(s * (a.xin + 0.2), a.y, a.z);
      car.add(liner);
      const cover = new THREE.Mesh(new THREE.CircleGeometry(a.R, 40), linerMat);
      cover.position.set(s * (a.xin + 0.003), a.y, a.z); cover.rotation.y = Math.PI / 2;
      car.add(cover);
    }
  }

  // ---- charge port (+x rear quarter) and hover headlight glow
  const portLocal = hitPt(PL.R, -1.76, 0.88) || v3(0.92, 0.88, -1.76);
  const headGlow = [];
  for (const s of [1, -1]) {
    const sl = new THREE.SpotLight(0xe6efff, 0, 5, 0.55, 0.7, 1.6);
    sl.position.set(s * 0.62, 0.64, 2.2);
    sl.target.position.set(s * 0.8, 0, 5.2);
    car.add(sl); car.add(sl.target);
    headGlow.push(sl);
  }

  ctx.add(car);
  car.updateMatrixWorld(true);

  // ---- contact shadow
  {
    const sh = tex.canvasTexture(256, 512, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.filter = 'blur(22px)';
      g.fillStyle = 'rgba(0,0,0,0.55)';
      roundRect(g, w * 0.16, h * 0.1, w * 0.68, h * 0.8, 50); g.fill();
      g.filter = 'blur(12px)';
      g.fillStyle = 'rgba(0,0,0,0.5)';
      roundRect(g, w * 0.24, h * 0.16, w * 0.52, h * 0.68, 30); g.fill();
      g.filter = 'blur(5px)';
      g.fillStyle = 'rgba(0,0,0,0.85)';
      const wz = (z) => h * (0.5 - z / 5.6);
      const wx = (x) => w * (0.5 + x / 2.8);
      for (const [x, z, ww] of [[0.82, AXF, 0.24], [-0.82, AXF, 0.24], [0.8, AXR, 0.3], [-0.8, AXR, 0.3]]) {
        g.fillRect(wx(x) - (ww / 2.8 * w) / 2, wz(z) - 14, ww / 2.8 * w, 28);
      }
    }, { wrap: false });
    const cs = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 5.6), new THREE.MeshBasicMaterial({ map: sh, transparent: true, depthWrite: false, color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    cs.rotation.x = -Math.PI / 2;
    cs.position.set(CAR_POS.x, 0.004, CAR_POS.z);
    cs.renderOrder = 1;
    ctx.add(cs);
  }

  // ================================================================ solar hardware
  const wallX = 3.58;
  const white = new THREE.MeshPhysicalMaterial({ color: 0xeceef0, roughness: 0.32, clearcoat: 0.4, clearcoatRoughness: 0.2, envMap, envMapIntensity: 0.6 });
  const graphite = new THREE.MeshPhysicalMaterial({ color: 0x2a2d32, roughness: 0.4, metalness: 0.3, clearcoat: 0.6, envMap, envMapIntensity: 0.7 });
  const conduitMat = new THREE.MeshStandardMaterial({ color: 0xa7abb0, metalness: 0.8, roughness: 0.4 });
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.55, metalness: 0.05 });
  const conduit = (grp, x, y0, y1, z, r = 0.016) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, y1 - y0, 12), conduitMat);
    c.position.set(x, (y0 + y1) / 2, z); grp.add(c);
    for (const y of [y0 + 0.15, y1 - 0.15]) {
      if (y1 - y0 < 0.4) break;
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, r * 2 + 0.02), conduitMat); strap.position.set(x + 0.004, y, z); grp.add(strap);
    }
    return c;
  };

  // ---- EV charger
  const charger = new THREE.Group();
  charger.name = 'ev-charger';
  {
    const box = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.38, 0.25, 4, 0.035), graphite);
    box.position.set(wallX - 0.065, 1.2, -2.0); box.castShadow = true; box.receiveShadow = true; charger.add(box);
    const face = new THREE.Mesh(new RoundedBoxGeometry(0.012, 0.34, 0.21, 3, 0.005), glass);
    face.position.set(wallX - 0.131, 1.2, -2.0); charger.add(face);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x0a2012, emissive: 0x2dff7a, emissiveIntensity: 2.6 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.0065, 12, 48), ringMat);
    ring.position.set(wallX - 0.139, 1.25, -2.0); ring.rotation.y = Math.PI / 2; charger.add(ring);
    const bolt = tex.label('⚡', { font: '700 120px Arial, sans-serif', color: '#7dffae', height: 160, pad: 10 });
    const bm = new THREE.Mesh(new THREE.PlaneGeometry(0.05 * bolt.aspect, 0.05), new THREE.MeshBasicMaterial({ map: bolt.texture, transparent: true }));
    bm.position.set(wallX - 0.139, 1.25, -2.0); bm.rotation.y = -Math.PI / 2; charger.add(bm);
    const lb = tex.label('PRISTINE', { font: '700 90px Arial, sans-serif', color: '#c9ced6', height: 130, pad: 10 });
    const lm = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12 / lb.aspect), new THREE.MeshBasicMaterial({ map: lb.texture, transparent: true }));
    lm.position.set(wallX - 0.139, 1.1, -2.0); lm.rotation.y = -Math.PI / 2; charger.add(lm);
    const ledLight = new THREE.PointLight(0x39ff88, 0.35, 0.9, 2);
    ledLight.position.set(wallX - 0.25, 1.25, -2.0); charger.add(ledLight);
    charger.userData.ring = ringMat; charger.userData.led = ledLight;
    conduit(charger, wallX - 0.03, 1.39, 2.9, -2.0);
    // cable management hook + coiled cable
    const hook = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.05, 0.14, 2, 0.012), graphite);
    hook.position.set(wallX - 0.035, 1.02, -1.66); charger.add(hook);
    for (let k = 0; k < 3; k++) {
      const pts = [];
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * Math.PI * 2;
        pts.push(v3(wallX - 0.075 - k * 0.018 + Math.sin(a) * 0.012, 0.83 + Math.cos(a) * (0.19 + k * 0.012) * (Math.cos(a) < 0 ? 1.12 : 1), -1.66 + Math.sin(a) * (0.12 + k * 0.01) + k * 0.006));
      }
      const loop = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 64, 0.011, 8, true), cableMat);
      loop.castShadow = hi; charger.add(loop);
    }
    // cable from the box down to the floor and over to the car's charge port
    const port = portLocal.clone().add(CAR_POS);
    const outDir = v3(0.8, -0.35, -0.1).normalize();
    const handleEnd = port.clone().addScaledVector(outDir, 0.13);
    const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.1, 6, 12), graphite);
    handle.position.copy(port).addScaledVector(outDir, 0.06);
    handle.quaternion.setFromUnitVectors(v3(0, 1, 0), outDir);
    handle.castShadow = true; charger.add(handle);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 8, 24), new THREE.MeshStandardMaterial({ color: 0x0a2012, emissive: 0x2dff7a, emissiveIntensity: 1.2 }));
    collar.position.copy(port).addScaledVector(outDir, 0.012); collar.quaternion.setFromUnitVectors(v3(0, 0, 1), outDir); charger.add(collar);
    const path = [
      v3(wallX - 0.065, 1.01, -2.0), v3(wallX - 0.07, 0.8, -2.02), v3(wallX - 0.1, 0.42, -2.08), v3(wallX - 0.19, 0.1, -2.22),
      v3(3.22, 0.012, -2.5), v3(2.95, 0.012, -3.0), v3(2.72, 0.012, -3.7), v3(2.55, 0.012, -4.4), v3(2.38, 0.013, -4.95),
      v3(handleEnd.x + 0.2, 0.06, handleEnd.z - 0.06), v3(handleEnd.x + 0.1, (handleEnd.y) * 0.45, handleEnd.z - 0.02), handleEnd,
    ];
    const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path, false, 'centripetal'), hi ? 260 : 140, 0.012, 8, false), cableMat);
    cable.castShadow = true; cable.receiveShadow = true; charger.add(cable);
  }
  ctx.add(charger);

  // ---- home battery + inverter
  const battery = new THREE.Group();
  battery.name = 'solar-battery';
  const statusMats = [];
  {
    for (const z of [-3.92, -4.64]) {
      const cab = new THREE.Mesh(new RoundedBoxGeometry(0.19, 1.16, 0.58, 4, 0.04), white);
      cab.position.set(wallX - 0.095, 0.66, z); cab.castShadow = true; cab.receiveShadow = true; battery.add(cab);
      const plinth = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.08, 0.5, 2, 0.01), graphite);
      plinth.position.set(wallX - 0.085, 0.04, z); battery.add(plinth);
      const sm = new THREE.MeshStandardMaterial({ color: 0x06140c, emissive: 0x44ff99, emissiveIntensity: 1.6 });
      statusMats.push(sm);
      for (let k = 0; k < 4; k++) {
        const seg = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.012, 0.05), k < 3 ? sm : new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.4 }));
        seg.position.set(wallX - 0.192, 1.05, z - 0.09 + k * 0.06); battery.add(seg);
      }
      const lb = tex.label('PRISTINE  POWERCELL', { font: '600 70px Arial, sans-serif', color: '#8e959e', height: 110, pad: 10 });
      const lm = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3 / lb.aspect), new THREE.MeshBasicMaterial({ map: lb.texture, transparent: true }));
      lm.position.set(wallX - 0.192, 0.97, z); lm.rotation.y = -Math.PI / 2; battery.add(lm);
      conduit(battery, wallX - 0.03, 1.24, 1.42, z + 0.2, 0.013);
    }
    const inv = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.46, 0.56, 4, 0.03), new THREE.MeshPhysicalMaterial({ color: 0xd3d6da, roughness: 0.4, metalness: 0.15, clearcoat: 0.3 }));
    inv.position.set(wallX - 0.085, 1.66, -4.28); inv.castShadow = true; inv.receiveShadow = true; battery.add(inv);
    const fins = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.44, 0.5, 2, 0.008), graphite);
    fins.position.set(wallX - 0.004, 1.66, -4.28); battery.add(fins);
    const disp = tex.canvasTexture(512, 320, (g, w, h) => {
      g.fillStyle = '#041008'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#6dffa8'; g.font = '700 44px Arial, sans-serif'; g.fillText('SOLAR', 28, 64);
      g.font = '800 96px Arial, sans-serif'; g.fillStyle = '#b6ffd2'; g.fillText('7.8 kW', 26, 160);
      g.strokeStyle = '#2e7a4d'; g.lineWidth = 2; g.beginPath(); g.moveTo(28, 290); g.lineTo(w - 28, 290); g.stroke();
      g.fillStyle = 'rgba(109,255,168,0.28)'; g.strokeStyle = '#6dffa8'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(28, 290);
      for (let i = 0; i <= 60; i++) { const x = 28 + (w - 56) * i / 60, t = (i - 30) / 12; g.lineTo(x, 290 - 95 * Math.exp(-t * t) * (1 + 0.05 * Math.sin(i * 1.7))); }
      g.lineTo(w - 28, 290); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#6dffa8'; g.font = '600 28px Arial, sans-serif'; g.fillText('TODAY 41.2 kWh', 300, 64);
      g.beginPath(); g.arc(w / 2 + 40, 290 - 95 * 0.88, 7, 0, Math.PI * 2); g.fill();
    }, { wrap: false });
    const dm = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.125), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: disp, emissiveIntensity: 1.1, roughness: 0.2 }));
    dm.position.set(wallX - 0.172, 1.72, -4.28); dm.rotation.y = -Math.PI / 2; battery.add(dm);
    const bezel = new THREE.Mesh(new RoundedBoxGeometry(0.006, 0.15, 0.23, 2, 0.003), trim);
    bezel.position.set(wallX - 0.169, 1.72, -4.28); battery.add(bezel);
    const lb = tex.label('PRISTINE SOLAR', { font: '700 70px Arial, sans-serif', color: '#5b636d', height: 110, pad: 10 });
    const lm = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2 / lb.aspect), new THREE.MeshBasicMaterial({ map: lb.texture, transparent: true }));
    lm.position.set(wallX - 0.171, 1.55, -4.28); lm.rotation.y = -Math.PI / 2; battery.add(lm);
    conduit(battery, wallX - 0.03, 1.89, 2.9, -4.12, 0.018);
    conduit(battery, wallX - 0.03, 1.89, 2.9, -4.44, 0.018);
    // AC disconnect
    const dsc = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.24, 0.18, 2, 0.015), new THREE.MeshStandardMaterial({ color: 0x8c9196, metalness: 0.5, roughness: 0.5 }));
    dsc.position.set(wallX - 0.05, 1.62, -3.72); dsc.castShadow = hi; battery.add(dsc);
    const handle = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.09, 0.025, 2, 0.008), new THREE.MeshStandardMaterial({ color: 0xb3121c, roughness: 0.4 }));
    handle.position.set(wallX - 0.11, 1.64, -3.66); battery.add(handle);
    conduit(battery, wallX - 0.03, 1.74, 2.9, -3.72, 0.014);
  }
  ctx.add(battery);

  // ---- utility meter / solar monitor
  const meter = new THREE.Group();
  meter.name = 'solar-meter';
  {
    const mz = -0.9, my = 1.5;
    const base = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.36, 0.26, 3, 0.02), new THREE.MeshStandardMaterial({ color: 0x8f969c, metalness: 0.55, roughness: 0.45 }));
    base.position.set(wallX - 0.045, my, mz); base.castShadow = hi; meter.add(base);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.083, 0.008, 10, 40), chrome);
    collar.position.set(wallX - 0.092, my, mz); collar.rotation.y = Math.PI / 2; meter.add(collar);
    const faceTex = tex.canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#e9e5da'; g.beginPath(); g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#10261a'; g.fillRect(58, 88, 140, 52);
      g.fillStyle = '#7cffb0'; g.font = '700 30px monospace'; g.fillText('-212.4', 66, 126);
      g.fillStyle = '#333'; g.font = '700 18px Arial, sans-serif'; g.textAlign = 'center';
      g.fillText('NET kWh', w / 2, 164); g.fillText('SOLAR ▲ GRID', w / 2, 190); g.fillText('PRISTINE', w / 2, 70);
    }, { wrap: false });
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.072, 40), new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.6, emissive: 0x0b2014, emissiveIntensity: 0.4 }));
    face.position.set(wallX - 0.12, my, mz); face.rotation.y = -Math.PI / 2; meter.add(face);
    const dome = new THREE.LatheGeometry([
      new THREE.Vector2(0.079, 0), new THREE.Vector2(0.079, 0.07), new THREE.Vector2(0.074, 0.098),
      new THREE.Vector2(0.056, 0.116), new THREE.Vector2(0.03, 0.124), new THREE.Vector2(0.0, 0.126)], 40);
    dome.rotateZ(Math.PI / 2);
    const dm = new THREE.Mesh(dome, new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, roughness: 0.03, metalness: 0, clearcoat: 1, envMap, envMapIntensity: 1.5, depthWrite: false }));
    dm.position.set(wallX - 0.092, my, mz); meter.add(dm);
    conduit(meter, wallX - 0.03, 0, my - 0.18, mz, 0.02);
    conduit(meter, wallX - 0.03, my + 0.18, 2.9, mz, 0.016);
  }
  ctx.add(meter);

  // ================================================================ hotspots + api
  ctx.hotspot(car, {
    id: 'hot-vette',
    anchor: [CAR_POS.x, 1.5, CAR_POS.z - 0.3],
    views: { garage: { go: 'solar', label: 'Featured: Solar' }, solar: { item: 'solar-quote', label: 'Get my solar quote' } },
  });
  ctx.hotspot(charger, { id: 'hot-charger', anchor: [wallX - 0.2, 1.5, -2.0], views: { solar: { item: 'solar-ev', label: 'EV charging' } } });
  ctx.hotspot(battery, { id: 'hot-battery', anchor: [wallX - 0.25, 2.02, -4.28], views: { solar: { item: 'solar-how', label: 'How solar works' } } });
  ctx.hotspot(meter, { id: 'hot-meter', anchor: [wallX - 0.2, 1.78, -0.9], views: { solar: { item: 'solar-savings', label: 'Savings & net metering' } } });

  let hover = false, hv = 0, hoverT = 0;
  const api = {
    carGroup: car,
    chargePort: portLocal.clone().add(CAR_POS),
    setHover(b) { if (b && !hover) hoverT = 0; hover = !!b; },
  };
  ctx.api.solar = api;

  ctx.onUpdate((dt, t) => {
    hv += ((hover ? 1 : 0) - hv) * Math.min(1, dt * 4);
    hoverT += dt;
    const pulse = hover ? 0.5 + 0.5 * Math.sin(hoverT * 5.5 - Math.PI / 2) : 0;
    drlMat.emissiveIntensity = 2.4 + hv * (1.5 + 2.5 * pulse);
    for (const l of headGlow) l.intensity = 0.25 + hv * (1.5 + 1.5 * pulse);
    const breathe = 0.5 + 0.5 * Math.sin(t * 1.6);
    charger.userData.ring.emissiveIntensity = 1.6 + 1.6 * breathe;
    charger.userData.led.intensity = 0.2 + 0.3 * breathe;
    for (let i = 0; i < statusMats.length; i++) statusMats[i].emissiveIntensity = 1.2 + 0.5 * Math.sin(t * 0.9 + i);
  });

  return api;
}

// ---------------------------------------------------------------- helpers
// Loft a set of stations (each a loop of NA+1 xy points at a z) into an indexed
// grid. groupFn(i, j) -> material index for quad (i, j), or null for one group.
function loftGeometry(rows, NA, groupFn) {
  const nz = rows.length;
  const pos = new Float32Array(nz * (NA + 1) * 3), uv = new Float32Array(nz * (NA + 1) * 2);
  const z0 = rows[0].z, z1 = rows[nz - 1].z;
  for (let i = 0; i < nz; i++) {
    const r = rows[i];
    for (let j = 0; j <= NA; j++) {
      const k = i * (NA + 1) + j;
      pos[k * 3] = r.pts[j * 2]; pos[k * 3 + 1] = r.pts[j * 2 + 1]; pos[k * 3 + 2] = r.z;
      uv[k * 2] = (r.z - z0) / (z1 - z0); uv[k * 2 + 1] = j / NA;
    }
  }
  const groups = [[], [], []];
  for (let i = 0; i < nz - 1; i++) for (let j = 0; j < NA; j++) {
    const a = i * (NA + 1) + j, b = a + 1, c = a + (NA + 1), d = c + 1;
    const gidx = groupFn ? groupFn(i, j) : 0;
    groups[gidx].push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const idx = [];
  let start = 0;
  groups.forEach((arr, m) => { if (!arr.length) return; for (const v of arr) idx.push(v); g.addGroup(start, arr.length, m); start += arr.length; });
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  g.computeVertexNormals();
  return g;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}

// Reflection environment for the car: a dim garage box with strip lights over
// the car, a dusk-blue door opening to the front and a warm glow at the back.
function buildEnv(renderer) {
  const s = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 16), new THREE.MeshBasicMaterial({ color: 0x15171b, side: THREE.BackSide }));
  room.position.y = 1.6; s.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 16), new THREE.MeshBasicMaterial({ color: 0x24262a }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.55; s.add(floor);
  const emis = (w, h, col, k) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide }));
  for (const [x, z] of [[-0.9, 0.2], [0.9, 0.2], [-0.9, -2.8], [0.9, -2.8]]) {
    const st = emis(0.16, 2.4, 0xfff6ea, 14); st.rotation.x = Math.PI / 2; st.position.set(x, 2.25, z); s.add(st);
  }
  const cross = emis(2.6, 0.14, 0xfff6ea, 10); cross.rotation.x = Math.PI / 2; cross.position.set(0, 2.25, 2.6); s.add(cross);
  const door = emis(5.5, 2.3, 0x33507e, 1.4); door.position.set(0, 0.6, 7.9); door.rotation.y = Math.PI; s.add(door);
  const sky = emis(5.5, 0.8, 0x6d8fc4, 1.6); sky.position.set(0, 2.1, 7.9); sky.rotation.y = Math.PI; s.add(sky);
  const warm = emis(1.2, 0.5, 0xff7a3c, 3); warm.position.set(0.5, 1.8, -7.9); s.add(warm);
  const bench = emis(1.8, 0.6, 0xffe2b8, 3); bench.position.set(-5.9, 1.3, 0.5); bench.rotation.y = Math.PI / 2; s.add(bench);
  const side = emis(0.6, 1.4, 0xbfe8ff, 1.2); side.position.set(5.9, 1.0, 1.0); side.rotation.y = -Math.PI / 2; s.add(side);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.012);
  pm.dispose();
  return rt.texture;
}

// Tire: lathe profile with rounded shoulders and a sidewall bulge.
// Returns geometries for tire, rim parts, brake disc and caliper (axle = +z, face = +z).
function makeWheelGeos(W, hi) {
  const R = W.r, hw = W.w / 2, rr = W.rim, sw = R - rr;
  const seg = hi ? 72 : 40;
  const ctrl = [
    [rr - 0.004, -hw * 0.80], [rr + 0.012, -hw * 0.88], [rr + sw * 0.3, -hw * 0.98], [rr + sw * 0.6, -hw * 1.0],
    [R - 0.016, -hw * 0.93], [R - 0.003, -hw * 0.80], [R, -hw * 0.55], [R, 0], [R, hw * 0.55],
    [R - 0.003, hw * 0.80], [R - 0.016, hw * 0.93], [rr + sw * 0.6, hw * 1.0], [rr + sw * 0.3, hw * 0.98],
    [rr + 0.012, hw * 0.88], [rr - 0.004, hw * 0.80],
  ].map(([r, a]) => new THREE.Vector2(r, a));
  const prof = new THREE.SplineCurve(ctrl).getSpacedPoints(hi ? 60 : 36);
  const tire = new THREE.LatheGeometry(prof, seg);
  tire.rotateX(Math.PI / 2);
  // contact patch: flatten the bottom, bulge the sidewalls a touch
  const p = tire.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let y = p.getY(i), z = p.getZ(i);
    const b = smooth(-0.6 * R, -R, y);
    if (y < -(R - 0.012)) y = -(R - 0.012);
    z *= 1 + 0.05 * b;
    p.setY(i, y); p.setZ(i, z);
  }
  tire.computeVertexNormals();

  const face = hw * 0.84;
  const lip = new THREE.LatheGeometry([
    [rr - 0.012, face - 0.05], [rr - 0.012, face - 0.012], [rr + 0.004, face - 0.004], [rr + 0.012, face], [rr + 0.008, face + 0.006], [rr - 0.008, face + 0.004], [rr - 0.02, face - 0.004],
  ].map(([r, a]) => new THREE.Vector2(r, a)), seg);
  lip.rotateX(Math.PI / 2);
  const barrel = new THREE.LatheGeometry([[rr - 0.016, -hw * 0.9], [rr - 0.012, face - 0.05]].map(([r, a]) => new THREE.Vector2(r, a)), seg);
  barrel.rotateX(Math.PI / 2);

  // 10 spokes in five twin pairs, concave toward the hub
  const rHub = 0.075, rRim = rr - 0.014, depth = 0.026, hubZ = face - 0.055;
  const faceZ = (r) => hubZ + (face - 0.004 - hubZ) * Math.sqrt(Math.min(1, Math.max(0, (r - rHub) / (rRim - rHub))));
  const spokeGeos = [];
  for (let k = 0; k < 5; k++) for (const off of [-0.105, 0.105]) {
    const sh = new THREE.Shape();
    sh.moveTo(-0.017, rHub - 0.01); sh.lineTo(0.017, rHub - 0.01); sh.lineTo(0.0105, rRim + 0.006); sh.lineTo(-0.0105, rRim + 0.006); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelSize: 0.0045, bevelThickness: 0.004, bevelSegments: 2, steps: 1, curveSegments: 2 });
    // subdivide along the length is not needed: bend by moving each vertex
    const q = g.attributes.position;
    for (let i = 0; i < q.count; i++) { const r = q.getY(i); q.setZ(i, q.getZ(i) - depth + faceZ(r)); }
    g.rotateZ(k * Math.PI * 2 / 5 + off);
    g.computeVertexNormals();
    spokeGeos.push(g.index ? g.toNonIndexed() : g);
  }
  const spokes = mergeGeometries(spokeGeos.map((g) => { g.deleteAttribute('uv'); return g; }));
  spokes.computeVertexNormals();

  const hub = new THREE.CylinderGeometry(rHub + 0.012, rHub + 0.02, 0.045, 36);
  hub.rotateX(Math.PI / 2); hub.translate(0, 0, hubZ - 0.012);
  const cap = new THREE.CylinderGeometry(0.034, 0.036, 0.012, 28);
  cap.rotateX(Math.PI / 2); cap.translate(0, 0, hubZ + 0.012);
  const nutGeos = [];
  for (let k = 0; k < 5; k++) {
    const n = new THREE.CylinderGeometry(0.0095, 0.0095, 0.02, 6);
    n.rotateX(Math.PI / 2);
    const a = k * Math.PI * 2 / 5 + Math.PI / 5;
    n.translate(Math.cos(a) * 0.056, Math.sin(a) * 0.056, hubZ + 0.012);
    nutGeos.push(n);
  }
  const nuts = mergeGeometries(nutGeos);

  const rDisc = rr - 0.045, discZ = hubZ - 0.075;
  const disc = new THREE.CylinderGeometry(rDisc, rDisc, 0.03, hi ? 56 : 32);
  disc.rotateX(Math.PI / 2); disc.translate(0, 0, discZ);
  const hat = new THREE.CylinderGeometry(0.095, 0.1, 0.06, 28);
  hat.rotateX(Math.PI / 2); hat.translate(0, 0, discZ + 0.03);
  const cs = new THREE.Shape();
  const a0 = Math.PI / 2 - 0.62, a1 = Math.PI / 2 + 0.62, ri = rDisc - 0.058, ro = rDisc + 0.014;
  cs.absarc(0, 0, ro, a0, a1, false); cs.absarc(0, 0, ri, a1, a0, true); cs.closePath();
  const caliper = new THREE.ExtrudeGeometry(cs, { depth: 0.062, bevelEnabled: true, bevelSize: 0.009, bevelThickness: 0.009, bevelSegments: 3, curveSegments: 16 });
  caliper.translate(0, 0, discZ - 0.031);
  return { tire, lip, barrel, spokes, hub, cap, nuts, disc, hat, caliper };
}

function makeTireTex(tex) {
  const map = tex.canvasTexture(1024, 256, (g, w, h) => {
    g.fillStyle = '#1d1d1e'; g.fillRect(0, 0, w, h);
    // v runs inner bead (canvas bottom) -> outer bead (canvas top). Tread is the middle ~40 %.
    const row = (v) => h * (1 - v);
    g.fillStyle = '#171718'; g.fillRect(0, row(0.70), w, row(0.30) - row(0.70));
    g.fillStyle = '#060606';
    for (const v of [0.37, 0.45, 0.55, 0.63]) g.fillRect(0, row(v) - 2, w, 4);
    for (let i = 0; i < 160; i++) { const x = i / 160 * w; g.fillRect(x, row(0.70), 2, row(0.64) - row(0.70)); g.fillRect(x + 3, row(0.36), 2, row(0.30) - row(0.36)); }
    // outer sidewall lettering
    g.fillStyle = '#3a3a3c'; g.font = '700 22px Arial, sans-serif'; g.textBaseline = 'middle';
    for (let k = 0; k < 2; k++) {
      g.fillText('PRISTINE  SPORT  P-ZR', k * w / 2 + 40, row(0.84));
      g.fillText('305/30 ZR20  RADIAL', k * w / 2 + 300, row(0.84));
    }
    g.fillStyle = '#262627'; g.fillRect(0, row(0.93) - 1, w, 2); g.fillRect(0, row(0.76) - 1, w, 2);
  });
  return { map };
}

function makeDiscTex(tex) {
  return tex.canvasTexture(256, 256, (g, w, h) => {
    const c = w / 2;
    g.fillStyle = '#4a4d52'; g.fillRect(0, 0, w, h);
    const grd = g.createRadialGradient(c, c, 60, c, c, 128);
    grd.addColorStop(0, '#8a8e94'); grd.addColorStop(0.5, '#b0b4b9'); grd.addColorStop(1, '#8d9095');
    g.fillStyle = grd; g.beginPath(); g.arc(c, c, 128, 0, Math.PI * 2); g.arc(c, c, 62, 0, Math.PI * 2, true); g.fill();
    g.fillStyle = '#1b1c1e';
    for (let ring = 0; ring < 3; ring++) for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2 + ring * 0.12, r = 80 + ring * 15;
      g.beginPath(); g.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 3.2, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#2f3134'; g.beginPath(); g.arc(c, c, 60, 0, Math.PI * 2); g.fill();
  }, { wrap: false });
}
