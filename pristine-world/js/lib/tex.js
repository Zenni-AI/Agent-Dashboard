// Small procedural-texture toolkit shared by every world module.
// Everything is drawn on <canvas> so the site ships with zero image files.
import * as THREE from 'three';

// Deterministic PRNG so textures look the same on every load.
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Draw on a canvas and wrap it as a texture.
// opts: { repeat:[u,v], srgb:true, anisotropy:8, wrap:true }
export function canvasTexture(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = opts.anisotropy ?? 8;
  if (opts.wrap !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  t.needsUpdate = true;
  return t;
}

// Speckle/grain noise over the whole canvas. Good for concrete, paint, plastic.
export function grain(g, w, h, { amount = 0.08, size = 1, seed = 7, light = true, dark = true, count } = {}) {
  const r = rng(seed);
  const n = count ?? Math.floor((w * h) / (size * size) * 0.5);
  for (let i = 0; i < n; i++) {
    const v = r();
    if (v < 0.5 && !dark) continue;
    if (v >= 0.5 && !light) continue;
    g.fillStyle = v < 0.5 ? `rgba(0,0,0,${amount * r()})` : `rgba(255,255,255,${amount * r()})`;
    g.fillRect(r() * w, r() * h, size, size);
  }
}

// Soft blotches (stains, weathering, clouds). Tiles cleanly by drawing wrapped copies.
export function blotches(g, w, h, { count = 40, min = 10, max = 80, color = '0,0,0', alpha = 0.06, seed = 3 } = {}) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = r() * w, y = r() * h, rad = min + r() * (max - min);
    for (const [ox, oy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) {
      const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      grd.addColorStop(0, `rgba(${color},${alpha * (0.5 + r())})`);
      grd.addColorStop(1, `rgba(${color},0)`);
      g.fillStyle = grd;
      g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
}

// A flat sign/label texture. Returns { texture, aspect }.
export function label(text, {
  font = '800 120px "Saira Stencil One", Impact, sans-serif',
  color = '#f4a62a', bg = null, pad = 40, height = 200, glow = null,
} = {}) {
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const tw = Math.ceil(probe.measureText(text).width);
  const w = tw + pad * 2;
  const tex = canvasTexture(w, height, (g) => {
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, height); }
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (glow) { g.shadowColor = glow; g.shadowBlur = 30; }
    g.fillStyle = color;
    g.fillText(text, w / 2, height / 2 + 4);
  }, { wrap: false });
  return { texture: tex, aspect: w / height };
}

// Convenience: a MeshStandardMaterial with a canvas map and matching roughness.
export function stdMat(map, { roughness = 0.8, metalness = 0, color = 0xffffff, ...rest } = {}) {
  return new THREE.MeshStandardMaterial({ map, roughness, metalness, color, ...rest });
}

export const tex = { rng, canvasTexture, grain, blotches, label, stdMat };
export default tex;
