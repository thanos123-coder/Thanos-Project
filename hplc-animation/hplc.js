'use strict';
/*
 * HPLC explainer animation (Greek narration).
 *
 * Every frame is a pure function of time: window.renderAt(t) draws the frame at t seconds,
 * so the renderer can step through frames in any order. All timing is anchored to the
 * word timestamps of the narration (build/timeline.json), so the picture stays in sync
 * with the voice if the narration is regenerated.
 */
(() => {
const W = 1920, H = 1080;
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');

/* ------------------------------------------------------------------ helpers */
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, p) => a + (b - a) * p;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const smooth = (a, b, x) => { const p = prog(x, a, b); return p * p * (3 - 2 * p); };
const ease = {
  io: p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  out: p => 1 - Math.pow(1 - p, 3),
  back: p => { const c = 1.70158; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); },
};
// 0→1 starting at a (over fi seconds), back to 0 starting at b (over fo seconds)
const fade = (t, a, fi = 0.35, b = Infinity, fo = 0.35) => {
  const fadeIn = ease.out(prog(t, a, a + fi));
  return b === Infinity ? fadeIn : Math.min(fadeIn, 1 - ease.io(prog(t, b, b + fo)));
};
const pop = (t, a, d = 0.45) => (t < a ? 0 : ease.back(prog(t, a, a + d)));
function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = r => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const hex2rgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const rgba = (h, a) => { const [r, g, b] = hex2rgb(h); return `rgba(${r},${g},${b},${a})`; };
const mix = (a, b, p) => { const A = hex2rgb(a), B = hex2rgb(b); return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], p))).join(',')})`; };

const C = {
  ink: '#EEF4FF', sub: '#A6B9D4', faint: '#647B9E',
  accent: '#5CC8FF', accentInk: '#04263D',
  edge: '#47638C', body0: '#2A4062', body1: '#182740', panel: '#0A1526',
  liquid: '#3E9BE6',
  comp: ['#FFC23D', '#FF5C9D', '#A28CFF'],
  uv: '#BBA8FF',
};

/* ------------------------------------------------------------------ text */
const FF = 'Commissioner, "DejaVu Sans", sans-serif';
const font = (size, weight = 600) => `${weight} ${size}px ${FF}`;
// "→" is not in the Greek font subset, so arrows are drawn as vectors that match the type.
function richWidth(str, size) {
  const parts = str.split('→');
  let w = 0;
  parts.forEach((p, i) => { w += ctx.measureText(p).width; if (i < parts.length - 1) w += size * 1.25; });
  return w;
}
function arrowGlyph(x, y, len, size) {
  const h = size * 0.24;
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = Math.max(1.2, size * 0.095); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.moveTo(x + len - h, y - h); ctx.lineTo(x + len, y); ctx.lineTo(x + len - h, y + h);
  ctx.stroke(); ctx.restore();
}
function richDraw(str, x, y, size) { // textBaseline must be 'middle'
  const parts = str.split('→');
  parts.forEach((p, i) => {
    ctx.fillText(p, x, y); x += ctx.measureText(p).width;
    if (i < parts.length - 1) { arrowGlyph(x + size * 0.2, y + size * 0.03, size * 0.85, size); x += size * 1.25; }
  });
}
function label(str, x, y, o = {}) {
  const { size = 20, weight = 600, color = C.ink, align = 'center', alpha = 1 } = o;
  if (alpha <= 0.003) return;
  ctx.save();
  ctx.globalAlpha *= alpha; ctx.font = font(size, weight); ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const w = richWidth(str, size);
  richDraw(str, align === 'center' ? x - w / 2 : align === 'right' ? x - w : x, y, size);
  ctx.restore();
}
function pill(str, x, y, o = {}) {
  const { size = 18, weight = 700, color = C.ink, bg = 'rgba(8,17,32,0.94)', border = C.accent,
    alpha = 1, scale = 1, align = 'center', icon = null } = o;
  if (alpha <= 0.003 || scale <= 0.001) return;
  ctx.save();
  ctx.globalAlpha *= alpha; ctx.translate(x, y); ctx.scale(scale, scale); ctx.font = font(size, weight);
  const padX = size * 0.8, padY = size * 0.48, iw = icon ? size * 1.15 : 0;
  const w = richWidth(str, size) + padX * 2 + iw, h = size + padY * 2;
  const x0 = align === 'center' ? -w / 2 : align === 'right' ? -w : 0;
  ctx.beginPath(); ctx.roundRect(x0, -h / 2, w, h, h / 2);
  ctx.fillStyle = bg; ctx.fill();
  if (border) { ctx.lineWidth = Math.max(1.4, size * 0.1); ctx.strokeStyle = border; ctx.stroke(); }
  if (icon) icon(x0 + padX + size * 0.4, 0, size);
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  richDraw(str, x0 + padX + iw, size * 0.03, size);
  ctx.restore();
}
function checkIcon(color) {
  return (x, y, s) => {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = s * 0.16; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x - s * 0.36, y + s * 0.02); ctx.lineTo(x - s * 0.1, y + s * 0.28); ctx.lineTo(x + s * 0.38, y - s * 0.3); ctx.stroke(); ctx.restore();
  };
}
function balancedLines(str, maxW) {
  if (ctx.measureText(str).width <= maxW) return [str];
  const words = str.split(' ');
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const m = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
    if (!best || m < best.m) best = { m, lines: [a, b] };
  }
  return best.lines;
}

/* ------------------------------------------------------------------ geometry */
function makePath(pts, r) {
  const P = [pts[0]];
  const dir = (a, b) => { const dx = a[0] - b[0], dy = a[1] - b[1], d = Math.hypot(dx, dy); return [dx / d, dy / d]; };
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const u = dir(a, b), v = dir(c, b);
    const p0 = [b[0] + u[0] * r, b[1] + u[1] * r], p2 = [b[0] + v[0] * r, b[1] + v[1] * r];
    for (let k = 0; k <= 12; k++) {
      const s = k / 12, q = 1 - s;
      P.push([q * q * p0[0] + 2 * q * s * b[0] + s * s * p2[0], q * q * p0[1] + 2 * q * s * b[1] + s * s * p2[1]]);
    }
  }
  P.push(pts[pts.length - 1]);
  const L = [0];
  for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  return { P, L, len: L[L.length - 1] };
}
function at(path, s) {
  const { P, L } = path;
  s = clamp(s, 0, path.len);
  let lo = 0, hi = L.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= s) lo = m; else hi = m; }
  const f = (s - L[lo]) / (L[hi] - L[lo] || 1);
  const dx = P[hi][0] - P[lo][0], dy = P[hi][1] - P[lo][1], d = Math.hypot(dx, dy) || 1;
  return { x: lerp(P[lo][0], P[hi][0], f), y: lerp(P[lo][1], P[hi][1], f), tx: dx / d, ty: dy / d };
}
function tracePath(path, s0 = 0, s1 = path.len) {
  ctx.beginPath();
  const a = at(path, s0); ctx.moveTo(a.x, a.y);
  for (let i = 0; i < path.P.length; i++) if (path.L[i] > s0 && path.L[i] < s1) ctx.lineTo(path.P[i][0], path.P[i][1]);
  const b = at(path, s1); ctx.lineTo(b.x, b.y);
}

/* ------------------------------------------------------------------ layout (world units) */
const Y = 560; // main flow line
const LAY = {
  bottle: { x: 165, top: 440, bot: 640, w: 124 },
  degas: { x: 410, y: Y, w: 150, h: 112 },
  pump: { x: 640, y: Y, w: 180, h: 150 },
  gauge: { x: 640, y: 425, r: 40 },
  inj: { x: 860, y: Y, r: 44 },
  syr: { x: 860, top: 286, bot: 428 },
  col: { x0: 975, x1: 1385, r: 24 },
  det: { x: 1530, y: Y, w: 190, h: 160 },
  mon: { x: 1530, y: 300, w: 420, h: 240 },
  waste: { x: 1770, top: 652, bot: 760, w: 84 },
};
const LABEL_Y = 694;
const LABELS = [
  { id: 'bottle', x: 165, y: LABEL_Y, t: 'Κινητή φάση', s: 'διαλύτης' },
  { id: 'degas', x: 410, y: LABEL_Y, t: 'Απαεριωτής', s: 'αφαιρεί φυσαλίδες' },
  { id: 'pump', x: 640, y: LABEL_Y, t: 'Αντλία', s: 'υψηλή πίεση' },
  { id: 'inj', x: 860, y: LABEL_Y, t: 'Εισαγωγέας', s: 'βάζει το δείγμα' },
  { id: 'col', x: 1180, y: LABEL_Y, t: 'Στήλη', s: 'διαχωρισμός' },
  { id: 'det', x: 1530, y: LABEL_Y, t: 'Ανιχνευτής', s: 'φως UV' },
  { id: 'waste', x: 1672, y: 716, t: 'Απόβλητα', s: '' },
];
const FLOW = makePath([[165, 626], [165, 372], [300, 372], [300, Y], [1770, Y], [1770, 712]], 22);
const S = {};
function sAtX(x) {
  const { P, L } = FLOW;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i];
    if (Math.abs(a[1] - Y) < 0.01 && Math.abs(b[1] - Y) < 0.01 && (x - a[0]) * (x - b[0]) <= 0) return L[i - 1] + Math.abs(x - a[0]);
  }
  throw new Error('x is not on the main run: ' + x);
}
// degasser serpentine (the membrane tube inside the degasser window)
const SERP = (() => {
  const x = LAY.degas.x, a = Y - 16, b = Y + 16;
  return makePath([[x - 75, Y], [x - 50, Y], [x - 50, a], [x - 30, a], [x - 30, b], [x - 10, b], [x - 10, a], [x + 10, a],
    [x + 10, b], [x + 30, b], [x + 30, a], [x + 50, a], [x + 50, Y], [x + 75, Y]], 5);
})();

/* ------------------------------------------------------------------ timeline anchors */
let TL = null;
const T = {};
const seg = id => { const s = TL.segments.find(x => x.id === id); if (!s) throw new Error('segment ' + id); return s; };
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function word(id, w, k = 0) {
  let n = 0;
  for (const x of seg(id).words) if (norm(x.w) === norm(w) && n++ === k) return x;
  throw new Error(`word "${w}" #${k} not found in ${id}`);
}
const wt = (id, w, k) => word(id, w, k).t0;
const we = (id, w, k) => word(id, w, k).t1;

