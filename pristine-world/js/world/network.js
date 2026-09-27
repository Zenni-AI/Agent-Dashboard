// The Pristine Home Services NETWORK: an orb-weaver web strung across the
// back-right corner of the garage (corner x=3.6, z=-7.2), with a hero spider
// at the hub and glowing dew-drop "nodes" for each network action.
//
// Everything is built in a local "web frame": X runs across the corner
// (parallel to the web), Y is up, Z is the web normal pointing into the room.

export function build(ctx) {
  const { THREE, add, hotspot, onUpdate, tex, quality } = ctx;
  const low = quality === 'low';
  const R = tex.rng(4127);
  const jit = (a) => (R() * 2 - 1) * a;

  // ---- Placement -----------------------------------------------------------
  const K = 1.5;                               // chord depth across the corner
  const HUB = new THREE.Vector3(3.6 - K / 2, 2.2, -7.2 + K / 2);
  const EDGE = K / Math.SQRT2;                 // |u| where the walls meet the web plane
  const CEIL = 2.9 - HUB.y;                    // ceiling height in local v
  const root = new THREE.Group();
  root.name = 'network-web';
  root.position.copy(HUB);
  root.rotation.y = -Math.PI / 4;
  add(root);
  root.updateMatrixWorld(true);
  const toWorld = (u, v, w = 0) => root.localToWorld(new THREE.Vector3(u, v, w));
  // Wall anchor helpers (w < 0 = toward the corner, so anchors sit slightly off-plane).
  const onRight = (v, w) => [EDGE + w - 0.004, v, w];
  const onBack = (v, w) => [-EDGE - w + 0.004, v, w];

  // ---- Frame polygon (the outer bridge threads around the capture area) ----
  const frame = [
    [0.16, 0.6], [0.74, 0.42], [0.86, -0.14], [0.44, -0.6],
    [-0.36, -0.6], [-0.85, -0.1], [-0.6, 0.47],
  ];
  const moorings = [
    [0, [0.26, CEIL, -0.07]], [0, [-0.12, CEIL, -0.04]],
    [1, onRight(0.52, -0.1)], [1, [0.86, CEIL, -0.2]],
    [2, onRight(-0.2, -0.04)],
    [3, onRight(-0.66, -0.22)],
    [4, onBack(-0.68, -0.2)],
    [5, onBack(0.02, -0.05)],
    [6, onBack(0.6, -0.12)], [6, [-0.72, CEIL, -0.1]],
  ];
  // Distance from hub to the frame polygon along angle th.
  function frameR(th) {
    const dx = Math.cos(th), dy = Math.sin(th);
    let best = 1;
    for (let i = 0; i < frame.length; i++) {
      const [ax, ay] = frame[i], [bx, by] = frame[(i + 1) % frame.length];
      const ex = bx - ax, ey = by - ay;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = (ax * ey - ay * ex) / den;       // distance along ray
      const s = (ax * dy - ay * dx) / den;       // position along edge
      if (t > 0 && s >= -1e-6 && s <= 1 + 1e-6) { best = t; break; }
    }
    return best;
  }
  // Sway weight for a point in the capture area (1 at hub, ~0.25 at frame).
  function weightAt(u, v) {
    const r = Math.hypot(u, v), fr = frameR(Math.atan2(v, u));
    const rho = Math.min(r / fr, 1);
    return 0.25 + 0.75 * (1 - rho * rho);
  }

  // ---- Threads -------------------------------------------------------------
  const pos = [], wts = [], col = [];
  const LIGHT_ANG = 0.95;       // in-plane direction that "catches" the garage light
  function seg(a, b, wa, wb, bright = 1) {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const glint = Math.pow(Math.abs(Math.cos(ang - LIGHT_ANG)), 8);
    const k = (0.22 + 0.85 * glint * (0.6 + 0.4 * R())) * bright;
    pos.push(a[0], a[1], a[2] ?? 0, b[0], b[1], b[2] ?? 0);
    wts.push(wa, wb);
    for (let i = 0; i < 2; i++) col.push(0.86 * k, 0.9 * k, k);
  }
  // Polyline with gravity sag (sags in -v, proportional to horizontal span).
  function sagLine(a, b, wa, wb, n, sagAmt, bright) {
    let prev = a, pw = wa;
    for (let i = 1; i <= n; i++) {
      const s = i / n;
      const span = Math.abs(b[0] - a[0]) + Math.abs((b[2] ?? 0) - (a[2] ?? 0));
      const p = [
        a[0] + (b[0] - a[0]) * s,
        a[1] + (b[1] - a[1]) * s - Math.sin(Math.PI * s) * sagAmt * span,
        (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * s,
      ];
      const w = wa + (wb - wa) * s;
      seg(prev, p, pw, w, bright);
      prev = p; pw = w;
    }
  }

  // Frame (bridge) threads: brighter, doubled for thickness.
  const frameW = 0.25;
  for (let i = 0; i < frame.length; i++) {
    const a = frame[i], b = frame[(i + 1) % frame.length];
    sagLine(a, b, frameW, frameW, 6, 0.012, 1.25);
    sagLine([a[0], a[1] - 0.0015, 0.001], [b[0], b[1] - 0.0015, 0.001], frameW, frameW, 6, 0.012, 0.9);
  }
  // Mooring threads to walls and ceiling, splitting into a "Y" near the anchor.
  for (const [fi, anc] of moorings) {
    const f = frame[fi];
    const mid = [f[0] + (anc[0] - f[0]) * 0.72, f[1] + (anc[1] - f[1]) * 0.72, anc[2] * 0.72];
    sagLine([f[0], f[1], 0], mid, frameW, 0.07, 5, 0.01, 1.3);
    const spread = 0.05 + R() * 0.04;
    const isCeil = Math.abs(anc[1] - CEIL) < 1e-6;
    for (const sgn of [-1, 1]) {
      let end;
      if (isCeil) end = [anc[0] + sgn * spread, anc[1], anc[2]];
      else {
        const v = anc[1] + sgn * spread;
        end = anc[0] > 0 ? onRight(v, anc[2]) : onBack(v, anc[2]);
      }
      seg(mid, end, 0.07, 0, 1.1);
    }
  }

  // Radials.
  const NR = low ? 26 : 32;
  const radAng = [];
  for (let i = 0; i < NR; i++) radAng.push((i / NR) * Math.PI * 2 + jit(0.3 * Math.PI * 2 / NR));
  radAng.sort((a, b) => a - b);
  const radR = radAng.map(frameR);
  radAng.forEach((th, i) => {
    const c = Math.cos(th), s = Math.sin(th), fr = radR[i];
    sagLine([c * 0.012, s * 0.012, 0], [c * fr, s * fr, 0], 1, 0.25, 6, 0.006, 1);
  });

  // Capture spiral: inward-wound, irregular spacing, occasional broken segments.
  const TURNS = low ? 18 : 24, F0 = 0.17, F1 = 0.94;
  const spiral = [];                 // [u, v] points, for snapping nodes and drops
  const spiralSegs = [];             // [a, b] pairs for dew drops
  let prev = null;
  for (let j = 0; j <= NR * TURNS; j++) {
    const i = j % NR, turn = Math.floor(j / NR);
    const phi = turn + i / NR;
    const f = F0 + (F1 - F0) * Math.pow(phi / TURNS, 0.92) + jit(0.006);
    const th = radAng[i];
    const p = [Math.cos(th) * f * radR[i], Math.sin(th) * f * radR[i], 0];
    spiral.push(p);
    if (prev && R() > 0.025) {
      const wa = weightAt(prev[0], prev[1]), wb = weightAt(p[0], p[1]);
      const m = [(prev[0] + p[0]) / 2, (prev[1] + p[1]) / 2 - 0.0012 - R() * 0.002, 0];
      seg(prev, m, wa, weightAt(m[0], m[1]));
      seg(m, p, weightAt(m[0], m[1]), wb);
      spiralSegs.push([prev, m], [m, p]);
    }
    prev = p;
  }
  // Hub: a tight, messy meshwork.
  let hp = null;
  for (let j = 0; j < 5 * 11; j++) {
    const th = (j / 11) * Math.PI * 2 + jit(0.15);
    const r = 0.018 + (j / 55) * 0.045 + jit(0.004);
    const p = [Math.cos(th) * r, Math.sin(th) * r, 0];
    if (hp) seg(hp, p, 1, 1, 0.8);
    hp = p;
  }

  const base = new Float32Array(pos);
  const threadGeo = new THREE.BufferGeometry();
  threadGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  threadGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  threadGeo.getAttribute('position').setUsage(THREE.DynamicDrawUsage);
  const threadMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const threads = new THREE.LineSegments(threadGeo, threadMat);
  threads.frustumCulled = false;
  threads.raycast = () => {};
  threads.renderOrder = 2;
  root.add(threads);
  const weights = new Float32Array(wts);

  // Displacement of the web at local (u, v) with sway weight w, time t.
  const sway = (u, v, w, t) => w * (
    0.011 * Math.sin(t * 0.9 + u * 1.3) +
    0.004 * Math.sin(t * 2.3 + v * 2.1 + 1.7)
  );

  // ---- Dew drops (instanced, twinkling) -----------------------------------
  const NDROP = low ? 260 : 720;
  const dropGeo = new THREE.SphereGeometry(1, low ? 8 : 12, low ? 6 : 10);
  const dropMat = new THREE.MeshPhysicalMaterial({
    color: 0x3a4a58, roughness: 0.03, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02,
    emissive: 0xd8ecff, emissiveIntensity: 0.22, envMapIntensity: 2.2, ior: 1.33,
  });
  dropMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance *= vColor;\n#endif',
    );
  };
  const drops = new THREE.InstancedMesh(dropGeo, dropMat, NDROP);
  drops.raycast = () => {};
  const dropBase = new Float32Array(NDROP * 3), dropW = new Float32Array(NDROP);
  const dropPhase = new Float32Array(NDROP), dropSpeed = new Float32Array(NDROP);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
  const C = new THREE.Color();
  for (let i = 0; i < NDROP; i++) {
    const [a, b] = spiralSegs[Math.floor(R() * spiralSegs.length)];
    const s = R();
    const big = R() < 0.08;
    const r = big ? 0.0035 + R() * 0.0025 : 0.0012 + R() * R() * 0.0028;
    const u = a[0] + (b[0] - a[0]) * s, v = a[1] + (b[1] - a[1]) * s - r * 0.8;
    dropBase.set([u, v, 0], i * 3);
    dropW[i] = weightAt(u, v);
    dropPhase[i] = R() * 100; dropSpeed[i] = 0.4 + R() * 1.4;
    S.set(r, r * 1.12, r);          // drops pull slightly into a teardrop under gravity
    M.compose(P.set(u, v, 0), Q, S);
    drops.setMatrixAt(i, M);
    drops.setColorAt(i, C.setScalar(1));
  }
  drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  drops.instanceColor.setUsage(THREE.DynamicDrawUsage);
  root.add(drops);

  // ---- Glow textures -------------------------------------------------------
  const haloTex = tex.canvasTexture(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.12, 'rgba(255,255,255,0.55)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.14)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, { wrap: false });

  function nearestSpiral(u, v) {
    let best = spiral[0], bd = Infinity;
    for (const p of spiral) {
      const d = (p[0] - u) ** 2 + (p[1] - v) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  const polar = (deg, frac) => {
    const th = (deg * Math.PI) / 180;
    const fr = frameR(th) * frac;
    return nearestSpiral(Math.cos(th) * fr, Math.sin(th) * fr);
  };

  const movers = [];            // { obj, u, v, z, w } follow the web sway
  const pulses = [];            // glow sprites that breathe
  function makeNode({ u, v, radius, color, glow, haloSize, hitR }) {
    const g = new THREE.Group();
    const y = v - radius * 0.9;   // hangs just under the thread
    g.position.set(u, y, 0);
    const mat = new THREE.MeshPhysicalMaterial({
      color, emissive: color, emissiveIntensity: glow, roughness: 0.04,
      clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2, transparent: true, opacity: 0.96,
    });
    const drop = new THREE.Mesh(new THREE.SphereGeometry(radius, 28, 20), mat);
    drop.scale.set(1, 1.1, 1);
    g.add(drop);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.45, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }),
    );
    core.position.set(-radius * 0.25, radius * 0.3, radius * 0.55);   // specular pip
    core.scale.set(0.6, 0.45, 0.2);
    g.add(core);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTex, color, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    halo.scale.setScalar(haloSize);
    halo.raycast = () => {};
    g.add(halo);
    if (hitR) {
      const hit = new THREE.Mesh(new THREE.SphereGeometry(hitR, 12, 8), new THREE.MeshBasicMaterial());
      hit.material.visible = false;
      g.add(hit);
    }
    root.add(g);
    movers.push({ obj: g, u, v: y, z: 0, w: weightAt(u, y) });
    pulses.push({ halo, mat, base: haloSize, glow, ph: R() * 10 });
    return g;
  }

  function makeLabel(text, u, v) {
    const { texture, aspect } = tex.label(text, {
      font: '600 58px "Inter", "Helvetica Neue", Arial, sans-serif',
      color: '#efe6d2', height: 92, pad: 14,
    });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture, transparent: true, opacity: 0.72, depthWrite: false,
    }));
    const h = 0.03;
    sp.scale.set(h * aspect, h, 1);
    sp.center.set(0, 0.5);
    sp.position.set(u + 0.022, v - 0.004, 0.012);
    sp.raycast = () => {};
    sp.renderOrder = 3;
    root.add(sp);
    movers.push({ obj: sp, u: sp.position.x, v: sp.position.y, z: sp.position.z, w: weightAt(u, v) });
  }

  // ---- Hotspot nodes -------------------------------------------------------
  const AMBER = new THREE.Color(0xffae42);
  const mainNodes = [
    { id: 'hot-net-learn', item: 'net-learn', label: 'Learn about the network', at: polar(152, 0.56) },
    { id: 'hot-net-join', item: 'net-join', label: 'Join the network', at: polar(32, 0.6) },
    { id: 'hot-net-partner', item: 'net-partner', label: 'Become a partner', at: polar(-78, 0.58) },
  ];
  const anchors = {};
  for (const n of mainNodes) {
    const [u, v] = n.at;
    const g = makeNode({ u, v, radius: 0.034, color: AMBER, glow: 2.4, haloSize: 0.3, hitR: 0.085 });
    g.name = n.id;
    const wp = toWorld(u, v - 0.03, 0);
    anchors[n.item] = wp.toArray().map((x) => +x.toFixed(3));
    hotspot(g, {
      id: n.id,
      anchor: anchors[n.item],
      views: { network: { item: n.item, label: n.label } },
    });
  }

  // Decorative member nodes with small trade labels.
  const members = [
    ['Roofing', 96, 0.72], ['HVAC', 64, 0.36], ['Electrical', 4, 0.82], ['Plumbing', -34, 0.66],
    ['Painting', -124, 0.74], ['Real estate', -150, 0.4], ['Pest control', -172, 0.86], ['Pool care', 120, 0.42],
  ];
  const MEMBER = new THREE.Color(0xffe2b0);
  for (const [name, deg, frac] of members) {
    const [u, v] = polar(deg, frac);
    makeNode({ u, v, radius: 0.015, color: MEMBER, glow: 0.9, haloSize: 0.1 });
    makeLabel(name, u, v - 0.014);
  }

  // ---- The spider ----------------------------------------------------------
  const spider = new THREE.Group();
  spider.name = 'spider';
  spider.position.set(0, 0.004, 0.007);
  root.add(spider);

  const abdomenTex = tex.canvasTexture(512, 256, (g, w, h) => {
    // Sphere UV: u=0.25 faces local +z (dorsal). Draw the folium around there.
    g.fillStyle = '#2a1a10'; g.fillRect(0, 0, w, h);
    tex.blotches(g, w, h, { count: 60, min: 6, max: 40, color: '90,55,25', alpha: 0.25, seed: 11 });
    const cx = w * 0.25, cy = h * 0.5;
    // Leaf-shaped folium
    g.fillStyle = 'rgba(120,70,30,0.9)';
    g.beginPath();
    g.moveTo(cx, cy - h * 0.42);
    g.bezierCurveTo(cx + w * 0.09, cy - h * 0.25, cx + w * 0.08, cy + h * 0.25, cx, cy + h * 0.44);
    g.bezierCurveTo(cx - w * 0.08, cy + h * 0.25, cx - w * 0.09, cy - h * 0.25, cx, cy - h * 0.42);
    g.fill();
    // Amber cross marking (Araneus-style)
    g.fillStyle = '#e8a33a';
    g.shadowColor = 'rgba(255,190,90,0.8)'; g.shadowBlur = 6;
    const dot = (x, y, r) => { g.beginPath(); g.ellipse(x, y, r, r * 1.4, 0, 0, Math.PI * 2); g.fill(); };
    for (let i = 0; i < 5; i++) dot(cx, cy - h * 0.2 + i * h * 0.075, 5 - i * 0.4);
    dot(cx - w * 0.028, cy - h * 0.05, 4); dot(cx + w * 0.028, cy - h * 0.05, 4);
    g.shadowBlur = 0;
    // Scalloped side chevrons
    g.strokeStyle = 'rgba(232,163,58,0.55)'; g.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      const y = cy + h * (0.1 + i * 0.07);
      g.beginPath(); g.moveTo(cx - w * (0.055 - i * 0.008), y); g.lineTo(cx, y + h * 0.04); g.lineTo(cx + w * (0.055 - i * 0.008), y); g.stroke();
    }
    tex.grain(g, w, h, { amount: 0.25, seed: 5 });
  }, { wrap: true });

  const chitin = new THREE.MeshPhysicalMaterial({ color: 0x3a2414, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.3 });
  const legMat = new THREE.MeshPhysicalMaterial({ color: 0x4a2e18, roughness: 0.55, clearcoat: 0.4, clearcoatRoughness: 0.4 });
  const bandMat = new THREE.MeshPhysicalMaterial({ color: 0xa8702e, roughness: 0.5, clearcoat: 0.4 });
  const abdMat = new THREE.MeshPhysicalMaterial({
    map: abdomenTex, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.4, sheenColor: 0x6a4a2a,
  });
  const seg1 = low ? 6 : 10;

  const ceph = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 20, 14), chitin);
  ceph.scale.set(0.95, 1.2, 0.62);
  ceph.position.set(0, -0.012, 0.004);
  spider.add(ceph);
  const abd = new THREE.Mesh(new THREE.SphereGeometry(0.017, 32, 22), abdMat);
  abd.scale.set(0.95, 1.18, 0.82);
  abd.position.set(0, 0.016, 0.009);
  abd.rotation.x = -0.12;
  spider.add(abd);
  // Shoulder humps typical of orb-weavers
  for (const s of [-1, 1]) {
    const hump = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 12, 10), abdMat);
    hump.position.set(s * 0.009, 0.006, 0.017);
    spider.add(hump);
  }
  const pedicel = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0026, 0.006, 8), chitin);
  pedicel.position.set(0, -0.002, 0.005);
  spider.add(pedicel);
  // Eyes and chelicerae
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.05, clearcoat: 1 });
  for (const [x, y, r] of [[-0.0022, -0.0205, 0.0011], [0.0022, -0.0205, 0.0011], [-0.004, -0.0188, 0.0008], [0.004, -0.0188, 0.0008]]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), eyeMat);
    e.position.set(x, y, 0.0085);
    spider.add(e);
  }
  for (const s of [-1, 1]) {
    const ch = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 10, 8), chitin);
    ch.scale.set(0.8, 1.4, 0.8);
    ch.position.set(s * 0.0018, -0.0225, 0.004);
    spider.add(ch);
  }

  function limbSeg(len, r0, r1, mat) {
    const g = new THREE.CylinderGeometry(r1, r0, len, seg1, 1);
    g.rotateZ(-Math.PI / 2);
    g.translate(len / 2, 0, 0);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = !low;
    return m;
  }
  // Leg: chain of joints. dir = in-plane angle; lengths are total leg length.
  const legs = [];
  function makeLeg(holder, dir, L, attachY, isPalp = false) {
    const baseG = new THREE.Group();
    baseG.position.set(0.004, attachY, 0.004);
    baseG.rotation.z = dir;
    holder.add(baseG);
    const parts = isPalp
      ? [[0.5, -0.5, 0.0011, 0.0009], [0.5, 0.7, 0.0009, 0.0007]]
      : [[0.3, -0.85, 0.0016, 0.0013], [0.1, 1.15, 0.0013, 0.0012], [0.25, 0.35, 0.0012, 0.0009], [0.35, 0.32, 0.0009, 0.0004]];
    let parent = baseG;
    const joints = [];
    parts.forEach(([f, bend, r0, r1], i) => {
      const j = new THREE.Group();
      j.rotation.y = bend;
      parent.add(j);
      const mesh = limbSeg(L * f, r0, r1, i === 1 || (i === 3 && !isPalp) ? bandMat : legMat);
      j.add(mesh);
      if (i < parts.length - 1) {
        const knob = new THREE.Mesh(new THREE.SphereGeometry(r1 * 1.25, 8, 6), bandMat);
        knob.position.x = L * f;
        j.add(knob);
      }
      const next = new THREE.Group();
      next.position.x = L * f;
      j.add(next);
      joints.push(j);
      parent = next;
    });
    legs.push({ joints, rest: joints.map((j) => j.rotation.y), twitch: 0, amp: 0, isPalp });
  }
  // Spider hangs head-down (head at -y). Angles measured from +x in the web plane.
  // Right-side legs are built once per side; the left side is a mirrored holder.
  const legDefs = [
    [-62, 0.066, -0.016], [-24, 0.06, -0.013], [22, 0.04, -0.01], [58, 0.052, -0.007],
  ];
  for (const side of [1, -1]) {
    const holder = new THREE.Group();
    holder.scale.x = side;
    spider.add(holder);
    for (const [deg, L, y] of legDefs) makeLeg(holder, (deg * Math.PI) / 180 + jit(0.06), L, y);
    makeLeg(holder, -1.3, 0.012, -0.02, true);
  }
  spider.traverse((o) => { if (o.isMesh) o.castShadow = !low; });

  // Spider hit area + hotspot
  const spiderHit = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial());
  spiderHit.material.visible = false;
  spiderHit.scale.set(1, 1, 0.5);
  spider.add(spiderHit);
  anchors['net-mission'] = toWorld(0, 0.08, 0.02).toArray().map((x) => +x.toFixed(3));
  hotspot(spider, {
    id: 'hot-net-mission',
    anchor: anchors['net-mission'],
    views: { network: { item: 'net-mission', label: 'Our mission' } },
  });
  movers.push({ obj: spider, u: 0, v: 0.004, z: 0.007, w: 1 });

  // Warm local glow so the spider and nodes read (short range, no shadows).
  const glow = new THREE.PointLight(0xffb45a, 0.35, 1.1, 2);
  glow.position.set(0.05, 0.05, 0.28);
  root.add(glow);

  // ---- Whole-web hotspot for the garage view -------------------------------
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  disc.material.visible = false;
  disc.scale.set(0.95, 0.68, 1);
  disc.position.set(0, 0.0, -0.05);
  disc.name = 'web-hit';
  root.add(disc);
  hotspot(disc, {
    id: 'hot-web',
    anchor: toWorld(0, 0.3, 0).toArray().map((x) => +x.toFixed(3)),
    views: { garage: { go: 'network', label: 'The Network' } },
  });

  // ---- Animation -----------------------------------------------------------
  const posAttr = threadGeo.getAttribute('position');
  const pa = posAttr.array;
  const ma = drops.instanceMatrix.array;
  const ca = drops.instanceColor.array;
  let nextTwitch = 1.2;
  onUpdate((dt, t) => {
    // Web sway (threads)
    for (let i = 0, n = weights.length; i < n; i++) {
      const u = base[i * 3], v = base[i * 3 + 1];
      pa[i * 3 + 2] = base[i * 3 + 2] + sway(u, v, weights[i], t);
      pa[i * 3 + 1] = v + weights[i] * 0.0015 * Math.sin(t * 1.1 + u);
    }
    posAttr.needsUpdate = true;
    // Drops follow + twinkle
    for (let i = 0; i < NDROP; i++) {
      const u = dropBase[i * 3], v = dropBase[i * 3 + 1];
      ma[i * 16 + 12] = u;
      ma[i * 16 + 13] = v + dropW[i] * 0.0015 * Math.sin(t * 1.1 + u);
      ma[i * 16 + 14] = sway(u, v, dropW[i], t);
      const s = Math.sin(t * dropSpeed[i] + dropPhase[i]);
      const k = 0.55 + Math.pow(Math.max(0, s), 60) * 7;
      ca[i * 3] = ca[i * 3 + 1] = ca[i * 3 + 2] = k;
    }
    drops.instanceMatrix.needsUpdate = true;
    drops.instanceColor.needsUpdate = true;
    for (const m of movers) {
      m.obj.position.set(m.u, m.v + m.w * 0.0015 * Math.sin(t * 1.1 + m.u), m.z + sway(m.u, m.v, m.w, t));
    }
    for (const p of pulses) {
      const k = 1 + 0.08 * Math.sin(t * 1.6 + p.ph);
      p.halo.scale.setScalar(p.base * k);
      p.mat.emissiveIntensity = p.glow * (0.92 + 0.08 * Math.sin(t * 1.6 + p.ph));
    }
    // Spider idle: occasional leg twitches, slight abdomen breathing.
    if (t > nextTwitch) {
      const leg = legs[Math.floor(R() * legs.length)];
      leg.twitch = t; leg.amp = (0.12 + R() * 0.2) * (R() < 0.5 ? -1 : 1);
      nextTwitch = t + 0.6 + R() * 2.4;
    }
    for (const leg of legs) {
      const e = t - leg.twitch;
      const k = e >= 0 && e < 0.45 ? Math.sin((e / 0.45) * Math.PI) : 0;
      leg.joints[0].rotation.y = leg.rest[0] + k * leg.amp * 0.6;
      leg.joints[1].rotation.y = leg.rest[1] + k * leg.amp;
      if (leg.isPalp) leg.joints[0].rotation.z = 0.15 * Math.sin(t * 3 + leg.rest[0]);
    }
    abd.scale.set(0.95, 1.18 + 0.01 * Math.sin(t * 1.3), 0.82);
  });

  ctx.api.network = { root, anchors, hub: HUB.toArray() };
}
