// World: a young broad-leaved tree in dark, moist soil, cut away to show its roots.
// Used for the opening (s1a), the xylem X-ray (s2c) and the final recap (s6b).
// Units: metres. Ground surface y = 0; the soil block is cut at z = 0.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { organicMaterial, glowMaterial, Sprites, NOISE_GLSL } from '../engine/materials.js';
import { CameraPath, rng, taperedTube, clamp, smooth, remap, window01, easeInOut, fbm3, v3, noise3 } from '../engine/util.js';

const TEX = '../assets/tex/';
const HERO_ROOT = [[0.035, -0.255], [0.075, -0.295], [0.105, -0.322], [0.128, -0.338], [0.146, -0.352]];
const ATLAS = [ // intact leaves in LeafSet024 (pixel rects in the 2048² atlas): x0, y0, x1, y1
  [799, 8, 1250, 660], [95, 13, 594, 671], [1474, 14, 1945, 662],
  [108, 705, 572, 1342], [797, 722, 1260, 1353], [1471, 695, 1931, 1355],
];

function leafGeometry(cell, len) {
  const [x0, y0, x1, y1] = cell, aspect = (x1 - x0) / (y1 - y0);
  const g = new THREE.PlaneGeometry(len * aspect, len, 6, 8);
  g.translate(0, len / 2, 0);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), fy = y / len;
    const fold = Math.abs(x) / (len * aspect * 0.5);
    p.setZ(i, 0.10 * len * fold * fold * 0.6 - 0.12 * len * fy * fy + 0.03 * len * Math.sin(fy * 3.1));
    const u = uv.getX(i), v = uv.getY(i);
    uv.setXY(i, (x0 + u * (x1 - x0)) / 2048, 1 - (y1 - v * (y1 - y0)) / 2048);
  }
  g.computeVertexNormals();
  return g;
}

