// 2D overlay drawn on top of each rendered frame: labels anchored to 3D points,
// chapter tags, live scale bars, gradient arrows, gauges, pathway chain, titles.
// Units are designed at 1080p and scaled by u = H / 1080.
import * as THREE from 'three';
import { clamp, smooth, easeOut, window01 } from './util.js';

const FONT = 'Inter';
const WHITE = '255,255,255';
export const ACCENT = '#63c9ff';      // liquid water blue (UI accent)
export const VAPOUR = '#d9f3ff';
export const TENSION = '#ff9a5c';

export class Overlay {
  constructor(canvas, W, H) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.W = W; this.H = H; this.u = H / 1080;
    this._v = new THREE.Vector3();
  }
  begin() { this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, this.W, this.H); this.alphaMul = 1; }

  /** World point → screen px; null when behind the camera. */
  project(p, cam) {
    if (Array.isArray(p)) return { x: p[0] * this.W, y: p[1] * this.H };
    const v = this._v.copy(p).project(cam);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x + 1) / 2 * this.W, y: (1 - v.y) / 2 * this.H };
  }

  _text(str, x, y, size, weight, color, align = 'left', a = 1, spacing = 0) {
    const ctx = this.ctx, u = this.u;
    ctx.save();
    ctx.globalAlpha = a * this.alphaMul;
    ctx.font = `${weight} ${size * u}px ${FONT}`;
    ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
    if (spacing) ctx.letterSpacing = `${spacing * u}px`;
    ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = 12 * u; ctx.shadowOffsetY = 1.5 * u;
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.restore();
    ctx.font = `${weight} ${size * u}px ${FONT}`;
    return ctx.measureText(str).width;
  }

  /**
   * Leader-line label. s = {text, sub, at (Vector3 | [fx,fy]), dx, dy (1080 units),
   * t0, t1, color, subColor, size}. Line draws on, then text slides in.
   */
  label(s, cam, t) {
    const a = window01(t, s.t0, s.t1, 0.55, 0.4);
    if (a <= 0.001) return;
    const p = this.project(s.at, cam); if (!p) return;
    const ctx = this.ctx, u = this.u;
    const grow = easeOut((t - s.t0) / 0.5);
    // elbow: relative offset (dx, dy) or a fixed screen position (ex, ey) for column layouts
    const tx0 = s.ex !== undefined ? s.ex * this.W : p.x + (s.dx ?? 80) * u;
    const ty0 = s.ey !== undefined ? s.ey * this.H : p.y + (s.dy ?? -60) * u;
    const dx = tx0 - p.x, dy = ty0 - p.y;
    const e = { x: p.x + dx * grow, y: p.y + dy * grow };
    const dir = s.align ? (s.align === 'left' ? -1 : 1) : (dx >= 0 ? 1 : -1);
    const stub = 22 * u * grow;
    ctx.save();
    ctx.globalAlpha = a * this.alphaMul;
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8 * u;
    // anchor: dot + ring
    ctx.fillStyle = s.color ?? '#ffffff';
    ctx.beginPath(); ctx.arc(p.x, p.y, 4.2 * u, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(${WHITE},${0.55 * a})`; ctx.lineWidth = 1.6 * u;
    const pr = 9 * u + 7 * u * (1 - smooth((t - s.t0) / 0.6));
    ctx.beginPath(); ctx.arc(p.x, p.y, pr, 0, Math.PI * 2); ctx.stroke();
    // leader
    if (!s.noLine) {
      ctx.strokeStyle = `rgba(${WHITE},0.88)`; ctx.lineWidth = 2.0 * u; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(p.x + (dx === 0 && dy === 0 ? 0 : 0), p.y);
      ctx.lineTo(e.x, e.y); ctx.lineTo(e.x + stub * dir, e.y); ctx.stroke();
    }
    ctx.restore();
    const ta = smooth((t - s.t0 - 0.28) / 0.4) * a;
    if (ta <= 0) return;
    const slide = (1 - easeOut((t - s.t0 - 0.28) / 0.5)) * 10 * u * dir;
    const tx = e.x + (stub + 12 * u) * dir - slide, ty = e.y + 9 * u;
    this._text(s.text, tx, ty, s.size ?? 29, 600, s.textColor ?? '#ffffff', dir > 0 ? 'left' : 'right', ta);
    if (s.sub) this._text(s.sub, tx, ty + 30 * u, 21, 500, s.subColor ?? '#bde8ff', dir > 0 ? 'left' : 'right', ta);
  }

  /** Free-floating caption (no leader), e.g. an annotation beside an arrow. */
  caption(s, t) {
    const a = window01(t, s.t0, s.t1, 0.45, 0.4); if (a <= 0) return;
    const u = this.u; const y = s.y * this.H + (1 - easeOut((t - s.t0) / 0.6)) * 8 * u;
    this._text(s.text, s.x * this.W, y, s.size ?? 28, s.weight ?? 600, s.color ?? '#fff', s.align ?? 'left', a, s.spacing ?? 0);
    if (s.sub) this._text(s.sub, s.x * this.W, y + (s.subGap ?? 30) * u, s.subSize ?? 21, 500, s.subColor ?? '#bde8ff', s.align ?? 'left', a);
  }

  /** Top-left chapter tag: number, title, short context line. */
  chapter(s, t) {
    const a = window01(t, s.t0, s.t1, 0.6, 0.5); if (a <= 0) return;
    const ctx = this.ctx, u = this.u, x = 92 * u, y = 92 * u;
    ctx.save(); ctx.globalAlpha = a * 0.95 * this.alphaMul;
    const h = 46 * u * easeOut((t - s.t0) / 0.7);
    ctx.fillStyle = ACCENT; ctx.fillRect(x, y - 30 * u, 3.2 * u, h);
    ctx.restore();
    this._text(s.num, x + 18 * u, y - 4 * u, 20, 700, ACCENT, 'left', a, 2);
    const w = this._text(s.title.toUpperCase(), x + 56 * u, y - 4 * u, 21, 700, '#ffffff', 'left', a, 2.6);
    if (s.sub) this._text(s.sub, x + 18 * u, y + 24 * u, 19, 500, 'rgba(225,240,250,0.82)', 'left', a);
    return w;
  }

  /** Scale bar (top-right) whose pixel length follows the camera: `len` world units at `dist`. */
  scaleBar(s, cam, t) {
    const a = window01(t, s.t0, s.t1, 0.5, 0.4); if (a <= 0) return;
    const ctx = this.ctx, u = this.u;
    const dist = typeof s.dist === 'function' ? s.dist() : s.dist;
    const px = s.len / (2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) * this.H;
    const x1 = this.W - 92 * u, x0 = x1 - px, y = 86 * u;
    ctx.save(); ctx.globalAlpha = a * this.alphaMul;
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8 * u;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3 * u; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y);
    ctx.moveTo(x0, y - 7 * u); ctx.lineTo(x0, y + 7 * u); ctx.moveTo(x1, y - 7 * u); ctx.lineTo(x1, y + 7 * u); ctx.stroke();
    ctx.restore();
    this._text(s.text, (x0 + x1) / 2, y - 16 * u, 20, 600, '#ffffff', 'center', a);
  }

  /** Small note, e.g. "Conceptual molecular model · not to scale". */
  note(s, t) {
    const a = window01(t, s.t0, s.t1, 0.5, 0.4); if (a <= 0) return;
    const u = this.u;
    const x = s.align === 'left' ? 92 * u : this.W - 92 * u;
    const y = (s.y ?? 132) * u;
    this._text(s.text, x, y, 18.5, 500, 'rgba(215,236,248,0.9)', s.align ?? 'right', a, 0.6);
  }

  /**
   * Thick gradient arrow between two points with a caption: used for the
   * water-potential gradient and flow directions. from/to: Vector3 or [fx,fy].
   */
  arrow(s, cam, t) {
    const a = window01(t, s.t0, s.t1, 0.5, 0.4); if (a <= 0) return;
    const p = this.project(s.from, cam), q = this.project(s.to, cam); if (!p || !q) return;
    const ctx = this.ctx, u = this.u;
    const k = easeOut((t - s.t0) / 0.9);
    const ex = p.x + (q.x - p.x) * k, ey = p.y + (q.y - p.y) * k;
    const ang = Math.atan2(ey - p.y, ex - p.x), w = (s.width ?? 9) * u, hl = (s.head ?? 30) * u;
    const g = ctx.createLinearGradient(p.x, p.y, q.x, q.y);
    g.addColorStop(0, s.c0 ?? '#9fe2ff'); g.addColorStop(1, s.c1 ?? '#2a7fff');
    ctx.save(); ctx.globalAlpha = a * this.alphaMul;
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 10 * u;
    ctx.strokeStyle = g; ctx.fillStyle = g; ctx.lineWidth = w; ctx.lineCap = 'round';
    const bx = ex - Math.cos(ang) * hl * 0.7, by = ey - Math.sin(ang) * hl * 0.7;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(bx, by); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.cos(ang - 0.42) * hl, ey - Math.sin(ang - 0.42) * hl);
    ctx.lineTo(ex - Math.cos(ang + 0.42) * hl, ey - Math.sin(ang + 0.42) * hl);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    if (s.text) {
      const mx = (p.x + q.x) / 2 + (s.tdx ?? 0) * u, my = (p.y + q.y) / 2 + (s.tdy ?? -26) * u;
      this._text(s.text, mx, my, s.size ?? 28, 700, s.textColor ?? '#ffffff', s.align ?? 'center', smooth((t - s.t0 - 0.4) / 0.4) * a);
      if (s.sub) this._text(s.sub, mx, my + 30 * u, 21, 500, '#bde8ff', s.align ?? 'center', smooth((t - s.t0 - 0.4) / 0.4) * a);
    }
  }

  /**
   * Vertical gauge: a bar with a gradient and a moving marker, labelled ends.
   * s = {x, y0, y1 (fractions), top, bottom, title, value(t) 0..1, c0, c1}
   */
  gauge(s, t) {
    const a = window01(t, s.t0, s.t1, 0.5, 0.45); if (a <= 0) return;
    const ctx = this.ctx, u = this.u;
    const x = s.x * this.W, y0 = s.y0 * this.H, y1 = s.y1 * this.H, w = 16 * u;
    const grow = easeOut((t - s.t0) / 0.8);
    const yt = y0 + (y1 - y0) * grow; // fill rises from the bottom
    const g = ctx.createLinearGradient(0, y1, 0, y0);
    g.addColorStop(0, s.c1 ?? '#ff7a45'); g.addColorStop(1, s.c0 ?? '#8fd3ff');
    ctx.save(); ctx.globalAlpha = a * this.alphaMul;
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 10 * u;
    ctx.fillStyle = 'rgba(8,16,24,0.55)'; ctx.fillRect(x - w / 2 - 3 * u, y1 - 3 * u, w + 6 * u, (y0 - y1) + 6 * u);
    ctx.fillStyle = g; ctx.fillRect(x - w / 2, yt, w, y0 - yt);
    if (s.value) {
      const v = clamp(s.value(t)); const ym = y0 + (y1 - y0) * v;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(x - w / 2 - 14 * u, ym); ctx.lineTo(x - w / 2 - 2 * u, ym - 8 * u); ctx.lineTo(x - w / 2 - 2 * u, ym + 8 * u); ctx.fill();
    }
    ctx.restore();
    const ta = smooth((t - s.t0 - 0.3) / 0.5) * a;
    if (s.top) this._text(s.top, x - 26 * u, y1 + 8 * u, 21, 600, s.topColor ?? '#ffb184', 'right', ta);
    if (s.bottom) this._text(s.bottom, x - 26 * u, y0 + 6 * u, 21, 600, s.bottomColor ?? '#a9e0ff', 'right', ta);
    if (s.title) this._text(s.title, x + w / 2 + 4 * u, y1 - 30 * u, 22, 700, '#ffffff', 'right', ta);
  }

  /** Bottom chain of pathway steps, lighting up one by one. */
  pathway(s, t) {
    const a = window01(t, s.t0, s.t1, 0.5, 0.5); if (a <= 0) return;
    const ctx = this.ctx, u = this.u, n = s.steps.length;
    const y = (s.y ?? 0.79) * this.H;
    ctx.save(); ctx.font = `600 ${22 * u}px ${FONT}`;
    const widths = s.steps.map(x => ctx.measureText(x).width);
    const gap = 58 * u, total = widths.reduce((p, c) => p + c, 0) + gap * (n - 1);
    let x = (this.W - total) / 2;
    ctx.restore();
    for (let i = 0; i < n; i++) {
      const ti = s.t0 + s.stagger * i;
      const on = smooth((t - ti) / 0.35) * a;
      const col = on > 0 ? '#ffffff' : 'rgba(255,255,255,0.35)';
      this._text(s.steps[i], x, y, 22, 600, col, 'left', Math.max(0.25 * a, on));
      if (i < n - 1) {
        const ax = x + widths[i] + 14 * u, bx = x + widths[i] + gap - 14 * u;
        const k = smooth((t - ti - 0.15) / 0.35);
        ctx.save(); ctx.globalAlpha = Math.max(0.25, k) * a * this.alphaMul;
        ctx.strokeStyle = ACCENT; ctx.fillStyle = ACCENT; ctx.lineWidth = 3 * u;
        ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8 * u;
        const ay = y - 8 * u;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx - 8 * u, ay); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bx, ay); ctx.lineTo(bx - 11 * u, ay - 7 * u); ctx.lineTo(bx - 11 * u, ay + 7 * u); ctx.fill();
        ctx.restore();
      }
      x += widths[i] + gap;
    }
  }

  /** Centre title card with words separated by arrows. */
  title(s, t) {
    const a = window01(t, s.t0, s.t1, 0.8, 0.6); if (a <= 0) return;
    const ctx = this.ctx, u = this.u, parts = s.parts, size = s.size ?? 54;
    ctx.save(); ctx.font = `700 ${size * u}px ${FONT}`; ctx.letterSpacing = `${3 * u}px`;
    const arrowW = 86 * u;
    const ws = parts.map(p => ctx.measureText(p).width);
    ctx.restore();
    const total = ws.reduce((p, c) => p + c, 0) + arrowW * (parts.length - 1);
    let x = (this.W - total) / 2; const y = (s.y ?? 0.5) * this.H;
    if (s.band) {
      const g = ctx.createLinearGradient(0, y - 150 * u, 0, y + 150 * u);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(2,8,14,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save(); ctx.globalAlpha = a * this.alphaMul; ctx.fillStyle = g; ctx.fillRect(0, y - 150 * u, this.W, 300 * u); ctx.restore();
    }
    for (let i = 0; i < parts.length; i++) {
      const pa = smooth((t - s.t0 - i * 0.45) / 0.6) * a;
      this._text(parts[i], x, y + (1 - pa) * 10 * u, size, 700, '#ffffff', 'left', pa, 3);
      x += ws[i];
      if (i < parts.length - 1) {
        const qa = smooth((t - s.t0 - i * 0.45 - 0.3) / 0.5) * a;
        ctx.save(); ctx.globalAlpha = qa * this.alphaMul; ctx.strokeStyle = ACCENT; ctx.fillStyle = ACCENT; ctx.lineWidth = 4.5 * u;
        const ay = y - size * 0.36 * u, ax = x + 20 * u, bx = x + arrowW - 20 * u;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx - 10 * u, ay); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bx, ay); ctx.lineTo(bx - 15 * u, ay - 10 * u); ctx.lineTo(bx - 15 * u, ay + 10 * u); ctx.fill();
        ctx.restore();
        x += arrowW;
      }
    }
    if (s.sub) this._text(s.sub, this.W / 2, y + 62 * u, 24, 500, 'rgba(220,240,255,0.9)', 'center', smooth((t - s.t0 - 1.4) / 0.6) * a, 1);
  }

  /** Dashed circle with a radius marker (meniscus curvature). */
  radius(s, cam, t) {
    const a = window01(t, s.t0, s.t1, 0.4, 0.4); if (a <= 0) return;
    const c = this.project(s.center, cam), e = this.project(s.edge, cam); if (!c || !e) return;
    const ctx = this.ctx, u = this.u, R = Math.hypot(e.x - c.x, e.y - c.y);
    ctx.save(); ctx.globalAlpha = a * this.alphaMul;
    ctx.setLineDash([9 * u, 8 * u]); ctx.strokeStyle = s.color ?? TENSION; ctx.lineWidth = 2.4 * u;
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 6 * u;
    ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(e.x, e.y); ctx.stroke();
    ctx.fillStyle = s.color ?? TENSION; ctx.beginPath(); ctx.arc(c.x, c.y, 4 * u, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    this._text(s.text ?? 'r', (c.x + e.x) / 2 + 10 * u, (c.y + e.y) / 2 - 8 * u, 26, 700, s.color ?? TENSION, 'left', a);
  }
}
