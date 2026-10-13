/* Activities page: behavior owned by the activities page. Uses window.UC from app.js and fx/kit.js. */
(() => {
  'use strict';

  const { D, $, $$, ic, esc, openOverlay } = UC;

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
})();