function leafMaterial(maps, sun) {
  const m = new THREE.MeshStandardMaterial({
    map: maps.color, alphaMap: maps.alpha, alphaTest: 0.5, normalMap: maps.normal,
    side: THREE.DoubleSide, roughness: 0.82, normalScale: new THREE.Vector2(0.45, 0.45), color: 0xdfeacf, envMapIntensity: 0.55,
  });
  const u = m.userData.u = { sunDirV: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(1, 0.95, 0.85) }, trans: { value: 0.9 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 sunDirV; uniform vec3 sunCol; uniform float trans;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float _back = max(0.0, dot(-normal, sunDirV));
        vec3 _vd = normalize(vViewPosition);
        float _fwd = pow(max(0.0, dot(_vd, sunDirV)), 4.0);
        totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 1.15, 0.5) * sunCol * _back * trans * (0.6 + 0.9 * _fwd);`);
  };
  m.customProgramCacheKey = () => 'leafTrans';
  sun.leafMats.push(m);
  return m;
}

/**
 * The HDRI photo has a purple lens-flare fringe in the tree line just below the
 * sun. Neutralise saturated blue-violet pixels in that small window (both row
 * orientations are checked; the open sky is never that saturated near the horizon).
 */
function retouchFlare(img) {
  const { width: w, height: h, data } = img, F = THREE.DataUtils.fromHalfFloat, T = THREE.DataUtils.toHalfFloat;
  const x0 = Math.floor(w * 0.445), x1 = Math.ceil(w * 0.52);
  let fixed = 0;
  for (const [ya, yb] of [[Math.floor(h * 0.40), Math.ceil(h * 0.505)], [Math.floor(h * 0.495), Math.ceil(h * 0.60)]]) {
    for (let y = ya; y < yb; y++) for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4, r = F(data[i]), g = F(data[i + 1]), b = F(data[i + 2]);
      // the fringe is far more saturated than any sky here (linear b/g ≈ 3 vs ≤ 1.7)
      if (b > 2.2 * Math.max(r, g) && b > 0.01) {
        const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        data[i] = T(L * 0.78); data[i + 1] = T(L * 1.04); data[i + 2] = T(L * 0.6); fixed++;
      }
    }
  }
  console.log('retouched HDRI flare pixels:', fixed);
}

export async function build(env) {
  const R = rng(7);
  const scene = new THREE.Scene();
  const [sky, bark, barkN, barkR, soil, soilN, soilR, soilAO, leafC, leafA, leafN, leafR, grass] = await Promise.all([
    env.hdri(TEX + 'DaySkyHDRI069A/DaySkyHDRI069A_4K_HDR.exr', retouchFlare),
    env.tex(TEX + 'Bark003/Bark003_2K-JPG_Color.jpg'),
    env.tex(TEX + 'Bark003/Bark003_2K-JPG_NormalGL.jpg', { srgb: false }),
    env.tex(TEX + 'Bark003/Bark003_2K-JPG_Roughness.jpg', { srgb: false }),
    env.tex(TEX + 'Ground048/Ground048_2K-JPG_Color.jpg'),
    env.tex(TEX + 'Ground048/Ground048_2K-JPG_NormalGL.jpg', { srgb: false }),
    env.tex(TEX + 'Ground048/Ground048_2K-JPG_Roughness.jpg', { srgb: false }),
    env.tex(TEX + 'Ground048/Ground048_2K-JPG_AmbientOcclusion.jpg', { srgb: false }),
    env.tex(TEX + 'LeafSet024/LeafSet024_2K-JPG_Color.jpg', { clamp: true }),
    env.tex(TEX + 'LeafSet024/LeafSet024_2K-JPG_Opacity.jpg', { srgb: false, clamp: true }),
    env.tex(TEX + 'LeafSet024/LeafSet024_2K-JPG_NormalGL.jpg', { srgb: false, clamp: true }),
    env.tex(TEX + 'LeafSet024/LeafSet024_2K-JPG_Roughness.jpg', { srgb: false, clamp: true }),
    env.tex(TEX + 'Grass004/Grass004_2K-JPG_Color.jpg'),
  ]);

  // --- sky & sun: rotate the HDRI so the sun sits behind the tree (back-light) ----
  const yaw = 2.05;
  scene.background = sky.tx; scene.backgroundBlurriness = 0.035; scene.backgroundIntensity = 1.0;
  scene.environment = sky.envMap; scene.environmentIntensity = 0.85;
  scene.fog = new THREE.Fog(0xaab9b4, 18, 140);
  scene.backgroundRotation.set(0, yaw, 0); scene.environmentRotation.set(0, yaw, 0);
  const el = THREE.MathUtils.degToRad(25.7);
  const sunDir = new THREE.Vector3(Math.cos(el), Math.sin(el), 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).normalize();
  const sunLight = new THREE.DirectionalLight(0xfff0dc, 3.4);
  sunLight.position.copy(sunDir).multiplyScalar(6); sunLight.target.position.set(0, 0.6, 0);
  sunLight.castShadow = true; sunLight.shadow.mapSize.set(4096, 4096);
  Object.assign(sunLight.shadow.camera, { left: -1.6, right: 1.6, top: 2.2, bottom: -1.0, near: 0.5, far: 14 });
  sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.02; sunLight.shadow.radius = 3;
  scene.add(sunLight, sunLight.target);
  const sun = { dir: sunDir, leafMats: [] };
  // soft fill for the excavated face (which faces away from the sun)
  const fill = new THREE.SpotLight(0xd8e6ff, 0, 8, 0.75, 0.9, 1.2);
  fill.position.set(0.6, 0.6, 2.2); fill.target.position.set(0, -0.4, 0);
  scene.add(fill, fill.target);

  // --- soil block: surface + excavated face -------------------------------------
  for (const t of [soil, soilN, soilR, soilAO]) { t.repeat.set(1, 1); }
  // soil patch around the sapling blending into meadow grass
  const surfMat = new THREE.MeshStandardMaterial({ map: soil, normalMap: soilN, aoMap: soilAO,
    color: 0xffffff, roughness: 0.97, normalScale: new THREE.Vector2(1.3, 1.3), envMapIntensity: 0.3 });
  surfMat.onBeforeCompile = (sh) => {
    sh.uniforms.grassMap = { value: grass };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos2;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos2 = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos2; uniform sampler2D grassMap;\n' + NOISE_GLSL)
      .replace('#include <map_fragment>', `
        vec4 soilC = texture2D(map, vMapUv) * vec4(0.42, 0.36, 0.31, 1.0);
        vec4 grassC = texture2D(grassMap, vWPos2.xz / 1.3) * vec4(0.78, 0.86, 0.62, 1.0);
        float rr = length(vWPos2.xz) + 0.35 * snoise(vec3(vWPos2.xz * 1.4, 0.0)) + 0.12 * snoise(vec3(vWPos2.xz * 6.0, 3.0));
        float gw = smoothstep(1.0, 1.6, rr);
        diffuseColor *= mix(soilC, grassC, gw);`);
  };
  surfMat.customProgramCacheKey = () => 'soilGrass';
  const tileUV = (g, s) => { const uv = g.attributes.uv, p = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / s, p.getY(i) / s); };
  const surf = new THREE.PlaneGeometry(9, 9, 220, 220);
  surf.translate(0, 4.5, 0); // local y ∈ [0, 9] → world z ∈ [-9, 0] after the -90° X rotation
  { const p = surf.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i);
      const edge = smooth(y / 0.06); // flatten right at the cut edge
      const mound = 0.035 * Math.exp(-(x * x + y * y) / 0.08);
      p.setZ(i, (0.012 * fbm3(x * 3.1, y * 3.1, 0.3, 4) + 0.006 * fbm3(x * 14, y * 14, 2.0, 3)) * edge + mound); } }
  tileUV(surf, 0.9); surf.computeVertexNormals();
  const surfMesh = new THREE.Mesh(surf, surfMat); surfMesh.rotation.x = -Math.PI / 2; surfMesh.receiveShadow = true;
  scene.add(surfMesh);
  // far field: same grass texture, tile size, tint and soil-normal relief as the near patch's grass,
  // so there is no tonal seam where the two meet
  const farTex = grass.clone(); farTex.repeat.set(160 / 1.3, 120 / 1.3); farTex.needsUpdate = true;
  const farN = soilN.clone(); farN.repeat.set(160 / 0.9, 120 / 0.9); farN.needsUpdate = true;
  const farMat = new THREE.MeshStandardMaterial({ map: farTex, normalMap: farN, normalScale: new THREE.Vector2(1.3, 1.3), roughness: 0.97, envMapIntensity: 0.3 });
  farMat.color.setRGB(0.78, 0.86, 0.62, THREE.LinearSRGBColorSpace);
  const far = new THREE.Mesh(new THREE.PlaneGeometry(160, 120), farMat);
  far.rotation.x = -Math.PI / 2; far.position.set(0, -0.03, -60.25); scene.add(far);
  // grass rim far behind so the soil meets the meadow in the sky dome
  const faceMat = new THREE.MeshStandardMaterial({ map: soil, normalMap: soilN, roughnessMap: soilR, aoMap: soilAO,
    vertexColors: true, roughness: 0.9, normalScale: new THREE.Vector2(1.4, 1.4), envMapIntensity: 0.55 });
  const face = new THREE.PlaneGeometry(9, 3.2, 300, 120);
  face.translate(0, -1.6, 0);
  { const p = face.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i);
      const top = smooth(-y / 0.05);
      // recess the face a little along the hero fine root so it sits proud of the soil
      let dh = 1; for (let k = 0; k < HERO_ROOT.length - 1; k++) { const [ax, ay] = HERO_ROOT[k], [bx, by] = HERO_ROOT[k + 1];
        const vx = bx - ax, vy = by - ay, w = clamp(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy));
        dh = Math.min(dh, Math.hypot(x - ax - w * vx, y - ay - w * vy)); }
      p.setZ(i, (-0.011 * Math.abs(fbm3(x * 4.2, y * 4.2, 7.0, 4)) - 0.004 * fbm3(x * 18, y * 18, 1.0, 3)) * top - 0.006 * Math.exp(-dh * dh / 0.0001));
      const d = clamp(-y / 1.1); // topsoil (dark, organic) → subsoil (browner)
      const c = new THREE.Color().setRGB(0.42 + 0.20 * d, 0.36 + 0.13 * d, 0.30 + 0.06 * d);
      col.push(c.r, c.g, c.b); }
    face.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); }
  tileUV(face, 0.55); face.computeVertexNormals();
  const faceMesh = new THREE.Mesh(face, faceMat); faceMesh.receiveShadow = true; scene.add(faceMesh);
  // pebbles and aggregates on the face and surface
  let pebGeo = new THREE.IcosahedronGeometry(1, 3);
  pebGeo.deleteAttribute('normal'); pebGeo.deleteAttribute('uv'); pebGeo = mergeVertices(pebGeo);
  { const p = pebGeo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 1 + 0.25 * noise3(x * 1.7, y * 1.7, z * 1.7); p.setXYZ(i, x * k, y * k * 0.7, z * k); } pebGeo.computeVertexNormals(); }
  const pebMat = organicMaterial({ color: 0x5e5044, roughness: 0.9, noiseAmp: 0.7, noiseScale: 3, noiseColor: 0x2e251e, envMapIntensity: 0.5 });
  const peb = new THREE.InstancedMesh(pebGeo, pebMat, 260);
  { const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (let i = 0; i < 260; i++) {
      const onFace = i < 200, r = R.range(0.003, 0.016) * (R() < 0.1 ? 2 : 1);
      const pos = onFace ? v3(R.range(-2.2, 2.2), R.range(-1.4, -0.02), R.range(-0.4, 0.5) * r) : v3(R.range(-1.5, 1.5), 0.0, R.range(-1.5, -0.03));
      q.setFromEuler(new THREE.Euler(R() * 6, R() * 6, R() * 6)); s.set(r, r, r);
      peb.setMatrixAt(i, m.compose(pos, q, s)); } }
  peb.castShadow = peb.receiveShadow = true; scene.add(peb);

  // --- tree --------------------------------------------------------------------
  const barkMat = new THREE.MeshStandardMaterial({ map: bark, normalMap: barkN, roughnessMap: barkR, color: 0x9c9a8a,
    roughness: 0.85, transparent: true, opacity: 1 });
  const H = 1.78;
  const trunkCurve = new THREE.CatmullRomCurve3([v3(0, -0.06, 0), v3(0.004, 0.3, -0.004), v3(0.016, 0.75, -0.01), v3(0.01, 1.2, 0.008), v3(-0.012, 1.55, 0.0), v3(-0.006, H, -0.01)]);
  const trunkR = (u) => 0.026 * Math.pow(1 - u, 0.8) + 0.0035 + 0.018 * Math.exp(-u * 40);
  const trunkGeo = taperedTube(trunkCurve, trunkR, 140, 20);
  { const uv = trunkGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * H / 0.22, uv.getY(i) * 0.6); }
  const trunk = new THREE.Mesh(trunkGeo, barkMat); trunk.castShadow = trunk.receiveShadow = true; scene.add(trunk);

  const branches = []; // {curve, r0}
  const nB = 12;
  for (let i = 0; i < nB; i++) {
    const h = 0.52 + (i / (nB - 1)) * 1.08 + R.range(-0.03, 0.03);
    const u = h / H, base = trunkCurve.getPointAt(clamp(u, 0, 1));
    const az = i * 2.4 + R.range(-0.25, 0.25) + 0.6;
    const elev = THREE.MathUtils.degToRad(R.range(30, 52) + i * 1.5);
    const L = (0.5 - 0.27 * (i / nB)) * R.range(0.85, 1.12);
    const d = v3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
    const pts = [base.clone()];
    for (let k = 1; k <= 5; k++) {
      const f = k / 5;
      const p = base.clone().addScaledVector(d, L * f);
      p.y += L * (0.10 * Math.sin(f * Math.PI) - 0.12 * f * f);
      p.x += R.range(-0.01, 0.01); p.z += R.range(-0.01, 0.01);
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const r0 = trunkR(u) * 0.42;
    branches.push({ curve, r0, L, d });
    const g = taperedTube(curve, (s) => r0 * (1 - 0.82 * s) + 0.0008, 40, 9);
    { const uv = g.attributes.uv; for (let j = 0; j < uv.count; j++) uv.setXY(j, uv.getX(j) * L / 0.2, uv.getY(j) * 0.25); }
    const m = new THREE.Mesh(g, barkMat); m.castShadow = true; scene.add(m);
    // twigs
    const nT = R.int(2, 4);
    for (let k = 0; k < nT; k++) {
      const s0 = R.range(0.35, 0.75), p0 = curve.getPointAt(s0), tan = curve.getTangentAt(s0);
      const side = v3(-tan.z, 0, tan.x).normalize().multiplyScalar(k % 2 ? 1 : -1);
      const td = tan.clone().multiplyScalar(0.6).add(side).add(v3(0, 0.35, 0)).normalize();
      const tl = L * R.range(0.25, 0.4);
      const tc = new THREE.CatmullRomCurve3([p0, p0.clone().addScaledVector(td, tl * 0.5).add(v3(0, 0.01, 0)), p0.clone().addScaledVector(td, tl)]);
      const tr = r0 * (1 - 0.82 * s0) * 0.6;
      const tg = taperedTube(tc, (s) => tr * (1 - 0.7 * s) + 0.0006, 16, 6);
      const tm = new THREE.Mesh(tg, barkMat); tm.castShadow = true; scene.add(tm);
      branches.push({ curve: tc, r0: tr, L: tl, d: td, twig: true });
    }
  }

  // leaves
  const maps = { color: leafC, alpha: leafA, normal: leafN, rough: leafR };
  const leafMat = leafMaterial(maps, sun);
  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaMap: leafA, alphaTest: 0.5, side: THREE.DoubleSide });
  const leafXf = ATLAS.map(() => []);
  const addLeaf = (pos, dir, normal, len, cell) => {
    const y = dir.clone().normalize();
    let n = normal.clone().addScaledVector(y, -normal.dot(y)).normalize();
    const x = new THREE.Vector3().crossVectors(y, n).normalize();
    n = new THREE.Vector3().crossVectors(x, y);
    const m = new THREE.Matrix4().makeBasis(x.multiplyScalar(len), y.multiplyScalar(len), n.multiplyScalar(len)).setPosition(pos);
    leafXf[cell].push(m);
    return m;
  };
  for (const b of branches) {
    const n = Math.max(3, Math.round(b.L / 0.032));
    for (let k = 0; k < n; k++) {
      const s = 0.3 + 0.7 * (k / (n - 1 || 1));
      const p = b.curve.getPointAt(Math.min(s, 1)), tan = b.curve.getTangentAt(Math.min(s, 1));
      const side = v3(-tan.z, 0, tan.x).normalize().multiplyScalar(k % 2 ? 1 : -1);
      const dir = side.clone().multiplyScalar(0.85).addScaledVector(tan, 0.55).add(v3(0, R.range(-0.25, 0.1), 0)).normalize();
      const nrm = v3(R.range(-0.25, 0.25), 1, R.range(-0.25, 0.25)).normalize().lerp(sunDir, 0.25).normalize();
      addLeaf(p.clone().addScaledVector(dir, 0.006), dir, nrm, R.range(0.07, 0.098), R.int(0, 5));
    }
    const tip = b.curve.getPointAt(1), tt = b.curve.getTangentAt(1);
    for (let k = 0; k < 2; k++) {
      const dir = tt.clone().add(v3(R.range(-0.5, 0.5), R.range(-0.1, 0.3), R.range(-0.5, 0.5))).normalize();
      addLeaf(tip.clone(), dir, v3(0, 1, 0).lerp(sunDir, 0.3).normalize(), R.range(0.055, 0.075), R.int(0, 5));
    }
  }
  // leader shoot leaves at the top
  for (let k = 0; k < 6; k++) {
    const p = trunkCurve.getPointAt(0.9 + k * 0.016), a = k * 2.3;
    addLeaf(p, v3(Math.cos(a), 0.55, Math.sin(a)).normalize(), v3(0, 1, 0), R.range(0.05, 0.07), R.int(0, 5));
  }
  // hero leaf: the leaf we fly into for the leaf scenes (faces the camera side, catches light)
  const heroPos = v3(0.21, 1.2, 0.17);
  const heroBranch = new THREE.CatmullRomCurve3([trunkCurve.getPointAt(1.08 / H), v3(0.1, 1.15, 0.09), heroPos.clone().add(v3(-0.02, 0, -0.01))]);
  { const g = taperedTube(heroBranch, (s) => 0.004 * (1 - 0.6 * s) + 0.0008, 24, 7); const m = new THREE.Mesh(g, barkMat); m.castShadow = true; scene.add(m); }
  const heroMatrix = addLeaf(heroPos, v3(0.75, 0.05, 0.62).normalize(), v3(-0.1, 1, 0.45).normalize(), 0.09, 1);
  const leafMeshes = [];
  ATLAS.forEach((cell, ci) => {
    if (!leafXf[ci].length) return;
    const im = new THREE.InstancedMesh(leafGeometry(cell, 1), leafMat, leafXf[ci].length);
    leafXf[ci].forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = true; im.receiveShadow = true; im.customDepthMaterial = depthMat;
    scene.add(im); leafMeshes.push(im);
  });

  // leaf litter on the soil surface (older, browned leaves from the damaged atlas row)
  const litterMat = new THREE.MeshStandardMaterial({ map: leafC, alphaMap: leafA, alphaTest: 0.5, side: THREE.DoubleSide,
    color: 0xa07a4c, roughness: 0.9, envMapIntensity: 0.4 });
  const LITTER = [[783, 1382, 1260, 2030], [105, 1383, 569, 2023], [1468, 1387, 1931, 2032]];
  LITTER.forEach((cell, ci) => {
    const g = leafGeometry(cell, 1); g.scale(1, 1, 0.3);
    const im = new THREE.InstancedMesh(g, litterMat, 14);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < 14; i++) {
      const a = R.range(0, Math.PI * 2), d = R.range(0.12, 1.4);
      const pos = v3(Math.cos(a) * d, 0.004, -Math.abs(Math.sin(a) * d) - 0.05);
      q.setFromEuler(new THREE.Euler(-Math.PI / 2 + R.range(-0.15, 0.15), 0, R.range(0, Math.PI * 2)));
      const k = R.range(0.06, 0.09);
      im.setMatrixAt(i, m.compose(pos, q, v3(k, k, k)));
    }
    im.receiveShadow = true; scene.add(im);
  });

  // --- roots (on the excavated face) -----------------------------------------------
  const rootMat = organicMaterial({ color: 0xb59775, roughness: 0.62, noiseAmp: 0.7, noiseScale: 40, noiseColor: 0x6b4c30,
    sssColor: 0x2a1a0c, sssStrength: 0.12, rimColor: 0xffe8c8, rimStrength: 0.1, rimPower: 3, envMapIntensity: 0.6 });
  const roots = []; // {curve, r0, r1}
  const growRoot = (start, dir, len, r0, depth, seed) => {
    const rr = rng(seed);
    const pts = [start.clone()]; let p = start.clone(), d = dir.clone();
    const steps = 10;
    for (let i = 0; i < steps; i++) {
      d.y -= 0.05 * (depth === 0 ? 2 : 1); // gravitropism
      d.x += rr.range(-0.18, 0.18); d.z = 0; d.normalize();
      p = p.clone().addScaledVector(d, len / steps);
      p.z = 0.1 * r0 - 0.0015 + rr.range(-0.0015, 0.0015);
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const r1 = Math.max(0.0007, r0 * 0.25);
    roots.push({ curve, r0, r1, depth });
    if (depth < 2) {
      const nb = depth === 0 ? 9 : 5;
      for (let k = 0; k < nb; k++) {
        const s = 0.12 + 0.8 * (k / nb) + rr.range(-0.04, 0.04);
        const bp = curve.getPointAt(s), bt = curve.getTangentAt(s);
        const sideSign = (k % 2 ? 1 : -1);
        const bd = v3(sideSign * rr.range(0.7, 1), bt.y * 0.4 - rr.range(0.05, 0.4), 0).normalize();
        const rr0 = (r0 * (1 - 0.75 * s)) * rr.range(0.35, 0.55);
        growRoot(bp, bd, len * rr.range(0.35, 0.6) * (1 - 0.4 * s), rr0, depth + 1, seed * 7 + k + 1);
      }
    }
  };
  growRoot(v3(0, -0.02, 0), v3(0.04, -1, 0), 0.82, 0.016, 0, 3);
  // hero fine root with root hairs (camera target at the end of s1a)
  const heroRoot = new THREE.CatmullRomCurve3([v3(0.035, -0.255, -0.002), v3(0.075, -0.295, -0.0012), v3(0.105, -0.322, -0.0008), v3(0.128, -0.338, -0.0006), v3(0.146, -0.352, -0.0005)]);
  roots.push({ curve: heroRoot, r0: 0.0016, r1: 0.0007, depth: 3, hero: true });
  for (const r of roots) {
    const g = taperedTube(r.curve, (s) => r.r0 + (r.r1 - r.r0) * Math.pow(s, 0.7), Math.max(16, Math.round(r.curve.getLength() / 0.006)), r.depth > 1 ? 7 : 12);
    const m = new THREE.Mesh(g, rootMat); m.castShadow = false; m.receiveShadow = true; scene.add(m);
  }
  // root-hair fuzz behind the tips of fine roots
  const hairGeo = new THREE.CylinderGeometry(1, 0.6, 1, 4, 1, true); hairGeo.translate(0, 0.5, 0);
  const hairMat = new THREE.MeshStandardMaterial({ color: 0xf6f1e6, roughness: 0.4, transparent: true, opacity: 0.55, depthWrite: false, emissive: 0x2a2620 });
  const fine = roots.filter(r => r.depth >= 2);
  const nHair = 9000;
  const hairs = new THREE.InstancedMesh(hairGeo, hairMat, nHair);
  { const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = v3(0, 1, 0);
    for (let i = 0; i < nHair; i++) {
      const r = i < 3000 ? roots[roots.length - 1] : fine[i % fine.length];
      const s = r.hero ? R.range(0.25, 0.85) : R.range(0.55, 0.9); // root-hair zone: behind the tip, not at it
      const p = r.curve.getPointAt(s), tan = r.curve.getTangentAt(s);
      const rad = r.r0 + (r.r1 - r.r0) * Math.pow(s, 0.7);
      const a = R.range(-Math.PI * 0.95, Math.PI * 0.95);
      const nrm = v3(-tan.y, tan.x, 0).normalize();
      const out = nrm.clone().multiplyScalar(Math.cos(a)).add(v3(0, 0, Math.sin(a))).normalize();
      if (out.z < -0.3) out.z = -0.3;
      out.addScaledVector(tan, R.range(-0.2, 0.3)).normalize();
      const L = R.range(0.6, 1.4) * (r.hero ? 0.0035 : 0.0028) * smooth((s - 0.2) / 0.25);
      q.setFromUnitVectors(up, out);
      m.compose(p.clone().addScaledVector(out, rad * 0.9), q, v3(0.000026, L, 0.000026));
      hairs.setMatrixAt(i, m);
    } }
  scene.add(hairs);

  // --- xylem pathway glow (X-ray shots) --------------------------------------------
  const glowRoot = new THREE.Group(); scene.add(glowRoot);
  const glowTubes = []; // {mesh, d0, d1}
  const addGlow = (curve, radius, d0, d1, color = 0x4fb6ff, reverse = false) => {
    let c = curve;
    if (reverse) c = new THREE.CatmullRomCurve3(curve.getPoints(40).reverse());
    const g = taperedTube(c, () => radius, 80, 8);
    const mat = glowMaterial({ color, intensity: 1.5, power: 1.1, progress: 0, head: 0.08 });
    const mesh = new THREE.Mesh(g, mat); mesh.renderOrder = 20; glowRoot.add(mesh);
    glowTubes.push({ mesh, d0, d1 });
  };
  // roots: tips → base (reverse), then trunk, branches, hero leaf midrib
  roots.filter(r => r.depth <= 1 || r.hero).forEach((r, i) => addGlow(r.curve, Math.max(0.0012, r.r0 * 0.35), r.depth === 0 ? 0.35 : 0.0, r.depth === 0 ? 1.0 : 0.55 + 0.05 * (i % 3), 0x4fb6ff, true));
  addGlow(trunkCurve, 0.006, 1.0, 2.0);
  branches.filter(b => !b.twig).forEach((b) => addGlow(b.curve, Math.max(0.0015, b.r0 * 0.35), 1.65, 2.35));
  addGlow(heroBranch, 0.0016, 1.75, 2.25);
  const heroMid = new THREE.CatmullRomCurve3([0, 0.25, 0.5, 0.75, 0.98].map(f => v3(0, f, -0.12 * f * f + 0.03 * Math.sin(3.1 * f) + 0.012).applyMatrix4(heroMatrix)));
  const heroN = new THREE.Vector3().setFromMatrixColumn(heroMatrix, 2).normalize();
  addGlow(heroMid, 0.0012, 2.25, 2.6);
  glowRoot.visible = false;

  // water dots (soil water near roots) and vapour leaving the hero leaf (recap)
  const soilDots = new Sprites(220, { shape: 'sphere', renderOrder: 22 });
  const vapour = new Sprites(160, { shape: 'soft', additive: true, renderOrder: 23 });
  scene.add(soilDots.mesh, vapour.mesh);
  const dotSeeds = Array.from({ length: 220 }, (_, i) => { const r = fine[i % fine.length]; const s = R.range(0.4, 1); return { r, s, off: v3(R.range(-0.03, 0.03), R.range(-0.03, 0.03), 0.004), ph: R() }; });
  const vapSeeds = Array.from({ length: 160 }, () => ({ u: R(), v: R.range(0.2, 0.8), ph: R(), jit: v3(R.range(-0.6, 0.6), R.range(-0.5, 0.3), R.range(-0.6, 0.6)), sp: R.range(0.6, 1.2) }));

  // --- camera ------------------------------------------------------------------------
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.004, 200);
  const hero = heroPos.clone();
  const paths = {
    s1a: new CameraPath([
      { t: 0.0, pos: [0.70, 1.30, 1.32], tgt: [0.02, 1.38, -0.06], fov: 40 },
      { t: 1.5, pos: [0.56, 0.78, 1.10], tgt: [0.00, 0.58, -0.02], fov: 38 },
      { t: 2.55, pos: [0.42, 0.16, 0.86], tgt: [0.02, -0.08, -0.02], fov: 36 },
      { t: 3.35, pos: [0.26, -0.17, 0.52], tgt: [0.08, -0.29, 0.0], fov: 34 },
      { t: 4.2, pos: [0.122, -0.322, 0.075], tgt: [0.118, -0.334, -0.002], fov: 32 },
    ], { ease: (x) => x }),
    s2c: new CameraPath([
      { t: 0.0, pos: [0.42, 0.42, 3.75], tgt: [0.02, 0.38, 0.0], fov: 40 },
      { t: 1.6, pos: [0.46, 0.72, 3.0], tgt: [0.06, 0.78, 0.0], fov: 38 },
      { t: 2.8, pos: [hero.x + 0.07, hero.y + 0.06, hero.z + 0.23], tgt: [hero.x + 0.03, hero.y + 0.02, hero.z + 0.01], fov: 32 },
    ]),
    s6b: new CameraPath([
      { t: 0.0, pos: [hero.x + 0.07, hero.y + 0.07, hero.z + 0.19], tgt: [hero.x + 0.02, hero.y - 0.005, hero.z], fov: 34 },
      { t: 2.6, pos: [0.55, 0.62, 2.5], tgt: [0.06, 0.55, 0.0], fov: 38 },
      { t: 7.6, pos: [0.45, 0.42, 4.15], tgt: [0.0, 0.36, 0.0], fov: 40 },
    ]),
  };

  const tmpV = new THREE.Vector3();
  const update = (t, shot, lt) => {
    paths[shot.id].apply(camera, lt);
    const xr = shot.id === 's2c' ? smooth((lt - 0.1) / 0.6) : shot.id === 's6b' ? smooth((lt - 0.5) / 0.8) : 0;
    barkMat.opacity = 1 - 0.55 * xr;
    barkMat.depthWrite = xr < 0.5;
    glowRoot.visible = xr > 0;
    // glow front: 0 = root tips, 1 = root base, 2 = top of trunk, 2.6 = leaf tip
    let front = 0;
    if (shot.id === 's2c') front = remap(lt, 0.2, 2.2, 0, 2.6);
    if (shot.id === 's6b') front = remap(lt, 0.4, 3.8, 0, 2.6);
    for (const g of glowTubes) {
      g.mesh.material.uniforms.progress.value = clamp((front - g.d0) / (g.d1 - g.d0));
      g.mesh.material.uniforms.opacity.value = xr;
      g.mesh.visible = front > g.d0;
    }
    fill.intensity = shot.id === 's1a' ? 6 * smooth((lt - 1.8) / 1.2) : 30 * xr;
    sun.leafMats.forEach(m => m.userData.u.sunDirV.value.copy(sunDir).transformDirection(camera.matrixWorldInverse));
    // soil water dots drifting toward the roots (recap)
    const showDots = shot.id === 's6b' ? window01(lt, 0.4, 6.0, 0.6, 0.8) : 0;
    dotSeeds.forEach((d, i) => {
      const k = (lt * 0.25 + d.ph) % 1;
      const p = d.r.curve.getPointAt(d.s).add(tmpV.copy(d.off).multiplyScalar(1 - k));
      soilDots.set(i, p, 0.0026 * (1 - 0.3 * k), new THREE.Color(0.25, 0.62, 1.0), showDots * smooth(k / 0.2) * smooth((1 - k) / 0.2));
    });
    soilDots.commit();
    const showVap = shot.id === 's6b' ? window01(lt, 2.2, 7.6, 0.8, 0.6) : 0;
    vapSeeds.forEach((d, i) => {
      const k = (lt * 0.22 * d.sp + d.ph) % 1;
      // leaves the lower surface (stomata) and diffuses away from the leaf
      const base = v3((d.u - 0.5) * 0.45, 0.12 + d.v * 0.7, -0.03).applyMatrix4(heroMatrix);
      const dir = heroN.clone().negate().add(d.jit).normalize();
      const p = base.addScaledVector(dir, 0.002 + k * 0.1);
      vapour.set(i, p, 0.004 + 0.006 * k, new THREE.Color(0.85, 0.95, 1.0), showVap * 0.55 * smooth(k / 0.15) * (1 - k));
    });
    vapour.commit();
  };

  const post = (t, shot, lt) => {
    if (shot.id === 's1a') {
      const d = camera.position.distanceTo(camera.userData.target);
      return { focus: d, aperture: lt < 2.6 ? 9 : 14, maxCoc: 24, exposure: 1.0, bloom: 0.45, bloomThreshold: 1.1, vignette: 0.4, saturation: 1.12, contrast: 1.08 };
    }
    if (shot.id === 's2c') {
      const d = camera.position.distanceTo(camera.userData.target);
      return { focus: d, aperture: 5 + 6 * smooth((lt - 1.6) / 1.2), maxCoc: 20, exposure: 0.95, bloom: 0.55, bloomThreshold: 0.95, vignette: 0.45, saturation: 1.08, contrast: 1.07 };
    }
    const d = camera.position.distanceTo(camera.userData.target);
    const dim = 1 - 0.45 * smooth((lt - 4.4) / 1.0);
    return { focus: d, aperture: 6, maxCoc: 18, exposure: 0.95 * dim, bloom: 0.5, bloomThreshold: 0.95, vignette: 0.5, saturation: 1.08, contrast: 1.07 };
  };

  const P = (x, y, z) => v3(x, y, z);
  const overlay = (ov, t, shot, lt) => {
    if (shot.id === 's1a') {
      ov.label({ text: 'Root hairs', sub: 'on young roots, just behind the tip', at: P(0.112, -0.331, 0.002), dx: -150, dy: -95, t0: 2.7, t1: 4.05 }, camera, t);
    }
    if (shot.id === 's2c') {
      ov.label({ text: 'Xylem', sub: 'water-conducting tissue', at: trunkCurve.getPointAt(0.42), dx: -170, dy: -40, t0: 16.45, t1: 18.0 }, camera, t);
      ov.label({ text: 'Roots', at: P(0.2, -0.45, 0.0), dx: 150, dy: 40, t0: 16.3, t1: 17.7 }, camera, t);
      ov.label({ text: 'Leaves', at: P(-0.15, 1.45, 0.05), dx: -160, dy: -40, t0: 16.9, t1: 18.0 }, camera, t);
      ov.gauge({ x: 0.9, y0: 0.76, y1: 0.30, title: 'Negative pressure (tension)', top: 'more negative — leaves', bottom: 'less negative — roots',
        t0: 16.55, t1: 18.35, value: (tt) => remap(tt, 16.6, 18.0, 0.05, 0.95) }, t);
    }
    if (shot.id === 's6b') {
      ov.label({ text: 'Soil water', at: roots[3].curve.getPointAt(0.8), dx: 170, dy: 60, t0: 57.0, t1: 60.3 }, camera, t);
      ov.label({ text: 'Xylem', at: trunkCurve.getPointAt(0.3), dx: -170, dy: -30, t0: 57.9, t1: 60.3 }, camera, t);
      ov.label({ text: 'Water vapour', sub: 'leaves through stomata', at: hero.clone().add(v3(0.02, -0.03, 0.04)), dx: 160, dy: -70, t0: 58.9, t1: 60.3 }, camera, t);
      ov.pathway({ steps: ['Soil', 'Root hairs', 'Xylem', 'Mesophyll cell walls', 'Air spaces', 'Stomata', 'Atmosphere'], t0: 57.0, t1: 60.6, stagger: 0.5, y: 0.8 }, t);
      ov.title({ parts: ['OSMOSIS', 'TRANSPIRATION PULL', 'COHESION & ADHESION'], t0: 60.75, t1: 64.5, y: 0.47, size: 46, band: true,
        sub: 'The transpiration stream: soil → roots → xylem → leaves → atmosphere' }, t);
    }
  };

  return { scene, camera, update, post, overlay };
}
