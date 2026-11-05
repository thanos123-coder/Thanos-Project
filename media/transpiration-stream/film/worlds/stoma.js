// World: the lower leaf surface around one stoma, seen from outside (1 unit = 1 µm).
// Jigsaw-shaped epidermal pavement cells (no chloroplasts) surround two
// kidney-shaped guard cells (with chloroplasts). Opening: K⁺ ions enter the guard
// cells, lowering their water potential; water follows by osmosis; the turgid cells
// bow apart and the pore opens (CO₂ diffuses in, water vapour diffuses out).
// Closing (e.g. abscisic acid during water stress): K⁺ leaves, water follows, the
// flaccid cells straighten and the pore narrows. (s6a)
import * as THREE from 'three';
import { Delaunay } from 'd3-delaunay';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { organicMaterial, Sprites } from '../engine/materials.js';
import { studioEnv } from '../engine/studio.js';
import { CameraPath, rng, v3, clamp, smooth, noise3, remap, taperedTube } from '../engine/util.js';
import { ACCENT, VAPOUR } from '../engine/overlay.js';

const LGC = 27;              // guard-cell length (µm)
const EX = 11.6, EY = 15.2;  // ellipse kept clear for the stoma (guard-cell outline)

// opening state over the shot (global time): 0 = closed, 1 = fully open
const openAt = (t) => {
  const o1 = smooth(remap(t, 49.9, 51.3));      // opening
  const c1 = smooth(remap(t, 54.0, 55.6));      // closing (narrows)
  return 0.12 + 0.88 * o1 - 0.78 * c1;
};

function guardGeometry(side, open) {
  const half = 0.25 + 2.9 * open;               // pore half-width at the middle
  const r0 = 3.55 + 0.75 * open;                // turgid cells swell
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const s = i / 24, y = (s - 0.5) * LGC;
    const sinp = Math.pow(Math.sin(Math.PI * s), 0.85);
    const r = r0 * (0.72 + 0.28 * Math.sin(Math.PI * s));
    pts.push(v3(side * (half * sinp + r * (0.55 + 0.45 * sinp)), y, r * 0.75));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = taperedTube(curve, (s) => r0 * (0.72 + 0.28 * Math.sin(Math.PI * s)) * (0.55 + 0.45 * Math.pow(Math.sin(Math.PI * s), 0.35)), 80, 24);
  return { g, curve, r0, half };
}

