let _modalConfirm = null;

function showModal(title, sub, bodyHtml, onConfirm, confirmLabel = 'Confirmar', confirmClass = 'btn primary') {
  _modalConfirm = onConfirm;
  document.getElementById('modal-inner').innerHTML = `
    <div class="modal-head">
      <div>
        <div class="modal-title">${title}</div>
        ${sub ? `<div class="modal-sub">${sub}</div>` : ''}
      </div>
      <button class="btn ghost sm" onclick="closeModal()"><i class="ti ti-x"></i></button>
    </div>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="${confirmClass}" onclick="confirmModal()">${confirmLabel}</button>
    </div>`;
  document.getElementById('modal').style.display = 'flex';
}

async function confirmModal() {
  if (_modalConfirm) {
    const result = await _modalConfirm();
    if (result !== false) closeModal();
  }
}

function closeModal() {
  document.getElementById('modal').style.display = 'none';
  _modalConfirm = null;
}
