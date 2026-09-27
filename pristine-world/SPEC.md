# Pristine World: build contract

A real-time 3D website for **Pristine Home Services**. The visitor stands on the
driveway at dusk looking into an open two-car garage. Every department of the
business is a physical object in one continuous world, and the camera *walks*
to it like a first-person game. It uses Three.js r170, vendored at `vendor/three/`,
and ES modules with an import map (`three`, `three/addons/...`).

**Goal: realism.** Real-world scale in meters, physically based materials,
believable proportions, wear and grime, bevelled edges (no raw cubes; use
`RoundedBoxGeometry` from `three/addons/geometries/RoundedBoxGeometry.js`),
contact shadows, and lights that motivate every highlight. Think of a
well-lit game level, not low-poly clip art. Use only procedural geometry and
canvas textures (`js/lib/tex.js`). No image files and no network fetches.

## World layout (meters, +y up)

| Thing | Where |
|---|---|
| Garage interior | x ∈ [-3.6, 3.6], z ∈ [-7.2, 0], floor y=0, ceiling y=2.9 |
| Door opening (front wall, z=0) | x ∈ [-2.75, 2.75], y ∈ [0, 2.35]. Sectional door rolls up into the ceiling |
| House facade | front wall plane z=0 extends x ∈ [-9, 13], eave ~3.3, gable roofs. Living part of house is x > 3.75 (front door, lit windows) |
| Driveway | concrete, x ∈ [-3.2, 3.2], z ∈ [0, 12]. Sidewalk z 12–13.5, street z 13.5–22. Lawn elsewhere |
| **Car (Corvette-style mid-engine sports car)** | center (0.9, 0, -3.4), nose toward +z, ~4.6 L × 1.95 W × 1.2 H |
| EV charger | right wall x=3.58, z=-2.0, y≈1.2 |
| Solar battery + inverter | right wall x=3.58, z ∈ [-3.6, -5.0] |
| Electric meter / solar monitor | right wall x=3.58, z=-0.9, y≈1.5 |
| Workbench + pegboard (services) | left wall x=-3.6, z ∈ [-2.2, -4.6]; bench top y=0.92, pegboard y ∈ [1.0, 2.3] |
| Lawn mower | floor, around (-2.8, 0, -1.4) |
| Paver pallet | floor, around (-2.9, 0, -5.9) |
| Wheelie bin | floor, around (-3.15, 0, -0.55) |
| Roll-off dumpster (20 yd) | driveway's left edge / lawn, center (-5.0, 0, 5.0), long axis along z, ~2.35 W × 1.45 H × 5.0 L |
| Framed photo "shadow box" (About) | back wall z=-7.2, centered x=-1.5, y=1.55, ~1.5 W × 1.05 H |
| Neon "PRISTINE" sign | back wall, centered x=1.4, y=2.35 |
| Cobweb (Network) | back-right corner (x=3.6, z=-7.2), y ∈ [1.5, 2.9], ~1.2 m radius, spanning the corner diagonally |
| Shelving | right wall, z ∈ [-5.3, -6.1], y 0–1.4 (stay below the web) |

Keep the camera corridors clear (see `js/views.js`): the left aisle x ∈ [-2.2, -0.2]
inside the garage, and the path from the street up the left half of the driveway.

## Module contract

Each world module is `js/world/<name>.js` and exports:

```js
export function build(ctx) { ... }   // may be async
```

`ctx` gives you:

- `THREE`: the three namespace.
- `scene`: the THREE.Scene. `add(obj)` adds to it.
- `tex`: helpers from `js/lib/tex.js` (`canvasTexture`, `grain`, `blotches`, `label`, `rng`, `stdMat`).
- `quality`: `'high' | 'low'`. On low, skip shadow casting on small parts and reduce segments.
- `renderer`: for `capabilities.getMaxAnisotropy()` if needed.
- `onUpdate(fn)`: `fn(dt, elapsed)` every frame for idle animation (flicker, sway, spinning).
- `api`: a shared object. Put what other code must call on `ctx.api.<module>`.
- `hotspot(object3D, spec)` registers a clickable object (raycast hits on it *or any descendant*).

```js
hotspot(group, {
  id: 'hot-services',                 // unique
  anchor: [x, y, z],                  // optional world point for the floating marker (default: bbox top-center)
  views: {                            // which camera view it is clickable in, and what it does there
    garage:   { go: 'services', label: 'Services' },
    services: { item: 'landscaping', label: 'Landscaping' },
  },
});
```

`go` walks the camera to another view. `item` flies the camera close to that
object and opens a content card. Item keys must come from the list below. The
engine handles hover glow, markers, labels and clicks, so modules only build
objects and register them.

Lighting ownership: **garage.js owns all global lighting** (sky, moon, garage
ceiling lights, porch lights, streetlights). Other modules may add small
*local* lights for things that emit light (charger LED, neon, laptop screen,
headlights) but keep each one's `distance` short and never enable
`castShadow` on them. Set `castShadow`/`receiveShadow` on your meshes.

## Views (from js/views.js)

`garage` (home, from the street) → `services`, `solar`, `network`, `about`;
`services` → `dumpster`.

## Item keys

Services: `landscaping`, `lawn`, `pavers`, `junk`, `cleanouts`, `washing`, `gutters`, `solar-svc`
Solar bay: `solar-how`, `solar-ev`, `solar-savings`, `solar-quote`
Network: `net-mission`, `net-learn`, `net-join`, `net-partner`
About: `about-founders`, `about-truck`, `about-portal`

## Checking your work

```bash
cd pristine-world
node dev/shot.mjs "dev/harness.html?m=garage,solar&view=solar&markers=1" /tmp/claude-0/x.png 1440 810
```

`m=` lists modules to build together (include `garage` to get real lighting).
`view=` picks a camera from views.js, or use `cam=x,y,z&t=x,y,z&fov=50`.
`markers=1` shows hotspot anchors as red dots. The JSON output lists console
errors, so fix every one.
