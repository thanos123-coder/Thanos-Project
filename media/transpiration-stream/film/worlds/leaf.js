// World: 3D block of a dicot leaf (1 unit = 10 µm; leaf ~190 µm thick), cut at its
// front (z = ZC) and right (x = XC) faces. Top → bottom: waxy cuticle, upper
// epidermis (no chloroplasts), palisade mesophyll (columnar, many chloroplasts),
// spongy mesophyll (irregular, large air spaces, wet walls), lower epidermis with
// stomata (chloroplast-bearing guard cells over a substomatal cavity). A vein with
// xylem (upper side) and phloem (lower side) inside a bundle sheath.
// Shots: s3a (anatomy, water to mesophyll), s3c (vapour diffusion out of a stoma),
// s4b (tension transmitted back to the xylem).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { organicMaterial, waterMaterial, Sprites } from '../engine/materials.js';
import { studioEnv } from '../engine/studio.js';
import { CameraPath, rng, v3, clamp, smooth, noise3, remap, window01 } from '../engine/util.js';
import { ACCENT, VAPOUR, TENSION } from '../engine/overlay.js';

const XC = 30, ZC = 14;               // cut planes
const VEIN = v3(-15, 0.2, 0);         // vein centre (runs along z)
const STOMA = v3(6, -7.45, 13.0);     // hero stoma, centred on the front cut
const STOMATA = [STOMA, v3(-4, -7.45, 3), v3(20, -7.45, -6), v3(10, -7.45, -11)];

