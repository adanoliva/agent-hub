async function loadProjects() {
  S.projects = await req('GET', '/projects');
}

function renderProjectsView() {
  const cats = S.config?.categories || [];
  const tb = document.getElementById('tb-actions');
  tb.innerHTML = `
    <button class="btn primary sm" onclick="openCreateProject()"><i class="ti ti-plus"></i> Nuevo proyecto</button>
    <button class="btn sm" onclick="openImportProject()"><i class="ti ti-folder-open"></i> Importar</button>
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

function projectCard(p) {
  const pending = p.pendingUpdates || 0;
  const exists  = p.pathExists !== false;
  const statusColors = {active:'green', paused:'amber', archived:'gray'};
  return `<div class="proj-card" onclick="openProjectDrawer('${p.id}')">
    <div class="proj-card-head">
      <div class="proj-card-name">${esc(p.name)}</div>
      ${pending > 0 ? `<span class="proj-pending"><i class="ti ti-arrow-up"></i>${pending}</span>` : ''}
    </div>
    <div class="proj-card-meta">
      ${p.techId ? `<span class="badge blue">${esc(techName(p.categoryId, p.techId))}</span>` : `<span class="badge gray">${esc(catName(p.categoryId))}</span>`}
      <span class="badge ${statusColors[p.status] || 'gray'}">${p.status || 'active'}</span>
      ${!exists ? `<span class="badge coral"><i class="ti ti-alert-triangle"></i> ruta no encontrada</span>` : ''}
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

function openCreateProject() {
  const cats = S.config?.categories || [];
  showModal('Nuevo proyecto', '', `
    <div class="field"><label>Nombre del proyecto</label><input id="mp-name" placeholder="Mi RPG Unity"/></div>
    <div class="field"><label>Categoría</label>
      <select id="mp-cat" onchange="updateTechSelect()">${cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Tecnología</label><select id="mp-tech"></select></div>
    <div class="field"><label>Ruta donde crear la carpeta</label><input id="mp-path" placeholder="C:/Proyectos"/><div class="hint">Se creará una subcarpeta con el nombre del proyecto</div></div>
    <div class="field"><label>Descripción (opcional)</label><input id="mp-desc" placeholder="Breve descripción…"/></div>
  `, async () => {
    const name = document.getElementById('mp-name').value.trim();
    const cat  = document.getElementById('mp-cat').value;
    const tech = document.getElementById('mp-tech').value;
    const base = document.getElementById('mp-path').value.trim();
    const desc = document.getElementById('mp-desc').value.trim();
    if (!name || !cat || !base) { toast('Rellena nombre, categoría y ruta', 'err'); return false; }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const projectPath = base.replace(/[/\\]$/, '') + '\\' + slug;
    try {
      await req('POST', '/projects', {name, categoryId:cat, techId:tech||null, projectPath, description:desc});
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
    <div class="field"><label>Ruta de la carpeta existente</label><input id="mi-path" placeholder="C:/Dev/mi-proyecto"/></div>
  `, async () => {
    const name = document.getElementById('mi-name').value.trim();
    const cat  = document.getElementById('mi-cat').value;
    const tech = document.getElementById('mi-tech').value;
    const path = document.getElementById('mi-path').value.trim();
    if (!name || !cat || !path) { toast('Rellena todos los campos', 'err'); return false; }
    try {
      await req('POST', '/projects/import', {name, categoryId:cat, techId:tech||null, projectPath:path});
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
  S.drawerTab = 'claude';
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
  let claudeMd = '';
  try { const r = await req('GET', `/projects/${p.id}/context`); claudeMd = r.content || ''; } catch {}

  const statusBadge = (s) => {
    if (s === 'ok')       return `<span class="badge green"><i class="ti ti-check"></i>ok</span>`;
    if (s === 'outdated') return `<span class="badge amber"><i class="ti ti-arrow-up"></i>actualizar</span>`;
    if (s === 'new')      return `<span class="badge blue"><i class="ti ti-plus"></i>nuevo</span>`;
    if (s === 'local')    return `<span class="badge gray"><i class="ti ti-user"></i>local</span>`;
    return `<span class="badge gray">${s}</span>`;
  };

  const syncRows = Object.entries(syncStatus).map(([name, entry]) => `
    <div class="sync-agent-row">
      <span class="sync-agent-name">${esc(name)}</span>
      <span class="sync-agent-level">${entry.agent?.level || ''}</span>
      ${statusBadge(entry.status)}
    </div>`).join('');

  inner.innerHTML = `
    <div class="drawer-head">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div class="drawer-title">${esc(p.name)}</div>
        <button class="btn ghost sm" onclick="closeDrawer()"><i class="ti ti-x"></i></button>
      </div>
      <div class="drawer-meta">
        ${p.techId ? `<span class="badge blue">${esc(techName(p.categoryId, p.techId))}</span>` : ''}
        <span class="badge gray">${esc(catName(p.categoryId))}</span>
        <span class="badge ${p.status === 'active' ? 'green' : p.status === 'paused' ? 'amber' : 'gray'}">${p.status || 'active'}</span>
      </div>
    </div>
    <div class="drawer-tabs">
      <div class="drawer-tab ${S.drawerTab === 'claude' ? 'active' : ''}" onclick="setDrawerTab('claude')">CLAUDE.md</div>
      <div class="drawer-tab ${S.drawerTab === 'sync' ? 'active' : ''}" onclick="setDrawerTab('sync')">Agentes <span style="font-family:var(--mono);font-size:10px;color:var(--text2)">${Object.keys(syncStatus).length}</span></div>
    </div>
    <div class="drawer-body">
      ${S.drawerTab === 'claude' ? `
        <div style="font-size:11px;color:var(--text2);margin-bottom:10px;font-family:var(--mono)">${esc(p.path)}\\CLAUDE.md</div>
        <textarea class="claude-md-editor" id="claude-md-ta">${esc(claudeMd)}</textarea>` : `
        <div style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:12px;color:var(--text1)">${Object.values(syncStatus).filter(s => s.status === 'ok').length} al día, ${Object.values(syncStatus).filter(s => s.status === 'outdated' || s.status === 'new').length} pendientes</span>
        </div>
        ${syncRows || '<div style="color:var(--text2);font-size:12px">Sin agentes registrados</div>'}
      `}
    </div>
    <div class="drawer-foot">
      ${S.drawerTab === 'claude'
        ? `<button class="btn primary" onclick="saveClaudeMd('${p.id}')"><i class="ti ti-device-floppy"></i> Guardar</button>`
        : `<button class="btn" onclick="syncProject('${p.id}');closeDrawer()"><i class="ti ti-refresh"></i> Sync este proyecto</button>`
      }
      <button class="btn" onclick="openVSCode('${p.id}')"><i class="ti ti-brand-vscode"></i> VS Code</button>
      <button class="btn" onclick="openFolder('${p.id}')"><i class="ti ti-folder-open"></i> Carpeta</button>
      <div style="flex:1"></div>
      <button class="btn danger sm" onclick="confirmDeleteProject('${p.id}')"><i class="ti ti-trash"></i></button>
    </div>`;
}

async function setDrawerTab(tab) { S.drawerTab = tab; await renderDrawer(); }

async function saveClaudeMd(id) {
  const content = document.getElementById('claude-md-ta')?.value || '';
  try {
    await req('PUT', `/projects/${id}/context`, {content});
    toast('CLAUDE.md guardado');
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

async function confirmDeleteProject(id) {
  const p = S.projects.find(x => x.id === id); if (!p) return;
  showModal('Eliminar proyecto', `¿Eliminar "${esc(p.name)}" del manager?`, `
    <div style="display:flex;flex-direction:column;gap:8px">
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer">
        <input type="checkbox" id="del-folder" style="accent-color:var(--coral)">
        También borrar la carpeta del disco (${esc(p.path)})
      </label>
      <div style="font-size:11px;color:var(--amber);padding:8px 10px;background:var(--amber-dim);border-radius:6px;border:1px solid rgba(251,191,36,.2)">
        <i class="ti ti-alert-triangle"></i> Si marcas esta opción, los archivos se eliminarán permanentemente.
      </div>
    </div>
  `, async () => {
    const del = document.getElementById('del-folder')?.checked;
    try {
      await req('DELETE', `/projects/${id}?deleteFolder=${del}`);
      toast(`Proyecto "${p.name}" eliminado`);
      closeDrawer(); await loadProjects(); renderProjectsView();
    } catch(e) { toast(e.message, 'err'); return false; }
  }, 'Eliminar', 'btn danger');
}
