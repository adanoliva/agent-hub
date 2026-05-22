async function loadProjects() {
  S.projects = await req('GET', '/projects');
}

function renderProjectsView() {
  const cats = S.config?.categories || [];
  const tb = document.getElementById('tb-actions');
  tb.innerHTML = `
    <button class="btn primary sm" onclick="openCreateProject()"><i class="ti ti-plus"></i> Nuevo proyecto</button>
    <button class="btn sm" onclick="openImportProject()"><i class="ti ti-folder-plus"></i> Importar</button>
    <button class="btn sm" onclick="syncAllProjects()" title="Sync todos los proyectos"><i class="ti ti-refresh"></i> Sync todos</button>`;

  document.getElementById('tb-sub').textContent = `${S.projects.length} proyecto${S.projects.length !== 1 ? 's' : ''}`;

  let html = '<div class="projects-view">';
  const empty = S.projects.length === 0;

  if (empty) {
    html += `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:60vh;gap:12px;color:var(--text2)">
      <i class="ti ti-folder-open" style="font-size:48px;opacity:.2"></i>
      <div style="font-size:14px;color:var(--text1)">Sin proyectos todavía</div>
      <div style="font-size:12px;text-align:center;max-width:300px">Crea tu primer proyecto o importa uno existente con los botones de arriba.</div>
    </div>`;
  } else {
    cats.forEach(cat => {
      const projs = S.projects.filter(p => p.categoryId === cat.id);
      if (!projs.length) return;
      html += `<div class="cat-section">
        <div class="cat-header">
          <div class="cat-dot" style="background:${cat.color}"></div>
          <span class="cat-name">${cat.name}</span>
          <span class="cat-count">${projs.length}</span>
        </div>
        <div class="projects-grid">
          ${projs.map(p => projectCard(p)).join('')}
        </div>
      </div>`;
    });
    const knownCats = new Set(cats.map(c => c.id));
    const uncats = S.projects.filter(p => !knownCats.has(p.categoryId));
    if (uncats.length) {
      html += `<div class="cat-section">
        <div class="cat-header"><div class="cat-dot" style="background:#888"></div><span class="cat-name">Sin categoría</span></div>
        <div class="projects-grid">${uncats.map(p => projectCard(p)).join('')}</div>
      </div>`;
    }
  }
  html += '</div>';
  document.getElementById('view-projects').innerHTML = html;
}

const PROVIDER_ICONS = {
  claude: '<i class="ti ti-robot"></i>Claude',
  github: '<i class="ti ti-brand-github"></i>Copilot',
  both:   '<i class="ti ti-git-merge"></i>Ambos',
};

const STATUS_BADGE = {
  active:   `<span class="badge green"><i class="ti ti-circle-check"></i>activo</span>`,
  paused:   `<span class="badge amber"><i class="ti ti-player-pause"></i>pausado</span>`,
  archived: `<span class="badge gray"><i class="ti ti-archive"></i>archivado</span>`,
};

function projectCard(p) {
  const pending  = p.pendingUpdates || 0;
  const exists   = p.pathExists !== false;
  const provIcon = PROVIDER_ICONS[p.aiProvider || 'claude'] || PROVIDER_ICONS.claude;
  return `<div class="proj-card" onclick="openProjectDrawer('${p.id}')">
    <div class="proj-card-head">
      <div class="proj-card-name">${esc(p.name)}</div>
      ${pending > 0 ? `<span class="proj-pending"><i class="ti ti-refresh"></i>${pending}</span>` : ''}
    </div>
    <div class="proj-card-meta">
      ${p.techId ? `<span class="badge blue"><i class="ti ti-code"></i>${esc(techName(p.categoryId, p.techId))}</span>` : `<span class="badge gray"><i class="ti ti-folder"></i>${esc(catName(p.categoryId))}</span>`}
      ${STATUS_BADGE[p.status] || STATUS_BADGE.active}
      <span class="badge gray">${provIcon}</span>
      ${!exists ? `<span class="badge coral"><i class="ti ti-map-pin-off"></i>ruta no encontrada</span>` : ''}
    </div>
    <div class="proj-card-actions" onclick="event.stopPropagation()">
      <button class="btn sm ghost" onclick="openVSCode('${p.id}')" title="Abrir en VS Code"><i class="ti ti-brand-vscode"></i></button>
      <button class="btn sm ghost" onclick="openFolder('${p.id}')" title="Abrir carpeta"><i class="ti ti-folder-open"></i></button>
      ${pending > 0 ? `<button class="btn sm" onclick="syncProject('${p.id}')" style="color:var(--amber);border-color:rgba(251,191,36,0.3);background:var(--amber-dim)"><i class="ti ti-refresh"></i> Sync</button>` : ''}
    </div>
  </div>`;
}

