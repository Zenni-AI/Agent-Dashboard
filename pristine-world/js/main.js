// Pristine World engine: renderer, camera rig (first-person walking between
// departments), hotspot picking, floating markers, minimap, and content cards.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VIEWS, WAYPOINTS } from './views.js';
import tex from './lib/tex.js';
import { CAPTIONS, ITEMS, SERVICES } from './content.js';

const MODULES = ['garage', 'solar', 'services', 'network', 'about'];
const $ = (id) => document.getElementById(id);
const V3 = (a) => new THREE.Vector3(...a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeInOut = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const RM = matchMedia('(prefers-reduced-motion: reduce)');
const coarse = matchMedia('(pointer: coarse)').matches;
const lowEnd = coarse || (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
const quality = lowEnd ? 'low' : 'high';

// Walk routes: every interior view is reached through the door, then along
// the left aisle, so the camera never passes through the car or a wall.
const D = WAYPOINTS.door, HUB = WAYPOINTS.hub;
const APPROACH = {
  garage: [], dumpster: [], solar: [],
  services: [D, HUB],
  about: [D, HUB, [-1.5, 1.62, -3.4]],
  network: [D, [2.65, 1.75, -0.45], [2.85, 1.8, -2.7]],
};
function route(a, b) {
  const A = APPROACH[a] || [], B = APPROACH[b] || [];
  let k = 0;
  while (k < A.length && k < B.length && A[k] === B[k]) k++;
  return k > 0 ? [...A.slice(k - 1).reverse(), ...B.slice(k)] : [...A.slice().reverse(), ...B];
}

// Where each department sits on the minimap (world x, z).
const ZONES = {
  garage: [-0.4, 9.5], services: [-3.2, -3.4], dumpster: [-5.0, 5.0],
  solar: [0.9, -3.4], network: [2.65, -6.55], about: [-1.5, -6.8],
};

boot().catch((err) => { console.error(err); showFallback(); });

async function boot() {
  // ---------- Renderer ----------
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (e) { showFallback(); return; }
  const host = $('world');
  let W = innerWidth, H = innerHeight;
  let pixelRatio = Math.min(devicePixelRatio || 1, quality === 'high' ? 1.75 : 1.25);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(W, H);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1018);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.3;

  const camera = new THREE.PerspectiveCamera(50, W / H, 0.03, 400);

  // ---------- Post ----------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const outline = new OutlinePass(new THREE.Vector2(W, H), scene, camera);
  Object.assign(outline, { edgeStrength: 4.5, edgeGlow: 0.7, edgeThickness: 1.6, pulsePeriod: 2.4 });
  outline.visibleEdgeColor.set(0xf4a62a);
  outline.hiddenEdgeColor.set(0x5a3a08);
  composer.addPass(outline);
  const bloom = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.42, 0.55, 0.86);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------- Build the world ----------
  const hotspots = [];
  const updates = [];
  const ctx = {
    THREE, scene, tex, quality, renderer, api: {},
    add: (o) => (scene.add(o), o),
    hotspot: (obj, spec) => { hotspots.push({ obj, spec }); return obj; },
    onUpdate: (fn) => updates.push(fn),
  };
  try {
    await Promise.race([
      Promise.all(['Anton', 'Saira Stencil One', 'Archivo', 'JetBrains Mono'].map((f) => document.fonts.load(`40px "${f}"`))),
      wait(2500),
    ]);
  } catch { /* fonts are optional */ }

  const bar = $('load-bar'), loadText = $('load-text');
  const steps = { garage: 'Pouring the driveway…', solar: 'Waxing the car…', services: 'Hanging the tools…', network: 'Spinning the web…', about: 'Framing the photo…' };
  for (let i = 0; i < MODULES.length; i++) {
    const m = MODULES[i];
    loadText.textContent = steps[m];
    try {
      const mod = await import(`./world/${m}.js`);
      await mod.build(ctx);
    } catch (e) { console.error(`[world] ${m} failed`, e); }
    bar.style.width = `${((i + 1) / MODULES.length) * 100}%`;
    await wait(16);
  }
  const G = ctx.api.garage || {};
  if (G.exposure) renderer.toneMappingExposure = G.exposure;

  // Index hotspots: any descendant mesh resolves to its registered root.
  const rootMap = new Map();
  for (const h of hotspots) {
    rootMap.set(h.obj, h);
    h.obj.updateWorldMatrix(true, true);
    if (h.spec.anchor) h.anchor = V3(h.spec.anchor);
    else {
      const b = new THREE.Box3().setFromObject(h.obj);
      h.anchor = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y + 0.06, (b.min.z + b.max.z) / 2);
    }
    const s = new THREE.Box3().setFromObject(h.obj).getBoundingSphere(new THREE.Sphere());
    h.sphere = s;
    h.visibleMeshes = [];
    h.obj.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o.material && o.material.visible !== false && o.visible) h.visibleMeshes.push(o); });
  }
  const findEntry = (o, v) => {
    for (let p = o; p; p = p.parent) {
      const e = rootMap.get(p);
      if (e && e.spec.views && e.spec.views[v]) return e;
    }
    return null;
  };

  // ---------- Camera rig ----------
  const rig = {
    pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50,
    yaw: 0, pitch: 0, yawT: 0, pitchT: 0, dragYaw: 0, dragPitch: 0,
    bob: new THREE.Vector3(), roll: 0,
    offX: 0, offY: 0, offXT: 0, offYT: 0,
  };
  let travel = null;
  let view = 'garage';
  let mode = 'view'; // 'view' | 'item'
  let busy = false;

  function viewFov(v) {
    const aspect = W / H;
    const dist = V3(v.pos).distanceTo(V3(v.target));
    const need = 2 * Math.atan((v.fitWidth / 2) / dist);
    const have = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(v.fov) / 2) * aspect);
    if (have >= need) return v.fov;
    return clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(need / 2) / aspect)), v.fov, 82);
  }

  function travelTo(pos, look, fov, { via = [], walk = true, dur } = {}) {
    const start = rig.pos.clone();
    const pts = [start];
    for (const p of via) {
      const v = V3(p);
      if (v.distanceTo(pts[pts.length - 1]) > 0.6 && v.distanceTo(pos) > 0.6) pts.push(v);
    }
    pts.push(pos.clone());
    const curve = pts.length > 2 ? new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5) : new THREE.LineCurve3(pts[0], pts[1]);
    const len = curve.getLength();
    const d = dur ?? (RM.matches ? 0.01 : clamp(len / (walk ? 2.9 : 2.2), walk ? 1.3 : 0.9, walk ? 6 : 1.8));
    return new Promise((resolve) => {
      travel = {
        curve, len, dur: d, t: 0, walk: walk && len > 2.5,
        dirFrom: rig.look.clone().sub(start).normalize(), distFrom: rig.look.distanceTo(start),
        dirTo: look.clone().sub(pos).normalize(), distTo: look.distanceTo(pos),
        fovFrom: rig.fov, fovTo: fov, resolve, speed: 1,
      };
      document.body.classList.add('moving');
    });
  }

  const _t = new THREE.Vector3(), _d = new THREE.Vector3();
  function stepTravel(dt) {
    const tr = travel;
    tr.t = Math.min(1, tr.t + (dt * tr.speed) / tr.dur);
    const e = easeInOut(tr.t);
    tr.curve.getPointAt(e, rig.pos);
    if (tr.walk) {
      tr.curve.getTangentAt(Math.min(e, 0.999), _t);
      _t.y *= 0.25; _t.normalize();
      const w1 = 1 - smooth(0, 0.22, e), w3 = smooth(0.62, 1, e), w2 = Math.max(0, 1 - w1 - w3);
      _d.copy(tr.dirFrom).multiplyScalar(w1).addScaledVector(_t, w2).addScaledVector(tr.dirTo, w3).normalize();
      // Footsteps: gentle vertical bob, lateral sway and roll, faded in and out.
      const env = Math.sin(Math.PI * e);
      const phase = (e * tr.len) / 0.72 * Math.PI;
      rig.bob.set(Math.sin(phase) * 0.012 * env, (Math.abs(Math.sin(phase)) * 0.034 - 0.017) * env, 0);
      rig.roll = Math.sin(phase) * 0.0045 * env;
    } else {
      _d.copy(tr.dirFrom).lerp(tr.dirTo, smooth(0, 1, e)).normalize();
      rig.bob.set(0, 0, 0); rig.roll = 0;
    }
    rig.look.copy(rig.pos).addScaledVector(_d, THREE.MathUtils.lerp(tr.distFrom, tr.distTo, e));
    rig.fov = THREE.MathUtils.lerp(tr.fovFrom, tr.fovTo, e);
    if (tr.t >= 1) {
      travel = null;
      rig.bob.set(0, 0, 0); rig.roll = 0;
      document.body.classList.remove('moving');
      tr.resolve();
    }
  }

  function placeAt(key) {
    const v = VIEWS[key];
    rig.pos.copy(V3(v.pos)); rig.look.copy(V3(v.target)); rig.fov = viewFov(v);
  }

  const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function applyCamera(t) {
    rig.yaw += (rig.yawT - rig.yaw) * 0.06;
    rig.pitch += (rig.pitchT - rig.pitch) * 0.06;
    rig.offX += (rig.offXT - rig.offX) * 0.08;
    rig.offY += (rig.offYT - rig.offY) * 0.08;
    const idle = travel || RM.matches ? 0 : 1;
    // Breathing: a person standing still is never perfectly still.
    const bx = Math.sin(t * 0.55) * 0.006 * idle, by = Math.sin(t * 0.9) * 0.005 * idle;
    camera.position.copy(rig.pos).add(rig.bob).add(_r.set(bx, by, 0));
    _f.copy(rig.look).sub(rig.pos);
    const yaw = rig.yaw + rig.dragYaw + Math.sin(t * 0.31) * 0.004 * idle;
    const pitch = rig.pitch + rig.dragPitch + Math.sin(t * 0.47) * 0.003 * idle;
    _f.applyAxisAngle(_up, yaw);
    _r.crossVectors(_f, _up).normalize();
    _f.applyAxisAngle(_r, pitch);
    camera.lookAt(_f.add(camera.position));
    if (rig.roll) camera.rotateZ(rig.roll);
    if (Math.abs(camera.fov - rig.fov) > 0.01) { camera.fov = rig.fov; camera.updateProjectionMatrix(); }
    if (Math.abs(rig.offX) > 0.5 || Math.abs(rig.offY) > 0.5) camera.setViewOffset(W, H, rig.offX, rig.offY, W, H);
    else if (camera.view && camera.view.enabled) camera.clearViewOffset();
  }

  // ---------- Markers ----------
  const markerLayer = $('markers');
  for (const h of hotspots) {
    const b = document.createElement('button');
    b.className = 'marker off';
    b.innerHTML = '<span class="dia"></span><span class="tag"><b></b><i></i></span>';
    b.addEventListener('click', (e) => { e.stopPropagation(); activate(h); });
    b.addEventListener('pointerenter', () => setHover(h));
    b.addEventListener('pointerleave', () => setHover(null));
    markerLayer.appendChild(b);
    h.el = b; h.labelEl = b.querySelector('b'); h.distEl = b.querySelector('i');
  }
  function refreshMarkers() {
    for (const h of hotspots) {
      const a = h.spec.views?.[view];
      h.active = !!a;
      h.el.hidden = !a;
      if (a) { h.labelEl.textContent = a.label || h.spec.id; h.el.setAttribute('aria-label', a.label || h.spec.id); }
    }
  }
  const _p = new THREE.Vector3();
  const occRay = new THREE.Raycaster();
  let frameNo = 0;
  function updateMarkers() {
    frameNo++;
    for (const h of hotspots) {
      if (!h.active) continue;
      _p.copy(h.anchor).project(camera);
      const on = _p.z < 1 && Math.abs(_p.x) < 1.08 && Math.abs(_p.y) < 1.08;
      h.el.classList.toggle('off', !on);
      if (!on) continue;
      const x = (_p.x + 1) / 2 * W, y = (1 - _p.y) / 2 * H;
      h.el.style.setProperty('--x', `${x.toFixed(1)}px`);
      h.el.style.setProperty('--y', `${(y - 14).toFixed(1)}px`);
      h.el.classList.toggle('left', x > W * 0.74);
      const dist = camera.position.distanceTo(h.anchor);
      h.distEl.textContent = `${dist.toFixed(1)} m`;
      if ((frameNo + h.anchor.x * 7) % 15 < 1) {
        _d.copy(h.anchor).sub(camera.position).normalize();
        occRay.set(camera.position, _d); occRay.far = dist - 0.12;
        const hit = occRay.intersectObjects(scene.children, true).find((i) => isSolid(i.object) && findEntry(i.object, view) !== h);
        h.el.classList.toggle('occluded', !!hit);
      }
    }
  }
  function isSolid(o) {
    if (o.isLine || o.isPoints || o.isSprite) return false;
    const m = o.material;
    if (!m || m.visible === false) return false;
    if (m.transparent && m.opacity < 0.35) return false;
    return true;
  }

  // ---------- Picking ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered = null;
  function pick(cx, cy) {
    ndc.set((cx / W) * 2 - 1, -(cy / H) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(scene.children, true);
    for (const i of hits) {
      const e = findEntry(i.object, view);
      if (e) return e;
      if (isSolid(i.object)) return null;
    }
    return null;
  }
  function setHover(h) {
    if (hovered === h) return;
    if (hovered) hovered.el.classList.remove('hot');
    hovered = h;
    document.body.classList.toggle('hovering', !!h);
    outline.selectedObjects = h ? h.visibleMeshes : [];
    if (h) h.el.classList.add('hot');
    ctx.api.solar?.setHover?.(!!h && h.spec.id === 'hot-vette');
  }

  function activate(h) {
    const a = h.spec.views?.[view];
    if (!a || busy || introRunning) return;
    setHover(null);
    if (a.go) go(a.go);
    else if (a.item) focusItem(h, a.item);
  }

  // ---------- Navigation ----------
  async function go(key) {
    if (!VIEWS[key] || busy) return;
    if (key === view && mode === 'view') return;
    busy = true;
    hidePanel();
    rig.dragYaw = rig.dragPitch = 0;
    const v = VIEWS[key];
    const via = mode === 'item' ? [VIEWS[view].pos, ...route(view, key)] : route(view, key);
    captionOut();
    await travelTo(V3(v.pos), V3(v.target), viewFov(v), { via, walk: true });
    view = key; mode = 'view'; busy = false;
    arrive();
  }

  async function focusItem(h, key) {
    if (busy) return;
    busy = true;
    const c = h.sphere.center.clone();
    const r = Math.max(0.08, h.sphere.radius);
    const ref = V3(VIEWS[view].pos);
    const dir = c.clone().sub(ref).normalize();
    const fov = clamp(viewFov(VIEWS[view]), 40, 60);
    const dist = clamp(r / Math.sin(THREE.MathUtils.degToRad(fov) / 2) * 1.05, 0.42, 4.2);
    const pos = c.clone().addScaledVector(dir, -dist);
    pos.y = Math.max(pos.y, 0.4);
    if (ref.z < 0) { pos.x = clamp(pos.x, -3.35, 3.35); pos.z = clamp(pos.z, -6.95, 1.5); }
    mode = 'item';
    showPanel(key);
    rig.dragYaw = rig.dragPitch = 0;
    await travelTo(pos, c, fov, { walk: false });
    busy = false;
  }

  async function returnToView() {
    if (mode !== 'item' || busy) return;
    busy = true;
    const v = VIEWS[view];
    await travelTo(V3(v.pos), V3(v.target), viewFov(v), { walk: false });
    mode = 'view'; busy = false;
  }

  function stepBack() {
    if (introRunning) return skipIntro();
    if ($('panel').classList.contains('open')) { closePanel(); return; }
    const p = VIEWS[view].parent;
    if (p) go(p);
  }

  // ---------- Panel ----------
  const panel = $('panel');
  let lastFocus = null;
  function woNumber(key) { let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) % 9000; return `PHS-${1000 + h}`; }

  function formHTML(kind, service) {
    const opts = SERVICES.map((s) => `<option${s === service ? ' selected' : ''}>${esc(s)}</option>`).join('');
    if (kind === 'quote') return `
      <form data-form="quote">
        <div class="two">
          <label>Name<input id="q-name" name="name" autocomplete="name" required></label>
          <label>Phone<input id="q-phone" name="phone" type="tel" autocomplete="tel" required></label>
        </div>
        <label>Street address or ZIP<input id="q-addr" name="address" autocomplete="street-address" required></label>
        <label>Service<select id="q-svc" name="service">${opts}</select></label>
        <label>What does the house need?<textarea id="q-note" name="note" placeholder="Back patio pavers, about 12 × 16 ft"></textarea></label>
        <div class="actions"><button class="btn" type="submit">Send request</button></div>
      </form>`;
    if (kind === 'join') return `
      <form data-form="join">
        <div class="two">
          <label>Name<input id="j-name" name="name" autocomplete="name" required></label>
          <label>Email<input id="j-email" name="email" type="email" autocomplete="email" required></label>
        </div>
        <label>ZIP code<input id="j-zip" name="zip" inputmode="numeric" autocomplete="postal-code" required></label>
        <div class="actions"><button class="btn" type="submit">Join the network</button></div>
      </form>`;
    if (kind === 'partner') return `
      <form data-form="partner">
        <label>Business name<input id="p-biz" name="business" autocomplete="organization" required></label>
        <div class="two">
          <label>Trade<input id="p-trade" name="trade" placeholder="Roofing, HVAC…" required></label>
          <label>Phone<input id="p-phone" name="phone" type="tel" autocomplete="tel" required></label>
        </div>
        <div class="actions"><button class="btn" type="submit">Apply to partner</button></div>
      </form>`;
    return '';
  }

  function renderPanel(key, service) {
    const it = ITEMS[key];
    const actions = (it.actions || []).map((a, i) => `<button class="btn${i ? ' ghost' : ''}" data-do="${esc(a.do)}">${esc(a.label)}</button>`).join('');
    const ebooks = it.ebooks ? `<div class="ebooks">${it.ebooks.map((b, i) => `
      <div class="ebook">
        <div class="cover" style="background:${b.color}">${esc(b.title)}</div>
        <div>
          <h3>${esc(b.title)}</h3><p>${esc(b.blurb)}</p>
          <button class="linkbtn" data-do="ebook:${i}">Send me this e-book</button>
          <form class="mini" data-form="ebook" hidden>
            <input id="eb-${i}" type="email" placeholder="you@email.com" aria-label="Email for ${esc(b.title)}" required>
            <button class="btn sm" type="submit">Send</button>
          </form>
        </div>
      </div>`).join('')}</div>` : '';
    panel.innerHTML = `
      <div class="ticket">
        <div class="ticket-head">
          <span>Dept · ${esc(it.dept)}</span>
          <span class="wo">W/O ${woNumber(key)}</span>
          <button class="close" data-do="close" aria-label="Close and step back">✕</button>
        </div>
        ${it.stamp ? `<div class="stamp">${esc(it.stamp)}</div>` : ''}
        <h2 id="panel-title">${esc(it.title)}</h2>
        <p class="lead">${esc(it.lead)}</p>
        ${it.list ? `<p class="label">${esc(it.listLabel || 'Included')}</p><ul class="checks">${it.list.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
        ${it.steps ? `<p class="label">How it goes</p><ol class="steps">${it.steps.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>` : ''}
        ${ebooks}
        ${it.form ? formHTML(it.form, service || it.service) : ''}
        ${actions ? `<div class="actions">${actions}</div>` : ''}
      </div>`;
  }

  function showPanel(key, service) {
    if (!ITEMS[key]) return;
    lastFocus = document.activeElement;
    renderPanel(key, service);
    panel.classList.add('open');
    panel.scrollTop = 0;
    document.body.classList.add('panel-open');
    const narrow = W <= 760;
    const pw = panel.getBoundingClientRect().width;
    rig.offXT = narrow ? 0 : (pw + 36) / 2;
    rig.offYT = narrow ? Math.min(H * 0.64, panel.scrollHeight) / 2 : 0;
    setTimeout(() => panel.querySelector('.close')?.focus({ preventScroll: true }), 350);
  }
  function hidePanel() {
    panel.classList.remove('open');
    document.body.classList.remove('panel-open');
    rig.offXT = rig.offYT = 0;
  }
  function closePanel() {
    hidePanel();
    if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
    returnToView();
  }

  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-do]');
    if (!b) return;
    const [cmd, arg] = b.dataset.do.split(/:(.*)/s);
    if (cmd === 'close') closePanel();
    else if (cmd === 'quote') showPanel('quote', arg);
    else if (cmd === 'item') showPanel(arg);
    else if (cmd === 'go') go(arg);
    else if (cmd === 'ebook') {
      const f = b.nextElementSibling; f.hidden = false; b.hidden = true; f.querySelector('input').focus();
    }
  });
  panel.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.querySelector('.note')) return;
    const note = document.createElement('p');
    note.className = 'note';
    note.setAttribute('role', 'status');
    note.textContent = 'This preview isn’t connected to an inbox yet, so nothing was sent. Connect it to your CRM or email before launch.';
    f.appendChild(note);
  });

  // ---------- HUD, caption, crumbs ----------
  const cap = $('caption');
  function captionOut() { cap.classList.add('swap'); }
  function setCaption() {
    const c = CAPTIONS[view];
    $('cap-kicker').textContent = c.kicker;
    $('cap-title').textContent = c.title;
    $('cap-sub').textContent = c.sub;
    const cta = $('cap-cta');
    cta.hidden = !c.cta;
    if (c.cta) { cta.textContent = c.cta.label; cta.dataset.do = c.cta.do; }
    cap.classList.remove('swap');
  }
  $('cap-cta').addEventListener('click', (e) => {
    const [cmd, arg] = e.currentTarget.dataset.do.split(/:(.*)/s);
    if (cmd === 'quote') showPanel('quote', arg);
  });
  function setCrumbs() {
    const chain = [];
    for (let k = view; k; k = VIEWS[k].parent) chain.unshift(k);
    $('crumbs').innerHTML = chain.map((k) => k === view
      ? `<li><button aria-current="location">${esc(VIEWS[k].name)}</button></li>`
      : `<li><button data-go="${k}">${esc(VIEWS[k].name)}</button></li>`).join('');
    $('back').hidden = !VIEWS[view].parent;
    $('map-here').textContent = VIEWS[view].name;
    for (const z of mapZones.children) z.setAttribute('aria-current', z.dataset.go === view ? 'location' : 'false');
  }
  $('crumbs').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });
  $('back').addEventListener('click', stepBack);
  $('home').addEventListener('click', () => go('garage'));
  $('quote-btn').addEventListener('click', () => showPanel('quote'));
  function arrive() {
    refreshMarkers();
    setCaption();
    setCrumbs();
    try { history.replaceState(null, '', `#${view}`); } catch { /* sandboxed */ }
  }

  // ---------- Minimap ----------
  const mapCanvas = $('map'), mctx = mapCanvas.getContext('2d');
  const mapZones = $('map-zones');
  const MX = (x) => (x + 10) * 15, MY = (z) => (z + 9) * 15; // 24 m square → 360 px
  for (const [k, [x, z]] of Object.entries(ZONES)) {
    const b = document.createElement('button');
    b.className = 'zone'; b.dataset.go = k; b.dataset.name = VIEWS[k].name;
    b.setAttribute('aria-label', `Walk to ${VIEWS[k].name}`);
    b.style.left = `${(MX(x) / 360) * 100}%`; b.style.top = `${(MY(z) / 360) * 100}%`;
    b.addEventListener('click', () => go(k));
    mapZones.appendChild(b);
  }
  function rr(x, y, w, h, r) { mctx.beginPath(); mctx.roundRect(x, y, w, h, r); }
  function drawMap(t) {
    const g = mctx;
    g.clearRect(0, 0, 360, 360);
    g.fillStyle = '#132016'; g.fillRect(0, 0, 360, 360);
    g.fillStyle = '#1a1e24'; g.fillRect(0, MY(13.5), 360, 360);
    g.strokeStyle = '#6b6243'; g.setLineDash([10, 10]); g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, MY(17.8)); g.lineTo(360, MY(17.8)); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#3a3f47'; g.fillRect(0, MY(12), 360, MY(13.5) - MY(12));
    g.fillStyle = '#4a4f57'; g.fillRect(MX(-3.2), MY(0), MX(3.2) - MX(-3.2), MY(12) - MY(0));
    g.fillStyle = '#222b37'; g.fillRect(MX(3.75), MY(-9), MX(14) - MX(3.75), MY(0) - MY(-9));
    g.fillStyle = '#2b3542'; g.fillRect(MX(-3.75), MY(-7.35), MX(3.75) - MX(-3.75), MY(0) - MY(-7.35));
    g.fillStyle = '#39414c'; g.fillRect(MX(-3.6), MY(-7.2), MX(3.6) - MX(-3.6), MY(0) - MY(-7.2));
    g.strokeStyle = '#8a97a8'; g.lineWidth = 2;
    g.strokeRect(MX(-3.6), MY(-7.2), MX(3.6) - MX(-3.6), MY(0) - MY(-7.2));
    g.strokeStyle = '#39414c'; g.lineWidth = 4; g.beginPath(); g.moveTo(MX(-2.75), MY(0)); g.lineTo(MX(2.75), MY(0)); g.stroke();
    g.fillStyle = '#b5121f'; rr(MX(-0.07), MY(-5.7), MX(1.87) - MX(-0.07), MY(-1.1) - MY(-5.7), 10); g.fill();
    g.fillStyle = '#1f4e8c'; g.fillRect(MX(-6.18), MY(2.5), MX(-3.82) - MX(-6.18), MY(7.5) - MY(2.5));
    g.fillStyle = '#8a6a44'; g.fillRect(MX(-3.6), MY(-4.6), MX(-3.0) - MX(-3.6), MY(-2.2) - MY(-4.6));
    for (const [k, [x, z]] of Object.entries(ZONES)) {
      const cur = k === view;
      const pulse = cur ? 2 + Math.sin(t * 4) * 1.5 : 0;
      g.beginPath(); g.arc(MX(x), MY(z), 9 + pulse, 0, Math.PI * 2);
      g.fillStyle = cur ? 'rgba(244,166,42,.28)' : 'rgba(9,13,20,.55)'; g.fill();
      g.lineWidth = 2.5; g.strokeStyle = cur ? '#f4a62a' : '#c9d2de'; g.stroke();
      g.save(); g.translate(MX(x), MY(z)); g.rotate(Math.PI / 4);
      g.fillStyle = cur ? '#f4a62a' : '#c9d2de'; g.fillRect(-3, -3, 6, 6); g.restore();
    }
    // Player: position and view cone.
    const px = MX(camera.position.x), py = MY(camera.position.z);
    camera.getWorldDirection(_d);
    const a = Math.atan2(_d.z, _d.x);
    const half = THREE.MathUtils.degToRad(camera.fov * camera.aspect) / 2;
    const grd = g.createRadialGradient(px, py, 0, px, py, 70);
    grd.addColorStop(0, 'rgba(255,236,200,.35)'); grd.addColorStop(1, 'rgba(255,236,200,0)');
    g.fillStyle = grd; g.beginPath(); g.moveTo(px, py); g.arc(px, py, 70, a - half, a + half); g.closePath(); g.fill();
    g.save(); g.translate(px, py); g.rotate(a);
    g.fillStyle = '#fff'; g.strokeStyle = '#0b1018'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(11, 0); g.lineTo(-7, 7); g.lineTo(-3, 0); g.lineTo(-7, -7); g.closePath(); g.stroke(); g.fill();
    g.restore();
  }

  // ---------- Input ----------
  const pointer = { x: W / 2, y: H / 2, down: false, sx: 0, sy: 0, moved: false, dirty: false, type: 'mouse', yaw0: 0, pitch0: 0 };
  const canvas = renderer.domElement;
  canvas.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.type = e.pointerType; pointer.dirty = true;
    if (pointer.down) {
      const dx = e.clientX - pointer.sx, dy = e.clientY - pointer.sy;
      if (Math.hypot(dx, dy) > 6) { pointer.moved = true; document.body.classList.add('dragging'); }
      if (pointer.moved) {
        rig.dragYaw = clamp(pointer.yaw0 + dx * 0.0032, -0.75, 0.75);
        rig.dragPitch = clamp(pointer.pitch0 + dy * 0.0026, -0.35, 0.35);
      }
    } else if (e.pointerType === 'mouse' && !RM.matches) {
      rig.yawT = -((e.clientX / W) * 2 - 1) * 0.07;
      rig.pitchT = -((e.clientY / H) * 2 - 1) * 0.045;
    }
  });
  canvas.addEventListener('pointerdown', (e) => {
    Object.assign(pointer, { down: true, sx: e.clientX, sy: e.clientY, moved: false, yaw0: rig.dragYaw, pitch0: rig.dragPitch, x: e.clientX, y: e.clientY });
    if (travel) travel.speed = 2.6; // hold to hurry
  });
  addEventListener('pointerup', (e) => {
    if (travel) travel.speed = 1;
    if (!pointer.down) return;
    pointer.down = false;
    document.body.classList.remove('dragging');
    if (pointer.moved || e.target !== canvas) return;
    if (busy || introRunning) return;
    const h = pick(e.clientX, e.clientY);
    if (h) activate(h);
    else if (mode === 'item') closePanel();
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); stepBack(); }
  });

  addEventListener('resize', () => {
    W = innerWidth; H = innerHeight;
    renderer.setSize(W, H); composer.setSize(W, H);
    outline.setSize(W, H);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    if (!travel && mode === 'view') rig.fov = viewFov(VIEWS[view]);
  });

  // ---------- Intro ----------
  let introRunning = false;
  let skipIntro = () => {};
  const startView = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'garage';
  view = startView;
  refreshMarkers(); setCaption(); setCrumbs();
  $('hint').innerHTML = coarse
    ? 'Tap a <kbd>◆</kbd> marker · drag to look around'
    : 'Click a <kbd>◆</kbd> marker or anything that glows · drag to look · <kbd>Esc</kbd> steps back';

  const doIntro = startView === 'garage' && !RM.matches && G.openDoor;
  if (doIntro) {
    G.setLights?.(0);
    rig.pos.set(-0.3, 1.72, 21); rig.look.set(-0.3, 1.45, -3); rig.fov = viewFov(VIEWS.garage);
    cap.classList.add('swap');
  } else {
    G.openDoor?.(0.01);
    G.setLights?.(1);
    placeAt(startView);
  }

  // ---------- Frame loop ----------
  const clock = new THREE.Clock();
  let elapsed = 0, lastPick = 0;
  let perfFrames = 0, perfTime = 0, perfDone = false;
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;
    for (const f of updates) { try { f(dt, elapsed); } catch (e) { console.error(e); updates.splice(updates.indexOf(f), 1); } }
    if (travel) stepTravel(dt);
    applyCamera(elapsed);
    if (pointer.dirty && !pointer.down && !travel && pointer.type === 'mouse' && elapsed - lastPick > 0.05) {
      pointer.dirty = false; lastPick = elapsed;
      if (!busy && !introRunning) setHover(pick(pointer.x, pointer.y));
    }
    if (travel && hovered) setHover(null);
    composer.render(dt);
    updateMarkers();
    drawMap(elapsed);
    // Adaptive quality: if the first seconds run slow, drop resolution, then bloom.
    if (!perfDone && elapsed > 1) {
      perfFrames++; perfTime += dt;
      if (perfFrames === 90) {
        const avg = perfTime / perfFrames;
        if (avg > 0.03 && pixelRatio > 1) { pixelRatio = 1; renderer.setPixelRatio(1); composer.setPixelRatio(1); perfFrames = 0; perfTime = 0; }
        else if (avg > 0.034) { bloom.enabled = false; perfDone = true; }
        else perfDone = true;
      }
    }
    requestAnimationFrame(frame);
  }
  frame();
  $('loader').classList.add('done');
  window.__ready = true;

  if (doIntro) {
    introRunning = true;
    const skip = $('skip');
    skip.hidden = false;
    let skipped = false;
    skipIntro = () => {
      if (skipped) return; skipped = true;
      G.openDoor?.(0.01); G.setLights?.(1);
      if (travel) travel.speed = 12;
    };
    skip.addEventListener('click', skipIntro);
    await wait(700);
    const door = G.openDoor(3.4);
    // Fluorescent tubes don't just switch on; they stutter.
    (async () => {
      const seq = [[1300, 0.05], [90, 0.7], [70, 0.08], [120, 0.85], [60, 0.2], [160, 1]];
      for (const [ms, v] of seq) { await wait(ms); if (skipped) break; G.setLights?.(v); }
      G.setLights?.(1);
    })();
    await wait(900);
    const v = VIEWS.garage;
    await travelTo(V3(v.pos), V3(v.target), viewFov(v), { walk: true, dur: skipped ? 0.2 : 5.6 });
    await door;
    skip.hidden = true;
    introRunning = false;
    arrive();
  } else {
    arrive();
  }
}

