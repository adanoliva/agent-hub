import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { useStore } from '../../store';
import { req } from '../../api';
import { useToast } from '../../hooks/useToast';
import type { Project } from '../../types';

interface Props {
  project: Project;
  onClose: () => void;
  onUpdated: () => void;
}

type Provider = 'claude' | 'github' | 'both';

const PROVIDER_OPTS: { value: Provider; label: string; icon: string }[] = [
  { value: 'claude', label: 'Claude Code',    icon: 'ti-robot' },
  { value: 'github', label: 'GitHub Copilot', icon: 'ti-brand-github' },
  { value: 'both',   label: 'Ambos',          icon: 'ti-git-merge' },
];

function providerWarning(oldProv: Provider, newProv: Provider): string {
  if (oldProv === newProv) return '';
  const oldSet  = oldProv === 'both' ? ['claude', 'github'] : [oldProv];
  const newSet  = newProv === 'both' ? ['claude', 'github'] : [newProv];
  const added   = newSet.filter((p) => !oldSet.includes(p));
  const removed = oldSet.filter((p) => !newSet.includes(p));
  const dirName = (p: string) => p === 'github' ? '.github/agents' : '.claude/agents';
  const deletedFiles = (r: string) => r === 'claude'
    ? 'la carpeta <code>.claude/</code> y <code>CLAUDE.md</code>'
    : 'la carpeta <code>.github/</code>';

  if (added.length && removed.length)
    return `Los agentes propios se copiarán de <code>${dirName(removed[0])}</code> a <code>${dirName(added[0])}</code>. Se eliminarán del disco ${deletedFiles(removed[0])}.`;
  if (added.length)
    return `Los agentes propios se <strong>duplicarán</strong> en <code>${dirName(added[0])}</code>. Tendrás copias en ambos directorios.`;
  if (removed.length)
    return `Se eliminarán del disco ${deletedFiles(removed[0])} junto con todos sus agentes.`;
  return '';
}

export function EditProjectModal({ project: p, onClose, onUpdated }: Props) {
  const config   = useStore((s) => s.config);
  const toast    = useToast();
  const cats     = config?.categories ?? [];
  const cat      = cats.find((c) => c.id === p.categoryId);
  const techs    = cat?.technologies ?? [];
  const origProv = (p.aiProvider ?? 'claude') as Provider;

  const [name,     setName]     = useState(p.name);
  const [desc,     setDesc]     = useState(p.description ?? '');
  const [status,   setStatus]   = useState(p.status);
  const [techId,   setTechId]   = useState(p.techId ?? '');
  const [provider, setProvider] = useState<Provider>(origProv);

  const warn = providerWarning(origProv, provider);

  async function handleConfirm() {
    if (!name.trim()) { toast('El nombre es obligatorio', 'err'); return; }
    const result = await req<{ migration?: { added: string[]; removed: string[]; agentsMigrated: number } }>(
      'PUT', `/projects/${p.id}`,
      { name: name.trim(), description: desc.trim(), status, techId: techId || null, aiProvider: provider }
    );
    const m = result.migration;
    if (m && (m.added.length || m.removed.length)) {
      const detail = m.agentsMigrated > 0
        ? ` (${m.agentsMigrated} agente${m.agentsMigrated !== 1 ? 's' : ''} migrado${m.agentsMigrated !== 1 ? 's' : ''})`
        : '';
      toast(`Proveedor actualizado${detail}`);
    } else {
      toast(`Proyecto "${name.trim()}" actualizado`);
    }
    onUpdated();
    onClose();
  }

  return (
    <Modal title="Editar proyecto" onConfirm={handleConfirm} onClose={onClose} confirmLabel="Guardar">
      <div className="field">
        <label>Nombre</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Descripción</label>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <div className="field">
        <label>Estado</label>
        <select value={status} onChange={(e) => setStatus(e.target.value as Project['status'])}>
          <option value="active">Activo</option>
          <option value="paused">Pausado</option>
          <option value="archived">Archivado</option>
        </select>
      </div>
      <div className="field">
        <label>Tecnología</label>
        <select value={techId} onChange={(e) => setTechId(e.target.value)}>
          <option value="">— Sin tecnología específica —</option>
          {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Agentes IA</label>
        <div className="provider-opts">
          {PROVIDER_OPTS.map((opt) => (
            <label key={opt.value} className="provider-opt">
              <input
                type="radio"
                name="edit-prov"
                value={opt.value}
                checked={provider === opt.value}
                onChange={() => setProvider(opt.value)}
              />
              <span><i className={`ti ${opt.icon}`} /> {opt.label}</span>
            </label>
          ))}
        </div>
        {warn && (
          <div
            style={{ fontSize: 11, color: 'var(--text1)', padding: '8px 10px', background: 'var(--amber-dim)', borderRadius: 6, border: '1px solid rgba(251,191,36,.2)', marginTop: 6 }}
            dangerouslySetInnerHTML={{ __html: `<i class="ti ti-alert-triangle" style="color:var(--amber)"></i> ${warn}` }}
          />
        )}
      </div>
    </Modal>
  );
}
