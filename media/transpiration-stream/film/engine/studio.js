// Procedural "studio" environment for microscopic worlds: a dark room with soft
// boxes, PMREM-filtered, giving glassy water and membranes believable highlights.
import * as THREE from 'three';

export function studioEnv(renderer, o = {}) {
  const scene = new THREE.Scene();
  const bg = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ color: o.bg ?? 0x0a1218, side: THREE.BackSide }));
  scene.add(bg);
  const panel = (w, h, pos, color, intensity) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); scene.add(m);
  };
  panel(22, 14, [-18, 24, 16], o.key ?? 0xfff2e0, o.keyI ?? 6);    // key soft box
  panel(30, 8, [20, 10, -24], o.rim ?? 0x8fc8ff, o.rimI ?? 4);      // cool rim
  panel(40, 10, [0, -28, 10], o.fill ?? 0x3a5a70, o.fillI ?? 1.2);  // floor bounce
  panel(10, 30, [30, 0, 12], o.side ?? 0xd8ecff, o.sideI ?? 1.5);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(scene, 0.03).texture;
  pm.dispose();
  return tex;
}