async function syncProject(id) {
  try {
    const r = await req('POST', `/projects/${id}/sync`);
    toast(`Sync completado: ${r.updated} actualizado${r.updated !== 1 ? 's' : ''}, ${r.added} nuevo${r.added !== 1 ? 's' : ''}`);
    await loadProjects(); renderProjectsView();
  } catch(e) { toast(e.message, 'err'); }
}

async function syncAllProjects() {
  try {
    const results = await req('POST', '/sync-all');
    const total = results.reduce((a, r) => a + (r.updated || 0) + (r.added || 0), 0);
    toast(`Sync global: ${total} cambios aplicados en ${results.length} proyecto${results.length !== 1 ? 's' : ''}`);
    await loadProjects(); renderProjectsView();
  } catch(e) { toast(e.message, 'err'); }
}

const PROVIDER_OPTS = `
  <label class="provider-opt"><input type="radio" name="prov" value="claude" checked><span><i class="ti ti-robot"></i> Claude Code <small style="color:var(--text2)">.claude/agents</small></span></label>
  <label class="provider-opt"><input type="radio" name="prov" value="github"><span><i class="ti ti-brand-github"></i> GitHub Copilot <small style="color:var(--text2)">.github/agents</small></span></label>
  <label class="provider-opt"><input type="radio" name="prov" value="both"><span><i class="ti ti-git-merge"></i> Ambos</span></label>`;

async function pickFolder(inputId) {
  if (!window.api?.pickFolder) {
    toast('Selector de carpeta solo disponible en la app de escritorio', 'info');
    return;
  }
  const folder = await window.api.pickFolder();
  if (folder) {
    const input = document.getElementById(inputId);
    if (input) { input.value = folder; input.dispatchEvent(new Event('input')); }
  }
}

function openCreateProject() {
  const cats = S.config?.categories || [];
  showModal('Nuevo proyecto', '', `
    <div class="field"><label>Nombre del proyecto</label><input id="mp-name" placeholder="Mi RPG Unity"/></div>
    <div class="field"><label>Categoría</label>
      <select id="mp-cat" onchange="updateTechSelect()">${cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Tecnología</label><select id="mp-tech"></select></div>
    <div class="field"><label>Ruta donde crear la carpeta</label>
      <div class="path-picker-row">
        <input id="mp-path" placeholder="Selecciona una carpeta…" readonly/>
        <button type="button" class="btn sm" onclick="pickFolder('mp-path')"><i class="ti ti-folder-open"></i> Examinar</button>
      </div>
      <div class="hint">Se creará una subcarpeta con el nombre del proyecto</div>
    </div>
    <div class="field"><label>Descripción (opcional)</label><input id="mp-desc" placeholder="Breve descripción…"/></div>
    <div class="field"><label>Agentes IA</label><div class="provider-opts">${PROVIDER_OPTS}</div></div>
  `, async () => {
    const name     = document.getElementById('mp-name').value.trim();
    const cat      = document.getElementById('mp-cat').value;
    const tech     = document.getElementById('mp-tech').value;
    const base     = document.getElementById('mp-path').value.trim();
    const desc     = document.getElementById('mp-desc').value.trim();
    const provider = document.querySelector('input[name="prov"]:checked')?.value || 'claude';
    if (!name || !cat || !base) { toast('Rellena nombre, categoría y ruta', 'err'); return false; }
    const slug        = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const projectPath = base.replace(/[/\\]$/, '') + '\\' + slug;
    try {
      await req('POST', '/projects', {name, categoryId:cat, techId:tech||null, projectPath, description:desc, aiProvider:provider});
      toast(`Proyecto "${name}" creado`);
      await loadProjects(); renderProjectsView();
    } catch(e) { toast(e.message, 'err'); return false; }
  });
  updateTechSelect();
}

