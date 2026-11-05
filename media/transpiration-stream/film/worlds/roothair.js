// World: cutaway through the edge of a root hair cell (conceptual, molecules
// enlarged). From outside in: soil water → cellulose cell wall (freely
// permeable) → plasma membrane (lipid bilayer + aquaporins: selectively
// permeable) → cytoplasm → tonoplast → vacuole. Water molecules diffuse both
// ways with a net inward flux down the water-potential gradient (osmosis);
// solute molecules cannot cross the membrane. (s1c)
import * as THREE from 'three';
import { organicMaterial, waterMaterial, Sprites } from '../engine/materials.js';
import { studioEnv } from '../engine/studio.js';
import { CameraPath, rng, v3, clamp, smooth, noise3, remap } from '../engine/util.js';
import { ACCENT } from '../engine/overlay.js';

// layer radii (tube axis = z)
const L = { water1: 7.5, water0: 6.45, wall0: 5.72, mem0: 5.56, cyt0: 4.62, ton0: 4.5, vac0: 0.0 };
const TH0 = THREE.MathUtils.degToRad(38), TH1 = THREE.MathUtils.degToRad(142);
const Z0 = -12, Z1 = 1.5;

function sector(r0, r1, th0 = TH0, th1 = TH1, z0 = Z0, z1 = Z1, seg = 96) {
  const s = new THREE.Shape();
  s.moveTo(r1 * Math.cos(th0), r1 * Math.sin(th0));
  s.absarc(0, 0, r1, th0, th1, false);
  s.lineTo(r0 * Math.cos(th1), r0 * Math.sin(th1));
  s.absarc(0, 0, r0, th1, th0, true);
  const g = new THREE.ExtrudeGeometry(s, { depth: z1 - z0, bevelEnabled: false, curveSegments: seg });
  g.translate(0, 0, z0);
  return g;
}
const polar = (r, th, z) => v3(r * Math.cos(th), r * Math.sin(th), z);

