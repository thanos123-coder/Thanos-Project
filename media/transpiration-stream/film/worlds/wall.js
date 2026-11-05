// World: the wet surface of a mesophyll cell wall facing an air space (conceptual
// nanoscale view; 1 unit ≈ 1 nm, water molecules drawn ~4× enlarged).
// Cellulose microfibrils hold water in the narrow spaces between them. The water
// surface between neighbouring fibrils is a concave meniscus that meets each fibril
// tangentially (water wets cellulose). With the contact line at angle φ on a fibril,
// the meniscus radius is R = a / cos φ (a = half-gap). Evaporation makes the menisci
// retreat into the gaps: φ falls, R shrinks, and the pressure in the water becomes
// more negative — tension that pulls water through the wall from the xylem.
// Shots: s3b (evaporation: liquid → vapour), s4a (menisci curve, tension builds).
import * as THREE from 'three';
import { organicMaterial, waterMaterial, Sprites } from '../engine/materials.js';
import { studioEnv } from '../engine/studio.js';
import { CameraPath, rng, v3, clamp, smooth, noise3, remap, window01, easeInOut } from '../engine/util.js';
import { ACCENT, TENSION, VAPOUR } from '../engine/overlay.js';

const RF = 1.8, SP = 9, NF = 11, ZF = 6, ZB = -40, XB = 48, YB = -14; // fibrils, spacing, front/back, bounds
const K = 4.0;                  // molecule enlargement
const OH = [0.0757 * K, 0.0586 * K]; // H offsets from O (104.5° H–O–H, 0.096 nm bonds)

function meniscusProfile(phi, wrap = false) {
  // water surface: menisci in the gaps; with wrap=true the outline also follows the
  // immersed lower arc of each top fibril, so the fibril interior is not water
  const pts = [], xs = [...Array(NF)].map((_, i) => (i - (NF - 1) / 2) * SP);
  const yc = RF * Math.sin(phi);
  pts.push([-XB, yc]);
  const arcUnder = (xc) => { for (let k = 0; k <= 20; k++) { const a = Math.PI - phi + (Math.PI + 2 * phi) * (k / 20); pts.push([xc + (RF + 0.04) * Math.cos(a), (RF + 0.04) * Math.sin(a)]); } };
  if (wrap) arcUnder(xs[0]);
  for (let i = 0; i < NF - 1; i++) {
    const xl = xs[i] + RF * Math.cos(phi), xr = xs[i + 1] - RF * Math.cos(phi), a = (xr - xl) / 2, xm = (xl + xr) / 2;
    const R = a / Math.cos(phi), cy = yc + R * Math.sin(phi);
    for (let k = 0; k <= 24; k++) { const x = xl + (xr - xl) * k / 24; pts.push([x, cy - Math.sqrt(Math.max(0, R * R - (x - xm) ** 2))]); }
    if (wrap) arcUnder(xs[i + 1]);
  }
  pts.push([XB, yc]);
  return { pts, xs, yc };
}
function meniscusAt(phi, gap) { // geometry of one meniscus (gap index between fibrils gap, gap+1)
  const xs = (i) => (i - (NF - 1) / 2) * SP;
  const xl = xs(gap) + RF * Math.cos(phi), xr = xs(gap + 1) - RF * Math.cos(phi), a = (xr - xl) / 2, xm = (xl + xr) / 2;
  const R = a / Math.cos(phi), yc = RF * Math.sin(phi), cy = yc + R * Math.sin(phi);
  return { xm, cy, R, bottom: cy - R, a };
}

