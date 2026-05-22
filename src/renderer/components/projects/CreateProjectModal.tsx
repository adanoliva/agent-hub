import React, { useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useStore } from '../../store';
import { req } from '../../api';
import { useToast } from '../../hooks/useToast';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

const PROVIDER_OPTS = [
  { value: 'claude', label: 'Claude Code', icon: 'ti-robot', sub: '.claude/agents' },
  { value: 'github', label: 'GitHub Copilot', icon: 'ti-brand-github', sub: '.github/agents' },
  { value: 'both',   label: 'Ambos', icon: 'ti-git-merge', sub: '' },
] as const;

export function CreateProjectModal({ onClose, onCreated }: Props) {
  const config  = useStore((s) => s.config);
  const toast   = useToast();
  const cats    = config?.categories ?? [];

  const [name,     setName]     = useState('');
  const [catId,    setCatId]    = useState(cats[0]?.id ?? '');
  const [techId,   setTechId]   = useState('');
  const [basePath, setBasePath] = useState('');
  const [desc,     setDesc]     = useState('');
  const [provider, setProvider] = useState<'claude' | 'github' | 'both'>('claude');

  const techs = cats.find((c) => c.id === catId)?.technologies ?? [];

  async function pickFolder() {
    const folder = await (window as any).api?.pickFolder?.();
    if (folder) setBasePath(folder);
  }

  async function handleConfirm() {
    if (!name.trim() || !catId || !basePath.trim()) {
      toast('Rellena nombre, categoría y ruta', 'err');
      return;
    }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const projectPath = basePath.replace(/[/\\]$/, '') + '\\' + slug;
    await req('POST', '/projects', {
      name: name.trim(),
      categoryId: catId,
      techId: techId || null,
      projectPath,
      description: desc.trim(),
      aiProvider: provider,
    });
    toast(`Proyecto "${name.trim()}" creado`);
    onCreated();
    onClose();
  }

  return (
    <Modal title="Nuevo proyecto" onConfirm={handleConfirm} onClose={onClose} confirmLabel="Crear">
      <div className="field">
        <label>Nombre del proyecto</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mi RPG Unity" />
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
        <label>Ruta donde crear la carpeta</label>
        <div className="path-picker-row">
          <input value={basePath} readOnly placeholder="Selecciona una carpeta…" />
          <button type="button" className="btn sm" onClick={pickFolder}>
            <i className="ti ti-folder-open" /> Examinar
          </button>
        </div>
        <div className="hint">Se creará una subcarpeta con el nombre del proyecto</div>
      </div>
      <div className="field">
        <label>Descripción (opcional)</label>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Breve descripción…" />
      </div>
      <div className="field">
        <label>Agentes IA</label>
        <div className="provider-opts">
          {PROVIDER_OPTS.map((opt) => (
            <label key={opt.value} className="provider-opt">
              <input
                type="radio"
                name="create-prov"
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
