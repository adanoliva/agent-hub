// Chat view — multi-turn conversation with @mention context, per-project history, and action suggestions

const QUICK_PROMPTS = [
  { label: 'Optimizar agente', icon: 'ti-robot',        text: 'Tengo el siguiente system prompt de un agente. Analízalo y propón mejoras para hacerlo más preciso y efectivo:\n\n' },
  { label: 'Crear CLAUDE.md',  icon: 'ti-file-text',    text: 'Ayúdame a crear un archivo CLAUDE.md para un proyecto de tipo: ' },
  { label: 'Revisar prompt',   icon: 'ti-eye',           text: 'Revisa este system prompt e indica si hay instrucciones contradictorias, vagas o que puedan mejorarse:\n\n' },
  { label: 'Nuevo agente',     icon: 'ti-plus',          text: 'Quiero crear un agente para: ' },
];

const chatState = {
  messages:        [],
  loading:         false,
  historyLoaded:   false,
  loadedProjectId: '__none__',
  projectId:       null,        // null = global
  activeAgents:    [],          // [{name, description, system, level}]
  allAgents:       null,        // null = not yet fetched
  mentionQuery:    null,        // null = closed | string = being typed
  mentionIndex:    0,
  mentionStart:    0,           // cursor position where @ starts in textarea
};

// ── Render ────────────────────────────────────────────────────────────────────