export async function build(env) {
  const R = rng(55);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03070b);
  scene.environment = studioEnv(env.renderer, { bg: 0x061018, key: 0xfff0dc, rim: 0x80b8ff });
  scene.fog = new THREE.FogExp2(0x03070b, 0.014);
  const key = new THREE.DirectionalLight(0xfff0e0, 2.4); key.position.set(-14, 24, 20); scene.add(key);
  const rim = new THREE.DirectionalLight(0x86baff, 1.5); rim.position.set(16, 8, -20); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x3a4a58, 0x0a0a0a, 0.5));

  // cellulose microfibrils: top layer along z, crossed layers beneath
  const fibMat = organicMaterial({ color: 0xdccfa8, roughness: 0.45, rimColor: 0xfff2d8, rimStrength: 0.3, sssColor: 0x3a3020, sssStrength: 0.3, noiseAmp: 0.5, noiseScale: 0.9, noiseColor: 0xa89870 });
  const fib = (len) => new THREE.CylinderGeometry(RF, RF, len, 40, 1, false);
  const ZF2 = ZF + 0.3; // caps sit just in front of the water's cut face
  for (let i = 0; i < NF; i++) { const m = new THREE.Mesh(fib(ZF2 - ZB), fibMat); m.rotation.x = Math.PI / 2; m.position.set((i - (NF - 1) / 2) * SP, 0, (ZF2 + ZB) / 2); scene.add(m); }
  for (let j = 0; j < 7; j++) { const m = new THREE.Mesh(fib(2 * XB), fibMat); m.rotation.z = Math.PI / 2; m.position.set(0, -4.6, ZF - 3.5 - j * 6.5); scene.add(m); }
  const deep = [...Array(NF)].map((_, i) => (i - (NF - 1) / 2) * SP + 4.5);
  for (const x of deep) { const m = new THREE.Mesh(fib(ZF2 - ZB), fibMat); m.rotation.x = Math.PI / 2; m.position.set(x, -9.2, (ZF2 + ZB) / 2); scene.add(m); }

  // the liquid water held in the wall (profile extruded along z, rebuilt as menisci retreat)
  const waterMat = waterMaterial({ color: 0x3f9cff, opacity: 0.32, glow: 0x2a86ff, glowStrength: 0.32, fresAlpha: 0.55, envMapIntensity: 2.2, side: THREE.DoubleSide });
  const water = new THREE.Mesh(new THREE.BufferGeometry(), waterMat); water.renderOrder = 8; scene.add(water);
  let lastPhi = -1;
  const setWater = (phi) => {
    if (Math.abs(phi - lastPhi) < 1e-4) return; lastPhi = phi;
    const { pts } = meniscusProfile(phi, true);
    const s = new THREE.Shape(); s.moveTo(-XB, YB); pts.forEach(p => s.lineTo(p[0], p[1])); s.lineTo(XB, YB); s.closePath();
    for (const x of deep) if (Math.abs(x) < XB - 3) { const h = new THREE.Path(); h.absarc(x, -9.2, RF + 0.04, 0, Math.PI * 2, true); s.holes.push(h); }
    const g = new THREE.ExtrudeGeometry(s, { depth: ZF - ZB, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, ZB);
    water.geometry.dispose(); water.geometry = g;
  };

  // --- molecules (O red, H white), conceptual & enlarged -------------------------------------
  const NL = 900, NE = 34, HERO = 1;
  const liq = [], eva = [];
  for (let i = 0; i < NL; i++) {
    const front = i < 380;
    liq.push({ x: R.range(-24, 24), z: front ? R.range(ZF - 1.6, ZF - 0.5) : R.range(-16, ZF - 0.5), d: front ? R.range(0.3, 2.6) : R.range(0.25, 0.9),
      q: new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 6, R() * 6, R() * 6)), ph: R() * 100 });
  }
  for (let i = 0; i < NE; i++) eva.push({ x: R.range(-20, 20), z: R.range(-12, ZF - 0.6), ph: R(), dir: v3(R.range(-0.6, 0.6), 1, R.range(-0.6, 0.6)).normalize(), sp: R.range(5, 9), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 6, R() * 6, R() * 6)), spin: v3(R.range(-2, 2), R.range(-2, 2), R.range(-2, 2)) });
  const atoms = new Sprites((NL + NE + HERO) * 3, { shape: 'sphere', renderOrder: 12 });
  const heroQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 1.1, 0.3));
  scene.add(atoms.mesh);
  const cO = new THREE.Color(0.92, 0.2, 0.16), cH = new THREE.Color(0.96, 0.96, 0.98);
  const surfY = (x, phi) => { // water surface height at x (meniscus profile)
    const { pts } = meniscusProfile(phi);
    for (let k = 0; k < pts.length - 1; k++) if (x >= pts[k][0] && x <= pts[k + 1][0]) { const f = (x - pts[k][0]) / (pts[k + 1][0] - pts[k][0]); return pts[k][1] + f * (pts[k + 1][1] - pts[k][1]); }
    return 0;
  };
  const profCache = new Map();
  const surfYc = (x, phi) => { const key = phi.toFixed(4) + ':' + x.toFixed(2); if (!profCache.has(key)) profCache.set(key, surfY(x, phi)); return profCache.get(key); };
  const P = new THREE.Vector3(), Q = new THREE.Quaternion(), E = new THREE.Euler(), H1 = new THREE.Vector3(), H2 = new THREE.Vector3();
  const putMol = (n, p, q, a) => {
    atoms.set(n * 3, p, 0.15 * K * 0.5 * 1.25, cO, a);
    H1.set(OH[0], OH[1], 0).applyQuaternion(q).add(p); H2.set(-OH[0], OH[1], 0).applyQuaternion(q).add(p);
    atoms.set(n * 3 + 1, H1, 0.12 * K * 0.5 * 1.15, cH, a); atoms.set(n * 3 + 2, H2, 0.12 * K * 0.5 * 1.15, cH, a);
  };
  let hero = new THREE.Vector3();

  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.05, 300);
  const paths = {
    s3b: new CameraPath([
      { t: 0.0, pos: [10, 16, 34], tgt: [0, -1, 0], fov: 38 },
      { t: 3.5, pos: [5.5, 7.5, 22], tgt: [1.5, -0.5, 0], fov: 36 },
    ]),
    s4a: new CameraPath([
      { t: 0.0, pos: [4.5, 4.0, 34], tgt: [4.5, -2.0, 6], fov: 36 },
      { t: 4.5, pos: [4.5, 1.2, 21], tgt: [4.5, -1.6, 6], fov: 34 },
    ]),
  };
  let phi = 1.15, mode = 's3b';
  const update = (t, shot, lt) => {
    mode = shot.id; paths[shot.id].apply(camera, lt);
    phi = shot.id === 's3b' ? 1.12 : THREE.MathUtils.lerp(1.12, 0.22, easeInOut(remap(lt, 0.6, 3.6)));
    setWater(phi); profCache.clear();
    let n = 0;
    for (const m of liq) {
      const jig = 0.25;
      const x = m.x + jig * noise3(m.ph, t * 1.6, 0), z = m.z + jig * noise3(m.ph, t * 1.6, 5);
      const y = surfYc(Math.round(x * 4) / 4, phi) - m.d - 0.35 + jig * noise3(m.ph, t * 1.6, 9);
      E.set(noise3(m.ph, t * 0.8, 1) * 2, noise3(m.ph, t * 0.8, 2) * 2, noise3(m.ph, t * 0.8, 3) * 2); Q.setFromEuler(E).multiply(m.q);
      P.set(x, y, z);
      // hide molecules that would sit inside a fibril
      const fx = Math.round(x / SP) * SP; const inF = Math.hypot(x - fx, y) < RF + 0.35;
      putMol(n++, P, Q, inF || shot.id === 's4a' ? 0 : 1);
    }
    const evapRate = shot.id === 's3b' ? 0.3 : 0.16;
    eva.forEach((m, i) => {
      const k = (t * evapRate + m.ph) % 1; // life cycle: leave the surface, fly off as vapour
      const y0 = surfYc(Math.round(m.x * 4) / 4, phi);
      P.set(m.x, y0 - 0.2, m.z).addScaledVector(m.dir, k * m.sp * 2.2);
      P.x += 0.8 * noise3(m.ph * 10, k * 3, 1); P.z += 0.8 * noise3(m.ph * 10, k * 3, 4);
      E.set(m.spin.x * k * 6, m.spin.y * k * 6, m.spin.z * k * 6); Q.setFromEuler(E).multiply(m.q);
      putMol(n++, P, Q, smooth(k / 0.05) * (1 - smooth((k - 0.75) / 0.25)));
    });
    // hero molecule: leaves the water surface in view and drifts into the air space
    { const k = clamp((t - 22.35) / 2.9);
      const y0 = surfYc(4.5, phi);
      P.set(4.5 + 1.2 * k, y0 - 0.25 + 9.5 * k * k + 2.2 * k, ZF - 1.2 + 1.5 * k);
      E.set(k * 3, k * 2, k); Q.setFromEuler(E).multiply(heroQ);
      putMol(n++, P, Q, shot.id === 's3b' ? smooth((t - 22.2) / 0.2) : 0); hero.copy(P); }
    atoms.sortBy(camera); atoms.commit();
  };
  const post = (t, shot, lt) => ({ focus: camera.position.distanceTo(camera.userData.target), aperture: shot.id === 's3b' ? 7 : 5, maxCoc: 18,
    exposure: 1.12, bloom: 0.45, bloomThreshold: 0.9, vignette: 0.5, saturation: 1.05, contrast: 1.06 });
  const overlay = (ov, t, shot, lt) => {
    if (shot.id === 's3b') {
      ov.label({ text: 'Cell wall', sub: 'cellulose microfibrils', at: v3(-9, RF * 0.6, 2), dx: -170, dy: -80, t0: 22.3, t1: 24.95 }, camera, t);
      ov.label({ text: 'Liquid water', sub: 'wets the cell wall', at: v3(4.5, -0.6, ZF - 1), dx: -150, dy: 110, t0: 22.5, t1: 24.95 }, camera, t);
      ov.label({ text: 'Evaporation', sub: 'liquid → gas', at: hero.clone(), dx: 170, dy: -60, t0: 22.75, t1: 25.0, color: VAPOUR }, camera, t);
      ov.label({ text: 'Air space', at: v3(-14, 9, -6), dx: -120, dy: -50, t0: 23.4, t1: 25.0 }, camera, t);
      ov.note({ text: 'Conceptual molecular view · molecules enlarged, not to scale', align: 'right', y: 96, t0: 22.3, t1: 25.0 }, t);
      ov.caption({ text: '●  oxygen   ●  hydrogen   (H₂O)', x: 0.075, y: 0.78, size: 21, weight: 600, color: '#ffb0a6', t0: 22.6, t1: 25.0 }, t);
    } else {
      const m = meniscusAt(phi, 5);
      ov.caption({ text: 'Evaporation creates tension', sub: 'menisci retreat and curve more → the water pressure falls below zero', x: 0.075, y: 0.66, size: 38, weight: 700, t0: 30.45, t1: 34.25 }, t);
      ov.label({ text: 'Meniscus', sub: 'curved water surface', at: v3(m.xm + m.a * 0.55, m.cy - Math.sqrt(m.R * m.R - (m.a * 0.55) ** 2), ZF), dx: 170, dy: -110, t0: 30.8, t1: 33.0 }, camera, t);
      ov.radius({ center: v3(m.xm, m.cy, ZF), edge: v3(m.xm, m.bottom, ZF), text: 'r', t0: 31.4, t1: 34.25 }, camera, t);
      ov.caption({ text: 'smaller r → more negative pressure', x: 0.075, y: 0.78, size: 22, weight: 600, color: TENSION, t0: 31.8, t1: 34.25 }, t);
      ov.gauge({ x: 0.9, y0: 0.72, y1: 0.28, title: 'Pressure in the water', top: '0 (atmospheric)', bottom: 'negative (tension)', topColor: '#a9e0ff', bottomColor: '#ffb184',
        c0: TENSION, c1: '#8fd3ff', t0: 30.9, t1: 34.25, value: (tt) => remap(tt, 30.6, 33.6, 0.88, 0.1) }, t);
      ov.arrow({ from: v3(m.xm, -12.5, ZF), to: v3(m.xm, m.bottom - 1.2, ZF), text: 'water pulled toward the surface', tdx: -30, tdy: 0, align: 'right', width: 8, t0: 32.4, t1: 34.25 }, camera, t);
    }
  };
  return { scene, camera, update, post, overlay };
}
