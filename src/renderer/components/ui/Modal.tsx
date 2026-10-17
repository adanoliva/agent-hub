import React from 'react';

interface ModalProps {
  title: string;
  sub?: string;
  modalClassName?: string;
  bodyClassName?: string;
  confirmLabel?: string;
  confirmClass?: string;
  onConfirm?: () => void | Promise<void>;
  onClose: () => void;
  hideFooter?: boolean;
  children: React.ReactNode;
}

export function Modal({
  title,
  sub,
  modalClassName,
  bodyClassName,
  confirmLabel = 'Confirmar',
  confirmClass = 'btn primary',
  onConfirm,
  onClose,
  hideFooter,
  children,
}: ModalProps) {
  const [loading, setLoading] = React.useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm?.();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${modalClassName ? ` ${modalClassName}` : ''}`}>
        <div className="modal-head">
          <div>
            <div className="modal-title">{title}</div>
            {sub && <div className="modal-sub" dangerouslySetInnerHTML={{ __html: sub }} />}
          </div>
          <button className="btn ghost sm" onClick={onClose}><i className="ti ti-x" /></button>
        </div>
        <div className={`modal-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>{children}</div>
        {!hideFooter && (
          <div className="modal-foot">
            <button className="btn" onClick={onClose}>Cancelar</button>
            <button className={confirmClass} onClick={handleConfirm} disabled={loading}>
              {loading ? <i className="ti ti-loader-2" style={{ animation: 'spin 1s linear infinite' }} /> : confirmLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
