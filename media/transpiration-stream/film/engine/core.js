// Film runtime: shot scheduling, lazy world building, transitions, post, overlay, capture.
import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { Post } from './post.js';
import { Overlay } from './overlay.js';
import { tickMaterials } from './materials.js';
import { smooth, easeIn, easeOut, clamp, window01 } from './util.js';

export class Film {
  constructor({ W, H, fps, duration, shots, worlds, globals }) {
    Object.assign(this, { W, H, fps, duration, shots, worlds, globals });
    this.built = new Map();
    this.texCache = new Map();
  }

  async init() {
    const canvas = document.createElement('canvas');
    canvas.width = this.W; canvas.height = this.H;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1); this.renderer.setSize(this.W, this.H, false);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // grade pass encodes sRGB itself
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    this.post = new Post(this.renderer, this.W, this.H);
    const oc = document.createElement('canvas'); oc.width = this.W; oc.height = this.H;
    this.overlay = new Overlay(oc, this.W, this.H);
    this.out = document.createElement('canvas'); this.out.width = this.W; this.out.height = this.H;
    this.outCtx = this.out.getContext('2d');
    this.glCanvas = canvas;
    document.body.appendChild(this.out);
    await Promise.all(['400', '500', '600', '700'].map(w => document.fonts.load(`${w} 32px Inter`)));
    this.env = {
      renderer: this.renderer, film: this,
      tex: (p, o) => this.texture(p, o),
      hdri: (p, r) => this.hdri(p, r),
      pmrem: new THREE.PMREMGenerator(this.renderer),
    };
  }

  texture(path, o = {}) {
    const key = path + JSON.stringify(o);
    if (!this.texCache.has(key)) {
      this.texCache.set(key, new Promise((res, rej) => new THREE.TextureLoader().load(path, (tx) => {
        tx.colorSpace = o.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        tx.wrapS = tx.wrapT = o.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
        tx.anisotropy = 8; if (o.repeat) tx.repeat.set(...o.repeat);
        res(tx);
      }, undefined, rej)));
    }
    return this.texCache.get(key);
  }

  hdri(path, retouch) {
    if (!this.texCache.has(path)) {
      this.texCache.set(path, new Promise((res, rej) => new EXRLoader().setDataType(THREE.HalfFloatType).load(path, (tx) => {
        tx.mapping = THREE.EquirectangularReflectionMapping;
        if (retouch) { retouch(tx.image); tx.needsUpdate = true; }
        const envMap = this.env.pmrem.fromEquirectangular(tx).texture;
        res({ tx, envMap });
      }, undefined, rej)));
    }
    return this.texCache.get(path);
  }

  activeShots(t) { return this.shots.filter(s => t >= s.t0 && t < s.t1 + 1e-6); }

  async world(name) {
    if (!this.built.has(name)) {
      const mod = this.worlds[name];
      if (!mod) throw new Error('unknown world ' + name);
      const w = await mod.build(this.env);
      w.camera.aspect = this.W / this.H; w.camera.updateProjectionMatrix();
      this.built.set(name, w);
    }
    return this.built.get(name);
  }

  /** Free worlds that no shot at or after time t needs (keeps memory bounded). */
  release(t) {
    for (const [name, w] of this.built) {
      if (!this.shots.some(s => s.world === name && s.t1 >= t)) {
        w.scene.traverse(o => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => x.dispose()); });
        this.built.delete(name);
      }
    }
  }

  async renderFrame(frame) {
    const t = frame / this.fps;
    const act = this.activeShots(t).slice(0, 2);
    for (const s of act) await this.world(s.world);
    this.release(t);
    const texs = [], shotVis = [];
    act.forEach((s, i) => {
      const w = this.built.get(s.world);
      const lt = t - s.t0;
      w.update(t, s, lt);
      tickMaterials(w.scene, t);
      const p = w.post ? w.post(t, s, lt) : {};
      if (this.debug?.nodof) p.aperture = 0;
      if (this.debug?.nobloom) p.bloom = 0;
      texs.push(this.post.renderShot(i, w.scene, w.camera, p));
      s._grade = p;
    });
    // transition: second shot is the incoming one
    let mix = 0, tr = {};
    if (act.length === 2) {
      const B = act[1], d = B.t0 - 0, dur = Math.max(1e-3, act[0].t1 - B.t0);
      const p = clamp((t - B.t0) / dur);
      mix = smooth(p);
      const z = B.zoom ?? 0.18;
      tr = { mix, zoomA: easeIn(p) * z, blurA: easeIn(p) * (B.blur ?? 0.12), zoomB: -(1 - easeOut(p)) * z * 0.6, blurB: (1 - p) * (B.blur ?? 0.12) * 0.6, dip: (B.dip ?? 0) * Math.sin(Math.PI * p) };
      void d;
    }
    this.post.composite(texs[0], texs[1], tr);
    const ga = act[0]._grade || {}, gb = act[1]?._grade || {};
    const g = {};
    for (const k of new Set([...Object.keys(ga), ...Object.keys(gb)])) {
      if (typeof ga[k] === 'number' && typeof gb[k] === 'number') g[k] = ga[k] + (gb[k] - ga[k]) * mix;
      else if (Array.isArray(ga[k]) && Array.isArray(gb[k])) g[k] = ga[k].map((v, i) => v + (gb[k][i] - v) * mix);
      else g[k] = mix > 0.5 ? (gb[k] ?? ga[k]) : (ga[k] ?? gb[k]);
    }
    g.time = t;
    g.fade = window01(t, 0, this.duration, 0.9, 0.7);
    this.post.finish(g);
    // overlay
    const ov = this.overlay; ov.begin();
    act.forEach((s, i) => {
      const w = this.built.get(s.world);
      ov.alphaMul = act.length === 2 ? (i === 0 ? 1 - mix : mix) : 1;
      if (w.overlay) w.overlay(ov, t, s, t - s.t0);
    });
    ov.alphaMul = 1;
    if (this.globals) this.globals(ov, t);
    this.outCtx.globalAlpha = 1;
    this.outCtx.drawImage(this.glCanvas, 0, 0);
    this.outCtx.drawImage(ov.c, 0, 0);
    return t;
  }

  capture(quality = 0.95) {
    return new Promise(res => this.out.toBlob(b => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }, 'image/jpeg', quality));
  }
}