export async function build(env) {
  const R = rng(5);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050a10);
  scene.environment = studioEnv(env.renderer, { bg: 0x08111a, key: 0xfff0dc, rim: 0x86c4ff });
  scene.fog = new THREE.FogExp2(0x050a10, 0.03);
  const key = new THREE.DirectionalLight(0xfff0e0, 2.2); key.position.set(-5, 14, 10); scene.add(key);
  const rim = new THREE.DirectionalLight(0x7fb8ff, 1.4); rim.position.set(6, 4, -10); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x405060, 0x101010, 0.5));

  // --- layers ----------------------------------------------------------------------
  const soilWater = new THREE.Mesh(sector(L.water0, L.water1), waterMaterial({ color: 0x5aa8ff, opacity: 0.16, glow: 0x2a7ee8, glowStrength: 0.16, fresAlpha: 0.5, envMapIntensity: 2.2 }));
  soilWater.renderOrder = 8; scene.add(soilWater);
  const wallMat = organicMaterial({ color: 0xd9d2b8, roughness: 0.5, transparent: true, opacity: 0.28, depthWrite: false,
    rimColor: 0xfff6e0, rimStrength: 0.25, sssColor: 0x40382a, sssStrength: 0.35, noiseAmp: 0.4, noiseScale: 1.5, noiseColor: 0xa89c7c });
  const wall = new THREE.Mesh(sector(L.wall0, L.water0), wallMat); wall.renderOrder = 6; scene.add(wall);
  // cellulose microfibrils in crossed layers (porous mesh)
  const fibMat = organicMaterial({ color: 0xf2ecd6, roughness: 0.35, rimColor: 0xffffff, rimStrength: 0.45, sssColor: 0x504630, sssStrength: 0.35,
    clipping: true });
  fibMat.clippingPlanes = [new THREE.Plane(v3(0, 0, -1), Z1), new THREE.Plane(v3(0, 0, 1), -Z0)];
  { const nLayers = 4;
    for (let l = 0; l < nLayers; l++) {
      const r = L.wall0 + 0.12 + (L.water0 - L.wall0 - 0.24) * (l / (nLayers - 1));
      const pitch = (l % 2 ? 1 : -1) * 2.6; // crossed helices: alternate layers wind opposite ways
      for (let k = 0; k < 34; k++) {
        const zc = remap(k, 0, 33, Z0 - 3, Z1 + 3) + R.range(-0.04, 0.04);
        const pts = []; for (let i = 0; i <= 40; i++) { const th = TH0 - 0.05 + (TH1 - TH0 + 0.1) * (i / 40); pts.push(polar(r + 0.02 * Math.sin(i * 1.7 + k), th, zc + (th - Math.PI / 2) * pitch)); }
        const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.032, 6, false);
        scene.add(new THREE.Mesh(g, fibMat));
      }
    } }

  // plasma membrane: hydrophobic core + two leaflets of phospholipid heads + aquaporins
  const coreMat = organicMaterial({ color: 0xc9a65a, roughness: 0.6, sssColor: 0x5a4010, sssStrength: 0.5, rimColor: 0xffe6a0, rimStrength: 0.2 });
  scene.add(new THREE.Mesh(sector(L.mem0 + 0.035, L.wall0 - 0.035), coreMat));
  scene.add(new THREE.Mesh(sector(L.ton0 + 0.03, L.cyt0 - 0.03), coreMat));
  const headGeo = new THREE.SphereGeometry(1, 10, 8);
  const headMat = organicMaterial({ color: 0xf3e3b5, roughness: 0.35, rimColor: 0xffffff, rimStrength: 0.3, sssColor: 0x504020, sssStrength: 0.2 });
  const heads = [];
  for (const [rr, tag] of [[L.wall0 - 0.02, 0], [L.mem0 + 0.02, 0], [L.cyt0 - 0.02, 1], [L.ton0 + 0.02, 1]]) {
    const dth = 0.075 / rr, dz = 0.075;
    for (let z = Z0 + 0.05; z < Z1 - 0.03; z += dz) for (let th = TH0 + dth / 2; th < TH1; th += dth) heads.push(polar(rr, th + (Math.round(z / dz) % 2) * dth / 2, z));
  }
  const headMesh = new THREE.InstancedMesh(headGeo, headMat, heads.length);
  { const m = new THREE.Matrix4(); heads.forEach((p, i) => headMesh.setMatrixAt(i, m.makeScale(0.04, 0.04, 0.04).setPosition(p))); }
  scene.add(headMesh);
  // aquaporin channels (water-selective pores) through both membranes
  const aqGeo = new THREE.CylinderGeometry(0.11, 0.11, 1, 10, 1);
  const aqMat = organicMaterial({ color: 0x7b5cd6, roughness: 0.4, rimColor: 0xcdbaff, rimStrength: 0.5, sssColor: 0x2a1460, sssStrength: 0.5 });
  const channels = [];
  for (const [r0, r1, n] of [[L.mem0, L.wall0, 34], [L.ton0, L.cyt0, 18]]) {
    for (let i = 0; i < n; i++) channels.push({ th: TH0 + 0.06 + (TH1 - TH0 - 0.12) * ((i + R.range(0.2, 0.8)) / n), z: R.range(Z0 + 0.5, Z1 - 0.12), r0, r1 });
  }
  // keep a channel right at the hero spot on the cut face
  channels.push({ th: Math.PI / 2 + 0.03, z: Z1 - 0.13, r0: L.mem0, r1: L.wall0 }, { th: Math.PI / 2 - 0.05, z: Z1 - 0.13, r0: L.ton0, r1: L.cyt0 });
  const aqMesh = new THREE.InstancedMesh(aqGeo, aqMat, channels.length * 4);
  { const m = new THREE.Matrix4(), q = new THREE.Quaternion(); let n = 0;
    for (const c of channels) {
      const mid = (c.r0 + c.r1) / 2, nrm = v3(Math.cos(c.th), Math.sin(c.th), 0);
      q.setFromUnitVectors(v3(0, 1, 0), nrm);
      for (let k = 0; k < 4; k++) { // tetramer: four subunits around a central pore
        const a = k * Math.PI / 2 + 0.4, off = v3(-Math.sin(c.th), Math.cos(c.th), 0).multiplyScalar(Math.cos(a) * 0.12).add(v3(0, 0, Math.sin(a) * 0.12));
        m.compose(polar(mid, c.th, c.z).add(off), q, v3(1, (c.r1 - c.r0) + 0.12, 1)); aqMesh.setMatrixAt(n++, m);
      }
    } }
  scene.add(aqMesh);

  // cytoplasm (translucent, granular) and vacuole (cell sap)
  const cytMat = organicMaterial({ color: 0x9fb6a0, roughness: 0.5, transparent: true, opacity: 0.22, depthWrite: false, sssColor: 0x1e3022, sssStrength: 0.6,
    noiseAmp: 0.6, noiseScale: 2.5, noiseColor: 0x5f7a62, rimColor: 0xe0ffe8, rimStrength: 0.15 });
  const cyt = new THREE.Mesh(sector(L.mem0 - 0.04, L.cyt0 + 0.04), cytMat); cyt.renderOrder = 4; scene.add(cyt);
  const vacMat = organicMaterial({ color: 0x8e7fb0, roughness: 0.3, transparent: true, opacity: 0.12, depthWrite: false, sssColor: 0x221a38, sssStrength: 0.5 });
  const vac = new THREE.Mesh(sector(2.2, L.ton0 - 0.04), vacMat); vac.renderOrder = 3; scene.add(vac);
  // a few organelles in the cytoplasm (mitochondria, ER) for context
  const orgMat = organicMaterial({ color: 0xcf8f6a, roughness: 0.4, rimColor: 0xffd8c0, rimStrength: 0.4, sssColor: 0x40200a, sssStrength: 0.4 });
  for (let i = 0; i < 12; i++) {
    const th = R.range(TH0 + 0.08, TH1 - 0.08), z = R.range(Z0 + 1, Z1 - 0.6), r = R.range(L.cyt0 + 0.35, L.mem0 - 0.35);
    const g = new THREE.CapsuleGeometry(0.18, R.range(0.4, 0.8), 6, 12);
    const m = new THREE.Mesh(g, orgMat); m.position.copy(polar(r, th, z)); m.rotation.set(R() * 3, R() * 3, R() * 3); scene.add(m);
  }

  // --- molecules ------------------------------------------------------------------------
  const NW = 2600, NS = 340;
  const waterS = new Sprites(NW, { shape: 'sphere', renderOrder: 12 });
  const soluteS = new Sprites(NS, { shape: 'sphere', renderOrder: 12 });
  scene.add(waterS.mesh, soluteS.mesh);
  const randIn = (r0, r1) => polar(R.range(r0, r1), R.range(TH0 + 0.02, TH1 - 0.02), R.range(Z0 + 0.2, Z1 - 0.06));
  const W = [];
  for (let i = 0; i < NW; i++) {
    const zone = R();
    let kind, p;
    if (i < 520) { kind = 'cross'; }
    else if (zone < 0.42) { kind = 'free'; p = randIn(L.water0 + 0.05, L.water1 - 0.05); }
    else if (zone < 0.6) { kind = 'free'; p = randIn(L.wall0 + 0.05, L.water0 - 0.05); }
    else if (zone < 0.82) { kind = 'free'; p = randIn(L.cyt0 + 0.08, L.mem0 - 0.08); }
    else { kind = 'free'; p = randIn(2.4, L.ton0 - 0.1); }
    if (kind === 'cross') {
      const c = channels[R.int(0, channels.length - 1)];
      const out = i % 7 === 0; // a minority cross outward: osmosis is a NET movement
      W.push({ kind, c, out, ph: R(), sp: R.range(0.12, 0.2), th: c.th, z: c.z });
    } else W.push({ kind, p, ph: R() * 100 });
  }
  const S = [];
  for (let i = 0; i < NS; i++) {
    const inCell = i < 326; // concentrated cell sap vs. dilute soil water
    S.push({ p: inCell ? (i < 120 ? randIn(L.cyt0 + 0.12, L.mem0 - 0.15) : randIn(2.4, L.ton0 - 0.15)) : randIn(L.water0 + 0.15, L.water1 - 0.1), ph: R() * 100 });
  }
  const blue = new THREE.Color(0.32, 0.68, 1.0), amber = new THREE.Color(1.0, 0.68, 0.28), tmp = new THREE.Vector3();
  const crossPos = (w, k) => {
    // inward path: soil water → through wall pores → aquaporin → cytoplasm → deeper inside
    const r = THREE.MathUtils.lerp(L.water1 - 0.3, L.cyt0 + 0.3, k);
    const inChan = r < L.wall0 + 0.15 && r > L.mem0 - 0.15;
    const wob = inChan ? 0 : 0.18 * Math.sin(k * 40 + w.ph * 9);
    return polar(r, w.th + wob / r, w.z + (inChan ? 0 : 0.15 * Math.cos(k * 33 + w.ph * 7)));
  };

  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.02, 120);
  const path = new CameraPath([
    { t: 0.0, pos: [2.9, 9.0, 9.9], tgt: [0.3, 5.5, 0.4], fov: 38 },
    { t: 2.2, pos: [2.2, 8.0, 8.6], tgt: [0.1, 5.35, 0.8], fov: 35 },
    { t: 5.8, pos: [1.5, 7.3, 7.4], tgt: [0.0, 5.2, 1.0], fov: 34 },
  ]);
  const update = (t, shot, lt) => {
    path.apply(camera, lt);
    const tt = t * 0.6;
    W.forEach((w, i) => {
      let p;
      if (w.kind === 'cross') {
        let k = (tt * w.sp + w.ph) % 1; if (w.out) k = 1 - k;
        p = crossPos(w, k);
        const a = smooth(Math.min(k, 1 - k) / 0.08);
        waterS.set(i, p, 0.085, blue, a);
      } else {
        p = tmp.copy(w.p).add(v3(noise3(w.ph, tt * 0.8, 0), noise3(w.ph + 3, tt * 0.8, 1), noise3(w.ph + 6, tt * 0.8, 2)).multiplyScalar(0.22));
        waterS.set(i, p, 0.08, blue, 1);
      }
    });
    waterS.commit();
    S.forEach((s, i) => {
      const p = tmp.copy(s.p).add(v3(noise3(s.ph, tt * 0.5, 0), noise3(s.ph + 3, tt * 0.5, 1), noise3(s.ph + 6, tt * 0.5, 2)).multiplyScalar(0.15));
      soluteS.set(i, p, 0.17, amber, 1);
    });
    soluteS.commit();
  };
  const post = (t, shot, lt) => ({ focus: camera.position.distanceTo(camera.userData.target), aperture: 7, maxCoc: 18, exposure: 1.1,
    bloom: 0.5, bloomThreshold: 0.9, vignette: 0.5, saturation: 1.05, contrast: 1.06 });
  const F = (r, dth = 0) => polar(r, Math.PI / 2 + dth, Z1);
  const overlay = (ov, t) => {
    // phase 1 (structure)
    ov.label({ text: 'Soil water', at: F((L.water0 + L.water1) / 2, 0.16), dx: -140, dy: -50, t0: 5.95, t1: 8.3 }, camera, t);
    ov.label({ text: 'Cell wall', sub: 'freely permeable', at: F((L.wall0 + L.water0) / 2, -0.3), dx: 190, dy: 40, t0: 6.1, t1: 8.3 }, camera, t);
    ov.label({ text: 'Cytoplasm', at: F((L.cyt0 + L.mem0) / 2, 0.2), dx: -170, dy: 20, t0: 6.7, t1: 8.3 }, camera, t);
    ov.label({ text: 'Vacuole', sub: 'cell sap: many dissolved solutes', at: F((L.ton0 + 2.6) / 2 + 0.6, -0.12), dx: 170, dy: 50, t0: 6.95, t1: 8.3 }, camera, t);
    // persists: the selectively permeable membrane
    ov.label({ text: 'Cell membrane', sub: 'selectively permeable', at: F(L.mem0 + 0.08, -0.05), dx: 120, dy: -170, t0: 6.4, t1: 10.95 }, camera, t);
    // phase 2 (process)
    ov.caption({ text: 'Osmosis', sub: 'net movement of water across the membrane', x: 0.075, y: 0.66, size: 40, weight: 700, t0: 7.9, t1: 10.95 }, t);
    ov.caption({ text: '●  water', x: 0.075, y: 0.765, size: 22, weight: 600, color: '#59adff', t0: 8.1, t1: 10.95 }, t);
    ov.caption({ text: '●  solute: too large to cross', x: 0.075, y: 0.80, size: 22, weight: 600, color: '#ffb257', t0: 8.1, t1: 10.95 }, t);
    ov.arrow({ from: [0.935, 0.2], to: [0.935, 0.74], text: 'Higher → Lower', sub: 'water potential', tdx: -40, tdy: 0, align: 'right', t0: 7.75, t1: 10.95, c0: '#a8e4ff', c1: ACCENT }, camera, t);
    ov.caption({ text: 'soil water', x: 0.935, y: 0.18, size: 19, weight: 600, align: 'center', color: '#cdeeff', t0: 8.0, t1: 10.95 }, t);
    ov.caption({ text: 'cell sap', x: 0.935, y: 0.785, size: 19, weight: 600, align: 'center', color: '#cdeeff', t0: 8.0, t1: 10.95 }, t);
    ov.note({ text: 'Conceptual model · molecules enlarged, not to scale', align: 'right', y: 96, t0: 6.0, t1: 10.95 }, t);
  };
  return { scene, camera, update, post, overlay };
}
