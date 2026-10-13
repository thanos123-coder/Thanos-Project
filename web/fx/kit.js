/* Shared motion and interaction kit. Loads before app.js and every page script; extends window.UC.

   Everything here respects UC.reducedMotion (prefers-reduced-motion): motion is skipped, or reduced to
   an opacity fade of 120ms at most, and every function still lands on its final state.

   UC.motion
     ease   { out, in, inOut, spring }   CSS easing strings (spring is a CSS linear() curve)
     dur    { fast: 150, base: 220, slow: 400, spring: 600 }   milliseconds
     animate(el, keyframes, options) -> Animation | null
         el.animate() that respects reduced motion (keeps only opacity, at most 120ms, or skips).
     tween(from, to, { duration, ease, onUpdate(value), onDone }) -> cancel()
         requestAnimationFrame tween of a number or an array of numbers. ease is a function,
         'out' | 'in' | 'inOut' | 'linear', or a cubic-bezier() string.
     spring({ from, to, stiffness = 170, damping, mass = 1, velocity = 0, precision, onUpdate(value), onRest(value) })
         -> { set(to, { immediate }), stop(), value }
         Critically damped unless you pass a lower damping. Works on a number or an array of numbers.
     countUp(el, to, { from = 0, duration = 700, decimals = 0, prefix = '', suffix = '' }) -> cancel()
         Counts the element's text up to `to`. Put the final value in the HTML so it reads right at rest.
     flip(targets, mutate, { duration, easing, scale = false }) -> Promise
         FLIP layout animation. targets: a container (tracks its [data-flip-id] descendants, or its
         children), an array or NodeList, or a selector. Records rects, runs mutate() (sync or async;
         it may re-render), then slides kept elements to their new place, fades and scales in new ones,
         and fades out a ghost of removed ones. Give re-rendered items a stable data-flip-id.
     stagger(elements, keyframes, { step = 40, duration = 220, easing, delay = 0 }) -> Promise
         Plays the same keyframes on each element, offset by `step` ms. Start keyframes from a visible
         state (for example opacity .4), never from 0.
     reveal(root = document, { step = 50, y = 8 }) -> disconnect()
         Entrance for [data-reveal] descendants: those in view play now, the rest when they scroll in.
         Elements are fully visible at rest. data-reveal="" rises, "fade" fades, "scale" pops;
         data-reveal-delay="ms" adds a delay.
     tilt(el, { max = 6, perspective = 900 }) -> dispose()
         3D pointer tilt. Adds .fx-tilt and sets --glare-x, --glare-y, --glare-o for a .fx-glare child.
     magnetic(el, { strength = 0.25 }) -> dispose()
         The element leans toward the pointer and springs back.
     glow(el) -> dispose()
         Neutral pointer spotlight: adds .fx-glow and sets --mx, --my, --glow-o.
     typewriter(el, text, { cps = 40, onDone }) -> cancel()     (cancel completes the text)
     stream(el, words | text, { wps = 12, onDone }) -> cancel()  (words fade in; cancel completes)
     Pointer effects only run with a fine pointer and without reduced motion.

   Tooltips: any element with data-tip="text" shows a tooltip on hover and keyboard focus after 300ms.
     data-tip-side="bottom" prefers below. Use it to move secondary text out of the layout. Non-focusable
     triggers get tabindex="0". UC.tooltip.hide() hides it; UC.tooltip.refresh() rescans new markup.
   Press feedback: elements with data-press scale to 0.97 while pressed (not for .btn).
   UC.menu(anchor, items, { selected, onSelect(id), align = 'start' }) -> close()
     A popover menu under `anchor`. items: [{ id, label, icon }]. With `selected`, items are radio items
     and show a check. Arrow keys, Home, End, Enter and Escape work; focus returns to the anchor. */
