import React, { useState, useEffect } from 'react';
import { req } from '../../api';
import type { Orchestration, OrchestrateNode, Project } from '../../types';
import { useStore } from '../../store';
import { Modal } from '../ui/Modal';

interface Props {
  orchestrations: Orchestration[];
  project:        Project;
  onSelect:       (orch: Orchestration) => void;
  onDelete:       (orchId: string) => void;
  onExecute:      (orch: Orchestration) => void;
  onNew:          () => void;
}

const STATUS_META: Record<string, { icon: string; cls: string; label: string }> = {
  success: { icon: 'ti-circle-check', cls: 'green',  label: 'Exitoso'   },
  partial: { icon: 'ti-alert-triangle', cls: 'amber', label: 'Parcial'   },
  failed:  { icon: 'ti-alert-circle',   cls: 'coral', label: 'Fallido'   },
};

export function OrchestrationList({ orchestrations, project, onSelect, onDelete, onExecute, onNew }: Props) {
  const addToast   = useStore(s => s.addToast);
  const [deleting,        setDeleting]        = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const confirmOrch = orchestrations.find(o => o.id === confirmDeleteId);

  const handleDelete = async () => {
    if (!confirmDeleteId) return;
    setDeleting(confirmDeleteId);
    setConfirmDeleteId(null);
    try {
      await req('DELETE', `/orchestrations/${confirmDeleteId}`);
      onDelete(confirmDeleteId);
      addToast('Orquestación eliminada', 'ok');
    } catch {
      addToast('Error al eliminar', 'err');
    } finally {
      setDeleting(null);
    }
  };

  if (orchestrations.length === 0) {
    return (
      <div className="orch-empty">
        <i className="ti ti-topology-ring-2" />
        <p>No hay orquestaciones para <strong>{project.name}</strong></p>
        <button className="btn primary" onClick={onNew}>
          <i className="ti ti-plus" /> Nueva orquestación
        </button>
      </div>
    );
  }

  return (
    <>
    <div className="orch-list">
      {orchestrations.map(orch => {
        const statusMeta = orch.lastExecutionStatus ? STATUS_META[orch.lastExecutionStatus] : null;
        return (
          <div key={orch.id} className="orch-card" onClick={() => onSelect(orch)}>
            <div className="orch-card-header">
              <div className="orch-card-title">
                <i className="ti ti-topology-ring-2" />
                <span>{orch.name}</span>
                {statusMeta && (
                  <span className={`badge ${statusMeta.cls}`} style={{ marginLeft: 4 }}>
                    <i className={`ti ${statusMeta.icon}`} /> {statusMeta.label}
                  </span>
                )}
              </div>
              <div className="orch-card-actions" onClick={e => e.stopPropagation()}>
                <button className="btn ghost sm" title="Ejecutar" onClick={() => onExecute(orch)}>
                  <i className="ti ti-player-play" />
                </button>
                <button
                  className="btn ghost sm"
                  title="Eliminar"
                  disabled={deleting === orch.id}
                  onClick={e => { e.stopPropagation(); setConfirmDeleteId(orch.id); }}
                >
                  <i className="ti ti-trash" />
                </button>
              </div>
            </div>

            {orch.description && (
              <p className="orch-card-desc">{orch.description}</p>
            )}

            <div className="orch-card-agents-preview">
              {(orch.nodes ?? []).slice(0, 4).map((node, i) => {
                const label = node.agentName.startsWith('__script:')
                  ? node.agentName.replace(/^__script:/, '').replace(/__$/, '')
                  : node.agentName;
                return (
                  <React.Fragment key={node.id}>
                    <span className="orch-agent-chip">{label}</span>
                    {i < Math.min((orch.nodes ?? []).length - 1, 3) && (
                      <i className="ti ti-chevron-right orch-arrow" />
                    )}
                  </React.Fragment>
                );
              })}
              {(orch.nodes ?? []).length > 4 && (
                <span className="orch-agent-chip more">+{(orch.nodes ?? []).length - 4}</span>
              )}
            </div>

            <div className="orch-card-footer">
              <span className="orch-card-stat">
                <i className="ti ti-cpu" />
                {(orch.nodes ?? []).length} nodo{(orch.nodes ?? []).length !== 1 ? 's' : ''}
              </span>
              {orch.executionCount > 0 && (
                <span className="orch-card-stat">
                  <i className="ti ti-history" />
                  {orch.executionCount} ejecución{orch.executionCount !== 1 ? 'es' : ''}
                </span>
              )}
              {orch.lastExecutedAt && (
                <span className="orch-card-stat orch-card-date">
                  <i className="ti ti-clock" />
                  {new Date(orch.lastExecutedAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>

    {confirmOrch && (
      <Modal
        title="Eliminar orquestación"
        sub={`¿Seguro que quieres eliminar <strong>${confirmOrch.name}</strong>? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        confirmClass="btn danger"
        onConfirm={handleDelete}
        onClose={() => setConfirmDeleteId(null)}
      >
        <></>
      </Modal>
    )}
    </>
  );
}
