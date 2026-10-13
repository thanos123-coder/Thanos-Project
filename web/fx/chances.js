/* Chances page: behavior owned by the chances page. Uses window.UC from app.js and fx/kit.js. */
(() => {
  'use strict';

  const { D, $, $$, ic, esc, CAT, toast, openOverlay, reducedMotion } = UC;

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
})();