export async function build(env) {
  const R = rng(17);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020507);
  scene.environment = studioEnv(env.renderer, { bg: 0x081014, key: 0xfff4e2, rim: 0x86c0ff, keyI: 5 });
  scene.environmentIntensity = 0.85;
  scene.fog = new THREE.FogExp2(0x020507, 0.012);
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.6); sun.position.set(-10, 40, 18); scene.add(sun);
  const fill = new THREE.DirectionalLight(0x8ab8ff, 0.9); fill.position.set(14, -30, 20); scene.add(fill);
  const rim = new THREE.DirectionalLight(0x9fd0ff, 1.0); rim.position.set(20, 10, -30); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x46525a, 0x0e0e0e, 0.5));

  const clip = [new THREE.Plane(v3(0, 0, -1), ZC), new THREE.Plane(v3(-1, 0, 0), XC)];
  const withClip = (m) => { m.clippingPlanes = clip; m.clipShadows = true; return m; };
  const cellMat = (o) => withClip(organicMaterial({ side: THREE.DoubleSide, roughness: 0.42, rimPower: 2.6, ...o }));

  // --- cuticle & epidermis ----------------------------------------------------------
  const cutMat = withClip(new THREE.MeshPhysicalMaterial({ color: 0xf2e6b8, roughness: 0.12, transparent: true, opacity: 0.45, clearcoat: 1, clearcoatRoughness: 0.05, depthWrite: false }));
  const cut = new THREE.Mesh(new RoundedBoxGeometry(2 * XC + 4, 0.55, 2 * ZC + 4, 2, 0.2), cutMat); cut.position.set(0, 9.72, 0); cut.renderOrder = 7; scene.add(cut);
  const cut2 = new THREE.Mesh(new RoundedBoxGeometry(2 * XC + 4, 0.3, 2 * ZC + 4, 2, 0.12), cutMat); cut2.position.set(0, -8.45, 0); cut2.renderOrder = 7; scene.add(cut2);
  const epiMat = cellMat({ color: 0xdfe8d8, roughness: 0.3, rimColor: 0xffffff, rimStrength: 0.35, sssColor: 0x3a4438, sssStrength: 0.45, backColor: 0xc9d4c0, envMapIntensity: 1.2 });
  const epiGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.16);
  const epi = [];
  for (const [y, h, lower] of [[8.5, 1.7, false], [-7.45, 1.5, true]]) {
    for (let x = -XC - 2; x < XC + 2; x += 3.5) for (let z = -ZC - 2; z < ZC + 2; z += 3.5) {
      const cx = x + R.range(-0.3, 0.3), cz = z + R.range(-0.3, 0.3);
      if (lower && STOMATA.some(s => Math.hypot(cx - s.x, cz - s.z) < 2.6)) continue;
      epi.push([cx, y, cz, R.range(3.0, 3.5), h, R.range(3.0, 3.5)]);
    }
  }
  const epiMesh = new THREE.InstancedMesh(epiGeo, epiMat, epi.length);
  epi.forEach(([x, y, z, w, h, d], i) => epiMesh.setMatrixAt(i, new THREE.Matrix4().makeScale(w, h, d).setPosition(x, y, z)));
  scene.add(epiMesh);

  // --- chloroplast container (filled as cells are made) ------------------------------
  const chl = []; // matrices
  const addChloroplasts = (center, axis, radius, halfLen, n, rr) => {
    for (let i = 0; i < n; i++) {
      const a = rr.range(0, Math.PI * 2), h = rr.range(-halfLen, halfLen);
      const nrm = v3(Math.cos(a), 0, Math.sin(a));
      const p = center.clone().add(v3(nrm.x * (radius - 0.33), h, nrm.z * (radius - 0.33)));
      if (axis === 'blob') { const d = rr.sphere(); p.copy(center).addScaledVector(d, radius - 0.35); nrm.copy(d); }
      const q = new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), nrm).multiply(new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), rr.range(0, 3)));
      chl.push(new THREE.Matrix4().compose(p, q, v3(0.42, 0.2, 0.3)));
    }
  };

  // --- palisade mesophyll ----------------------------------------------------------------
  const palMat = cellMat({ color: 0x86b866, roughness: 0.4, rimColor: 0xdfffc8, rimStrength: 0.35, sssColor: 0x1c3a10, sssStrength: 0.55,
    backColor: 0xc3dcae, noiseAmp: 0.5, noiseScale: 0.8, noiseColor: 0x5e9446 });
  const palGeo = new THREE.CapsuleGeometry(1, 4, 6, 16);
  const pal = [];
  for (let gx = -XC - 2, row = 0; gx < XC + 2; gx += 2.3, row++) for (let gz = -ZC - 2; gz < ZC + 2; gz += 2.3) {
    const x = gx + R.range(-0.18, 0.18), z = gz + (row % 2) * 1.15 + R.range(-0.18, 0.18);
    if (Math.abs(x - VEIN.x) < 5.0) continue; // the vein's bundle sheath extends up here
    pal.push({ p: v3(x, 4.55, z), r: R.range(0.92, 1.06), tilt: v3(R.range(-0.05, 0.05), 0, R.range(-0.05, 0.05)) });
  }
  const palMesh = new THREE.InstancedMesh(palGeo, palMat, pal.length);
  pal.forEach((c, i) => {
    palMesh.setMatrixAt(i, new THREE.Matrix4().compose(c.p, new THREE.Quaternion().setFromEuler(new THREE.Euler(c.tilt.x, 0, c.tilt.z)), v3(c.r, 1, c.r)));
    addChloroplasts(c.p, 'col', c.r, 2.4, 13, R);
  });
  scene.add(palMesh);

  // --- spongy mesophyll ------------------------------------------------------------------
  const spongyGeos = [0, 1, 2, 3].map(k => {
    let g = new THREE.IcosahedronGeometry(1, 4); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 1 + 0.28 * noise3(x * 1.1 + k * 7, y * 1.1, z * 1.1) + 0.1 * noise3(x * 2.6, y * 2.6 + k, z * 2.6);
      p.setXYZ(i, x * n * 1.15, y * n * 0.85, z * n * 1.15); }
    g.computeVertexNormals(); return g;
  });
  const sponMat = cellMat({ color: 0xa8cf88, roughness: 0.16, rimColor: 0xd8f0ff, rimStrength: 0.45, sssColor: 0x1e3a14, sssStrength: 0.45,
    backColor: 0xcfe2bc, envMapIntensity: 1.6, noiseAmp: 0.4, noiseScale: 0.9, noiseColor: 0x77a85c });
  const spon = [];
  const cavity = (p) => STOMATA.some(s => Math.hypot(p.x - s.x, p.z - s.z) < 2.6 && p.y < -3.4);
  for (let tries = 0; tries < 9000 && spon.length < 420; tries++) {
    const p = v3(R.range(-XC - 2, XC + 2), R.range(-5.6, 0.7), R.range(-ZC - 2, ZC + 2));
    if (Math.hypot(p.x - VEIN.x, p.y - VEIN.y) < 6.6) continue;
    if (cavity(p)) continue;
    if (spon.some(s => s.p.distanceTo(p) < 3.05)) continue;
    spon.push({ p, r: R.range(1.35, 1.6), k: R.int(0, 3), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 6, R() * 6, R() * 6)) });
  }
  const sponMeshes = spongyGeos.map((g, k) => {
    const list = spon.filter(s => s.k === k);
    const im = new THREE.InstancedMesh(g, sponMat, list.length);
    list.forEach((s, i) => { im.setMatrixAt(i, new THREE.Matrix4().compose(s.p, s.q, v3(s.r, s.r, s.r))); addChloroplasts(s.p, 'blob', s.r, 0, 6, R); });
    scene.add(im); return im;
  });

  // --- guard cells (stomata) -----------------------------------------------------------
  const guardMat = cellMat({ color: 0xa9d48c, roughness: 0.38, rimColor: 0xf0ffe0, rimStrength: 0.4, sssColor: 0x22401a, sssStrength: 0.45, backColor: 0x8ab878 });
  const guards = [];
  for (const s of STOMATA) for (const side of [-1, 1]) {
    const pts = []; for (let i = 0; i <= 12; i++) { const f = i / 12; pts.push(v3(s.x + side * (0.95 + 0.55 * Math.sin(Math.PI * f)), s.y + 0.05, s.z + (f - 0.5) * 3.6)); }
    const c = new THREE.CatmullRomCurve3(pts);
    const g = new THREE.TubeGeometry(c, 40, 0.82, 16); guards.push(new THREE.Mesh(g, guardMat));
    for (let i = 0; i < 6; i++) chl.push(new THREE.Matrix4().compose(c.getPointAt(0.15 + 0.7 * i / 5).add(v3(side * 0.15, 0.2, 0)), new THREE.Quaternion(), v3(0.3, 0.18, 0.24)));
  }
  guards.forEach(m => scene.add(m));

  // --- vein: bundle sheath, xylem (upper), phloem (lower) ------------------------------------
  const sheathMat = cellMat({ color: 0xcfdcae, roughness: 0.4, rimColor: 0xffffff, rimStrength: 0.25, sssColor: 0x2a3418, sssStrength: 0.4, backColor: 0xe0e8c8 });
  for (let i = 0; i < 13; i++) {
    const a = i / 13 * Math.PI * 2, x = VEIN.x + 5.2 * Math.cos(a), y = VEIN.y + 4.6 * Math.sin(a);
    const g = new THREE.CapsuleGeometry(1.35, 2 * ZC + 2, 4, 14); g.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(g, sheathMat); m.position.set(x, y, 0); scene.add(m);
  }
  const xyWall = cellMat({ color: 0xa65a2a, rimColor: 0xffc898, rimStrength: 0.35, sssColor: 0x401808, sssStrength: 0.45 });
  const lumen = withClip(waterMaterial({ color: 0x3d9cff, opacity: 0.6, glow: 0x2a86ff, glowStrength: 0.6, fresAlpha: 0.3, depthWrite: true, flowDir: [0, 0, 1], flowSpeed: 1.2, flowScale: 0.5, flowStrength: 0.5 }));
  const xylemPts = [[-1.9, 2.1, 0.95], [0.1, 2.5, 1.15], [2.0, 1.9, 0.9], [-0.9, 0.3, 0.8], [1.1, 0.4, 0.75]];
  const xylem = xylemPts.map(([dx, dy, r]) => {
    const p = v3(VEIN.x + dx, VEIN.y + dy, 0);
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.32, r + 0.32, 2 * ZC + 2, 24, 1, true).rotateX(Math.PI / 2), xyWall); shell.position.copy(p); scene.add(shell);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 2 * ZC + 2, 24, 1, false).rotateX(Math.PI / 2), lumen); w.position.copy(p); w.renderOrder = 5; scene.add(w);
    return { p, r };
  });
  const phlMat = cellMat({ color: 0xc8d49a, rimColor: 0xf6ffd8, rimStrength: 0.25, sssColor: 0x303818, sssStrength: 0.35, backColor: 0xb0bc84 });
  for (let i = 0; i < 11; i++) {
    const a = Math.PI + 0.25 + (i / 10) * (Math.PI - 0.5), rr = R.range(1.2, 2.9);
    const g = new THREE.CylinderGeometry(0.55, 0.55, 2 * ZC + 2, 14, 1, false).rotateX(Math.PI / 2);
    const m = new THREE.Mesh(g, phlMat); m.position.set(VEIN.x + rr * Math.cos(a), VEIN.y - 0.6 + rr * Math.sin(a) * 0.9, 0); scene.add(m);
  }
  // chloroplasts (instanced, after all cells)
  const chlMat = withClip(organicMaterial({ color: 0x3f9a2c, roughness: 0.35, rimColor: 0xb8ff90, rimStrength: 0.4, sssColor: 0x0c3006, sssStrength: 0.6, noiseAmp: 0.5, noiseScale: 6, noiseColor: 0x1d5a14 }));
  const chlMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), chlMat, chl.length);
  chl.forEach((m, i) => chlMesh.setMatrixAt(i, m)); chlMesh.renderOrder = 2; scene.add(chlMesh);

  // --- water: liquid paths (xylem → cell walls) and vapour (air spaces → stoma → out) -----------
  const liquid = [], vapourPaths = [];
  const nearSpon = (p) => spon.reduce((b, s) => (s.p.distanceTo(p) < b.p.distanceTo(p) ? s : b), spon[0]);
  // paths drawn on the section (cut face): xylem → bundle sheath → around cut spongy cells (in their
  // walls) → walls bordering the air spaces above the stoma. These stay visible in the cutaway.
  const ZF = ZC + 0.25;
  const faceCells = spon.map(c => { const dz = ZC - c.p.z; if (Math.abs(dz) >= c.r * 0.95) return null; return { c: v3(c.p.x, c.p.y, ZF), r: Math.sqrt(c.r * c.r - dz * dz) * 1.08 }; }).filter(Boolean);
  for (let k = 0; k < 14; k++) {
    const x0 = xylem[k % xylem.length];
    let cur = v3(x0.p.x, x0.p.y, ZF);
    const pts = [cur.clone(), v3(VEIN.x + 3.4, VEIN.y + R.range(-2.5, 2.5), ZF), v3(VEIN.x + 6.0, VEIN.y + R.range(-3.6, 1.6), ZF)];
    cur = pts[2].clone();
    const goal = v3(STOMA.x + R.range(-3.5, 1.0), -4.6 + R.range(-0.8, 0.8), ZF);
    const used = new Set();
    for (let hop = 0; hop < 9 && cur.x < goal.x - 1.5; hop++) {
      let best = null, bd = 1e9;
      for (const fc of faceCells) {
        if (used.has(fc) || fc.c.x < cur.x + 0.6 || Math.abs(fc.c.y - THREE.MathUtils.lerp(cur.y, goal.y, 0.35)) > 3.2) continue;
        const d = fc.c.distanceTo(cur) + 0.6 * Math.abs(fc.c.y - goal.y);
        if (d < bd) { bd = d; best = fc; }
      }
      if (!best) break;
      used.add(best);
      const ein = cur.clone().sub(best.c).normalize(), eout = goal.clone().sub(best.c).normalize();
      const a0 = Math.atan2(ein.y, ein.x); let a1 = Math.atan2(eout.y, eout.x);
      if (a1 - a0 > Math.PI) a1 -= 2 * Math.PI; if (a0 - a1 > Math.PI) a1 += 2 * Math.PI;
      for (const f of [0, 0.5, 1]) { const a = a0 + (a1 - a0) * f; pts.push(v3(best.c.x + best.r * Math.cos(a), best.c.y + best.r * Math.sin(a), ZF)); }
      cur = pts[pts.length - 1].clone();
    }
    pts.push(goal);
    liquid.push(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3));
  }
  for (let k = 0; k < 10; k++) {
    const x = xylem[k % 3]; const z = R.range(-6, ZC - 0.6);
    const pts = [v3(x.p.x + R.range(-0.3, 0.3), x.p.y + 0.4, z)];
    let cur = v3(VEIN.x + 6.2, VEIN.y + R.range(-3.5, 1.5), z);
    pts.push(v3(VEIN.x + 4.6, VEIN.y + R.range(-1, 2), z), cur.clone());
    for (let step = 0; step < 6; step++) {
      const target = cur.clone().add(v3(R.range(2.0, 4.0), R.range(-1.6, 0.9), R.range(-1, 1)));
      const s = nearSpon(target);
      const dir = target.clone().sub(s.p).normalize();
      pts.push(s.p.clone().addScaledVector(dir, s.r * 1.08)); cur = pts[pts.length - 1].clone();
    }
    liquid.push(new THREE.CatmullRomCurve3(pts));
  }
  for (let k = 0; k < 40; k++) {
    const st = k < 30 ? STOMA : STOMATA[1 + (k % 3)];
    const s = spon.filter(c => c.p.distanceTo(st) < 11 && c.p.y > -5.5).sort(() => R() - 0.5)[0] || spon[0];
    const start = s.p.clone().add(R.sphere().multiplyScalar(s.r * 1.1));
    const mid = v3(st.x + R.range(-1.2, 1.2), -4.6 + R.range(-0.6, 0.6), st.z + R.range(-1.2, 1.2));
    const pts = [start, start.clone().lerp(mid, 0.5).add(R.sphere().multiplyScalar(1.2)), mid, v3(st.x, -7.3, st.z), v3(st.x + R.range(-0.5, 0.5), -9.6, st.z + R.range(-0.4, 0.6)),
      v3(st.x + R.range(-4, 4), -13 - R.range(0, 3), st.z + R.range(-1, 5))];
    vapourPaths.push(new THREE.CatmullRomCurve3(pts));
  }
  const LQ = 8, VP = 3;
  const liqS = new Sprites(liquid.length * LQ, { shape: 'sphere', renderOrder: 14 });
  const vapS = new Sprites(vapourPaths.length * VP, { shape: 'sphere', renderOrder: 15 });
  const TN = 26;
  const tenS = new Sprites(liquid.length * TN, { shape: 'soft', additive: true, renderOrder: 16 });
  scene.add(liqS.mesh, vapS.mesh, tenS.mesh);
  const cBlue = new THREE.Color(0.32, 0.7, 1.0), cVap = new THREE.Color(0.85, 0.94, 1.0), cTen = new THREE.Color(1.0, 0.55, 0.25), P = new THREE.Vector3();

  // --- cameras ---------------------------------------------------------------------------
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.05, 500);
  const paths = {
    s3a: new CameraPath([
      { t: 0.0, pos: [8, 26, 58], tgt: [-1, 2, 8], fov: 40 },
      { t: 0.95, pos: [-0.5, 5.0, 51], tgt: [-1.5, 0.6, 10], fov: 38 },
      { t: 3.05, pos: [0.6, 4.2, 48.5], tgt: [-0.8, 0.2, 10], fov: 38 },
      { t: 4.0, pos: [3.4, -1.0, 23.5], tgt: [4.6, -2.4, 12.8], fov: 34 },
    ]),
    s3c: new CameraPath([
      { t: 0.0, pos: [3.4, -1.0, 23.5], tgt: [4.6, -2.6, 12.8], fov: 36 },
      { t: 2.2, pos: [4.0, -2.2, 24.5], tgt: [5.6, -5.8, 13], fov: 36 },
      { t: 4.0, pos: [7.5, -12.5, 26], tgt: [6, -8.0, 13], fov: 36 },
      { t: 5.7, pos: [10, -17.5, 30], tgt: [6, -9.5, 13], fov: 38 },
    ]),
    s4b: new CameraPath([
      { t: 0.0, pos: [3.4, -1.0, 23.5], tgt: [4.6, -2.4, 12.8], fov: 34 },
      { t: 2.4, pos: [-5, 5.0, 46], tgt: [-6, 0.0, 9], fov: 38 },
    ]),
  };
  let mode = 's3a';
  const update = (t, shot, lt) => {
    mode = shot.id; paths[shot.id].apply(camera, lt);
    const showLiq = shot.id === 's3a' ? smooth((lt - 1.8) / 0.8) : shot.id === 's4b' ? 1 : 0.5;
    const spd = shot.id === 's4b' ? 0.42 : 0.26;
    let n = 0;
    for (const c of liquid) for (let j = 0; j < LQ; j++) {
      const k = (t * spd + j / LQ) % 1; c.getPointAt(k, P);
      liqS.set(n++, P, 0.22, cBlue, showLiq * smooth(k / 0.06) * smooth((1 - k) / 0.1));
    }
    liqS.commit();
    const showVap = shot.id === 's3c' ? 1 : shot.id === 's3a' ? smooth((lt - 2.6) / 0.8) * 0.8 : 0.5;
    n = 0;
    for (let i = 0; i < vapourPaths.length; i++) for (let j = 0; j < VP; j++) {
      const k = (t * 0.085 + j / VP + i * 0.137) % 1; vapourPaths[i].getPointAt(k, P);
      // random thermal motion: individual vapour molecules wander while drifting outward
      const amp = 0.5 + 1.6 * Math.abs(k - 0.62);
      P.x += amp * noise3(i, j, t * 1.3); P.y += amp * 0.6 * noise3(i + 5, j, t * 1.3); P.z += amp * noise3(i + 9, j, t * 1.3);
      vapS.set(n++, P, 0.15, cVap, showVap * smooth(k / 0.08) * smooth((1 - k) / 0.12));
    }
    vapS.commit();
    n = 0;
    // tension: spreads back from the evaporating surfaces (path end) to the xylem (path start), then persists
    const showTen = shot.id === 's4b' ? 1 : 0;
    const front = 1 - smooth((lt - 0.35) / 1.0);
    for (const c of liquid) for (let j = 0; j < TN; j++) {
      const k = j / (TN - 1); c.getPointAt(k, P);
      const lit = smooth((k - front) / 0.12) * (0.34 + 0.14 * Math.sin(t * 5 + j * 0.9));
      tenS.set(n++, P, 0.42, cTen, showTen * lit);
    }
    tenS.commit();
  };
  const post = (t, shot, lt) => ({ focus: camera.position.distanceTo(camera.userData.target), aperture: shot.id === 's3a' && lt < 2.9 ? 3 : 6, maxCoc: 16,
    exposure: 1.12, bloom: 0.45, bloomThreshold: 0.9, vignette: 0.5, saturation: 1.06, contrast: 1.06 });

  const xyl = xylem[1].p.clone().setZ(ZC);
  const overlay = (ov, t, shot) => {
    if (shot.id === 's3a') {
      const C = (text, at, ey, i, sub, ex = 0.8) => ov.label({ text, sub, at, ex, ey, t0: 18.9 + i * 0.12, t1: 21.45, size: 26 }, camera, t);
      C('Waxy cuticle', v3(9, 9.95, ZC), 0.13, 0);
      C('Upper epidermis', v3(10, 8.5, ZC), 0.2, 1, 'no chloroplasts');
      C('Chloroplasts', v3(9.2, 5.6, ZC - 0.6), 0.29, 2);
      C('Palisade mesophyll', v3(12.5, 3.2, ZC), 0.37, 3);
      C('Spongy mesophyll', v3(12, -1.2, ZC), 0.49, 4);
      C('Air space', v3(9.6, -3.6, ZC), 0.58, 5);
      C('Lower epidermis', v3(12.5, -7.45, ZC), 0.68, 6);
      C('Stoma & guard cells', STOMA.clone().setY(-7.9), 0.77, 7);
      ov.label({ text: 'Xylem', sub: 'in a leaf vein', at: xyl, ex: 0.12, ey: 0.30, t0: 19.0, t1: 21.45, size: 26 }, camera, t);
      ov.label({ text: 'Water moves from the xylem', sub: 'into the walls of mesophyll cells', at: v3(-6.5, -1.5, ZC), dx: -140, dy: 120, t0: 20.75, t1: 22.0, color: ACCENT }, camera, t);
    }
    if (shot.id === 's3c') {
      ov.label({ text: 'Air spaces', at: v3(3.0, -4.4, ZC), dx: -170, dy: -60, t0: 24.9, t1: 26.7 }, camera, t);
      ov.caption({ text: 'Water-vapour diffusion', sub: 'from humid air spaces to the drier air outside', x: 0.075, y: 0.66, size: 38, weight: 700, t0: 25.7, t1: 30.0 }, t);
      ov.label({ text: 'Stoma', sub: 'open pore between two guard cells', at: STOMA.clone().setY(-7.7), dx: 190, dy: -40, t0: 27.4, t1: 30.05 }, camera, t);
      ov.label({ text: 'Atmosphere', sub: 'drier air', at: v3(8.5, -12.5, 14), dx: 170, dy: 60, t0: 28.6, t1: 30.1 }, camera, t);
      ov.caption({ text: '●  liquid water', x: 0.075, y: 0.765, size: 22, weight: 600, color: '#59adff', t0: 25.0, t1: 30.0 }, t);
      ov.caption({ text: '●  water vapour (gas)', x: 0.075, y: 0.80, size: 22, weight: 600, color: VAPOUR, t0: 25.0, t1: 30.0 }, t);
    }
    if (shot.id === 's4b') {
      ov.caption({ text: 'Tension is transmitted', sub: 'through the continuous water in cell walls and xylem', x: 0.075, y: 0.66, size: 38, weight: 700, color: '#ffffff', t0: 34.25, t1: 36.1 }, t);
      ov.label({ text: 'Xylem', at: xyl, dx: -150, dy: -80, t0: 34.6, t1: 36.1 }, camera, t);
      ov.arrow({ from: v3(VEIN.x + 6.5, -1.2, ZF + 0.5), to: v3(STOMA.x - 1, -3.6, ZF + 0.5), text: 'pull on the water, toward the evaporating surfaces', tdx: 0, tdy: -34,
        t0: 34.75, t1: 36.1, c0: '#ffd2b0', c1: TENSION, width: 9 }, camera, t);
      ov.caption({ text: '●  tension in the water (spreads back to the xylem)', x: 0.075, y: 0.765, size: 22, weight: 600, color: TENSION, t0: 34.4, t1: 36.1 }, t);
      ov.caption({ text: '●  water moving toward evaporating surfaces', x: 0.075, y: 0.80, size: 22, weight: 600, color: '#59adff', t0: 34.4, t1: 36.1 }, t);
    }
  };
  return { scene, camera, update, post, overlay };
}
