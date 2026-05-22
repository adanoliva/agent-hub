async function renderSettingsView() {
  let aiStatus = {provider:'cli', ready:false};
  try { aiStatus = await req('GET', '/ai/status'); } catch {}

  const cats = S.config?.categories || [];
  if (!S.settingsTab) S.settingsTab = 'general';
  document.getElementById('tb-actions').innerHTML = '';
  document.getElementById('tb-sub').textContent = '';

  let h = `<div class="settings-view">
  <div class="drawer-tabs" style="margin:-32px -32px 24px;padding-left:32px">
    <div class="drawer-tab ${S.settingsTab === 'general' ? 'active' : ''}" onclick="setSettingsTab('general')">General</div>
    <div class="drawer-tab ${S.settingsTab === 'cats' ? 'active' : ''}" onclick="setSettingsTab('cats')">Categorías</div>
    <div class="drawer-tab ${S.settingsTab === 'ext-agents' ? 'active' : ''}" onclick="setSettingsTab('ext-agents')">Agentes externos</div>
  </div>`;

  if (S.settingsTab === 'general') {
    h += `<div class="settings-section">
    <div class="settings-head">Proveedor de IA</div>

    <div class="provider-option ${S.config?.aiProvider === 'cli' ? 'selected' : ''}" onclick="selectProvider('cli')">
      <div class="provider-option-head">
        <div class="provider-radio ${S.config?.aiProvider === 'cli' ? 'on' : ''}"></div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:var(--text0);margin-bottom:2px;display:flex;align-items:center;gap:8px">
            Claude CLI
            ${aiStatus.provider === 'cli' && aiStatus.ready ? `<span class="badge green">✓ detectado</span>` : `<span class="badge gray">no detectado</span>`}
          </div>
          <div style="font-size:11px;color:var(--text1)">Usa tu suscripción de Claude.ai. Sin coste adicional.</div>
        </div>
      </div>
      ${S.config?.aiProvider === 'cli' && !aiStatus.ready ? `
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);display:flex;gap:8px">
          <button class="btn sm" onclick="event.stopPropagation();openCLIInstall()"><i class="ti ti-download"></i> Instalar CLI</button>
          <button class="btn sm" onclick="event.stopPropagation();recheckCLI()"><i class="ti ti-refresh"></i> Recomprobar</button>
        </div>` : ''}
    </div>

    <div class="provider-option ${S.config?.aiProvider === 'github' ? 'selected' : ''}" onclick="selectProvider('github')">
      <div class="provider-option-head">
        <div class="provider-radio ${S.config?.aiProvider === 'github' ? 'on' : ''}"></div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:var(--text0);margin-bottom:2px;display:flex;align-items:center;gap:8px">
            GitHub Copilot <span class="badge blue">Models API</span>
            ${aiStatus.provider === 'github' && aiStatus.ready ? `<span class="badge green">✓ listo</span>` : ''}
          </div>
          <div style="font-size:11px;color:var(--text1)">Token de GitHub con permiso <code style="font-family:var(--mono);font-size:10px;background:var(--bg3);padding:1px 4px;border-radius:3px">models:read</code>. Capa gratuita disponible.</div>
        </div>
      </div>
      ${S.config?.aiProvider === 'github' ? `
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:10px">
          <div class="field" style="margin-bottom:0">
            <label>GitHub Personal Access Token</label>
            <div style="display:flex;gap:6px">
              <input id="settings-ghtoken" type="password" value="${esc(S.config?.githubToken || '')}" placeholder="ghp_…" onclick="event.stopPropagation()" style="flex:1;font-family:var(--mono)"/>
              <button class="btn sm" onclick="event.stopPropagation();saveGitHubSettings()"><i class="ti ti-device-floppy"></i></button>
            </div>
            <div class="hint">github.com → Settings → Developer settings → Personal access tokens → Fine-grained → Models: Read</div>
          </div>
          <div class="field" style="margin-bottom:0">
            <label>Modelo</label>
            <select id="settings-ghmodel" onclick="event.stopPropagation()" onchange="saveGitHubSettings()">
              <option value="gpt-4o-mini" ${(S.config?.githubModel || 'gpt-4o-mini') === 'gpt-4o-mini' ? 'selected' : ''}>gpt-4o-mini — rápido, gratuito</option>
              <option value="gpt-4o" ${S.config?.githubModel === 'gpt-4o' ? 'selected' : ''}>gpt-4o — potente</option>
              <option value="o1-mini" ${S.config?.githubModel === 'o1-mini' ? 'selected' : ''}>o1-mini — razonamiento</option>
            </select>
          </div>
        </div>` : ''}
    </div>

    <div class="provider-option ${S.config?.aiProvider === 'api' ? 'selected' : ''}" onclick="selectProvider('api')">
      <div class="provider-option-head">
        <div class="provider-radio ${S.config?.aiProvider === 'api' ? 'on' : ''}"></div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:var(--text0);margin-bottom:2px">API key de Anthropic</div>
          <div style="font-size:11px;color:var(--text1)">Requiere cuenta en console.anthropic.com</div>
        </div>
      </div>
      ${S.config?.aiProvider === 'api' ? `
        <div style="margin-top:12px">
          <div class="field" style="margin-bottom:0">
            <label>API key</label>
            <div style="display:flex;gap:6px">
              <input id="settings-apikey" type="password" value="${esc(S.config?.apiKey || '')}" placeholder="sk-ant-api03-…" onclick="event.stopPropagation()" style="flex:1;font-family:var(--mono)"/>
              <button class="btn sm" onclick="event.stopPropagation();saveAPIKey()"><i class="ti ti-device-floppy"></i></button>
            </div>
          </div>
        </div>` : ''}
    </div>
  </div>`;

    const isGitHub = S.config?.aiProvider === 'github';
    h += `<div class="settings-section">
    <div class="settings-head">Cómo usar los agentes en VS Code</div>
    <div style="display:flex;flex-direction:column;gap:8px">` +

    (isGitHub ? `
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:13px 15px">
        <div style="font-size:11px;font-weight:600;color:var(--text2);font-family:var(--mono);margin-bottom:8px">ABRIR EL CHAT DE COPILOT</div>
        <div style="font-size:11px;color:var(--text1)">En VS Code abre el panel de <strong>GitHub Copilot Chat</strong> con <code style="font-family:var(--mono);font-size:10px;background:var(--bg3);padding:1px 4px;border-radius:3px">Ctrl+Alt+I</code> o desde el icono de Copilot en la barra lateral.</div>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:13px 15px">
        <div style="font-size:11px;font-weight:600;color:var(--text2);font-family:var(--mono);margin-bottom:8px">SELECCIONAR UN AGENTE</div>
        <div style="font-family:var(--mono);font-size:12px;background:var(--bg1);padding:8px 12px;border-radius:6px;color:var(--accent);margin-bottom:6px">@</div>
        <div style="font-size:11px;color:var(--text1);margin-bottom:8px">Escribe <code style="font-family:var(--mono);font-size:10px;background:var(--bg3);padding:1px 4px;border-radius:3px">@</code> en el chat para ver el listado de agentes disponibles. Copilot muestra los agentes del proyecto (<code style="font-family:var(--mono);font-size:10px;background:var(--bg3);padding:1px 4px;border-radius:3px">.github/agents/</code>) junto con las instrucciones base (<code style="font-family:var(--mono);font-size:10px;background:var(--bg3);padding:1px 4px;border-radius:3px">copilot-instructions.md</code>).</div>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:13px 15px">
        <div style="font-size:11px;font-weight:600;color:var(--text2);font-family:var(--mono);margin-bottom:8px">INVOCAR UN AGENTE</div>
        <div style="font-family:var(--mono);font-size:12px;background:var(--bg1);padding:8px 12px;border-radius:6px;color:var(--green);margin-bottom:6px">@unity-dev crea un sistema de inventario con ScriptableObjects</div>
        <div style="font-family:var(--mono);font-size:12px;background:var(--bg1);padding:8px 12px;border-radius:6px;color:var(--green);margin-bottom:6px">@code-reviewer revisa PlayerController.cs</div>
        <div style="font-size:11px;color:var(--text1)">Usa <code style="font-family:var(--mono);font-size:10px;background:var(--bg3);padding:1px 4px;border-radius:3px">@nombre-del-agente</code> seguido de la tarea. Copilot carga el system prompt del agente definido en su archivo <code style="font-family:var(--mono);font-size:10px;background:var(--bg3);padding:1px 4px;border-radius:3px">.md</code>.</div>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:13px 15px">
        <div style="font-size:11px;font-weight:600;color:var(--text2);font-family:var(--mono);margin-bottom:8px">AÑADIR CONTEXTO DE ARCHIVOS</div>
        <div style="font-family:var(--mono);font-size:12px;background:var(--bg1);padding:8px 12px;border-radius:6px;color:var(--green);margin-bottom:6px">@unity-dev #PlayerController.cs añade doble salto</div>
        <div style="font-size:11px;color:var(--text1)">Usa <code style="font-family:var(--mono);font-size:10px;background:var(--bg3);padding:1px 4px;border-radius:3px">#archivo</code> para adjuntar ficheros como contexto. También puedes arrastrar archivos directamente al chat o usar <code style="font-family:var(--mono);font-size:10px;background:var(--bg3);padding:1px 4px;border-radius:3px">#codebase</code> para el proyecto completo.</div>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:13px 15px">
        <div style="font-size:11px;font-weight:600;color:var(--text2);font-family:var(--mono);margin-bottom:8px">DÓNDE VIVEN LOS AGENTES</div>
        <div style="display:flex;flex-direction:column;gap:5px">
          <div style="display:flex;gap:8px;align-items:flex-start">
            <span style="font-family:var(--mono);background:var(--amber-dim);color:var(--amber);padding:2px 7px;border-radius:4px;font-size:10px;flex-shrink:0">proyecto</span>
            <span style="color:var(--text1);font-family:var(--mono);font-size:10px">{proyecto}/.github/agents/ — agentes del proyecto</span>
          </div>
          <div style="display:flex;gap:8px;align-items:flex-start">
            <span style="font-family:var(--mono);background:var(--blue-dim);color:var(--blue);padding:2px 7px;border-radius:4px;font-size:10px;flex-shrink:0">contexto</span>
            <span style="color:var(--text1);font-family:var(--mono);font-size:10px">{proyecto}/.github/copilot-instructions.md — instrucciones base</span>
          </div>
        </div>
      </div>` :

    `
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:13px 15px">
        <div style="font-size:11px;font-weight:600;color:var(--text2);font-family:var(--mono);margin-bottom:8px">VER AGENTES DISPONIBLES</div>
        <div style="font-family:var(--mono);font-size:12px;background:var(--bg1);padding:8px 12px;border-radius:6px;color:var(--accent);margin-bottom:6px">/agents</div>
        <div style="font-size:11px;color:var(--text1)">Lista todos los agentes activos del proyecto y los globales de <code style="font-family:var(--mono);font-size:10px;background:var(--bg3);padding:1px 4px;border-radius:3px">~/.claude/agents/</code></div>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:13px 15px">
        <div style="font-size:11px;font-weight:600;color:var(--text2);font-family:var(--mono);margin-bottom:8px">INVOCAR UN AGENTE</div>
        <div style="font-family:var(--mono);font-size:12px;background:var(--bg1);padding:8px 12px;border-radius:6px;color:var(--green);margin-bottom:6px">@unity-dev crea un sistema de inventario con ScriptableObjects</div>
        <div style="font-family:var(--mono);font-size:12px;background:var(--bg1);padding:8px 12px;border-radius:6px;color:var(--green);margin-bottom:6px">@code-reviewer revisa PlayerController.cs</div>
        <div style="font-size:11px;color:var(--text1)">Usa <code style="font-family:var(--mono);font-size:10px;background:var(--bg3);padding:1px 4px;border-radius:3px">@nombre-del-agente</code> seguido de la tarea. Claude Code carga el system prompt del agente automáticamente.</div>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:13px 15px">
        <div style="font-size:11px;font-weight:600;color:var(--text2);font-family:var(--mono);margin-bottom:8px">DELEGACIÓN AUTOMÁTICA</div>
        <div style="font-size:11px;color:var(--text1)">Si describes una tarea sin <code style="font-family:var(--mono);font-size:10px;background:var(--bg3);padding:1px 4px;border-radius:3px">@</code>, Claude Code puede elegir el agente más apropiado por su cuenta basándose en el campo <strong>description</strong> de cada agente. Por eso es importante que las descripciones sean precisas.</div>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:13px 15px">
        <div style="font-size:11px;font-weight:600;color:var(--text2);font-family:var(--mono);margin-bottom:8px">DÓNDE VIVEN LOS AGENTES</div>
        <div style="display:flex;flex-direction:column;gap:5px">
          <div style="display:flex;gap:8px;align-items:flex-start">
            <span style="font-family:var(--mono);background:var(--green-dim);color:var(--green);padding:2px 7px;border-radius:4px;font-size:10px;flex-shrink:0">global</span>
            <span style="color:var(--text1);font-family:var(--mono);font-size:10px">~/.claude/agents/ — disponibles en cualquier proyecto</span>
          </div>
          <div style="display:flex;gap:8px;align-items:flex-start">
            <span style="font-family:var(--mono);background:var(--amber-dim);color:var(--amber);padding:2px 7px;border-radius:4px;font-size:10px;flex-shrink:0">proyecto</span>
            <span style="color:var(--text1);font-family:var(--mono);font-size:10px">{proyecto}/.claude/agents/ — solo en ese proyecto</span>
          </div>
        </div>
      </div>`)

    + `</div>
  </div>`;

    h += `<div class="settings-section">
    <div class="settings-head">Actualizaciones</div>
    <div style="display:flex;align-items:center;gap:12px">
      <div style="flex:1;font-size:12px;color:var(--text2)" id="update-settings-status">Versión actual: v${S.appVersion || '—'}</div>
      <button class="btn sm" onclick="checkUpdateManual()"><i class="ti ti-refresh"></i> Buscar actualizaciones</button>
    </div>
  </div>`;

  }

  if (S.settingsTab === 'cats') {
    h += `<div class="settings-section">
    <div class="settings-head">Categorías y tecnologías</div>
    ${cats.map(cat => `
      <div class="cat-item">
        <div class="cat-item-head">
          <div class="cat-dot" style="background:${cat.color}"></div>
          <span class="cat-item-name">${esc(cat.name)}</span>
          <button class="btn ghost sm" onclick="openAddTech('${cat.id}','${esc(cat.name)}')"><i class="ti ti-plus"></i> Tech</button>
          <button class="btn ghost sm danger" onclick="deleteCat('${cat.id}')"><i class="ti ti-trash"></i></button>
        </div>
        <div class="tech-pills">
          ${(cat.technologies || []).map(t => `
            <span class="tech-pill">
              ${esc(t.name)}
              <span class="del" onclick="deleteTech('${cat.id}','${t.id}')" title="Eliminar"><i class="ti ti-x"></i></span>
            </span>`).join('')}
          ${!(cat.technologies || []).length ? `<span style="font-size:11px;color:var(--text3)">Sin tecnologías</span>` : ''}
        </div>
      </div>`).join('')}
    <button class="btn sm" onclick="openAddCategory()" style="margin-top:8px"><i class="ti ti-plus"></i> Nueva categoría</button>
  </div>`;
  }

  if (S.settingsTab === 'ext-agents') {
    h += `<div class="settings-section">
    <div class="settings-head">Importar agente externo</div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:16px">Introduce la URL de un archivo de agente (<code style="font-family:var(--mono);font-size:10px;background:var(--bg3);padding:1px 4px;border-radius:3px">.md</code> con frontmatter). Agent Hub lo descargará, lo mostrará para revisión y lo guardará como un agente real en la categoría que elijas.</div>
    <div style="display:flex;gap:8px;align-items:flex-end">
      <div class="field" style="flex:1;margin-bottom:0">
        <label>URL del agente</label>
        <input id="import-agent-url" placeholder="https://ejemplo.com/mi-agente.md" style="font-family:var(--mono);font-size:12px"/>
      </div>
      <button class="btn" onclick="importAgentFromUrl()" style="flex-shrink:0;margin-bottom:0"><i class="ti ti-download"></i> Importar</button>
    </div>
    <div id="import-agent-status" style="margin-top:10px;font-size:12px;color:var(--text2)"></div>
  </div>`;
  }

  h += '</div>';
  document.getElementById('view-settings').innerHTML = h;
}

