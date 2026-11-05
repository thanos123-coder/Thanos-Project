// World: transverse section of a young dicot root (1 unit = 10 µm), as a 3D slab.
// Epidermis (with root hairs) → cortex → endodermis (Casparian strip in the radial
// walls) → pericycle → vascular cylinder with a four-armed (tetrarch) xylem and
// phloem between the arms. Water moves inward along cell walls (apoplast, stopped
// at the Casparian strip so it must cross an endodermal cell membrane) and from
// cell to cell (symplast), converging on the xylem. (s2a)
import * as THREE from 'three';
import { Delaunay } from 'd3-delaunay';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { organicMaterial, waterMaterial, Sprites } from '../engine/materials.js';
import { studioEnv } from '../engine/studio.js';
import { CameraPath, rng, v3, clamp, smooth, lerp } from '../engine/util.js';

const RAD = 40, DEPTH = 18;

function roundedShape(poly, k = 0.28) {
  const s = new THREE.Shape(), n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n], v = poly[i], b = poly[(i + 1) % n];
    const p1 = [v[0] + (a[0] - v[0]) * k, v[1] + (a[1] - v[1]) * k], p2 = [v[0] + (b[0] - v[0]) * k, v[1] + (b[1] - v[1]) * k];
    if (i === 0) s.moveTo(...p1); else s.lineTo(...p1);
    s.quadraticCurveTo(v[0], v[1], p2[0], p2[1]);
  }
  s.closePath();
  return s;
}
function inset(poly, d) {
  const c = poly.reduce((a, p) => [a[0] + p[0] / poly.length, a[1] + p[1] / poly.length], [0, 0]);
  return { c, pts: poly.map(p => { const dx = p[0] - c[0], dy = p[1] - c[1], L = Math.hypot(dx, dy); const f = Math.max(0.15, 1 - d / L); return [c[0] + dx * f, c[1] + dy * f]; }) };
}