(() => {
  'use strict';

  const UC = (window.UC = window.UC || {});
  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const fineQuery = matchMedia('(hover: hover) and (pointer: fine)');
  if (!Object.getOwnPropertyDescriptor(UC, 'reducedMotion')) {
    Object.defineProperty(UC, 'reducedMotion', { get: () => reducedQuery.matches, enumerable: true, configurable: true });
  }
  const reduced = () => reducedQuery.matches;
  const canPoint = () => fineQuery.matches && !reduced();

  /* ---------- Easing ---------- */

  const ease = {
    out: 'cubic-bezier(.2, .8, .2, 1)',
    in: 'cubic-bezier(.4, 0, 1, 1)',
    inOut: 'cubic-bezier(.65, 0, .35, 1)',
    spring: 'linear(0, 0.059, 0.181, 0.337, 0.491, 0.637, 0.756, 0.856, 0.927, 0.98, 1.012, 1.032, 1.04, 1.042, 1.039, 1.033, 1.027, 1.02, 1.014, 1.009, 1.006, 1.003, 1.001, 0.999, 1)'
  };
  if (!(window.CSS && CSS.supports('transition-timing-function', 'linear(0, 1)'))) ease.spring = ease.out;
  const dur = { fast: 150, base: 220, slow: 400, spring: 600 };

  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t;
    const sy = (t) => ((ay * t + by) * t + cy) * t;
    const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) {
        const err = sx(t) - x;
        if (Math.abs(err) < 1e-5) break;
        const d = dx(t);
        if (Math.abs(d) < 1e-6) break;
        t -= err / d;
      }
      return sy(Math.min(1, Math.max(0, t)));
    };
  }
  const EASE_FN = { linear: (t) => t, out: bezier(0.2, 0.8, 0.2, 1), in: bezier(0.4, 0, 1, 1), inOut: bezier(0.65, 0, 0.35, 1) };
  function easeFn(e) {
    if (typeof e === 'function') return e;
    if (!e) return EASE_FN.out;
    if (EASE_FN[e]) return EASE_FN[e];
    const m = /cubic-bezier\(([^)]+)\)/.exec(e);
    if (m) { const [a, b, c, d] = m[1].split(',').map(Number); return bezier(a, b, c, d); }
    return EASE_FN.out;
  }

  /* ---------- Animate, tween, spring ---------- */

  function fadeOnly(keyframes) {
    const list = Array.isArray(keyframes) ? keyframes : null;
    if (!list || !list.some((k) => 'opacity' in k)) return null;
    return list.map((k) => ({ opacity: 'opacity' in k ? k.opacity : 1, offset: k.offset }));
  }

  function animate(el, keyframes, options = {}) {
    if (!el || !el.animate) return null;
    const opts = typeof options === 'number' ? { duration: options } : options;
    if (!reduced()) return el.animate(keyframes, { duration: dur.base, easing: ease.out, ...opts });
    const fade = fadeOnly(keyframes);
    if (!fade) return null;
    return el.animate(fade, { ...opts, duration: Math.min(120, opts.duration || 120), delay: 0, easing: 'linear' });
  }

  function tween(from, to, { duration = dur.base, ease: e = 'out', onUpdate, onDone } = {}) {
    const f = easeFn(e);
    const many = Array.isArray(from);
    const at = (p) => (many ? from.map((v, i) => v + (to[i] - v) * p) : from + (to - from) * p);
    if (reduced() || duration <= 0) { onUpdate?.(at(1)); onDone?.(); return () => {}; }
    let raf = 0, start = 0;
    const step = (now) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / duration);
      onUpdate?.(at(f(t)));
      if (t < 1) raf = requestAnimationFrame(step); else onDone?.();
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }

  function spring({ from = 0, to = 1, stiffness = 170, damping, mass = 1, velocity = 0, precision, onUpdate, onRest } = {}) {
    const many = Array.isArray(from);
    let x = many ? from.slice() : [from];
    let target = Array.isArray(to) ? to.slice() : [to];
    let v = x.map(() => velocity);
    const c = damping ?? 2 * Math.sqrt(stiffness * mass);
    const eps = precision ?? 0.01;
    const out = () => (many ? x.slice() : x[0]);
    let raf = 0, last = 0, running = false;
    const settle = () => { x = target.slice(); v = v.map(() => 0); running = false; onUpdate?.(out()); onRest?.(out()); };
    const tick = (now) => {
      const dt = Math.min(0.064, last ? (now - last) / 1000 : 1 / 60);
      last = now;
      const steps = Math.max(1, Math.ceil(dt * 240));
      const h = dt / steps;
      for (let s = 0; s < steps; s++) {
        for (let i = 0; i < x.length; i++) {
          const a = (-stiffness * (x[i] - target[i]) - c * v[i]) / mass;
          v[i] += a * h;
          x[i] += v[i] * h;
        }
      }
      if (x.every((xi, i) => Math.abs(xi - target[i]) < eps && Math.abs(v[i]) < eps * 10)) { settle(); return; }
      onUpdate?.(out());
      raf = requestAnimationFrame(tick);
    };
    const run = () => {
      if (reduced()) { cancelAnimationFrame(raf); settle(); return; }
      if (!running) { running = true; last = 0; raf = requestAnimationFrame(tick); }
    };
    run();
    return {
      set(next, { immediate = false } = {}) {
        target = Array.isArray(next) ? next.slice() : [next];
        if (immediate) { cancelAnimationFrame(raf); settle(); return; }
        run();
      },
      stop() { cancelAnimationFrame(raf); running = false; },
      get value() { return out(); }
    };
  }

  function countUp(el, to, { from = 0, duration = 700, decimals = 0, prefix = '', suffix = '', ease: e = 'out' } = {}) {
    const fmt = (n) => prefix + n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
    return tween(from, to, { duration, ease: e, onUpdate: (n) => { el.textContent = fmt(n); }, onDone: () => { el.textContent = fmt(to); } });
  }

  /* ---------- Layout and entrances ---------- */

  function flip(targets, mutate, { duration = dur.base + 30, easing = ease.out, scale = false } = {}) {
    const collect = () => {
      if (typeof targets === 'string') return [...document.querySelectorAll(targets)];
      if (targets instanceof Element) {
        const keyed = targets.querySelectorAll('[data-flip-id]');
        return [...(keyed.length ? keyed : targets.children)];
      }
      return [...(targets || [])];
    };
    const keyOf = (el) => (el.dataset && el.dataset.flipId) || el;
    const before = new Map();
    if (!reduced()) for (const el of collect()) before.set(keyOf(el), { el, rect: el.getBoundingClientRect() });

    const play = () => {
      if (reduced()) return Promise.resolve();
      const runs = [];
      const after = collect();
      const kept = new Set();
      for (const el of after) {
        const key = keyOf(el);
        const b = before.get(key);
        const r = el.getBoundingClientRect();
        if (b) {
          kept.add(key);
          const dx = b.rect.left - r.left, dy = b.rect.top - r.top;
          const sx = scale && r.width ? b.rect.width / r.width : 1;
          const sy = scale && r.height ? b.rect.height / r.height : 1;
          if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
          runs.push(el.animate([
            { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
            { transformOrigin: 'top left', transform: 'none' }
          ], { duration, easing }).finished);
        } else {
          runs.push(el.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration, easing }).finished);
        }
      }
      for (const [key, b] of before) {
        if (kept.has(key) || b.el.isConnected) continue;
        const ghost = b.el.cloneNode(true);
        ghost.removeAttribute('id');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.inert = true;
        Object.assign(ghost.style, {
          position: 'fixed', left: `${b.rect.left}px`, top: `${b.rect.top}px`, width: `${b.rect.width}px`, height: `${b.rect.height}px`,
          margin: '0', pointerEvents: 'none', zIndex: '5', boxSizing: 'border-box'
        });
        document.body.appendChild(ghost);
        runs.push(ghost.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { duration: duration * 0.8, easing: ease.in, fill: 'forwards' })
          .finished.finally(() => ghost.remove()));
      }
      return Promise.all(runs.map((p) => p.catch(() => {}))).then(() => {});
    };

    const result = mutate ? mutate() : undefined;
    return result && typeof result.then === 'function' ? result.then(play) : play();
  }

  function stagger(elements, keyframes, { step = 40, duration = dur.base, easing = ease.out, delay = 0 } = {}) {
    const els = [...(typeof elements === 'string' ? document.querySelectorAll(elements) : elements || [])];
    const runs = els.map((el, i) => {
      const a = reduced() ? animate(el, keyframes, { duration: 120, fill: 'backwards' })
        : el.animate(keyframes, { duration, easing, delay: delay + i * step, fill: 'backwards' });
      return a ? a.finished.catch(() => {}) : Promise.resolve();
    });
    return Promise.all(runs).then(() => {});
  }

  function reveal(root = document, { step = 50, y = 8 } = {}) {
    const els = [...root.querySelectorAll('[data-reveal]')].filter((el) => !('revealed' in el.dataset));
    if (!els.length || reduced()) return () => {};
    const frames = (el) => {
      const kind = el.dataset.reveal;
      if (kind === 'fade') return [{ opacity: 0.4 }, { opacity: 1 }];
      if (kind === 'scale') return [{ opacity: 0.4, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }];
      return [{ opacity: 0.4, transform: `translateY(${y}px)` }, { opacity: 1, transform: 'none' }];
    };
    const play = (el, wait) => {
      el.dataset.revealed = '';
      el.animate(frames(el), { duration: dur.slow, easing: ease.out, delay: wait + (Number(el.dataset.revealDelay) || 0), fill: 'backwards' });
    };
    const io = new IntersectionObserver((entries) => {
      let k = 0;
      for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); play(e.target, k++ * step); }
    }, { rootMargin: '0px 0px -8% 0px' });
    let n = 0;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.height && r.top < innerHeight && r.bottom > 0) play(el, n++ * step); else io.observe(el);
    }
    return () => io.disconnect();
  }

  /* ---------- Pointer effects (requestAnimationFrame) ---------- */

  function tilt(el, { max = 6, perspective = 900 } = {}) {
    if (!el || !canPoint()) return () => {};
    el.classList.add('fx-tilt');
    let rect = null;
    const sp = spring({
      from: [0, 0], to: [0, 0], stiffness: 220, damping: 24,
      onUpdate: ([rx, ry]) => { el.style.transform = rx || ry ? `perspective(${perspective}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)` : ''; }
    });
    const move = (e) => {
      rect = rect || el.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width, py = (e.clientY - rect.top) / rect.height;
      sp.set([(0.5 - py) * 2 * max, (px - 0.5) * 2 * max]);
      el.style.setProperty('--glare-x', `${(px * 100).toFixed(1)}%`);
      el.style.setProperty('--glare-y', `${(py * 100).toFixed(1)}%`);
    };
    const enter = () => { rect = el.getBoundingClientRect(); el.style.setProperty('--glare-o', '1'); };
    const leave = () => { rect = null; sp.set([0, 0]); el.style.setProperty('--glare-o', '0'); };
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      sp.stop();
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      el.classList.remove('fx-tilt');
      el.style.transform = '';
    };
  }

  function magnetic(el, { strength = 0.25 } = {}) {
    if (!el || !canPoint()) return () => {};
    let rect = null;
    const sp = spring({
      from: [0, 0], to: [0, 0], stiffness: 260, damping: 20,
      onUpdate: ([tx, ty]) => { el.style.transform = tx || ty ? `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px)` : ''; }
    });
    const move = (e) => {
      rect = rect || el.getBoundingClientRect();
      sp.set([(e.clientX - (rect.left + rect.width / 2)) * strength, (e.clientY - (rect.top + rect.height / 2)) * strength]);
    };
    const leave = () => { rect = null; sp.set([0, 0]); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      sp.stop();
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      el.style.transform = '';
    };
  }

  function glow(el) {
    if (!el || !canPoint()) return () => {};
    el.classList.add('fx-glow');
    let raf = 0, px = 0, py = 0;
    const paint = () => { raf = 0; el.style.setProperty('--mx', `${px}px`); el.style.setProperty('--my', `${py}px`); };
    const move = (e) => {
      const r = el.getBoundingClientRect();
      px = Math.round(e.clientX - r.left); py = Math.round(e.clientY - r.top);
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const enter = () => el.style.setProperty('--glow-o', '1');
    const leave = () => el.style.setProperty('--glow-o', '0');
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
      el.classList.remove('fx-glow');
    };
  }

  /* ---------- Streamed text ---------- */

  function typewriter(el, text, { cps = 40, onDone } = {}) {
    const finish = () => { el.textContent = text; el.classList.remove('fx-typing'); el.removeAttribute('aria-busy'); };
    if (reduced()) { finish(); onDone?.(); return () => {}; }
    let raf = 0, start = 0, shown = -1;
    el.textContent = '';
    el.classList.add('fx-typing');
    el.setAttribute('aria-busy', 'true');
    const step = (now) => {
      if (!start) start = now;
      const n = Math.min(text.length, Math.floor(((now - start) / 1000) * cps));
      if (n !== shown) { el.textContent = text.slice(0, n); shown = n; }
      if (n < text.length) raf = requestAnimationFrame(step); else { finish(); onDone?.(); }
    };
    raf = requestAnimationFrame(step);
    return () => { if (raf) { cancelAnimationFrame(raf); raf = 0; finish(); } };
  }

  function stream(el, words, { wps = 12, onDone } = {}) {
    const list = Array.isArray(words) ? words : String(words).split(/\s+/).filter(Boolean);
    const finish = () => { el.textContent = list.join(' '); el.removeAttribute('aria-busy'); };
    if (reduced()) { finish(); onDone?.(); return () => {}; }
    let raf = 0, start = 0, shown = 0;
    el.textContent = '';
    el.setAttribute('aria-busy', 'true');
    const step = (now) => {
      if (!start) start = now;
      const n = Math.min(list.length, Math.floor(((now - start) / 1000) * wps) + 1);
      for (; shown < n; shown++) {
        if (shown) el.append(' ');
        const w = document.createElement('span');
        w.className = 'fx-word';
        w.textContent = list[shown];
        el.append(w);
      }
      if (shown < list.length) raf = requestAnimationFrame(step);
      else { raf = 0; el.removeAttribute('aria-busy'); onDone?.(); }
    };
    raf = requestAnimationFrame(step);
    return () => { if (raf) { cancelAnimationFrame(raf); raf = 0; finish(); } };
  }

  UC.motion = { ease, dur, animate, tween, spring, countUp, flip, stagger, reveal, tilt, magnetic, glow, typewriter, stream };

  /* ---------- Tooltips: [data-tip] ---------- */

  const tip = document.createElement('div');
  tip.className = 'fx-tip';
  tip.id = 'fx-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  let tipFor = null, tipTimer = 0;

  const focusable = (el) => el.matches('a[href], button, input, select, textarea, summary, [tabindex]');
  function refreshTips(root = document) {
    for (const el of root.querySelectorAll('[data-tip]')) if (!focusable(el)) el.tabIndex = 0;
  }
  function place(el) {
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const gap = 8;
    let side = el.dataset.tipSide === 'bottom' ? 'bottom' : 'top';
    if (side === 'top' && r.top - t.height - gap < 8) side = 'bottom';
    if (side === 'bottom' && r.bottom + t.height + gap > innerHeight - 8) side = 'top';
    const top = side === 'top' ? r.top - t.height - gap : r.bottom + gap;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 8);
    tip.dataset.side = side;
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }
  function showTip(el) {
    const text = el.dataset.tip;
    if (!text) return;
    if (!tip.isConnected) document.body.appendChild(tip);
    tipFor = el;
    tip.textContent = text;
    tip.hidden = false;
    tip.classList.remove('is-shown');
    place(el);
    el.setAttribute('aria-describedby', tip.id);
    requestAnimationFrame(() => { if (tipFor === el) tip.classList.add('is-shown'); });
  }
  function hideTip() {
    clearTimeout(tipTimer);
    if (!tipFor) return;
    tipFor.removeAttribute('aria-describedby');
    tipFor = null;
    tip.classList.remove('is-shown');
    tip.hidden = true;
  }
  const queueTip = (el) => { clearTimeout(tipTimer); tipTimer = setTimeout(() => showTip(el), 300); };

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest('[data-tip]');
    if (el && el !== tipFor) queueTip(el);
  });
  document.addEventListener('pointerout', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el && !el.contains(e.relatedTarget)) hideTip();
  });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el && el.matches(':focus-visible')) queueTip(el);
  });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('pointerdown', hideTip);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });
  addEventListener('scroll', hideTip, { passive: true, capture: true });
  UC.tooltip = { hide: hideTip, refresh: refreshTips };

  /* ---------- Press feedback: [data-press] ---------- */

  const pressed = new Map();
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-press]');
    if (!el || reduced() || e.button !== 0) return;
    pressed.set(el, el.animate([{ transform: 'none' }, { transform: 'scale(.97)' }], { duration: 100, easing: ease.out, fill: 'forwards' }));
  });
  const release = () => {
    for (const [el, a] of pressed) {
      a.cancel();
      el.animate([{ transform: 'scale(.97)' }, { transform: 'none' }], { duration: 260, easing: ease.spring });
    }
    pressed.clear();
  };
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
  document.addEventListener('dragstart', release);

  /* ---------- Menu ---------- */

  let openMenu = null;
  function menu(anchor, items, { selected, onSelect, align = 'start' } = {}) {
    if (openMenu) { const same = openMenu.anchor === anchor; openMenu.close(); if (same) return () => {}; }
    const radio = selected !== undefined;
    const el = document.createElement('div');
    el.className = 'menu';
    el.setAttribute('role', 'menu');
    el.innerHTML = items.map((it) => `<button type="button" class="menu-item" role="${radio ? 'menuitemradio' : 'menuitem'}" data-id="${it.id}"${radio ? ` aria-checked="${it.id === selected}"` : ''} tabindex="-1">${it.icon && UC.ic ? UC.ic(it.icon) : ''}<span>${UC.esc ? UC.esc(it.label) : it.label}</span>${radio && UC.ic ? UC.ic('check', 'check') : ''}</button>`).join('');
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    const m = el.getBoundingClientRect();
    let left = align === 'end' ? r.right - m.width : r.left;
    left = Math.min(Math.max(8, left), innerWidth - m.width - 8);
    let top = r.bottom + 4;
    if (top + m.height > innerHeight - 8) top = Math.max(8, r.top - m.height - 4);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    anchor.setAttribute('aria-expanded', 'true');
    animate(el, [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: dur.fast });
    const buttons = [...el.querySelectorAll('.menu-item')];
    (buttons.find((b) => b.getAttribute('aria-checked') === 'true') || buttons[0])?.focus();

    let closed = false;
    function close(refocus = true) {
      if (closed) return;
      closed = true;
      openMenu = null;
      anchor.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true);
      const a = animate(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 100, easing: ease.in, fill: 'forwards' });
      if (a) a.finished.then(() => el.remove(), () => el.remove()); else el.remove();
      if (refocus) anchor.focus({ preventScroll: true });
    }
    const outside = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(false); };
    document.addEventListener('pointerdown', outside, true);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('.menu-item');
      if (!b) return;
      close();
      onSelect?.(b.dataset.id);
    });
    el.addEventListener('keydown', (e) => {
      const i = buttons.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); buttons[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); buttons[buttons.length - 1].focus(); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    openMenu = { anchor, close };
    return close;
  }
  UC.menu = menu;

  /* Keep tooltip triggers focusable as pages render new markup */
  let tipScan = 0;
  const init = () => {
    refreshTips();
    new MutationObserver(() => {
      if (!tipScan) tipScan = requestAnimationFrame(() => { tipScan = 0; refreshTips(); });
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
