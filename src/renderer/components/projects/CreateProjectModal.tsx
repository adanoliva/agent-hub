import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { useStore } from '../../store';
import { req } from '../../api';
import { useToast } from '../../hooks/useToast';
import { PROJECT_PROVIDERS_LIST } from '../../constants/projects';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export function CreateProjectModal({ onClose, onCreated }: Props) {
  const config  = useStore((s) => s.config);
  const toast   = useToast();
  const cats    = config?.categories ?? [];

  const [name,     setName]     = useState('');
  const [catId,    setCatId]    = useState(cats[0]?.id ?? '');
  const [basePath, setBasePath] = useState('');
  const [desc,     setDesc]     = useState('');

  // Default providers logic
  const getDefaultProviders = () => {
    const active = config?.aiProvider;
    if (active === 'github' || active === 'copilot-cli') return ['github'];
    if (active === 'gemini-cli' || active === 'gemini-api') return ['gemini'];
    if (active === 'openai') return ['openai'];
    return ['claude'];
  };
  const [aiProviders, setAiProviders] = useState<string[]>(getDefaultProviders());

  async function pickFolder() {
    const folder = await (window as any).api?.pickFolder?.();
    if (folder) setBasePath(folder);
  }

  async function handleConfirm() {
    if (!name.trim() || !catId || !basePath.trim()) {
      toast('Rellena nombre, categoría y ruta', 'err');
      throw new Error('validation');
    }
    if (aiProviders.length === 0) {
      toast('Selecciona al menos un proveedor', 'err');
      throw new Error('validation');
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const projectPath = basePath.replace(/[/\\]$/, '') + '\\' + slug;

    try {
      await req('POST', '/projects', {
        name: name.trim(),
        categoryId: catId,
        projectPath,
        description: desc.trim(),
        aiProviders,
      });
      toast(`Proyecto "${name.trim()}" creado`);
      onCreated();
      onClose();
    } catch (e: any) {
      toast(e.message || 'Error al crear proyecto', 'err');
      throw e;
    }
  }

  const toggleProvider = (id: string) => {
    setAiProviders(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  return (
    <Modal title="Nuevo proyecto" onConfirm={handleConfirm} onClose={onClose} confirmLabel="Crear">
      <div className="field">
        <label>Nombre del proyecto</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mi RPG Unity" />
      </div>
      <div className="field">
        <label>Categoría</label>
        <select value={catId} onChange={(e) => setCatId(e.target.value)}>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
        <small style={{ display: 'block', marginTop: 8, color: 'var(--text3)', fontSize: 11 }}>
          Sincroniza agentes y genera archivos de contexto para los ecosistemas seleccionados.
        </small>
      </div>
    </Modal>
  );
}
