(function setupUpdateListeners() {
  if (!window.api) return;

  const banner    = document.getElementById('update-banner');
  const bannerSub = document.getElementById('update-banner-sub');
  const bannerBtn = document.getElementById('update-banner-btn');

  window.api.onUpdateAvailable((info) => {
    bannerSub.textContent = `v${info.version} lista para descargar`;
    bannerBtn.textContent = 'Descargar';
    bannerBtn.onclick = async () => {
      bannerBtn.textContent = 'Descargando…';
      bannerBtn.disabled = true;
      await window.api.downloadUpdate();
    };
    banner.style.display = 'flex';
  });

  window.api.onUpdateProgress((pct) => {
    bannerSub.textContent = `Descargando… ${pct}%`;
  });

  window.api.onUpdateReady(() => {
    document.getElementById('update-banner-title').textContent = '¡Actualización lista!';
    bannerSub.textContent = 'Se instalará al reiniciar la app';
    bannerBtn.textContent = 'Reiniciar ahora';
    bannerBtn.disabled    = false;
    bannerBtn.onclick     = () => window.api.installUpdate();
    banner.style.display  = 'flex';
  });

  window.api.onUpdateError((msg) => {
    toast('Error al buscar actualización: ' + msg, 'err');
    banner.style.display = 'none';
    const el = document.getElementById('update-settings-status');
    if (el) el.textContent = 'Error: ' + msg;
  });
})();
