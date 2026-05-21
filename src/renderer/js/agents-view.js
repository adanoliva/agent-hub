async function loadAgentsForNode() {
  const n = S.selectedNode;
  if (n.level === 'project') {
    S.agents = n.projectId ? await req('GET', `/projects/${n.projectId}/agents`) : [];
  } else {
    const q = new URLSearchParams({level: n.level});
    if (n.categoryId) q.set('categoryId', n.categoryId);
    if (n.techId)     q.set('techId', n.techId);
    S.agents = await req('GET', `/agents?${q}`);
  }
  S.selectedAgent = null;
  S.editorAgent = null;
}

async function loadSuggestions(force = false) {
  const n = S.selectedNode;
  if (n.level === 'project') { S.suggestions = []; return; }
  S.suggestionsLoading = true;
  renderAgentsCenter();
  try {
    const q = new URLSearchParams({level: n.level, force: force ? 'true' : 'false'});
    if (n.categoryId) q.set('categoryId', n.categoryId);
    if (n.techId)     q.set('techId', n.techId);
    S.suggestions = await req('GET', `/ai/suggestions?${q}`);
  } catch(e) {
    S.suggestions = [];
    if (force) toast('No se pudieron generar sugerencias: ' + e.message, 'err');
  }
  S.suggestionsLoading = false;
  renderAgentsCenter();
}

async function refreshSuggestions() {
  const n = S.selectedNode;
  S.suggestionsLoading = true;
  renderAgentsCenter();
  try {
    S.suggestions = await req('POST', '/ai/suggestions/refresh', {
      level: n.level, categoryId: n.categoryId || null, techId: n.techId || null
    });
  } catch(e) { toast('Error: ' + e.message, 'err'); }
  S.suggestionsLoading = false;
  renderAgentsCenter();
}

async function selectTreeNode(level, categoryId, techId, projectId) {
  S.selectedNode = {level, categoryId: categoryId || null, techId: techId || null, projectId: projectId || null};
  S.suggestions = [];
  await loadAgentsForNode();
  renderAgentsTree();
  renderAgentsCenter();
  loadSuggestions();
}

function isNodeActive(level, catId, techId, projId) {
  const n = S.selectedNode;
  return n.level === level && n.categoryId === (catId || null) && n.techId === (techId || null) && n.projectId === (projId || null);
}

function renderAgentsView() {
  const el = document.getElementById('view-agents');
  el.className = 'view active';
  el.innerHTML = `
    <div class="agents-view">
      <div class="agents-tree" id="agents-tree"></div>
      <div class="agents-center" id="agents-center">
        <div class="agents-panel-head">
          <span class="agents-panel-title" id="agents-panel-title">Global</span>
          <div id="agents-panel-btns" style="display:flex;gap:6px"></div>
        </div>
        <div class="agents-content" id="agents-content"></div>
      </div>
      <div class="agent-editor" id="agent-editor" style="display:none"></div>
    </div>`;
  renderAgentsTree();
  renderAgentsCenter();
  document.getElementById('tb-sub').textContent = '';
  document.getElementById('tb-actions').innerHTML = '';
}

function renderAgentsTree() {
  const cats  = S.config?.categories || [];
  const projs = S.projects || [];
  let h = '';

  h += treeItem('global', null, null, null, 'ti-world', 'var(--green)', 'Global', 0);

  const catsOpen = S.treeExpanded.has('cats');
  h += `<div class="tree-node" onclick="toggleTree('cats')" style="margin-top:8px">
    <i class="ti ti-chevron-right tree-chevron ${catsOpen ? 'open' : ''}"></i>
    <span style="font-size:10px;font-weight:600;color:var(--text2);letter-spacing:.08em;text-transform:uppercase">Categorías</span>
  </div>`;
  if (catsOpen) {
    cats.forEach(cat => {
      const catOpen   = S.treeExpanded.has('cat-' + cat.id);
      const catActive = isNodeActive('section', cat.id, null, null);
      h += `<div class="tree-node ${catActive ? 'active' : ''}" onclick="event.stopPropagation();toggleTree('cat-${cat.id}');selectTreeNode('section','${cat.id}',null,null)">
        <div class="tree-indent"></div>
        <i class="ti ti-chevron-right tree-chevron ${catOpen ? 'open' : ''}"></i>
        <i class="ti ${cat.icon || 'ti-folder'} tree-icon" style="color:${cat.color}"></i>
        <span class="tree-label">${esc(cat.name)}</span>
      </div>`;
      if (catOpen) {
        cat.technologies?.forEach(tech => {
          h += treeItem('tech', cat.id, tech.id, null, 'ti-code', cat.color, tech.name, 2);
        });
        if (!cat.technologies?.length) {
          h += `<div class="tree-node" style="padding-left:40px;color:var(--text3);font-size:11px;pointer-events:none">Sin tecnologías</div>`;
        }
      }
    });
  }

  const projsOpen = S.treeExpanded.has('projs');
  h += `<div class="tree-node" onclick="toggleTree('projs')" style="margin-top:8px">
    <i class="ti ti-chevron-right tree-chevron ${projsOpen ? 'open' : ''}"></i>
    <span style="font-size:10px;font-weight:600;color:var(--text2);letter-spacing:.08em;text-transform:uppercase">Proyectos</span>
  </div>`;
  if (projsOpen) {
    projs.forEach(p => {
      const active  = isNodeActive('project', null, null, p.id);
      const pending = p.pendingUpdates || 0;
      h += `<div class="tree-node ${active ? 'active' : ''}" onclick="selectTreeNode('project',null,null,'${p.id}')">
        <div class="tree-indent"></div>
        <i class="ti ti-folder tree-icon" style="color:${catColor(p.categoryId)}"></i>
        <span class="tree-label">${esc(p.name)}</span>
        ${pending > 0 ? `<span class="tree-badge">↑${pending}</span>` : ''}
      </div>`;
    });
    if (!projs.length) {
      h += `<div class="tree-node" style="padding-left:28px;color:var(--text3);font-size:11px;pointer-events:none">Sin proyectos</div>`;
    }
  }

  document.getElementById('agents-tree').innerHTML = h;
}