export async function build(env) {
  const R = rng(91);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02060a);
  scene.environment = studioEnv(env.renderer, { bg: 0x061018, key: 0xfff4e6, rim: 0x86c4ff });
  scene.fog = new THREE.FogExp2(0x02060a, 0.006);
  const key = new THREE.DirectionalLight(0xfff2e2, 2.3); key.position.set(-30, 40, 60); scene.add(key);
  const rim = new THREE.DirectionalLight(0x86c0ff, 1.2); rim.position.set(40, -20, 30); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x485862, 0x101010, 0.55));

  // --- pavement cells: Voronoi with wavy (jigsaw) shared edges ---------------------------
  const seeds = [];
  for (let tries = 0; tries < 3000 && seeds.length < 46; tries++) {
    const x = R.range(-110, 110), y = R.range(-70, 70);
    if ((x / (EX + 9)) ** 2 + (y / (EY + 9)) ** 2 < 1) continue;
    if (seeds.some(s => Math.hypot(s[0] - x, s[1] - y) < 26)) continue;
    seeds.push([x, y]);
  }
  // four cells hugging the stoma
  for (const a of [0.0, Math.PI / 2, Math.PI, 1.5 * Math.PI]) seeds.push([(EX + 7) * Math.cos(a), (EY + 7) * Math.sin(a)]);
  const STOMA_SEED = seeds.length; seeds.push([0, 0]); // owns the ellipse interior: not drawn (the pore region)
  const del = Delaunay.from(seeds), vor = del.voronoi([-140, -100, 140, 100]);
  const key2 = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  const wavyEdge = (a, b) => { // identical wiggle for both cells sharing the edge
    const flip = key2(a) > key2(b); const A = flip ? b : a, B = flip ? a : b;
    const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
    const waves = Math.max(1, Math.round(L / 11)), amp = Math.min(2.6, L * 0.09);
    const pts = []; for (let k = 1; k < 16; k++) { const f = k / 16, w = amp * Math.sin(f * Math.PI * waves) * Math.sin(f * Math.PI); pts.push([A[0] + dx * f + nx * w, A[1] + dy * f + ny * w]); }
    return flip ? pts.reverse() : pts;
  };
  const clampEllipse = (p) => { const k = (p[0] / EX) ** 2 + (p[1] / EY) ** 2; if (k >= 1) return p; const s = 1 / Math.sqrt(k); return [p[0] * s, p[1] * s]; };
  const geos = [];
  seeds.forEach((s, i) => {
    if (i === STOMA_SEED) return;
    const poly = vor.cellPolygon(i); if (!poly) return;
    const pts = poly.slice(0, -1); const out = [];
    for (let k = 0; k < pts.length; k++) { out.push(clampEllipse(pts[k])); wavyEdge(pts[k], pts[(k + 1) % pts.length]).forEach(p => out.push(clampEllipse(p))); }
    const c = out.reduce((a, p) => [a[0] + p[0] / out.length, a[1] + p[1] / out.length], [0, 0]);
    const ins = out.map(p => { const dx = p[0] - c[0], dy = p[1] - c[1], L = Math.hypot(dx, dy); const f = Math.max(0.2, 1 - 0.75 / L); return new THREE.Vector2(c[0] + dx * f, c[1] + dy * f); });
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(ins), { depth: 2.2, bevelEnabled: true, bevelThickness: 1.1, bevelSize: 0.9, bevelSegments: 3, curveSegments: 2 });
    geos.push(g);
  });
  const paveMat = organicMaterial({ color: 0xb9c4b4, roughness: 0.26, rimColor: 0xe8fff0, rimStrength: 0.45, sssColor: 0x1e2a20, sssStrength: 0.45,
    noiseAmp: 0.35, noiseScale: 0.06, noiseColor: 0x8f9c8a, envMapIntensity: 1.1 });
  const pave = new THREE.Mesh(mergeGeometries(geos), paveMat); pave.position.z = -1.6; scene.add(pave);
  // the leaf interior seen through the pore: substomatal cavity and spongy cells
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(400, 300), new THREE.MeshStandardMaterial({ color: 0x050a05, roughness: 1 }));
  inner.position.z = -9; scene.add(inner);
  const sMat = organicMaterial({ color: 0x5f8a48, roughness: 0.4, sssColor: 0x10200a, sssStrength: 0.5, rimColor: 0xc0ffa0, rimStrength: 0.25 });
  for (let i = 0; i < 9; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(R.range(5, 8), 24, 16), sMat); m.position.set(R.range(-26, 26), R.range(-26, 26), R.range(-24, -14)); scene.add(m); }

  // --- guard cells (rebuilt as they swell and bow) + their chloroplasts -----------------------
  const gMat = organicMaterial({ color: 0x9ccc7a, roughness: 0.24, transparent: true, opacity: 0.8, depthWrite: false, rimColor: 0xeaffd8, rimStrength: 0.55,
    sssColor: 0x1e3a12, sssStrength: 0.55, envMapIntensity: 1.3 });
  const gL = new THREE.Mesh(new THREE.BufferGeometry(), gMat), gR = new THREE.Mesh(new THREE.BufferGeometry(), gMat);
  gL.renderOrder = gR.renderOrder = 6; scene.add(gL, gR);
  const chlMat = organicMaterial({ color: 0x3f9a2c, roughness: 0.35, rimColor: 0xb8ff90, rimStrength: 0.4, sssColor: 0x0c3006, sssStrength: 0.6 });
  const chl = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), chlMat, 28); scene.add(chl);
  const chlSeeds = [...Array(28)].map((_, i) => ({ side: i < 14 ? -1 : 1, s: 0.12 + 0.76 * ((i % 14) / 13) + R.range(-0.02, 0.02), a: R.range(0, Math.PI * 2), r: R.range(0.25, 0.6) }));
  let lastOpen = -1, curves = [null, null], geo = {};

  // --- molecules & ions (enlarged) ------------------------------------------------------
  const NC = 14, NV = 22, NK = 26, NW = 26;
  const co2 = new Sprites(NC * 3, { shape: 'sphere', renderOrder: 12 }), vap = new Sprites(NV, { shape: 'sphere', renderOrder: 12 });
  const ions = new Sprites(NK, { shape: 'sphere', renderOrder: 13 }), wat = new Sprites(NW, { shape: 'sphere', renderOrder: 13 });
  scene.add(co2.mesh, vap.mesh, ions.mesh, wat.mesh);
  const cC = new THREE.Color(0.25, 0.25, 0.27), cO = new THREE.Color(0.92, 0.22, 0.17), cV = new THREE.Color(0.88, 0.95, 1.0), cK = new THREE.Color(0.66, 0.42, 1.0), cW = new THREE.Color(0.32, 0.7, 1.0);
  const cSeeds = [...Array(NC)].map(() => ({ ph: R(), x: R.range(-30, 30), y: R.range(-24, 24), q: R.sphere() }));
  const vSeeds = [...Array(NV)].map(() => ({ ph: R(), x: R.range(-34, 34), y: R.range(-26, 26) }));
  const kSeeds = [...Array(NK)].map((_, i) => ({ side: i % 2 ? 1 : -1, s: R.range(0.15, 0.85), ph: R(), from: v3(0, 0, 0) }));
  const P = v3();

  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 1000);
  const path = new CameraPath([
    { t: 0.0, pos: [10, -26, 92], tgt: [0, 0, 0], fov: 36 },
    { t: 3.0, pos: [6, -16, 72], tgt: [0, 0.5, 0], fov: 34 },
    { t: 7.6, pos: [4, -10, 64], tgt: [0, 0.5, 0], fov: 34 },
  ]);
  const update = (t, shot, lt) => {
    path.apply(camera, lt);
    const open = clamp(openAt(t), 0.05, 1);
    if (Math.abs(open - lastOpen) > 1e-4) {
      lastOpen = open;
      for (const [k, side, mesh] of [[0, -1, gL], [1, 1, gR]]) { const r = guardGeometry(side, open); mesh.geometry.dispose(); mesh.geometry = r.g; curves[k] = r.curve; geo = r; }
    }
    chlSeeds.forEach((c, i) => {
      const cv = curves[c.side < 0 ? 0 : 1]; const p = cv.getPointAt(c.s);
      const rr = geo.r0 * (0.72 + 0.28 * Math.sin(Math.PI * c.s)) * 0.6 * c.r;
      P.set(p.x + rr * Math.cos(c.a), p.y, p.z + rr * Math.sin(c.a) * 0.5 + 0.6);
      chl.setMatrixAt(i, new THREE.Matrix4().compose(P, new THREE.Quaternion().setFromEuler(new THREE.Euler(c.a, c.a * 0.7, 0)), v3(1.1, 0.7, 0.55)));
    });
    chl.instanceMatrix.needsUpdate = true;
    // gas exchange through the pore (only while open): CO2 in, water vapour out
    const gas = clamp((open - 0.2) / 0.6);
    cSeeds.forEach((c, i) => {
      const k = (t * 0.22 + c.ph) % 1; // from the outside air, converge on the pore, pass into the leaf
      const toPore = smooth(k / 0.7);
      P.set(c.x * (1 - toPore), c.y * (1 - toPore) * 0.9, 26 * (1 - k) - 18 * smooth((k - 0.7) / 0.3));
      const a = gas * smooth(k / 0.1) * (1 - smooth((k - 0.85) / 0.15));
      const ax = c.q.clone().multiplyScalar(1.16);
      co2.set(i * 3, P, 0.62, cC, a); co2.set(i * 3 + 1, P.clone().add(ax), 0.58, cO, a); co2.set(i * 3 + 2, P.clone().sub(ax), 0.58, cO, a);
    });
    co2.commit();
    vSeeds.forEach((c, i) => {
      const k = (t * 0.26 + c.ph) % 1; // out of the pore, spreading into the air
      const spread = smooth(k / 0.9);
      P.set(c.x * spread * 0.9, c.y * spread * 0.9, -8 + 40 * k);
      P.x += 1.5 * noise3(i, t, 0); P.y += 1.5 * noise3(i, t, 3);
      vap.set(i, P, 0.5, cV, gas * smooth(k / 0.1) * (1 - smooth((k - 0.8) / 0.2)));
    });
    vap.commit();
    // ions and water: in during opening, out during closing
    const opening = smooth(remap(t, 49.8, 50.2)) * (1 - smooth(remap(t, 51.4, 51.9)));
    const closing = smooth(remap(t, 53.8, 54.2)) * (1 - smooth(remap(t, 55.6, 56.1)));
    const flow = Math.max(opening, closing), dir = closing > opening ? -1 : 1;
    kSeeds.forEach((c, i) => {
      const cv = curves[c.side < 0 ? 0 : 1]; const tgt = cv.getPointAt(c.s);
      let k = (t * 0.9 + c.ph) % 1; if (dir < 0) k = 1 - k;
      const out = v3(tgt.x + c.side * 14, tgt.y * 1.15, 1.5);
      P.lerpVectors(out, tgt, smooth(k));
      if (i < NK) ions.set(i, P, 0.75, cK, flow * smooth(Math.min(k, 1 - k) / 0.15));
      if (i < NW) { const p2 = P.clone().add(v3(0, 1.6, 0.8)); wat.set(i, p2, 0.62, cW, flow * smooth(Math.min(k, 1 - k) / 0.15)); }
    });
    ions.commit(); wat.commit();
  };
  const post = (t, shot, lt) => ({ focus: camera.position.distanceTo(camera.userData.target), aperture: 5, maxCoc: 16, exposure: 0.98,
    bloom: 0.4, bloomThreshold: 0.95, vignette: 0.6, saturation: 1.12, contrast: 1.12 });
  const overlay = (ov, t) => {
    const gp = curves[1] ? curves[1].getPointAt(0.5) : v3(6, 0, 3);
    ov.label({ text: 'Guard cells', sub: 'contain chloroplasts', at: gp.clone().add(v3(1.5, 0, 2)), dx: 190, dy: -120, t0: 49.9, t1: 56.6 }, camera, t);
    ov.label({ text: 'Stoma', sub: 'the pore', at: v3(0, -4, 0), dx: -170, dy: -110, t0: 50.3, t1: 53.7 }, camera, t);
    ov.label({ text: 'Epidermal cell', sub: 'no chloroplasts', at: v3(23, 13, 1.6), dx: 70, dy: -70, t0: 50.6, t1: 53.4 }, camera, t);
    ov.caption({ text: 'Turgid guard cells → stoma opens', sub: 'K⁺ ions enter; water follows by osmosis', x: 0.075, y: 0.66, size: 34, weight: 700, t0: 50.0, t1: 53.5 }, t);
    ov.caption({ text: 'Flaccid guard cells → stoma narrows', sub: 'e.g. water stress (hormone ABA): K⁺ ions leave; water follows', x: 0.075, y: 0.66, size: 34, weight: 700, t0: 53.9, t1: 56.65 }, t);
    ov.label({ text: 'CO₂ in', sub: 'for photosynthesis', at: v3(-6, 6, 14), dx: -190, dy: -40, t0: 51.6, t1: 54.4, color: '#c8c8c8' }, camera, t);
    ov.label({ text: 'Water vapour out', at: v3(7, -8, 16), dx: 170, dy: 70, t0: 52.0, t1: 55.4, color: VAPOUR }, camera, t);
    ov.caption({ text: '●  K⁺ ions', x: 0.075, y: 0.765, size: 21, weight: 600, color: '#b48cff', t0: 50.0, t1: 56.65 }, t);
    ov.caption({ text: '●  water (osmosis)', x: 0.16, y: 0.765, size: 21, weight: 600, color: '#59adff', t0: 50.0, t1: 56.65 }, t);
    ov.note({ text: 'Stomata respond to light, CO₂ concentration and hormones such as abscisic acid (ABA)', align: 'right', y: 140, t0: 50.4, t1: 56.65 }, t);
    ov.scaleBar({ len: 10, text: '10 µm', dist: () => camera.position.distanceTo(camera.userData.target), t0: 50.2, t1: 56.6 }, camera, t);
  };
  return { scene, camera, update, post, overlay };
}
