// TEMP test walls (delete me)
export function build({ THREE, add }) {
  const m = new THREE.MeshStandardMaterial({ color: 0xb9b4aa, roughness: 0.9 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 2.9), m); back.position.set(0, 1.45, -7.2); back.receiveShadow = true; add(back);
  const right = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 2.9), m); right.rotation.y = -Math.PI / 2; right.position.set(3.6, 1.45, -3.6); add(right);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 7.2), m); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 2.9, -3.6); add(ceil);
  const l = new THREE.PointLight(0xfff0dd, 6, 8); l.position.set(0.5, 2.7, -4.5); add(l);
}
