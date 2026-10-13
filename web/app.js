/* App shell for the design preview. Nothing here talks to a server.
   This file owns the theme, tab switching, shared controls, overlays, the toast, the command palette
   and the window.UC API. fx/kit.js loads first and adds UC.motion, tooltips, press feedback and UC.menu.
   Each page renders its sample data and wires its own controls in fx/PAGE.js. */
(() => {
  'use strict';

  const UC = (window.UC = window.UC || {});
  const D = window.UPCHANCE;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const ic = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CAT = { reach: 'Reach', target: 'Target', likely: 'Likely' };
  const motion = UC.motion;
  const reduced = () => UC.reducedMotion;
  const EASE = motion.ease.out;
  const root = document.documentElement;
  const phone = matchMedia('(max-width: 760px)');

  /* ---------- Theme: a circular reveal from the toggle ---------- */

  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const themeBtn = $('#theme-toggle');
  const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : darkQuery.matches);
  function syncTheme() {
    root.classList.toggle('is-dark', isDark());
    const label = isDark() ? 'Switch to light theme' : 'Switch to dark theme';
    themeBtn.setAttribute('aria-label', label);
    themeBtn.dataset.tip = label;
  }
  function setTheme(dark, origin) {
    const apply = () => { root.dataset.theme = dark ? 'dark' : 'light'; syncTheme(); };
    if (!document.startViewTransition || reduced() || !origin || !origin.isConnected) { apply(); return; }
    const r = origin.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.dataset.vt = 'theme';
    const t = document.startViewTransition(apply);
    t.ready.then(() => {
      root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 520, easing: EASE, pseudoElement: '::view-transition-new(root)' });
    }).catch(() => {});
    t.finished.finally(() => { if (root.dataset.vt === 'theme') delete root.dataset.vt; });
  }
  const toggleTheme = (origin = themeBtn) => setTheme(!isDark(), origin);
  themeBtn.addEventListener('click', () => toggleTheme(themeBtn));
  darkQuery.addEventListener('change', syncTheme);
  syncTheme();

  /* ---------- Tabs: view transitions and a spring indicator ---------- */

  const VIEWS = ['home', 'chat', 'activities', 'chances', 'essays', 'interview'];
  const views = $$('.view');
  const tabs = $$('.tab');
  const indicator = $('.tabs-indicator');
  let currentView = null;
  const seenViews = new Set();

  let indSpring = null, indAt = null;
  function moveIndicator(animated) {
    const tab = tabs.find((t) => t.getAttribute('aria-current') === 'page');
    if (!tab || !indicator || getComputedStyle(indicator).display === 'none') return;
    const inset = 12;
    const tr = tab.getBoundingClientRect();
    const nr = tab.parentElement.getBoundingClientRect();
    const to = [tr.left - nr.left + inset, Math.max(0, tr.width - inset * 2)];
    const paint = ([x, w]) => { indAt = [x, w]; indicator.style.transform = `translateX(${x.toFixed(2)}px) scaleX(${Math.max(0, w).toFixed(2)})`; };
    if (!animated || !indAt || reduced()) { indSpring?.stop(); indSpring = null; paint(to); return; }
    if (indSpring) indSpring.set(to);
    else indSpring = motion.spring({ from: indAt, to, stiffness: 320, damping: 26, precision: 0.05, onUpdate: paint, onRest: () => { indSpring = null; } });
  }

  function show(name, { scroll = true, animate = true } = {}) {
    if (!VIEWS.includes(name)) name = 'home';
    if (name === currentView) return Promise.resolve();
    const from = currentView;
    const update = () => {
      views.forEach((v) => { v.hidden = v.dataset.view !== name; });
      tabs.forEach((t) => (t.dataset.view === name ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current')));
      document.body.dataset.view = name;
      currentView = name;
      if (scroll) window.scrollTo({ top: 0, behavior: 'instant' });
      moveIndicator(animate && !!from);
      const first = !seenViews.has(name);
      seenViews.add(name);
      document.dispatchEvent(new CustomEvent('uc:view', { detail: { name, first, from } }));
    };
    const animated = animate && from && !reduced();
    if (animated && document.startViewTransition) {
      root.dataset.vt = 'tab';
      const t = document.startViewTransition(update);
      t.finished.finally(() => { if (root.dataset.vt === 'tab') delete root.dataset.vt; });
      return t.updateCallbackDone.catch(() => {});
    }
    update();
    if (animated) $(`#view-${name}`)?.animate([{ opacity: 0.4, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: EASE });
    return Promise.resolve();
  }

  /* Navigate and record history without waiting for hashchange */
  function go(name) {
    if (location.hash.slice(1) !== name) history.pushState(null, '', `#${name}`);
    return show(name);
  }

  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  window.addEventListener('popstate', () => show(location.hash.slice(1)));
  window.addEventListener('resize', () => moveIndicator(false));
  phone.addEventListener('change', () => moveIndicator(false));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => moveIndicator(false));
  show(location.hash.slice(1), { scroll: false, animate: false });

  /* ---------- Shared controls ---------- */

  document.addEventListener('click', (e) => {
    const seg = e.target.closest('.seg button');
    if (seg) $$('button', seg.parentElement).forEach((b) => { b.classList.toggle('is-on', b === seg); b.setAttribute('aria-pressed', String(b === seg)); });

    const single = e.target.closest('[data-single] > button');
    if (single) $$(':scope > button', single.parentElement).forEach((b) => { b.classList.toggle('is-on', b === single); b.setAttribute('aria-pressed', String(b === single)); });

    const multi = e.target.closest('[data-multi] > button');
    if (multi) { multi.classList.toggle('is-on'); multi.setAttribute('aria-pressed', String(multi.classList.contains('is-on'))); }

    const sw = e.target.closest('.switch');
    if (sw) sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true'));
  });
  $$('.seg button, [data-single] > button, [data-multi] > button').forEach((b) => b.setAttribute('aria-pressed', String(b.classList.contains('is-on'))));

  /* ---------- Toast with an optional Undo ---------- */

  const toastEl = $('#toast');
  let toastTimer = 0;
  let toastUndo = null;
  function hideToast() {
    clearTimeout(toastTimer);
    if (toastEl.hidden || toastEl.dataset.leaving) return;
    toastEl.dataset.leaving = '';
    const a = motion.animate(toastEl, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(4px)' }], { duration: 160, easing: motion.ease.in, fill: 'forwards' });
    const done = () => { toastEl.hidden = true; delete toastEl.dataset.leaving; a?.cancel(); };
    if (a) a.finished.then(done, done); else done();
  }
  function toast(text, undo) {
    $('#toast-text').textContent = text;
    toastUndo = undo || null;
    $('#toast-undo').hidden = !undo;
    const entering = toastEl.hidden || 'leaving' in toastEl.dataset;
    toastEl.getAnimations().forEach((a) => a.cancel());
    delete toastEl.dataset.leaving;
    toastEl.hidden = false;
    if (entering) motion.animate(toastEl, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 240 });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 5000);
  }
  $('#toast-undo').addEventListener('click', () => {
    if (toastUndo) toastUndo();
    hideToast();
  });
  toastEl.addEventListener('pointerenter', () => clearTimeout(toastTimer));
  toastEl.addEventListener('pointerleave', () => { if (!toastEl.hidden) toastTimer = setTimeout(hideToast, 2500); });

  /* ---------- Overlays: drawer, modal and palette, with enter and exit motion ---------- */

  const stack = [];
  const returnFocus = new Map();
  const panelOf = (o) => $('.drawer, .modal, .palette', o);
  const sheet = (o) => phone.matches && o.id !== 'cmdk';
  function panelFrames(o, panel) {
    if (sheet(o)) return [{ transform: 'translateY(24px)', opacity: 0.6 }, { transform: 'none', opacity: 1 }];
    if (panel.classList.contains('drawer')) return [{ transform: 'translateX(24px)', opacity: 0.6 }, { transform: 'none', opacity: 1 }];
    return [{ transform: 'translateY(8px) scale(.98)', opacity: 0 }, { transform: 'none', opacity: 1 }];
  }
  function openOverlay(el) {
    if (!el) return;
    if (!el.hidden && !('closing' in el.dataset)) return;
    el.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    delete el.dataset.closing;
    if (!stack.includes(el)) { stack.push(el); returnFocus.set(el, document.activeElement); }
    el.hidden = false;
    const panel = panelOf(el);
    motion.animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
    if (panel) motion.animate(panel, panelFrames(el, panel), { duration: 240 });
    const f = $('[autofocus], input:not([type="hidden"]), select, textarea', el) || $('button', el);
    if (f) f.focus({ preventScroll: true });
    UC.tooltip?.hide();
  }
  function closeOverlay(el) {
    if (!el || el.hidden || 'closing' in el.dataset) return Promise.resolve();
    el.dataset.closing = '';
    const panel = panelOf(el);
    const runs = [motion.animate(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: motion.ease.in, fill: 'forwards' })];
    if (panel) runs.push(motion.animate(panel, panelFrames(el, panel).slice().reverse(), { duration: 160, easing: motion.ease.in, fill: 'forwards' }));
    const finish = () => {
      if (!('closing' in el.dataset)) return;
      el.hidden = true;
      delete el.dataset.closing;
      runs.forEach((a) => a?.cancel());
      stack.splice(stack.indexOf(el), 1);
      const back = returnFocus.get(el);
      returnFocus.delete(el);
      if (back && back.isConnected && !stack.length) back.focus({ preventScroll: true });
    };
    return Promise.all(runs.map((a) => (a ? a.finished.catch(() => {}) : null))).then(finish);
  }
  function closeOverlays() { return Promise.all($$('.overlay').filter((o) => !o.hidden).map(closeOverlay)); }

  $$('.overlay').forEach((o) => o.addEventListener('click', (e) => {
    if (e.target === o || e.target.closest('[data-close]')) closeOverlay(o);
  }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length && !e.defaultPrevented) { closeOverlay(stack[stack.length - 1]); return; }
    // Keep Tab inside the top overlay
    if (e.key === 'Tab' && stack.length) {
      const top = stack[stack.length - 1];
      const items = $$('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])', top).filter((n) => n.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !top.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !top.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    }
  });

  /* ---------- Command palette ---------- */

  const commands = new Map();
  const GROUPS = ['Go to', 'Actions', 'Universities'];
  /* UC.command({ id, label, group, icon | monogram, meta, keywords, run }) adds or replaces a command */
  function command(def) { commands.set(def.id, def); }

  const TAB_ICONS = { home: 'house', chat: 'message-circle', activities: 'list-checks', chances: 'gauge', essays: 'file-pen-line', interview: 'mic' };
  tabs.forEach((t) => command({ id: `go-${t.dataset.view}`, group: 'Go to', label: t.textContent.trim(), icon: TAB_ICONS[t.dataset.view] || 'arrow-right', run: () => go(t.dataset.view) }));
  const clickIn = (view, sel) => () => go(view).then(() => $(sel)?.click());
  command({ id: 'add-activity', group: 'Actions', label: 'Add activity', icon: 'plus', keywords: ['new', 'extracurricular', 'common app'], run: clickIn('activities', '[data-open-drawer]') });
  command({ id: 'add-university', group: 'Actions', label: 'Add university', icon: 'plus', keywords: ['new', 'college', 'list'], run: clickIn('chances', '[data-open-modal]') });
  command({ id: 'start-interview', group: 'Actions', label: 'Start mock interview', icon: 'mic', keywords: ['practice', 'interview'], run: clickIn('interview', '#iv-start') });
  command({ id: 'new-chat', group: 'Actions', label: 'New chat', icon: 'square-pen', keywords: ['ask', 'question'], run: clickIn('chat', '#new-chat') });
  command({ id: 'toggle-theme', group: 'Actions', label: 'Toggle theme', icon: 'moon', keywords: ['dark', 'light', 'mode'], run: () => toggleTheme(themeBtn) });
  (D.universities || []).forEach((u) => command({
    id: `uni-${u.id}`, group: 'Universities', label: u.name, monogram: u.initials, meta: `${u.lo}–${u.hi}%`,
    keywords: [u.city, u.program, u.round].filter(Boolean),
    run: () => go('chances').then(() => {
      document.dispatchEvent(new CustomEvent('uc:select-university', { detail: { id: u.id } }));
      let row = $(`.uni-row[data-id="${u.id}"]`);
      if (!row) { $('#uni-filters [data-cat="all"]')?.click(); row = $(`.uni-row[data-id="${u.id}"]`); }
      row?.click();
    })
  }));

  const cmdk = $('#cmdk');
  const cmdkInput = $('#cmdk-input');
  const cmdkList = $('#cmdk-list');
  let results = [];
  let active = 0;

  function score(c, q) {
    if (!q) return 1;
    const label = c.label.toLowerCase();
    if (label.startsWith(q)) return 4;
    const words = `${label} ${(c.keywords || []).join(' ')} ${c.group}`.toLowerCase();
    if (words.split(/[\s,·-]+/).some((w) => w.startsWith(q))) return 3;
    if (words.includes(q)) return 2;
    let i = 0;
    for (const ch of label) if (ch === q[i]) i++;
    return i === q.length ? 1 : 0;
  }
  function renderPalette() {
    const q = cmdkInput.value.trim().toLowerCase();
    results = [...commands.values()]
      .map((c) => [c, score(c, q)])
      .filter(([, s]) => s > 0)
      .sort((a, b) => GROUPS.indexOf(a[0].group) - GROUPS.indexOf(b[0].group) || b[1] - a[1])
      .map(([c]) => c);
    active = Math.max(0, Math.min(active, results.length - 1));
    cmdkList.innerHTML = GROUPS.map((g) => {
      const items = results.filter((c) => c.group === g);
      if (!items.length) return '';
      return `<li class="palette-group" role="presentation">${g}</li>${items.map((c) => {
        const n = results.indexOf(c);
        const lead = c.monogram ? `<span class="crest sm" aria-hidden="true">${esc(c.monogram)}</span>` : ic(c.icon || 'arrow-right');
        return `<li class="palette-item" role="option" id="cmdk-${esc(c.id)}" data-n="${n}" aria-selected="${n === active}">${lead}<span class="palette-label">${esc(c.label)}</span>${c.meta ? `<span class="palette-meta">${esc(c.meta)}</span>` : ''}</li>`;
      }).join('')}`;
    }).join('') || `<li class="palette-empty" role="presentation">No results for "${esc(cmdkInput.value.trim())}"</li>`;
    syncActive(false);
  }
  function syncActive(scroll = true) {
    $$('.palette-item', cmdkList).forEach((li) => li.setAttribute('aria-selected', String(Number(li.dataset.n) === active)));
    const cur = results[active] ? $(`#cmdk-${CSS.escape(results[active].id)}`) : null;
    if (cur) cmdkInput.setAttribute('aria-activedescendant', cur.id); else cmdkInput.removeAttribute('aria-activedescendant');
    if (scroll && cur) cur.scrollIntoView({ block: 'nearest' });
  }
  function runCommand(c) {
    if (!c) return;
    closeOverlay(cmdk).then(() => c.run());
  }
  function openPalette() {
    cmdkInput.value = '';
    active = 0;
    renderPalette();
    openOverlay(cmdk);
  }
  const togglePalette = () => (cmdk.hidden || 'closing' in cmdk.dataset ? openPalette() : closeOverlay(cmdk));

  cmdkInput.addEventListener('input', () => { active = 0; renderPalette(); });
  cmdkInput.addEventListener('keydown', (e) => {
    if (!results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % results.length; syncActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + results.length) % results.length; syncActive(); }
    else if (e.key === 'Home' && e.altKey) { e.preventDefault(); active = 0; syncActive(); }
    else if (e.key === 'End' && e.altKey) { e.preventDefault(); active = results.length - 1; syncActive(); }
    else if (e.key === 'Enter') { e.preventDefault(); runCommand(results[active]); }
  });
  cmdkList.addEventListener('pointermove', (e) => {
    const li = e.target.closest('.palette-item');
    if (li && Number(li.dataset.n) !== active) { active = Number(li.dataset.n); syncActive(false); }
  });
  cmdkList.addEventListener('click', (e) => {
    const li = e.target.closest('.palette-item');
    if (li) runCommand(results[Number(li.dataset.n)]);
  });
  $('#cmdk-open').addEventListener('click', openPalette);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); togglePalette(); }
  });

  /* ---------- Shared API for fx/*.js ----------
     UC.onView(name, fn) calls fn({ first, from }) each time that tab is shown, including right away if it is already showing. */
  Object.assign(UC, {
    D, $, $$, ic, esc, CAT, toast, openOverlay, closeOverlay, closeOverlays, show, go, command,
    palette: { open: openPalette, close: () => closeOverlay(cmdk) },
    theme: { isDark, toggle: toggleTheme },
    onView(name, fn) {
      document.addEventListener('uc:view', (e) => { if (e.detail.name === name) fn({ first: e.detail.first, from: e.detail.from }); });
      if (currentView === name) queueMicrotask(() => fn({ first: true, from: null }));
    }
  });
  Object.defineProperty(UC, 'view', { get: () => currentView, enumerable: true, configurable: true });
})();
