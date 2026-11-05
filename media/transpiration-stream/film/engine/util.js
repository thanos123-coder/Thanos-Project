// Shared helpers: deterministic randomness, noise, easing and camera paths.
import * as THREE from 'three';

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const remap = (x, a, b, c = 0, d = 1) => lerp(c, d, clamp((x - a) / (b - a)));
export const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
export const smoother = (x) => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
export const easeInOut = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
export const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
export const easeIn = (x) => Math.pow(clamp(x), 3);
/** 0 → 1 over [a, a+fi], hold, 1 → 0 over [b-fo, b]. */
export const window01 = (t, a, b, fi = 0.35, fo = 0.35) =>
  Math.min(smooth((t - a) / fi), smooth((b - t) / fo));

/** Mulberry32 seeded PRNG. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  const r = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.normal = () => { const u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  r.sphere = () => { const z = r.range(-1, 1), a = r.range(0, Math.PI * 2), q = Math.sqrt(1 - z * z); return new THREE.Vector3(q * Math.cos(a), z, q * Math.sin(a)); };
  return r;
}

// --- 3D simplex noise (Stefan Gustavson, public domain) -------------------------
const grad3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
const perm = new Uint8Array(512);
{ const r = rng(1337); const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
export function noise3(xin, yin, zin) {
  const F3 = 1 / 3, G3 = 1 / 6;
  const s = (xin + yin + zin) * F3;
  const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
  const t = (i + j + k) * G3;
  const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
    else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
  } else {
    if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
    else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
    else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
  }
  const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
  const ii = i & 255, jj = j & 255, kk = k & 255;
  const c = (x, y, z, g) => { let tt = 0.6 - x * x - y * y - z * z; if (tt < 0) return 0; tt *= tt; const gr = grad3[g % 12]; return tt * tt * (gr[0] * x + gr[1] * y + gr[2] * z); };
  const n0 = c(x0, y0, z0, perm[ii + perm[jj + perm[kk]]]);
  const n1 = c(x1, y1, z1, perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]]);
  const n2 = c(x2, y2, z2, perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]]);
  const n3 = c(x3, y3, z3, perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]]);
  return 32 * (n0 + n1 + n2 + n3);
}
export const fbm3 = (x, y, z, oct = 4) => { let a = 0.5, f = 1, s = 0; for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f); f *= 2.03; a *= 0.5; } return s; };

/** Smooth camera path through keyframes: {t, pos, tgt, fov?, roll?}. Times are local seconds. */
export class CameraPath {
  constructor(keys, { ease = easeInOut } = {}) {
    this.keys = keys;
    this.ease = ease;
    this.pc = new THREE.CatmullRomCurve3(keys.map(k => new THREE.Vector3(...k.pos)), false, 'centripetal');
    this.tc = new THREE.CatmullRomCurve3(keys.map(k => new THREE.Vector3(...k.tgt)), false, 'centripetal');
    if (keys.length < 2) throw new Error('CameraPath needs 2+ keys');
  }
  /**
   * Map time → curve parameter with a monotone cubic (Fritsch–Carlson) through
   * (t_i, i/n): every key is reached exactly at its time, velocity is continuous,
   * and the move eases in and out at the ends.
   */
  param(t) {
    const k = this.keys, n = k.length - 1;
    if (!this._m) {
      const d = []; for (let i = 0; i < n; i++) d.push((1 / n) / (k[i + 1].t - k[i].t));
      const m = [0]; for (let i = 1; i < n; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : 2 / (1 / d[i - 1] + 1 / d[i]));
      m.push(0);
      this._m = m;
    }
    const tt = clamp(t, k[0].t, k[n].t);
    let i = 0; while (i < n - 1 && tt > k[i + 1].t) i++;
    const h = k[i + 1].t - k[i].t, x = (tt - k[i].t) / h;
    const h00 = 2 * x ** 3 - 3 * x ** 2 + 1, h10 = x ** 3 - 2 * x ** 2 + x, h01 = -2 * x ** 3 + 3 * x ** 2, h11 = x ** 3 - x ** 2;
    const u = clamp(h00 * (i / n) + h10 * h * this._m[i] + h01 * ((i + 1) / n) + h11 * h * this._m[i + 1]);
    const seg = Math.min(n - 1, Math.floor(u * n)), f = u * n - seg;
    return { u, i: seg, f };
  }
  apply(cam, t) {
    const { u, i, f } = this.param(t);
    cam.position.copy(this.pc.getPoint(u));
    const tgt = this.tc.getPoint(u);
    const k0 = this.keys[i], k1 = this.keys[i + 1];
    const fov0 = k0.fov ?? cam.fov, fov1 = k1.fov ?? fov0;
    cam.fov = lerp(fov0, fov1, smooth(f));
    cam.up.set(0, 1, 0);
    const roll = lerp(k0.roll ?? 0, k1.roll ?? 0, smooth(f));
    cam.lookAt(tgt);
    if (roll) cam.rotateZ(roll);
    cam.updateProjectionMatrix();
    cam.userData.target = tgt;
    return tgt;
  }
}

/** Gentle hand-held drift so locked-off shots still breathe (deterministic). */
export function drift(cam, t, amp = 0.002, seed = 0) {
  const x = noise3(t * 0.35, seed, 0.5) * amp, y = noise3(seed, t * 0.31, 2.1) * amp;
  cam.rotateY(x); cam.rotateX(y);
}

/** Tube along a curve with a radius profile r(u) — for roots, stems, hairs, fibres. */
export function taperedTube(curve, radiusFn, tubular = 64, radial = 12, closed = false) {
  const frames = curve.computeFrenetFrames(tubular, closed);
  const pos = [], nor = [], uv = [], idx = [];
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const u = i / tubular; curve.getPointAt(u, P);
    const r = radiusFn(u);
    for (let j = 0; j <= radial; j++) {
      const v = j / radial * Math.PI * 2, s = Math.sin(v), c = -Math.cos(v);
      N.set(0, 0, 0).addScaledVector(frames.normals[i], c).addScaledVector(frames.binormals[i], s).normalize();
      pos.push(P.x + r * N.x, P.y + r * N.y, P.z + r * N.z); nor.push(N.x, N.y, N.z); uv.push(u, j / radial);
    }
  }
  for (let i = 0; i < tubular; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = (i + 1) * (radial + 1) + j;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Displace a geometry's vertices along normals with fbm noise (organic surfaces). */
export function displace(geo, amp, freq, seed = 0, oct = 3) {
  geo = geo.index ? geo : geo;
  const p = geo.attributes.position, n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = fbm3(x * freq + seed, y * freq, z * freq, oct) * amp;
    p.setXYZ(i, x + n.getX(i) * d, y + n.getY(i) * d, z + n.getZ(i) * d);
  }
  geo.computeVertexNormals();
  return geo;
}

export const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