function buildAnchors() {
  T.hplc = wt('intro', 'Έιτς'); T.mix = wt('intro', 'Χωρίζει'); T.parts = wt('intro', 'συστατικά');
  T.what = wt('intro', 'τι'); T.how = wt('intro', 'πόσο'); T.introEnd = seg('intro').end;
  T.reveal = T.introEnd + 0.1;
  T.solvent = seg('solvent').start; T.phase = wt('solvent', 'κινητή'); T.degas = wt('solvent', 'απαεριωτή');
  T.remove = wt('solvent', 'αφαιρεί'); T.bubbleWord = wt('solvent', 'φυσαλίδες');
  T.pump = seg('pump').start; T.push = wt('pump', 'σπρώχνει'); T.flow = wt('pump', 'σταθερή');
  T.press = wt('pump', 'πολύ'); T.pressEnd = we('pump', 'πίεση');
  T.inject = seg('inject').start; T.add = wt('inject', 'προσθέτει'); T.sample = wt('inject', 'δείγματος');
  T.column = seg('column').start; T.heart = wt('column', 'καρδιά'); T.full = wt('column', 'γεμάτη');
  T.beads = wt('column', 'κόκκους'); T.stat = wt('column', 'στατική');
  T.sep = seg('separate').start; T.little = wt('separate', 'Όσες', 0); T.much = wt('separate', 'ενώ');
  T.apart = wt('separate', 'Έτσι'); T.sepEnd = seg('separate').end;
  T.det = seg('detector').start; T.uv = wt('detector', 'στέλνει'); T.pass = wt('detector', 'Όταν');
  T.abs = wt('detector', 'απορροφά'); T.rise = wt('detector', 'ανεβαίνει');
  T.chrom = seg('chrom').start; T.chromWord = wt('chrom', 'χρωματογράφημα'); T.peaks = wt('chrom', 'κάθε');
  T.read = seg('read').start; T.rt = wt('read', 'χρόνος'); T.which = wt('read', 'δείχνει');
  T.area = wt('read', 'εμβαδόν'); T.amount = wt('read', 'πόση');
  T.recap = seg('recap').start;
  T.r1 = wt('recap', 'αντλία'); T.r2 = wt('recap', 'στήλη'); T.r3 = wt('recap', 'ανιχνευτής');
  T.v1 = wt('recap', 'σπρώχνει'); T.v2 = wt('recap', 'χωρίζει'); T.v3 = wt('recap', 'μετρά');
  T.end = TL.speechEnd + 2.6;
}

/* ------------------------------------------------------------------ physics: flow, pressure, sample bands */
const S_SLOW = 24, S_FAST = 70;         // flow speed in the tubing (world units / s)
const flowSpeed = t => lerp(S_SLOW, S_FAST, ease.io(prog(t, T.push, T.push + 0.9)));
function flowPhase(t) {
  const a = T.push, b = T.push + 0.9;
  if (t <= a) return S_SLOW * t;
  if (t >= b) return S_SLOW * a + (S_SLOW + S_FAST) / 2 * 0.9 + S_FAST * (t - b);
  let acc = 0; const n = 30, dt = (t - a) / n;
  for (let i = 0; i < n; i++) acc += flowSpeed(a + (i + 0.5) * dt) * dt;
  return S_SLOW * a + acc;
}
const pumpPhase = t => flowPhase(t) * 0.085;
const pressure = t => lerp(115, 400, ease.io(prog(t, T.push + 0.15, T.pressEnd + 0.15))) + 3 * Math.sin(pumpPhase(t) * 2);

// Chromatogram: three resolved peaks; compound 0 (gold) is held least and elutes first.
const CHV = 0.62; // chart minutes per video second
let PEAKS = [], BANDS = [], BAND_DOTS = [];
const signal = tau => PEAKS.reduce((s, p) => s + p.A * Math.exp(-((tau - p.P) ** 2) / (2 * p.s * p.s)), 0);
const signalNorm = t => clamp(signal(t) / PEAKS[0].A);
function buildPhysics() {
  S.cap = 626 - 400; S.degIn = sAtX(335); S.inj = sAtX(LAY.inj.x); S.col0 = sAtX(LAY.col.x0);
  S.col1 = sAtX(LAY.col.x1); S.cell = sAtX(LAY.det.x); S.wasteIn = FLOW.len - (712 - 652);
  T.injFlow = wt('inject', 'μικρή') + 0.3;
  T.colIn = T.injFlow + (S.col0 - S.inj) / S_FAST;
  T.chart0 = T.det + 0.85;
  // peak 1 rises on "...και το σήμα ανεβαίνει"; all three are drawn by "...είναι μία ουσία"
  const P1 = T.rise + 0.05;
  const defs = [{ A: 0.66, s: 0.30, n: 30 }, { A: 0.44, s: 0.34, n: 22 }, { A: 0.55, s: 0.40, n: 34 }];
  const Ps = [P1, P1 + 2.0, P1 + 2.0 + 2.1];
  PEAKS = defs.map((d, k) => ({ ...d, k, P: Ps[k], m: (Ps[k] - T.chart0) * CHV, sm: d.s * CHV }));
  const transit = (S.cell - S.col1) / S_FAST;
  BANDS = PEAKS.map(p => { const tout = p.P - transit; return { tout, u: (S.col1 - S.col0) / (tout - T.colIn) }; });
  const r = mulberry(11);
  BAND_DOTS = [];
  PEAKS.forEach((p, k) => { for (let i = 0; i < p.n; i++) BAND_DOTS.push({ k, z: clamp(gauss(r), -2.6, 2.6), lat: (r() * 2 - 1) * 0.86 }); });
}
function bandS(k, tau) { // arc length of the centre of band k along FLOW at time tau (-1 = not injected yet)
  if (tau < T.injFlow) return -1;
  if (tau < T.colIn) return S.inj + S_FAST * (tau - T.injFlow);
  const b = BANDS[k];
  if (tau < b.tout) return S.col0 + b.u * (tau - T.colIn);
  return S.col1 + S_FAST * (tau - b.tout);
}

/* ------------------------------------------------------------------ magnified column view (inset) */
const INS = { x: 150, y: 200, w: 1620, h: 590 };
const ROWS = [34, 138, 242, 346, 450, 554], LANES = [86, 190, 294, 398, 502];
const U = 190; // free-flight speed of molecules in the inset (px / s)
const MOLP = [ // mean free / held durations (s): gold is held briefly, violet for long
  { tf: 0.95, ts: 0.22, n: 16, r: 10 },
  { tf: 0.42, ts: 0.46, n: 13, r: 10 },
  { tf: 0.24, ts: 0.85, n: 19, r: 10 },
];
let BEADS = [], MOLS = [];
const laneY = (m, x) => LANES[m.lane] + 4 * Math.sin(x / 70 + m.ph);
function nearestBead(row, x) {
  let best = null;
  for (const b of BEADS) if (b.row === row && (!best || Math.abs(b.x - x) < Math.abs(best.x - x))) best = b;
  return best;
}
function contactPoint(b, x, y, mr) {
  const dx = x - b.x, dy = y - b.y, d = Math.hypot(dx, dy) || 1;
  return { x: b.x + dx / d * (b.r + mr * 0.85), y: b.y + dy / d * (b.r + mr * 0.85) };
}
function simulateMol(k, seed, t0, t1) {
  const r = mulberry(seed), P = MOLP[k];
  const m = { k, lane: Math.floor(r() * LANES.length), ph: r() * 6.283, ev: [] };
  let x = -200 + r() * 170, t = t0, held = r() < P.ts / (P.tf + P.ts);
  while (t < t1) {
    const d = -Math.log(1 - r()) * (held ? P.ts : P.tf);
    if (held) {
      const row = m.lane + (r() < 0.5 ? 0 : 1);
      const b = nearestBead(row, x);
      const c = contactPoint(b, x, laneY(m, x), P.r);
      m.ev.push({ t0: t, t1: t + d, held: true, x, c });
    } else {
      m.ev.push({ t0: t, t1: t + d, held: false, x });
      x += U * d;
    }
    t += d; held = !held;
  }
  return m;
}
function molPos(m, t) {
  const ev = m.ev;
  let i = 0;
  while (i < ev.length - 1 && ev[i].t1 <= t) i++;
  const e = ev[i];
  if (!e.held) { const x = e.x + U * (t - e.t0); return { x, y: laneY(m, x), h: 0 }; }
  const fy = laneY(m, e.x), tin = 0.09;
  const a = Math.min(ease.io(prog(t, e.t0, e.t0 + tin)), 1 - ease.io(prog(t, e.t1 - tin, e.t1)));
  return { x: lerp(e.x, e.c.x, a), y: lerp(fy, e.c.y, a), h: a };
}
function buildInset() {
  const r = mulberry(7);
  BEADS = [];
  ROWS.forEach((y, j) => {
    for (let x = -88 + (j % 2) * 44; x < INS.w + 88; x += 88) BEADS.push({ x: x + (r() - 0.5) * 10, y: y + (r() - 0.5) * 8, r: 28 + r() * 5, row: j });
  });
  T.sim0 = T.stat;
  const tRef = T.apart + 0.6, tEnd = T.sepEnd + 1.2;
  MOLS = [];
  MOLP.forEach((P, k) => {
    // Simulate many candidate molecules and keep an evenly spaced set from the middle of the
    // distribution: real stick-and-release paths, but bands tight enough to read clearly.
    const cands = [];
    for (let i = 0; i < 240; i++) { const m = simulateMol(k, 1000 * (k + 1) + i, T.sim0, tEnd); m.xr = molPos(m, tRef).x; cands.push(m); }
    cands.sort((a, b) => a.xr - b.xr);
    for (let i = 0; i < P.n; i++) MOLS.push(cands[Math.round(lerp(0.22, 0.78, i / (P.n - 1)) * (cands.length - 1))]);
  });
}

/* ------------------------------------------------------------------ other precomputed scenery */
let PACK = [], SYR_DOTS = [], BUBBLES = [], INTRO = [], SUBS = [], CAM = [];
function buildScenery() {
  let r = mulberry(3);
  PACK = [];
  const K = LAY.col;
  for (let j = 0; j < 7; j++) for (let x = K.x0 + 14 + (j % 2) * 3.6; x < K.x1 - 12; x += 7.2)
    PACK.push({ x: x + (r() - 0.5) * 1.6, y: Y - 18 + j * 6 + (r() - 0.5) * 1.4, r: 2.5 + r() * 0.7 });
  r = mulberry(5);
  SYR_DOTS = [];
  for (let i = 0; i < 15; i++) SYR_DOTS.push({ k: i % 3, fx: 0.15 + r() * 0.7, fy: r(), ph: r() * 6.28 });
  r = mulberry(9);
  BUBBLES = [];
  for (let i = 0; i < 8; i++) BUBBLES.push({ off: i * 61 + r() * 30, r: 3.6 + r() * 1.2, i });
  // intro: one mixture, three pure groups (different amounts)
  r = mulberry(21);
  INTRO = [];
  const counts = [8, 6, 10], gx = [1290, 1480, 1670];
  counts.forEach((n, k) => {
    const slots = hexSlots(n, 25);
    for (let i = 0; i < n; i++) {
      INTRO.push({ k, vx: 458 + r() * 124, vy: 612 + r() * 92, gx: gx[k] + slots[i][0], gy: 636 + slots[i][1],
        d: 0.22 * k + r() * 0.28, my: (r() - 0.5) * 50, ph: r() * 6.28, rot: (r() - 0.5) * 0.6 });
    }
  });
}
function hexSlots(n, sp) {
  const s = [[0, 0]];
  for (let ring = 1; s.length < n; ring++) {
    for (let i = 0; i < 6 * ring && s.length < n; i++) {
      const a = (i / (6 * ring)) * Math.PI * 2;
      s.push([Math.cos(a) * sp * ring, Math.sin(a) * sp * ring * 0.9]);
    }
  }
  return s;
}
function buildSubs() {
  SUBS = [];
  for (const sg of TL.segments) {
    const sentences = sg.text.match(/[^.;!]+[.;!]?/g).map(s => s.trim()).filter(Boolean);
    let wi = 0;
    for (const s of sentences) {
      let n = s.split(/\s+/).length;
      if (s.includes('HPLC')) n += 3; // spoken letter by letter
      const w0 = sg.words[Math.min(wi, sg.words.length - 1)], w1 = sg.words[Math.min(wi + n, sg.words.length) - 1];
      SUBS.push({ text: s, t0: w0.t0 - 0.12, t1: w1.t1 });
      wi += n;
    }
    if (wi !== sg.words.length) console.warn('subtitle word count mismatch in', sg.id, wi, sg.words.length);
  }
  for (let i = 0; i < SUBS.length; i++) {
    const nx = SUBS[i + 1];
    SUBS[i].t1 = nx && nx.t0 - SUBS[i].t1 < 0.9 ? nx.t0 : SUBS[i].t1 + 0.45;
  }
}

