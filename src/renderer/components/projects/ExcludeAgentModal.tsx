import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { req } from '../../api';
import { useToast } from '../../hooks/useToast';

interface Props {
  projectId: string;
  agentName: string;
  excludedAgents: string[];
  onClose: () => void;
  onExcluded: () => void;
}

export function ExcludeAgentModal({ projectId, agentName, excludedAgents, onClose, onExcluded }: Props) {
  const toast  = useToast();
  const [choice, setChoice] = useState<'delete' | 'keep'>('delete');

  async function handleConfirm() {
    const excluded = [...new Set([...excludedAgents, agentName])];
    await req('PUT', `/projects/${projectId}`, { excludedAgents: excluded });
    if (choice === 'delete') await req('DELETE', `/projects/${projectId}/agents/${agentName}`);
    toast(choice === 'delete'
      ? `"${agentName}" excluido y archivo eliminado`
      : `"${agentName}" excluido`
    );
    onExcluded();
    onClose();
  }

  return (
    <Modal
      title="Excluir agente"
      sub={`¿Qué hacer con <strong>${agentName}</strong>?`}
      onConfirm={handleConfirm}
      onClose={onClose}
      confirmLabel="Confirmar"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        {[
          {
            value: 'delete' as const,
            label: 'Excluir y eliminar archivo',
            sub: `El archivo ${agentName}.md se borrará del proyecto`,
          },
          {
            value: 'keep' as const,
            label: 'Solo excluir',
            sub: 'El archivo permanece pero Agent Hub no lo gestionará',
          },
        ].map((opt) => (
          <label
            key={opt.value}
            style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, cursor: 'pointer' }}
          >
            <input
              type="radio"
              name="excl-opt"
              value={opt.value}
              checked={choice === opt.value}
              onChange={() => setChoice(opt.value)}
              style={{ marginTop: 2, flexShrink: 0 }}
            />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text0)' }}>{opt.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                {opt.value === 'delete'
                  ? <><code style={{ fontFamily: 'var(--mono)' }}>{agentName}.md</code> se borrará del proyecto</>
                  : opt.sub
                }
              </div>
            </div>
          </label>
        ))}
      </div>
    </Modal>
  );
}
