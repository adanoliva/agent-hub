import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { useStore } from '../../store';
import { req } from '../../api';
import { useToast } from '../../hooks/useToast';

interface Props {
  onClose: () => void;
  onImported: () => void;
}

const PROVIDER_OPTS = [
  { value: 'claude', label: 'Claude Code', icon: 'ti-robot', sub: '.claude/agents' },
  { value: 'github', label: 'GitHub Copilot', icon: 'ti-brand-github', sub: '.github/agents' },
  { value: 'both',   label: 'Ambos', icon: 'ti-git-merge', sub: '' },
] as const;

export function ImportProjectModal({ onClose, onImported }: Props) {
  const config  = useStore((s) => s.config);
  const toast   = useToast();
  const cats    = config?.categories ?? [];

  const [name,     setName]     = useState('');
  const [catId,    setCatId]    = useState(cats[0]?.id ?? '');
  const [techId,   setTechId]   = useState('');
  const [projPath, setProjPath] = useState('');
  const [provider, setProvider] = useState<'claude' | 'github' | 'both'>('claude');

  const techs = cats.find((c) => c.id === catId)?.technologies ?? [];

  async function pickFolder() {
    const folder = await (window as any).api?.pickFolder?.();
    if (folder) setProjPath(folder);
  }

  async function handleConfirm() {
    if (!name.trim() || !catId || !projPath.trim()) {
      toast('Rellena todos los campos', 'err');
      return;
    }
    await req('POST', '/projects/import', {
      name: name.trim(),
      categoryId: catId,
      techId: techId || null,
      projectPath: projPath,
      aiProvider: provider,
    });
    toast(`Proyecto "${name.trim()}" importado`);
    onImported();
    onClose();
  }

  return (
    <Modal
      title="Importar proyecto existente"
      sub="Selecciona una carpeta que ya existe en tu sistema."
      onConfirm={handleConfirm}
      onClose={onClose}
      confirmLabel="Importar"
    >
      <div className="field">
        <label>Nombre</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mi proyecto…" />
      </div>
      <div className="field">
        <label>Categoría</label>
        <select value={catId} onChange={(e) => { setCatId(e.target.value); setTechId(''); }}>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
        <label>Ruta de la carpeta existente</label>
        <div className="path-picker-row">
          <input value={projPath} readOnly placeholder="Selecciona una carpeta…" />
          <button type="button" className="btn sm" onClick={pickFolder}>
            <i className="ti ti-folder-open" /> Examinar
          </button>
        </div>
      </div>
      <div className="field">
        <label>Agentes IA</label>
        <div className="provider-opts">
          {PROVIDER_OPTS.map((opt) => (
            <label key={opt.value} className="provider-opt">
              <input
                type="radio"
                name="import-prov"
                value={opt.value}
                checked={provider === opt.value}
                onChange={() => setProvider(opt.value)}
              />
              <span>
                <i className={`ti ${opt.icon}`} /> {opt.label}
                {opt.sub && <small style={{ color: 'var(--text2)' }}> {opt.sub}</small>}
              </span>
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}