/* ------------------------------------------------------------------ camera */
const OV = { x: 957, y: 478, z: 1.06 };
function buildCamera() {
  const SOLV = { x: 300, y: 505, z: 1.6 }, PUMP = { x: 650, y: 490, z: 1.65 }, INJ = { x: 850, y: 480, z: 1.55 };
  const COL = { x: 1180, y: 540, z: 1.6 }, DET = { x: 1505, y: 452, z: 1.55 }, MON = { x: 1530, y: 300, z: 2.6 };
  CAM = [];
  const key = (t, c) => CAM.push({ t, ...c });
  key(0, { ...OV, z: 0.95 }); key(T.reveal, { ...OV, z: 0.95 }); key(T.reveal + 1.3, OV);
  key(T.phase - 0.35, OV); key(T.phase + 0.75, SOLV);
  key(T.pump - 0.45, SOLV); key(T.pump + 0.45, PUMP);
  key(T.inject - 0.45, PUMP); key(T.inject + 0.45, INJ);
  key(T.column - 0.4, INJ); key(T.column + 0.6, COL);
  key(T.sepEnd, COL); key(T.sepEnd + 1.0, DET);
  key(T.read - 0.35, DET); key(T.read + 0.7, MON);
  key(T.recap - 0.45, MON); key(T.recap + 0.9, OV);
  key(T.end, { ...OV, z: 1.035 });
}
function camAt(t) {
  if (t <= CAM[0].t) return CAM[0];
  for (let i = 0; i < CAM.length - 1; i++) {
    const a = CAM[i], b = CAM[i + 1];
    if (t <= b.t) {
      const p = ease.io(prog(t, a.t, b.t));
      return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), p)) };
    }
  }
  return CAM[CAM.length - 1];
}
const toScreen = (c, x, y) => [(x - c.x) * c.z + W / 2, (y - c.y) * c.z + H / 2];

/* ------------------------------------------------------------------ focus / dimming */
const recapF = (t, a) => fade(t, a - 0.1, 0.3);
function focusOf(id, t) {
  const f = (a, b) => fade(t, a, 0.35, b, 0.35);
  switch (id) {
    case 'bottle': return f(T.solvent - 0.25, T.degas - 0.25);
    case 'degas': return f(T.degas - 0.25, T.pump - 0.3);
    case 'pump': return Math.max(f(T.pump - 0.3, T.inject - 0.3), recapF(t, T.r1));
    case 'inj': return f(T.inject - 0.3, T.column - 0.35);
    case 'col': return Math.max(f(T.column - 0.35, T.det - 0.3), recapF(t, T.r2));
    case 'det': return Math.max(f(T.det - 0.3, T.chrom + 0.3), recapF(t, T.r3));
    case 'mon': return f(T.pass - 0.4, T.r1 - 0.2);
    default: return 0;
  }
}
const dimLevel = t => fade(t, T.phase - 0.35, 0.6, T.v3 + 0.6, 0.6);
const reveal = (t, x) => { const d = (x - 100) / 1700 * 0.7; return ease.out(prog(t, T.reveal + d, T.reveal + d + 0.5)); };
const vis = (id, x, t) => reveal(t, x) * lerp(1, lerp(0.34, 1, focusOf(id, t)), dimLevel(t));
function withComp(id, x, t, fn) {
  const rv = reveal(t, x);
  if (rv <= 0) return;
  ctx.save();
  ctx.globalAlpha *= vis(id, x, t);
  ctx.translate(0, (1 - rv) * 14);
  fn(focusOf(id, t));
  ctx.restore();
}

/* ------------------------------------------------------------------ drawing: shared pieces */
function deviceBox(x, y, w, h, f, r = 14) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, r);
  const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
  g.addColorStop(0, C.body0); g.addColorStop(1, C.body1);
  ctx.fillStyle = g; ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, r);
  ctx.lineWidth = 2; ctx.strokeStyle = C.edge; ctx.stroke();
  focusRing(f);
  ctx.beginPath(); ctx.roundRect(x - w / 2 + 6, y - h / 2 + 4, w - 12, 3, 2); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
  ctx.restore();
}
function focusRing(f) { // strokes the current path with a glow
  if (f <= 0.01) return;
  ctx.save();
  ctx.shadowColor = rgba(C.accent, 0.85 * f); ctx.shadowBlur = 26; ctx.lineWidth = 3; ctx.strokeStyle = rgba(C.accent, f);
  ctx.stroke(); ctx.restore();
}
function insetPanel(x, y, w, h, r = 8) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = C.panel; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(120,150,195,0.35)'; ctx.stroke();
}
function bottleShape(x, top, bot, w, neckW, neckTop) {
  ctx.beginPath();
  ctx.moveTo(x - neckW / 2, neckTop); ctx.lineTo(x - neckW / 2, top - 4);
  ctx.quadraticCurveTo(x - w / 2, top, x - w / 2, top + 24);
  ctx.lineTo(x - w / 2, bot - 14); ctx.quadraticCurveTo(x - w / 2, bot, x - w / 2 + 14, bot);
  ctx.lineTo(x + w / 2 - 14, bot); ctx.quadraticCurveTo(x + w / 2, bot, x + w / 2, bot - 14);
  ctx.lineTo(x + w / 2, top + 24); ctx.quadraticCurveTo(x + w / 2, top, x + neckW / 2, top - 4);
  ctx.lineTo(x + neckW / 2, neckTop); ctx.closePath();
}
function molShape(k, s) {
  ctx.beginPath();
  if (k === 0) ctx.arc(0, 0, 10 * s, 0, Math.PI * 2);
  else if (k === 1) {
    const R = 13.5 * s;
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3, px = Math.cos(a) * R, py = Math.sin(a) * R + 2.2 * s;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  } else ctx.roundRect(-9 * s, -9 * s, 18 * s, 18 * s, 4 * s);
}
function drawMol(k, x, y, s = 1, alpha = 1, glow = 0, rot = 0) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha *= alpha; ctx.translate(x, y);
  if (glow > 0.01) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 27 * s);
    g.addColorStop(0, rgba(C.comp[k], 0.6 * glow)); g.addColorStop(1, rgba(C.comp[k], 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 27 * s, 0, Math.PI * 2); ctx.fill();
  }
  ctx.rotate(rot);
  molShape(k, s); ctx.fillStyle = C.comp[k]; ctx.fill();
  ctx.lineWidth = 1.6 * s; ctx.strokeStyle = 'rgba(8,12,22,0.55)'; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(-3.2 * s, -3.2 * s, 2.5 * s, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function arrowLine(x0, y0, x1, y1, color, w, head) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - Math.cos(a) * head * 0.6, y1 - Math.sin(a) * head * 0.6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - Math.cos(a - 0.45) * head, y1 - Math.sin(a - 0.45) * head);
  ctx.lineTo(x1 - Math.cos(a + 0.45) * head, y1 - Math.sin(a + 0.45) * head); ctx.closePath(); ctx.fill();
  ctx.restore();
}

/* ------------------------------------------------------------------ background */
function drawBackground(t, cam) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0A1526'); g.addColorStop(1, '#08111F');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const rg = ctx.createRadialGradient(W * 0.5, H * 0.42, 60, W * 0.5, H * 0.42, 1150);
  rg.addColorStop(0, 'rgba(46,98,170,0.22)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
  // dot grid in world space (moves with the camera, gives depth to camera moves)
  const sp = 40, x0 = cam.x - W / 2 / cam.z, y0 = cam.y - H / 2 / cam.z;
  ctx.fillStyle = 'rgba(150,185,235,0.075)';
  const rr = Math.max(1, 1.3 * Math.sqrt(cam.z));
  for (let gx = Math.floor(x0 / sp) * sp; gx < x0 + W / cam.z + sp; gx += sp)
    for (let gy = Math.floor(y0 / sp) * sp; gy < y0 + H / cam.z + sp; gy += sp) {
      const [sx, sy] = toScreen(cam, gx, gy);
      ctx.fillRect(sx - rr / 2, sy - rr / 2, rr, rr);
    }
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.05);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
}

