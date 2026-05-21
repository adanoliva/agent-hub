async function init() {
  try {
    const h = await req('GET', '/health');
    document.getElementById('srv-dot').className = 'sdot green';
    document.getElementById('srv-lbl').textContent = 'Servidor activo';
    document.getElementById('dir-lbl').textContent = h.appDir;
  } catch {
    document.getElementById('srv-dot').className = 'sdot amber';
    document.getElementById('srv-lbl').textContent = 'Servidor no disponible';
  }

  if (window.api) {
    const v = await window.api.getVersion().catch(() => '1.0.0');
    S.appVersion = v;
    document.getElementById('ver-lbl').textContent = `v${v}`;
    const d = await window.api.getAppDir().catch(() => '');
    if (d) document.getElementById('dir-lbl').textContent = d;
  }

  try { S.config   = await req('GET', '/config');   } catch {}
  try { S.projects = await req('GET', '/projects'); } catch {}

  renderProjectsView();

  if (!localStorage.getItem('cdm-wizard-done')) openWizard();
}

init();
