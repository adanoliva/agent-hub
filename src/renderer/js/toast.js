function toast(msg, type = 'ok') {
  const icons = {ok:'ti-circle-check', err:'ti-alert-circle', info:'ti-info-circle', warn:'ti-alert-triangle'};
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="ti ${icons[type]||'ti-info-circle'}"></i><span>${msg}</span>`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), type === 'err' || type === 'warn' ? 5000 : 3500);
}