function openImportProject() {
  const cats = S.config?.categories || [];
  showModal('Importar proyecto existente', 'Selecciona una carpeta que ya existe en tu sistema.', `
    <div class="field"><label>Nombre</label><input id="mi-name" placeholder="Mi proyecto…"/></div>
    <div class="field"><label>Categoría</label>
      <select id="mi-cat" onchange="updateTechSelectImport()">${cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Tecnología</label><select id="mi-tech"></select></div>
    <div class="field"><label>Ruta de la carpeta existente</label>
      <div class="path-picker-row">
        <input id="mi-path" placeholder="Selecciona una carpeta…" readonly/>
        <button type="button" class="btn sm" onclick="pickFolder('mi-path')"><i class="ti ti-folder-open"></i> Examinar</button>
      </div>
    </div>
    <div class="field"><label>Agentes IA</label><div class="provider-opts">${PROVIDER_OPTS}</div></div>
  `, async () => {
    const name     = document.getElementById('mi-name').value.trim();
    const cat      = document.getElementById('mi-cat').value;
    const tech     = document.getElementById('mi-tech').value;
    const projPath = document.getElementById('mi-path').value.trim();
    const provider = document.querySelector('input[name="prov"]:checked')?.value || 'claude';
    if (!name || !cat || !projPath) { toast('Rellena todos los campos', 'err'); return false; }
    try {
      await req('POST', '/projects/import', {name, categoryId:cat, techId:tech||null, projectPath:projPath, aiProvider:provider});
      toast(`Proyecto "${name}" importado`);
      await loadProjects(); renderProjectsView();
    } catch(e) { toast(e.message, 'err'); return false; }
  });
  updateTechSelectImport();
}

function updateTechSelect() {
  const cat = document.getElementById('mp-cat')?.value;
  const sel = document.getElementById('mp-tech');
  if (!sel || !cat) return;
  const techs = S.config?.categories?.find(c => c.id === cat)?.technologies || [];
  sel.innerHTML = `<option value="">— Sin tecnología específica —</option>` + techs.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
}

function updateTechSelectImport() {
  const cat = document.getElementById('mi-cat')?.value;
  const sel = document.getElementById('mi-tech');
  if (!sel || !cat) return;
  const techs = S.config?.categories?.find(c => c.id === cat)?.technologies || [];
  sel.innerHTML = `<option value="">— Sin tecnología específica —</option>` + techs.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
}

async function openProjectDrawer(id) {
  const p = S.projects.find(x => x.id === id);
  if (!p) return;
  S.drawerProject = p;
  S.drawerTab = p.aiProvider === 'github' ? 'ctx-github' : 'ctx-claude';
  await renderDrawer();
  document.getElementById('drawer').style.display = 'flex';
}

function closeDrawer() {
  document.getElementById('drawer').style.display = 'none';
  S.drawerProject = null;
}

