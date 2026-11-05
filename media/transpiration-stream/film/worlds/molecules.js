// World: water inside a xylem vessel at molecular scale (1 unit = 1 Å; conceptual,
// motion greatly slowed). Ball-and-stick H2O (O–H 0.96 Å, H–O–H 104.5°): covalent
// bonds are solid sticks; hydrogen bonds are dotted lines, recomputed every frame
// from geometry (H···O ≤ ~2.4 Å, O–H···O near-linear), so they form and break as
// molecules jostle. The wall is cellulose with surface –OH groups; water–wall
// hydrogen bonds (adhesion) are drawn in amber. Shots: s5a (cohesion), s5b (adhesion).
import * as THREE from 'three';
import { organicMaterial, DashedBonds } from '../engine/materials.js';
import { studioEnv } from '../engine/studio.js';
import { CameraPath, rng, v3, clamp, smooth, noise3, remap, window01 } from '../engine/util.js';
import { ACCENT, TENSION } from '../engine/overlay.js';

const BOX = { x0: -11.2, x1: 15, y0: -13, y1: 13, z0: -12, z1: 7 };
const WALLX = -14.6;
const HL = [[0.757, 0.586, 0], [-0.757, 0.586, 0]]; // H positions in the molecule frame (Å)

export async function build(env) {
  const R = rng(77);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030a12);
  scene.environment = studioEnv(env.renderer, { bg: 0x061420, key: 0xfff2e2, rim: 0x7fc0ff });
  scene.environmentIntensity = 0.9;
  scene.fog = new THREE.FogExp2(0x041220, 0.028);
  const key = new THREE.DirectionalLight(0xfff0e4, 2.3); key.position.set(-8, 14, 16); scene.add(key);
  const rim = new THREE.DirectionalLight(0x80c0ff, 1.6); rim.position.set(10, -4, -14); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x3a5060, 0x0a0a10, 0.6));

  // --- water molecules: jittered lattice at liquid density ---------------------------------
  const mols = [];
  const sp = 3.1;
  for (let x = BOX.x0; x < BOX.x1; x += sp) for (let y = BOX.y0; y < BOX.y1; y += sp) for (let z = BOX.z0; z < BOX.z1; z += sp) {
    mols.push({ p0: v3(x + R.range(-0.38, 0.38), y + R.range(-0.38, 0.38), z + R.range(-0.38, 0.38)), ph: R() * 100, q: new THREE.Quaternion(), p: v3(), H: [v3(), v3()] });
  }
  const N = mols.length;
  const sphere = new THREE.SphereGeometry(1, 20, 12);
  const oMat = organicMaterial({ color: 0xe0322a, roughness: 0.32, rimColor: 0xffb0a0, rimStrength: 0.3, sssColor: 0x400806, sssStrength: 0.3, physical: true, clearcoat: 0.6 });
  const hMat = organicMaterial({ color: 0xf2f2f4, roughness: 0.3, rimColor: 0xffffff, rimStrength: 0.25, sssColor: 0x303038, sssStrength: 0.25, physical: true, clearcoat: 0.6 });
  const stickGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false); stickGeo.translate(0, 0.5, 0);
  const stickMat = organicMaterial({ color: 0xd8d8dc, roughness: 0.35, rimColor: 0xffffff, rimStrength: 0.2 });
  const Om = new THREE.InstancedMesh(sphere, oMat, N + 64), Hm = new THREE.InstancedMesh(sphere, hMat, 2 * N + 64), Sm = new THREE.InstancedMesh(stickGeo, stickMat, 2 * N + 64);
  scene.add(Om, Hm, Sm);
  const coh = new DashedBonds(1400, { color: 0x9fe6ff, dash: 0.32, intensity: 2.0 }); coh.radius = 0.07; scene.add(coh.mesh);
  const adh = new DashedBonds(160, { color: 0xffb35a, dash: 0.32, intensity: 2.3 }); adh.radius = 0.085; scene.add(adh.mesh);

  // --- xylem wall: cellulose chains with surface hydroxyl groups -------------------------
  const wallGroup = new THREE.Group(); scene.add(wallGroup);
  const cMat = organicMaterial({ color: 0x8c8a84, roughness: 0.45, rimColor: 0xffffff, rimStrength: 0.2 });
  const wallOH = []; // {O, H}
  const ringPts = (c, rot) => [...Array(6)].map((_, k) => { const a = k / 6 * Math.PI * 2 + rot; return v3(c.x, c.y + 1.35 * Math.cos(a), c.z + 1.35 * Math.sin(a)); });
  const cAtoms = [], cBonds = [];
  for (let z = BOX.z0 + 1; z <= BOX.z1 + 2; z += 5.4) for (let y = BOX.y0 - 2; y <= BOX.y1 + 2; y += 5.15) {
    const c = v3(WALLX + 0.4 * Math.sin(y), y, z + ((y / 5.15) % 2 ? 0.4 : -0.4));
    const pts = ringPts(c, (Math.round(y / 5.15) % 2) * 0.5);
    pts.forEach((p, k) => { cAtoms.push(p); cBonds.push([p, pts[(k + 1) % 6]]); });
    // glycosidic link to the next ring along the chain
    cBonds.push([pts[0], v3(c.x, c.y + 2.6, c.z)]);
    // a hydroxyl pointing into the vessel lumen (toward +x)
    const base = pts[2], O = base.clone().add(v3(1.35, 0.2, 0.3)), H = O.clone().add(v3(0.85, 0.35, 0.2));
    wallOH.push({ O, H, base });
  }
  const cIm = new THREE.InstancedMesh(sphere, cMat, cAtoms.length); cAtoms.forEach((p, i) => cIm.setMatrixAt(i, new THREE.Matrix4().makeScale(0.42, 0.42, 0.42).setPosition(p))); wallGroup.add(cIm);
  const bIm = new THREE.InstancedMesh(stickGeo, cMat, cBonds.length + wallOH.length * 2);
  const stick = (m, a, b, r) => { const d = b.clone().sub(a); const L = d.length(); m.compose(a, new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), d.normalize()), v3(r, L, r)); return m; };
  cBonds.forEach(([a, b], i) => bIm.setMatrixAt(i, stick(new THREE.Matrix4(), a, b, 0.16)));
  wallOH.forEach((w, i) => { bIm.setMatrixAt(cBonds.length + 2 * i, stick(new THREE.Matrix4(), w.base, w.O, 0.16)); bIm.setMatrixAt(cBonds.length + 2 * i + 1, stick(new THREE.Matrix4(), w.O, w.H, 0.14)); });
  wallGroup.add(bIm);
  const wOIm = new THREE.InstancedMesh(sphere, oMat, wallOH.length), wHIm = new THREE.InstancedMesh(sphere, hMat, wallOH.length);
  wallOH.forEach((w, i) => { wOIm.setMatrixAt(i, new THREE.Matrix4().makeScale(0.6, 0.6, 0.6).setPosition(w.O)); wHIm.setMatrixAt(i, new THREE.Matrix4().makeScale(0.34, 0.34, 0.34).setPosition(w.H)); });
  wallGroup.add(wOIm, wHIm);
  // a soft backdrop sheet for the wall (the rest of the lignified wall, out of focus)
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.8 }));
  sheet.rotation.y = Math.PI / 2; sheet.position.x = WALLX - 1.8; scene.add(sheet);

  // --- per-frame molecular dynamics (deterministic, stateless) --------------------------------
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), tmp = v3(), tmp2 = v3();
  const hLocal = HL.map(h => v3(...h));
  const bLocal = hLocal[0].clone().add(hLocal[1]).normalize(), nLocal = hLocal[0].clone().cross(hLocal[1]).normalize(), tLocal = bLocal.clone().cross(nLocal);
  const Rl = new THREE.Matrix4().makeBasis(tLocal, bLocal, nLocal).transpose();
  let heroBond = null, heroMol = null, heroAdh = null;
  const H = BOX.y1 - BOX.y0;
  const update = (t, shot, lt) => {
    paths[shot.id].apply(camera, lt);
    const drift = 0.9 * t; // the whole column creeps upward (pulled from above)
    for (const m of mols) {
      const wallDist = clamp((m.p0.x - BOX.x0) / 6); // molecules next to the wall move less (adhesion)
      let y = m.p0.y + drift * (0.35 + 0.65 * wallDist);
      y = BOX.y0 + (((y - BOX.y0) % H) + H) % H;
      m.p.set(m.p0.x + 0.42 * noise3(m.ph, t * 0.9, 0), y + 0.42 * noise3(m.ph, t * 0.9, 3), m.p0.z + 0.42 * noise3(m.ph, t * 0.9, 6));
    }
    // orient each molecule so its H atoms point toward nearby oxygens (soft-weighted)
    for (const m of mols) {
      const cands = [];
      for (const o of mols) { if (o === m) continue; const d = o.p.distanceTo(m.p); if (d < 3.6 && Math.abs(o.p.y - m.p.y) < 3.6) cands.push([d, o.p]); }
      for (const w of wallOH) { const d = w.O.distanceTo(m.p); if (d < 3.6) cands.push([d - 0.2, w.O]); }
      cands.sort((a, b) => a[0] - b[0]);
      let d1, d2;
      if (cands.length >= 2) {
        d1 = cands[0][1].clone().sub(m.p).normalize();
        d2 = v3(); let ws = 0;
        for (let k = 1; k < Math.min(4, cands.length); k++) { const w = Math.exp(-(cands[k][0] - cands[1][0]) / 0.25); const u = cands[k][1].clone().sub(m.p).normalize(); if (u.dot(d1) > 0.6) continue; d2.addScaledVector(u, w); ws += w; }
        if (ws === 0 || d2.lengthSq() < 1e-6) d2 = v3(-d1.y, d1.x, d1.z).normalize(); else d2.normalize();
      } else { d1 = v3(1, 0, 0); d2 = v3(0, 1, 0); }
      d1.applyAxisAngle(v3(0, 0, 1), 0.25 * noise3(m.ph, t * 0.7, 9)); d2.applyAxisAngle(v3(1, 0, 0), 0.25 * noise3(m.ph, t * 0.7, 12));
      const B = d1.clone().add(d2).normalize(), Nn = d1.clone().cross(d2).normalize(), T = B.clone().cross(Nn);
      M4.makeBasis(T, B, Nn).multiply(Rl); m.q.setFromRotationMatrix(M4);
      m.H[0].copy(hLocal[0]).applyQuaternion(m.q).add(m.p); m.H[1].copy(hLocal[1]).applyQuaternion(m.q).add(m.p);
    }
    // draw
    mols.forEach((m, i) => {
      Om.setMatrixAt(i, M4.makeScale(0.64, 0.64, 0.64).setPosition(m.p));
      for (let k = 0; k < 2; k++) {
        Hm.setMatrixAt(2 * i + k, M4.makeScale(0.36, 0.36, 0.36).setPosition(m.H[k]));
        Sm.setMatrixAt(2 * i + k, stick(M4, m.p, m.H[k], 0.15));
      }
    });
    Om.count = N; Hm.count = 2 * N; Sm.count = 2 * N;
    Om.instanceMatrix.needsUpdate = Hm.instanceMatrix.needsUpdate = Sm.instanceMatrix.needsUpdate = true;
    // hydrogen bonds: donor H → acceptor O, distance and angle criteria, faded smoothly
    coh.begin(); adh.begin(); heroBond = null; heroAdh = null;
    let best = 1e9, bestA = 1e9;
    const cam = camera.position, tg = camera.userData.target;
    for (const m of mols) for (let k = 0; k < 2; k++) {
      const h = m.H[k], oh = tmp.copy(h).sub(m.p).normalize();
      for (const o of mols) {
        if (o === m) continue;
        const d = h.distanceTo(o.p); if (d > 2.5 || d < 1.4) continue;
        const ang = oh.dot(tmp2.copy(o.p).sub(h).normalize()); if (ang < 0.55) continue;
        const a = smooth((2.5 - d) / 0.45) * smooth((ang - 0.55) / 0.3);
        if (a < 0.02) continue;
        const from = h.clone().lerp(o.p, 0.14), to = h.clone().lerp(o.p, 0.78);
        coh.add(from, to, a);
        const sc = from.distanceTo(tg) - a * 2; if (sc < best && a > 0.7) { best = sc; heroBond = from.clone().lerp(to, 0.5); }
      }
      for (const w of wallOH) {
        const d = h.distanceTo(w.O); if (d > 2.7 || d < 1.3) continue;
        const a = smooth((2.7 - d) / 0.5);
        const from = h.clone().lerp(w.O, 0.14), to = h.clone().lerp(w.O, 0.8);
        adh.add(from, to, a);
        const sc = from.distanceTo(tg); if (sc < bestA) { bestA = sc; heroAdh = from.clone().lerp(to, 0.5); }
      }
    }
    // the wall's own OH groups also donate H-bonds to water oxygens
    for (const w of wallOH) for (const m of mols) {
      const d = w.H.distanceTo(m.p); if (d > 2.6 || d < 1.3) continue;
      adh.add(w.H.clone().lerp(m.p, 0.14), w.H.clone().lerp(m.p, 0.76), smooth((2.6 - d) / 0.5));
    }
    coh.end(); adh.end();
    let hb = 1e9; for (const m of mols) { const d = m.p.distanceTo(tg); if (d < hb) { hb = d; heroMol = m.p; } }
    void cam;
  };

  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.05, 300);
  const paths = {
    s5a: new CameraPath([
      { t: 0.0, pos: [4.5, 1.5, 17.5], tgt: [2.5, 0.5, 0.0], fov: 36 },
      { t: 4.4, pos: [6.0, -1.0, 21.5], tgt: [2.0, 0.0, -0.5], fov: 36 },
      { t: 7.7, pos: [8.5, -3.5, 30.0], tgt: [1.5, 0.0, -1.5], fov: 38 },
    ]),
    s5b: new CameraPath([
      { t: 0.0, pos: [1.5, -1.0, 24.0], tgt: [-6.0, 0.0, -1.0], fov: 38 },
      { t: 4.4, pos: [-3.0, 0.5, 15.5], tgt: [-12.0, 0.5, -1.5], fov: 36 },
    ]),
  };
  const post = (t, shot, lt) => ({ focus: camera.position.distanceTo(camera.userData.target), aperture: 8, maxCoc: 20, exposure: 1.12,
    bloom: 0.45, bloomThreshold: 0.95, vignette: 0.55, saturation: 1.05, contrast: 1.06 });
  const overlay = (ov, t, shot) => {
    ov.note({ text: 'Conceptual molecular model · motion greatly slowed · not to scale', align: 'right', y: 96, t0: 38.6, t1: 49.6 }, t);
    if (shot.id === 's5a') {
      ov.caption({ text: 'Cohesion', sub: 'water molecules attract one another through hydrogen bonds', x: 0.075, y: 0.66, size: 40, weight: 700, t0: 38.6, t1: 45.6 }, t);
      if (heroMol) ov.label({ text: 'Water molecule', sub: 'H₂O: one oxygen, two hydrogens (bent shape)', at: heroMol.clone(), dx: 170, dy: -110, t0: 38.9, t1: 41.6 }, camera, t);
      if (heroBond) ov.label({ text: 'Hydrogen bonds', sub: 'constantly forming and breaking', at: heroBond.clone(), dx: 180, dy: 100, t0: 40.3, t1: 45.5, color: '#9fe6ff' }, camera, t);
      ov.caption({ text: 'solid stick: covalent bond (within a molecule)', x: 0.075, y: 0.765, size: 21, weight: 600, color: '#e8e8ec', t0: 39.6, t1: 45.6 }, t);
      ov.caption({ text: 'dotted line: hydrogen bond (between molecules)', x: 0.075, y: 0.80, size: 21, weight: 600, color: '#9fe6ff', t0: 39.6, t1: 45.6 }, t);
      ov.arrow({ from: [0.9, 0.66], to: [0.9, 0.24], text: 'Continuous column', sub: 'pulled upward as one', tdx: -36, tdy: 0, align: 'right', t0: 43.1, t1: 45.6, c0: '#a8e4ff', c1: TENSION }, camera, t);
    } else {
      ov.caption({ text: 'Adhesion', sub: 'water molecules are attracted to the xylem wall', x: 0.075, y: 0.66, size: 40, weight: 700, t0: 45.9, t1: 49.55 }, t);
      ov.label({ text: 'Xylem wall', sub: 'cellulose with –OH groups', at: v3(WALLX + 0.3, 3.0, 2.0), dx: -60, dy: -170, t0: 46.15, t1: 49.5 }, camera, t);
      if (heroAdh) ov.label({ text: 'Water–wall hydrogen bond', at: heroAdh.clone(), dx: 180, dy: 110, t0: 46.6, t1: 49.5, color: '#ffb35a' }, camera, t);
      ov.caption({ text: 'blue dots: water–water hydrogen bonds (cohesion)', x: 0.075, y: 0.765, size: 21, weight: 600, color: '#9fe6ff', t0: 46.2, t1: 49.55 }, t);
      ov.caption({ text: 'amber dots: water–wall hydrogen bonds (adhesion)', x: 0.075, y: 0.80, size: 21, weight: 600, color: '#ffb35a', t0: 46.2, t1: 49.55 }, t);
    }
  };
  return { scene, camera, update, post, overlay };
}
