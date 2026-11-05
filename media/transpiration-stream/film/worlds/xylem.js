// World: xylem vessels in longitudinal cutaway (1 unit = 10 µm). Vessel elements
// are dead, hollow and lignified, joined end to end through perforation plates
// (only their rims remain); the walls carry bordered pits. A neighbouring
// protoxylem vessel shows helical thickening. The lumen holds a continuous column
// of liquid water moving upward (s2b), pulled by tension from the leaves (s4c).
import * as THREE from 'three';
import { organicMaterial, waterMaterial, Sprites } from '../engine/materials.js';
import { studioEnv } from '../engine/studio.js';
import { CameraPath, rng, v3, clamp, smooth, noise3, remap, window01 } from '../engine/util.js';
import { TENSION } from '../engine/overlay.js';

const Y0 = -60, Y1 = 90, RIN = 2.3, ROUT = 2.75, ELEM = 26;

function annulusSector(r0, r1, a0, a1, len) {
  const s = new THREE.Shape();
  s.moveTo(r1 * Math.cos(a0), r1 * Math.sin(a0)); s.absarc(0, 0, r1, a0, a1, false);
  s.lineTo(r0 * Math.cos(a1), r0 * Math.sin(a1)); s.absarc(0, 0, r0, a1, a0, true);
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, curveSegments: 64, steps: Math.round(len / 1.2) });
  g.rotateX(-Math.PI / 2); // extrusion axis z → y
  return g;
}

