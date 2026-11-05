// World: soil at the scale of root hairs (1 unit = 100 µm). Mineral grains carry
// thin water films and pendular water bridges where they nearly touch (a smooth
// union of grain distance fields, polygonised with marching cubes); larger pores
// hold air. A fine root sends root hairs out between the grains (s1b).
import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { organicMaterial, waterMaterial } from '../engine/materials.js';
import { studioEnv } from '../engine/studio.js';
import { CameraPath, rng, taperedTube, noise3, v3, clamp, smooth } from '../engine/util.js';

const DOMAIN = 6.5;         // marching-cubes cube half-size (units)
const RES = 128;            // grid resolution
const FILM = 0.07;          // film thickness (units → ~7 µm, exaggerated for visibility)
const K = 0.3;              // smooth-union radius → pendular bridges where grains nearly touch

export async function build(env) {
  const R = rng(21);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090b);
  scene.environment = studioEnv(env.renderer, { bg: 0x0b0d10, key: 0xffe9cf, rim: 0x7fb6ff });
  scene.environmentIntensity = 0.9;
  scene.fog = new THREE.FogExp2(0x07090b, 0.035);
  const key = new THREE.DirectionalLight(0xffe6c8, 2.6); key.position.set(-6, 9, 7); scene.add(key);
  const rim = new THREE.DirectionalLight(0x86b8ff, 1.8); rim.position.set(5, 3, -9); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x3a4650, 0x120c08, 0.6));

  // --- grains -------------------------------------------------------------------
  const kinds = [
    { color: 0xb8b1a4, noiseColor: 0x6d665c, sss: 0x2c2822, rough: 0.42, w: 0.45 },   // quartz
    { color: 0xc49c84, noiseColor: 0x7a5646, sss: 0x2a1a12, rough: 0.5, w: 0.2 },     // feldspar
    { color: 0x6b5644, noiseColor: 0x4a3a2c, sss: 0x120c08, rough: 0.6, w: 0.2 },     // weathered, iron-stained
    { color: 0x4a3626, noiseColor: 0x33241a, sss: 0x0a0604, rough: 0.85, w: 0.15 },   // organic matter
  ];
  const mats = kinds.map(k => organicMaterial({ color: k.color, roughness: k.rough, noiseAmp: 0.45, noiseScale: 2.2, noiseColor: k.noiseColor,
    sssColor: k.sss, sssStrength: 0.5, rimColor: 0xfff1de, rimStrength: 0.06, rimPower: 3 }));
  const grains = [];
  const tryPlace = (r) => {
    for (let a = 0; a < 200; a++) {
      const c = v3(R.range(-5.6, 5.6), R.range(-5.2, 3.0), R.range(-5.6, 4.6));
      if (c.distanceTo(v3(0.9, -0.4, 0.9)) < 1.3) continue;               // keep the hero pore open
      { // keep the camera's line of sight to the hero root hair clear
        const a = v3(0.4, -0.2, 0.6), b = v3(2.8, 0.4, 7.0), ab = b.clone().sub(a);
        const w = clamp(c.clone().sub(a).dot(ab) / ab.lengthSq());
        if (c.distanceTo(a.clone().addScaledVector(ab, w)) < r + 0.9) continue; }
      if (c.distanceTo(v3(1.9, -1.25, 0.3)) < 1.9 || c.distanceTo(v3(0.1, -1.55, 1.4)) < 1.8) continue;
      if (Math.abs(c.y - (2.9 + 0.2 * c.x)) < 1.6 && c.z < -1.5) continue; // keep clear of the root
      let ok = true;
      for (const g of grains) if (c.distanceTo(g.c) < (g.rmax + r) * 0.93) { ok = false; break; }
      if (ok) return c;
    }
    return null;
  };
  // two hero grains with a water bridge under the hero root-hair tip
  grains.push({ c: v3(1.9, -1.25, 0.3), r: v3(1.05, 0.85, 1.0), rmax: 1.05, q: new THREE.Quaternion(), qi: new THREE.Quaternion(), seed: 3.3, amp: 0.16, kind: 0 });
  grains.push({ c: v3(0.1, -1.55, 1.4), r: v3(0.95, 0.8, 0.9), rmax: 0.95, q: new THREE.Quaternion(), qi: new THREE.Quaternion(), seed: 9.1, amp: 0.15, kind: 1 });
  const sizes = [...Array(24)].map(() => R.range(0.75, 1.65)).concat([...Array(22)].map(() => R.range(0.22, 0.5)));
  sizes.sort((a, b) => b - a);
  for (const s of sizes) {
    const c = tryPlace(s); if (!c) continue;
    const rr = v3(s * R.range(0.8, 1.15), s * R.range(0.65, 1.0), s * R.range(0.8, 1.2));
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 6, R() * 6, R() * 6));
    const kind = (() => { let x = R(), acc = 0; for (let i = 0; i < kinds.length; i++) { acc += kinds[i].w; if (x <= acc) return i; } return 0; })();
    grains.push({ c, r: rr, rmax: Math.max(rr.x, rr.y, rr.z), q, qi: q.clone().invert(), seed: R.range(0, 100), amp: 0.2 * s, kind });
  }
  const sdfGrain = (g, p) => {
    const l = p.clone().sub(g.c).applyQuaternion(g.qi);
    const k = Math.hypot(l.x / g.r.x, l.y / g.r.y, l.z / g.r.z);
    const n = noise3(l.x * 1.3 + g.seed, l.y * 1.3, l.z * 1.3) * g.amp + noise3(l.x * 4 + g.seed, l.y * 4, l.z * 4) * g.amp * 0.25;
    return (k - 1) * Math.min(g.r.x, g.r.y, g.r.z) - n;
  };
  for (const g of grains) {
    let geo = new THREE.IcosahedronGeometry(1, g.rmax > 0.6 ? 6 : 4);
    geo.deleteAttribute('normal'); geo.deleteAttribute('uv'); geo = mergeVertices(geo); // shared vertices → smooth normals
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = v3(p.getX(i), p.getY(i), p.getZ(i)).normalize();
      const e = v3(u.x * g.r.x, u.y * g.r.y, u.z * g.r.z);
      const n = noise3(e.x * 1.3 + g.seed, e.y * 1.3, e.z * 1.3) * g.amp + noise3(e.x * 4 + g.seed, e.y * 4, e.z * 4) * g.amp * 0.25;
      e.addScaledVector(u, n);
      p.setXYZ(i, e.x, e.y, e.z);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mats[g.kind]); m.position.copy(g.c); m.quaternion.copy(g.q);
    scene.add(m);
  }

  // --- water films: smooth union of grain SDFs, offset by the film thickness -------------
  const water = waterMaterial({ color: 0x7cc0ff, opacity: 0.13, glow: 0x2a86f0, glowStrength: 0.07, fresAlpha: 0.85, envMapIntensity: 3.2, roughness: 0.02 });
  const mc = new MarchingCubes(RES, water, false, false, 600000);
  mc.isolation = 0;
  const N = RES, D = new Float32Array(N * N * N).fill(1e3), cell = 2 * DOMAIN / N;
  const smin = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k); return b + (a - b) * h - k * h * (1 - h); };
  const P = new THREE.Vector3();
  for (const g of grains) {
    const reach = g.rmax + g.amp + K + FILM + 0.2;
    const lo = (v) => Math.max(1, Math.floor((v - reach + DOMAIN) / cell)), hi = (v) => Math.min(N - 2, Math.ceil((v + reach + DOMAIN) / cell));
    for (let z = lo(g.c.z); z <= hi(g.c.z); z++) for (let y = lo(g.c.y); y <= hi(g.c.y); y++) for (let x = lo(g.c.x); x <= hi(g.c.x); x++) {
      P.set(x * cell - DOMAIN, y * cell - DOMAIN, z * cell - DOMAIN);
      const q = x + y * N + z * N * N;
      D[q] = smin(D[q], sdfGrain(g, P), K);
    }
  }
  // only keep films where grains are near each other or coated; fade water out near the domain walls
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const q = x + y * N + z * N * N;
    const wall = Math.min(x, y, z, N - 1 - x, N - 1 - y, N - 1 - z) * cell;
    mc.field[q] = -(D[q] - FILM) - (wall < 0.4 ? (0.4 - wall) : 0);
  }
  mc.update();
  mc.scale.setScalar(DOMAIN);
  mc.renderOrder = 5;
  scene.add(mc);

  // --- fine root with root hairs --------------------------------------------------------
  // epidermal cells: elongated along the root axis, staggered (canvas texture used as colour + bump)
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 1024;
  { const c = cv.getContext('2d'); c.fillStyle = '#e9dcc4'; c.fillRect(0, 0, 1024, 1024);
    const cols = 26, rows = 8, cw = 1024 / rows, ch = 1024 / cols;
    for (let j = 0; j < cols; j++) for (let i = -1; i < rows + 1; i++) {
      const x = (i + (j % 2) * 0.5) * cw, y = j * ch;
      c.fillStyle = `hsl(38, 32%, ${78 + 8 * R()}%)`; c.strokeStyle = '#a08866'; c.lineWidth = 5;
      c.beginPath(); c.roundRect(x + 3, y + 3, cw - 6, ch - 6, 10); c.fill(); c.stroke(); } }
  const epi = new THREE.CanvasTexture(cv); epi.colorSpace = THREE.SRGBColorSpace; epi.wrapS = epi.wrapT = THREE.RepeatWrapping; epi.repeat.set(3, 1); epi.anisotropy = 8;
  const rootMat = new THREE.MeshStandardMaterial({ map: epi, bumpMap: epi, bumpScale: 2.5, roughness: 0.45, color: 0xfff8ee, envMapIntensity: 1.0,
    emissive: 0x2a2010, emissiveIntensity: 0.6 });
  const rootCurve = new THREE.CatmullRomCurve3([v3(-11, 3.2, -4.5), v3(-5, 3.0, -3.6), v3(0, 3.3, -3.4), v3(6, 3.9, -4.2), v3(11, 4.4, -5.0)]);
  scene.add(new THREE.Mesh(taperedTube(rootCurve, () => 1.05, 120, 40), rootMat));
  const hairMat = organicMaterial({ color: 0xeee4cf, roughness: 0.3, transparent: true, opacity: 0.78, sssColor: 0x7a6440, sssStrength: 0.45,
    rimColor: 0xfffaf0, rimStrength: 0.9, rimPower: 2.2, envMapIntensity: 1.4, alphaFresnel: 0.6 });
  const hairs = [];
  const growHair = (s, dir, len, seed, hero = false) => {
    const rr = rng(seed);
    const base = rootCurve.getPointAt(s), tan = rootCurve.getTangentAt(s);
    const out = dir.clone().addScaledVector(tan, -dir.dot(tan)).normalize();
    const pts = [base.clone().addScaledVector(out, 0.9)];
    let p = pts[0].clone(), d = out.clone();
    const n = 9;
    for (let i = 0; i < n; i++) {
      d.add(v3(rr.range(-0.25, 0.25), rr.range(-0.25, 0.15), rr.range(-0.2, 0.25))).normalize();
      p = p.clone().addScaledVector(d, len / n); pts.push(p);
    }
    if (hero) { pts.length = 0; pts.push(base.clone().addScaledVector(out, 0.9), v3(-1.2, 1.4, -1.6), v3(-0.3, 0.6, -0.4), v3(0.4, 0.0, 0.5), v3(0.85, -0.55, 0.85), v3(1.02, -0.92, 0.88)); }
    const curve = new THREE.CatmullRomCurve3(pts);
    const g = taperedTube(curve, (u) => 0.062 * (u > 0.97 ? Math.sqrt(Math.max(0, 1 - ((u - 0.97) / 0.03) ** 2)) : 1) + 0.0001, 90, 12);
    const m = new THREE.Mesh(g, hairMat); m.renderOrder = 6; scene.add(m);
    hairs.push({ curve, hero });
  };
  for (let i = 0; i < 40; i++) {
    const s = 0.08 + 0.84 * (i / 46) + R.range(-0.01, 0.01);
    const a = R.range(-2.6, -0.2);
    growHair(s, v3(0, Math.sin(a), Math.cos(a) + 0.4), R.range(4.5, 8.5), 100 + i);
  }
  growHair(0.42, v3(0.2, -0.75, 0.75), 6.2, 7, true);
  const hero = hairs.find(h => h.hero).curve;

  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.05, 200);
  const path = new CameraPath([
    { t: 0.0, pos: [-1.6, 2.6, 15.0], tgt: [-0.2, 0.4, 0.0], fov: 38 },
    { t: 2.2, pos: [2.6, 0.35, 6.2], tgt: [0.75, -0.55, 0.75], fov: 34 },
  ]);
  const update = (t, shot, lt) => { path.apply(camera, lt); };
  const post = () => ({ focus: camera.position.distanceTo(hero.getPointAt(0.85)), aperture: 7, maxCoc: 20, exposure: 1.15, bloom: 0.45,
    bloomThreshold: 0.9, vignette: 0.55, saturation: 1.05, contrast: 1.08 });
  const overlay = (ov, t) => {
    ov.label({ text: 'Root hair cell', sub: 'a long, thin extension: large surface area', at: hero.getPointAt(0.62), dx: -170, dy: -100, t0: 4.2, t1: 5.75 }, camera, t);
    ov.label({ text: 'Water film', sub: 'clings to soil particles', at: v3(1.05, -1.18, 0.86), dx: 160, dy: 80, t0: 4.45, t1: 5.75 }, camera, t);
    ov.label({ text: 'Soil particle', at: v3(2.35, -0.75, 0.75), dx: 150, dy: -70, t0: 4.7, t1: 5.75 }, camera, t);
    ov.scaleBar({ len: 1, text: '100 µm', dist: () => camera.position.distanceTo(hero.getPointAt(0.82)), t0: 4.3, t1: 5.75 }, camera, t);
  };
  return { scene, camera, update, post, overlay };
}