async function renderDrawer() {
  const p = S.drawerProject;
  if (!p) return;
  const inner = document.getElementById('drawer-inner');

  let syncStatus = {};
  try { syncStatus = await req('GET', `/projects/${p.id}/sync-status`); } catch {}

  const isCtxTab   = S.drawerTab === 'ctx-claude' || S.drawerTab === 'ctx-github';
  const ctxType    = S.drawerTab === 'ctx-github' ? 'github' : 'claude';
  let   ctxContent = '';
  let   ctxPath    = '';
  if (isCtxTab) {
    try {
      const r  = await req('GET', `/projects/${p.id}/context?type=${ctxType}`);
      ctxContent = r.content || '';
      ctxPath    = r.filePath || '';
    } catch {}
  }

  const provider = p.aiProvider || 'claude';

  const statusBadge = (s) => {
    if (s === 'ok')       return `<span class="badge green"><i class="ti ti-circle-check"></i>ok</span>`;
    if (s === 'outdated') return `<span class="badge amber"><i class="ti ti-refresh"></i>actualizar</span>`;
    if (s === 'new')      return `<span class="badge blue"><i class="ti ti-sparkles"></i>nuevo</span>`;
    if (s === 'local')    return `<span class="badge gray"><i class="ti ti-device-laptop"></i>local</span>`;
    if (s === 'excluded') return `<span class="badge gray"><i class="ti ti-eye-off"></i>excluido</span>`;
    return `<span class="badge gray">${s}</span>`;
  };

  const syncRows = Object.entries(syncStatus).map(([name, entry]) => {
    const isExcluded  = entry.status === 'excluded';
    const isLocal     = entry.status === 'local';
    const toggleBtn   = !isLocal ? `<button class="btn ghost sm" style="padding:2px 6px;font-size:10px;flex-shrink:0"
      onclick="toggleAgentExclusion('${p.id}','${esc(name)}',${!isExcluded})"
      title="${isExcluded ? 'Incluir en el proyecto' : 'Excluir del proyecto'}">
      <i class="ti ${isExcluded ? 'ti-eye' : 'ti-eye-off'}"></i>
    </button>` : '';
    return `<div class="sync-agent-row">
      <span class="sync-agent-name">${esc(name)}</span>
      <span class="sync-agent-level">${entry.agent?.level || ''}</span>
      ${statusBadge(entry.status)}
      ${toggleBtn}
    </div>`;
  }).join('');

  const ctxTabs = provider === 'both'
    ? `<div class="drawer-tab ${S.drawerTab === 'ctx-claude' ? 'active' : ''}" onclick="setDrawerTab('ctx-claude')">CLAUDE.md</div>
       <div class="drawer-tab ${S.drawerTab === 'ctx-github' ? 'active' : ''}" onclick="setDrawerTab('ctx-github')">Copilot</div>`
    : provider === 'github'
      ? `<div class="drawer-tab ${isCtxTab ? 'active' : ''}" onclick="setDrawerTab('ctx-github')">copilot-instructions.md</div>`
      : `<div class="drawer-tab ${isCtxTab ? 'active' : ''}" onclick="setDrawerTab('ctx-claude')">CLAUDE.md</div>`;

  inner.innerHTML = `
    <div class="drawer-head">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div class="drawer-title">${esc(p.name)}</div>
        <button class="btn ghost sm" onclick="closeDrawer()"><i class="ti ti-x"></i></button>
      </div>
      <div class="drawer-meta">
        ${p.techId ? `<span class="badge blue"><i class="ti ti-code"></i>${esc(techName(p.categoryId, p.techId))}</span>` : ''}
        <span class="badge gray"><i class="ti ti-folder"></i>${esc(catName(p.categoryId))}</span>
        ${STATUS_BADGE[p.status] || STATUS_BADGE.active}
        <span class="badge gray">${PROVIDER_ICONS[provider] || PROVIDER_ICONS.claude}</span>
      </div>
    </div>
    <div class="drawer-tabs">
      ${ctxTabs}
      <div class="drawer-tab ${S.drawerTab === 'sync' ? 'active' : ''}" onclick="setDrawerTab('sync')">Agentes <span style="font-family:var(--mono);font-size:10px;color:var(--text2)">${Object.keys(syncStatus).length}</span></div>
    </div>
    <div class="drawer-body">
      ${isCtxTab ? `
        <div style="font-size:11px;color:var(--text2);margin-bottom:10px;font-family:var(--mono)">${esc(ctxPath)}</div>
        <textarea class="claude-md-editor" id="ctx-ta">${esc(ctxContent)}</textarea>` : `
        <div style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:12px;color:var(--text1)">${(() => {
            const vals = Object.values(syncStatus);
            const ok   = vals.filter(s => s.status === 'ok').length;
            const pend = vals.filter(s => s.status === 'outdated' || s.status === 'new').length;
            const excl = vals.filter(s => s.status === 'excluded').length;
            return `${ok} al día, ${pend} pendientes${excl ? `, ${excl} excluido${excl !== 1 ? 's' : ''}` : ''}`;
          })()}</span>
        </div>
        ${syncRows || '<div style="color:var(--text2);font-size:12px">Sin agentes registrados</div>'}
      `}
    </div>
    <div class="drawer-foot">
      ${isCtxTab
        ? `<button class="btn primary" onclick="saveContextFile('${p.id}','${ctxType}')"><i class="ti ti-device-floppy"></i> Guardar</button>
           <button class="btn" id="gen-ctx-btn" onclick="generateContextFile('${p.id}','${ctxType}')"><i class="ti ti-wand"></i> Generar con IA</button>`
        : `<button class="btn" onclick="syncProject('${p.id}');closeDrawer()"><i class="ti ti-refresh"></i> Sync este proyecto</button>`
      }
      <button class="btn" onclick="openVSCode('${p.id}')"><i class="ti ti-brand-vscode"></i> VS Code</button>
      <button class="btn" onclick="openFolder('${p.id}')"><i class="ti ti-folder-open"></i> Carpeta</button>
      <div style="flex:1"></div>
      <button class="btn sm ghost" onclick="openEditProject('${p.id}')" title="Editar proyecto"><i class="ti ti-pencil"></i></button>
      <button class="btn danger sm" onclick="confirmDeleteProject('${p.id}')"><i class="ti ti-trash"></i></button>
    </div>`;
}