function renderChatView() {
  const el = document.getElementById('view-chat');
  if (!el) return;

  el.innerHTML = `
    <div class="chat-view">
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-foot">
        <div class="chat-context-bar" id="chat-context-bar" style="display:none"></div>
        <div class="chat-quick">
          ${QUICK_PROMPTS.map((q, i) => `
            <button class="chat-quick-btn" onclick="chatInsertQuick(${i})">
              <i class="ti ${q.icon}"></i> ${esc(q.label)}
            </button>`).join('')}
          <button class="chat-quick-btn chat-quick-clear" onclick="chatClear()">
            <i class="ti ti-trash"></i> Nueva
          </button>
        </div>
        <div class="chat-input-row">
          <div class="chat-input-wrap">
            <div class="mention-dropdown" id="mention-dropdown" style="display:none"></div>
            <textarea
              id="chat-input"
              class="chat-input inp"
              placeholder="Escribe… usa @nombre para añadir agentes como contexto (Enter envía)"
              rows="2"
              onkeydown="chatKeydown(event)"
              oninput="chatOnInput(this)"
            ></textarea>
          </div>
          <button class="btn primary" id="chat-send-btn" onclick="chatSend()">
            <i class="ti ti-send"></i>
          </button>
        </div>
      </div>
    </div>`;

  // Topbar: project selector
  const tbActions = document.getElementById('tb-actions');
  if (tbActions) {
    const projs = S.projects || [];
    tbActions.innerHTML = `
      <select class="chat-proj-sel" onchange="chatSwitchProject(this.value)" title="Historial de conversación por proyecto">
        <option value="">Global</option>
        ${projs.map(p => `<option value="${p.id}" ${chatState.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>`;
  }

  chatRenderContextBar();

  const needLoad = !chatState.historyLoaded || chatState.loadedProjectId !== (chatState.projectId || '');
  if (needLoad) {
    chatLoadHistory(chatState.projectId);
  } else {
    chatRenderMessages();
  }

  if (chatState.allAgents === null) chatLoadAllAgents();

  setTimeout(() => { const inp = document.getElementById('chat-input'); if (inp) inp.focus(); }, 50);
}

// ── Context bar ───────────────────────────────────────────────────────────────

function chatRenderContextBar() {
  const bar = document.getElementById('chat-context-bar');
  if (!bar) return;
  if (chatState.activeAgents.length === 0) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  bar.style.display = 'flex';
  bar.innerHTML =
    `<span style="font-size:11px;color:var(--text2);flex-shrink:0">Contexto:</span>` +
    chatState.activeAgents.map(a => `
      <div class="agent-chip">
        <i class="ti ti-robot" style="font-size:11px"></i>
        <span>@${esc(a.name)}</span>
        <span class="chip-remove" onmousedown="event.preventDefault();chatRemoveAgent('${esc(a.name)}')" title="Quitar">
          <i class="ti ti-x" style="font-size:10px"></i>
        </span>
      </div>`).join('') +
    `<button class="btn ghost sm" onmousedown="event.preventDefault();chatClearAgents()" style="font-size:10px;padding:1px 7px">Limpiar</button>`;
}

function chatUpdateSub() {
  const sub = document.getElementById('tb-sub');
  if (sub) sub.textContent = chatState.activeAgents.length > 0 ? `${chatState.activeAgents.length} agente${chatState.activeAgents.length > 1 ? 's' : ''} activo${chatState.activeAgents.length > 1 ? 's' : ''}` : '';
}

function chatRemoveAgent(name) {
  chatState.activeAgents = chatState.activeAgents.filter(a => a.name !== name);
  chatRenderContextBar();
  chatUpdateSub();
}

function chatClearAgents() {
  chatState.activeAgents = [];
  chatRenderContextBar();
  chatUpdateSub();
}

// ── Per-project history ───────────────────────────────────────────────────────

async function chatLoadHistory(projectId) {
  const pid = projectId || '';
  const url  = pid ? `/chat/history?projectId=${encodeURIComponent(pid)}` : '/chat/history';
  try {
    const data = await req('GET', url);
    chatState.messages = Array.isArray(data.messages) ? data.messages : [];
  } catch {
    chatState.messages = [];
  }
  chatState.historyLoaded  = true;
  chatState.loadedProjectId = pid;
  chatRenderMessages();
}

async function chatSaveHistory() {
  const pid = chatState.projectId || '';
  const url  = pid ? `/chat/history?projectId=${encodeURIComponent(pid)}` : '/chat/history';
  try { await req('PUT', url, { messages: chatState.messages }); } catch {}
}

async function chatSwitchProject(projectId) {
  const newId = projectId || null;
  if (newId === chatState.projectId) return;
  await chatSaveHistory();
  chatState.projectId     = newId;
  chatState.historyLoaded = false;
  chatState.messages      = [];
  chatRenderMessages();
  chatLoadHistory(newId);
}

// ── Flat agents list (@mention) ───────────────────────────────────────────────

async function chatLoadAllAgents() {
  try {
    chatState.allAgents = await req('GET', '/agents/flat');
  } catch {
    chatState.allAgents = [];
  }
}

// ── @mention autocomplete ─────────────────────────────────────────────────────

function chatOnInput(el) {
  chatAutoResize(el);

  const pos  = el.selectionStart;
  const text = el.value.slice(0, pos);
  const atIdx = text.lastIndexOf('@');

  // Only trigger if @ is at start or preceded by whitespace
  if (atIdx === -1 || (atIdx > 0 && !/[\s\n]/.test(text[atIdx - 1]))) {
    mentionClose(); return;
  }

  const query = text.slice(atIdx + 1);
  if (query.includes(' ') || query.includes('\n')) { mentionClose(); return; }

  chatState.mentionStart = atIdx;
  chatState.mentionQuery = query;
  chatState.mentionIndex = 0;
  chatRenderMention();
}

function mentionFiltered() {
  const q = (chatState.mentionQuery || '').toLowerCase();
  return (chatState.allAgents || [])
    .filter(a => !chatState.activeAgents.find(x => x.name === a.name) && a.name.toLowerCase().includes(q))
    .slice(0, 8);
}

function chatRenderMention() {
  const dd = document.getElementById('mention-dropdown');
  if (!dd) return;
  const items = mentionFiltered();
  if (!items.length || chatState.mentionQuery === null) { dd.style.display = 'none'; return; }
  const lvlLabel = { global: 'global', section: 'sección', tech: 'tech', project: 'proyecto' };
  dd.style.display = 'block';
  dd.innerHTML = items.map((a, i) => `
    <div class="mention-item ${i === chatState.mentionIndex ? 'sel' : ''}" onmousedown="event.preventDefault();mentionSelectIdx(${i})">
      <span class="mi-name">@${esc(a.name)}</span>
      <span class="mi-desc">${esc(a.description || '')}</span>
      <span class="mi-level">${lvlLabel[a.level] || a.level}</span>
    </div>`).join('');
}

function mentionClose() {
  chatState.mentionQuery = null;
  const dd = document.getElementById('mention-dropdown');
  if (dd) dd.style.display = 'none';
}

function mentionMoveSelection(delta) {
  const items = mentionFiltered();
  chatState.mentionIndex = Math.max(0, Math.min(items.length - 1, chatState.mentionIndex + delta));
  chatRenderMention();
}

function mentionSelectIdx(i) {
  const agent = mentionFiltered()[i];
  if (agent) mentionApply(agent);
}

function mentionSelect() {
  const agent = mentionFiltered()[chatState.mentionIndex];
  if (agent) mentionApply(agent);
  else mentionClose();
}

function mentionApply(agent) {
  const inp = document.getElementById('chat-input');
  if (!inp) return;

  // Remove @query text from input using stored positions
  const end    = chatState.mentionStart + 1 + (chatState.mentionQuery || '').length;
  const before = inp.value.slice(0, chatState.mentionStart);
  const after  = inp.value.slice(end);
  inp.value = before + after;
  inp.setSelectionRange(chatState.mentionStart, chatState.mentionStart);
  chatAutoResize(inp);

  if (!chatState.activeAgents.find(a => a.name === agent.name)) {
    chatState.activeAgents.push(agent);
    chatRenderContextBar();
    chatUpdateSub();
  }
  mentionClose();
  inp.focus();
}

// ── Render messages ───────────────────────────────────────────────────────────

function chatParseActions(content) {
  const m = content.match(/<!--ACTIONS:([\s\S]*?)-->/);
  if (!m) return { clean: content, actions: [] };
  try {
    const actions = JSON.parse(m[1]);
    return { clean: content.replace(/<!--ACTIONS:[\s\S]*?-->/, '').trim(), actions };
  } catch {
    return { clean: content, actions: [] };
  }
}

function chatRenderActionBtns(actions, msgIdx) {
  if (!actions || !actions.length) return '';
  const icons = { 'create-agent': 'ti-plus', 'open-agents': 'ti-robot', 'open-settings': 'ti-settings' };
  return `<div class="chat-actions">${actions.map((a, i) => `
    <button class="chat-action-btn" onclick="chatExecAction(${i},${msgIdx})">
      <i class="ti ${icons[a.type] || 'ti-bolt'}"></i> ${esc(a.label)}
    </button>`).join('')}</div>`;
}

function chatRenderMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  if (!chatState.messages.length) {
    container.innerHTML = `
      <div class="chat-empty">
        <i class="ti ti-message-chatbot"></i>
        <p>Inicia una conversación con la IA configurada.<br>
           Escribe <strong>@nombre-agente</strong> para añadir un agente como contexto.<br>
           Usa los accesos rápidos para empezar.</p>
      </div>`;
    return;
  }

  container.innerHTML = chatState.messages.map((m, idx) => {
    if (m.role === 'user') {
      return `<div class="chat-bubble user">${renderMarkdown(m.content)}</div>`;
    }
    // Parse actions on first render; cache in message object
    if (!m._parsed) {
      const { clean, actions } = chatParseActions(m.content);
      m._clean   = clean;
      m._actions = actions;
      m._parsed  = true;
    }
    return `<div class="chat-bubble assistant">
      ${renderMarkdown(m._clean)}
      ${chatRenderActionBtns(m._actions, idx)}
    </div>`;
  }).join('') + (chatState.loading ? `
    <div class="chat-bubble assistant chat-typing"><span></span><span></span><span></span></div>` : '');

  container.scrollTop = container.scrollHeight;
}

// ── System prompt builder ─────────────────────────────────────────────────────

function chatBuildSystem() {
  let sys = 'Eres un asistente de IA dentro de Agent Hub, una aplicación para gestionar agentes de Claude Code y proyectos de desarrollo. Ayuda a mejorar system prompts, crear nuevos agentes, revisar configuraciones y responder preguntas sobre desarrollo de software.';

  if (chatState.activeAgents.length > 0) {
    sys += '\n\nAgentes activos como contexto:\n\n';
    sys += chatState.activeAgents.map(a =>
      `### @${a.name}\nDescripción: ${a.description || 'Sin descripción'}\n\nSystem prompt:\n${a.system || '(vacío)'}`
    ).join('\n\n---\n\n');
    sys += '\n\nUsa estos agentes como referencia al responder. Puedes sugerir mejoras, detectar problemas o proponer agentes complementarios.';
  }

  sys += `\n\nCuando quieras sugerir una acción concreta en la app, añade al final de tu respuesta en una sola línea:
<!--ACTIONS:[{"type":"create-agent","label":"Crear agente X","data":{"name":"...","description":"...","system":"...","tools":["Read","Write"],"model":"sonnet"}},{"type":"open-agents","label":"Ver agentes"}]-->
Tipos válidos: "create-agent" (con data: {name,description,system,tools,model}), "open-agents", "open-settings". Solo inclúyelo si hay acciones genuinamente útiles.`;

  return sys;
}

