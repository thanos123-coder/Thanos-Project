/* UI behavior for the design preview. Nothing here talks to a server: it switches tabs,
   renders the sample data in data.js, and shows how each control responds. */
(() => {
  'use strict';

  const D = window.UPCHANCE;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const ic = (name, cls = '') => `<svg class="i ${cls}"><use href="#i-${name}"/></svg>`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
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

    const tool = e.target.closest('.tool-chip');
    if (tool) {
      tool.classList.toggle('is-on');
      tool.setAttribute('aria-pressed', String(tool.classList.contains('is-on')));
    }

    const essayItem = e.target.closest('.essay-item');
    if (essayItem) $$('.essay-item').forEach((b) => b.classList.toggle('is-active', b === essayItem));
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

  /* ---------- Chat ---------- */

  const chat = $('#chat');
  const chatMain = $('#chat-main');
  const chatList = $('#chat-list');
  const chatSearch = $('#chat-search');
  const composerInput = $('#composer-input');
  let activeChat = null;

  function renderChats() {
    const q = chatSearch.value.trim().toLowerCase();
    const html = D.chats.map((g) => {
      const items = g.items.filter((t) => !q || t.toLowerCase().includes(q));
      if (!items.length) return '';
      return `<div class="side-group"><div class="side-label">${g.pinned ? ic('pin') : ''}${esc(g.group)}</div>${
        items.map((t) => `<button class="chat-item${t === activeChat ? ' is-active' : ''}" type="button" data-title="${esc(t)}"><span>${esc(t)}</span><span class="more">${ic('ellipsis', 'i-sm')}</span></button>`).join('')
      }</div>`;
    }).join('');
    chatList.innerHTML = html || `<p class="side-empty">No chats match "${esc(chatSearch.value)}".</p>`;
  }

  function openChat(title) {
    activeChat = title;
    chatMain.dataset.state = 'thread';
    $('#chat-title').textContent = title;
    chat.classList.remove('sidebar-open');
    renderChats();
    const thread = $('#thread');
    requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; });
  }

  function newChat() {
    activeChat = null;
    chatMain.dataset.state = 'empty';
    $('#chat-title').textContent = 'New chat';
    chat.classList.remove('sidebar-open');
    renderChats();
    composerInput.focus({ preventScroll: true });
  }

  chatList.addEventListener('click', (e) => {
    const item = e.target.closest('.chat-item');
    if (item) openChat(item.dataset.title);
  });
  chatSearch.addEventListener('input', renderChats);
  $('#new-chat').addEventListener('click', newChat);
  $('.side-open').addEventListener('click', () => chat.classList.add('sidebar-open'));
  $('.side-close').addEventListener('click', () => chat.classList.remove('sidebar-open'));
  $$('.suggestion').forEach((s) => s.addEventListener('click', () => {
    composerInput.value = s.dataset.prompt;
    composerInput.focus();
  }));
  $$('.topic-row .chip').forEach((c) => c.addEventListener('click', () => {
    composerInput.value = `Tell me about ${c.textContent.toLowerCase()} for my list.`;
    composerInput.focus();
  }));
  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    composerInput.value = '';
    openChat('Is my college list balanced?');
  });
  composerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); }
  });
  renderChats();

  /* ---------- Activities ---------- */

  const TONES = {
    ivy: ['var(--ivy-soft)', 'var(--ivy)'],
    info: ['var(--info-soft)', 'var(--info)'],
    violet: ['var(--violet-soft)', 'var(--violet)'],
    reach: ['var(--reach-soft)', 'var(--reach)'],
    target: ['var(--target-soft)', 'var(--target)']
  };

  $('#score-bar').innerHTML = Array.from({ length: 45 }, (_, i) => {
    const cls = i < D.student.subjects ? 'on' : i < D.student.predicted ? 'pt-core' : '';
    return `<i class="${cls}"></i>`;
  }).join('');

  $('#subjects').innerHTML = D.subjects.map((s) => `
    <div class="subject">
      <div class="subject-top"><span class="subject-group">${esc(s.group)}</span><span class="lvl ${s.level.toLowerCase()}">${s.level}</span></div>
      <div class="subject-name">${esc(s.name)}</div>
      <div class="subject-grade"><span class="g">${s.grade}</span><span class="pips" aria-label="${s.grade} out of 7">${
        Array.from({ length: 7 }, (_, i) => `<i class="${i < s.grade ? 'on' : ''}"></i>`).join('')
      }</span></div>
      <button class="icon-btn edit" type="button" aria-label="Edit ${esc(s.name)}">${ic('pencil', 'i-sm')}</button>
    </div>`).join('');

  function renderActivities(filter) {
    const list = D.activities.filter((a) => filter === 'all' || a.tags.includes(filter));
    $('#act-list').innerHTML = list.map((a) => {
      const [sw, sc] = TONES[a.tone];
      const len = a.desc.length;
      const hours = a.hours == null
        ? `<span class="missing">${ic('clock')}Add hours</span>`
        : `<span>${ic('clock')}${a.hours} hr/wk</span>`;
      return `
      <li class="act">
        <span class="act-handle" aria-hidden="true">${ic('grip-vertical')}</span>
        <span class="act-ico" style="--sw:${sw};--sc:${sc}">${ic(a.icon)}</span>
        <div class="act-body">
          <span class="act-type">${esc(a.type)}</span>
          <div class="act-title"><b>${esc(a.role)}</b><span>${esc(a.org)}</span></div>
          <p class="act-desc">${esc(a.desc)}</p>
          <div class="act-meta">
            <span class="grades" aria-label="Grades ${a.grades.join(', ')}">${[9, 10, 11, 12].map((g) => `<i class="${a.grades.includes(g) ? 'on' : ''}">${g}</i>`).join('')}</span>
            ${hours}
            <span>${ic('calendar-days')}${a.weeks} wk/yr</span>
            <span>${ic('calendar-clock')}${esc(a.timing)}</span>
            <span class="char-count${len > 140 ? ' near' : ''}">${len} / 150</span>
          </div>
          ${a.note ? `<div class="act-note">${ic('sparkles')}<span>${esc(a.note)}</span></div>` : ''}
        </div>
        <div class="act-actions">
          <button class="icon-btn" type="button" data-edit="${a.id}" aria-label="Edit ${esc(a.role)}">${ic('pencil')}</button>
          <button class="icon-btn" type="button" aria-label="More options">${ic('ellipsis')}</button>
        </div>
      </li>`;
    }).join('');
  }
  renderActivities('all');

  $('#act-filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    $$('.chip', chip.parentElement).forEach((c) => c.classList.toggle('is-on', c === chip));
    renderActivities(chip.dataset.filter);
  });

  const HONOR_ICON = { International: 'globe', National: 'medal', Regional: 'award', School: 'trophy' };
  $('#honor-list').innerHTML = D.honors.map((h) => `
    <li class="honor">
      <span class="honor-ico">${ic(HONOR_ICON[h.level])}</span>
      <div><b>${esc(h.title)}</b><small>Grade ${h.grades.join(', ')}</small></div>
      <span class="level ${h.level.toLowerCase()}">${h.level}</span>
      <div class="act-actions"><button class="icon-btn" type="button" aria-label="Edit award">${ic('pencil')}</button></div>
    </li>`).join('');

  /* Add or edit activity drawer */
  const drawer = $('#drawer');
  const counters = [['#f-role', '#role-count', 50], ['#f-org', '#org-count', 100], ['#f-desc', '#desc-count', 150]];
  const updateCounts = () => counters.forEach(([input, out, max]) => { $(out).textContent = `${$(input).value.length} / ${max}`; });
  counters.forEach(([input]) => $(input).addEventListener('input', updateCounts));

  function openDrawer(activity) {
    $('#drawer-title').firstChild.textContent = activity ? 'Edit activity' : 'Add activity';
    $('#drawer-sub').textContent = activity ? `Slot ${D.activities.indexOf(activity) + 1} of 10 on the Common App` : 'Fills one of your 10 Common App slots';
    $('#f-role').value = activity ? activity.role : '';
    $('#f-org').value = activity ? activity.org : '';
    $('#f-desc').value = activity ? activity.desc : '';
    $('#f-hrs').value = activity && activity.hours != null ? activity.hours : '';
    $('#f-wks').value = activity ? activity.weeks : '';
    if (activity) {
      const type = $$('#f-type option').find((o) => o.textContent === activity.type);
      if (type) $('#f-type').value = type.textContent;
      $$('#drawer .check-pill').forEach((p) => p.classList.toggle('is-on', activity.grades.includes(Number(p.textContent))));
    }
    updateCounts();
    openOverlay(drawer);
  }
  $$('[data-open-drawer]').forEach((b) => b.addEventListener('click', () => openDrawer(null)));
  $('#act-list').addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit]');
    if (edit) openDrawer(D.activities.find((a) => a.id === edit.dataset.edit));
  });
  $('#activity-form').addEventListener('submit', (e) => e.preventDefault());

  /* ---------- Chances ---------- */

  const unis = D.universities.slice();
  let uniFilter = 'all';
  let selectedUni = 'imperial';

  const crest = (u, size = '') => `<span class="crest ${size}" style="--c:${u.c};--ci:${u.ci}">${esc(u.initials)}</span>`;

  function gauge(u) {
    const cx = 120, cy = 120, r = 96;
    const pt = (p, rad = r) => {
      const a = Math.PI * (1 - p / 100);
      return [+(cx + rad * Math.cos(a)).toFixed(2), +(cy - rad * Math.sin(a)).toFixed(2)];
    };
    const [x0, y0] = pt(0);
    const [x1, y1] = pt(100);
    const [a0, b0] = pt(u.lo);
    const [a1, b1] = pt(u.hi);
    const ticks = [0, 25, 50, 75, 100].map((p) => {
      const [tx0, ty0] = pt(p, r + 11);
      const [tx1, ty1] = pt(p, r + 16);
      return `<line class="g-tick" x1="${tx0}" y1="${ty0}" x2="${tx1}" y2="${ty1}"/>`;
    }).join('');
    let avg = '';
    if (u.admit != null) {
      const [m0, n0] = pt(u.admit, r - 12);
      const [m1, n1] = pt(u.admit, r + 12);
      avg = `<line class="g-avg" x1="${m0}" y1="${n0}" x2="${m1}" y2="${n1}"/>`;
    }
    return `
      <svg class="gauge" viewBox="0 0 240 150" role="img" aria-label="Estimated chance ${u.lo} to ${u.hi} percent">
        <path class="g-track" d="M${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1}"/>
        ${ticks}
        <path class="g-band" style="stroke:var(--${u.cat})" d="M${a0} ${b0} A${r} ${r} 0 0 1 ${a1} ${b1}"/>
        ${avg}
        <text class="g-range" x="120" y="104" text-anchor="middle">${u.lo}–${u.hi}%</text>
        <text class="g-cap" x="120" y="126" text-anchor="middle" style="fill:var(--${u.cat})">${CAT[u.cat]}</text>
        <text class="g-end" x="${x0}" y="146" text-anchor="middle">0</text>
        <text class="g-end" x="${x1}" y="146" text-anchor="middle">100%</text>
      </svg>`;
  }

  function renderUniList() {
    const list = unis.filter((u) => uniFilter === 'all' || u.cat === uniFilter);
    $('#uni-list').innerHTML = list.map((u) => `
      <li class="uni-li" data-id="${u.id}">
        <button class="uni-row${u.id === selectedUni ? ' is-active' : ''}" type="button" data-id="${u.id}" aria-pressed="${u.id === selectedUni}">
          ${crest(u)}
          <span class="ur-main"><span class="ur-name">${esc(u.name)}</span><span class="ur-meta">${esc(u.round)} · <span class="${u.days <= 7 ? 'soon' : ''}">${u.deadline}${u.days <= 7 ? ` (${u.days} days)` : ''}</span></span></span>
          <span class="ur-chance"><span class="ur-range">${u.lo}–${u.hi}%</span><span class="pill pill-${u.cat}">${CAT[u.cat]}</span></span>
          <span class="range-track" aria-hidden="true"><span style="left:${u.lo}%;width:${u.hi - u.lo}%;background:var(--${u.cat})"></span></span>
        </button>
        <button class="ur-remove" type="button" data-remove="${u.id}" aria-label="Remove ${esc(u.name)}">${ic('x')}</button>
      </li>`).join('') || '<li class="side-empty">No universities in this group yet.</li>';
    $('#uni-count').textContent = unis.length;
  }

  function renderUniDetail() {
    const u = unis.find((x) => x.id === selectedUni);
    const el = $('#uni-detail');
    if (!u) {
      el.innerHTML = `<div class="ud-section"><p class="page-sub">Choose a university to see your chances and UpChance's comments.</p></div>`;
      return;
    }
    const known = u.factors.filter((f) => f[1] > 0).length;
    const TAKE_ICON = { good: 'check', risk: 'triangle-alert', action: 'arrow-right' };
    el.innerHTML = `
      <header class="ud-head">
        ${crest(u, 'lg')}
        <div><h2>${esc(u.name)}</h2><p>${ic('map-pin')}${esc(u.city)} · ${esc(u.program)}</p></div>
        <div class="ud-actions">
          <a class="btn btn-secondary btn-sm" href="#chat">${ic('message-circle', 'i-sm')}Ask UpChance</a>
          <button class="icon-btn" type="button" data-remove="${u.id}" aria-label="Remove ${esc(u.name)}">${ic('trash-2')}</button>
        </div>
      </header>
      <div class="ud-top">
        <div class="gauge-wrap">
          ${gauge(u)}
          <div class="gauge-legend"><span><i class="sw-band" style="--sw:var(--${u.cat})"></i>Your range</span>${u.admit != null ? '<span><i class="sw-avg"></i>Overall admit rate</span>' : ''}</div>
        </div>
        <div class="ud-facts">
          <div class="fact"><span>Category</span><b class="pill pill-${u.cat}">${CAT[u.cat]}</b><em>${u.cat === 'reach' ? 'Admission is unlikely for most applicants' : u.cat === 'target' ? 'Your profile fits the typical admit' : 'Your profile is above the typical admit'}</em></div>
          <div class="fact"><span>Deadline</span><b>${esc(u.round)} · ${u.deadline}</b><em class="${u.days <= 7 ? 'soon' : ''}">${u.days} days left</em></div>
          <div class="fact"><span>Overall admit rate</span><b>${u.admit != null ? `≈ ${u.admit}%` : 'Varies by course'}</b><em>${u.admit != null ? 'All applicants, most recent cycle' : 'UK offer rates are published per course'}</em></div>
          <div class="fact"><span>Confidence</span><b>${u.confidence}</b><em>${known} of 5 factors known so far</em></div>
        </div>
      </div>
      <section class="ud-section">
        <h3>${ic('sliders-horizontal')}What's behind it</h3>
        <div class="factors">${u.factors.map(([label, v, note]) => `
          <div class="factor"><b>${esc(label)}</b><span class="meter${v === 0 ? ' unknown' : ''}" aria-label="${v === 0 ? 'Not known yet' : `${v} of 5`}">${[1, 2, 3, 4, 5].map((i) => `<i class="${v >= i ? 'on' : ''}"></i>`).join('')}</span><span>${esc(note)}</span></div>`).join('')}
        </div>
      </section>
      <section class="ud-section">
        <h3>${ic('sparkles')}UpChance's take</h3>
        <div class="takes">${u.take.map(([tone, html]) => `<div class="take ${tone}"><span class="take-ico">${ic(TAKE_ICON[tone])}</span><span>${html}</span></div>`).join('')}</div>
      </section>
      <div class="ud-foot">${ic('info')}Estimated from your profile and this university's published admissions data.<a href="#chat">Ask why${ic('arrow-right', 'i-sm')}</a></div>`;
  }

  function removeUni(id) {
    const index = unis.findIndex((u) => u.id === id);
    if (index < 0) return;
    const [removed] = unis.splice(index, 1);
    const finish = () => {
      if (selectedUni === id) selectedUni = (unis[index] || unis[index - 1] || {}).id;
      renderUniList();
      renderUniDetail();
    };
    const li = $(`.uni-li[data-id="${id}"]`);
    if (li && !reducedMotion) { li.classList.add('is-leaving'); setTimeout(finish, 220); } else finish();
    toast(`Removed ${removed.name}`, () => {
      unis.splice(index, 0, removed);
      selectedUni = removed.id;
      renderUniList();
      renderUniDetail();
    });
  }

  $('#uni-filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    $$('.chip', chip.parentElement).forEach((c) => c.classList.toggle('is-on', c === chip));
    uniFilter = chip.dataset.cat;
    renderUniList();
  });
  $('#view-chances').addEventListener('click', (e) => {
    const remove = e.target.closest('[data-remove]');
    if (remove) { removeUni(remove.dataset.remove); return; }
    const row = e.target.closest('.uni-row');
    if (row) {
      selectedUni = row.dataset.id;
      renderUniList();
      renderUniDetail();
      if (innerWidth <= 900) $('#uni-detail').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    }
  });

  const addUni = $('#add-uni');
  $$('[data-open-modal]').forEach((b) => b.addEventListener('click', () => openOverlay(addUni)));
  addUni.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (!add) return;
    const name = $('b', add.closest('.result')).textContent;
    add.classList.add('is-added');
    add.disabled = true;
    add.innerHTML = `${ic('check', 'i-sm')}Added`;
    toast(`Added ${name}. UpChance is estimating your chances.`);
  });

  renderUniList();
  renderUniDetail();

  /* ---------- Essay grader ---------- */

  const doc = $('#essay-doc');
  const MODE_KINDS = { ai: ['ai'], grammar: ['grammar'], clarity: ['clarity'], impact: ['strong', 'tell'] };
  const SCAN_COLOR = { ai: 'var(--marigold-ink)', grammar: 'var(--danger)', clarity: 'var(--info)', impact: 'var(--violet)' };
  const kindsOf = (el) => (el.dataset.k || '').split(' ');
  const activeFor = (el, mode) => kindsOf(el).some((k) => MODE_KINDS[mode].includes(k));

  function issueCard(issue, color) {
    const fix = issue.from
      ? `<div class="fix"><del>${esc(issue.from)}</del>${ic('arrow-right')}<ins>${esc(issue.to)}</ins></div>`
      : '';
    const quote = issue.quote ? `<p class="issue-quote">"${esc(issue.quote)}"</p>` : '';
    const text = issue.text ? `<p class="issue-text">${esc(issue.text)}</p>` : '';
    const actions = issue.from ? '<div class="fix-actions"><span class="btn btn-primary btn-sm">Accept</span><span class="btn btn-ghost btn-sm">Ignore</span></div>' : '';
    const c = issue.tone === 'good' ? 'var(--likely)' : color;
    return `<button class="issue" type="button" data-target="${issue.target}" style="--sc:${c}"><span class="issue-bar"></span><span><span class="issue-kind">${esc(issue.kind)}</span>${text}${quote}${fix}${actions}</span></button>`;
  }

  function renderScan(mode) {
    const scan = D.scans[mode];
    const color = SCAN_COLOR[mode];
    $('#legend').innerHTML = scan.legend.map(([label, bg, line]) => `<span style="--sw:${bg};--sl:${line || 'transparent'}"${bg === 'transparent' ? ' class="wavy"' : ''}>${label}</span>`).join('');

    let summary = '';
    if (mode === 'ai') {
      summary = `
        <div class="result-card">
          <h4>${ic('scan-search')}AI detection</h4>
          <p class="ai-verdict" style="margin-top:10px">Most of this essay reads as written by you.</p>
          <div class="ai-split" aria-hidden="true"><span style="flex:88;background:var(--likely)"></span><span style="flex:7;background:var(--violet)"></span><span style="flex:5;background:var(--marigold)"></span></div>
          <div class="ai-split-legend"><span><b>88%</b> human</span><span><b>7%</b> mixed</span><span><b>5%</b> AI-like</span></div>
          <div class="note">${ic('info')}<span>Detectors can be wrong, especially with formal writing or English as a second language. Treat this as a signal and revise flagged sentences in your own words.</span></div>
        </div>`;
    } else if (mode === 'grammar') {
      summary = `
        <div class="result-card">
          <h4>${ic('spell-check')}5 fixes found</h4>
          <p>All are small. Accept them one by one, or all at once.</p>
          <div class="fix-actions"><span class="btn btn-primary btn-sm">${ic('check-check', 'i-sm')}Accept all 5</span></div>
        </div>`;
    } else if (mode === 'clarity') {
      summary = `
        <div class="result-card">
          <h4>${ic('type')}Easy to read</h4>
          <p>Reading level: grade 10. Average sentence: 19 words. Four places could be tighter.</p>
        </div>`;
    } else {
      summary = `
        <div class="result-card">
          <h4>${ic('graduation-cap')}How a reader sees it</h4>
          <p>A vivid opening and a real failure. The ending summarizes instead of showing what changed.</p>
          <div class="rubric">${scan.rubric.map(([label, v]) => `<div class="rubric-row"><span>${label}</span><span class="meter">${[1, 2, 3, 4, 5].map((i) => `<i class="${v >= i ? 'on' : ''}"></i>`).join('')}</span><b>${v}/5</b></div>`).join('')}</div>
        </div>`;
    }

    $('#scan-result').innerHTML = `${summary}<div class="panel-label">${scan.issues.length} highlighted <span>Select one to find it</span></div><div class="issues">${scan.issues.map((i) => issueCard(i, color)).join('')}</div>`;
  }

  function setScan(mode) {
    doc.dataset.mode = mode;
    $$('#scan-list .scan').forEach((b) => {
      const on = b.dataset.scan === mode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    });
    renderScan(mode);
  }

  function focusSpan(id) {
    $$('.hl.is-focus', doc).forEach((s) => s.classList.remove('is-focus'));
    const span = document.getElementById(id);
    if (!span) return;
    void span.offsetWidth;
    span.classList.add('is-focus');
    span.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
    setTimeout(() => span.classList.remove('is-focus'), 2200);
  }

  $('#scan-list').addEventListener('click', (e) => {
    const b = e.target.closest('.scan');
    if (b) setScan(b.dataset.scan);
  });
  $('#scan-result').addEventListener('click', (e) => {
    const issue = e.target.closest('.issue');
    if (issue) focusSpan(issue.dataset.target);
  });
  doc.addEventListener('click', (e) => {
    let span = e.target.closest('.hl');
    while (span && !activeFor(span, doc.dataset.mode)) span = span.parentElement.closest('.hl');
    if (!span) return;
    const card = $(`.issue[data-target="${span.id}"]`);
    if (card) {
      card.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
      card.animate?.([{ boxShadow: '0 0 0 3px var(--sc)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1200 });
    }
  });
  setScan('ai');

  /* ---------- Mock interview ---------- */

  const ivLayout = $('#iv-layout');
  const recTime = $('#rec-time');
  let seconds = 8 * 60 + 42;
  let ticker = 0;
  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  $('#iv-start').addEventListener('click', () => {
    ivLayout.dataset.state = 'live';
    window.scrollTo(0, 0);
    clearInterval(ticker);
    ticker = setInterval(() => { seconds += 1; recTime.textContent = fmt(seconds); }, 1000);
  });
  $('#iv-end').addEventListener('click', () => {
    ivLayout.dataset.state = 'setup';
    clearInterval(ticker);
    toast('Session saved. Your feedback report will be ready in about a minute.');
  });
})();
