/* Essays page: behavior owned by the essays page. Uses window.UC from app.js and fx/kit.js. */
(() => {
  'use strict';

  const { D, $, $$, ic, esc, reducedMotion } = UC;

  /* Essay list: mark the selected essay */
  document.addEventListener('click', (e) => {
    const essayItem = e.target.closest('.essay-item');
    if (essayItem) $$('.essay-item').forEach((b) => b.classList.toggle('is-active', b === essayItem));
  });

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
})();