// ── Send ──────────────────────────────────────────────────────────────────────

async function chatSend() {
  if (chatState.loading) return;
  const inp = document.getElementById('chat-input');
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) return;

  mentionClose();
  inp.value = '';
  chatAutoResize(inp);

  chatState.messages.push({ role: 'user', content: text });
  chatState.loading = true;
  chatRenderMessages();

  const btn = document.getElementById('chat-send-btn');
  if (btn) btn.disabled = true;

  try {
    const data = await req('POST', '/chat', {
      messages:     chatState.messages,
      systemPrompt: chatBuildSystem(),
    });
    chatState.messages.push({ role: 'assistant', content: data.reply });
    chatSaveHistory();
  } catch (e) {
    chatState.messages.push({ role: 'assistant', content: `⚠️ Error: ${e.message}` });
  } finally {
    chatState.loading = false;
    if (btn) btn.disabled = false;
    chatRenderMessages();
    setTimeout(() => { if (inp) inp.focus(); }, 50);
  }
}

// ── Action execution ──────────────────────────────────────────────────────────

function chatExecAction(actionIdx, msgIdx) {
  const msg    = chatState.messages[msgIdx];
  const action = msg?._actions?.[actionIdx];
  if (!action) return;

  if (action.type === 'create-agent') {
    switchView('agents');
    setTimeout(() => {
      openAgentEditor({
        name:        action.data?.name        || '',
        description: action.data?.description || '',
        system:      action.data?.system      || '',
        tools:       action.data?.tools       || ['Read'],
        model:       action.data?.model       || 'sonnet',
      }, true);
    }, 120);
  } else if (action.type === 'open-agents') {
    switchView('agents');
  } else if (action.type === 'open-settings') {
    switchView('settings');
  }
}

// ── Keyboard & misc ───────────────────────────────────────────────────────────

function chatKeydown(e) {
  if (chatState.mentionQuery !== null) {
    if (e.key === 'ArrowDown') { e.preventDefault(); mentionMoveSelection(1);  return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); mentionMoveSelection(-1); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); mentionSelect(); return; }
    if (e.key === 'Escape')    { mentionClose(); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatSend(); }
}

function chatAutoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function chatInsertQuick(i) {
  const q   = QUICK_PROMPTS[i];
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
  const pid = chatState.projectId || '';
  const url  = pid ? `/chat/history?projectId=${encodeURIComponent(pid)}` : '/chat/history';
  req('DELETE', url).catch(() => {});
  chatRenderMessages();
  const inp = document.getElementById('chat-input');
  if (inp) { inp.value = ''; inp.focus(); }
}