/* ------------------------------------------------------------------ world: tubing, flow and bubbles */
function drawTubes(t) {
  const rv = ease.io(prog(t, T.reveal, T.reveal + 1.15));
  ctx.save();
  ctx.globalAlpha = lerp(1, 0.6, dimLevel(t));
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  tracePath(FLOW);
  const L = FLOW.len;
  ctx.setLineDash([L * rv, L + 50]);
  ctx.lineWidth = 11; ctx.strokeStyle = '#5A7399'; ctx.stroke();
  ctx.lineWidth = 7; ctx.strokeStyle = '#132A49'; ctx.stroke();
  ctx.lineWidth = 5; ctx.strokeStyle = rgba(C.liquid, 0.9); ctx.stroke();
  ctx.setLineDash([7, 15]); ctx.lineDashOffset = -flowPhase(t);
  ctx.globalAlpha *= smooth(0.85, 1, rv);
  ctx.lineWidth = 2.2; ctx.strokeStyle = 'rgba(200,236,255,0.8)'; ctx.stroke();
  ctx.restore();
  // inlet filter at the end of the solvent line
  ctx.save(); ctx.globalAlpha *= reveal(t, 165) * vis('bottle', 165, t);
  ctx.beginPath(); ctx.roundRect(156, 622, 18, 13, 3); ctx.fillStyle = '#8BA0BF'; ctx.fill();
  ctx.restore();
}
function drawBubbles(t) {
  if (t < T.reveal + 0.8) return;
  const Lin = S.degIn - S.cap, serpL = SERP.len * 0.42, CYC = Lin + serpL + 70;
  const D = LAY.degas, ph = flowPhase(t);
  const a0 = smooth(T.reveal + 0.8, T.reveal + 1.4, t) * vis('degas', D.x, t);
  for (const b of BUBBLES) {
    const u = (((ph + b.off) % CYC) + CYC) % CYC;
    let x, y, r = b.r, a = 1;
    if (u < Lin) {
      const q = at(FLOW, S.cap + u); x = q.x; y = q.y; a = smooth(0, 18, u);
    } else if (u < Lin + serpL) {
      const v = u - Lin, q = at(SERP, v); x = q.x; y = q.y;
      const p = v / serpL; r = b.r * (1 - 0.75 * p); a = 1 - p;
      // the air leaves through the membrane and is pumped away at the top
      const lift = smooth(0.15, 1, p), ax = D.x - 34 + (b.i % 4) * 22;
      const ay = lerp(Y - 12, Y - 70, lift);
      ctx.save(); ctx.globalAlpha = a0 * (1 - lift) * 0.9;
      ctx.beginPath(); ctx.arc(ax, ay, 2.4 + 2 * lift, 0, Math.PI * 2); ctx.strokeStyle = '#DDF1FF'; ctx.lineWidth = 1.3; ctx.stroke();
      ctx.restore();
    } else continue;
    ctx.save(); ctx.globalAlpha = a0 * a;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(225,244,255,0.28)'; ctx.fill();
    ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(245,252,255,0.95)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.28, 0, Math.PI * 2); ctx.fillStyle = '#FFFFFF'; ctx.fill();
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ world: devices */
function drawBottle(t) {
  const B = LAY.bottle;
  withComp('bottle', B.x, t, f => {
    const neckTop = B.top - 26;
    bottleShape(B.x, B.top, B.bot, B.w, 40, neckTop);
    ctx.fillStyle = 'rgba(170,205,250,0.07)'; ctx.fill();
    ctx.save(); ctx.clip();
    const lvl = B.bot - 0.72 * (B.bot - B.top);
    ctx.beginPath(); ctx.moveTo(B.x - B.w, B.bot + 5);
    for (let x = B.x - B.w / 2 - 2; x <= B.x + B.w / 2 + 2; x += 4) ctx.lineTo(x, lvl + 2.2 * Math.sin(x / 13 + t * 2.4));
    ctx.lineTo(B.x + B.w, B.bot + 5); ctx.closePath();
    const g = ctx.createLinearGradient(0, lvl, 0, B.bot);
    g.addColorStop(0, 'rgba(98,190,255,0.55)'); g.addColorStop(1, 'rgba(38,112,210,0.62)');
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();
    bottleShape(B.x, B.top, B.bot, B.w, 40, neckTop);
    ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgba(200,226,255,0.6)'; ctx.stroke();
    focusRing(f);
    ctx.beginPath(); ctx.roundRect(B.x - B.w / 2 + 10, B.top + 28, 5, B.bot - B.top - 52, 3); ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fill();
    // cap
    ctx.beginPath(); ctx.roundRect(B.x - 26, neckTop - 15, 52, 18, 4); ctx.fillStyle = '#3B5A86'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#6E8DBA'; ctx.stroke();
  });
}
function drawDegasser(t) {
  const D = LAY.degas;
  withComp('degas', D.x, t, f => {
    deviceBox(D.x, D.y, D.w, D.h, f);
    const wx = D.x - 60, wy = D.y - 32, ww = 120, wh = 64;
    insetPanel(wx, wy, ww, wh);
    ctx.save();
    ctx.beginPath(); ctx.roundRect(wx, wy, ww, wh, 8); ctx.clip();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    tracePath(SERP);
    ctx.lineWidth = 6; ctx.strokeStyle = '#8EA6C8'; ctx.stroke();
    ctx.lineWidth = 3.6; ctx.strokeStyle = rgba(C.liquid, 0.95); ctx.stroke();
    ctx.setLineDash([5, 9]); ctx.lineDashOffset = -flowPhase(t) + S.degIn - 40;
    ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(205,238,255,0.85)'; ctx.stroke();
    ctx.restore();
    // vacuum outlet on top
    ctx.beginPath(); ctx.roundRect(D.x - 12, D.y - D.h / 2 - 9, 24, 10, 3); ctx.fillStyle = '#5A7399'; ctx.fill();
  });
}
function drawPump(t) {
  const P = LAY.pump;
  withComp('pump', P.x, t, f => {
    deviceBox(P.x, P.y, P.w, P.h, f);
    const wx = P.x - 74, wy = P.y - 36, ww = 148, wh = 72;
    insetPanel(wx, wy, ww, wh);
    const ph = pumpPhase(t), cy = P.y;
    // cam wheel and connecting rod drive the piston
    const wxc = P.x - 50, wr = 13, pinX = wxc + Math.cos(ph) * 9, pinY = cy + Math.sin(ph) * 9;
    const headX = P.x + 14 + Math.cos(ph) * 9;
    ctx.beginPath(); ctx.roundRect(P.x - 6, cy - 16, 66, 32, 5); ctx.fillStyle = '#1D3150'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#6C86AE'; ctx.stroke();
    ctx.fillStyle = rgba(C.liquid, 0.8); ctx.fillRect(headX + 4, cy - 13, P.x + 57 - headX - 4, 26);
    ctx.beginPath(); ctx.arc(wxc, cy, wr, 0, Math.PI * 2); ctx.fillStyle = '#3A5276'; ctx.fill(); ctx.strokeStyle = '#8CA4C8'; ctx.stroke();
    ctx.lineCap = 'round'; ctx.strokeStyle = '#C9D5E6'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(pinX, pinY); ctx.lineTo(headX - 6, cy); ctx.stroke();
    ctx.beginPath(); ctx.arc(pinX, pinY, 3.2, 0, Math.PI * 2); ctx.fillStyle = '#E8EEF7'; ctx.fill();
    ctx.beginPath(); ctx.roundRect(headX - 6, cy - 13, 10, 26, 2); ctx.fillStyle = '#D3DDEB'; ctx.fill();
  });
}
function drawGauge(t) {
  const G = LAY.gauge;
  withComp('pump', G.x, t, f => {
    ctx.fillStyle = '#7189AD'; ctx.fillRect(G.x - 4, G.y + G.r, 8, LAY.pump.y - LAY.pump.h / 2 - G.y - G.r + 2);
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5;
    ctx.beginPath(); ctx.arc(G.x, G.y, G.r + 5, 0, Math.PI * 2);
    const bz = ctx.createLinearGradient(0, G.y - G.r, 0, G.y + G.r); bz.addColorStop(0, '#C8D3E2'); bz.addColorStop(1, '#5D6E88');
    ctx.fillStyle = bz; ctx.fill(); ctx.restore();
    ctx.beginPath(); ctx.arc(G.x, G.y, G.r + 5, 0, Math.PI * 2); focusRing(f);
    ctx.beginPath(); ctx.arc(G.x, G.y, G.r, 0, Math.PI * 2); ctx.fillStyle = '#ECF2FA'; ctx.fill();
    const ang = v => ((135 + 270 * clamp(v / 400)) * Math.PI) / 180;
    ctx.beginPath(); ctx.arc(G.x, G.y, G.r - 6, ang(300), ang(400)); ctx.strokeStyle = 'rgba(229,72,77,0.35)'; ctx.lineWidth = 5; ctx.stroke();
    ctx.strokeStyle = '#2A3A54';
    for (let v = 0; v <= 400; v += 25) {
      const a = ang(v), major = v % 100 === 0, r0 = G.r - 3, r1 = G.r - (major ? 11 : 7);
      ctx.lineWidth = major ? 1.8 : 1;
      ctx.beginPath(); ctx.moveTo(G.x + Math.cos(a) * r0, G.y + Math.sin(a) * r0); ctx.lineTo(G.x + Math.cos(a) * r1, G.y + Math.sin(a) * r1); ctx.stroke();
    }
    ctx.font = font(8.5, 700); ctx.fillStyle = '#2A3A54'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let v = 0; v <= 400; v += 100) { const a = ang(v); ctx.fillText(String(v), G.x + Math.cos(a) * 21, G.y + Math.sin(a) * 21); }
    ctx.font = font(8.5, 600); ctx.fillText('bar', G.x, G.y + 19);
    const a = ang(pressure(t));
    ctx.strokeStyle = '#E5484D'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(G.x - Math.cos(a) * 6, G.y - Math.sin(a) * 6); ctx.lineTo(G.x + Math.cos(a) * (G.r - 8), G.y + Math.sin(a) * (G.r - 8)); ctx.stroke();
    ctx.beginPath(); ctx.arc(G.x, G.y, 4.5, 0, Math.PI * 2); ctx.fillStyle = '#2A3A54'; ctx.fill();
  });
}
function drawInjector(t) {
  const I = LAY.inj;
  withComp('inj', I.x, t, f => {
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 7;
    ctx.beginPath(); ctx.arc(I.x, I.y, I.r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(I.x - 14, I.y - 16, 4, I.x, I.y, I.r);
    g.addColorStop(0, '#C3CEDD'); g.addColorStop(1, '#5B6B83');
    ctx.fillStyle = g; ctx.fill(); ctx.restore();
    ctx.beginPath(); ctx.arc(I.x, I.y, I.r, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = '#8193AE'; ctx.stroke(); focusRing(f);
    ctx.beginPath(); ctx.arc(I.x, I.y, I.r - 9, 0, Math.PI * 2); ctx.fillStyle = '#243A5B'; ctx.fill();
    const rot = (ease.io(prog(t, T.add + 0.3, T.add + 0.6)) * Math.PI) / 3;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a0 = rot + (i * 2 * Math.PI) / 3;
      ctx.beginPath(); ctx.arc(I.x, I.y, 26, a0 + 0.12, a0 + Math.PI / 3 - 0.12);
      ctx.lineWidth = 6; ctx.strokeStyle = '#132A49'; ctx.stroke();
      ctx.lineWidth = 3.6; ctx.strokeStyle = rgba(C.liquid, 0.9); ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      ctx.beginPath(); ctx.arc(I.x + Math.cos(a) * 26, I.y + Math.sin(a) * 26, 4.6, 0, Math.PI * 2);
      ctx.fillStyle = '#0D1A2D'; ctx.fill(); ctx.lineWidth = 1.4; ctx.strokeStyle = '#9FB0C8'; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(I.x, I.y, 7, 0, Math.PI * 2); ctx.fillStyle = '#9FB0C8'; ctx.fill();
  });
}
function drawSyringe(t) {
  const Sy = LAY.syr, I = LAY.inj, x = Sy.x, bw = 30;
  withComp('inj', x, t, () => {
    const push = ease.io(prog(t, T.add + 0.1, T.add + 1.1));
    const stopY = lerp(330, 372, push);
    ctx.strokeStyle = '#C3CDDC'; ctx.lineWidth = 2.6; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(x, Sy.bot + 8); ctx.lineTo(x, I.y - I.r + 4); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(x - 7, Sy.bot - 1, 14, 11, 2); ctx.fillStyle = '#8FA2BE'; ctx.fill();
    ctx.beginPath(); ctx.roundRect(x - bw / 2, Sy.top, bw, Sy.bot - Sy.top, 5); ctx.fillStyle = 'rgba(190,215,250,0.09)'; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = 'rgba(126,190,255,0.30)'; ctx.fillRect(x - bw / 2, stopY, bw, Sy.bot - stopY);
    for (const d of SYR_DOTS) {
      const yy = lerp(stopY + 8, Sy.bot - 8, d.fy) + Math.sin(t * 2 + d.ph) * 1.5;
      ctx.beginPath(); ctx.arc(x - bw / 2 + bw * d.fx + Math.cos(t * 1.7 + d.ph) * 1.2, yy, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = C.comp[d.k]; ctx.fill();
    }
    ctx.restore();
    ctx.beginPath(); ctx.roundRect(x - bw / 2, Sy.top, bw, Sy.bot - Sy.top, 5); ctx.lineWidth = 1.8; ctx.strokeStyle = 'rgba(205,228,255,0.65)'; ctx.stroke();
    ctx.strokeStyle = 'rgba(205,228,255,0.45)'; ctx.lineWidth = 1;
    for (let gy = Sy.top + 22; gy < Sy.bot - 6; gy += 12) { ctx.beginPath(); ctx.moveTo(x - bw / 2, gy); ctx.lineTo(x - bw / 2 + (gy % 24 < 12 ? 9 : 5), gy); ctx.stroke(); }
    ctx.beginPath(); ctx.roundRect(x - bw / 2 + 2, stopY - 9, bw - 4, 9, 2); ctx.fillStyle = '#2C3446'; ctx.fill();
    ctx.fillStyle = '#D5DEEA'; ctx.fillRect(x - 3, stopY - 9 - 76, 6, 76);
    ctx.beginPath(); ctx.roundRect(x - 17, stopY - 9 - 82, 34, 7, 3); ctx.fill();
    ctx.beginPath(); ctx.roundRect(x - 25, Sy.top - 3, 50, 6, 3); ctx.fillStyle = '#AFC0D6'; ctx.fill();
    // the injected drop runs down the needle into the valve
    const p = prog(t, T.add + 0.55, T.add + 1.05);
    if (p > 0 && p < 1) {
      const dy = lerp(Sy.bot + 10, I.y - I.r + 2, ease.io(p));
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(x + (k - 1) * 2.4, dy + (k % 2) * 2.5, 2.4, 0, Math.PI * 2); ctx.fillStyle = C.comp[k]; ctx.fill(); }
    }
  });
}
function fitting(x, y) {
  const w = 26, h = 60;
  const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
  g.addColorStop(0, '#8E9DB3'); g.addColorStop(0.25, '#DDE5EF'); g.addColorStop(0.6, '#7F8EA5'); g.addColorStop(1, '#46546A');
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, 4); ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(30,40,58,0.6)'; ctx.stroke();
  ctx.strokeStyle = 'rgba(30,40,58,0.35)';
  for (const dx of [-5, 5]) { ctx.beginPath(); ctx.moveTo(x + dx, y - h / 2 + 3); ctx.lineTo(x + dx, y + h / 2 - 3); ctx.stroke(); }
}
function drawColumn(t) {
  const K = LAY.col, r = K.r;
  withComp('col', (K.x0 + K.x1) / 2, t, f => {
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 8;
    const g = ctx.createLinearGradient(0, Y - r, 0, Y + r);
    g.addColorStop(0, '#7E8EA6'); g.addColorStop(0.2, '#CDD7E5'); g.addColorStop(0.55, '#7A8AA2'); g.addColorStop(1, '#3E4C62');
    ctx.beginPath(); ctx.roundRect(K.x0, Y - r, K.x1 - K.x0, 2 * r, 8); ctx.fillStyle = g; ctx.fill(); ctx.restore();
    ctx.beginPath(); ctx.roundRect(K.x0, Y - r, K.x1 - K.x0, 2 * r, 8); focusRing(f);
    const wx0 = K.x0 + 15, wx1 = K.x1 - 15, wy0 = Y - r + 5, wy1 = Y + r - 5;
    ctx.save();
    ctx.beginPath(); ctx.roundRect(wx0, wy0, wx1 - wx0, wy1 - wy0, 6); ctx.fillStyle = '#0B1628'; ctx.fill(); ctx.clip();
    ctx.fillStyle = 'rgba(152,180,218,0.36)';
    for (const p of PACK) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    ctx.beginPath(); ctx.roundRect(wx0, wy0, wx1 - wx0, wy1 - wy0, 6); ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(214,228,246,0.55)'; ctx.stroke();
    fitting(K.x0 - 1, Y); fitting(K.x1 + 1, Y);
  });
}
function drawDetector(t) {
  const D = LAY.det;
  withComp('det', D.x, t, f => {
    deviceBox(D.x, D.y, D.w, D.h, f);
    const px = D.x - 82, py = D.y - 66, pw = 164, ph = 132;
    insetPanel(px, py, pw, ph);
    ctx.fillStyle = '#17304F'; ctx.fillRect(px, Y - 5, pw, 10);
    ctx.fillStyle = rgba(C.liquid, 0.9); ctx.fillRect(px, Y - 3, pw, 6);
    ctx.save(); ctx.beginPath(); ctx.moveTo(px, Y); ctx.lineTo(px + pw, Y);
    ctx.setLineDash([7, 15]); ctx.lineDashOffset = -flowPhase(t) + sAtX(px); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(200,236,255,0.8)'; ctx.stroke(); ctx.restore();
    const sn = signalNorm(t), emph = 0.65 + 0.35 * fade(t, T.uv - 0.1, 0.4, T.chrom, 0.6);
    const lampY = py + 14, sensY = py + ph - 26;
    // UV beam: lamp -> flow cell -> sensor; less light gets through while a compound passes
    const beam = (y0, y1, a) => {
      const gb = ctx.createLinearGradient(D.x - 9, 0, D.x + 9, 0);
      gb.addColorStop(0, rgba(C.uv, 0)); gb.addColorStop(0.5, rgba(C.uv, a)); gb.addColorStop(1, rgba(C.uv, 0));
      ctx.fillStyle = gb; ctx.fillRect(D.x - 9, y0, 18, y1 - y0);
    };
    beam(lampY + 12, Y - 8, 0.85 * emph);
    beam(Y + 8, sensY, 0.85 * emph * (1 - 0.82 * sn));
    const lg = ctx.createRadialGradient(D.x, lampY + 6, 2, D.x, lampY + 6, 26);
    lg.addColorStop(0, rgba(C.uv, 0.7 * emph)); lg.addColorStop(1, rgba(C.uv, 0));
    ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(D.x, lampY + 6, 26, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(D.x - 18, lampY, 36, 13, 5); ctx.fillStyle = '#E4DCFF'; ctx.fill();
    ctx.beginPath(); ctx.roundRect(D.x - 22, sensY, 44, 13, 3); ctx.fillStyle = '#1C2A40'; ctx.fill();
    ctx.lineWidth = 1.4; ctx.strokeStyle = '#7D93B6'; ctx.stroke();
    ctx.fillStyle = rgba(C.uv, 0.9 * emph * (1 - 0.82 * sn)); ctx.fillRect(D.x - 14, sensY + 1, 28, 3);
  });
}
function drawDetectorCell(t) { // drawn after the sample so the passing band sits inside the light
  const D = LAY.det;
  const a = reveal(t, D.x) * vis('det', D.x, t);
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = a;
  const sn = signalNorm(t);
  if (sn > 0.02) {
    let kk = 0, best = 0;
    PEAKS.forEach((p, k) => { const v = p.A * Math.exp(-((t - p.P) ** 2) / (2 * p.s * p.s)); if (v > best) { best = v; kk = k; } });
    const g = ctx.createRadialGradient(D.x, Y, 1, D.x, Y, 24);
    g.addColorStop(0, rgba(C.comp[kk], 0.55 * sn)); g.addColorStop(1, rgba(C.comp[kk], 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(D.x, Y, 24, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = rgba(C.uv, 0.22); ctx.fillRect(D.x - 7, Y - 8, 14, 16);
  ctx.beginPath(); ctx.roundRect(D.x - 14, Y - 10, 28, 20, 3); ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(225,232,255,0.75)'; ctx.stroke();
  ctx.restore();
}
function drawCable(t) {
  const a = reveal(t, 1650) * vis('det', 1650, t);
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = a;
  const p0 = [1625, 512], p1 = [1695, 505], p2 = [1700, 424];
  ctx.beginPath(); ctx.moveTo(...p0); ctx.quadraticCurveTo(...p1, ...p2);
  ctx.lineWidth = 5; ctx.strokeStyle = '#2E4467'; ctx.lineCap = 'round'; ctx.stroke();
  const sn = signalNorm(t);
  for (let i = 0; i < 4; i++) {
    const s = ((t * 0.9 + i / 4) % 1), q = 1 - s;
    const x = q * q * p0[0] + 2 * q * s * p1[0] + s * s * p2[0], y = q * q * p0[1] + 2 * q * s * p1[1] + s * s * p2[1];
    ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fillStyle = rgba(C.accent, 0.35 + 0.65 * sn); ctx.fill();
  }
  ctx.restore();
}
function drawWaste(t) {
  const Wb = LAY.waste;
  withComp('waste', Wb.x, t, () => {
    const neckTop = Wb.top - 18;
    bottleShape(Wb.x, Wb.top, Wb.bot, Wb.w, 30, neckTop);
    ctx.fillStyle = 'rgba(170,205,250,0.06)'; ctx.fill();
    ctx.save(); ctx.clip();
    const lvl = Wb.bot - (0.22 + 0.16 * prog(t, 8, 59)) * (Wb.bot - Wb.top);
    ctx.fillStyle = 'rgba(160,170,150,0.42)'; ctx.fillRect(Wb.x - Wb.w, lvl, Wb.w * 2, Wb.bot - lvl + 4);
    ctx.restore();
    bottleShape(Wb.x, Wb.top, Wb.bot, Wb.w, 30, neckTop);
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(200,226,255,0.5)'; ctx.stroke();
    ctx.beginPath(); ctx.roundRect(Wb.x - 19, neckTop - 11, 38, 13, 3); ctx.fillStyle = '#4C5F7E'; ctx.fill();
  });
}

/* ------------------------------------------------------------------ world: the sample (three compounds) */
function drawSample(t) {
  if (t < T.injFlow) return;
  const K = LAY.col;
  const alpha = vis('col', 1180, t);
  // soft glow for each band while it is inside the column window
  ctx.save();
  ctx.beginPath(); ctx.roundRect(K.x0 + 15, Y - K.r + 5, K.x1 - K.x0 - 30, 2 * K.r - 10, 6); ctx.clip();
  PEAKS.forEach((p, k) => {
    const s = bandS(k, t);
    if (s < S.col0 - 10 || s > S.col1 + 10) return;
    const frac = clamp((s - S.col0) / (S.col1 - S.col0));
    const sig = Math.max(3, BANDS[k].u * p.s * (0.28 + 0.72 * Math.sqrt(frac)));
    const q = at(FLOW, s);
    ctx.save(); ctx.globalAlpha = alpha * 0.8; ctx.translate(q.x, Y); ctx.scale(sig * 2.2 / 20, 1);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 20);
    g.addColorStop(0, rgba(C.comp[k], 0.5)); g.addColorStop(1, rgba(C.comp[k], 0));
    ctx.fillStyle = g; ctx.fillRect(-20, -20, 40, 40);
    ctx.restore();
  });
  ctx.restore();
  PEAKS.forEach((p, k) => {
    const s = bandS(k, t);
    if (s < S.inj + LAY.inj.r + 6 || s > S.wasteIn - 4 || (s > S.col0 - 14 && s < S.col1 + 14)) return;
    const q = at(FLOW, s), len = S_FAST * p.s * (s < S.col0 ? 0.28 : 1);
    ctx.save(); ctx.globalAlpha = alpha * (s < S.col0 ? 0.55 : 0.85);
    ctx.translate(q.x, q.y); ctx.rotate(Math.atan2(q.ty, q.tx)); ctx.scale(Math.max(len, 5) * 2.2 / 10, 1);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 10);
    g.addColorStop(0, rgba(C.comp[k], 0.75)); g.addColorStop(1, rgba(C.comp[k], 0));
    ctx.fillStyle = g; ctx.fillRect(-10, -10, 20, 20);
    ctx.restore();
  });
  const rp = prog(t, T.injFlow - 0.15, T.injFlow + 0.65);
  if (rp > 0 && rp < 1) {
    ctx.save(); ctx.globalAlpha = (1 - rp) * 0.8 * vis('inj', LAY.inj.x, t);
    ctx.beginPath(); ctx.arc(LAY.inj.x, Y, LAY.inj.r + 4 + 34 * ease.out(rp), 0, Math.PI * 2);
    ctx.lineWidth = 3; ctx.strokeStyle = '#FFE3A3'; ctx.stroke();
    ctx.restore();
  }
  for (const d of BAND_DOTS) {
    const p = PEAKS[d.k];
    const sc = bandS(d.k, t);
    if (sc < 0) continue;
    const frac = clamp((sc - S.col0) / (S.col1 - S.col0));
    const g = sc < S.col0 ? 0.28 : 0.28 + 0.72 * Math.sqrt(frac);
    const s = bandS(d.k, t - d.z * p.s * g);
    if (s < S.inj + LAY.inj.r + 1 || s > S.wasteIn + 8) continue;
    const q = at(FLOW, s);
    if ((q.x > K.x0 - 15 && q.x < K.x0 + 15) || (q.x > K.x1 - 15 && q.x < K.x1 + 15)) continue; // behind the fittings
    if ((q.x > 1435 && q.x < 1448) || (q.x > 1612 && q.x < 1625)) continue; // detector walls
    const inCol = smooth(S.col0 + 8, S.col0 + 22, s) * (1 - smooth(S.col1 - 22, S.col1 - 8, s));
    const rad = lerp(2.4, 15, inCol);
    const x = q.x - q.ty * d.lat * rad, y = q.y + q.tx * d.lat * rad;
    ctx.save(); ctx.globalAlpha = alpha * (s > S.wasteIn ? 1 - prog(s, S.wasteIn, S.wasteIn + 8) : 1);
    ctx.beginPath(); ctx.arc(x, y, lerp(2.1, 2.3, inCol), 0, Math.PI * 2); ctx.fillStyle = C.comp[d.k]; ctx.fill();
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ world: monitor + chromatogram */
const CH = { x0: 1378, x1: 1716, y0: 236, y1: 372, mMax: 8 };
const mx = m => lerp(CH.x0, CH.x1, m / CH.mMax);
const my = v => CH.y1 - v * (CH.y1 - CH.y0);
const penM = t => clamp((t - T.chart0) * CHV, 0, CH.mMax);
const gaussM = (p, m) => p.A * Math.exp(-((m - p.m) ** 2) / (2 * p.sm * p.sm));
const noiseM = m => 0.004 * Math.sin(37 * m) + 0.003 * Math.sin(91 * m + 1) + 0.002 * Math.sin(173 * m + 2);
const signalM = m => PEAKS.reduce((s, p) => s + gaussM(p, m), 0) + noiseM(m);
function drawMonitor(t) {
  const M = LAY.mon;
  withComp('mon', M.x, t, f => {
    ctx.fillStyle = '#22344F'; ctx.fillRect(M.x - 14, M.y + M.h / 2, 28, 26);
    ctx.beginPath(); ctx.roundRect(M.x - 64, M.y + M.h / 2 + 24, 128, 8, 4); ctx.fillStyle = '#2C3F5C'; ctx.fill();
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
    ctx.beginPath(); ctx.roundRect(M.x - M.w / 2, M.y - M.h / 2, M.w, M.h, 14); ctx.fillStyle = '#121E31'; ctx.fill(); ctx.restore();
    ctx.beginPath(); ctx.roundRect(M.x - M.w / 2, M.y - M.h / 2, M.w, M.h, 14); ctx.lineWidth = 2; ctx.strokeStyle = C.edge; ctx.stroke(); focusRing(f);
    ctx.beginPath(); ctx.roundRect(M.x - M.w / 2 + 10, M.y - M.h / 2 + 10, M.w - 20, M.h - 20, 6); ctx.fillStyle = '#050E1A'; ctx.fill();
    drawChart(t);
  });
}
function drawChart(t) {
  label('Χρωματογράφημα', 1343, 206, { size: 14, weight: 700, align: 'left' });
  const live = t > T.chart0 && penM(t) < CH.mMax;
  if (live) { ctx.beginPath(); ctx.arc(1708, 206, 3.6, 0, Math.PI * 2); ctx.fillStyle = rgba('#FF5D5D', 0.6 + 0.4 * Math.sin(t * 6)); ctx.fill(); }
  // axes
  ctx.strokeStyle = 'rgba(166,185,212,0.55)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(CH.x0, CH.y0 - 4); ctx.lineTo(CH.x0, CH.y1); ctx.lineTo(CH.x1 + 4, CH.y1); ctx.stroke();
  ctx.font = font(9, 600); ctx.fillStyle = C.sub; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let m = 0; m <= CH.mMax; m += 2) {
    ctx.beginPath(); ctx.moveTo(mx(m), CH.y1); ctx.lineTo(mx(m), CH.y1 + 3.5); ctx.stroke();
    ctx.fillText(String(m), mx(m), CH.y1 + 11);
  }
  label('χρόνος (min)', (CH.x0 + CH.x1) / 2, CH.y1 + 25, { size: 9.5, weight: 600, color: C.sub });
  ctx.save(); ctx.translate(CH.x0 - 13, (CH.y0 + CH.y1) / 2); ctx.rotate(-Math.PI / 2);
  label('σήμα', 0, 0, { size: 9.5, weight: 600, color: C.sub }); ctx.restore();
  const mp = penM(t);
  if (t <= T.chart0) return;
  // areas under the peaks (stronger when the narration talks about the area)
  const areaEmph = fade(t, T.area - 0.1, 0.5, T.recap + 0.6, 0.6);
  const sweep = prog(t, T.area - 0.1, T.area + 0.8);
  PEAKS.forEach(p => {
    const m0 = Math.max(0, p.m - 3.2 * p.sm), m1 = Math.min(p.m + 3.2 * p.sm, mp);
    if (m1 <= m0) return;
    ctx.beginPath(); ctx.moveTo(mx(m0), CH.y1);
    for (let m = m0; m <= m1; m += 0.01) ctx.lineTo(mx(m), my(gaussM(p, m)));
    ctx.lineTo(mx(m1), my(gaussM(p, m1))); ctx.lineTo(mx(m1), CH.y1); ctx.closePath();
    const g = ctx.createLinearGradient(0, my(p.A), 0, CH.y1);
    g.addColorStop(0, rgba(C.comp[p.k], 0.62)); g.addColorStop(1, rgba(C.comp[p.k], 0.2));
    ctx.fillStyle = g; ctx.fill();
    if (areaEmph > 0) {
      ctx.save(); ctx.clip();
      ctx.fillStyle = rgba(C.comp[p.k], 0.55 * areaEmph);
      ctx.fillRect(CH.x0, CH.y0 - 10, (CH.x1 - CH.x0) * sweep, CH.y1 - CH.y0 + 10);
      ctx.strokeStyle = rgba('#FFFFFF', 0.35 * areaEmph); ctx.lineWidth = 1;
      for (let hx = CH.x0 - 140; hx < CH.x0 + (CH.x1 - CH.x0) * sweep; hx += 6) { ctx.beginPath(); ctx.moveTo(hx, CH.y1); ctx.lineTo(hx + 136, CH.y0 - 4); ctx.stroke(); }
      ctx.restore();
    }
  });
  // the trace
  ctx.beginPath();
  for (let m = 0; m <= mp + 1e-9; m += 0.012) { const y = my(signalM(m)); if (m === 0) ctx.moveTo(mx(m), y); else ctx.lineTo(mx(m), y); }
  ctx.lineTo(mx(mp), my(signalM(mp)));
  ctx.lineWidth = 1.7; ctx.strokeStyle = '#EAF6FF'; ctx.lineJoin = 'round'; ctx.stroke();
  if (live) {
    const g = ctx.createRadialGradient(mx(mp), my(signalM(mp)), 0, mx(mp), my(signalM(mp)), 9);
    g.addColorStop(0, 'rgba(160,225,255,0.95)'); g.addColorStop(1, 'rgba(160,225,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mx(mp), my(signalM(mp)), 9, 0, Math.PI * 2); ctx.fill();
  }
  // retention times: from the injection (t = 0) to each peak
  const rtA = fade(t, T.rt - 0.15, 0.4, T.recap + 0.6, 0.6);
  if (rtA > 0) {
    ctx.save(); ctx.globalAlpha *= rtA;
    ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(234,246,255,0.7)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(CH.x0, CH.y1); ctx.lineTo(CH.x0, CH.y0 - 8); ctx.stroke(); ctx.setLineDash([]);
    label('έγχυση', CH.x0 + 3, CH.y0 - 12, { size: 8.5, weight: 700, color: C.sub, align: 'left' });
    PEAKS.forEach((p, k) => {
      const g = ease.io(prog(t, T.rt + 0.2 * k, T.rt + 0.2 * k + 0.55));
      if (g <= 0) return;
      const yy = 263 - 9 * k, xe = lerp(CH.x0, mx(p.m), g);
      arrowLine(CH.x0 + 1, yy, xe, yy, C.comp[k], 1.6, 5.5);
      if (g >= 1) {
        ctx.save(); ctx.setLineDash([2.5, 2.5]); ctx.strokeStyle = rgba(C.comp[k], 0.85); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(mx(p.m), yy + 2); ctx.lineTo(mx(p.m), my(p.A) - 10); ctx.stroke(); ctx.restore();
      }
    });
    ctx.restore();
  }
  // peak numbers
  PEAKS.forEach((p, k) => {
    const born = T.chart0 + (p.m + 0.2 * p.sm) / CHV;
    if (t < born) return;
    const s = pop(t, born, 0.4) * (1 + 0.25 * Math.sin(Math.PI * prog(t, T.peaks + 0.25 * k, T.peaks + 0.25 * k + 0.5)) + 0.25 * Math.sin(Math.PI * prog(t, T.which + 0.15 * k, T.which + 0.15 * k + 0.5)));
    ctx.save(); ctx.translate(mx(p.m), my(p.A) - 13); ctx.scale(s, s);
    ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fillStyle = C.comp[k]; ctx.fill();
    ctx.font = font(9.5, 800); ctx.fillStyle = '#10141F'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(k + 1), 0, 0.6);
    ctx.restore();
  });
}

/* ------------------------------------------------------------------ world: labels and callouts */
function drawLabels(t) {
  for (const L of LABELS) {
    const rv = reveal(t, L.x);
    if (rv <= 0) continue;
    const a = vis(L.id, L.x, t), f = focusOf(L.id, t);
    ctx.save(); ctx.translate(0, (1 - rv) * 10);
    label(L.t, L.x, L.y, { size: 21, weight: 700, color: mix(C.ink, C.accent, f), alpha: a });
    if (L.s) label(L.s, L.x, L.y + 25, { size: 15, weight: 500, color: C.sub, alpha: a });
    ctx.restore();
  }
}
function drawCallouts(t) {
  const D = LAY.degas, P = LAY.pump, G = LAY.gauge;
  // solvent + degasser
  let a = fade(t, T.remove - 0.15, 0.35, T.pump - 0.45, 0.3);
  if (a > 0) {
    pill('φυσαλίδες αέρα', 300, 448, { size: 13, alpha: a, border: '#DDF1FF', scale: pop(t, T.remove - 0.15) });
    ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = 'rgba(221,241,255,0.7)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(300, 461); ctx.lineTo(300, 470); ctx.stroke(); ctx.restore();
  }
  a = fade(t, T.bubbleWord + 0.1, 0.35, T.pump - 0.45, 0.3);
  if (a > 0) {
    ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = 'rgba(74,222,128,0.75)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(518, 488); ctx.lineTo(518, 551); ctx.stroke(); ctx.restore();
    pill('χωρίς φυσαλίδες', 528, 476, { size: 13, alpha: a, border: '#4ADE80', icon: checkIcon('#4ADE80'), scale: pop(t, T.bubbleWord + 0.1) });
  }
  a = fade(t, T.degas, 0.35, T.pump - 0.45, 0.3);
  if (a > 0) {
    ctx.save(); ctx.globalAlpha = a;
    arrowLine(D.x, D.y - D.h / 2 - 12, D.x, D.y - D.h / 2 - 42, '#DDF1FF', 2, 7);
    ctx.restore();
    label('αέρας', D.x, D.y - D.h / 2 - 54, { size: 13, weight: 700, color: '#DDF1FF', alpha: a });
  }
  // pump: constant flow + high pressure
  a = fade(t, T.flow - 0.1, 0.35, T.inject - 0.45, 0.3);
  if (a > 0) {
    ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = C.accent; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < 3; i++) {
      const cx = 748 + ((t * 40 + i * 20) % 60);
      ctx.globalAlpha = a * Math.sin(Math.PI * ((cx - 748) / 60));
      ctx.beginPath(); ctx.moveTo(cx - 4, Y - 15); ctx.lineTo(cx + 2, Y - 10); ctx.lineTo(cx - 4, Y - 5); ctx.stroke();
    }
    ctx.restore();
    pill('σταθερή ροή', 785, 616, { size: 13, alpha: a, scale: pop(t, T.flow - 0.1) });
  }
  a = fade(t, T.press - 0.05, 0.35, T.inject - 0.45, 0.3);
  if (a > 0) {
    pill('έως ~400 bar', G.x - G.r - 14, G.y - 10, { size: 15, alpha: a, align: 'right', border: '#FF7A7A', scale: pop(t, T.press - 0.05) });
    label('400 φορές η ατμοσφαιρική πίεση', G.x - G.r - 14, G.y + 20, { size: 12, weight: 600, color: C.sub, align: 'right', alpha: a });
  }
  // injector
  a = fade(t, T.sample - 0.2, 0.35, T.column - 0.45, 0.3);
  if (a > 0) pill('δείγμα: μείγμα ουσιών', 834, 330, { size: 15, alpha: a, align: 'right', scale: pop(t, T.sample - 0.2) });
  // column
  a = fade(t, T.heart - 0.1, 0.35, T.full - 0.15, 0.25);
  if (a > 0) pill('η καρδιά του συστήματος', 1180, 500, { size: 14, alpha: a, scale: pop(t, T.heart - 0.1) });
  // detector
  a = fade(t, T.uv - 0.1, 0.4, T.chrom + 0.2, 0.4);
  if (a > 0) {
    const Dt = LAY.det;
    const lab = (txt, y, ty) => {
      label(txt, Dt.x - Dt.w / 2 - 14, y, { size: 13, weight: 700, color: '#DCD3FF', align: 'right', alpha: a });
      ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = 'rgba(220,211,255,0.6)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(Dt.x - Dt.w / 2 - 9, y); ctx.lineTo(Dt.x - 24, ty); ctx.stroke(); ctx.restore();
    };
    lab('λάμπα UV', Dt.y - 70, Dt.y - 46);
    lab('αισθητήρας', Dt.y + 58, Dt.y + 47);
  }
  // recap verbs
  const verbs = [[T.v1, 640, 'σπρώχνει'], [T.v2, 1180, 'χωρίζει'], [T.v3, 1530, 'μετρά']];
  for (const [tv, x, w] of verbs) {
    const s = pop(t, tv - 0.12, 0.5);
    if (s > 0) pill(w, x, 760, { size: 20, scale: s, alpha: fade(t, tv - 0.12, 0.2), color: C.accent });
  }
}

/* ------------------------------------------------------------------ inset: inside the column */
function insetRect(t, cam) {
  const open = ease.io(prog(t, T.full - 0.05, T.full + 0.6)) * (1 - ease.io(prog(t, T.sepEnd - 0.05, T.sepEnd + 0.5)));
  if (open <= 0) return null;
  const K = LAY.col;
  const [ax, ay] = toScreen(cam, K.x0 + 15, Y - K.r + 5), [bx, by] = toScreen(cam, K.x1 - 15, Y + K.r - 5);
  return { open, x: lerp(ax, INS.x, open), y: lerp(ay, INS.y, open), w: lerp(bx - ax, INS.w, open), h: lerp(by - ay, INS.h, open) };
}
function drawInset(t, cam) {
  const R = insetRect(t, cam);
  if (!R) return;
  const ca = smooth(0.55, 1, R.open);
  ctx.fillStyle = `rgba(4,9,18,${0.72 * R.open})`; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 40;
  ctx.beginPath(); ctx.roundRect(R.x, R.y, R.w, R.h, 22 * R.open + 6);
  const bg = ctx.createLinearGradient(0, R.y, 0, R.y + R.h);
  bg.addColorStop(0, '#0B1830'); bg.addColorStop(1, '#081222');
  ctx.fillStyle = bg; ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath(); ctx.roundRect(R.x, R.y, R.w, R.h, 22 * R.open + 6);
  ctx.lineWidth = 2.5; ctx.strokeStyle = rgba(C.accent, 0.75); ctx.shadowColor = rgba(C.accent, 0.5); ctx.shadowBlur = 24; ctx.stroke();
  ctx.restore();
  if (ca <= 0) return;
  ctx.save();
  ctx.beginPath(); ctx.roundRect(R.x, R.y, R.w, R.h, 22 * R.open + 6); ctx.clip();
  ctx.translate(R.x, R.y); ctx.scale(R.w / INS.w, R.h / INS.h);
  ctx.globalAlpha = ca;
  // mobile phase streaming between the grains
  ctx.save(); ctx.setLineDash([22, 34]); ctx.lineDashOffset = -(t * U) % 56; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(110,190,255,0.22)';
  for (const ly of LANES) { ctx.beginPath(); ctx.moveTo(-60, ly); ctx.lineTo(INS.w + 60, ly); ctx.stroke(); }
  ctx.restore();
  // grains (stationary phase)
  for (const b of BEADS) {
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(150,185,235,0.10)'; ctx.fill();
    const g = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.1, b.x, b.y, b.r);
    g.addColorStop(0, '#A3B6CF'); g.addColorStop(0.55, '#61779A'); g.addColorStop(1, '#394C6B');
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(205,222,255,0.25)'; ctx.stroke();
  }
  // molecules
  const eg = fade(t, T.little - 0.1, 0.3, T.much - 0.25, 0.3), ev = fade(t, T.much - 0.1, 0.3, T.apart - 0.35, 0.3);
  const dimK = [ev, Math.max(eg, ev), eg], glowK = [eg, 0, ev];
  const sums = [[], [], []];
  if (t >= T.sim0) {
    for (const k of [2, 1, 0]) for (const m of MOLS) {
      if (m.k !== k) continue;
      const p = molPos(m, t);
      sums[k].push(p.x);
      if (p.x < -30 || p.x > INS.w + 30) continue;
      drawMol(k, p.x, p.y, 1.2, 1 - 0.65 * dimK[k], Math.max(p.h * 0.85, glowK[k] * 0.7), p.h * 0.3);
    }
  }
  // labels
  pill('Μέσα στη στήλη', 24, 36, { size: 22, align: 'left', alpha: 1, icon: magnifier });
  let a = fade(t, T.full + 0.45, 0.4, T.little - 0.5, 0.3);
  if (a > 0) pill('κινητή φάση →', INS.w - 30, 36, { size: 20, align: 'right', alpha: a, border: '#7FC6FF' });
  a = fade(t, T.beads - 0.1, 0.4, T.sep + 1.6, 0.35);
  if (a > 0) {
    const b = nearestBead(4, 810);
    ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = 'rgba(234,246,255,0.75)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(810, 535); ctx.lineTo(b.x, b.y + b.r + 2); ctx.stroke(); ctx.restore();
    pill('κόκκοι = στατική φάση', 810, 552, { size: 22, alpha: a, scale: pop(t, T.beads - 0.1) });
  }
  const mean = arr => arr.reduce((s, v) => s + v, 0) / Math.max(1, arr.length);
  const median = arr => { const s = [...arr].sort((p, q) => p - q); return s[Math.floor(s.length / 2)] || 0; };
  if (eg > 0) pill('κρατιούνται λίγο → γρήγορα', clamp(mean(sums[0]), 560, INS.w - 230), 36, { size: 22, alpha: eg, color: C.comp[0], border: C.comp[0] });
  if (ev > 0) pill('κρατιούνται πολύ → αργά', clamp(mean(sums[2]), 230, INS.w - 230), 552, { size: 22, alpha: ev, color: C.comp[2], border: C.comp[2] });
  for (let k = 0; k < 3; k++) {
    const s = pop(t, T.apart + 0.12 * k, 0.45);
    if (s <= 0 || !sums[k].length) continue;
    ctx.save(); ctx.translate(clamp(median(sums[k]), 40, INS.w - 40), 552); ctx.scale(s, s);
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fillStyle = C.comp[k]; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,17,32,0.9)'; ctx.stroke();
    ctx.font = font(24, 800); ctx.fillStyle = '#10141F'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(k + 1), 0, 1);
    ctx.restore();
  }
  ctx.restore();
}
function magnifier(x, y, s) {
  ctx.save(); ctx.strokeStyle = C.accent; ctx.lineWidth = s * 0.13; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(x - s * 0.08, y - s * 0.08, s * 0.3, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + s * 0.15, y + s * 0.15); ctx.lineTo(x + s * 0.4, y + s * 0.4); ctx.stroke(); ctx.restore();
}

/* ------------------------------------------------------------------ screen-space cards while reading the chart */
function drawReadCards(t) {
  const card = (cx, a, a2, title, line2, icon, color) => {
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = a; ctx.translate(cx, 540 + (1 - a) * 16);
    ctx.beginPath(); ctx.roundRect(-172, -98, 344, 196, 22); ctx.fillStyle = 'rgba(9,18,34,0.94)'; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = rgba(color, 0.9); ctx.stroke();
    icon(0, -50);
    label(title, 0, 4, { size: 28, weight: 800, color });
    label(line2, 0, 50, { size: 25, weight: 600, alpha: a2 });
    ctx.restore();
  };
  const a1 = fade(t, T.rt - 0.15, 0.4, T.recap - 0.5, 0.4), a2 = fade(t, T.which - 0.1, 0.35);
  card(222, a1, a2, 'Χρόνος κατακράτησης', '→ ποια ουσία είναι', (x, y) => {
    PEAKS.forEach((p, k) => arrowLine(x - 66, y - 12 + k * 12, x - 66 + 50 + k * 40, y - 12 + k * 12, C.comp[k], 4, 11));
  }, C.accent);
  const b1 = fade(t, T.area - 0.15, 0.4, T.recap - 0.5, 0.4), b2 = fade(t, T.amount - 0.1, 0.35);
  card(W - 222, b1, b2, 'Εμβαδόν κορυφής', '→ πόση ποσότητα', (x, y) => {
    ctx.beginPath(); ctx.moveTo(x - 50, y + 18);
    for (let i = -50; i <= 50; i += 2) ctx.lineTo(x + i, y + 18 - 40 * Math.exp(-(i * i) / (2 * 15 * 15)));
    ctx.closePath(); ctx.fillStyle = rgba(C.comp[2], 0.75); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#EAF6FF'; ctx.stroke();
  }, C.comp[2]);
}

/* ------------------------------------------------------------------ intro (screen space) */
function drawIntro(t) {
  const out = 1 - ease.io(prog(t, T.introEnd - 0.05, T.introEnd + 0.45));
  if (out <= 0) return;
  ctx.save(); ctx.globalAlpha = out;
  // title block: centred, then moves up when the mixture appears
  const mv = ease.io(prog(t, T.mix - 0.3, T.mix + 0.35));
  const ty = lerp(430, 178, mv), sc = lerp(1, 0.62, mv);
  ctx.save(); ctx.translate(W / 2, ty); ctx.scale(sc, sc);
  const a1 = fade(t, 0.25, 0.6), r1 = (1 - ease.out(prog(t, 0.25, 0.9))) * 26;
  ctx.save(); ctx.globalAlpha *= a1; ctx.translate(0, r1);
  ctx.font = font(92, 800); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const t1 = 'Πώς λειτουργεί το ', t2 = 'HPLC', t3 = ';';
  const w1 = ctx.measureText(t1).width, w2 = ctx.measureText(t2).width, w3 = ctx.measureText(t3).width, x0 = -(w1 + w2 + w3) / 2;
  ctx.fillStyle = C.ink; ctx.fillText(t1, x0, 0);
  ctx.fillStyle = C.accent; ctx.fillText(t2, x0 + w1, 0);
  ctx.fillStyle = C.ink; ctx.fillText(t3, x0 + w1 + w2, 0);
  ctx.restore();
  const a2 = fade(t, T.hplc - 0.15, 0.5);
  label('Υγρή Χρωματογραφία Υψηλής Απόδοσης', 0, 92 + (1 - a2) * 14, { size: 42, weight: 600, color: C.sub, alpha: a2 });
  const a3 = fade(t, T.hplc + 0.1, 0.5) * (1 - mv);
  if (a3 > 0) {
    ctx.save(); ctx.globalAlpha *= a3;
    const parts = [['H', 1], ['igh ', 0], ['P', 1], ['erformance ', 0], ['L', 1], ['iquid ', 0], ['C', 1], ['hromatography', 0]];
    ctx.textBaseline = 'middle';
    let tw = 0; parts.forEach(([s, b]) => { ctx.font = font(27, b ? 800 : 500); tw += ctx.measureText(s).width; });
    let x = -tw / 2;
    parts.forEach(([s, b]) => { ctx.font = font(27, b ? 800 : 500); ctx.fillStyle = b ? C.accent : C.faint; ctx.fillText(s, x, 146); x += ctx.measureText(s).width; });
    ctx.restore();
  }
  ctx.restore();
  // the idea: a mixture goes in, separated substances come out
  ctx.save(); ctx.translate(0, -58);
  const ga = fade(t, T.mix - 0.1, 0.45);
  if (ga > 0) {
    ctx.save(); ctx.globalAlpha *= ga;
    // vial
    const vx = 520;
    bottleShape(vx, 584, 724, 150, 58, 548);
    ctx.fillStyle = 'rgba(170,205,250,0.07)'; ctx.fill();
    ctx.save(); ctx.clip(); ctx.fillStyle = 'rgba(98,190,255,0.22)'; ctx.fillRect(vx - 90, 600, 180, 140); ctx.restore();
    bottleShape(vx, 584, 724, 150, 58, 548); ctx.lineWidth = 2.6; ctx.strokeStyle = 'rgba(200,226,255,0.65)'; ctx.stroke();
    label('μείγμα', vx, 764, { size: 28, weight: 700 });
    arrowLine(612, 652, 770, 652, 'rgba(166,185,212,0.8)', 3.5, 14);
    arrowLine(1040, 652, 1180, 652, 'rgba(166,185,212,0.8)', 3.5, 14);
    ctx.restore();
  }
  // molecules travel through the HPLC box to their own groups
  for (const m of INTRO) {
    const t0 = T.parts - 0.15 + m.d, p = ease.io(prog(t, t0, t0 + 0.95));
    const jig = (1 - p) * 2.2;
    const ax = m.vx + Math.cos(t * 3 + m.ph) * jig, ay = m.vy + Math.sin(t * 2.6 + m.ph) * jig;
    const bx = 905, by = 652 + m.my, q = 1 - p;
    const x = q * q * ax + 2 * q * p * bx + p * p * m.gx, y = q * q * ay + 2 * q * p * by + p * p * m.gy;
    drawMol(m.k, x, y, 0.95, ga, 0, m.rot * (1 - p));
  }
  if (ga > 0) {
    ctx.save(); ctx.globalAlpha *= ga;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 26; ctx.shadowOffsetY = 8;
    ctx.beginPath(); ctx.roundRect(790, 592, 230, 120, 20);
    const g = ctx.createLinearGradient(0, 592, 0, 712); g.addColorStop(0, C.body0); g.addColorStop(1, C.body1);
    ctx.fillStyle = g; ctx.fill(); ctx.restore();
    ctx.beginPath(); ctx.roundRect(790, 592, 230, 120, 20); ctx.lineWidth = 2.5; ctx.strokeStyle = rgba(C.accent, 0.85); ctx.stroke();
    label('HPLC', 905, 646, { size: 46, weight: 800, color: C.accent });
    label('διαχωρισμός', 905, 686, { size: 19, weight: 600, color: C.sub });
    ctx.restore();
  }
  // what is in it, and how much
  const gx = [1290, 1480, 1670], counts = [8, 6, 10];
  const aw = fade(t, T.what - 0.1, 0.35), ah = fade(t, T.how - 0.1, 0.35);
  if (aw > 0) {
    label('τι περιέχει;', 1192, 728, { size: 25, weight: 700, color: C.accent, align: 'right', alpha: aw });
    gx.forEach((x, k) => label(`ουσία ${k + 1}`, x, 728, { size: 25, weight: 700, color: C.comp[k], alpha: aw }));
  }
  if (ah > 0) {
    label('πόσο;', 1192, 772, { size: 25, weight: 700, color: C.accent, align: 'right', alpha: ah });
    gx.forEach((x, k) => {
      const w = counts[k] * 12 * ease.out(prog(t, T.how - 0.1 + 0.08 * k, T.how + 0.45 + 0.08 * k));
      ctx.save(); ctx.globalAlpha *= ah; ctx.beginPath(); ctx.roundRect(x - 60, 763, Math.max(w, 0.1), 18, 9); ctx.fillStyle = C.comp[k]; ctx.fill(); ctx.restore();
    });
  }
  ctx.restore();
  ctx.restore();
}

/* ------------------------------------------------------------------ HUD: steps and subtitles */
const STEPS = ['Κινητή φάση', 'Αντλία', 'Εισαγωγέας', 'Στήλη', 'Ανιχνευτής', 'Χρωματογράφημα'];
function drawStepper(t) {
  const a = fade(t, T.reveal + 0.3, 0.5);
  if (a <= 0) return;
  const marks = [T.solvent - 0.3, T.pump - 0.3, T.inject - 0.3, T.column - 0.35, T.det - 0.3, T.chrom - 0.2, T.recap];
  let c = -1;
  for (const mk of marks) c += ease.io(prog(t, mk, mk + 0.4));
  ctx.save(); ctx.globalAlpha = a;
  ctx.font = font(19, 600);
  const R = 14, gapL = 9, sep = 26, gapS = 10;
  const widths = STEPS.map(s => ctx.measureText(s).width);
  const total = widths.reduce((s, w) => s + 2 * R + gapL + w, 0) + (STEPS.length - 1) * (sep + 2 * gapS);
  let x = (W - total) / 2;
  const y = 58;
  ctx.beginPath(); ctx.roundRect(x - 22, y - 27, total + 44, 54, 27); ctx.fillStyle = 'rgba(7,15,28,0.72)'; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(92,200,255,0.18)'; ctx.stroke();
  STEPS.forEach((s, i) => {
    const act = clamp(1 - Math.abs(c - i)), done = clamp(c - i);
    const cx = x + R;
    ctx.beginPath(); ctx.arc(cx, y, R, 0, Math.PI * 2);
    ctx.fillStyle = act > 0.01 ? rgba(C.accent, act) : 'rgba(0,0,0,0)'; ctx.fill();
    ctx.lineWidth = 1.8; ctx.strokeStyle = mix('#5B6F90', C.accent, Math.max(act, done)); ctx.stroke();
    if (done > 0.5 && act < 0.5) {
      ctx.save(); ctx.globalAlpha *= smooth(0.5, 1, done) * (1 - act * 2); checkIcon(C.accent)(cx, y, R * 1.25); ctx.restore();
    } else {
      ctx.font = font(14, 800); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = act > 0.5 ? C.accentInk : mix('#7088AB', C.accent, done); ctx.fillText(String(i + 1), cx, y + 0.5);
    }
    ctx.font = font(19, act > 0.5 ? 700 : 600); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = act > 0.01 ? mix('#8197B8', '#FFFFFF', act) : done > 0.5 ? '#B5C6DD' : '#7187A8';
    ctx.fillText(s, x + 2 * R + gapL, y + 1);
    x += 2 * R + gapL + widths[i];
    if (i < STEPS.length - 1) {
      ctx.strokeStyle = mix('#40557A', C.accent, clamp(c - i)); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + gapS, y); ctx.lineTo(x + gapS + sep, y); ctx.stroke();
      x += sep + 2 * gapS;
    }
  });
  ctx.restore();
}
function drawSubtitles(t) {
  SUBS.forEach((s, i) => {
    // back-to-back sentences switch on a clean cut; a subtitle after a pause fades in and out
    const cutIn = i > 0 && s.t0 - SUBS[i - 1].t1 < 0.05, cutOut = i < SUBS.length - 1 && SUBS[i + 1].t0 - s.t1 < 0.05;
    const aIn = cutIn ? (t >= s.t0 ? 1 : 0) : prog(t, s.t0 - 0.15, s.t0 + 0.05);
    const aOut = cutOut ? (t < s.t1 ? 1 : 0) : 1 - prog(t, s.t1 - 0.05, s.t1 + 0.15);
    const a = Math.min(aIn, aOut);
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = a; ctx.font = font(36, 600);
    const lines = balancedLines(s.text, 1560), lh = 48;
    const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 56, h = lines.length * lh + 26;
    const yb = H - 34;
    ctx.beginPath(); ctx.roundRect(W / 2 - w / 2, yb - h, w, h, 18); ctx.fillStyle = 'rgba(4,9,18,0.78)'; ctx.fill();
    ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((l, j) => ctx.fillText(l, W / 2, yb - h + 13 + lh * (j + 0.5) + 1));
    ctx.restore();
  });
}