async function selectProvider(p) {
  S.config.aiProvider = p;
  await req('PUT', '/config', {aiProvider: p});
  renderSettingsView();
}

async function saveAPIKey() {
  const key = document.getElementById('settings-apikey')?.value?.trim();
  if (!key) return;
  await req('PUT', '/config', {apiKey: key});
  S.config.apiKey = key;
  toast('API key guardada');
}

async function saveGitHubSettings() {
  const token = document.getElementById('settings-ghtoken')?.value?.trim();
  const model = document.getElementById('settings-ghmodel')?.value || 'gpt-4o-mini';
  const body  = {githubModel: model};
  if (token) body.githubToken = token;
  await req('PUT', '/config', body);
  if (S.config) { if (token) S.config.githubToken = token; S.config.githubModel = model; }
  if (token) toast('GitHub token y modelo guardados');
  else toast('Modelo guardado');
}

async function recheckCLI() {
  const r = await req('GET', '/detect-cli');
  if (r.found) toast('Claude CLI detectado');
  else toast('CLI no encontrado. Instala Claude Code.', 'err');
  renderSettingsView();
}

function openCLIInstall() {
  if (window.api) window.api.openExternal('https://claude.ai/code');
  else window.open('https://claude.ai/code', '_blank');
}

async function openAddCategory() {
  showModal('Nueva categoría', '', `
    <div class="field"><label>ID (único, sin espacios)</label><input id="nc-id" placeholder="data-science"/></div>
    <div class="field"><label>Nombre</label><input id="nc-name" placeholder="Data Science"/></div>
    <div class="field"><label>Color (hex)</label><input id="nc-color" value="#7c6af7" type="color" style="height:36px;padding:2px"/></div>
  `, async () => {
    const id    = document.getElementById('nc-id')?.value?.trim().toLowerCase().replace(/\s+/g, '-');
    const name  = document.getElementById('nc-name')?.value?.trim();
    const color = document.getElementById('nc-color')?.value;
    if (!id || !name) { toast('Rellena ID y nombre', 'err'); return false; }
    try {
      await req('POST', '/categories', {id, name, color, technologies: []});
      S.config = await req('GET', '/config');
      toast(`Categoría "${name}" creada`);
      renderSettingsView();
    } catch(e) { toast(e.message, 'err'); return false; }
  });
}