function treeItem(level, catId, techId, projId, icon, color, label, indent) {
  const active     = isNodeActive(level, catId, techId, projId);
  const indentHtml = Array(indent).fill('<div class="tree-indent"></div>').join('');
  return `<div class="tree-node ${active ? 'active' : ''}" onclick="selectTreeNode('${level}','${catId || ''}','${techId || ''}','${projId || ''}')">
    ${indentHtml}
    <i class="ti ${icon} tree-icon" style="color:${color}"></i>
    <span class="tree-label">${esc(label)}</span>
  </div>`;
}

function toggleTree(key) {
  if (S.treeExpanded.has(key)) S.treeExpanded.delete(key);
  else S.treeExpanded.add(key);
  renderAgentsTree();
}

function renderAgentsCenter() {
  const n       = S.selectedNode;
  const agents  = S.agents || [];
  const suggs   = S.suggestions || [];
  const loading = S.suggestionsLoading;

  let title = 'Global';
  if (n.level === 'section') title = catName(n.categoryId);
  else if (n.level === 'tech') title = `${catName(n.categoryId)} → ${techName(n.categoryId, n.techId)}`;
  else if (n.level === 'project') { const p = S.projects.find(x => x.id === n.projectId); title = p?.name || 'Proyecto'; }
  document.getElementById('agents-panel-title').textContent = title;

  const isProject = n.level === 'project';
  document.getElementById('agents-panel-btns').innerHTML = `
    <button class="btn sm primary" onclick="openNewAgentEditor()"><i class="ti ti-plus"></i> Nuevo agente</button>
    ${!isProject ? `<button class="btn sm" onclick="refreshSuggestions()" ${loading ? 'disabled' : ''}>${loading ? '<div class="spin"></div>' : '<i class="ti ti-refresh"></i>'} Sugerir más</button>` : ''}`;

  const levelColors = {global:'var(--green)', section:'var(--blue)', tech:'var(--amber)', project:'var(--coral)'};
  const iconMap = name => {
    const n = name.toLowerCase();
    if (n.includes('unity'))                              return 'ti-device-gamepad-2';
    if (n.includes('react') || n.includes('frontend'))   return 'ti-brand-react';
    if (n.includes('test'))                               return 'ti-player-play';
    if (n.includes('doc'))                                return 'ti-file-description';
    if (n.includes('git'))                                return 'ti-git-branch';
    if (n.includes('refactor'))                           return 'ti-arrows-exchange';
    if (n.includes('review'))                             return 'ti-eye';
    if (n.includes('db') || n.includes('database') || n.includes('backend')) return 'ti-database';
    if (n.includes('security'))                           return 'ti-shield';
    if (n.includes('mobile'))                             return 'ti-device-mobile';
    if (n.includes('shader') || n.includes('css') || n.includes('design')) return 'ti-palette';
    if (n.includes('perf'))                               return 'ti-bolt';
    if (n.includes('diagram'))                            return 'ti-chart-dots';
    return 'ti-robot';
  };

  const agentCard = (a, suggested = false) => {
    const sel      = !suggested && S.selectedAgent === a.name;
    const ic       = iconMap(a.name);
    const modelCls = `model-${a.model || 'sonnet'}`;
    return `<div class="agent-card ${sel ? 'selected' : ''} ${suggested ? 'suggested' : ''}"
      onclick="${suggested ? `useSuggestion(${JSON.stringify(a).replace(/"/g, '&quot;')})` : `selectAgent('${esc(a.name)}',${suggested})`}">
      <div class="agent-card-head">
        <div class="agent-icon" style="background:var(--bg3)">
          <i class="ti ${ic}" style="color:${suggested ? 'var(--text2)' : levelColors[n.level]}"></i>
        </div>
        <span class="agent-name">${esc(a.name)}</span>
        ${suggested ? `<span class="badge gray" style="font-size:9px">sugerido</span>` : ''}
      </div>
      <div class="agent-desc">${esc(a.description || '')}</div>
      <div class="agent-footer">
        ${(a.tools || []).slice(0, 3).map(t => `<span class="tool-pill">${t}</span>`).join('')}
        ${(a.tools || []).length > 3 ? `<span style="font-size:10px;color:var(--text3)">+${(a.tools || []).length - 3}</span>` : ''}
        <span class="tool-pill ${modelCls}" style="margin-left:auto">${a.model || 'sonnet'}</span>
      </div>
    </div>`;
  };

  let content = `<div class="agents-grid">
    ${agents.map(a => agentCard(a)).join('')}
    ${!isProject && !loading ? suggs.map(s => agentCard(s, true)).join('') : ''}
    ${!isProject && loading ? `<div style="display:flex;align-items:center;gap:8px;color:var(--text2);font-size:12px;grid-column:1/-1"><div class="spin"></div>Generando sugerencias…</div>` : ''}
  </div>`;

  if (!agents.length && !loading && !suggs.length) {
    content = `<div style="display:flex;flex-direction:column;align-items:center;padding:60px;gap:10px;color:var(--text2)">
      <i class="ti ti-robot" style="font-size:40px;opacity:.2"></i>
      <div style="font-size:13px;color:var(--text1)">Sin agentes en este nivel</div>
      <div style="font-size:12px">Crea el primero o espera las sugerencias de IA</div>
    </div>`;
  }

  document.getElementById('agents-content').innerHTML = content;
}

function selectAgent(name, isSuggested) {
  if (isSuggested) return;
  S.selectedAgent = name;
  const agent = S.agents.find(a => a.name === name);
  if (agent) openAgentEditor(agent, false);
  else renderAgentsCenter();
}

function useSuggestion(agent) {
  openAgentEditor(agent, true);
}

function openNewAgentEditor() {
  openAgentEditor({name:'', description:'', tools:['Read'], model:'sonnet', system:''}, true);
}

function openAgentEditor(agent, isNew) {
  S.editorAgent  = {...agent};
  S.editorIsNew  = isNew;
  S.editorDirty  = false;
  renderAgentEditor();
  document.getElementById('agent-editor').style.display = 'flex';
}

function renderAgentEditor() {
  const a    = S.editorAgent;
  if (!a) return;
  const n    = S.selectedNode;
  const isNew = S.editorIsNew;
  const tools = a.tools || [];

  const levelPath = (() => {
    if (n.level === 'global')  return '~/.claude-manager/agents/global/';
    if (n.level === 'section') return `~/.claude-manager/agents/section-${n.categoryId}/`;
    if (n.level === 'tech')    return `~/.claude-manager/agents/tech-${n.categoryId}-${n.techId}/`;
    const p = S.projects.find(x => x.id === n.projectId);
    return p ? `${p.path}\\.claude\\agents\\` : '';
  })();

  document.getElementById('agent-editor').innerHTML = `
    <div class="editor-head">
      <div style="flex:1">
        <div class="editor-title">${isNew ? 'Nuevo agente' : esc(a.name)}</div>
        <div class="editor-sub">${esc(levelPath)}</div>
      </div>
      <button class="btn ghost sm" onclick="closeAgentEditor()"><i class="ti ti-x"></i></button>
    </div>
    <div class="editor-body" id="editor-body">
      <div class="field"><label>Nombre</label>
        <input id="ea-name" value="${esc(a.name)}" placeholder="nombre-del-agente" style="font-family:var(--mono)"
          oninput="S.editorAgent.name=this.value;S.editorDirty=true"/>
      </div>
      <div class="field"><label>Descripción</label>
        <input id="ea-desc" value="${esc(a.description || '')}" placeholder="Breve descripción…"
          oninput="S.editorAgent.description=this.value;S.editorDirty=true"/>
      </div>
      <div class="field"><label>Modelo</label>
        <select id="ea-model" onchange="S.editorAgent.model=this.value;S.editorDirty=true">
          ${['haiku','sonnet','opus'].map(m => `<option value="${m}" ${a.model === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Herramientas</label>
        <div class="tools-grid">
          ${ALL_TOOLS.map(t => `<label class="tool-check">
            <input type="checkbox" ${tools.includes(t) ? 'checked' : ''} onchange="toggleTool('${t}',this.checked)"/>
            ${t}
          </label>`).join('')}
        </div>
      </div>

      <div class="field"><label>Generar con IA</label>
        <div class="ai-gen-area">
          <div class="ai-gen-row">
            <input class="ai-gen-input" id="ea-ai-desc" placeholder="Describe el agente en una frase…"/>
            <div class="lang-toggle">
              <button class="lang-btn ${S.editorLang === 'es' ? 'active' : ''}" onclick="S.editorLang='es';renderAgentEditor()">ES</button>
              <button class="lang-btn ${S.editorLang === 'en' ? 'active' : ''}" onclick="S.editorLang='en';renderAgentEditor()">EN</button>
            </div>
          </div>
          <button class="btn sm primary" id="ea-gen-btn" onclick="generateSystemPrompt()" style="width:100%">
            <i class="ti ti-sparkles"></i> Generar system prompt
          </button>
        </div>
      </div>

      <div class="field"><label>System prompt</label>
        <textarea id="ea-system" rows="8"
          oninput="S.editorAgent.system=this.value;S.editorDirty=true">${esc(a.system || '')}</textarea>
      </div>
    </div>
    <div class="editor-foot">
      ${!isNew ? `<button class="btn danger sm" onclick="deleteCurrentAgent()"><i class="ti ti-trash"></i></button>` : ''}
      <button class="btn primary" style="flex:1" onclick="saveCurrentAgent()"><i class="ti ti-device-floppy"></i> Guardar</button>
    </div>`;
}

function closeAgentEditor() {
  S.editorAgent   = null;
  S.selectedAgent = null;
  document.getElementById('agent-editor').style.display = 'none';
  renderAgentsCenter();
}

function toggleTool(tool, checked) {
  const tools = S.editorAgent.tools || [];
  if (checked && !tools.includes(tool)) tools.push(tool);
  if (!checked) S.editorAgent.tools = tools.filter(t => t !== tool);
  else S.editorAgent.tools = tools;
  S.editorDirty = true;
}

async function generateSystemPrompt() {
  const desc = document.getElementById('ea-ai-desc')?.value?.trim();
  if (!desc) { toast('Escribe una descripción primero', 'err'); return; }
  const btn = document.getElementById('ea-gen-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spin"></div> Generando…';
  try {
    const n = S.selectedNode;
    const existing = S.agents.map(a => a.name);
    const r = await req('POST', '/ai/generate-prompt', {
      description: desc,
      name: S.editorAgent.name || 'agent',
      level: n.level,
      categoryId: n.categoryId,
      techId: n.techId,
      tools: S.editorAgent.tools || [],
      language: S.editorLang,
      existingAgents: existing,
    });
    S.editorAgent.system = r.system;
    S.editorDirty = true;
    document.getElementById('ea-system').value = r.system;
    toast('System prompt generado');
  } catch(e) { toast(e.message, 'err'); }
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-sparkles"></i> Generar system prompt';
}

async function saveCurrentAgent() {
  const a = S.editorAgent;
  if (!a) return;
  if (!a.name?.trim()) { toast('El agente necesita un nombre', 'err'); return; }
  const n       = S.selectedNode;
  const oldName = S.editorIsNew ? a.name : (S.selectedAgent || a.name);
  try {
    if (n.level === 'project') {
      await req(S.editorIsNew ? 'POST' : 'PUT', `/projects/${n.projectId}/agents`,
        S.editorIsNew ? {agent: a} : {oldName, agent: a});
    } else {
      await req(S.editorIsNew ? 'POST' : 'PUT', '/agents',
        S.editorIsNew
          ? {level: n.level, categoryId: n.categoryId, techId: n.techId, agent: a}
          : {level: n.level, categoryId: n.categoryId, techId: n.techId, oldName, agent: a});
    }
    toast(`Agente "${a.name}" guardado`);
    S.editorIsNew   = false;
    S.editorDirty   = false;
    S.selectedAgent = a.name;
    await loadAgentsForNode();
    renderAgentsCenter();
    renderAgentEditor();
  } catch(e) { toast(e.message, 'err'); }
}

async function deleteCurrentAgent() {
  const a = S.editorAgent;
  if (!a || !a.name) return;
  if (!confirm(`¿Eliminar el agente "${a.name}"? Esta acción elimina el fichero .md.`)) return;
  const n = S.selectedNode;
  try {
    if (n.level === 'project') {
      await req('DELETE', `/projects/${n.projectId}/agents/${a.name}`);
    } else {
      await req('DELETE', '/agents', {level: n.level, categoryId: n.categoryId, techId: n.techId, name: a.name});
    }
    toast(`Agente "${a.name}" eliminado`);
    closeAgentEditor();
    await loadAgentsForNode();
    renderAgentsCenter();
  } catch(e) { toast(e.message, 'err'); }
}