async function setDrawerTab(tab) { S.drawerTab = tab; await renderDrawer(); }

async function generateContextFile(id, type) {
  const btn = document.getElementById('gen-ctx-btn');
  const ta  = document.getElementById('ctx-ta');
  if (!btn || !ta) return;
  const label = type === 'github' ? 'copilot-instructions.md' : 'CLAUDE.md';
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i> Analizando...';
  try {
    const { content } = await req('POST', `/projects/${id}/generate-context?type=${type}`);
    ta.value = content;
    toast(`${label} generado — revísalo y guarda cuando estés listo`);
  } catch(e) { toast(e.message, 'err'); }
  finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-wand"></i> Generar con IA';
  }
}

async function saveContextFile(id, type) {
  const content = document.getElementById('ctx-ta')?.value || '';
  const label   = type === 'github' ? 'copilot-instructions.md' : 'CLAUDE.md';
  try {
    await req('PUT', `/projects/${id}/context`, {content, type});
    toast(`${label} guardado`);
  } catch(e) { toast(e.message, 'err'); }
}

async function openVSCode(id) {
  const p = S.projects.find(x => x.id === id); if (!p) return;
  if (window.api) {
    const r = await window.api.openVSCode(p.path);
    if (!r.ok) toast(r.error, 'err');
  } else {
    toast('Función disponible en la app de escritorio', 'info');
  }
}

async function openFolder(id) {
  const p = S.projects.find(x => x.id === id); if (!p) return;
  if (window.api) window.api.openPath(p.path);
  else toast('Función disponible en la app de escritorio', 'info');
}