/* ------------------------------------------------------------------ frame */
function drawWorld(t, cam) {
  if (t < T.reveal - 0.05) return;
  drawTubes(t);
  drawBottle(t); drawDegasser(t); drawPump(t); drawGauge(t); drawInjector(t); drawSyringe(t);
  drawColumn(t); drawDetector(t); drawCable(t); drawMonitor(t); drawWaste(t);
  drawBubbles(t);
  drawSample(t);
  drawDetectorCell(t);
  drawLabels(t);
  drawCallouts(t);
}
function renderAt(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  const cam = camAt(t);
  drawBackground(t, cam);
  ctx.save(); ctx.setTransform(cam.z, 0, 0, cam.z, W / 2 - cam.x * cam.z, H / 2 - cam.y * cam.z);
  drawWorld(t, cam);
  ctx.restore();
  drawInset(t, cam);
  drawReadCards(t);
  drawIntro(t);
  drawStepper(t);
  drawSubtitles(t);
  const black = Math.max(1 - prog(t, 0, 0.45), prog(t, T.end - 0.5, T.end));
  if (black > 0) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = `rgba(0,0,0,${black})`; ctx.fillRect(0, 0, W, H); }
}

async function init() {
  TL = window.TIMELINE || (await (await fetch('build/timeline.json')).json());
  buildAnchors(); buildPhysics(); buildInset(); buildScenery(); buildSubs(); buildCamera();
  await Promise.all(['Αα', 'Aa', 'ά'].flatMap(s => [400, 600, 800].map(w => document.fonts.load(font(40, w), s))));
  await document.fonts.ready;
  window.DURATION = T.end;
  window.ANCHORS = { ...T, peaks: PEAKS.map(p => p.P), subs: SUBS.map(x => ({ text: x.text, t0: x.t0, t1: x.t1 })) };
  if (new URLSearchParams(location.search).has('play')) {
    const t0 = performance.now();
    const loop = () => { renderAt(((performance.now() - t0) / 1000) % T.end); requestAnimationFrame(loop); };
    loop();
  } else renderAt(0.0001);
  return T.end;
}
window.renderAt = renderAt;
window.ready = init();
})();
