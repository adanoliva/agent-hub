const VIEW_META = {
  projects: {title:'Proyectos', sub:''},
  agents:   {title:'Agentes',   sub:''},
  settings: {title:'Ajustes',   sub:'Configuración'},
  chat:     {title:'Chat IA',   sub:''},
};

function switchView(name) {
  S.view = name;
  document.querySelectorAll('.nav-btn,.nav-set').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  document.getElementById('tb-title').textContent = VIEW_META[name]?.title || name;
  if (name === 'projects') renderProjectsView();
  if (name === 'agents')   renderAgentsView();
  if (name === 'settings') renderSettingsView();
  if (name === 'chat')     renderChatView();
}
