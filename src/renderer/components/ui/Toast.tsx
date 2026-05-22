import React from 'react';
import { useStore } from '../../store';

const ICONS: Record<string, string> = {
  ok:   'ti-circle-check',
  err:  'ti-alert-circle',
  info: 'ti-info-circle',
  warn: 'ti-alert-triangle',
};

export function ToastContainer() {
  const toasts = useStore((s) => s.toasts);
  const remove = useStore((s) => s.removeToast);

  return (
    <div id="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`} onClick={() => remove(t.id)}>
          <i className={`ti ${ICONS[t.type] ?? 'ti-info-circle'}`} />
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}