/** Lignified wall with bordered pits: procedural colour + derivative bump. */
function pittedWall(o = {}) {
  const m = organicMaterial({ color: o.color ?? 0xb0693a, roughness: 0.42, sssColor: 0x401808, sssStrength: 0.4, rimColor: 0xffc898, rimStrength: 0.22,
    noiseAmp: 0.35, noiseScale: 0.35, noiseColor: 0x7a3e1c, side: THREE.DoubleSide });
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh) => {
    prev(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `
        float pitH(vec3 p){
          float ang = atan(p.x, p.z) * ${RIN.toFixed(2)};
          vec2 q = vec2(ang / 0.62, p.y / 0.5);
          q.x += mod(floor(q.y), 2.0) * 0.5;
          vec2 f = fract(q) - 0.5;
          float e = length(f * vec2(1.0, 1.55));
          float border = smoothstep(0.42, 0.30, e);          // bordered pit dome
          float ap = smoothstep(0.15, 0.08, length(f * vec2(0.55, 3.2))); // slit aperture
          return border * 0.6 - ap * 1.0;
        }
        void main() {`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float h = pitH(vOPos);
          vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
          float dhx = dFdx(h), dhy = dFdy(h);
          vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
          normal = normalize(abs(det) * normal - grad * 0.06);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        { float h = pitH(vOPos); diffuseColor.rgb *= 1.0 - 0.45 * clamp(-h, 0.0, 1.0) + 0.12 * clamp(h, 0.0, 1.0); }`);
  };
  m.customProgramCacheKey = () => 'pittedWall';
  return m;
}

export async function build(env) {
  const R = rng(41);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04070b);
  scene.environment = studioEnv(env.renderer, { bg: 0x081018, key: 0xffecd6, rim: 0x80b8ff });
  scene.environmentIntensity = 0.9;
  scene.fog = new THREE.FogExp2(0x04070b, 0.018);
  const key = new THREE.DirectionalLight(0xffeedd, 2.4); key.position.set(-12, 10, 16); scene.add(key);
  const rim = new THREE.DirectionalLight(0x7fb6ff, 1.6); rim.position.set(10, 6, -14); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x3c4652, 0x0c0c0c, 0.5));

  // hero metaxylem vessel, cut open toward the camera (+z)
  const wallMat = pittedWall();
  const open = 0.62 * Math.PI; // width of the opening
  const wall = new THREE.Mesh(annulusSector(RIN, ROUT, Math.PI / 2 + open / 2, Math.PI / 2 + 2 * Math.PI - open / 2, Y1 - Y0), wallMat);
  wall.rotation.y = Math.PI; // gap is at -z after the X rotation; turn it to face the camera (+z)
  wall.position.y = Y0; scene.add(wall);
  // perforation-plate rims where vessel elements join
  const rimMat = organicMaterial({ color: 0x9a5530, roughness: 0.4, rimColor: 0xffc898, rimStrength: 0.3, sssColor: 0x401808, sssStrength: 0.4 });
  for (let y = Y0 + ELEM; y < Y1; y += ELEM) {
    const g = new THREE.TorusGeometry(RIN - 0.05, 0.2, 10, 64, 2 * Math.PI - open);
    g.rotateX(Math.PI / 2);                 // ring in the XZ plane, arc starts at +x and runs toward +z
    g.rotateY(-(Math.PI / 2 + open / 2));   // start the arc just past the opening (centred on +z)
    const m = new THREE.Mesh(g, rimMat); m.position.y = y; scene.add(m);
  }
  // water column (liquid) filling the lumen
  const water = waterMaterial({ color: 0x3e9bff, opacity: 0.42, glow: 0x2a86ff, glowStrength: 0.45, fresAlpha: 0.45, envMapIntensity: 2.0,
    flowDir: [0, 1, 0], flowSpeed: 2.2, flowScale: 0.55, flowStrength: 0.7 });
  const col = new THREE.Mesh(new THREE.CylinderGeometry(RIN - 0.06, RIN - 0.06, Y1 - Y0, 64, 40, true), water);
  col.position.y = (Y0 + Y1) / 2; col.renderOrder = 8; scene.add(col);

  // protoxylem vessel with helical thickening (left)
  const thinWall = organicMaterial({ color: 0xd8c39a, roughness: 0.4, transparent: true, opacity: 0.32, depthWrite: false, rimColor: 0xfff0d0, rimStrength: 0.4 });
  const proto = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.55, Y1 - Y0, 40, 1, true), thinWall);
  proto.position.set(-6.4, (Y0 + Y1) / 2, -1.2); scene.add(proto);
  const helix = []; for (let i = 0; i <= 900; i++) { const y = Y0 + (Y1 - Y0) * i / 900, a = y / 1.15 * Math.PI * 2; helix.push(v3(-6.4 + 1.48 * Math.cos(a), y, -1.2 + 1.48 * Math.sin(a))); }
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), 1800, 0.17, 6), rimMat));
  const protoWater = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, Y1 - Y0, 32, 1, true), waterMaterial({ color: 0x3e9bff, opacity: 0.3, glow: 0x2a86ff, glowStrength: 0.35, flowStrength: 0.5, flowSpeed: 2.2, flowScale: 0.7 }));
  protoWater.position.copy(proto.position); scene.add(protoWater);
  // a second pitted vessel behind-right, and fibres/parenchyma in the background
  const v2 = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, Y1 - Y0, 48, 1, true), pittedWall({ color: 0x9c5a32 }));
  v2.position.set(6.6, (Y0 + Y1) / 2, -3.2); scene.add(v2);
  const bgMat = organicMaterial({ color: 0x6e5a40, roughness: 0.6, sssColor: 0x201408, sssStrength: 0.4 });
  for (let i = 0; i < 26; i++) {
    const r = R.range(0.7, 1.5), x = R.range(-22, 22), z = R.range(-24, -6);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, Y1 - Y0, 16, 1, true), bgMat); m.position.set(x, (Y0 + Y1) / 2, z); scene.add(m);
  }

  // flow tracers inside the hero vessel (liquid water moving up)
  const N = 700, dots = new Sprites(N, { shape: 'sphere', renderOrder: 12 });
  scene.add(dots.mesh);
  const seeds = Array.from({ length: N }, () => ({ a: R.range(-open / 2 + 0.15, open / 2 - 0.15) + Math.PI / 2, r: Math.sqrt(R()) * (RIN - 0.3), y: R.range(Y0, Y1), ph: R() * 50, sp: R.range(0.85, 1.15) }));
  const blue = new THREE.Color(0.42, 0.76, 1.0), P = new THREE.Vector3();

  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.05, 400);
  const paths = {
    s2b: new CameraPath([
      { t: 0.0, pos: [1.4, -30, 10.5], tgt: [0, -22, 0], fov: 38 },
      { t: 2.8, pos: [0.9, -6, 8.4], tgt: [0, 3, 0], fov: 36 },
    ]),
    s4c: new CameraPath([
      { t: 0.0, pos: [-1.0, 10, 9.0], tgt: [0, 22, 0], fov: 38 },
      { t: 2.9, pos: [0.6, 34, 7.2], tgt: [0, 48, 0], fov: 36 },
    ]),
  };
  let speed = 3.2;
  const update = (t, shot, lt) => {
    paths[shot.id].apply(camera, lt);
    speed = shot.id === 's4c' ? 4.2 : 3.2;
    water.userData.u.flowSpeed.value = speed * 0.7;
    seeds.forEach((s, i) => {
      let y = s.y + t * speed * s.sp; y = Y0 + ((y - Y0) % (Y1 - Y0) + (Y1 - Y0)) % (Y1 - Y0);
      const a = s.a + 0.05 * noise3(s.ph, t * 0.6, 0), r = s.r + 0.08 * noise3(s.ph, t * 0.6, 3);
      P.set(r * Math.cos(a), y, r * Math.sin(a));
      dots.set(i, P, 0.085, blue, 0.85 * smooth((y - Y0) / 4) * smooth((Y1 - y) / 4));
    });
    dots.commit();
  };
  const post = (t, shot, lt) => ({ focus: camera.position.distanceTo(camera.userData.target) * 0.8, aperture: 6, maxCoc: 18, exposure: 1.1,
    bloom: 0.5, bloomThreshold: 0.85, vignette: 0.55, saturation: 1.06, contrast: 1.07 });
  const rel = (dx, dy, dz) => { const tg = camera.userData.target; return v3(tg.x + dx, tg.y + dy, tg.z + dz); };
  const overlay = (ov, t, shot) => {
    if (shot.id === 's2b') {
      ov.label({ text: 'Xylem vessel', sub: 'dead, hollow cells joined end to end', at: rel(-2.4, -3, 1.2), dx: -190, dy: -80, t0: 14.15, t1: 16.2 }, camera, t);
      ov.label({ text: 'Lignified wall', sub: 'strong, waterproof, with pits', at: rel(2.6, 1.5, 0.6), dx: 170, dy: -90, t0: 14.5, t1: 16.2 }, camera, t);
      ov.label({ text: 'Liquid water', sub: 'a continuous column', at: rel(0.2, -1.5, 1.6), dx: 190, dy: 90, t0: 14.85, t1: 16.2 }, camera, t);
      ov.arrow({ from: rel(-0.6, -9, 2.2), to: rel(-0.6, 3.5, 2.2), text: 'Upward water transport', tdx: -210, tdy: 0, align: 'right', t0: 14.7, t1: 16.2 }, camera, t);
      ov.scaleBar({ len: 2, text: '20 µm', dist: () => camera.position.distanceTo(camera.userData.target) * 0.8, t0: 14.2, t1: 16.2 }, camera, t);
    } else {
      ov.caption({ text: 'Transpiration pull', sub: 'tension from the leaves pulls the water column upward', x: 0.075, y: 0.66, size: 40, weight: 700, t0: 36.1, t1: 38.45 }, t);
      ov.arrow({ from: rel(0.0, -8, 2.4), to: rel(0.0, 5, 2.4), t0: 36.0, t1: 38.45, c0: '#ffd2b0', c1: TENSION, width: 10, text: 'pull', tdx: 50, tdy: 0, align: 'left' }, camera, t);
      ov.arrow({ from: [0.9, 0.3], to: [0.9, 0.62], t0: 36.6, t1: 38.45, c0: '#c8c8c8', c1: '#8a8a8a', width: 7, head: 22, text: 'gravity', tdx: -24, tdy: 0, align: 'right' }, camera, t);
    }
  };
  return { scene, camera, update, post, overlay };
}