// ---------- Fallback when WebGL is unavailable ----------
function showFallback() {
  const loader = $('loader'); if (loader) loader.classList.add('done');
  const f = document.createElement('section');
  f.className = 'fallback';
  const cards = Object.entries(CAPTIONS).map(([k, c]) => `<button data-k="${k}"><b>${esc(VIEWS[k].name)}</b><span>${esc(c.sub)}</span></button>`).join('');
  f.innerHTML = `<h1>Pristine Home Services</h1><p>This browser can’t run the 3D garage, so here is every department as a list.</p><div class="grid">${cards}</div><div id="fb-items" class="grid"></div>`;
  document.body.appendChild(f);
  const map = { garage: ['solar-svc', 'net-mission', 'about-founders'], services: ['landscaping', 'lawn', 'pavers', 'washing', 'gutters'], dumpster: ['junk', 'cleanouts', 'landscaping', 'lawn', 'pavers', 'washing', 'gutters', 'solar-svc'], solar: ['solar-how', 'solar-ev', 'solar-savings', 'solar-quote'], network: ['net-mission', 'net-learn', 'net-join', 'net-partner'], about: ['about-founders', 'about-truck', 'about-portal'] };
  f.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    $('fb-items').innerHTML = map[b.dataset.k].map((k) => `<button disabled><b>${esc(ITEMS[k].title)}</b><span>${esc(ITEMS[k].lead)}</span></button>`).join('');
  });
}
