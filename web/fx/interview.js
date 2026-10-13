/* Interview page: behavior owned by the interview page. Uses window.UC from app.js and fx/kit.js. */
(() => {
  'use strict';

  const { $, toast } = UC;

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
