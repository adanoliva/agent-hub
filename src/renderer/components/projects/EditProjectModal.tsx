import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { useStore } from '../../store';
import { req } from '../../api';
import { useToast } from '../../hooks/useToast';
import type { Project } from '../../types';
import { PROJECT_PROVIDERS_LIST, PROJECT_PROVIDERS } from '../../constants/projects';

interface Props {
  project: Project;
  onClose: () => void;
  onUpdated: () => void | Promise<void>;
}

function getProviderWarning(oldSet: string[], newSet: string[]): string {
  const added   = newSet.filter((p) => !oldSet.includes(p));
  const removed = oldSet.filter((p) => !newSet.includes(p));
  
  if (added.length === 0 && removed.length === 0) return '';

  const parts = [];
  if (added.length > 0) {
    const names = added.map(id => PROJECT_PROVIDERS[id]?.label || id).join(', ');
    parts.push(`Se activará soporte para: <strong>${names}</strong>. Los agentes se sincronizarán en sus nuevas carpetas.`);
  }
  if (removed.length > 0) {
    const names = removed.map(id => PROJECT_PROVIDERS[id]?.label || id).join(', ');
    parts.push(`Se <strong>eliminarán</strong> los archivos de contexto y carpetas de agentes de: <strong>${names}</strong>.`);
  }

  return parts.join('<br/><br/>');
}

export function EditProjectModal({ project: p, onClose, onUpdated }: Props) {
  const config   = useStore((s) => s.config);
  const toast    = useToast();
  const cats     = config?.categories ?? [];
  const origProvs = p.aiProviders || ['claude'];

  const [name,        setName]        = useState(p.name);
  const [desc,        setDesc]        = useState(p.description ?? '');
  const [status,      setStatus]      = useState(p.status);
  const [catId,       setCatId]       = useState(p.categoryId);
  const [aiProviders, setAiProviders] = useState<string[]>(origProvs);
  const [gitEnabled,  setGitEnabled]  = useState(p.gitEnabled ?? false);

  const warn = getProviderWarning(origProvs, aiProviders);

  async function handleConfirm() {
    if (!name.trim()) { toast('El nombre es obligatorio', 'err'); return; }
    if (aiProviders.length === 0) { toast('Selecciona al menos un proveedor', 'err'); return; }

    const result = await req<{ migration?: { added: string[]; removed: string[]; agentsMigrated: number } }>(
      'PUT', `/projects/${p.id}`,
      { name: name.trim(), description: desc.trim(), status, categoryId: catId, aiProviders, gitEnabled }
    );
    const m = result.migration;
    if (m && (m.added.length || m.removed.length)) {
      const detail = m.agentsMigrated > 0
        ? ` (${m.agentsMigrated} agente${m.agentsMigrated !== 1 ? 's' : ''} migrado${m.agentsMigrated !== 1 ? 's' : ''})`
        : '';
      toast(`Ecosistemas actualizados${detail}`);
    } else {
      toast(`Proyecto "${name.trim()}" actualizado`);
    }
    await onUpdated();
    onClose();
  }

  const toggleProvider = (id: string) => {
    setAiProviders(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  return (
    <Modal
      title="Editar proyecto"
      sub="Actualiza configuración y ecosistemas IA"
      modalClassName="project-edit-modal"
      bodyClassName="project-edit-body"
      onConfirm={handleConfirm}
      onClose={onClose}
      confirmLabel="Guardar"
    >
      <div className="project-edit-grid">
        <div className="field">
          <label>Nombre</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="field">
          <label>Estado</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as Project['status'])}>
            <option value="active">Activo</option>
            <option value="paused">Pausado</option>
            <option value="archived">Archivado</option>
          </select>
        </div>

        <div className="field project-edit-col-span-2">
          <label>Descripción</label>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>

        <div className="field project-edit-col-span-2">
          <label>Categoría</label>
          <select value={catId} onChange={(e) => setCatId(e.target.value)}>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div className="field project-edit-col-span-2">
          <label>Agentes IA (Contexto y Carpetas)</label>
          <div className="provider-opts" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {PROJECT_PROVIDERS_LIST.map((opt) => (
              <label
                key={opt.id}
                className={`provider-opt-chip ${aiProviders.includes(opt.id) ? 'active' : ''}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 20,
                  border: '1px solid var(--border2)',
                  background: aiProviders.includes(opt.id) ? 'var(--accent-dim)' : 'var(--bg2)',
                  color: aiProviders.includes(opt.id) ? 'var(--accent)' : 'var(--text1)',
                  borderColor: aiProviders.includes(opt.id) ? 'var(--accent)' : 'var(--border2)',
                  cursor: 'pointer',
                  fontSize: 12,
                  transition: 'all .15s'
                }}
              >
                <input
                  type="checkbox"
                  checked={aiProviders.includes(opt.id)}
                  onChange={() => toggleProvider(opt.id)}
                  style={{ display: 'none' }}
                />
                <i className={`ti ${opt.icon}`} /> {opt.label}
              </label>
            ))}
          </div>
          {warn && (
            <div
              className="project-edit-warning"
              style={{ marginTop: 12, fontSize: 11, background: 'rgba(217,119,6,0.1)', color: 'var(--amber)', padding: 10, borderRadius: 8, border: '1px solid rgba(217,119,6,0.2)' }}
              dangerouslySetInnerHTML={{ __html: `<i class="ti ti-alert-triangle"></i> ${warn}` }}
            />
          )}
        </div>

        <div className="field project-edit-col-span-2">
          <label>Configuración avanzada</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 0' }}>
            <input
              type="checkbox"
              checked={gitEnabled}
              onChange={(e) => setGitEnabled(e.target.checked)}
            />
            <span style={{ fontSize: 12, color: 'var(--text1)' }}>
              <i className="ti ti-git-commit" style={{ marginRight: 5, color: 'var(--green)' }} />
              Checkpoint git tras cada paso de orquestación
            </span>
          </label>
          {gitEnabled && (
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2, paddingLeft: 26 }}>
              Hace un commit automático después de cada agente. Requiere que el proyecto sea un repositorio git.
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
