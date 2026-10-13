/* Chat page: behavior owned by the chat page. Uses window.UC from app.js and fx/kit.js. */
(() => {
  'use strict';

  const { D, $, $$, ic, esc } = UC;

  /* Composer tool chips toggle on and off */
  document.addEventListener('click', (e) => {
    const tool = e.target.closest('.tool-chip');
    if (tool) {
      tool.classList.toggle('is-on');
      tool.setAttribute('aria-pressed', String(tool.classList.contains('is-on')));
    }
  });

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
})();
