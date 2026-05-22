import React, { useState } from 'react';

interface Props {
  onRespond: (action: 'tray' | 'quit', remember: boolean) => void;
}

export function CloseDialog({ onRespond }: Props) {
  const [choice,   setChoice]   = useState<'tray' | 'quit'>('tray');
  const [remember, setRemember] = useState(false);

  return (
    <div className="overlay" style={{ zIndex: 2000 }}>
      <div className="modal" style={{ width: 400 }}>
        <div className="modal-head">
          <div>
            <div className="modal-title">Cerrar Agent Hub</div>
            <div className="modal-sub" style={{ color: 'var(--text2)', fontSize: 12 }}>
              ¿Qué quieres hacer con la ventana?
            </div>
          </div>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(['tray', 'quit'] as const).map((val) => (
            <label
              key={val}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                background: choice === val ? 'var(--accent-dim)' : 'var(--bg3)',
                border: `1px solid ${choice === val ? 'rgba(124,106,247,0.35)' : 'var(--border2)'}`,
                borderRadius: 9, padding: '12px 14px', transition: 'all .15s',
              }}
              onClick={() => setChoice(val)}
            >
              <div style={{
                width: 16, height: 16, borderRadius: '50%', flexShrink: 0, position: 'relative',
                border: `1.5px solid ${choice === val ? 'var(--accent)' : 'var(--border3)'}`,
                background: choice === val ? 'var(--accent)' : 'transparent',
                transition: 'all .15s',
              }}>
                {choice === val && (
                  <div style={{
                    position: 'absolute', top: '50%', left: '50%',
                    transform: 'translate(-50%,-50%)',
                    width: 6, height: 6, borderRadius: '50%', background: '#fff',
                  }} />
                )}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text0)', marginBottom: 2 }}>
                  {val === 'tray' ? 'Minimizar al tray' : 'Salir completamente'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                  {val === 'tray'
                    ? 'La app sigue corriendo en segundo plano'
                    : 'Cierra la app y el servidor por completo'}
                </div>
              </div>
              {val === 'tray' && (
                <i className="ti ti-brand-windows" style={{ marginLeft: 'auto', fontSize: 18, color: 'var(--text3)' }} />
              )}
              {val === 'quit' && (
                <i className="ti ti-power" style={{ marginLeft: 'auto', fontSize: 18, color: 'var(--text3)' }} />
              )}
            </label>
          ))}

          <label style={{
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            marginTop: 4, fontSize: 12, color: 'var(--text2)',
          }}>
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              style={{ width: 14, height: 14, cursor: 'pointer', accentColor: 'var(--accent)' }}
            />
            Recordar mi elección
          </label>
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={() => onRespond('tray', false)}>
            Cancelar
          </button>
          <button className="btn primary" onClick={() => onRespond(choice, remember)}>
            {choice === 'tray' ? <><i className="ti ti-arrow-down-circle" /> Minimizar</> : <><i className="ti ti-power" /> Salir</>}
          </button>
        </div>
      </div>
    </div>
  );
}
