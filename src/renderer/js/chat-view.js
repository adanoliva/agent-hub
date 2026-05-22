// Chat view — multi-turn conversation with the configured AI provider

const QUICK_PROMPTS = [
  {
    label: 'Optimizar agente',
    icon:  'ti-robot',
    text:  'Tengo el siguiente system prompt de un agente. Analízalo y propón mejoras para hacerlo más preciso y efectivo:\n\n',
  },
  {
    label: 'Crear CLAUDE.md',
    icon:  'ti-file-text',
    text:  'Ayúdame a crear un archivo CLAUDE.md para un proyecto de tipo: ',
  },
  {
    label: 'Revisar prompt',
    icon:  'ti-eye',
    text:  'Revisa este system prompt e indica si hay instrucciones contradictorias, vagas o que puedan mejorarse:\n\n',
  },
  {
    label: 'Nuevo agente',
    icon:  'ti-plus',
    text:  'Quiero crear un agente para: ',
  },
];

const chatState = {
  messages:       [],
  loading:        false,
  historyLoaded:  false,
};

function renderChatView() {
  const el = document.getElementById('view-chat');
  if (!el) return;

  el.innerHTML = `
    <div class="chat-view">
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-foot">
        <div class="chat-quick">
          ${QUICK_PROMPTS.map((q, i) => `
            <button class="chat-quick-btn" onclick="chatInsertQuick(${i})">
              <i class="ti ${q.icon}"></i> ${esc(q.label)}
            </button>
          `).join('')}
          <button class="chat-quick-btn chat-quick-clear" onclick="chatClear()">
            <i class="ti ti-trash"></i> Nueva
          </button>
        </div>
        <div class="chat-input-row">
          <textarea
            id="chat-input"
            class="chat-input inp"
            placeholder="Escribe un mensaje… (Enter para enviar, Shift+Enter para nueva línea)"
            rows="2"
            onkeydown="chatKeydown(event)"
            oninput="chatAutoResize(this)"
          ></textarea>
          <button class="btn primary" id="chat-send-btn" onclick="chatSend()">
            <i class="ti ti-send"></i>
          </button>
        </div>
      </div>
    </div>
  `;

  const tbActions = document.getElementById('tb-actions');
  if (tbActions) tbActions.innerHTML = '';

  if (!chatState.historyLoaded) {
    chatLoadHistory();
  } else {
    chatRenderMessages();
  }

  setTimeout(() => {
    const inp = document.getElementById('chat-input');
    if (inp) inp.focus();
  }, 50);
}

async function chatLoadHistory() {
  try {
    const res  = await fetch('http://localhost:3737/api/chat/history');
    const data = await res.json();
    if (Array.isArray(data.messages)) chatState.messages = data.messages;
  } catch {
    // silently ignore — start with empty history
  }
  chatState.historyLoaded = true;
  chatRenderMessages();
}

async function chatSaveHistory() {
  try {
    await fetch('http://localhost:3737/api/chat/history', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ messages: chatState.messages }),
    });
  } catch {
    // fire-and-forget; don't block the UI
  }
}

function chatRenderMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  if (chatState.messages.length === 0) {
    container.innerHTML = `
      <div class="chat-empty">
        <i class="ti ti-message-chatbot"></i>
        <p>Inicia una conversación con tu IA configurada.<br>Usa los accesos rápidos para empezar.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = chatState.messages.map(m => `
    <div class="chat-bubble ${m.role === 'user' ? 'user' : 'assistant'}">
      ${renderMarkdown(m.content)}
    </div>
  `).join('') + (chatState.loading ? `
    <div class="chat-bubble assistant chat-typing">
      <span></span><span></span><span></span>
    </div>
  ` : '');

  container.scrollTop = container.scrollHeight;
}

async function chatSend() {
  if (chatState.loading) return;

  const inp = document.getElementById('chat-input');
  if (!inp) return;

  const text = inp.value.trim();
  if (!text) return;

  inp.value = '';
  chatAutoResize(inp);

  chatState.messages.push({ role: 'user', content: text });
  chatState.loading = true;
  chatRenderMessages();

  const sendBtn = document.getElementById('chat-send-btn');
  if (sendBtn) sendBtn.disabled = true;

  try {
    const res = await fetch('http://localhost:3737/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ messages: chatState.messages }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error del servidor');
    chatState.messages.push({ role: 'assistant', content: data.reply });
    chatSaveHistory();
  } catch (e) {
    chatState.messages.push({ role: 'assistant', content: `⚠️ Error: ${e.message}` });
  } finally {
    chatState.loading = false;
    if (sendBtn) sendBtn.disabled = false;
    chatRenderMessages();
    setTimeout(() => { if (inp) inp.focus(); }, 50);
  }
}

function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatSend();
  }
}

function chatAutoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function chatInsertQuick(index) {
  const q   = QUICK_PROMPTS[index];
  const inp = document.getElementById('chat-input');
  if (!inp || !q) return;
  inp.value = q.text;
  inp.focus();
  inp.setSelectionRange(inp.value.length, inp.value.length);
  chatAutoResize(inp);
}

function chatClear() {
  chatState.messages = [];
  chatState.loading  = false;
  fetch('http://localhost:3737/api/chat/history', { method: 'DELETE' }).catch(() => {});
  chatRenderMessages();
  const inp = document.getElementById('chat-input');
  if (inp) { inp.value = ''; inp.focus(); }
}