function _providerChangeWarning(oldProv, newProv) {
  if (!oldProv || oldProv === newProv) return '';
  const oldSet  = oldProv === 'both' ? ['claude','github'] : [oldProv];
  const newSet  = newProv === 'both' ? ['claude','github'] : [newProv];
  const added   = newSet.filter(p => !oldSet.includes(p));
  const removed = oldSet.filter(p => !newSet.includes(p));
  const dirName = p => p === 'github' ? '.github/agents' : '.claude/agents';

  let msg = '';
  const deletedFiles = r => r === 'claude'
    ? 'la carpeta <code>.claude/</code> y <code>CLAUDE.md</code>'
    : 'la carpeta <code>.github/</code>';

  if (added.length && removed.length) {
    msg = `Los agentes propios se copiarán de <code>${dirName(removed[0])}</code> a <code>${dirName(added[0])}</code>. Se eliminarán del disco ${deletedFiles(removed[0])}.`;
  } else if (added.length) {
    msg = `Los agentes propios se <strong>duplicarán</strong> en <code>${dirName(added[0])}</code>. Tendrás copias en ambos directorios.`;
  } else if (removed.length) {
    msg = `Se eliminarán del disco ${deletedFiles(removed[0])} junto con todos sus agentes.`;
  }
  if (!msg) return '';
  return `<div style="font-size:11px;color:var(--text1);padding:8px 10px;background:var(--amber-dim);border-radius:6px;border:1px solid rgba(251,191,36,.2);margin-top:6px"><i class="ti ti-alert-triangle" style="color:var(--amber)"></i> ${msg}</div>`;
}

function _updateProviderWarning(oldProv) {
  const sel = document.querySelector('#ep-provider-opts input[name="ep-prov"]:checked');
  const div = document.getElementById('ep-prov-warn');
  if (sel && div) div.innerHTML = _providerChangeWarning(oldProv, sel.value);
}