export async function build(env) {
  const R = rng(31);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05080b);
  scene.environment = studioEnv(env.renderer, { bg: 0x0a0e12 });
  scene.environmentIntensity = 0.8;
  const key = new THREE.DirectionalLight(0xfff0e0, 2.3); key.position.set(-40, 60, 90); scene.add(key);
  const rim = new THREE.DirectionalLight(0x86baff, 1.2); rim.position.set(50, -10, -60); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x404850, 0x101010, 0.45));

  // --- seeds -----------------------------------------------------------------------
  const seeds = []; // {x, y, type, rv?}
  const ring = (r, n, type, jit = 0.25, off = 0) => { for (let i = 0; i < n; i++) { const a = (i + off + R.range(-jit, jit)) / n * Math.PI * 2; seeds.push({ x: r * Math.cos(a), y: r * Math.sin(a), type }); } };
  ring(41.6, 74, 'ghost', 0.05); ring(39.0, 74, 'epi', 0.12);
  [[35.4, 50], [31.6, 45], [27.9, 40], [24.3, 35], [20.8, 30], [18.2, 28]].forEach(([r, n], i) => ring(r, n, 'cortex', 0.3, i * 0.37));
  ring(16.0, 34, 'endo', 0.08); ring(14.25, 40, 'peri', 0.1);
  const vessels = [];
  const arms = [0, 1, 2, 3].map(k => Math.PI / 4 + k * Math.PI / 2);
  vessels.push({ x: 0, y: 0, rv: 2.9, proto: false });
  for (const a of arms) for (const [r, rv, proto] of [[6.3, 2.1, false], [9.4, 1.5, false], [11.9, 1.0, true]]) vessels.push({ x: r * Math.cos(a), y: r * Math.sin(a), rv, proto });
  vessels.forEach(v => seeds.push({ ...v, type: 'xylem' }));
  const phloemC = arms.map(a => a + Math.PI / 4);
  for (const a of phloemC) for (let k = 0; k < 6; k++) { const r = 10 + R.range(-1.4, 1.4), b = a + R.range(-0.22, 0.22); seeds.push({ x: r * Math.cos(b), y: r * Math.sin(b), type: 'phloem' }); }
  // parenchyma filling the stele (Poisson-disc style)
  for (let tries = 0; tries < 4000; tries++) {
    const r = Math.sqrt(R()) * 13.2, a = R() * Math.PI * 2, x = r * Math.cos(a), y = r * Math.sin(a);
    let ok = true;
    for (const s of seeds) { if (s.type === 'ghost' || s.type === 'epi' || s.type === 'cortex') continue;
      const d = Math.hypot(s.x - x, s.y - y), need = s.type === 'xylem' ? s.rv + 1.0 : 1.45;
      if (d < need) { ok = false; break; } }
    if (ok) seeds.push({ x, y, type: 'paren' });
  }
  const del = Delaunay.from(seeds.map(s => [s.x, s.y]));
  const vor = del.voronoi([-50, -50, 50, 50]);

  // --- cells -------------------------------------------------------------------------
  const M = {
    epi: organicMaterial({ color: 0xd8ccb2, roughness: 0.45, sssColor: 0x40362a, sssStrength: 0.45, rimColor: 0xfff4e0, rimStrength: 0.2, noiseAmp: 0.4, noiseScale: 0.4, noiseColor: 0xb8a888 }),
    cortex: organicMaterial({ color: 0xe9e1cd, roughness: 0.42, sssColor: 0x403a2c, sssStrength: 0.45, rimColor: 0xfff6e8, rimStrength: 0.18, noiseAmp: 0.5, noiseScale: 0.5, noiseColor: 0xc9bea0 }),
    endo: organicMaterial({ color: 0xdcb98a, roughness: 0.42, sssColor: 0x40301a, sssStrength: 0.5, rimColor: 0xffe8c0, rimStrength: 0.2 }),
    peri: organicMaterial({ color: 0xe3dac4, roughness: 0.45, sssColor: 0x40382a, sssStrength: 0.4 }),
    paren: organicMaterial({ color: 0xd9d4c0, roughness: 0.45, sssColor: 0x383428, sssStrength: 0.4 }),
    phloem: organicMaterial({ color: 0xc9d39c, roughness: 0.45, sssColor: 0x30381a, sssStrength: 0.5 }),
    xylem: organicMaterial({ color: 0xa65a2a, roughness: 0.38, sssColor: 0x401808, sssStrength: 0.45, rimColor: 0xffc890, rimStrength: 0.3 }),
  };
  const lumenMat = waterMaterial({ color: 0x3d9cff, opacity: 0.55, glow: 0x2a86ff, glowStrength: 0.55, fresAlpha: 0.3, depthWrite: true });
  const geos = Object.fromEntries(Object.keys(M).map(k => [k, []]));
  const lumens = [], cells = [];
  seeds.forEach((s, i) => {
    if (s.type === 'ghost') return;
    const poly = vor.cellPolygon(i); if (!poly) return;
    const pts = poly.slice(0, -1);
    const wall = s.type === 'xylem' ? 0.22 : 0.32;
    const { c, pts: ip } = inset(pts, wall);
    const ext = { depth: DEPTH, bevelEnabled: true, bevelThickness: 0.35, bevelSize: 0.3, bevelSegments: 2, curveSegments: 4 };
    let shape = roundedShape(ip, 0.3);
    if (s.type === 'xylem') {
      const { pts: lp } = inset(ip, s.proto ? 0.45 : 0.7); // thick lignified secondary wall
      const hole = roundedShape(lp, 0.4); shape.holes.push(new THREE.Path(hole.getPoints(6)));
      const lg = new THREE.ExtrudeGeometry(roundedShape(lp, 0.4), { depth: DEPTH - 0.6, bevelEnabled: false, curveSegments: 6 });
      lg.translate(0, 0, -DEPTH - 0.3); lumens.push(lg);
    }
    const g = new THREE.ExtrudeGeometry(shape, ext); g.translate(0, 0, -DEPTH);
    geos[s.type].push(g);
    cells.push({ ...s, c, poly: pts, i });
  });
  for (const [k, list] of Object.entries(geos)) if (list.length) scene.add(new THREE.Mesh(mergeGeometries(list), M[k]));
  const lumen = new THREE.Mesh(mergeGeometries(lumens), lumenMat); lumen.renderOrder = 5; scene.add(lumen);
  // dark backing so intercellular spaces read as gaps
  const back = new THREE.Mesh(new THREE.CircleGeometry(RAD + 0.6, 96), new THREE.MeshStandardMaterial({ color: 0x0c0a08, roughness: 1 }));
  back.position.z = -DEPTH + 0.5; scene.add(back);

  // Casparian strip: a band in the radial walls between neighbouring endodermal cells
  const endoIdx = new Set(cells.filter(c => c.type === 'endo').map(c => c.i));
  const stripGeo = [];
  for (const c of cells.filter(c => c.type === 'endo')) {
    for (const j of del.neighbors(c.i)) {
      if (!endoIdx.has(j) || j < c.i) continue;
      const pa = vor.cellPolygon(c.i).slice(0, -1), pb = vor.cellPolygon(j).slice(0, -1);
      const shared = pa.filter(p => pb.some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6));
      if (shared.length < 2) continue;
      const [a, b] = shared; const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const g = new THREE.BoxGeometry(len * 0.42, 0.55, DEPTH + 0.5);
      g.rotateZ(ang); g.translate(mid[0], mid[1], -DEPTH / 2 + 0.2); stripGeo.push(g);
      c.strip = v3(mid[0], mid[1], 0.45);
    }
  }
  const stripMat = organicMaterial({ color: 0x8a1c10, roughness: 0.35, rimColor: 0xff6040, rimStrength: 0.6, sssColor: 0x60100a, sssStrength: 0.9 });
  scene.add(new THREE.Mesh(mergeGeometries(stripGeo), stripMat));

  // root hairs from some epidermal cells
  const hairMat = organicMaterial({ color: 0xe6dcc6, roughness: 0.4, sssColor: 0x40362a, sssStrength: 0.4, rimColor: 0xfff6e8, rimStrength: 0.35 });
  cells.filter(c => c.type === 'epi').forEach((c, k) => {
    if (k % 6) return;
    const a = Math.atan2(c.c[1], c.c[0]), L = R.range(8, 16);
    const pts = [0, 0.35, 0.7, 1].map(f => v3((40 + L * f) * Math.cos(a + 0.03 * Math.sin(f * 5 + k)), (40 + L * f) * Math.sin(a + 0.03 * Math.sin(f * 5 + k)), -1.2 - f * 1.5));
    pts[0] = v3(39.5 * Math.cos(a), 39.5 * Math.sin(a), -1.2);
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.75, 10);
    scene.add(new THREE.Mesh(g, hairMat));
  });

  // --- water pathways -------------------------------------------------------------------
  const P = new THREE.Vector3();
  const nearestCell = (x, y, type) => { let best = null, bd = 1e9; for (const c of cells) { if (type && c.type !== type) continue; const d = Math.hypot(c.c[0] - x, c.c[1] - y); if (d < bd) { bd = d; best = c; } } return best; };
  const paths = [];
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2 + 0.2;
    const apo = k % 2 === 0;
    const pts = [];
    if (apo) { // along walls: walk Voronoi vertices inward through the cortex
      let cur = nearestCell(37 * Math.cos(a), 37 * Math.sin(a), 'cortex');
      let vx = cur.poly.reduce((b, p) => Math.hypot(p[0], p[1]) > Math.hypot(b[0], b[1]) ? p : b);
      pts.push(v3(39.6 * Math.cos(a), 39.6 * Math.sin(a), 0.6));
      for (let step = 0; step < 40; step++) {
        pts.push(v3(vx[0], vx[1], 0.6));
        if (Math.hypot(vx[0], vx[1]) < 17.4) break;
        // candidate next vertices: neighbours along the polygons containing vx
        let best = null, br = Math.hypot(vx[0], vx[1]);
        for (const c of cells) { if (c.type !== 'cortex' && c.type !== 'endo') continue;
          const i = c.poly.findIndex(p => Math.hypot(p[0] - vx[0], p[1] - vx[1]) < 1e-6); if (i < 0) continue;
          for (const q of [c.poly[(i + 1) % c.poly.length], c.poly[(i - 1 + c.poly.length) % c.poly.length]]) {
            const rq = Math.hypot(q[0], q[1]) + 0.25 * Math.abs(Math.atan2(q[1], q[0]) - a);
            if (rq < br) { br = rq; best = q; } } }
        if (!best) break; vx = best;
      }
    } else { // cell to cell (symplast)
      for (const r of [39, 35.4, 31.6, 27.9, 24.3, 20.8, 18.2]) { const c = nearestCell(r * Math.cos(a), r * Math.sin(a)); pts.push(v3(c.c[0], c.c[1], 0.6)); }
    }
    // the endodermis: water must pass through the cell (crossing its membrane)
    const en = nearestCell(16 * Math.cos(a), 16 * Math.sin(a), 'endo'); pts.push(v3(en.c[0], en.c[1], 0.6));
    const pe = nearestCell(14.25 * Math.cos(a), 14.25 * Math.sin(a), 'peri'); pts.push(v3(pe.c[0], pe.c[1], 0.6));
    let bv = vessels[0], bd = 1e9; for (const v of vessels) { const d = Math.hypot(v.x - pe.c[0], v.y - pe.c[1]) - v.rv * 2; if (d < bd) { bd = d; bv = v; } }
    pts.push(v3(bv.x, bv.y, 0.6));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2);
    paths.push({ curve, apo });
  }
  const NP = paths.length * 12;
  const dots = new Sprites(NP, { shape: 'sphere', renderOrder: 12 });
  scene.add(dots.mesh);
  const blue = new THREE.Color(0.35, 0.72, 1.0);

  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.5, 600);
  const path = new CameraPath([
    { t: 0.0, pos: [62, 48, 112], tgt: [2, 0, -4], fov: 38 },
    { t: 1.8, pos: [30, 26, 78], tgt: [3, 3, -2], fov: 36 },
    { t: 3.4, pos: [10, 12, 44], tgt: [3.4, 4.2, 0], fov: 34 },
  ]);
  const update = (t, shot, lt) => {
    path.apply(camera, lt);
    let n = 0;
    for (const p of paths) for (let j = 0; j < 12; j++) {
      const k = clamp((lt * 0.32 + j / 12) % 1);
      p.curve.getPointAt(k, P);
      const a = smooth(k / 0.06) * smooth((1 - k) / 0.08) * smooth((lt - 0.3) / 0.6);
      dots.set(n++, P, 0.52, blue, a);
    }
    dots.commit();
  };
  const post = (t, shot, lt) => ({ focus: camera.position.distanceTo(camera.userData.target), aperture: 4, maxCoc: 14, exposure: 1.1,
    bloom: 0.45, bloomThreshold: 0.9, vignette: 0.5, saturation: 1.05, contrast: 1.06 });
  const endoCell = cells.filter(c => c.type === 'endo' && c.strip).sort((a, b) => Math.abs(Math.atan2(a.c[1], a.c[0]) - 1.15) - Math.abs(Math.atan2(b.c[1], b.c[0]) - 1.15))[0];
  const cortexCell = nearestCell(24.3 * Math.cos(-0.35), 24.3 * Math.sin(-0.35), 'cortex');
  const xv = vessels.find(v => v.proto && v.x > 0 && v.y > 0) || vessels[1];
  const overlay = (ov, t) => {
    ov.label({ text: 'Cortex', at: v3(cortexCell.c[0], cortexCell.c[1], 0.5), dx: 170, dy: 90, t0: 11.25, t1: 13.0 }, camera, t);
    ov.label({ text: 'Endodermis', at: v3(endoCell.c[0], endoCell.c[1], 0.5), dx: -160, dy: -110, t0: 11.6, t1: 13.85 }, camera, t);
    ov.label({ text: 'Casparian strip', sub: 'blocks the route through cell walls', at: endoCell.strip, dx: 230, dy: -40, t0: 12.0, t1: 13.85, color: '#ff8a6a' }, camera, t);
    ov.label({ text: 'Xylem', sub: 'water enters the vessels', at: v3(xv.x, xv.y, 0.5), dx: 180, dy: 110, t0: 12.55, t1: 13.85 }, camera, t);
    ov.scaleBar({ len: 10, text: '100 µm', dist: () => camera.position.distanceTo(camera.userData.target), t0: 11.2, t1: 13.85 }, camera, t);
  };
  return { scene, camera, update, post, overlay };
}
