// ABOUT US: a deep walnut shadow-box on the back wall holding a miniature
// diorama of the founders (Joe & Pat), the Pristine work truck and a laptop
// running the learning portal, in front of a painted golden-hour street.
//
// Local frame: origin at the frame's center on the wall (x=-1.5, y=1.55, z=-7.2),
// +z points out of the wall into the garage.
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export function build(ctx) {
  const { THREE, add, hotspot, tex, quality } = ctx;
  const low = quality === 'low';
  const R = tex.rng(9151);
  const ORIGIN = new THREE.Vector3(-1.5, 1.55, -7.2);
  const W = 1.5, H = 1.05, D = 0.22;          // outer frame size and depth
  const MW = 0.075;                           // face moulding width
  const SW = 0.024;                           // box side-wall thickness
  const OW = W - 2 * MW, OH = H - 2 * MW;     // frame opening 1.35 x 0.90
  const MATW = 1.17, MATH = 0.72;             // mat window
  const G = -0.3;                             // diorama ground height (local y)
  const RB = (w, h, d, r, s = 3) => new RoundedBoxGeometry(w, h, d, low ? 2 : s, r);
  const Y = new THREE.Vector3(0, 1, 0);

  const root = new THREE.Group();
  root.name = 'about-shadowbox';
  root.position.copy(ORIGIN);
  add(root);
  const toWorld = (x, y, z) => [ORIGIN.x + x, ORIGIN.y + y, ORIGIN.z + z].map((v) => +v.toFixed(3));

  // The part of the shadow box that is not a diorama hotspot.
  const box = new THREE.Group();
  root.add(box);

  // ---- Wood --------------------------------------------------------------
  function drawWood(g, w, h, vertical) {
    if (vertical) { g.translate(w, 0); g.rotate(Math.PI / 2); [w, h] = [h, w]; }
    const r = tex.rng(vertical ? 77 : 78);
    g.fillStyle = '#4b2e1b'; g.fillRect(0, 0, w, h);
    // Growth rings as long wavy lines
    for (let i = 0; i < 520; i++) {
      const y0 = r() * h, amp = 2 + r() * 6, f = 0.002 + r() * 0.006, ph = r() * 6;
      const dark = r() < 0.6;
      g.strokeStyle = dark ? `rgba(30,15,6,${0.08 + r() * 0.22})` : `rgba(140,90,50,${0.05 + r() * 0.12})`;
      g.lineWidth = 0.6 + r() * 2.2;
      g.beginPath();
      for (let x = 0; x <= w; x += 16) {
        const y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph) * amp * 0.3;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    // Pores
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(20,10,4,${0.15 + r() * 0.3})`;
      g.fillRect(r() * w, r() * h, 2 + r() * 5, 1);
    }
    tex.blotches(g, w, h, { count: 30, min: 30, max: 160, color: '110,70,40', alpha: 0.08, seed: 12 });
  }
  const woodH = tex.canvasTexture(1024, 1024, (g, w, h) => drawWood(g, w, h, false));
  const woodV = tex.canvasTexture(1024, 1024, (g, w, h) => drawWood(g, w, h, true));
  const woodMatH = new THREE.MeshPhysicalMaterial({ map: woodH, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.35 });
  const woodMatV = new THREE.MeshPhysicalMaterial({ map: woodV, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.35 });
  const giltMat = new THREE.MeshStandardMaterial({ color: 0xa88550, metalness: 0.85, roughness: 0.38 });

  // Mitred side: a trapezoid of a rectangular ring, extruded along z with a rounded bevel.
  function mitredSide(side, ow, oh, width, depth, bevel) {
    const x0 = ow / 2, y0 = oh / 2, xi = x0 - width, yi = y0 - width;
    const s = new THREE.Shape();
    const pts = {
      top: [[-x0, y0], [x0, y0], [xi, yi], [-xi, yi]],
      bottom: [[-x0, -y0], [-xi, -yi], [xi, -yi], [x0, -y0]],
      left: [[-x0, -y0], [-x0, y0], [-xi, yi], [-xi, -yi]],
      right: [[x0, -y0], [xi, -yi], [xi, yi], [x0, y0]],
    }[side];
    s.moveTo(...pts[0]); for (let i = 1; i < 4; i++) s.lineTo(...pts[i]); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {
      depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
      bevelOffset: -bevel, bevelSegments: low ? 2 : 4, curveSegments: 1,
    });
    return g;
  }
  function ring(ow, oh, width, depth, bevel, z, matFor) {
    const grp = new THREE.Group();
    for (const side of ['top', 'bottom', 'left', 'right']) {
      const m = new THREE.Mesh(mitredSide(side, ow, oh, width, depth, bevel), matFor(side));
      m.position.z = z + bevel;
      m.castShadow = true; m.receiveShadow = true;
      grp.add(m);
    }
    return grp;
  }
  const woodFor = (side) => (side === 'top' || side === 'bottom' ? woodMatH : woodMatV);
  // Deep box walls, front moulding, a stepped back-band and a gilt slip at the sight edge.
  box.add(ring(W - 0.012, H - 0.012, SW, 0.18, 0.004, 0.0, woodFor));
  box.add(ring(W, H, MW, 0.018, 0.009, 0.184, woodFor));
  box.add(ring(W - 0.03, H - 0.03, MW - 0.012, 0.012, 0.004, 0.174, woodFor));
  box.add(ring(OW + 0.004, OH + 0.004, 0.011, 0.008, 0.002, 0.193, () => giltMat));
  // Backing board
  const back = new THREE.Mesh(RB(W - 0.02, H - 0.02, 0.006, 0.002), new THREE.MeshStandardMaterial({ color: 0x1b1714, roughness: 0.9 }));
  back.position.z = 0.003; back.receiveShadow = true;
  box.add(back);

  // ---- Mat ---------------------------------------------------------------
  const matShape = new THREE.Shape();
  const mw = W / 2 - SW, mh = H / 2 - SW;
  matShape.moveTo(-mw, -mh); matShape.lineTo(mw, -mh); matShape.lineTo(mw, mh); matShape.lineTo(-mw, mh); matShape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-MATW / 2, -MATH / 2); hole.lineTo(-MATW / 2, MATH / 2); hole.lineTo(MATW / 2, MATH / 2); hole.lineTo(MATW / 2, -MATH / 2); hole.closePath();
  matShape.holes.push(hole);
  const matTex = tex.canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#ece4d0'; g.fillRect(0, 0, w, h);
    tex.grain(g, w, h, { amount: 0.05, seed: 3 });
  }, { repeat: [3, 3] });
  const matGeo = new THREE.ExtrudeGeometry(matShape, {
    depth: 0.002, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.003, bevelOffset: 0, bevelSegments: 1, curveSegments: 1,
  });
  const mat = new THREE.Mesh(matGeo, [
    new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ color: 0xfbf8f1, roughness: 0.9 }),     // white bevel core
  ]);
  mat.position.z = 0.186;
  mat.receiveShadow = true;
  box.add(mat);

  // ---- Painted backdrop (curved cyclorama) -------------------------------
  const BD_Y0 = G - 0.02, BD_Y1 = H / 2 - SW;              // -0.32 .. 0.501
  const BD_H = BD_Y1 - BD_Y0, BD_W = W - 2 * SW - 0.004;
  const horizon = (BD_Y1 - (-0.1)) / BD_H;                  // canvas fraction of horizon line
  const backdropTex = tex.canvasTexture(2048, Math.round(2048 * BD_H / BD_W), (g, w, h) => paintBackdrop(g, w, h, horizon), { wrap: false });
  const bdGeo = new THREE.PlaneGeometry(BD_W, BD_H, low ? 24 : 48, 1);
  {
    const p = bdGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      p.setZ(i, 0.008 + 0.085 * Math.pow(Math.abs(x) / (BD_W / 2), 4));
    }
    bdGeo.computeVertexNormals();
  }
  const backdrop = new THREE.Mesh(bdGeo, new THREE.MeshStandardMaterial({
    map: backdropTex, emissiveMap: backdropTex, emissive: 0xffffff, emissiveIntensity: 0.42, roughness: 0.95,
  }));
  backdrop.position.y = (BD_Y0 + BD_Y1) / 2;
  backdrop.receiveShadow = true;
  box.add(backdrop);

  function paintBackdrop(g, w, h, hz) {
    const r = tex.rng(31);
    const HY = hz * h;
    // Sky
    const sky = g.createLinearGradient(0, 0, 0, HY);
    sky.addColorStop(0, '#2c4775'); sky.addColorStop(0.32, '#56699a'); sky.addColorStop(0.62, '#c78a7d');
    sky.addColorStop(0.86, '#f0b474'); sky.addColorStop(1, '#ffd89a');
    g.fillStyle = sky; g.fillRect(0, 0, w, HY + 4);
    // Sun glow low on the left
    const sx = w * 0.17, sy = HY - h * 0.07;
    let rg = g.createRadialGradient(sx, sy, 0, sx, sy, w * 0.42);
    rg.addColorStop(0, 'rgba(255,236,190,1)'); rg.addColorStop(0.06, 'rgba(255,214,140,0.85)');
    rg.addColorStop(0.3, 'rgba(255,170,90,0.28)'); rg.addColorStop(1, 'rgba(255,150,80,0)');
    g.fillStyle = rg; g.fillRect(0, 0, w, h);
    // Clouds lit from below
    for (let i = 0; i < 16; i++) {
      const cx = r() * w, cy = h * (0.08 + r() * 0.35), cw = w * (0.08 + r() * 0.16), ch = h * (0.012 + r() * 0.025);
      const cg = g.createRadialGradient(cx, cy, 0, cx, cy, cw);
      cg.addColorStop(0, `rgba(255,${190 + r() * 40},${150 + r() * 40},${0.25 + r() * 0.25})`);
      cg.addColorStop(1, 'rgba(255,200,160,0)');
      g.save(); g.translate(cx, cy); g.scale(1, ch / cw); g.translate(-cx, -cy);
      g.fillStyle = cg; g.beginPath(); g.arc(cx, cy, cw, 0, Math.PI * 2); g.fill(); g.restore();
    }
    // Distant tree line and rooftops on the horizon (hazy)
    for (let i = 0; i < 260; i++) {
      const x = r() * w, rr = h * (0.012 + r() * 0.03);
      g.fillStyle = `rgba(${100 + r() * 20},${86 + r() * 16},${78 + r() * 12},0.9)`;
      g.beginPath(); g.arc(x, HY - rr * 0.5 - r() * h * 0.015, rr, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 7; i++) {
      const x = r() * w, rw = w * (0.04 + r() * 0.04), rh = h * 0.035;
      g.fillStyle = '#5d4e4c';
      g.beginPath(); g.moveTo(x - rw / 2, HY); g.lineTo(x - rw / 2, HY - rh * 0.5); g.lineTo(x, HY - rh * 1.3); g.lineTo(x + rw / 2, HY - rh * 0.5); g.lineTo(x + rw / 2, HY); g.fill();
    }
    // Haze band over the horizon
    const hzg = g.createLinearGradient(0, HY - h * 0.1, 0, HY + h * 0.02);
    hzg.addColorStop(0, 'rgba(255,200,140,0)'); hzg.addColorStop(1, 'rgba(255,196,130,0.45)');
    g.fillStyle = hzg; g.fillRect(0, HY - h * 0.1, w, h * 0.12);
    // Lawn
    const lawn = g.createLinearGradient(0, HY, 0, h);
    lawn.addColorStop(0, '#8c8c48'); lawn.addColorStop(0.35, '#5f7436'); lawn.addColorStop(1, '#3f5a26');
    g.fillStyle = lawn; g.fillRect(0, HY, w, h - HY);
    tex.grain(g, w, h - HY, { amount: 0.08, seed: 9, count: 30000 });
    // Street + sidewalk far away
    g.fillStyle = '#6f6660'; g.fillRect(0, HY + h * 0.005, w, h * 0.018);
    g.fillStyle = '#b4a592'; g.fillRect(0, HY + h * 0.024, w, h * 0.008);

    // Main house (two-story colonial) behind the truck
    const hx0 = w * 0.4, hx1 = w * 0.8, hb = HY + h * 0.06, hwall = h * 0.3;
    const top = hb - hwall;
    // Garage wing
    g.fillStyle = '#d5c7ad'; g.fillRect(w * 0.8, hb - hwall * 0.52, w * 0.13, hwall * 0.52);
    g.fillStyle = '#4b4a52';
    g.beginPath(); g.moveTo(w * 0.795, hb - hwall * 0.5); g.lineTo(w * 0.865, hb - hwall * 0.78); g.lineTo(w * 0.935, hb - hwall * 0.5); g.fill();
    g.fillStyle = '#efe6d3'; g.fillRect(w * 0.815, hb - hwall * 0.34, w * 0.1, hwall * 0.34);
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 2;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(w * 0.815, hb - hwall * 0.34 + i * hwall * 0.085); g.lineTo(w * 0.915, hb - hwall * 0.34 + i * hwall * 0.085); g.stroke(); }
    // Main body
    const wall = g.createLinearGradient(hx0, 0, hx1, 0);
    wall.addColorStop(0, '#f6dfb4'); wall.addColorStop(0.5, '#e7d4b4'); wall.addColorStop(1, '#bfae95');
    g.fillStyle = wall; g.fillRect(hx0, top, hx1 - hx0, hwall);
    g.strokeStyle = 'rgba(90,70,50,0.14)'; g.lineWidth = 1.5;
    for (let y = top + 6; y < hb; y += 9) { g.beginPath(); g.moveTo(hx0, y); g.lineTo(hx1, y); g.stroke(); }
    // Roof
    g.fillStyle = '#44434b';
    g.beginPath(); g.moveTo(hx0 - w * 0.015, top + 4); g.lineTo(hx0 + w * 0.05, top - h * 0.1); g.lineTo(hx1 - w * 0.05, top - h * 0.1); g.lineTo(hx1 + w * 0.015, top + 4); g.fill();
    g.fillStyle = 'rgba(255,190,120,0.18)';
    g.beginPath(); g.moveTo(hx0 - w * 0.015, top + 4); g.lineTo(hx0 + w * 0.05, top - h * 0.1); g.lineTo(hx0 + w * 0.2, top - h * 0.1); g.lineTo(hx0 + w * 0.18, top + 4); g.fill();
    // Chimney
    g.fillStyle = '#8a5a45'; g.fillRect(hx0 + w * 0.07, top - h * 0.15, w * 0.022, h * 0.08);
    // Windows with warm interior glow, navy shutters
    const win = (x, y, ww, wh, lit) => {
      g.fillStyle = '#1f2b44'; g.fillRect(x - ww * 0.45, y, ww * 0.35, wh); g.fillRect(x + ww * 1.1, y, ww * 0.35, wh);
      g.fillStyle = '#f7f1e6'; g.fillRect(x - 3, y - 3, ww + 6, wh + 6);
      const wg = g.createLinearGradient(0, y, 0, y + wh);
      wg.addColorStop(0, lit ? '#ffd58a' : '#7c8aa0'); wg.addColorStop(1, lit ? '#e89a4a' : '#3c465a');
      g.fillStyle = wg; g.fillRect(x, y, ww, wh);
      g.strokeStyle = '#f7f1e6'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x + ww / 2, y); g.lineTo(x + ww / 2, y + wh); g.moveTo(x, y + wh / 2); g.lineTo(x + ww, y + wh / 2); g.stroke();
    };
    const ww = w * 0.035, wh = h * 0.075;
    for (const [fx, row, lit] of [[0.08, 0, true], [0.3, 0, false], [0.62, 0, true], [0.84, 0, false], [0.08, 1, false], [0.84, 1, true]]) {
      win(hx0 + (hx1 - hx0) * fx, row === 0 ? top + hwall * 0.12 : top + hwall * 0.58, ww, wh, lit);
    }
    // Front door with portico
    const dx = hx0 + (hx1 - hx0) * 0.47;
    g.fillStyle = '#f5efe3'; g.fillRect(dx - w * 0.03, top + hwall * 0.5, w * 0.06, hwall * 0.5);
    g.fillStyle = '#23324f'; g.fillRect(dx - w * 0.016, top + hwall * 0.6, w * 0.032, hwall * 0.4);
    g.fillStyle = '#ffcf80'; g.beginPath(); g.arc(dx, top + hwall * 0.56, w * 0.014, Math.PI, 0); g.fill();
    // Foundation shrubs and walkway
    for (let i = 0; i < 26; i++) {
      const x = hx0 + r() * (hx1 - hx0), rr = w * (0.008 + r() * 0.012);
      g.fillStyle = `rgb(${40 + r() * 20},${60 + r() * 25},${30 + r() * 10})`;
      g.beginPath(); g.arc(x, hb - rr * 0.4, rr, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#c9b89e';
    g.beginPath(); g.moveTo(dx - w * 0.012, hb); g.lineTo(dx + w * 0.012, hb); g.lineTo(dx + w * 0.05, h); g.lineTo(dx - w * 0.04, h); g.fill();

    // Big backlit trees (left tree catches the sun at its rim)
    const tree = (cx, base, tw, th, seed, rim) => {
      const t = tex.rng(seed);
      g.fillStyle = '#3a2a20'; g.fillRect(cx - tw * 0.03, base - th * 0.45, tw * 0.06, th * 0.45);
      g.strokeStyle = '#3a2a20'; g.lineWidth = tw * 0.02;
      for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(cx, base - th * 0.4); g.lineTo(cx + (t() - 0.5) * tw * 0.7, base - th * (0.55 + t() * 0.3)); g.stroke(); }
      for (let i = 0; i < 700; i++) {
        const a = t() * Math.PI * 2, d = Math.pow(t(), 0.6);
        const lobe = 1 + 0.18 * Math.sin(a * 5 + seed);
        const x = cx + Math.cos(a) * d * tw * 0.5 * lobe, y = base - th * 0.62 + Math.sin(a) * d * th * 0.36 * lobe;
        const rr = tw * (0.012 + t() * 0.03);
        const shade = 28 + t() * 34 + (Math.sin(a) < 0 ? 12 : -6);
        g.fillStyle = `rgb(${shade + 10},${shade + 30},${shade * 0.5 + 10})`;
        g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
        if (rim && Math.cos(a) < -0.2 && d > 0.6) {
          g.fillStyle = 'rgba(255,196,110,0.45)';
          g.beginPath(); g.arc(x - rr * 0.3, y, rr * 0.6, 0, Math.PI * 2); g.fill();
        }
      }
    };
    tree(w * 0.1, HY + h * 0.08, w * 0.24, h * 0.75, 5, true);
    tree(w * 0.95, HY + h * 0.07, w * 0.2, h * 0.7, 6, false);
    tree(w * 0.3, HY + h * 0.02, w * 0.1, h * 0.36, 7, true);
    // Long evening shadows across the lawn
    g.fillStyle = 'rgba(20,30,20,0.22)';
    g.beginPath(); g.moveTo(w * 0.1, HY + h * 0.08); g.lineTo(w * 0.55, HY + h * 0.14); g.lineTo(w * 0.6, HY + h * 0.2); g.lineTo(w * 0.08, HY + h * 0.12); g.fill();
    // Warm grade + grain
    const warm = g.createLinearGradient(0, 0, w, 0);
    warm.addColorStop(0, 'rgba(255,170,80,0.14)'); warm.addColorStop(1, 'rgba(60,40,90,0.1)');
    g.fillStyle = warm; g.fillRect(0, 0, w, h);
    tex.grain(g, w, h, { amount: 0.06, seed: 21, count: 60000 });
  }

  // ---- Ground: raked driveway ------------------------------------------
  const GD = 0.186;                       // ground depth (z from 0.002 to 0.188)
  const groundY = (z) => (z < 0.12 ? G : G - Math.pow((z - 0.12) / (GD - 0.118), 2) * 0.075);
  const groundTex = tex.canvasTexture(1400, 180, (g, w, h) => {
    const r = tex.rng(44);
    // grass everywhere, concrete driveway in the middle
    g.fillStyle = '#4d6a2b'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 14000; i++) {
      g.fillStyle = `rgba(${60 + r() * 60},${90 + r() * 60},${30 + r() * 30},0.6)`;
      g.fillRect(r() * w, r() * h, 1, 2 + r() * 3);
    }
    const x0 = w * 0.3, x1 = w * 0.74;
    g.fillStyle = '#b9b2a6'; g.fillRect(x0, 0, x1 - x0, h);
    tex.grain(g, w, h, { amount: 0.12, seed: 4, count: 20000 });
    tex.blotches(g, w, h, { count: 10, min: 8, max: 30, color: '40,35,30', alpha: 0.15, seed: 8 });
    g.strokeStyle = 'rgba(60,55,50,0.5)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo((x0 + x1) / 2, 0); g.lineTo((x0 + x1) / 2, h); g.stroke();
    // edge soil line
    g.fillStyle = 'rgba(60,45,30,0.35)'; g.fillRect(x0 - 3, 0, 4, h); g.fillRect(x1 - 1, 0, 4, h);
  }, { wrap: false });
  const gGeo = new THREE.PlaneGeometry(W - 2 * SW - 0.002, GD, low ? 8 : 16, low ? 12 : 24);
  gGeo.rotateX(-Math.PI / 2);
  {
    const p = gGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i) + 0.002 + GD / 2;
      p.setZ(i, z); p.setY(i, groundY(z));
    }
    gGeo.computeVertexNormals();
  }
  const ground = new THREE.Mesh(gGeo, new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.92 }));
  ground.receiveShadow = true;
  box.add(ground);

  // ---- Miniature lights --------------------------------------------------
  // Golden "sun" raking from the upper left inside the box (short range, no shadows).
  const sun = new THREE.PointLight(0xffc27a, 0.5, 1.1, 2);
  sun.position.set(-0.52, 0.36, 0.16);
  root.add(sun);

  // ---- Shrubs, a small tree and a lamp post ------------------------------
  // Foliage: smooth lumpy blobs with a leafy speckle + bump so they read as leaves, not facets.
  const leafTex = tex.canvasTexture(512, 512, (g, w, h) => {
    const r = tex.rng(61);
    g.fillStyle = '#6a6a6a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5200; i++) {
      const v = 40 + r() * 200;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.save(); g.translate(r() * w, r() * h); g.rotate(r() * 6.3);
      g.beginPath(); g.ellipse(0, 0, 3 + r() * 5, 1.5 + r() * 2.5, 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
  }, { repeat: [2, 2] });
  const leafMats = [0x3d5a26, 0x4a6b2c, 0x56762f].map((c) => new THREE.MeshStandardMaterial({
    color: c, map: leafTex, bumpMap: leafTex, bumpScale: 1.5, roughness: 0.8,
  }));
  const blobGeo = (() => {
    let g0 = new THREE.IcosahedronGeometry(1, low ? 2 : 4);
    g0.deleteAttribute('normal'); g0.deleteAttribute('uv');
    g0 = mergeVertices(g0);
    const p = g0.attributes.position;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      const n = 1 + 0.12 * Math.sin(v.x * 7.1 + v.y * 3.3) * Math.sin(v.z * 6.7 - v.y * 5.2) + 0.06 * Math.sin(v.x * 17 + v.z * 13);
      v.multiplyScalar(n);
      p.setXYZ(i, v.x, v.y, v.z);
      uv[i * 2] = Math.atan2(v.z, v.x) / (Math.PI * 2) + 0.5; uv[i * 2 + 1] = v.y * 0.5 + 0.5;
    }
    g0.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g0.computeVertexNormals();
    return g0;
  })();
  function shrub(x, z, s) {
    const grp = new THREE.Group();
    const n = 5 + Math.floor(R() * 4);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(blobGeo, leafMats[i % 3]);
      const rr = s * (0.45 + R() * 0.35);
      m.scale.set(rr, rr * 0.8, rr);
      m.position.set((R() - 0.5) * s * 1.3, rr * 0.6 + R() * s * 0.3, (R() - 0.5) * s * 0.8);
      m.rotation.set(R() * 3, R() * 3, R() * 3);
      m.castShadow = !low; m.receiveShadow = true;
      grp.add(m);
    }
    grp.position.set(x, groundY(z), z);
    box.add(grp);
  }
  shrub(-0.6, 0.06, 0.05); shrub(-0.52, 0.15, 0.035); shrub(-0.65, 0.14, 0.04);
  shrub(0.58, 0.07, 0.045); shrub(0.64, 0.15, 0.04); shrub(0.5, 0.155, 0.03);
  // Ornamental tree (left, 1:13)
  {
    const t = new THREE.Group();
    const bark = new THREE.MeshStandardMaterial({ color: 0x4a3526, roughness: 0.9 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.005, 0.12, 8), bark);
    trunk.position.y = 0.06; trunk.castShadow = true; t.add(trunk);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x8a3a24, map: leafTex, bumpMap: leafTex, bumpScale: 1.5, roughness: 0.75 });   // Japanese maple red
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(blobGeo, i % 2 ? canopyMat : leafMats[1]);
      const rr = 0.028 + R() * 0.022;
      m.scale.set(rr, rr * 0.75, rr);
      m.position.set((R() - 0.5) * 0.08, 0.12 + R() * 0.06, (R() - 0.5) * 0.05);
      m.castShadow = true;
      t.add(m);
    }
    t.position.set(-0.47, G, 0.045);
    box.add(t);
  }
  // Lamp post (right) with a warm lantern: it's golden hour, the lamps just came on.
  {
    const lp = new THREE.Group();
    const iron = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.5, metalness: 0.6 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.003, 0.16, 8), iron);
    pole.position.y = 0.08; lp.add(pole);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.009, 4), iron);
    cap.position.y = 0.181; cap.rotation.y = Math.PI / 4; lp.add(cap);
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0055, 0.016, 4),
      new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb45a, emissiveIntensity: 3.0 }));
    lantern.position.y = 0.169; lantern.rotation.y = Math.PI / 4; lp.add(lantern);
    lp.position.set(0.47, G, 0.05);
    box.add(lp);
  }

  const shadowTex = tex.canvasTexture(256, 256, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(0,0,0,0.75)'); grd.addColorStop(0.5, 'rgba(0,0,0,0.4)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, { wrap: false });
  const contactShadow = (sx, sz, opacity = 0.8) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), new THREE.MeshBasicMaterial({
      map: shadowTex, transparent: true, depthWrite: false, opacity, polygonOffset: true, polygonOffsetFactor: -4,
    }));
    m.rotation.x = -Math.PI / 2;
    m.raycast = () => {};
    return m;
  };

  // =========================================================================
  // THE TRUCK: built in real meters (x forward), then scaled to ~1:13.
  // =========================================================================
  const truck = new THREE.Group();
  truck.name = 'pristine-truck';
  {
    const paint = new THREE.MeshPhysicalMaterial({ color: 0xf3f3f0, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 });
    const black = new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.7 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xdadada, metalness: 1, roughness: 0.18 });
    const alu = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, metalness: 0.9, roughness: 0.35 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0f161c, roughness: 0.04, metalness: 0.3, clearcoat: 1 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.85 });
    const HW = 1.0;                                // half width
    const AR = 0.47, WR = 0.4, XR = -1.85, XF = 1.9;
    const aA = Math.asin(0.13 / AR), adx = AR * Math.cos(aA);

    // Lower body profile with wheel arches
    const s = new THREE.Shape();
    s.moveTo(-2.95, 0.55);
    s.lineTo(XR - adx, 0.55); s.absarc(XR, 0.42, AR, Math.PI - aA, aA, true);
    s.lineTo(XF - adx, 0.55); s.absarc(XF, 0.42, AR, Math.PI - aA, aA, true);
    s.lineTo(2.88, 0.55); s.lineTo(2.97, 0.78); s.lineTo(2.97, 1.12); s.lineTo(2.86, 1.24);
    s.lineTo(1.62, 1.31); s.lineTo(-0.52, 1.31); s.lineTo(-0.52, 0.96); s.lineTo(-2.95, 0.96); s.closePath();
    const bev = 0.05;
    const bodyGeo = new THREE.ExtrudeGeometry(s, { depth: 2 * HW - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelOffset: -bev, bevelSegments: 3, curveSegments: low ? 6 : 14 });
    bodyGeo.translate(0, 0, -(HW - bev));
    const body = new THREE.Mesh(bodyGeo, paint); truck.add(body);

    // Cab greenhouse
    const c = new THREE.Shape();
    c.moveTo(-0.52, 1.28); c.lineTo(-0.45, 1.95); c.lineTo(0.92, 1.97); c.lineTo(1.62, 1.29); c.closePath();
    const cb = 0.07;
    const cabGeo = new THREE.ExtrudeGeometry(c, { depth: 1.84 - 2 * cb, bevelEnabled: true, bevelThickness: cb, bevelSize: cb, bevelOffset: -cb, bevelSegments: 3, curveSegments: 1 });
    cabGeo.translate(0, 0, -(0.92 - cb));
    truck.add(new THREE.Mesh(cabGeo, paint));
    // Side windows (front & rear door) on +z; mirrored on -z
    const winShape = (pts) => { const sh = new THREE.Shape(); sh.moveTo(...pts[0]); pts.slice(1).forEach((p) => sh.lineTo(...p)); sh.closePath(); return new THREE.ShapeGeometry(sh); };
    for (const zs of [1, -1]) {
      for (const pts of [
        [[-0.4, 1.37], [-0.36, 1.87], [0.46, 1.88], [0.46, 1.37]],
        [[0.56, 1.37], [0.56, 1.88], [0.88, 1.89], [1.44, 1.37]],
      ]) {
        const m = new THREE.Mesh(winShape(pts), glass);
        m.position.z = zs * 0.922;
        if (zs < 0) m.rotation.y = Math.PI, m.scale.x = -1;
        truck.add(m);
      }
    }
    // Windshield & rear glass on the slanted faces
    {
      const a = new THREE.Vector3(1.62, 1.29, 0), b = new THREE.Vector3(0.92, 1.97, 0);
      const dir = b.clone().sub(a); const slen = dir.length(); dir.normalize();
      const n = new THREE.Vector3(dir.y, -dir.x, 0);
      const ws = new THREE.Mesh(new THREE.PlaneGeometry(1.6, slen * 0.86), glass);
      ws.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), dir, n));
      ws.position.copy(a).add(b).multiplyScalar(0.5).addScaledVector(n, 0.004);
      truck.add(ws);
      const rw = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.42), glass);
      rw.position.set(-0.492, 1.66, 0); rw.rotation.y = -Math.PI / 2;
      truck.add(rw);
    }
    // Bed walls, bed floor liner, bulkhead
    const bedS = new THREE.Shape();
    bedS.moveTo(-2.95, 0.9); bedS.lineTo(-0.52, 0.9); bedS.lineTo(-0.52, 1.31); bedS.lineTo(-2.95, 1.31); bedS.closePath();
    const bedGeo = new THREE.ExtrudeGeometry(bedS, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelOffset: -0.02, bevelSegments: 2, curveSegments: 1 });
    const bedL = new THREE.Mesh(bedGeo, paint); bedL.position.z = HW - 0.05; truck.add(bedL);
    const bedR = new THREE.Mesh(bedGeo, paint); bedR.position.z = -HW + 0.02; truck.add(bedR);
    const liner = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.02, 1.86), black); liner.position.set(-1.74, 0.97, 0); truck.add(liner);
    const bulk = new THREE.Mesh(RB(0.06, 0.36, 1.9, 0.02), paint); bulk.position.set(-0.55, 1.13, 0); truck.add(bulk);
    // Tailgate, dropped open
    const tg = new THREE.Mesh(RB(0.55, 0.06, 1.86, 0.02), paint); tg.position.set(-3.22, 0.93, 0); truck.add(tg);
    const tgIn = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.004, 1.76), black); tgIn.position.set(-3.22, 0.962, 0); truck.add(tgIn);
    for (const zs of [1, -1]) {    // tailgate cables
      const cab = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.6, 5), chrome);
      cab.position.set(-3.2, 1.12, zs * 0.9); cab.rotation.z = 0.95; truck.add(cab);
    }
    // Taillights on bed-wall ends
    const tail = new THREE.MeshStandardMaterial({ color: 0x8a0f10, emissive: 0x5a0000, emissiveIntensity: 0.6, roughness: 0.2 });
    for (const zs of [1, -1]) { const t = new THREE.Mesh(RB(0.04, 0.3, 0.14, 0.012), tail); t.position.set(-2.96, 1.12, zs * 0.9); truck.add(t); }
    // Rear bumper, front bumper, grille, headlights
    const rb = new THREE.Mesh(RB(0.22, 0.2, 2.0, 0.04), chrome); rb.position.set(-3.0, 0.6, 0); truck.add(rb);
    const fb = new THREE.Mesh(RB(0.2, 0.26, 2.02, 0.05), chrome); fb.position.set(2.98, 0.66, 0); truck.add(fb);
    const grille = new THREE.Mesh(RB(0.06, 0.4, 1.36, 0.03), black); grille.position.set(2.975, 1.0, 0); truck.add(grille);
    for (const y of [0.9, 1.0, 1.1]) { const b = new THREE.Mesh(RB(0.02, 0.03, 1.36, 0.01), chrome); b.position.set(3.005, y, 0); truck.add(b); }
    const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 1.2, roughness: 0.1 });
    for (const zs of [1, -1]) { const hl = new THREE.Mesh(RB(0.05, 0.16, 0.3, 0.02), lamp); hl.position.set(2.96, 1.08, zs * 0.81); truck.add(hl); }
    // Mirrors
    for (const zs of [1, -1]) {
      const arm = new THREE.Mesh(RB(0.08, 0.05, 0.18, 0.015), black); arm.position.set(1.42, 1.42, zs * 1.0); truck.add(arm);
      const mir = new THREE.Mesh(RB(0.1, 0.26, 0.2, 0.03), black); mir.position.set(1.42, 1.5, zs * 1.13); truck.add(mir);
    }
    // Wheel-well liners
    for (const xw of [XR, XF]) for (const zs of [1, -1]) {
      const wl = new THREE.Mesh(new THREE.CylinderGeometry(AR - 0.02, AR - 0.02, 0.5, 16, 1, true, -Math.PI / 2, Math.PI), black);
      wl.material = black; wl.rotation.x = Math.PI / 2; wl.rotation.y = 0; wl.position.set(xw, 0.42, zs * 0.72);
      wl.material.side = THREE.DoubleSide;
      truck.add(wl);
    }
    // Wheels
    const tirePts = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI;
      tirePts.push(new THREE.Vector2(0.3 + Math.sin(a) * 0.1 + 0.0, -Math.cos(a) * 0.14));
    }
    const tireGeo = new THREE.LatheGeometry(tirePts, low ? 16 : 28);
    tireGeo.rotateX(Math.PI / 2);
    const rimTex = tex.canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#9ea2a6'; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#2a2c2e';
      for (let i = 0; i < 6; i++) {
        g.save(); g.translate(128, 128); g.rotate((i / 6) * Math.PI * 2);
        g.beginPath(); g.moveTo(22, -16); g.lineTo(104, -30); g.lineTo(104, 30); g.lineTo(22, 16); g.fill(); g.restore();
      }
      g.fillStyle = '#c9ccd0'; g.beginPath(); g.arc(128, 128, 22, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 6; i++) { g.fillStyle = '#555'; g.beginPath(); g.arc(128 + Math.cos(i) * 34, 128 + Math.sin(i) * 34, 4, 0, 7); g.fill(); }
    }, { wrap: false });
    const rimMat = new THREE.MeshStandardMaterial({ map: rimTex, metalness: 0.85, roughness: 0.3 });
    for (const xw of [XR, XF]) for (const zs of [1, -1]) {
      const wg = new THREE.Group();
      const tire = new THREE.Mesh(tireGeo, rubber); wg.add(tire);
      const rim = new THREE.Mesh(new THREE.CircleGeometry(0.29, 28), rimMat);
      rim.position.z = zs * 0.1; if (zs < 0) rim.rotation.y = Math.PI; wg.add(rim);
      wg.position.set(xw, WR, zs * 0.8);
      truck.add(wg);
    }
    // Running boards
    for (const zs of [1, -1]) { const rbd = new THREE.Mesh(RB(1.9, 0.05, 0.16, 0.02), black); rbd.position.set(0.5, 0.5, zs * 1.02); truck.add(rbd); }

    // Ladder rack (aluminum) with an extension ladder on top
    const tube = (x0, y0, z0, x1, y1, z1, r = 0.028, m = alu) => {
      const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
      const d = b.clone().sub(a);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), m);
      t.position.copy(a).add(b).multiplyScalar(0.5);
      t.quaternion.setFromUnitVectors(Y, d.normalize());
      truck.add(t);
    };
    const RY = 2.22, RZ = 0.9;
    for (const x of [-0.7, -2.82]) {
      for (const zs of [1, -1]) tube(x, 1.31, zs * RZ, x, RY, zs * RZ);
      tube(x, RY, -RZ, x, RY, RZ);
    }
    for (const zs of [1, -1]) {
      tube(-2.9, RY, zs * RZ, 1.25, RY, zs * RZ);
      tube(-0.7, 1.55, zs * RZ, 0.3, RY, zs * RZ, 0.022);
    }
    tube(1.25, RY, -RZ, 1.25, RY, RZ);
    const ladderMat = new THREE.MeshStandardMaterial({ color: 0xc8cbce, metalness: 0.8, roughness: 0.4 });
    for (const zs of [1, -1]) {
      const rail = new THREE.Mesh(RB(4.9, 0.1, 0.035, 0.01), ladderMat);
      rail.position.set(-0.85, RY + 0.08, zs * 0.22); truck.add(rail);
    }
    for (let x = -3.2; x <= 1.5; x += 0.3) tube(x, RY + 0.08, -0.22, x, RY + 0.08, 0.22, 0.016, ladderMat);

    // Door decal: blue PRISTINE lettering, stripe, door seams (transparent canvas)
    const DX0 = -2.95, DX1 = 2.97, DY0 = 0.55, DY1 = 1.31;
    const decalTex = tex.canvasTexture(2048, Math.round(2048 * (DY1 - DY0) / (DX1 - DX0)), (g, w, h) => {
      const px = (x) => ((x - DX0) / (DX1 - DX0)) * w, py = (y) => ((DY1 - y) / (DY1 - DY0)) * h;
      g.clearRect(0, 0, w, h);
      g.save();
      // Keep everything off the wheel arches.
      g.beginPath(); g.rect(0, 0, w, h);
      for (const xw of [XR, XF]) { g.moveTo(px(xw + AR + 0.02), py(0.42)); g.arc(px(xw), py(0.42), (AR + 0.02) / (DX1 - DX0) * w, 0, Math.PI * 2, true); }
      g.clip('evenodd');
      // Stripe
      g.fillStyle = '#1b56b8'; g.fillRect(px(-2.93), py(1.06), px(2.9) - px(-2.93), py(0.99) - py(1.06));
      g.fillStyle = '#0e2f6b'; g.fillRect(px(-2.93), py(0.965), px(2.9) - px(-2.93), py(0.95) - py(0.965));
      // Door seams
      g.strokeStyle = 'rgba(40,40,45,0.55)'; g.lineWidth = 3;
      g.beginPath();
      g.moveTo(px(-0.48), py(1.3)); g.lineTo(px(-0.48), py(0.6)); g.lineTo(px(1.42), py(0.6));
      g.moveTo(px(0.52), py(1.3)); g.lineTo(px(0.52), py(0.6));
      g.moveTo(px(1.5), py(1.3)); g.lineTo(px(1.5), py(0.86));
      g.stroke();
      // Handles
      g.fillStyle = '#2b2d30';
      for (const x of [0.28, 1.27]) g.fillRect(px(x), py(1.2), px(x + 0.16) - px(x), py(1.17) - py(1.2));
      // Lettering on the doors
      const cx = px(0.48);
      g.fillStyle = '#1b56b8';
      g.font = `italic 900 ${Math.round(py(0.62) - py(0.9))}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.fillText('PRISTINE', cx, py(0.72));
      g.fillStyle = '#0e2f6b';
      g.font = `700 ${Math.round(py(0.62) - py(0.69))}px "Helvetica Neue", Arial, sans-serif`;
      g.fillText('HOME SERVICES  ·  LAWN · SOLAR · JUNK', cx, py(0.625));
      g.restore();
    }, { wrap: false });
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(DX1 - DX0, DY1 - DY0),
      new THREE.MeshPhysicalMaterial({ map: decalTex, transparent: true, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, polygonOffset: true, polygonOffsetFactor: -2 }));
    decal.position.set((DX0 + DX1) / 2, (DY0 + DY1) / 2, HW + 0.002);
    truck.add(decal);

    truck.traverse((o) => { if (o.isMesh) { o.castShadow = !low; o.receiveShadow = true; } });
    const cs = contactShadow(6.6, 2.5, 0.85); cs.position.y = 0.01; truck.add(cs);
    for (const xw of [XR, XF]) for (const zs of [1, -1]) {
      const ws = contactShadow(0.9, 0.5, 0.9); ws.position.set(xw, 0.012, zs * 0.8); truck.add(ws);
    }
  }
  const TS = 1 / 13;
  truck.scale.set(TS, TS, TS * 0.85);
  truck.position.set(0.16, G, 0.098);
  truck.rotation.y = 0.07;
  root.add(truck);
  // Invisible hit volume so the truck is easy to click.
  {
    const hit = new THREE.Mesh(new THREE.BoxGeometry(6.4, 2.3, 2.1), new THREE.MeshBasicMaterial());
    hit.material.visible = false; hit.position.set(-0.1, 1.15, 0);
    truck.add(hit);
  }

  // ---- Laptop on the tailgate (1:10) ------------------------------------
  const laptop = new THREE.Group();
  laptop.name = 'laptop';
  {
    const LW = 0.034, LD = 0.023;
    const shell = new THREE.MeshStandardMaterial({ color: 0x9da1a6, metalness: 0.8, roughness: 0.35 });
    const base = new THREE.Mesh(RB(LW, 0.0018, LD, 0.0006, 2), shell);
    base.position.y = 0.0009; laptop.add(base);
    const keys = new THREE.Mesh(new THREE.PlaneGeometry(LW * 0.86, LD * 0.45), new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.7 }));
    keys.rotation.x = -Math.PI / 2; keys.position.set(0, 0.00185, -LD * 0.12); laptop.add(keys);
    const screenTex = tex.canvasTexture(640, 400, (g, w, h) => {
      const bg = g.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#0f2346'); bg.addColorStop(1, '#16335f');
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.fillStyle = '#0a1830'; g.fillRect(0, 0, w, 70);
      g.fillStyle = '#f4a62a'; g.beginPath(); g.arc(40, 35, 16, 0, 7); g.fill();
      g.fillStyle = '#ffffff'; g.font = '700 30px "Helvetica Neue", Arial, sans-serif'; g.textBaseline = 'middle';
      g.fillText('Pristine Learning Portal', 70, 36);
      g.fillStyle = '#9fb6d8'; g.font = '500 20px "Helvetica Neue", Arial, sans-serif';
      g.fillText('E-books  ·  Courses  ·  Partner resources', 26, 98);
      const covers = [['#f4a62a', 'Lawn', 'Care 101'], ['#2e8b57', 'Solar', 'Basics'], ['#c0392b', 'Start a', 'Business'], ['#4a78c2', 'Home', 'Upkeep']];
      covers.forEach(([c, a, b], i) => {
        const x = 26 + i * 150, y = 130;
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + 6, y + 6, 124, 170);
        g.fillStyle = c; g.fillRect(x, y, 124, 170);
        g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x, y, 10, 170);
        g.fillStyle = '#fff'; g.font = '800 24px "Helvetica Neue", Arial, sans-serif';
        g.fillText(a, x + 20, y + 40); g.fillText(b, x + 20, y + 70);
        g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(x + 20, y + 140, 84, 6);
      });
      g.fillStyle = '#23426f'; g.fillRect(26, 330, w - 52, 14);
      g.fillStyle = '#f4a62a'; g.fillRect(26, 330, (w - 52) * 0.62, 14);
      g.fillStyle = '#cfe0f5'; g.font = '500 18px "Helvetica Neue", Arial, sans-serif';
      g.fillText('Continue reading: 62% complete', 26, 368);
    }, { wrap: false });
    const lid = new THREE.Group();
    lid.position.set(0, 0.0018, -LD / 2);
    lid.rotation.x = -0.32;                  // opened to ~108 degrees
    const lidShell = new THREE.Mesh(RB(LW, LD * 0.95, 0.0012, 0.0005, 2), shell);
    lidShell.position.set(0, LD * 0.475, -0.0006); lid.add(lidShell);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(LW * 0.9, LD * 0.84),
      new THREE.MeshStandardMaterial({ map: screenTex, emissiveMap: screenTex, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.25 }));
    screen.position.set(0, LD * 0.49, 0.0001); lid.add(screen);
    laptop.add(lid);
    laptop.traverse((o) => { if (o.isMesh) o.castShadow = !low; });
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.05), new THREE.MeshBasicMaterial());
    hit.material.visible = false; hit.position.y = 0.015;
    laptop.add(hit);
  }
  // Place on the tailgate, near the viewer-side edge, angled toward the viewer.
  truck.updateMatrixWorld(true);
  root.updateMatrixWorld(true);
  {
    const p = truck.localToWorld(new THREE.Vector3(-3.18, 0.964, 0.28));
    root.worldToLocal(p);
    laptop.position.copy(p);
    laptop.rotation.y = truck.rotation.y + 0.45;
  }
  root.add(laptop);

  // =========================================================================
  // THE FOUNDERS: two ~1:9 figures, built in real meters and scaled.
  // =========================================================================
  function ik(S, T, a, b, hint) {
    const d = T.clone().sub(S);
    const L = Math.min(d.length(), a + b - 1e-4);
    const dir = d.normalize();
    const x = (a * a - b * b + L * L) / (2 * L);
    const h = Math.sqrt(Math.max(0, a * a - x * x));
    const perp = hint.clone().sub(dir.clone().multiplyScalar(hint.dot(dir))).normalize();
    const E = S.clone().addScaledVector(dir, x).addScaledVector(perp, h);
    return [E, S.clone().addScaledVector(dir, L)];
  }
  const capSeg = low ? 6 : 12;
  function limb(parent, a, b, r, m, r2) {
    const d = b.clone().sub(a);
    const len = d.length();
    const g = r2 ? new THREE.CylinderGeometry(r2, r, len, capSeg) : new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, capSeg);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(Y, d.normalize());
    mesh.castShadow = !low;
    parent.add(mesh);
    return mesh;
  }
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const polo = new THREE.MeshPhysicalMaterial({ color: 0x1b2946, roughness: 0.85, sheen: 0.6, sheenColor: 0x5a6f9a, sheenRoughness: 0.6 });
  const logoMat = new THREE.MeshStandardMaterial({ color: 0xf4a62a, roughness: 0.6 });

  function person({ skin, pants, shoes, hair, cap, height = 1.8 }) {
    const p = new THREE.Group();
    const k = height / 1.8;
    const skinM = new THREE.MeshPhysicalMaterial({ color: skin, roughness: 0.55, sheen: 0.3, sheenColor: 0xffc8a8 });
    const pantsM = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.9 });
    const shoeM = new THREE.MeshStandardMaterial({ color: shoes, roughness: 0.6 });
    const hairM = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.8 });
    const inner = new THREE.Group(); inner.scale.setScalar(k); p.add(inner);
    // Shoes & legs
    for (const sx of [-1, 1]) {
      const shoe = new THREE.Mesh(RB(0.115, 0.085, 0.29, 0.035), shoeM);
      shoe.position.set(sx * 0.1, 0.0375, 0.035); shoe.castShadow = !low; inner.add(shoe);
      limb(inner, V(sx * 0.1, 0.1, 0), V(sx * 0.1, 0.5, 0.005), 0.06, pantsM);
      limb(inner, V(sx * 0.1, 0.5, 0.005), V(sx * 0.105, 0.9, 0), 0.075, pantsM);
    }
    // Pelvis
    const pel = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14), pantsM);
    pel.scale.set(0.96, 0.6, 0.7); pel.position.y = 0.93; inner.add(pel);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.018, 6, 24), new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.5 }));
    belt.rotation.x = Math.PI / 2; belt.scale.set(1, 0.66, 1); belt.position.y = 0.955; inner.add(belt);
    // Torso (polo)
    const prof = [[0.001, 0.9], [0.16, 0.91], [0.17, 1.0], [0.172, 1.1], [0.19, 1.24], [0.205, 1.36], [0.2, 1.42], [0.14, 1.49], [0.065, 1.525], [0.001, 1.53]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const torso = new THREE.Mesh(new THREE.LatheGeometry(prof, low ? 12 : 24), polo);
    torso.scale.z = 0.62; torso.castShadow = !low; inner.add(torso);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.014, 6, 16), polo);
    collar.rotation.x = Math.PI / 2 - 0.2; collar.position.set(0, 1.52, 0.005); collar.scale.set(1, 0.8, 1); inner.add(collar);
    const logo = new THREE.Mesh(RB(0.055, 0.035, 0.006, 0.002, 1), logoMat);
    logo.position.set(0.085, 1.35, 0.118); logo.rotation.y = 0.25; inner.add(logo);
    // Neck & head
    limb(inner, V(0, 1.5, 0), V(0, 1.6, 0.005), 0.048, skinM, 0.045);
    const head = new THREE.Group(); head.position.set(0, 1.69, 0.01); inner.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 18), skinM);
    skull.scale.set(0.86, 1.1, 0.96); skull.castShadow = !low; head.add(skull);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), skinM); nose.position.set(0, -0.012, 0.094); nose.scale.set(0.8, 1.1, 0.9); head.add(nose);
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), skinM); ear.position.set(sx * 0.086, 0, -0.005); ear.scale.set(0.5, 1, 0.8); head.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.2 }));
      eye.position.set(sx * 0.033, 0.012, 0.087); head.add(eye);
      const brow = new THREE.Mesh(RB(0.032, 0.008, 0.01, 0.003, 1), hairM); brow.position.set(sx * 0.034, 0.034, 0.088); brow.rotation.z = -sx * 0.1; head.add(brow);
    }
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.104, 24, 12, 0, Math.PI * 2, 0, 1.35), hairM);
    hairCap.scale.set(0.9, 1.1, 1.0); hairCap.rotation.x = -0.35; hairCap.position.y = 0.004; head.add(hairCap);
    if (cap) {
      const capM = new THREE.MeshStandardMaterial({ color: 0x1b2946, roughness: 0.8 });
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.108, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), capM);
      crown.scale.set(0.92, 0.85, 1.0); crown.position.y = 0.035; crown.rotation.x = -0.12; head.add(crown);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.008, 20, 1, false, -Math.PI / 2, Math.PI), capM);
      brim.scale.set(1, 1, 1.2); brim.position.set(0, 0.04, 0.075); brim.rotation.x = 0.12; head.add(brim);
      const badge = new THREE.Mesh(new THREE.CircleGeometry(0.02, 16), logoMat);
      badge.position.set(0, 0.08, 0.1); badge.rotation.x = -0.45; head.add(badge);
    }
    p.userData = { inner, skinM, head };
    return p;
  }
  // Attach an arm from shoulder S to hand T with an elbow hint.
  function arm(personObj, S, T, hint) {
    const { inner, skinM } = personObj.userData;
    const [E, Tn] = ik(S, T, 0.3, 0.28, hint);
    const sleeveEnd = S.clone().lerp(E, 0.5);
    limb(inner, S, sleeveEnd, 0.062, polo);
    limb(inner, S, E, 0.048, skinM);
    limb(inner, E, Tn, 0.042, skinM);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), skinM);
    hand.scale.set(0.8, 1.15, 0.6); hand.position.copy(Tn); hand.castShadow = !low;
    inner.add(hand);
  }

  const founders = new THREE.Group();
  founders.name = 'founders';
  const joe = person({ skin: 0xe2b08c, pants: 0xb39a72, shoes: 0x5a3b22, hair: 0x5a3e28, cap: true, height: 1.83 });
  const pat = person({ skin: 0xc28c68, pants: 0x3d4656, shoes: 0x202226, hair: 0x2a1d14, cap: false, height: 1.79 });
  joe.position.set(-0.27, 0, 0); joe.rotation.y = 0.2;
  pat.position.set(0.27, 0, 0.04); pat.rotation.y = -0.22;
  founders.add(joe, pat);
  for (const [f, x, z] of [[joe, -0.27, 0], [pat, 0.27, 0.04]]) {
    const cs = contactShadow(0.7, 0.55, 0.7); cs.position.set(x, 0.005, z + 0.03); founders.add(cs);
  }
  // Joe: right arm around Pat's shoulders (hand resting on Pat's far shoulder), left hand in pocket.
  {
    const kJ = 1.83 / 1.8;
    const toJoe = (v) => joe.worldToLocal(founders.localToWorld(v.clone())).divideScalar(kJ);
    founders.updateMatrixWorld(true);
    const S = V(0.215, 1.43, 0);
    const T = toJoe(V(0.27 + 0.16, 1.47, -0.02));
    arm(joe, S, T, V(0, 0.4, -1));
    arm(joe, V(-0.215, 1.43, 0), V(-0.19, 0.92, 0.08), V(-1, 0, -0.4));
  }
  // Pat: left arm around Joe's back (hand shows at Joe's far hip), right hand a thumbs-up.
  {
    const kP = 1.79 / 1.8;
    const toPat = (v) => pat.worldToLocal(founders.localToWorld(v.clone())).divideScalar(kP);
    founders.updateMatrixWorld(true);
    arm(pat, V(-0.215, 1.43, 0), toPat(V(-0.27 - 0.2, 1.08, -0.05)), V(0, -0.2, -1));
    arm(pat, V(0.215, 1.43, 0), V(0.3, 1.22, 0.22), V(1, -0.6, -0.3));
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.03, 3, 6), pat.userData.skinM);
    thumb.position.set(0.3, 1.285, 0.22); pat.userData.inner.add(thumb);
  }
  const FS = 1 / 9;
  founders.scale.setScalar(FS);
  founders.position.set(-0.3, groundY(0.128), 0.128);
  founders.rotation.y = 0.12;
  root.add(founders);
  {
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.9, 0.6), new THREE.MeshBasicMaterial());
    hit.material.visible = false; hit.position.y = 0.95;
    founders.add(hit);
  }

  // ---- Glass ---------------------------------------------------------------
  const glareTex = tex.canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#303030'; g.fillRect(0, 0, w, h);
    g.save(); g.translate(w / 2, h / 2); g.rotate(-0.6);
    for (const [x, bw, a] of [[-140, 90, 0.55], [-20, 30, 0.4], [150, 140, 0.35]]) {
      const lg = g.createLinearGradient(x - bw, 0, x + bw, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, `rgba(255,255,255,${a})`); lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg; g.fillRect(x - bw, -h, bw * 2, h * 2);
    }
    g.restore();
  }, { wrap: false, srgb: false });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(OW + 0.01, OH + 0.01), new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.1, alphaMap: glareTex,
    envMapIntensity: 2.5, depthWrite: false, specularIntensity: 1,
  }));
  glass.position.z = 0.2;
  glass.renderOrder = 5;
  glass.raycast = () => {};
  box.add(glass);

  // ---- Brass nameplate -----------------------------------------------------
  {
    const PW = 0.44, PH = 0.058;
    const plateTex = tex.canvasTexture(1760, 232, (g, w, h) => {
      const bg = g.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, '#d8b46a'); bg.addColorStop(0.5, '#b8924c'); bg.addColorStop(1, '#caa35c');
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      const r = tex.rng(2);
      for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(255,240,200,${r() * 0.12})`; g.fillRect(r() * w, r() * h, 40 + r() * 200, 1); }
      g.strokeStyle = 'rgba(70,45,15,0.7)'; g.lineWidth = 5; g.strokeRect(18, 18, w - 36, h - 36);
      const TXT = 'JOE & PAT · PRISTINE HOME SERVICES';
      let fs = 96;
      g.letterSpacing = '6px';
      do { g.font = `600 ${fs}px "Cormorant Garamond", "Times New Roman", Georgia, serif`; fs -= 2; } while (g.measureText(TXT).width > w - 140 && fs > 20);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(255,240,200,0.5)'; g.fillText('JOE & PAT · PRISTINE HOME SERVICES', w / 2 + 2, h / 2 + 5);
      g.fillStyle = '#3a2508'; g.fillText('JOE & PAT · PRISTINE HOME SERVICES', w / 2, h / 2 + 3);
    }, { wrap: false });
    const plate = new THREE.Mesh(RB(PW, PH, 0.005, 0.0018, 2), [
      new THREE.MeshStandardMaterial({ color: 0xb8924c, metalness: 1, roughness: 0.35 }),
      new THREE.MeshStandardMaterial({ color: 0xb8924c, metalness: 1, roughness: 0.35 }),
      new THREE.MeshStandardMaterial({ color: 0xb8924c, metalness: 1, roughness: 0.35 }),
      new THREE.MeshStandardMaterial({ color: 0xb8924c, metalness: 1, roughness: 0.35 }),
      new THREE.MeshStandardMaterial({ map: plateTex, metalness: 0.85, roughness: 0.32 }),
      new THREE.MeshStandardMaterial({ color: 0xb8924c, metalness: 1, roughness: 0.35 }),
    ]);
    plate.position.set(0, -H / 2 - 0.07, 0.003);
    plate.castShadow = true; plate.receiveShadow = true;
    box.add(plate);
    for (const sx of [-1, 1]) {
      const screw = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), giltMat);
      screw.rotation.x = Math.PI / 2; screw.position.set(sx * (PW / 2 - 0.012), -H / 2 - 0.07, 0.0055);
      box.add(screw);
    }
  }

  // ---- Picture light ---------------------------------------------------------
  {
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 1, roughness: 0.28 });
    const yM = H / 2 + 0.15;
    const plate = new THREE.Mesh(RB(0.11, 0.07, 0.014, 0.005), brass);
    plate.position.set(0, yM, 0.007); plate.castShadow = true; box.add(plate);
    const curve = new THREE.CubicBezierCurve3(V(0, yM, 0.012), V(0, yM + 0.06, 0.12), V(0, yM + 0.02, 0.3), V(0, yM - 0.03, 0.36));
    const armM = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.007, 10), brass);
    armM.castShadow = true; box.add(armM);
    const barY = yM - 0.035, barZ = 0.365, BL = 0.62;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, BL, 24, 1, false, 0, Math.PI * 1.35), brass);
    bar.rotation.z = Math.PI / 2; bar.rotation.x = 0.35; bar.position.set(0, barY, barZ);
    bar.material = brass.clone(); bar.material.side = THREE.DoubleSide;
    bar.castShadow = true; box.add(bar);
    for (const sx of [-1, 1]) {
      const endCap = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.006, 20), brass);
      endCap.rotation.z = Math.PI / 2; endCap.position.set(sx * BL / 2, barY, barZ); box.add(endCap);
    }
    const tubeLight = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, BL - 0.02, 12),
      new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffc98a, emissiveIntensity: 4 }));
    tubeLight.rotation.z = Math.PI / 2; tubeLight.position.set(0, barY - 0.008, barZ - 0.004); box.add(tubeLight);
    const spot = new THREE.SpotLight(0xffcf94, 1.1, 1.8, 0.95, 0.85, 2);
    spot.position.set(0, barY - 0.02, barZ);
    spot.target.position.set(0, -0.25, 0.12);
    box.add(spot, spot.target);
  }

  // ---- Hotspots --------------------------------------------------------------
  const pictureHit = new THREE.Mesh(new THREE.BoxGeometry(W + 0.02, H + 0.02, D + 0.01), new THREE.MeshBasicMaterial());
  pictureHit.material.visible = false;
  pictureHit.position.z = (D + 0.01) / 2;
  root.add(pictureHit);
  hotspot(pictureHit, {
    id: 'hot-picture',
    anchor: toWorld(0, H / 2 + 0.06, D),
    views: { garage: { go: 'about', label: 'About us' } },
  });
  hotspot(founders, {
    id: 'hot-founders',
    anchor: toWorld(-0.3, G + 0.24, 0.14),
    views: { about: { item: 'about-founders', label: 'Joe & Pat' } },
  });
  hotspot(truck, {
    id: 'hot-truck',
    anchor: toWorld(0.24, G + 0.2, 0.1),
    views: { about: { item: 'about-truck', label: 'The Pristine truck' } },
  });
  hotspot(laptop, {
    id: 'hot-laptop',
    anchor: toWorld(laptop.position.x, laptop.position.y + 0.045, laptop.position.z),
    views: { about: { item: 'about-portal', label: 'E-books & learning portal' } },
  });

  ctx.api.about = { root, glass };
}