function openEditProject(id) {
  const p = S.projects.find(x => x.id === id); if (!p) return;
  const cats  = S.config?.categories || [];
  const cat   = cats.find(c => c.id === p.categoryId);
  const techs = cat?.technologies || [];

  const provOpts = ['claude','github','both'].map(v => `
    <label class="provider-opt">
      <input type="radio" name="ep-prov" value="${v}" ${(p.aiProvider||'claude') === v ? 'checked' : ''}
        onchange="_updateProviderWarning('${p.aiProvider||'claude'}')">
      <span>${v === 'claude' ? '<i class="ti ti-robot"></i> Claude Code' : v === 'github' ? '<i class="ti ti-brand-github"></i> GitHub Copilot' : '<i class="ti ti-git-merge"></i> Ambos'}</span>
    </label>`).join('');

  showModal('Editar proyecto', '', `
    <div class="field"><label>Nombre</label><input id="ep-name" value="${esc(p.name)}"/></div>
    <div class="field"><label>Descripción</label><input id="ep-desc" value="${esc(p.description||'')}"/></div>
    <div class="field"><label>Estado</label>
      <select id="ep-status">
        <option value="active"   ${p.status==='active'   ?'selected':''}>Activo</option>
        <option value="paused"   ${p.status==='paused'   ?'selected':''}>Pausado</option>
        <option value="archived" ${p.status==='archived' ?'selected':''}>Archivado</option>
      </select>
    </div>
    <div class="field"><label>Tecnología</label>
      <select id="ep-tech">
        <option value="">— Sin tecnología específica —</option>
        ${techs.map(t => `<option value="${t.id}" ${p.techId===t.id?'selected':''}>${t.name}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>Agentes IA</label>
      <div class="provider-opts" id="ep-provider-opts">${provOpts}</div>
      <div id="ep-prov-warn"></div>
    </div>
  `, async () => {
    const name     = document.getElementById('ep-name').value.trim();
    const desc     = document.getElementById('ep-desc').value.trim();
    const status   = document.getElementById('ep-status').value;
    const tech     = document.getElementById('ep-tech').value;
    const provider = document.querySelector('#ep-provider-opts input[name="ep-prov"]:checked')?.value || p.aiProvider;
    if (!name) { toast('El nombre es obligatorio', 'err'); return false; }
    try {
      const result = await req('PUT', `/projects/${id}`, {name, description:desc, status, techId:tech||null, aiProvider:provider});
      const m = result.migration;
      if (m && (m.added.length || m.removed.length)) {
        const detail = m.agentsMigrated > 0 ? ` (${m.agentsMigrated} agente${m.agentsMigrated!==1?'s':''} migrado${m.agentsMigrated!==1?'s':''})` : '';
        toast(`Proveedor actualizado${detail}`);
      } else {
        toast(`Proyecto "${name}" actualizado`);
      }
      S.drawerProject = S.projects.find(x => x.id === id) || S.drawerProject;
      await loadProjects();
      S.drawerProject = S.projects.find(x => x.id === id);
      renderProjectsView();
      if (S.drawerProject) await renderDrawer();
    } catch(e) { toast(e.message, 'err'); return false; }
  }, 'Guardar');
}

async function toggleAgentExclusion(projectId, agentName, shouldExclude) {
  const p = S.projects.find(x => x.id === projectId); if (!p) return;
  const excluded = new Set(p.excludedAgents || []);

  if (!shouldExclude) {
    excluded.delete(agentName);
    try {
      await req('PUT', `/projects/${projectId}`, { excludedAgents: [...excluded] });
      await req('POST', `/projects/${projectId}/sync`);
      await loadProjects();
      S.drawerProject = S.projects.find(x => x.id === projectId);
      await renderDrawer();
      toast(`"${agentName}" incluido y sincronizado`);
    } catch(e) { toast(e.message, 'err'); }
    return;
  }

  excluded.add(agentName);
  showModal(
    'Excluir agente',
    `¿Qué hacer con <strong>${esc(agentName)}</strong>?`,
    `<div style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
      <label style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;cursor:pointer">
        <input type="radio" name="excl-opt" value="delete" checked style="margin-top:2px;flex-shrink:0">
        <div>
          <div style="font-size:12px;font-weight:600;color:var(--text0)">Excluir y eliminar archivo</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">El archivo <code style="font-family:var(--mono)">${esc(agentName)}.md</code> se borrará del proyecto</div>
        </div>
      </label>
      <label style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;cursor:pointer">
        <input type="radio" name="excl-opt" value="keep" style="margin-top:2px;flex-shrink:0">
        <div>
          <div style="font-size:12px;font-weight:600;color:var(--text0)">Solo excluir</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">El archivo permanece pero Agent Hub no lo gestionará</div>
        </div>
      </label>
    </div>`,
    async () => {
      const choice = document.querySelector('input[name="excl-opt"]:checked')?.value || 'keep';
      try {
        await req('PUT', `/projects/${projectId}`, { excludedAgents: [...excluded] });
        if (choice === 'delete') await req('DELETE', `/projects/${projectId}/agents/${agentName}`);
        await loadProjects();
        S.drawerProject = S.projects.find(x => x.id === projectId);
        await renderDrawer();
        toast(choice === 'delete' ? `"${agentName}" excluido y archivo eliminado` : `"${agentName}" excluido`);
      } catch(e) { toast(e.message, 'err'); return false; }
    },
    'Confirmar'
  );
}

async function confirmDeleteProject(id) {
  const p = S.projects.find(x => x.id === id); if (!p) return;
  showModal('Eliminar proyecto', `¿Eliminar "${esc(p.name)}" del manager?`, `
    <div style="font-size:12px;color:var(--text1);padding:10px 12px;background:var(--bg3);border-radius:6px;border:1px solid var(--border2)">
      <i class="ti ti-info-circle" style="color:var(--blue)"></i>
      Solo se eliminará el proyecto de Agent Hub. La carpeta y sus archivos en
      <span style="font-family:var(--mono);color:var(--text0)">${esc(p.path)}</span>
      no se tocarán.
    </div>
  `, async () => {
    try {
      await req('DELETE', `/projects/${id}`);
      toast(`Proyecto "${p.name}" eliminado de Agent Hub`);
      closeDrawer(); await loadProjects(); renderProjectsView();
    } catch(e) { toast(e.message, 'err'); return false; }
  }, 'Eliminar', 'btn danger');
}