async function openAddTech(catId, catName) {
  showModal(`Nueva tecnología en ${catName}`, '', `
    <div class="field"><label>ID (único dentro de la categoría)</label><input id="nt-id" placeholder="python"/></div>
    <div class="field"><label>Nombre</label><input id="nt-name" placeholder="Python"/></div>
  `, async () => {
    const id   = document.getElementById('nt-id')?.value?.trim().toLowerCase().replace(/\s+/g, '-');
    const name = document.getElementById('nt-name')?.value?.trim();
    if (!id || !name) { toast('Rellena ID y nombre', 'err'); return false; }
    try {
      await req('POST', `/categories/${catId}/technologies`, {id, name});
      S.config = await req('GET', '/config');
      toast(`Tecnología "${name}" añadida`);
      renderSettingsView();
    } catch(e) { toast(e.message, 'err'); return false; }
  });
}

async function deleteCat(id) {
  if (!confirm('¿Eliminar esta categoría? Los agentes de sus carpetas no se borran del disco.')) return;
  await req('DELETE', `/categories/${id}`);
  S.config = await req('GET', '/config');
  toast('Categoría eliminada'); renderSettingsView();
}

async function deleteTech(catId, techId) {
  if (!confirm('¿Eliminar esta tecnología?')) return;
  await req('DELETE', `/categories/${catId}/technologies/${techId}`);
  S.config = await req('GET', '/config');
  toast('Tecnología eliminada'); renderSettingsView();
}

