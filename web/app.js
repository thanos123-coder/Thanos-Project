/* UI behavior for the design preview. Nothing here talks to a server.
   This file owns the theme, tabs, shared controls, toast, overlays and the window.UC API.
   Each page renders its sample data and wires its own controls in fx/PAGE.js. */
(() => {
  'use strict';

  const D = window.UPCHANCE;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const ic = (name, cls = '') => `<svg class="i ${cls}"><use href="#i-${name}"/></svg>`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CAT = { reach: 'Reach', target: 'Target', likely: 'Likely' };

  /* ---------- Theme ---------- */

  const root = document.documentElement;
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : darkQuery.matches);
  function syncTheme() {
    root.classList.toggle('is-dark', isDark());
    $('#theme-toggle').setAttribute('aria-label', isDark() ? 'Switch to light theme' : 'Switch to dark theme');
  }
  $('#theme-toggle').addEventListener('click', () => {
    root.dataset.theme = isDark() ? 'light' : 'dark';
    syncTheme();
  });
  darkQuery.addEventListener('change', syncTheme);
  new MutationObserver(syncTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  syncTheme();

  /* ---------- Tabs ---------- */

  const VIEWS = ['home', 'chat', 'activities', 'chances', 'essays', 'interview'];
  const views = $$('.view');
  const tabs = $$('.tab');
  const indicator = $('.tabs-indicator');

  function moveIndicator() {
    const tab = tabs.find((t) => t.getAttribute('aria-current') === 'page');
    if (!tab || !indicator) return;
    indicator.style.width = `${tab.offsetWidth}px`;
    indicator.style.transform = `translateX(${tab.offsetLeft}px)`;
  }

  let currentView = null;
  const seenViews = new Set();

  function show(name, scroll = true) {
    if (!VIEWS.includes(name)) name = 'home';
    views.forEach((v) => { v.hidden = v.dataset.view !== name; });
    tabs.forEach((t) => (t.dataset.view === name ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current')));
    moveIndicator();
    document.body.dataset.view = name;
    currentView = name;
    if (scroll) window.scrollTo(0, 0);
    const first = !seenViews.has(name);
    seenViews.add(name);
    document.dispatchEvent(new CustomEvent('uc:view', { detail: { name, first } }));
  }

  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  window.addEventListener('resize', moveIndicator);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveIndicator);
  indicator.style.transition = 'none';
  show(location.hash.slice(1), false);
  requestAnimationFrame(() => { indicator.style.transition = ''; });

  /* ---------- Shared controls ---------- */

  document.addEventListener('click', (e) => {
    const seg = e.target.closest('.seg button');
    if (seg) $$('button', seg.parentElement).forEach((b) => b.classList.toggle('is-on', b === seg));

    const single = e.target.closest('[data-single] > button');
    if (single) $$(':scope > button', single.parentElement).forEach((b) => b.classList.toggle('is-on', b === single));

    const multi = e.target.closest('[data-multi] > button');
    if (multi) multi.classList.toggle('is-on');

    const sw = e.target.closest('.switch');
    if (sw) sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true'));
  });

  /* Toast with an optional Undo */
  const toastEl = $('#toast');
  let toastTimer = 0;
  let toastUndo = null;
  function toast(text, undo) {
    $('#toast-text').textContent = text;
    toastUndo = undo || null;
    $('#toast-undo').hidden = !undo;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 5000);
  }
  $('#toast-undo').addEventListener('click', () => {
    if (toastUndo) toastUndo();
    toastEl.hidden = true;
  });

  /* Overlays */
  function openOverlay(el) { el.hidden = false; const f = $('input, select, textarea', el) || $('button', el); if (f) f.focus({ preventScroll: true }); }
  function closeOverlays() { $$('.overlay').forEach((o) => { o.hidden = true; }); }
  $$('.overlay').forEach((o) => o.addEventListener('click', (e) => {
    if (e.target === o || e.target.closest('[data-close]')) closeOverlays();
  }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOverlays(); });

  /* ---------- Shared API for fx/*.js ----------
     UC.onView(name, fn) calls fn({ first }) each time that tab is shown, including right away if it is already showing. */
  window.UC = {
    D, $, $$, ic, esc, CAT, toast, openOverlay, closeOverlays, show,
    get reducedMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches; },
    get view() { return currentView; },
    onView(name, fn) {
      document.addEventListener('uc:view', (e) => { if (e.detail.name === name) fn({ first: e.detail.first }); });
      if (currentView === name) queueMicrotask(() => fn({ first: true }));
    }
  };
})();
