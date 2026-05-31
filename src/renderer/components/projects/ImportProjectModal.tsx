import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { useStore } from '../../store';
import { req } from '../../api';
import { useToast } from '../../hooks/useToast';
import { PROJECT_PROVIDERS_LIST } from '../../constants/projects';

interface Props {
  onClose: () => void;
  onImported: () => void;
}

export function ImportProjectModal({ onClose, onImported }: Props) {
  const config  = useStore((s) => s.config);
  const toast   = useToast();
  const cats    = config?.categories ?? [];

  const [name,     setName]     = useState('');
  const [catId,    setCatId]    = useState(cats[0]?.id ?? '');
  const [techId,   setTechId]   = useState('');
  const [projPath, setProjPath] = useState('');

  // Default providers logic
  const getDefaultProviders = () => {
    const active = config?.aiProvider;
    if (active === 'github' || active === 'copilot-cli') return ['github'];
    if (active === 'gemini-cli' || active === 'gemini-api') return ['gemini'];
    if (active === 'openai') return ['openai'];
    return ['claude'];
  };
  const [aiProviders, setAiProviders] = useState<string[]>(getDefaultProviders());

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
    if (aiProviders.length === 0) {
      toast('Selecciona al menos un proveedor', 'err');
      return;
    }

    await req('POST', '/projects/import', {
      name: name.trim(),
      categoryId: catId,
      techId: techId || null,
      projectPath: projPath,
      aiProviders,
    });
    toast(`Proyecto "${name.trim()}" importado`);
    onImported();
    onClose();
  }

  const toggleProvider = (id: string) => {
    setAiProviders(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

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
      </div>
    </Modal>
  );
}
