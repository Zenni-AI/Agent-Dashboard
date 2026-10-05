# Pristine World

The Pristine Home Services website as a walkable 3D world. The visitor starts on
the street at dusk. The garage door rolls up, the shop lights stutter on, and they
walk up the driveway. Every department of the business is an object in the garage:

| Object | Department | Inside |
|---|---|---|
| Red mid-engine sports car | **Solar** (featured) | battery wall, EV charger, meter, the car itself |
| Pegboard, workbench, mower, pavers | **Services** | shovel, pressure washer, gutter, solar sample, mower, pavers |
| Roll-off dumpster on the driveway | **Every service** | couch, fridge, branches, grass bags, panel, pavers, washer, gutter |
| Cobweb in the back corner | **Pristine Home Services Network** | mission, learn, join, partner |
| Shadow-box photo on the back wall | **About us** | Joe & Pat, the truck, the laptop (e-books and learning portal) |

Clicking a department walks the camera there with footsteps (bob, sway and a
slight roll). Clicking an item inside it flies in close and opens a
"work order" card with the copy and a call to action.

## Run it

No build step. Serve the folder with any static server:

```bash
npx http-server pristine-world -p 8080   # then open http://localhost:8080
```

Deep links: `#services`, `#dumpster`, `#solar`, `#network`, `#about`.

## Edit it

- **Copy, services and e-books:** `js/content.js`
- **Camera positions per department:** `js/views.js`
- **Engine** (camera rig, walking, picking, markers, minimap, cards): `js/main.js`
- **World:** `js/world/*.js`, one module per zone. See `SPEC.md` for the layout and module contract.
- **Forms** are not wired to anything yet. The submit handler in `js/main.js` shows
  a "not connected" note. Point it at your CRM or email tool before launch.

## Dev tools

`dev/harness.html` renders any set of world modules from any view.
`dev/shot.mjs` screenshots a page with headless Chromium:

```bash
node dev/shot.mjs "dev/harness.html?m=garage,solar&view=solar" /tmp/solar.png 1440 810
WAIT=3000 node dev/shot.mjs "index.html#about" /tmp/about.png 1440 810
```

Three.js r170 is vendored in `vendor/three/` (MIT).
