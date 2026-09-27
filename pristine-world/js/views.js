// Camera viewpoints for each "department". Units are meters.
// World: +y up. Garage front wall (door plane) is z = 0, interior is z < 0,
// driveway/street is z > 0. See SPEC.md for the full layout.
export const VIEWS = {
  garage:   { name: 'Garage',          parent: null,       pos: [-0.6, 1.7, 11.0], target: [-0.4, 1.15, -3.5], fov: 50, fitWidth: 11 },
  services: { name: 'Services wall',   parent: 'garage',   pos: [-0.6, 1.62, -2.1], target: [-3.6, 1.35, -3.45], fov: 56, fitWidth: 3.6 },
  dumpster: { name: 'The dumpster',    parent: 'services', pos: [-1.3, 3.0, 9.0],  target: [-5.0, 0.95, 5.0],  fov: 50, fitWidth: 6.2 },
  solar:    { name: 'Solar bay',       parent: 'garage',   pos: [-1.0, 1.3, 0.6],  target: [1.4, 0.8, -3.3],   fov: 48, fitWidth: 5.5 },
  network:  { name: 'The network',     parent: 'garage',   pos: [2.35, 1.85, -4.55], target: [3.5, 2.2, -7.1], fov: 52, fitWidth: 2.6 },
  about:    { name: 'About us',        parent: 'garage',   pos: [-1.5, 1.55, -4.85], target: [-1.5, 1.55, -7.2], fov: 44, fitWidth: 2.1 },
};

// Walkable waypoints the camera routes through so it never clips the car or walls.
export const WAYPOINTS = {
  outside: [-0.4, 1.7, 4.0],
  door:    [-0.9, 1.7, 0.8],
  hub:     [-1.2, 1.7, -1.6],
};
