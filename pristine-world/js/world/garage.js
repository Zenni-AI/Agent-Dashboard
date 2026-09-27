// garage.js: the world shell and ALL global lighting.
// A two-car garage attached to a house at dusk, seen from the driveway.
// Units are meters, +y up. Front wall (door plane) is z = 0, interior is z < 0.
// Exposes ctx.api.garage.openDoor(seconds) -> Promise, closeDoor(seconds), setLights(v).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export function build(ctx) {
  const { scene, tex, renderer } = ctx;
  const HIGH = ctx.quality !== 'low';
  const { rng, canvasTexture } = tex;
  // Low-frequency blotches drawn on a small canvas and scaled up (much faster than full-res gradients).
  function blotches(g, w, h, o = {}) {
    const k = w * h > 300000 ? 8 : 4;
    const c = document.createElement('canvas');
    c.width = Math.max(8, Math.round(w / k)); c.height = Math.max(8, Math.round(h / k));
    tex.blotches(c.getContext('2d'), c.width, c.height, { ...o, min: (o.min ?? 10) / k, max: (o.max ?? 80) / k });
    g.imageSmoothingEnabled = true;
    g.drawImage(c, 0, 0, w, h);
  }
  const SHADOW = HIGH ? 2048 : 1024;
  const DBG = new URLSearchParams(location.search).get('dbg') || '';
  RectAreaLightUniformsLib.init();


  const root = new THREE.Group();
  root.name = 'garage-world';
  const api = (ctx.api.garage = ctx.api.garage || {});

  // ------------------------------------------------------------------ helpers
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const rbox = (w, h, d, r = 0.01, seg) =>
    new RoundedBoxGeometry(w, h, d, seg ?? 1, Math.min(r, Math.min(w, h, d) / 2 - 1e-4));
  const cyl = (rt, rb, h, s = 16) => new THREE.CylinderGeometry(rt, rb, h, HIGH ? s : Math.max(6, s >> 1));
  const col = (hex) => new THREE.Color(hex);

  function uvScale(g, su, sv) {
    const uv = g.attributes.uv;
    if (!uv) return g;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    uv.needsUpdate = true;
    return g;
  }

  // Static-geometry batching: everything put() with the same material is merged into one mesh.
  const buckets = new Map();
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  function prep(geo) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups();
    g.morphAttributes = {};
    return g;
  }
  function putM(geo, mat, matrix, o = {}) {
    const g = prep(geo);
    g.applyMatrix4(matrix);
    const cast = o.cast ?? true, recv = o.receive ?? true;
    const key = mat.uuid + (cast ? 'c' : '') + (recv ? 'r' : '');
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat, cast, recv, geos: [] }));
    b.geos.push(g);
  }
  function put(geo, mat, p = [0, 0, 0], r = [0, 0, 0], o = {}) {
    _e.set(r[0], r[1], r[2], o.order || 'XYZ');
    _q.setFromEuler(_e);
    _m.compose(V(...p), _q, o.scale ? V(...o.scale) : V(1, 1, 1));
    putM(geo, mat, _m, o);
  }
  // Put a y-aligned geometry of length |b-a| between two points.
  function along(a, b) {
    const d = b.clone().sub(a);
    const L = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize());
    return { m: new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(1, 1, 1)), L };
  }
  function flush() {
    let n = 0;
    for (const b of buckets.values()) {
      const g = mergeGeometries(b.geos, false);
      const mesh = new THREE.Mesh(g, b.mat);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = b.recv;
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
      n++;
    }
    buckets.clear();
    return n;
  }
  // Roof slab: top surface passes through the line a->b (both at the middle of the run along axis e).
  function slab(mat, a, b, e, len, t, o) {
    const d = b.clone().sub(a);
    const L = d.length();
    d.normalize();
    const X = e.clone().normalize();
    const Y = new THREE.Vector3().crossVectors(d, X).normalize();
    if (Y.y < 0) Y.negate();
    const Z = new THREE.Vector3().crossVectors(X, Y);
    if (Z.y > 0) { X.negate(); Z.negate(); }
    const m = new THREE.Matrix4().makeBasis(X, Y, Z);
    m.setPosition(a.clone().add(b).multiplyScalar(0.5).addScaledVector(Y, -t / 2));
    putM(uvScale(box(len, t, L), len, L), mat, m, o);
  }

  // Pixel layers are built in CPU memory and drawn over (canvas readbacks are very slow on some GPUs).
  function layer(w, h, fill) {
    const img = new ImageData(w, h);
    fill(img.data, w, h);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d', { willReadFrequently: true }).putImageData(img, 0, 0);
    return c;
  }
  const noiseTiles = new Map();
  function pixNoise(g, w, h, amt, seed = 1) {
    const key = amt + ':' + (seed % 4);
    let t = noiseTiles.get(key);
    if (!t) {
      const r = rng(seed);
      t = layer(256, 256, (a) => {
        for (let i = 0; i < a.length; i += 4) {
          const n = r() - 0.5, v = n > 0 ? 255 : 0;
          a[i] = a[i + 1] = a[i + 2] = v; a[i + 3] = Math.abs(n) * amt * 255 * 1.6;
        }
      });
      noiseTiles.set(key, t);
    }
    g.save(); g.fillStyle = g.createPattern(t, 'repeat'); g.fillRect(0, 0, w, h); g.restore();
  }
  const lin = { srgb: false };

  // ------------------------------------------------------------------ textures
  // Epoxy garage floor (one non-repeating texture over x[-3.8,3.8], z[-7.4,0.02]).
  const FS = HIGH ? 2048 : 1024;
  const FX = (x) => ((x + 3.8) / 7.6) * FS;
  const FZ = (z) => ((z + 7.4) / 7.42) * FS; // canvas top = back wall
  const floorMap = canvasTexture(FS, FS, (g, w, h) => {
    g.fillStyle = '#8a8f95'; g.fillRect(0, 0, w, h);
    blotches(g, w, h, { count: 70, min: w * 0.03, max: w * 0.16, color: '255,255,255', alpha: 0.035, seed: 11 });
    blotches(g, w, h, { count: 50, min: w * 0.02, max: w * 0.1, color: '30,30,35', alpha: 0.05, seed: 12 });
    // epoxy flakes, written straight into a pixel layer
    g.drawImage(layer(w, h, (a) => {
      const r = rng(5);
      const cols = [[37, 39, 43], [52, 55, 60], [218, 219, 220], [243, 243, 242], [102, 112, 122], [154, 162, 170], [87, 77, 69], [185, 174, 156]];
      const n = HIGH ? 150000 : 40000, fs = w / 2048;
      for (let i = 0; i < n; i++) {
        const c = cols[(r() * cols.length) | 0], al = (140 + r() * 115) | 0;
        const sx = Math.max(1, Math.round((1 + r() * 3) * fs * 1.4)), sy = Math.max(1, Math.round(sx * (0.4 + r() * 0.6)));
        const x0 = (r() * (w - 4)) | 0, y0 = (r() * (h - 4)) | 0;
        for (let yy = 0; yy < sy; yy++) for (let xx = 0; xx < sx; xx++) {
          const o = ((y0 + yy) * w + x0 + xx) * 4;
          a[o] = c[0]; a[o + 1] = c[1]; a[o + 2] = c[2]; a[o + 3] = al;
        }
      }
    }), 0, 0);
    const fs = w / 2048;
    // grime along the walls
    const edge = (x0, y0, x1, y1) => {
      const gr = g.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, 'rgba(40,36,30,0.35)'); gr.addColorStop(1, 'rgba(40,36,30,0)');
      g.fillStyle = gr;
      g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) || w, Math.abs(y1 - y0) || h);
    };
    edge(FX(-3.6), 0, FX(-3.3), 0); edge(FX(3.6), 0, FX(3.3), 0); edge(0, FZ(-7.2), 0, FZ(-6.9));
    // saw-cut control joint across the middle and down the center
    g.fillStyle = 'rgba(25,25,28,0.8)';
    g.fillRect(0, FZ(-3.7) - 2, w, 4 * fs); g.fillRect(FX(-0.15) - 2, 0, 4 * fs, h);
    // tire scuffs & traffic wear
    const r2 = rng(9);
    for (const tx of [0.1, 1.7, -1.9, -0.3]) {
      const faint = tx < 0 ? 0.4 : 1;
      for (let k = 0; k < 26; k++) {
        g.strokeStyle = `rgba(22,22,24,${(0.03 + r2() * 0.05) * faint})`;
        g.lineWidth = (8 + r2() * 30) * fs;
        const x = FX(tx + (r2() - 0.5) * 0.18);
        g.beginPath(); g.moveTo(x, FZ(0.02)); g.bezierCurveTo(x + (r2() - 0.5) * 30, FZ(-2), x + (r2() - 0.5) * 30, FZ(-4), x + (r2() - 0.5) * 20, FZ(-5.4 + r2())); g.stroke();
      }
    }
    for (let k = 0; k < 10; k++) {
      g.strokeStyle = `rgba(20,20,20,${0.04 + r2() * 0.05})`; g.lineWidth = (10 + r2() * 14) * fs;
      const x = FX(-0.4 + r2() * 2.6), y = FZ(-0.4 - r2() * 1.2);
      g.beginPath(); g.arc(x, y, (150 + r2() * 300) * fs, -0.6 + r2(), 0.2 + r2()); g.stroke();
    }
    // oil drip under the (future) engine bay and a water ring
    for (const [x, z, rad, a] of [[0.9, -1.6, 0.28, 0.28], [1.1, -1.75, 0.12, 0.3], [-2.6, -6.6, 0.3, 0.12]]) {
      const gr = g.createRadialGradient(FX(x), FZ(z), 0, FX(x), FZ(z), (rad / 7.6) * w);
      gr.addColorStop(0, `rgba(25,20,15,${a})`); gr.addColorStop(0.7, `rgba(25,20,15,${a * 0.5})`); gr.addColorStop(1, 'rgba(25,20,15,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(FX(x), FZ(z), (rad / 7.6) * w, (rad / 7.6) * w * 0.8, 0.4, 0, 6.283); g.fill();
    }
    pixNoise(g, w, h, 0.05, 3);
  });
  const floorRough = canvasTexture(FS / 2, FS / 2, (g, w, h) => {
    g.fillStyle = 'rgb(72,72,72)'; g.fillRect(0, 0, w, h);
    blotches(g, w, h, { count: 60, min: w * 0.03, max: w * 0.14, color: '255,255,255', alpha: 0.12, seed: 21 });
    blotches(g, w, h, { count: 30, min: w * 0.02, max: w * 0.08, color: '0,0,0', alpha: 0.12, seed: 22 });
    const s = w / FS, r2 = rng(9);
    for (const tx of [0.1, 1.7]) {
      g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 60 * s;
      g.beginPath(); g.moveTo(FX(tx) * s, 0); g.lineTo(FX(tx) * s, FZ(-5.6) * s); g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, FZ(-1.2) * s, w, h);
    pixNoise(g, w, h, 0.08, r2() * 100);
  }, { ...lin });

  // Painted drywall (tile = 2.4 m wide x 2.9 m tall), grime near the floor.
  const wallMap = canvasTexture(1024, 1024, (g, w, h) => {
    g.fillStyle = '#e6e2d9'; g.fillRect(0, 0, w, h);
    blotches(g, w, h, { count: 40, min: 40, max: 200, color: '255,255,255', alpha: 0.05, seed: 31 });
    blotches(g, w, h, { count: 40, min: 30, max: 160, color: '90,80,60', alpha: 0.025, seed: 32 });
    for (const x of [0, w / 2]) { // taped seams every 1.2 m
      const gr = g.createLinearGradient(x - 26, 0, x + 26, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x - 26, 0, 52, h);
      if (x === 0) { g.fillStyle = gr; g.fillRect(w - 26, 0, 26, h); }
    }
    const r = rng(33);
    for (let i = 0; i < 90; i++) { g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect((((i % 6) + 0.5) * w) / 6 + (r() - 0.5) * 6, (i / 90) * h, 3, 3); }
    const gb = h * (0.45 / 2.9);
    const gr = g.createLinearGradient(0, h, 0, h - gb);
    gr.addColorStop(0, 'rgba(70,58,44,0.35)'); gr.addColorStop(0.35, 'rgba(70,58,44,0.12)'); gr.addColorStop(1, 'rgba(70,58,44,0)');
    g.fillStyle = gr; g.fillRect(0, h - gb, w, gb);
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = `rgba(40,35,30,${0.05 + r() * 0.12})`; g.lineWidth = 1 + r() * 3;
      const x = r() * w, y = h - (0.12 + r() * 0.6) * (h / 2.9);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 10 + r() * 50, y + (r() - 0.5) * 8); g.stroke();
    }
    pixNoise(g, w, h, 0.035, 34);
  });
  const ceilMap = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#ebe8e1'; g.fillRect(0, 0, w, h);
    blotches(g, w, h, { count: 30, min: 20, max: 120, color: '120,110,90', alpha: 0.03, seed: 41 });
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, 0, 20, h);
    pixNoise(g, w, h, 0.04, 42);
  });

  // Lap siding: tile 2.0 m x 1.78 m (10 courses of 178 mm).
  const SID_W = 2.0, SID_H = 1.78;
  const sidingDraw = (bump) => (g, w, h) => {
    const n = 10, ch = h / n, r = rng(bump ? 51 : 51);
    g.fillStyle = bump ? '#808080' : '#8e989f'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < n; k++) {
      const y0 = k * ch;
      const gr = g.createLinearGradient(0, y0, 0, y0 + ch);
      if (bump) { gr.addColorStop(0, '#303030'); gr.addColorStop(0.08, '#505050'); gr.addColorStop(1, '#e0e0e0'); }
      else {
        gr.addColorStop(0, '#4c555c'); gr.addColorStop(0.07, '#7b858c'); gr.addColorStop(0.2, '#869097');
        gr.addColorStop(0.97, '#99a3a9'); gr.addColorStop(1, '#aab3b8');
      }
      g.fillStyle = gr; g.fillRect(0, y0, w, ch);
      if (!bump) {
        for (let i = 0; i < 30; i++) {
          g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},0.025)`;
          g.fillRect(r() * w, y0 + ch * (0.15 + r() * 0.8), 40 + r() * 200, 1.5);
        }
      }
      // butt joints
      const jx = r() * w;
      g.fillStyle = bump ? '#404040' : 'rgba(40,45,50,0.6)';
      g.fillRect(jx, y0 + 4, 2.5, ch - 4);
    }
    if (!bump) {
      blotches(g, w, h, { count: 20, min: 40, max: 180, color: '30,35,30', alpha: 0.04, seed: 52 });
      pixNoise(g, w, h, 0.035, 53);
    }
  };
  const sidingMap = canvasTexture(1024, 910, sidingDraw(false), { repeat: [1 / SID_W, 1 / SID_H] });
  const sidingBump = canvasTexture(512, 455, sidingDraw(true), { repeat: [1 / SID_W, 1 / SID_H], ...lin });

  // Architectural shingles: tile 2 m x 2 m, 14 courses.
  const shingleDraw = (bump) => (g, w, h) => {
    const rows = 14, rh = h / rows, r = rng(61);
    const pal = ['#35383b', '#2b2e31', '#3b3b3a', '#303336', '#43413d', '#27292c', '#3a3d41'];
    g.fillStyle = bump ? '#808080' : '#303235'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < rows; k++) {
      const y0 = k * rh;
      let x = -r() * 120;
      while (x < w) {
        const tw = 60 + r() * 110;
        if (bump) {
          const gr = g.createLinearGradient(0, y0, 0, y0 + rh);
          const hi = 170 + r() * 60 | 0;
          gr.addColorStop(0, '#383838'); gr.addColorStop(1, `rgb(${hi},${hi},${hi})`);
          g.fillStyle = gr;
        } else g.fillStyle = pal[(r() * pal.length) | 0];
        g.fillRect(x, y0, tw, rh);
        g.fillStyle = bump ? '#202020' : 'rgba(0,0,0,0.55)';
        g.fillRect(x, y0 + rh * 0.35, 3, rh * 0.65);
        x += tw;
      }
      const sh = g.createLinearGradient(0, y0, 0, y0 + rh * 0.3);
      sh.addColorStop(0, bump ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0.6)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sh; g.fillRect(0, y0, w, rh * 0.3);
      if (!bump) { g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, y0 + rh - 2, w, 2); }
    }
    if (!bump) {
      blotches(g, w, h, { count: 25, min: 30, max: 160, color: '70,80,60', alpha: 0.05, seed: 62 });
      pixNoise(g, w, h, 0.16, 63);
    } else pixNoise(g, w, h, 0.25, 64);
  };
  const shingleMap = canvasTexture(1024, 1024, shingleDraw(false), { repeat: [0.5, 0.5] });
  const shingleBump = canvasTexture(512, 512, shingleDraw(true), { repeat: [0.5, 0.5], ...lin });

  // Driveway concrete: 6.4 m x 12 m, non-repeating. Canvas top = garage end.
  const driveMap = canvasTexture(1024, 2048, (g, w, h) => {
    const X = (x) => ((x + 3.2) / 6.4) * w, Z = (z) => (z / 12) * h;
    g.fillStyle = '#a4a19b'; g.fillRect(0, 0, w, h);
    blotches(g, w, h, { count: 90, min: 30, max: 220, color: '60,58,55', alpha: 0.06, seed: 71 });
    blotches(g, w, h, { count: 60, min: 20, max: 160, color: '255,255,250', alpha: 0.05, seed: 72 });
    const r = rng(73);
    for (const tx of [0.1, 1.7]) {
      for (let k = 0; k < 6; k++) {
        g.strokeStyle = `rgba(35,32,30,${0.012 + r() * 0.015})`; g.lineWidth = 30 + r() * 40;
        g.beginPath(); g.moveTo(X(tx + (r() - 0.5) * 0.2), 0); g.lineTo(X(tx + (r() - 0.5) * 0.3), Z(6 + r() * 6)); g.stroke();
      }
    }
    for (const [x, z, rad, a] of [[0.9, 1.4, 0.4, 0.3], [0.7, 1.9, 0.15, 0.25], [1.2, 5.5, 0.22, 0.14], [-1.5, 9.5, 0.6, 0.06]]) {
      const cx = X(x), cy = Z(z), R = (rad / 6.4) * w;
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, R);
      gr.addColorStop(0, `rgba(35,28,22,${a})`); gr.addColorStop(0.6, `rgba(35,28,22,${a * 0.6})`); gr.addColorStop(1, 'rgba(35,28,22,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy, R, R * 0.75, r(), 0, 6.283); g.fill();
    }
    // tooled expansion joints
    g.fillStyle = 'rgba(55,52,48,0.75)';
    for (const z of [4, 8]) g.fillRect(0, Z(z) - 3, w, 6);
    g.fillRect(X(0) - 2, 0, 4, h);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    for (const z of [4, 8]) g.fillRect(0, Z(z) + 3, w, 3);
    // edge darkening
    for (const [x0, x1] of [[0, 40], [w, w - 40]]) {
      const gr = g.createLinearGradient(x0, 0, x1, 0);
      gr.addColorStop(0, 'rgba(40,40,30,0.25)'); gr.addColorStop(1, 'rgba(40,40,30,0)');
      g.fillStyle = gr; g.fillRect(Math.min(x0, x1), 0, 40, h);
    }
    for (let i = 0; i < 3; i++) { // hairline cracks
      g.strokeStyle = 'rgba(40,38,35,0.5)'; g.lineWidth = 1.5;
      let x = r() * w, y = Z(1 + r() * 10); g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 14; k++) { x += (r() - 0.3) * 18; y += (r() - 0.5) * 16; g.lineTo(x, y); }
      g.stroke();
    }
    pixNoise(g, w, h, 0.09, 74);
  });
  const walkMap = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#a9a69f'; g.fillRect(0, 0, w, h);
    blotches(g, w, h, { count: 30, min: 20, max: 120, color: '60,58,55', alpha: 0.07, seed: 81 });
    pixNoise(g, w, h, 0.1, 82);
    g.fillStyle = 'rgba(45,43,40,0.85)'; g.fillRect(0, 0, w, 4); g.fillRect(0, 0, 4, h);
  });
  // Asphalt street: tile 8 m (x) by full 8.8 m width. Canvas top = house-side curb.
  const asphaltMap = canvasTexture(1024, 1024, (g, w, h) => {
    g.fillStyle = '#2f3033'; g.fillRect(0, 0, w, h);
    blotches(g, w, h, { count: 60, min: 30, max: 200, color: '0,0,0', alpha: 0.12, seed: 91 });
    blotches(g, w, h, { count: 40, min: 20, max: 150, color: '120,120,120', alpha: 0.06, seed: 92 });
    const r = rng(93);
    g.fillStyle = 'rgba(200,200,195,0.14)'; g.beginPath(); for (let i = 0; i < 9000; i++) g.rect(r() * w, r() * h, 1.5, 1.5); g.fill();
    g.fillStyle = 'rgba(20,20,22,0.35)'; g.fillRect(180, 300, 260, 180); // old patch
    const pan = (0.45 / 8.8) * h;
    for (const y of [0, h - pan]) {
      g.fillStyle = '#8b8984'; g.fillRect(0, y, w, pan);
      g.fillStyle = 'rgba(40,40,40,0.35)'; g.fillRect(0, y === 0 ? pan - 3 : y, w, 3);
      for (let x = 0; x < w; x += 190) { g.fillStyle = 'rgba(40,40,40,0.5)'; g.fillRect(x, y, 3, pan); }
    }
    for (let i = 0; i < 5; i++) { // sealed cracks
      g.strokeStyle = 'rgba(8,8,10,0.75)'; g.lineWidth = 4;
      let x = r() * w, y = pan + r() * (h - 2 * pan); g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 20; k++) { x += (r() - 0.5) * 30 + 10; y += (r() - 0.5) * 22; g.lineTo(x, y); }
      g.stroke();
    }
    // dashed yellow center line: 3 m dash per 8 m
    g.fillStyle = '#c9a33a'; g.fillRect(0, h / 2 - 7, (3 / 8) * w, 14);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 400; i++) g.fillRect(r() * (3 / 8) * w, h / 2 - 7 + r() * 14, 2, 2);
    pixNoise(g, w, h, 0.1, 94);
  }, { repeat: [1 / 8, 1] });
  // Grass (2 m tile)
  const grassMap = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#2d4520'; g.fillRect(0, 0, w, h);
    const r = rng(101), cols = ['#3b5a2a', '#28401e', '#4a6b30', '#20371a', '#557a38', '#3f5f2c', '#65803e'];
    for (let ci = 0; ci < cols.length; ci++) {
      g.strokeStyle = cols[ci]; g.lineWidth = 1.4; g.beginPath();
      for (let i = 0; i < 2300; i++) {
        const x = r() * w, y = r() * h, l = 4 + r() * 10, a = -1.57 + (r() - 0.5) * 1.2;
        g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      }
      g.stroke();
    }
    pixNoise(g, w, h, 0.06, 102);
  });

  // Sectional door panel (one 5.62 m x 0.6 m section): 8 raised short panels.
  const doorDraw = (bump) => (g, w, h) => {
    const ppm = w / 5.62, st = 0.09 * ppm, vm = 0.1 * ppm, n = 8;
    const pw = (w - (n + 1) * st) / n, ph = h - 2 * vm, bev = 0.028 * ppm;
    g.fillStyle = bump ? '#707070' : '#eae8e2'; g.fillRect(0, 0, w, h);
    const r = rng(111);
    if (!bump) for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(0,0,0,${0.02 + r() * 0.03})`; g.fillRect(r() * w, r() * h, 20 + r() * 80, 1); }
    for (let i = 0; i < n; i++) {
      const x = st + i * (pw + st), y = vm;
      if (bump) {
        g.fillStyle = '#e8e8e8'; g.fillRect(x, y, pw, ph);
        g.strokeStyle = '#a0a0a0'; g.lineWidth = bev; g.strokeRect(x + bev / 2, y + bev / 2, pw - bev, ph - bev);
      } else {
        g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(x, y, pw, bev * 0.6); g.fillRect(x, y, bev * 0.6, ph);
        g.fillStyle = 'rgba(80,80,85,0.28)'; g.fillRect(x, y + ph - bev * 0.6, pw, bev * 0.6); g.fillRect(x + pw - bev * 0.6, y, bev * 0.6, ph);
        g.fillStyle = 'rgba(120,120,125,0.14)'; g.fillRect(x + bev * 0.6, y + bev * 0.6, pw - bev * 1.2, 3);
      }
    }
    g.fillStyle = bump ? '#303030' : 'rgba(40,40,45,0.45)'; g.fillRect(0, 0, w, 4);
    g.fillStyle = bump ? '#909090' : 'rgba(255,255,255,0.4)'; g.fillRect(0, h - 3, w, 3);
    if (!bump) pixNoise(g, w, h, 0.03, 112);
  };
  const doorMap = canvasTexture(2048, 220, doorDraw(false), { wrap: false });
  const doorBump = canvasTexture(1024, 110, doorDraw(true), { wrap: false, ...lin });
  const doorInnerMap = canvasTexture(512, 64, (g, w, h) => {
    g.fillStyle = '#cfd1cf'; g.fillRect(0, 0, w, h);
    for (let y = 6; y < h; y += 9) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, y, w, 1); g.fillStyle = 'rgba(0,0,0,0.1)'; g.fillRect(0, y + 1, w, 1); }
    pixNoise(g, w, h, 0.05, 113);
  }, { wrap: false });

  // Lit room behind a window.
  const roomMap = canvasTexture(512, 512, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#f2b870'); bg.addColorStop(0.55, '#d98d45'); bg.addColorStop(1, '#6e3a18');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const lamp = g.createRadialGradient(w * 0.62, h * 0.35, 0, w * 0.62, h * 0.35, w * 0.45);
    lamp.addColorStop(0, 'rgba(255,240,205,0.95)'); lamp.addColorStop(1, 'rgba(255,220,160,0)');
    g.fillStyle = lamp; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(70,40,20,0.55)'; g.fillRect(w * 0.26, h * 0.2, w * 0.2, h * 0.16); // picture frame
    g.fillStyle = 'rgba(200,150,90,0.6)'; g.fillRect(w * 0.28, h * 0.22, w * 0.16, h * 0.12);
    g.fillStyle = '#3a200e'; g.fillRect(0, h * 0.78, w, h * 0.22); // sofa back
    g.fillStyle = '#4a2a12'; g.beginPath(); g.ellipse(w * 0.35, h * 0.78, w * 0.3, h * 0.05, 0, 0, 6.283); g.fill();
    g.fillStyle = '#2a1608'; g.fillRect(w * 0.7, h * 0.48, w * 0.02, h * 0.32); // lamp stand
    g.fillStyle = '#ffe2a8'; g.beginPath(); g.moveTo(w * 0.64, h * 0.48); g.lineTo(w * 0.78, h * 0.48); g.lineTo(w * 0.75, h * 0.38); g.lineTo(w * 0.67, h * 0.38); g.fill();
    for (const [x0, dir] of [[0, 1], [w, -1]]) { // curtains
      for (let i = 0; i < 9; i++) {
        const x = x0 + dir * i * 11;
        g.fillStyle = i % 2 ? 'rgba(245,225,190,0.9)' : 'rgba(215,185,140,0.9)';
        g.fillRect(dir > 0 ? x : x - 11, 0, 11, h);
      }
    }
    pixNoise(g, w, h, 0.04, 121);
  }, { wrap: false });
  const shutterMap = canvasTexture(128, 512, (g, w, h) => {
    g.fillStyle = '#2b3136'; g.fillRect(0, 0, w, h);
    for (let y = 14; y < h - 14; y += 12) {
      const gr = g.createLinearGradient(0, y, 0, y + 12);
      gr.addColorStop(0, '#454c52'); gr.addColorStop(0.8, '#262b30'); gr.addColorStop(1, '#15181b');
      g.fillStyle = gr; g.fillRect(12, y, w - 24, 12);
    }
    g.fillStyle = '#2f353a'; g.fillRect(12, h / 2 - 8, w - 24, 16);
    pixNoise(g, w, h, 0.05, 131);
  }, { wrap: false });
  const frontDoorMap = canvasTexture(256, 560, (g, w, h) => {
    g.fillStyle = '#6e1f1f'; g.fillRect(0, 0, w, h);
    const panels = [[0.12, 0.06, 0.32, 0.2], [0.56, 0.06, 0.32, 0.2], [0.12, 0.32, 0.32, 0.3], [0.56, 0.32, 0.32, 0.3], [0.12, 0.68, 0.32, 0.27], [0.56, 0.68, 0.32, 0.27]];
    for (const [x, y, pw, ph] of panels) {
      const X = x * w, Y = y * h, W = pw * w, H = ph * h;
      g.fillStyle = 'rgba(255,200,200,0.12)'; g.fillRect(X, Y, W, 4); g.fillRect(X, Y, 4, H);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(X, Y + H - 4, W, 4); g.fillRect(X + W - 4, Y, 4, H);
      g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(X + 10, Y + 10, W - 20, H - 20);
    }
    pixNoise(g, w, h, 0.03, 141);
  }, { wrap: false });
  const cardboardMap = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#b08652'; g.fillRect(0, 0, w, h);
    blotches(g, w, h, { count: 12, min: 10, max: 60, color: '80,50,20', alpha: 0.1, seed: 151 });
    g.fillStyle = 'rgba(210,180,130,0.75)'; g.fillRect(0, h / 2 - 16, w, 32);
    g.fillStyle = 'rgba(40,30,20,0.6)'; g.font = 'bold 22px sans-serif'; g.fillText('THIS SIDE UP', 20, 60);
    g.fillRect(200, 180, 6, 40); g.beginPath(); g.moveTo(190, 185); g.lineTo(203, 165); g.lineTo(216, 185); g.fill();
    pixNoise(g, w, h, 0.06, 152);
  }, { wrap: false });
  const springMap = canvasTexture(16, 16, (g, w, h) => {
    g.fillStyle = '#1b1c1e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#6a6d70'; g.fillRect(0, 2, w, 5);
  }, { repeat: [1, 60] });

  // ------------------------------------------------------------------ materials
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const M = {
    floor: std({ map: floorMap, roughnessMap: floorRough, roughness: 1, metalness: 0, envMapIntensity: 1.4 }),
    wall: std({ map: wallMap, roughness: 0.88 }),
    ceil: std({ map: ceilMap, roughness: 0.92 }),
    trimIn: std({ color: 0xf1efe9, roughness: 0.42 }),
    trimOut: std({ color: 0xf0eee8, roughness: 0.55 }),
    siding: std({ map: sidingMap, bumpMap: sidingBump, bumpScale: 2.2, roughness: 0.7 }),
    shingle: std({ map: shingleMap, bumpMap: shingleBump, bumpScale: 1.6, roughness: 0.93 }),
    gutter: std({ color: 0xeeeeea, roughness: 0.35, metalness: 0.15 }),
    concrete: std({ map: driveMap, roughness: 0.86 }),
    walk: std({ map: walkMap, roughness: 0.9 }),
    curb: std({ color: 0x9a978f, roughness: 0.9 }),
    asphalt: std({ map: asphaltMap, roughness: 0.93 }),
    foundation: std({ color: 0x86837c, roughness: 0.95, map: walkMap }),
    lawn: std({ map: grassMap, roughness: 0.96, vertexColors: true }),
    darkMetal: std({ color: 0x2c2e31, roughness: 0.45, metalness: 0.7 }),
    galv: std({ color: 0xa9adb0, roughness: 0.38, metalness: 0.85 }),
    black: std({ color: 0x141516, roughness: 0.5, metalness: 0.35 }),
    rubber: std({ color: 0x111111, roughness: 0.85 }),
    plastic: std({ color: 0xdcdcd8, roughness: 0.5 }),
    spring: std({ map: springMap, roughness: 0.45, metalness: 0.6 }),
    tube: std({ color: 0xffffff, emissive: 0xfff2e0, emissiveIntensity: 0, roughness: 0.3 }),
    lens: std({ color: 0xf2f0ea, emissive: 0xffe8c8, emissiveIntensity: 0, roughness: 0.4, transparent: true, opacity: 0.95 }),
    lantern: std({ color: 0x3a3226, emissive: 0xffbf73, emissiveIntensity: 3.2, roughness: 0.25 }),
    room: std({ color: 0x080808, emissive: 0xffffff, emissiveMap: roomMap, emissiveIntensity: 1.15, roughness: 0.06 }),
    shutter: std({ map: shutterMap, roughness: 0.6 }),
    frontDoor: std({ map: frontDoorMap, roughness: 0.35 }),
    brass: std({ color: 0xc9a25a, roughness: 0.28, metalness: 1 }),
    doorOuter: std({ map: doorMap, bumpMap: doorBump, bumpScale: 3, roughness: 0.42, metalness: 0.05 }),
    doorInner: std({ map: doorInnerMap, roughness: 0.4, metalness: 0.55 }),
    doorEdge: std({ color: 0xd6d6d2, roughness: 0.4, metalness: 0.4 }),
    cardboard: std({ map: cardboardMap, roughness: 0.9 }),
    shelf: std({ color: 0x3b3f44, roughness: 0.55, metalness: 0.6 }),
    board: std({ color: 0x9c8058, roughness: 0.8 }),
    bark: std({ color: 0x3b3027, roughness: 0.95 }),
    foliage: std({ vertexColors: true, roughness: 0.9 }),
    red: std({ color: 0xb0121a, roughness: 0.28, metalness: 0.1 }),
    orange: std({ color: 0xe0661a, roughness: 0.55 }),
    green: std({ color: 0x2f6b34, roughness: 0.5 }),
    wood: std({ color: 0xb58b5a, roughness: 0.7 }),
    bristle: std({ color: 0xa8873a, roughness: 0.9 }),
    signBoard: std({ color: 0x17181a, roughness: 0.35, metalness: 0.2 }),
    streetPole: std({ color: 0x3a3d40, roughness: 0.6, metalness: 0.5 }),
    streetLens: std({ color: 0x333333, emissive: 0xffe0b0, emissiveIntensity: 6, roughness: 0.3 }),
    mailbox: std({ color: 0x1b1d1f, roughness: 0.4, metalness: 0.4 }),
    far: std({ map: sidingMap, color: 0x8d8f92, roughness: 0.8 }),
    farRoof: std({ map: shingleMap, color: 0x8a8a8a, roughness: 0.95 }),
    farGarage: std({ color: 0x8f8d88, roughness: 0.6 }),
  };

  // Everything interior that setLights(v) scales.
  const dimmers = [];
  const shadowLights = [];
  let lightsV = 0;

  // ================================================================== GARAGE SHELL
  const IX0 = -3.6, IX1 = 3.6, IZ0 = -7.2, CEIL = 2.9, FRONT_IN = -0.18;
  const OPEN_W = 2.75, OPEN_H = 2.35;

  // Floor slab (runs out under the threshold to meet the driveway)
  {
    const fl = new THREE.Mesh(box(7.6, 0.2, 7.42), M.floor);
    fl.position.set(0, -0.1, -3.69);
    fl.receiveShadow = true;
    root.add(fl);
  }
  // Drywall walls (inner faces), UVs in wall-tile units (2.4 m x 2.9 m)
  {
    const depth = FRONT_IN - IZ0;
    const side = uvScale(new THREE.PlaneGeometry(depth, CEIL), depth / 2.4, 1);
    put(side, M.wall, [IX0, CEIL / 2, (IZ0 + FRONT_IN) / 2], [0, Math.PI / 2, 0]);
    put(side, M.wall, [IX1, CEIL / 2, (IZ0 + FRONT_IN) / 2], [0, -Math.PI / 2, 0]);
    put(uvScale(new THREE.PlaneGeometry(7.2, CEIL), 3, 1), M.wall, [0, CEIL / 2, IZ0]);
    const s = new THREE.Shape([V(-3.6, 0), V(-OPEN_W, 0), V(-OPEN_W, OPEN_H), V(OPEN_W, OPEN_H), V(OPEN_W, 0), V(3.6, 0), V(3.6, CEIL), V(-3.6, CEIL)].map((p) => new THREE.Vector2(p.x, p.y)));
    const fg = new THREE.ShapeGeometry(s);
    uvScale(fg, 1 / 2.4, 1 / CEIL);
    put(fg, M.wall, [0, 0, FRONT_IN], [0, Math.PI, 0]);
    put(uvScale(new THREE.PlaneGeometry(7.2, depth), 3, 3), M.ceil, [0, CEIL, (IZ0 + FRONT_IN) / 2], [Math.PI / 2, 0, 0]);
    // Walls also need backs so the outside world is sealed from the moon (and so they look right from outside)
    put(box(0.2, CEIL + 0.1, 7.4), M.trimOut, [IX0 - 0.1, CEIL / 2, -3.7], [0, 0, 0], { receive: false });
    put(box(0.2, CEIL + 0.1, 7.4), M.trimOut, [IX1 + 0.1, CEIL / 2, -3.7], [0, 0, 0], { receive: false });
    put(box(7.6, CEIL + 0.1, 0.2), M.trimOut, [0, CEIL / 2, IZ0 - 0.1], [0, 0, 0], { receive: false });
    put(box(7.6, 0.1, 7.4), M.trimOut, [0, CEIL + 0.05, -3.9], [0, 0, 0], { receive: false });
    // baseboards
    const bb = 0.095, bt = 0.014;
    put(rbox(bt, bb, depth, 0.004), M.trimIn, [IX0 + bt / 2, bb / 2, (IZ0 + FRONT_IN) / 2]);
    put(rbox(bt, bb, depth, 0.004), M.trimIn, [IX1 - bt / 2, bb / 2, (IZ0 + FRONT_IN) / 2]);
    put(rbox(7.2, bb, bt, 0.004), M.trimIn, [0, bb / 2, IZ0 + bt / 2]);
    for (const sx of [-1, 1]) put(rbox(0.85, bb, bt, 0.004), M.trimIn, [sx * 3.175, bb / 2, FRONT_IN - bt / 2]);
    // inside corner beads (slightly lighter)
    for (const [x, z] of [[IX0, IZ0], [IX1, IZ0], [IX0, FRONT_IN], [IX1, FRONT_IN]]) put(box(0.02, CEIL, 0.02), M.trimIn, [x, CEIL / 2, z], [0, Math.PI / 4, 0], { cast: false });
    // door jambs (the wall thickness inside the opening) + header
    for (const sx of [-1, 1]) put(rbox(0.04, OPEN_H, 0.22, 0.006), M.trimOut, [sx * (OPEN_W + 0.02), OPEN_H / 2, -0.08]);
    put(rbox(OPEN_W * 2 + 0.08, 0.04, 0.22, 0.006), M.trimOut, [0, OPEN_H + 0.02, -0.08]);
    // vinyl door stop / weatherstrip on the inside edge
    for (const sx of [-1, 1]) put(box(0.05, OPEN_H, 0.02), M.rubber, [sx * (OPEN_W + 0.015), OPEN_H / 2, -0.19], [0, 0, 0], { cast: false });
    put(box(OPEN_W * 2 + 0.1, 0.05, 0.02), M.rubber, [0, OPEN_H + 0.015, -0.19], [0, 0, 0], { cast: false });
    // attic access hatch
    const hx = 0.0, hz = -6.25;
    put(box(0.62, 0.008, 1.2), M.ceil, [hx, CEIL - 0.004, hz], [0, 0, 0], { cast: false });
    for (const [w, d, x, z] of [[0.72, 0.05, 0, 0.625], [0.72, 0.05, 0, -0.625], [0.05, 1.3, 0.335, 0], [0.05, 1.3, -0.335, 0]])
      put(box(w, 0.015, d), M.trimIn, [hx + x, CEIL - 0.008, hz + z], [0, 0, 0], { cast: false });
    put(cyl(0.004, 0.004, 0.25, 6), M.rubber, [hx + 0.2, CEIL - 0.13, hz + 0.58], [0, 0, 0], { cast: false });
    // outlets & switches
    const plate = rbox(0.072, 0.118, 0.008, 0.003);
    for (const z of [-1.0, -6.6]) put(plate, M.trimIn, [IX1 - 0.004, 0.42, z], [0, Math.PI / 2, 0], { cast: false });
    for (const z of [-5.8, -1.7]) put(plate, M.trimIn, [IX0 + 0.004, 0.42, z], [0, Math.PI / 2, 0], { cast: false });
    for (const x of [0.4, 2.2]) put(plate, M.trimIn, [x, 0.42, IZ0 + 0.004], [0, 0, 0], { cast: false });
    put(rbox(0.12, 0.118, 0.008, 0.003), M.trimIn, [-3.15, 1.22, FRONT_IN - 0.004], [0, 0, 0], { cast: false });
    put(rbox(0.07, 0.11, 0.03, 0.01), M.plastic, [-3.32, 1.22, FRONT_IN - 0.015], [0, 0, 0], { cast: false });
  }

  // ================================================================== SECTIONAL DOOR
  const DOOR_W = 5.62, SEC_H = 0.6, DOOR_T = 0.045, NSEC = 4;
  const Z0 = -0.245, YB = 2.42, RAD = 0.3, L1 = YB, L2 = (Math.PI / 2) * RAD;
  const UMAX = L1 + L2 + 0.05;
  const TRACK_END = -3.4, TRACK_X = DOOR_W / 2 + 0.05;
  function pathAt(s, out) {
    if (s <= L1) return out.set(0, s, Z0);
    if (s <= L1 + L2) { const a = (s - L1) / RAD; return out.set(0, YB + RAD * Math.sin(a), Z0 - RAD * (1 - Math.cos(a))); }
    return out.set(0, YB + RAD, Z0 - RAD - (s - L1 - L2));
  }
  // tracks
  function trackPiece(sx, a, b) {
    const d = b.clone().sub(a); const L = d.length(); d.normalize();
    const Z = new THREE.Vector3(0, -d.z, d.y);
    const m = new THREE.Matrix4().makeBasis(V(1, 0, 0), d, Z).setPosition(a.clone().add(b).multiplyScalar(0.5).setX(sx * TRACK_X));
    const off = (x, z) => new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(sx * x, 0, z));
    putM(box(0.004, L + 0.004, 0.052), M.galv, off(0.028, 0), { cast: HIGH });
    putM(box(0.03, L + 0.004, 0.003), M.galv, off(0.014, 0.025), { cast: false });
    putM(box(0.03, L + 0.004, 0.003), M.galv, off(0.014, -0.025), { cast: false });
  }
  {
    const pts = [];
    const p = new THREE.Vector3();
    for (let s = 0.03; s < L1; s += 0.6) pts.push(pathAt(s, p).clone());
    pts.push(pathAt(L1, p).clone());
    for (let k = 1; k <= 7; k++) pts.push(pathAt(L1 + (L2 * k) / 7, p).clone());
    pts.push(V(0, YB + RAD, TRACK_END));
    for (const sx of [-1, 1]) {
      for (let i = 0; i < pts.length - 1; i++) trackPiece(sx, pts[i], pts[i + 1]);
      // jamb angle holding the vertical track to the wall
      put(box(0.004, L1, 0.07), M.galv, [sx * (TRACK_X + 0.034), L1 / 2 + 0.03, -0.215], [0, 0, 0], { cast: false });
      for (const y of [0.3, 1.2, 2.1]) put(box(0.05, 0.09, 0.006), M.galv, [sx * (TRACK_X + 0.012), y, FRONT_IN - 0.004], [0, 0, 0], { cast: false });
      // rear hanger + angle
      put(box(0.035, CEIL - (YB + RAD) + 0.02, 0.004), M.galv, [sx * (TRACK_X + 0.03), (CEIL + YB + RAD) / 2, TRACK_END + 0.05], [0, 0, 0], { cast: false });
      put(box(0.035, 0.004, 0.6), M.galv, [sx * (TRACK_X + 0.03), CEIL - 0.01, TRACK_END + 0.3], [0, 0, 0], { cast: false });
      // cable drum and end bearing plate
      put(cyl(0.05, 0.05, 0.04, 18), M.darkMetal, [sx * (DOOR_W / 2 - 0.02), 2.64, -0.24], [0, 0, Math.PI / 2], { cast: false });
      put(box(0.006, 0.2, 0.1), M.galv, [sx * (DOOR_W / 2 + 0.1), 2.64, -0.23], [0, 0, 0], { cast: false });
    }
    // torsion tube, springs, center bracket
    put(cyl(0.013, 0.013, DOOR_W + 0.2, 10), M.galv, [0, 2.64, -0.24], [0, 0, Math.PI / 2], { cast: false });
    for (const sx of [-1, 1]) put(uvScale(cyl(0.032, 0.032, 0.8, 16), 1, 1), M.spring, [sx * 0.48, 2.64, -0.24], [0, 0, Math.PI / 2], { cast: HIGH });
    put(box(0.12, 0.18, 0.045), M.galv, [0, 2.64, -0.205]);
  }
  // door sections
  const doorGroup = new THREE.Group();
  root.add(doorGroup);
  const sections = [];
  {
    const secGeo = new THREE.BoxGeometry(DOOR_W, SEC_H - 0.004, DOOR_T);
    const secMats = [M.doorEdge, M.doorEdge, M.doorEdge, M.doorEdge, M.doorOuter, M.doorInner];
    for (let i = 0; i < NSEC; i++) {
      const s = new THREE.Group();
      const m = new THREE.Mesh(secGeo, secMats);
      m.castShadow = true; m.receiveShadow = true;
      s.add(m);
      const hw = [];
      const add = (g, x, y, z, r = [0, 0, 0]) => { const gg = prep(g); _e.set(...r); _q.setFromEuler(_e); _m.compose(V(x, y, z), _q, V(1, 1, 1)); gg.applyMatrix4(_m); hw.push(gg); };
      const zi = -DOOR_T / 2;
      if (i < NSEC - 1) for (const x of [-2.1, -0.7, 0.7, 2.1]) add(box(0.09, 0.13, 0.01), x, SEC_H / 2, zi - 0.005);
      for (const sx of [-1, 1]) {
        const ys = i === NSEC - 1 ? [-SEC_H / 2 + 0.03, SEC_H / 2 - 0.04] : [-SEC_H / 2 + 0.03];
        for (const y of ys) {
          add(box(0.07, 0.15, 0.012), sx * (DOOR_W / 2 - 0.06), y + 0.04, zi - 0.006);
          add(cyl(0.006, 0.006, 0.1, 8), sx * (DOOR_W / 2 + 0.02), y, 0, [0, 0, Math.PI / 2]);
          add(cyl(0.024, 0.024, 0.014, 14), sx * TRACK_X, y, 0, [0, 0, Math.PI / 2]);
        }
      }
      if (i === 0 || i === NSEC - 1) add(box(DOOR_W - 0.4, 0.075, 0.035), 0, 0, zi - 0.018);
      if (i === NSEC - 1) add(box(0.08, 0.16, 0.03), 0, 0.12, zi - 0.015);
      if (i === 0) add(box(DOOR_W, 0.018, 0.05), 0, -SEC_H / 2 - 0.005, 0);
      const hm = new THREE.Mesh(mergeGeometries(hw), M.galv);
      hm.castShadow = HIGH;
      s.add(hm);
      doorGroup.add(s);
      sections.push(s);
    }
  }
  // opener: rail, motor unit, carriage and arm
  const RAIL_Y = 2.8;
  const carriage = new THREE.Mesh(rbox(0.07, 0.05, 0.14, 0.01), M.darkMetal);
  const arm = new THREE.Mesh(box(0.03, 1, 0.012), M.galv);
  carriage.castShadow = arm.castShadow = HIGH;
  root.add(carriage, arm);
  {
    put(box(0.035, 0.035, 3.45), M.galv, [0, RAIL_Y + 0.035, -1.92]);
    put(box(0.07, 0.1, 0.05), M.galv, [0, RAIL_Y + 0.02, -0.2]);
    put(rbox(0.38, 0.19, 0.46, 0.03), M.plastic, [0, 2.67, -3.85]);
    put(rbox(0.3, 0.03, 0.4, 0.01), M.darkMetal, [0, 2.78, -3.85]);
    for (const sx of [-1, 1]) put(box(0.03, 0.14, 0.004), M.galv, [sx * 0.2, 2.83, -3.85], [0, 0, 0], { cast: false });
    const lens = new THREE.Mesh(box(0.26, 0.012, 0.14), M.lens);
    lens.position.set(0, 2.57, -3.95);
    root.add(lens);
    dimmers.push((v) => { M.lens.emissiveIntensity = 2.2 * v; });
  }
  const _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
  let doorU = 0;
  function setDoor(u) {
    doorU = u;
    let top = null;
    for (let i = 0; i < NSEC; i++) {
      pathAt(i * SEC_H + u, _pa); pathAt((i + 1) * SEC_H + u, _pb);
      const s = sections[i];
      s.position.set(0, (_pa.y + _pb.y) / 2, (_pa.z + _pb.z) / 2);
      s.rotation.x = Math.atan2(_pb.z - _pa.z, _pb.y - _pa.y);
      if (i === NSEC - 1) top = s;
    }
    // bracket on the top section (local 0, 0.12, -0.055)
    const th = top.rotation.x, ly = 0.12, lz = -0.055;
    const by = top.position.y + ly * Math.cos(th) - lz * Math.sin(th);
    const bz = top.position.z + ly * Math.sin(th) + lz * Math.cos(th);
    const L = 0.58, dy = Math.min(RAIL_Y - by, L - 0.01);
    const cz = bz - Math.sqrt(L * L - dy * dy);
    carriage.position.set(0, RAIL_Y, cz);
    const a = V(0, RAIL_Y, cz), b = V(0, by, bz);
    const al = along(a, b);
    arm.position.setFromMatrixPosition(al.m);
    arm.quaternion.setFromRotationMatrix(al.m);
    arm.scale.set(1, al.L, 1);
  }
  setDoor(0);

  // ================================================================== CEILING LIGHTS
  const FIX = [[-1.6, -4.35], [1.6, -4.35], [-1.6, -6.3], [1.6, -6.3]];
  const FIX_Y = 2.72;
  {
    for (const [x, z] of FIX) {
      put(rbox(0.17, 0.045, 1.24, 0.012), M.trimIn, [x, FIX_Y + 0.02, z]);
      put(box(0.012, 0.03, 1.2), M.galv, [x - 0.07, FIX_Y - 0.005, z], [0, 0, 0], { cast: false });
      put(box(0.012, 0.03, 1.2), M.galv, [x + 0.07, FIX_Y - 0.005, z], [0, 0, 0], { cast: false });
      for (const dz of [-0.5, 0.5]) put(cyl(0.003, 0.003, CEIL - FIX_Y - 0.04, 6), M.galv, [x, (CEIL + FIX_Y + 0.04) / 2, z + dz], [0, 0, 0], { cast: false });
      for (const dx of [-0.035, 0.035]) {
        put(cyl(0.0135, 0.0135, 1.18, 12), M.tube, [x + dx, FIX_Y - 0.012, z], [Math.PI / 2, 0, 0], { cast: false });
        for (const dz of [-0.595, 0.595]) put(cyl(0.016, 0.016, 0.02, 10), M.plastic, [x + dx, FIX_Y - 0.012, z + dz], [Math.PI / 2, 0, 0], { cast: false });
      }
    }
    dimmers.push((v) => { M.tube.emissiveIntensity = 9 * v; });
  }
  // Real lights inside the garage
  const interiorLights = [];
  function dimLight(l, base) { l.intensity = 0; interiorLights.push([l, base]); return l; }
  {
    // the ONE interior shadow caster
    const spot = new THREE.SpotLight(0xfff0dc, 0, 0, 1.25, 0.9, 2);
    spot.position.set(0.1, 2.83, -5.3);
    spot.target.position.set(0.3, 0, -3.0);
    spot.castShadow = !DBG.includes('sh');
    spot.shadow.mapSize.set(SHADOW, SHADOW);
    spot.shadow.camera.near = 0.2; spot.shadow.camera.far = 12;
    spot.shadow.bias = -0.0002; spot.shadow.normalBias = 0.02; spot.shadow.radius = 4;
    root.add(spot, spot.target);
    dimLight(spot, 38);
    shadowLights.push(spot);
    for (const x of [-1.6, 1.6]) {
      const ra = new THREE.RectAreaLight(0xfff1e2, 0, 0.3, 3.2);
      ra.position.set(x, FIX_Y - 0.03, -5.33);
      ra.rotation.x = -Math.PI / 2;
      if (!DBG.includes('ra')) root.add(ra);
      dimLight(ra, 15);
    }
    // spill out of the door onto the driveway
    const portal = new THREE.RectAreaLight(0xffdcb4, 0, 5.3, 2.3);
    portal.position.set(0, 1.18, -0.35);
    portal.lookAt(0, 1.18, 5);
    if (!DBG.includes('ra')) root.add(portal);
    dimLight(portal, 2.6);
  }

  // ================================================================== NEON SIGN (back wall)
  {
    const SX = 1.4, SY = 2.35, SZ = IZ0;
    put(rbox(2.25, 0.6, 0.03, 0.012), M.signBoard, [SX, SY, SZ + 0.02]);
    for (const dx of [-1.02, 1.02]) for (const dy of [-0.24, 0.24]) put(cyl(0.012, 0.012, 0.03, 10), M.galv, [SX + dx, SY + dy, SZ + 0.045], [Math.PI / 2, 0, 0], { cast: false });
    const W = 1024, H = 280;
    const neon = canvasTexture(W, H, (g) => {
      g.clearRect(0, 0, W, H);
      g.font = '600 170px "Avenir Next", "Helvetica Neue", Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const tw = g.measureText('PRISTINE').width;
      const sc = Math.min(1, (W - 90) / tw);
      g.save(); g.translate(W / 2, H * 0.44); g.scale(sc, 1);
      g.lineJoin = 'round';
      g.shadowColor = 'rgba(255,150,50,1)';
      for (const [lw, blur, c] of [[20, 40, 'rgba(255,140,40,0.35)'], [12, 20, 'rgba(255,170,70,0.8)'], [6, 6, '#ffd9a0'], [2.5, 0, '#fffaf0']]) {
        g.shadowBlur = blur; g.lineWidth = lw; g.strokeStyle = c; g.strokeText('PRISTINE', 0, 0);
      }
      g.restore();
      g.shadowColor = 'rgba(255,150,50,1)';
      for (const [lw, blur, c] of [[10, 24, 'rgba(255,150,50,0.6)'], [3, 0, '#fff4e0']]) {
        g.shadowBlur = blur; g.lineWidth = lw; g.strokeStyle = c;
        g.beginPath(); g.moveTo(W * 0.12, H * 0.84); g.lineTo(W * 0.88, H * 0.84); g.stroke();
      }
    }, { wrap: false });
    const mat = new THREE.MeshBasicMaterial({ map: neon, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0x000000, toneMapped: true });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.1 * (H / W)), mat);
    plane.position.set(SX, SY + 0.01, SZ + 0.04);
    root.add(plane);
    const glow = new THREE.PointLight(0xffa850, 0, 2.6, 2);
    glow.position.set(SX, SY, SZ + 0.35);
    if (!DBG.includes('pt')) root.add(glow);
    dimLight(glow, 1.4);
    dimmers.push((v) => mat.color.setScalar(2.2 * v));
  }

  // ================================================================== SHELVING (right wall) + CLUTTER
  {
    const x0 = 3.06, x1 = 3.56, z0 = -5.32, z1 = -6.08, top = 1.38;
    for (const x of [x0, x1]) for (const z of [z0, z1]) put(rbox(0.035, top, 0.035, 0.004), M.shelf, [x, top / 2, z]);
    const levels = [0.1, 0.52, 0.94, 1.36];
    for (const y of levels) put(rbox(0.54, 0.022, 0.8, 0.005), M.shelf, [(x0 + x1) / 2, y, (z0 + z1) / 2]);
    // totes (instanced): body + lid
    const totes = [[0.1, -5.51], [0.1, -5.9], [0.52, -5.9], [0.94, -5.51]];
    const bodyGeo = rbox(0.46, 0.27, 0.36, 0.03);
    const lidGeo = rbox(0.48, 0.035, 0.38, 0.012);
    const bodies = new THREE.InstancedMesh(bodyGeo, std({ roughness: 0.55 }), totes.length);
    const lids = new THREE.InstancedMesh(lidGeo, std({ roughness: 0.5 }), totes.length);
    const bodyCols = [0x1d1e20, 0x1d1e20, 0x9aa4ad, 0x1d1e20], lidCols = [0xe0b21c, 0xe0b21c, 0x3c6fb0, 0xe0b21c];
    totes.forEach(([y, z], i) => {
      _m.makeTranslation(3.31, y + 0.011 + 0.135, z); bodies.setMatrixAt(i, _m); bodies.setColorAt(i, col(bodyCols[i]));
      _m.makeTranslation(3.31, y + 0.011 + 0.285, z); lids.setMatrixAt(i, _m); lids.setColorAt(i, col(lidCols[i]));
    });
    for (const im of [bodies, lids]) { im.castShadow = HIGH; im.receiveShadow = true; root.add(im); }
    // cardboard boxes
    const cb = [[0.52, -5.52, 0.44, 0.3, 0.34, 0.1], [0.94, -5.92, 0.4, 0.26, 0.3, -0.12], [0.94 + 0.26, -5.92, 0.3, 0.14, 0.26, 0.2]];
    const cardGeo = rbox(1, 1, 1, 0.012);
    const cards = new THREE.InstancedMesh(cardGeo, M.cardboard, cb.length + 2);
    const all = [...cb, [0, -6.62, 0.5, 0.36, 0.42, 0.25], [0.36, -6.6, 0.4, 0.28, 0.34, -0.2]];
    all.forEach(([y, z, w, h, d, ry], i) => {
      const x = i < 3 ? 3.3 : 3.28;
      _m.compose(V(x, y + 0.011 + h / 2, z), _q.setFromEuler(_e.set(0, ry, 0)), V(w, h, d));
      cards.setMatrixAt(i, _m);
    });
    cards.castShadow = true; cards.receiveShadow = true; root.add(cards);
    // paint cans on the top shelf
    for (const [dz, c] of [[-0.06, M.plastic], [0.11, M.galv]]) put(cyl(0.085, 0.085, 0.19, 18), c, [3.2, 0.94 + 0.011 + 0.095, -5.52 + dz]);

    // broom leaning in the back-left corner
    const base = V(-3.28, 0.02, -6.85), topP = V(-3.33, 1.42, -7.17);
    const al = along(base.clone().add(V(0, 0.12, 0)), topP);
    putM(cyl(0.012, 0.012, al.L, 8), M.wood, al.m);
    put(rbox(0.32, 0.05, 0.06, 0.01), M.black, [base.x, 0.13, base.z], [0.25, 0.1, 0]);
    put(rbox(0.3, 0.1, 0.045, 0.005), M.bristle, [base.x, 0.06, base.z + 0.01], [0.25, 0.1, 0]);
    // extension cord reel on the floor behind the car
    {
      const rx = 0.0, rz = -6.9, ry = 0.18;
      for (const dx of [-0.08, 0.08]) put(cyl(0.17, 0.17, 0.012, 24), M.black, [rx + dx, ry, rz], [0, 0, Math.PI / 2]);
      put(cyl(0.13, 0.13, 0.15, 24), M.orange, [rx, ry, rz], [0, 0, Math.PI / 2]);
      put(cyl(0.012, 0.012, 0.2, 8), M.black, [rx, ry + 0.24, rz], [0, 0, Math.PI / 2]);
      for (const dx of [-0.09, 0.09]) put(box(0.015, 0.26, 0.02), M.black, [rx + dx, ry + 0.12, rz]);
    }
    // fire extinguisher on the back wall
    {
      const ex = 2.95, ez = IZ0 + 0.09;
      put(cyl(0.075, 0.075, 0.4, 20), M.red, [ex, 0.74, ez]);
      put(new THREE.SphereGeometry(0.075, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.red, [ex, 0.94, ez]);
      put(cyl(0.02, 0.025, 0.06, 10), M.black, [ex, 1.03, ez]);
      put(box(0.14, 0.015, 0.03), M.black, [ex + 0.03, 1.07, ez], [0, 0, -0.2]);
      put(cyl(0.018, 0.018, 0.012, 12), M.plastic, [ex - 0.025, 1.02, ez + 0.025], [Math.PI / 2, 0, 0]);
      const hose = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(ex + 0.03, 1.03, ez), V(ex + 0.1, 0.95, ez + 0.02), V(ex + 0.09, 0.7, ez + 0.06), V(ex + 0.06, 0.6, ez + 0.06)]), 12, 0.009, 6);
      put(hose, M.black, [0, 0, 0]);
      put(box(0.16, 0.05, 0.02), M.black, [ex, 0.84, IZ0 + 0.012]);
      put(box(0.03, 0.03, 0.09), M.black, [ex, 0.84, ez - 0.045]);
      put(rbox(0.09, 0.12, 0.004, 0.002), M.trimIn, [ex - 0.25, 1.25, IZ0 + 0.003], [0, 0, 0], { cast: false });
    }
    // coiled garden hose on the left wall above the mower
    {
      const hx = IX0 + 0.07, hy = 1.42, hz = -0.95;
      put(box(0.12, 0.03, 0.06), M.darkMetal, [IX0 + 0.06, hy + 0.2, hz]);
      for (let k = 0; k < 5; k++) put(new THREE.TorusGeometry(0.2 - k * 0.004, 0.015, 8, HIGH ? 40 : 20), M.green, [hx + (k - 2) * 0.022, hy, hz + (k % 2) * 0.01], [0, Math.PI / 2, 0], { cast: k === 2 });
      put(cyl(0.02, 0.02, 0.08, 10), M.brass, [hx + 0.04, hy - 0.3, hz + 0.1], [0.3, 0, 0], { cast: false });
    }
  }

  // ================================================================== HOUSE EXTERIOR
  // Roof geometry constants
  const EAVE_Z = 0.5, EAVE_TOP = 3.4, SLOPE = 0.45, RIDGE_Z = -4.5, BACK_Z = -9.5;
  const RIDGE_Y = EAVE_TOP + (EAVE_Z - RIDGE_Z) * SLOPE; // 5.65
  const HX0 = -9, HX1 = 13, RX0 = -9.35, RX1 = 13.35;
  const XG = 4.4, CG_SLOPE = (RIDGE_Y - 3.45) / XG, CG_FRONT = 0.62;
  const WALL_TOP = 3.2;
  const openings = {
    w1: [4.95, 6.55, 0.95, 2.35], w2: [10.05, 11.65, 0.95, 2.35], w3: [-7.1, -5.5, 0.95, 2.35],
    door: [7.7, 8.7, 0.22, 2.62],
  };
  {
    // front facade (siding), UVs in meters
    const pts = [[HX0, 0.15], [-OPEN_W, 0.15], [-OPEN_W, OPEN_H], [OPEN_W, OPEN_H], [OPEN_W, 0.15], [HX1, 0.15], [HX1, WALL_TOP], [3.76, WALL_TOP], [3.76, 3.6], [0, 5.46], [-3.76, 3.6], [-3.76, WALL_TOP], [HX0, WALL_TOP]];
    const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const [x0, x1, y0, y1] of Object.values(openings)) s.holes.push(new THREE.Path([new THREE.Vector2(x0, y0), new THREE.Vector2(x1, y0), new THREE.Vector2(x1, y1), new THREE.Vector2(x0, y1)]));
    put(new THREE.ShapeGeometry(s), M.siding, [0, 0, 0.02]);
    // end walls with gables
    const gable = (sgn) => {
      const p = [[0, 0.15], [9, 0.15], [9, WALL_TOP], [4.5, WALL_TOP + 4.5 * SLOPE + 0.05], [0, WALL_TOP]];
      const g = new THREE.ShapeGeometry(new THREE.Shape(p.map(([x, y]) => new THREE.Vector2(x, y))));
      return g;
    };
    put(gable(), M.siding, [HX1, 0, 0], [0, Math.PI / 2, 0]);
    put(gable(), M.siding, [HX0, 0, -9], [0, -Math.PI / 2, 0]);
    put(box(22, WALL_TOP, 0.1), M.trimOut, [2, WALL_TOP / 2, -9], [0, 0, 0], { receive: false });
    // foundation
    for (const [x0, x1] of [[HX0 - 0.03, -OPEN_W - 0.12], [OPEN_W + 0.12, HX1 + 0.03]]) put(uvScale(box(x1 - x0, 0.22, 0.06), (x1 - x0) / 1.5, 0.15), M.foundation, [(x0 + x1) / 2, 0.06, 0.0]);
    for (const x of [HX0, HX1]) put(uvScale(box(0.06, 0.22, 9.06), 6, 0.15), M.foundation, [x, 0.06, -4.5]);
    // corner boards, frieze, soffit, fascia
    for (const x of [HX0 + 0.05, HX1 - 0.05]) put(rbox(0.13, WALL_TOP - 0.15, 0.03, 0.005), M.trimOut, [x, (WALL_TOP + 0.15) / 2, 0.035]);
    for (const x of [HX0, HX1]) put(rbox(0.03, WALL_TOP - 0.15, 0.13, 0.005), M.trimOut, [x + (x < 0 ? -0.015 : 0.015), (WALL_TOP + 0.15) / 2, -0.05]);
    put(box(HX1 - HX0 + 0.06, 0.16, 0.025), M.trimOut, [(HX0 + HX1) / 2, WALL_TOP - 0.06, 0.035]);
    put(box(RX1 - RX0, 0.016, EAVE_Z + 0.02), M.trimOut, [(RX0 + RX1) / 2, 3.18, EAVE_Z / 2]);
    put(box(RX1 - RX0, 0.25, 0.03), M.trimOut, [(RX0 + RX1) / 2, EAVE_TOP - 0.115, EAVE_Z + 0.015]);
    // main side-gable roof
    const ex = V(1, 0, 0), mid = (RX0 + RX1) / 2, len = RX1 - RX0;
    slab(M.shingle, V(mid, EAVE_TOP, EAVE_Z), V(mid, RIDGE_Y, RIDGE_Z), ex, len, 0.15);
    slab(M.shingle, V(mid, EAVE_TOP, BACK_Z), V(mid, RIDGE_Y, RIDGE_Z), ex, len, 0.15);
    put(box(len, 0.04, 0.34), M.shingle, [mid, RIDGE_Y + 0.01, RIDGE_Z], [0, 0, 0], { cast: false });
    // rake boards on both house ends
    for (const x of [RX0 - 0.015, RX1 + 0.015]) {
      for (const zE of [EAVE_Z, BACK_Z]) {
        const a = V(x, EAVE_TOP - 0.1, zE), b = V(x, RIDGE_Y - 0.1, RIDGE_Z);
        const d = b.clone().sub(a); const L = d.length();
        const m = new THREE.Matrix4().makeBasis(V(1, 0, 0), d.clone().normalize(), V(1, 0, 0).cross(d.clone().normalize())).setPosition(a.clone().add(b).multiplyScalar(0.5));
        putM(box(0.03, L + 0.05, 0.24), M.trimOut, m);
      }
    }
    // cross gable over the garage
    const ez = V(0, 0, 1), cz = (CG_FRONT + RIDGE_Z) / 2, clen = CG_FRONT - RIDGE_Z;
    slab(M.shingle, V(0, RIDGE_Y, cz), V(XG, 3.45, cz), ez, clen, 0.15);
    slab(M.shingle, V(0, RIDGE_Y, cz), V(-XG, 3.45, cz), ez, clen, 0.15);
    put(box(0.3, 0.04, clen), M.shingle, [0, RIDGE_Y + 0.01, cz], [0, 0, 0], { cast: false });
    for (const sx of [-1, 1]) {
      const a = V(0, RIDGE_Y - 0.09, CG_FRONT + 0.015), b = V(sx * (XG + 0.02), 3.45 - 0.09, CG_FRONT + 0.015);
      const d = b.clone().sub(a); const L = d.length(); d.normalize();
      const m = new THREE.Matrix4().makeBasis(d, V(0, 0, 1).cross(d), V(0, 0, 1)).setPosition(a.clone().add(b).multiplyScalar(0.5));
      putM(box(L + 0.05, 0.24, 0.03), M.trimOut, m);
      // soffit under the rake overhang
      const m2 = new THREE.Matrix4().makeBasis(d, V(0, 0, 1).cross(d), V(0, 0, 1)).setPosition(a.clone().add(b).multiplyScalar(0.5).add(V(0, -0.1, -CG_FRONT / 2)));
      putM(box(L, 0.012, CG_FRONT), M.trimOut, m2, { cast: false });
    }
    // gable louvered vent
    put(rbox(0.7, 0.5, 0.04, 0.01), M.trimOut, [0, 4.45, 0.04]);
    for (let k = 0; k < 7; k++) put(box(0.56, 0.012, 0.05), M.trimOut, [0, 4.27 + k * 0.058, 0.05], [0.6, 0, 0], { cast: false });
    put(box(0.58, 0.38, 0.01), M.black, [0, 4.45, 0.045], [0, 0, 0], { cast: false });
    // brick-mold trim around the garage opening
    const tw = 0.12;
    for (const sx of [-1, 1]) put(rbox(tw, OPEN_H + tw, 0.035, 0.006), M.trimOut, [sx * (OPEN_W + tw / 2), (OPEN_H + tw) / 2, 0.035]);
    put(rbox(OPEN_W * 2 + 2 * tw + 0.04, tw, 0.04, 0.006), M.trimOut, [0, OPEN_H + tw / 2, 0.037]);
    put(box(OPEN_W * 2 + 2 * tw + 0.1, 0.03, 0.06), M.trimOut, [0, OPEN_H + tw + 0.012, 0.045]);

    // K-style gutter along the whole front eave + downspouts
    const k = new THREE.Shape([[0, 0], [0, -0.115], [0.1, -0.115], [0.118, -0.088], [0.108, -0.062], [0.128, -0.035], [0.132, 0.005], [0.122, 0.005]].map(([x, y]) => new THREE.Vector2(x, y)));
    const gutGeo = new THREE.ExtrudeGeometry(k, { depth: RX1 - RX0 + 0.04, bevelEnabled: false });
    putM(gutGeo, M.gutter, new THREE.Matrix4().makeBasis(V(0, 0, 1), V(0, 1, 0), V(-1, 0, 0)).setPosition(RX1 + 0.02, EAVE_TOP - 0.03, EAVE_Z + 0.03));
    for (const x of [RX0 + 0.25, 3.98, RX1 - 0.25]) {
      const pts = [V(x, 3.26, EAVE_Z + 0.09), V(x, 3.1, EAVE_Z + 0.09), V(x, 2.86, 0.08), V(x, 0.34, 0.08), V(x, 0.14, 0.34)];
      for (let i = 0; i < pts.length - 1; i++) {
        const al = along(pts[i], pts[i + 1]);
        putM(rbox(0.075, al.L + 0.03, 0.058, 0.008), M.gutter, al.m);
      }
      for (const y of [1.0, 2.2]) put(box(0.09, 0.025, 0.07), M.gutter, [x, y, 0.07], [0, 0, 0], { cast: false });
      put(uvScale(box(0.3, 0.05, 0.62), 0.3, 0.6), M.walk, [x, 0.0, 0.62]);
    }

    // windows (casing, sill, glass with a lit room, muntins, shutters)
    for (const key of ['w1', 'w2', 'w3']) {
      const [x0, x1, y0, y1] = openings[key];
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0, h = y1 - y0;
      const room = new THREE.Mesh(new THREE.PlaneGeometry(w, h), M.room);
      room.position.set(cx, cy, -0.06);
      root.add(room);
      for (const [px, py, pw, ph] of [[x0 - 0.05, cy, 0.1, h + 0.2], [x1 + 0.05, cy, 0.1, h + 0.2], [cx, y1 + 0.06, w + 0.24, 0.12]]) put(rbox(pw, ph, 0.04, 0.006), M.trimOut, [px, py, 0.04]);
      put(rbox(w + 0.3, 0.05, 0.1, 0.01), M.trimOut, [cx, y0 - 0.02, 0.05]);
      // jamb returns (wall thickness) and sash frame
      for (const sx of [-1, 1]) put(box(0.02, h, 0.1), M.trimOut, [sx < 0 ? x0 + 0.01 : x1 - 0.01, cy, -0.03], [0, 0, 0], { cast: false });
      put(box(w, 0.02, 0.1), M.trimOut, [cx, y1 - 0.01, -0.03], [0, 0, 0], { cast: false });
      put(box(w, 0.05, 0.03), M.trimOut, [cx, cy, -0.035], [0, 0, 0], { cast: false }); // meeting rail
      for (let i = 1; i < 3; i++) put(box(0.016, h, 0.012), M.trimOut, [x0 + (w * i) / 3, cy, -0.045], [0, 0, 0], { cast: false });
      for (const fy of [0.25, 0.75]) put(box(w, 0.016, 0.012), M.trimOut, [cx, y0 + h * fy, -0.045], [0, 0, 0], { cast: false });
      for (const sx of [-1, 1]) put(box(0.5, 1.46, 0.03), M.shutter, [sx < 0 ? x0 - 0.37 : x1 + 0.37, cy, 0.04], [0, 0, 0], { cast: HIGH });
    }
    // front door, transom, porch
    {
      const [x0, x1, y0, y1] = openings.door;
      const cx = (x0 + x1) / 2;
      const d = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 2.08), M.frontDoor);
      d.position.set(cx, y0 + 1.04, -0.05); d.receiveShadow = true; root.add(d);
      const tr = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0 - 2.14), M.room);
      tr.position.set(cx, y0 + 2.12 + (y1 - y0 - 2.14) / 2, -0.06); root.add(tr);
      put(box(x1 - x0, 0.05, 0.1), M.trimOut, [cx, y0 + 2.11, -0.04]);
      for (let i = 1; i < 4; i++) put(box(0.015, 0.3, 0.02), M.trimOut, [x0 + (i * (x1 - x0)) / 4, y1 - 0.15, -0.05], [0, 0, 0], { cast: false });
      for (const [px, py, pw, ph] of [[x0 - 0.06, (y0 + y1) / 2, 0.12, y1 - y0 + 0.12], [x1 + 0.06, (y0 + y1) / 2, 0.12, y1 - y0 + 0.12], [cx, y1 + 0.08, x1 - x0 + 0.32, 0.16]]) put(rbox(pw, ph, 0.045, 0.006), M.trimOut, [px, py, 0.042]);
      for (const sx of [-1, 1]) put(box(0.02, y1 - y0, 0.12), M.trimOut, [sx < 0 ? x0 + 0.01 : x1 - 0.01, (y0 + y1) / 2, -0.02], [0, 0, 0], { cast: false });
      put(new THREE.SphereGeometry(0.03, 12, 8), M.brass, [x1 - 0.1, y0 + 1.0, -0.02]);
      put(rbox(0.05, 0.22, 0.02, 0.005), M.brass, [x1 - 0.1, y0 + 1.05, -0.04], [0, 0, 0], { cast: false });
      put(rbox(0.3, 0.08, 0.012, 0.004), M.brass, [cx, y0 + 1.55, -0.04], [0, 0, 0], { cast: false });
      // stoop and walkway
      put(uvScale(box(2.2, 0.2, 1.3), 1.5, 0.9), M.walk, [cx, 0.1, 0.66]);
      put(uvScale(box(1.2, 0.04, 2.1), 0.8, 1.4), M.walk, [cx, 0.0, 2.35]);
      put(uvScale(box(5.0, 0.04, 1.2), 3.3, 0.8), M.walk, [(3.2 + 8.7) / 2 - 0.5, 0.0, 2.8]);
      // porch roof: a small gable on knee braces
      const pz0 = 0.02, pz1 = 1.2, pcx = cx, hw = 1.1, pe = 2.82, pr = 3.2;
      const pzc = (pz0 + pz1) / 2;
      slab(M.shingle, V(pcx, pr, pzc), V(pcx + hw, pe, pzc), V(0, 0, 1), pz1 - pz0, 0.1);
      slab(M.shingle, V(pcx, pr, pzc), V(pcx - hw, pe, pzc), V(0, 0, 1), pz1 - pz0, 0.1);
      const tri = new THREE.Shape([[-hw + 0.08, pe - 0.1], [hw - 0.08, pe - 0.1], [0, pr - 0.12]].map(([x, y]) => new THREE.Vector2(x, y)));
      put(new THREE.ShapeGeometry(tri), M.trimOut, [pcx, 0, pz1 - 0.02]);
      put(box(2 * hw - 0.1, 0.16, 0.06), M.trimOut, [pcx, pe - 0.16, pz1 - 0.04]);
      put(box(2 * hw - 0.1, 0.012, pz1 - pz0), M.trimOut, [pcx, pe - 0.23, pzc], [0, 0, 0], { cast: false });
      for (const sx of [-1, 1]) {
        put(box(0.08, 0.5, 0.08), M.trimOut, [pcx + sx * (hw - 0.12), pe - 0.45, 0.06]);
        const al = along(V(pcx + sx * (hw - 0.12), pe - 0.62, 0.08), V(pcx + sx * (hw - 0.12), pe - 0.22, pz1 - 0.1));
        putM(box(0.07, al.L, 0.07), M.trimOut, al.m);
      }
    }
  }

  // Lanterns: coach lights by the garage door, porch light by the front door.
  const exteriorLamps = [];
  function lantern(x, y, z, big = 1) {
    const s = big;
    put(rbox(0.13 * s, 0.34 * s, 0.025, 0.008), M.black, [x, y, z + 0.0125]);
    put(box(0.03, 0.03, 0.12 * s), M.black, [x, y - 0.05 * s, z + 0.08 * s]);
    const lz = z + 0.17 * s;
    put(rbox(0.19 * s, 0.03 * s, 0.19 * s, 0.006), M.black, [x, y - 0.155 * s, lz]);
    put(new THREE.ConeGeometry(0.15 * s, 0.1 * s, 4), M.black, [x, y + 0.2 * s, lz], [0, Math.PI / 4, 0]);
    put(cyl(0.012, 0.012, 0.05, 8), M.black, [x, y + 0.26 * s, lz]);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) put(box(0.014, 0.3 * s, 0.014), M.black, [x + dx * 0.075 * s, y + 0.0, lz + dz * 0.075 * s], [0, 0, 0], { cast: false });
    const glass = new THREE.Mesh(box(0.145 * s, 0.29 * s, 0.145 * s), M.lantern);
    glass.position.set(x, y, lz);
    root.add(glass);
    const pl = new THREE.PointLight(0xffb467, 2.4, 7, 2);
    pl.position.set(x, y - 0.02, lz + 0.05);
    if (!DBG.includes('pt')) root.add(pl);
    exteriorLamps.push(pl);
  }
  lantern(-3.27, 1.95, 0.02);
  lantern(3.27, 1.95, 0.02);
  lantern(9.08, 1.8, 0.02, 0.85);

  // ================================================================== GROUND
  {
    // driveway, apron and walkway slabs
    const dw = new THREE.Mesh(box(6.4, 0.15, 12), M.concrete);
    dw.position.set(0, -0.075, 6.02); dw.receiveShadow = true; root.add(dw);
    put(uvScale(box(120, 0.15, 1.5), 80, 1), M.walk, [0, -0.072, 12.77], [0, 0, 0], { cast: false });
    put(uvScale(box(120, 0.15, 1.5), 80, 1), M.walk, [0, -0.072, 23.4], [0, 0, 0], { cast: false });
    for (const z of [13.6, 22.57]) put(box(120, 0.18, 0.18), M.curb, [0, -0.09, z], [0, 0, 0], { cast: false });
    const st = new THREE.Mesh(uvScale(box(240, 0.1, 8.8), 30, 1), M.asphalt);
    st.position.set(0, -0.17, 18.09); st.receiveShadow = true; root.add(st);
    // lawns with large-scale color variation (vertex colors)
    const lawn = (w, d, cx, cz) => {
      const seg = HIGH ? 60 : 30;
      const g = new THREE.PlaneGeometry(w, d, seg, Math.round((seg * d) / w));
      g.rotateX(-Math.PI / 2);
      g.translate(cx, -0.025, cz);
      uvScale(g, w / 2, d / 2);
      const p = g.attributes.position, c = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        const n = 0.5 + 0.22 * Math.sin(x * 0.31 + z * 0.17) * Math.cos(z * 0.23 - x * 0.11) + 0.12 * Math.sin(x * 1.3 + 2.1) * Math.sin(z * 1.1) + 0.08 * Math.sin(x * 3.1 + z * 2.7);
        const dry = Math.max(0, Math.sin(x * 0.07 + 1.3) * Math.sin(z * 0.09 + 0.2)) * 0.35;
        c[i * 3] = 0.75 + n * 0.35 + dry * 0.5; c[i * 3 + 1] = 0.78 + n * 0.3 + dry * 0.25; c[i * 3 + 2] = 0.72 + n * 0.25;
      }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      const m = new THREE.Mesh(g, M.lawn);
      m.receiveShadow = true;
      root.add(m);
    };
    lawn(240, 80, 0, 12.02 - 40);
    lawn(240, 90, 0, 24.15 + 45);
  }

  // ================================================================== VEGETATION (merged, vertex-colored)
  const foliage = [];
  function blob(cx, cy, cz, r, sy, seed, tint = [0.16, 0.3, 0.12], detail = HIGH ? 3 : 2, flat = 0.55) {
    let g = new THREE.IcosahedronGeometry(1, detail);
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    g = mergeVertices(g);
    const p = g.attributes.position, c = new Float32Array(p.count * 3), rr = rng(seed);
    const ph = rr() * 10;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = Math.sin(x * 2.7 + ph) * Math.sin(y * 3.1 + ph * 1.7) * Math.sin(z * 2.9 + ph * 0.6);
      const n2 = Math.sin(x * 7.3 + y * 5.1 + ph) * Math.sin(z * 6.7 - y * 4.3 + ph);
      const n3 = rr() - 0.5;
      const k = r * (1 + 0.18 * n + 0.1 * n2 + 0.07 * n3);
      p.setXYZ(i, cx + x * k, cy + Math.max(y * k * sy, -r * flat * sy), cz + z * k);
      const shade = (0.5 + 0.5 * (y + 1) / 2) * (0.85 + 0.35 * n2) * (0.65 + 0.7 * rr());
      c[i * 3] = tint[0] * shade; c[i * 3 + 1] = tint[1] * shade; c[i * 3 + 2] = tint[2] * shade;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.computeVertexNormals();
    foliage.push(g);
  }
  function tree(x, z, h, seed, tint, detail) {
    const r = rng(seed);
    const trunkH = h * 0.42;
    put(cyl(0.07 * h * 0.12 + 0.04, 0.09 * h * 0.12 + 0.07, trunkH + 0.8, 10), M.bark, [x, trunkH / 2 + 0.2, z]);
    const cr = h * 0.27;
    blob(x, trunkH + cr * 1.0, z, cr * 0.85, 1.0, seed, tint, detail);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.28 + r(), d = cr * (0.5 + r() * 0.35);
      blob(x + Math.cos(a) * d, trunkH + cr * (0.5 + r() * 1.0), z + Math.sin(a) * d, cr * (0.42 + r() * 0.2), 0.9, seed * 7 + i, tint, detail);
    }
    for (const [dx, dz] of [[0.6, 0.2], [-0.5, 0.4], [0.1, -0.6]]) { // limbs
      const al = along(V(x, trunkH * 0.8, z), V(x + dx * cr * 0.8, trunkH + cr * 0.6, z + dz * cr * 0.8));
      putM(cyl(0.035 * h * 0.12, 0.06 * h * 0.12, al.L, 6), M.bark, al.m);
    }
  }
  tree(-12.5, 6.5, 7.5, 3);
  tree(9.8, 5.2, 6.2, 5, [0.2, 0.28, 0.12]);
  tree(-5.5, -14, 11, 7);
  tree(7.5, -15, 12, 11, [0.14, 0.27, 0.13]);
  tree(17, -6, 9, 13);
  tree(-15, -5, 10, 17, [0.18, 0.3, 0.14]);
  tree(1.5, -19, 13, 19);
  tree(-9, 28, 8, 23, undefined, 2); tree(8, 28.5, 7, 29, undefined, 2); tree(-24, 27, 9, 31, undefined, 2); tree(24, 27, 8, 37, undefined, 2);
  // hedges in front of the house
  for (const [x0, x1] of [[-8.7, -4.6], [4.3, 7.15], [9.4, 12.7]]) {
    for (let x = x0 + 0.3; x <= x1 - 0.25; x += 0.42) blob(x, 0.42, 0.72, 0.5, 0.9, Math.round(x * 100) + 900, [0.13, 0.25, 0.09], HIGH ? 3 : 2, 0.8);
  }
  {
    const fm = new THREE.Mesh(mergeGeometries(foliage), M.foliage);
    fm.castShadow = true; fm.receiveShadow = true;
    root.add(fm);
  }

  // ================================================================== STREET FURNITURE
  // Streetlights
  function streetlight(x, z, dir) {
    put(cyl(0.07, 0.1, 6.6, 14), M.streetPole, [x, 3.3, z]);
    put(cyl(0.16, 0.2, 0.5, 14), M.streetPole, [x, 0.25, z]);
    const al = along(V(x, 6.4, z), V(x, 6.75, z + dir * 1.6));
    putM(cyl(0.04, 0.05, al.L, 10), M.streetPole, al.m);
    put(rbox(0.36, 0.12, 0.7, 0.04), M.streetPole, [x, 6.75, z + dir * 1.8]);
    const lensM = new THREE.Mesh(box(0.28, 0.02, 0.56), M.streetLens);
    lensM.position.set(x, 6.685, z + dir * 1.8);
    root.add(lensM);
    const sp = new THREE.SpotLight(0xffd5a0, 110, 28, 1.05, 0.75, 2);
    sp.position.set(x, 6.66, z + dir * 1.8);
    sp.target.position.set(x, 0, z + dir * 2.6);
    root.add(sp, sp.target);
  }
  streetlight(-7.6, 11.6, 1);
  streetlight(12.5, 24.4, -1);
  // Mailbox
  {
    const mx = 3.85, mz = 11.5;
    put(rbox(0.1, 1.05, 0.1, 0.01), M.wood, [mx, 0.52, mz]);
    put(rbox(0.1, 0.06, 0.5, 0.01), M.wood, [mx, 1.04, mz]);
    put(rbox(0.19, 0.16, 0.48, 0.02), M.mailbox, [mx, 1.15, mz]);
    put(cyl(0.095, 0.095, 0.48, 18, 1), M.mailbox, [mx, 1.23, mz], [Math.PI / 2, 0, 0]);
    put(box(0.015, 0.14, 0.03), M.red, [mx + 0.105, 1.28, mz - 0.1]);
    put(box(0.005, 0.05, 0.2), M.trimOut, [mx + 0.1, 1.15, mz], [0, 0, 0], { cast: false });
  }
  // Houses across the street (seen when looking out of the garage)
  {
    const houses = [[-17, 34, 12], [0, 35, 13], [17, 33.5, 11.5]];
    for (const [hx, hz, w] of houses) {
      const d = 9, wt = 3.1;
      put(uvScale(box(w, wt, d), w / 2, wt / 1.78), M.far, [hx, wt / 2, hz + d / 2]);
      const tri = new THREE.Shape([[-d / 2 - 0.5, 0], [d / 2 + 0.5, 0], [0, 2.3]].map(([a, b]) => new THREE.Vector2(a, b)));
      const rg = new THREE.ExtrudeGeometry(tri, { depth: w + 0.6, bevelEnabled: false });
      uvScale(rg, 0.5, 0.5);
      putM(rg, M.farRoof, new THREE.Matrix4().makeBasis(V(0, 0, 1), V(0, 1, 0), V(-1, 0, 0)).setPosition(hx + w / 2 + 0.3, wt, hz + d / 2));
      const wins = [[-w / 2 + 1.6, 1.5], [w / 2 - 1.8, 1.5]];
      for (const [wx, wy] of wins) {
        const pm = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), M.room);
        pm.position.set(hx + wx, wy, hz - 0.02); pm.rotation.y = Math.PI; root.add(pm);
      }
      put(box(3.0, 2.1, 0.05), M.farGarage, [hx, 1.05, hz - 0.03], [0, 0, 0], { cast: false });
      put(uvScale(box(3.2, 0.1, hz - 24.2), 2, 5), M.walk, [hx, -0.05, (hz + 24.2) / 2], [0, 0, 0], { cast: false });
      const g = new THREE.Mesh(box(0.1, 0.18, 0.1), M.lantern);
      g.position.set(hx + 1.9, 1.9, hz - 0.08); root.add(g);
    }
  }

  // ================================================================== SKY, FOG, ENVIRONMENT
  const skyTop = col(0x08112b), skyMid = col(0x1b2a58), skyHor = col(0x6a5885), skyGlow = col(0xf08a4c), skyGround = col(0x0c0f16);
  const fogCol = col(0x2a2f4b);
  {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: skyTop }, mid: { value: skyMid }, hor: { value: skyHor }, glow: { value: skyGlow }, ground: { value: skyGround },
        sunDir: { value: new THREE.Vector3(0.35, 0, -1).normalize() },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 top, mid, hor, glow, ground, sunDir; varying vec3 vDir;
        float hash(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        void main(){
          vec3 d = normalize(vDir); float h = d.y;
          vec3 c = mix(hor, mid, smoothstep(0.0, 0.32, h));
          c = mix(c, top, smoothstep(0.25, 0.85, h));
          vec2 az2 = normalize(d.xz + 1e-5);
          float az = max(dot(az2, normalize(sunDir.xz)), 0.0);
          c += glow * pow(az, 2.5) * exp(-max(h, 0.0) * 5.0) * 0.9;
          c += glow * 0.12 * exp(-abs(h) * 14.0);
          c = mix(c, ground, smoothstep(0.0, -0.06, h));
          vec3 q = d * 260.0; vec3 cell = floor(q); float r = hash(cell);
          if (r > 0.9965 && h > 0.1) { float s = smoothstep(0.35, 0.0, length(fract(q) - 0.5)); c += vec3(0.9,0.95,1.0) * s * (r - 0.9965) * 420.0 * smoothstep(0.1, 0.5, h); }
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(190, 48, 24), mat);
    dome.frustumCulled = false; dome.renderOrder = -10;
    root.add(dome);
    scene.background = skyGround.clone();
    scene.fog = new THREE.Fog(fogCol, 22, 200);
    // distant treeline silhouette ring
    const tl = canvasTexture(2048, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      const r = rng(201);
      g.fillStyle = '#fff';
      g.fillRect(0, h * 0.82, w, h);
      for (let x = -40; x < w + 40; x += 6 + r() * 16) {
        const th = h * (0.25 + r() * 0.5), rw = 12 + r() * 36;
        g.beginPath(); g.ellipse(x, h - th * 0.55, rw, th * 0.55, 0, 0, 6.283); g.fill();
        if (r() < 0.3) { g.beginPath(); g.moveTo(x - rw * 0.6, h * 0.9); g.lineTo(x, h - th * 1.25); g.lineTo(x + rw * 0.6, h * 0.9); g.fill(); }
      }
    }, { srgb: false });
    tl.wrapT = THREE.ClampToEdgeWrapping; tl.repeat.set(6, 1);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(125, 125, 16, 64, 1, true), new THREE.MeshBasicMaterial({ color: 0x0b1020, alphaMap: tl, alphaTest: 0.5, side: THREE.BackSide, fog: true }));
    ring.position.y = 7.2;
    ring.frustumCulled = false;
    root.add(ring);
  }
  // Environment map: dusk sky + warm overhead panels, prefiltered.
  if (renderer) {
    const env = new THREE.Scene();
    const sg = new THREE.SphereGeometry(20, 32, 16);
    const cc = new Float32Array(sg.attributes.position.count * 3);
    for (let i = 0; i < sg.attributes.position.count; i++) {
      const y = sg.attributes.position.getY(i) / 20;
      const c = y > 0 ? skyHor.clone().lerp(skyMid, Math.min(1, y * 2.5)).lerp(skyTop, Math.max(0, y - 0.4)) : skyGround.clone().lerp(col(0x2a2622), Math.min(1, -y * 3));
      c.multiplyScalar(1.6);
      cc.set([c.r, c.g, c.b], i * 3);
    }
    sg.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    env.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const pm = new THREE.MeshBasicMaterial({ color: col(0xfff0de).multiplyScalar(5) });
    for (const x of [-3, 3]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 9), pm); p.position.set(x, 7, 0); env.add(p); }
    const warm = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 0.1), new THREE.MeshBasicMaterial({ color: col(0xffb070).multiplyScalar(1.2) }));
    warm.position.set(0, 1.5, -12); env.add(warm);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(env, 0.02).texture;
    pmrem.dispose();
    scene.environmentIntensity = 0.32;
  }

  // ================================================================== GLOBAL LIGHTS
  {
    const hemi = new THREE.HemisphereLight(0x6f84b8, 0x2b2620, 0.55);
    root.add(hemi);
    const moon = new THREE.DirectionalLight(0xa6b8ff, 0.6);
    moon.position.set(-14, 18, 16);
    moon.target.position.set(0, 0, 2);
    moon.castShadow = !DBG.includes('sh');
    moon.shadow.mapSize.set(SHADOW, SHADOW);
    const sc = moon.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 20; sc.bottom = -20; sc.near = 1; sc.far = 70;
    moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.03;
    root.add(moon, moon.target);
    shadowLights.push(moon);
  }

  // ================================================================== ASSEMBLE
  flush();
  ctx.add(root);
  { let t = 0, n = 0; root.traverse((o) => { if (o.isMesh) { n++; const g = o.geometry; t += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.count || 1); } }); console.log('garage meshes', n, 'tris', Math.round(t)); }

  // ================================================================== API
  function applyLights(v) {
    lightsV = Math.max(0, Math.min(1, v));
    for (const [l, base] of interiorLights) l.intensity = base * lightsV;
    for (const f of dimmers) f(lightsV);
  }
  applyLights(0);
  api.setLights = (v) => applyLights(v);
  api.getLights = () => lightsV;

  let anim = null;
  function animateDoor(to, seconds) {
    if (anim) { anim.res(); anim = null; }
    return new Promise((res) => {
      if (!(seconds > 0.05)) { setDoor(to); res(); return; }
      anim = { from: doorU, to, t: 0, dur: seconds, res };
    });
  }
  api.openDoor = (seconds = 3.2) => animateDoor(UMAX, seconds);
  api.closeDoor = (seconds = 3.2) => animateDoor(0, seconds);
  api.isOpen = () => doorU >= UMAX - 1e-3;
  // Static world: shadow maps are re-rendered only when something changes (door moving),
  // for the first frames (other modules add casters after us), and every ~1.5 s.
  let shadowFrames = 8, shadowClock = 0;
  for (const l of shadowLights) l.shadow.autoUpdate = false;
  const refreshShadows = (frames = 2) => { shadowFrames = Math.max(shadowFrames, frames); };
  api.refreshShadows = refreshShadows;
  ctx.onUpdate((dt) => {
    shadowClock += dt;
    if (anim) shadowFrames = Math.max(shadowFrames, 1);
    if (shadowClock > 1.5) { shadowClock = 0; shadowFrames = Math.max(shadowFrames, 1); }
    if (shadowFrames > 0) { shadowFrames--; for (const l of shadowLights) l.shadow.needsUpdate = true; }
  });
  ctx.onUpdate((dt) => {
    if (!anim) return;
    anim.t += dt;
    const k = Math.min(1, anim.t / anim.dur);
    const e = k < 0.12 ? (k / 0.12) ** 2 * 0.06 : k > 0.9 ? 1 - ((1 - k) / 0.1) ** 2 * 0.05 : 0.06 + ((k - 0.12) / 0.78) * 0.89;
    setDoor(anim.from + (anim.to - anim.from) * e);
    if (k >= 1) { const r = anim.res; anim = null; r(); }
  });
}