function setSettingsTab(tab) { S.settingsTab = tab; renderSettingsView(); }

async function checkUpdateManual() {
  const el = document.getElementById('update-settings-status');
  if (el) el.textContent = 'Buscando…';
  if (!window.api?.checkForUpdate) {
    if (el) el.textContent = 'Auto-update solo disponible en la versión empaquetada.';
    return;
  }
  const result = await window.api.checkForUpdate();
  if (result?.error) {
    if (el) el.textContent = 'Error: ' + result.error;
    toast('Error: ' + result.error, 'err');
  } else {
    if (el) el.textContent = 'Comprobando… (el banner aparecerá si hay nueva versión)';
  }
}

async function importAgentFromUrl() {
  const url    = document.getElementById('import-agent-url')?.value?.trim();
  if (!url) { toast('Introduce una URL', 'err'); return; }
  const status = document.getElementById('import-agent-status');
  if (status) status.textContent = 'Descargando…';
  try {
    const {agent} = await req('POST', '/agents/import-url', {url});
    if (status) status.textContent = '';
    _showImportAgentModal(agent);
  } catch(e) {
    if (status) status.textContent = '';
    toast(e.message || 'Error al importar el agente', 'err');
  }
}

function _showImportAgentModal(agent) {
  const cats = S.config?.categories || [];
  const IMPORT_TOOLS = ['Bash','Read','Write','Edit','Grep','Glob','WebFetch','WebSearch','MultiEdit','TodoRead','TodoWrite'];
  const MODEL_OPTS = ['sonnet','haiku','opus'].map(m =>
    `<option value="${m}" ${agent.model === m ? 'selected' : ''}>${m}</option>`
  ).join('');
  const toolChecks = IMPORT_TOOLS.map(t =>
    `<label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;margin:2px 6px 2px 0;cursor:pointer">
      <input type="checkbox" value="${t}" ${(agent.tools || []).includes(t) ? 'checked' : ''}> ${t}
    </label>`
  ).join('');

  let catOptions = `<option value="global">Global (disponible en todos los proyectos)</option>`;
  for (const cat of cats) {
    catOptions += `<option value="section:${cat.id}">Sección: ${esc(cat.name)}</option>`;
    for (const tech of (cat.technologies || [])) {
      catOptions += `<option value="tech:${cat.id}:${tech.id}">Tech: ${esc(cat.name)} › ${esc(tech.name)}</option>`;
    }
  }

  showModal('Revisar e importar agente', '', `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="field" style="margin-bottom:0"><label>Nombre</label>
        <input id="ia-name" value="${esc(agent.name || '')}"/>
      </div>
      <div class="field" style="margin-bottom:0"><label>Descripción</label>
        <input id="ia-desc" value="${esc(agent.description || '')}"/>
      </div>
      <div class="field" style="margin-bottom:0"><label>Modelo</label>
        <select id="ia-model">${MODEL_OPTS}</select>
      </div>
      <div class="field" style="margin-bottom:0"><label>Herramientas</label>
        <div style="background:var(--bg1);border:1px solid var(--border);border-radius:6px;padding:8px">${toolChecks}</div>
      </div>
      <div class="field" style="margin-bottom:0"><label>System prompt</label>
        <textarea id="ia-system" rows="6" style="font-family:var(--mono);font-size:11px;resize:vertical">${esc(agent.system || '')}</textarea>
      </div>
      <div class="field" style="margin-bottom:0"><label>Guardar en</label>
        <select id="ia-dest">${catOptions}</select>
      </div>
    </div>
  `, async () => {
    const name   = document.getElementById('ia-name')?.value?.trim();
    const desc   = document.getElementById('ia-desc')?.value?.trim();
    const model  = document.getElementById('ia-model')?.value;
    const system = document.getElementById('ia-system')?.value?.trim();
    const dest   = document.getElementById('ia-dest')?.value;
    const tools  = [...document.querySelectorAll('.modal-body input[type=checkbox][value]')].filter(cb => cb.checked).map(cb => cb.value);

    if (!name) { toast('El nombre es obligatorio', 'err'); return false; }

    let level = 'global', categoryId = undefined, techId = undefined;
    if (dest === 'global') { level = 'global'; }
    else if (dest.startsWith('tech:'))    { const [,c,t] = dest.split(':'); level = 'tech';    categoryId = c; techId = t; }
    else if (dest.startsWith('section:')) { const [,c]   = dest.split(':'); level = 'section'; categoryId = c; }

    try {
      await req('POST', '/agents', {level, categoryId, techId, agent: {name, description:desc, model, tools, system}});
      toast(`Agente "${name}" importado`);
      S.agents = null;
      if (window._reloadAgentsView) window._reloadAgentsView();
    } catch(e) { toast(e.message, 'err'); return false; }
  });

  requestAnimationFrame(() => {
    const boxes = document.querySelectorAll('.modal-body input[type=checkbox][value]');
    boxes.forEach(cb => { if ((agent.tools || []).includes(cb.value)) cb.checked = true; });
  });
}
