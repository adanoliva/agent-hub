import React, { useEffect, useState } from 'react';
import { req } from '../../api';
import { useToast } from '../../hooks/useToast';
import type { Skill } from '../../types';

interface Props {
  skill: Skill;
  isNew: boolean;
  onClose: () => void;
  onSaved: (skill: Skill) => void;
  onDeleted: () => void;
}

export function SkillEditor({ skill: initial, isNew, onClose, onSaved, onDeleted }: Props) {
  const toast = useToast();

  const [s,        setS]        = useState<Skill>({ ...initial });
  const [lang,     setLang]     = useState<'es' | 'en'>('en');
  const [genDesc,  setGenDesc]  = useState('');
  const [genBusy,  setGenBusy]  = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);

  const prevKeyRef = React.useRef<string>(`${initial.name}::${isNew}`);
  useEffect(() => {
    const key = `${initial.name}::${isNew}`;
    if (key !== prevKeyRef.current) {
      prevKeyRef.current = key;
      setS({ ...initial });
    }
  }, [initial, isNew]);

  const update = (patch: Partial<Skill>) => setS((prev) => ({ ...prev, ...patch }));

  async function generateContent() {
    if (!genDesc.trim()) { toast('Escribe una descripción primero', 'err'); return; }
    setGenBusy(true);
    try {
      const r = await req<{ content: string }>('POST', '/ai/generate-skill', {
        name:        s.name || 'skill',
        description: genDesc.trim(),
        language:    lang,
      });
      update({ content: r.content });
      toast('Contenido generado');
    } catch (e: any) { toast(e.message, 'err'); }
    setGenBusy(false);
  }

  async function save() {
    if (!s.name?.trim()) { toast('La skill necesita un nombre', 'err'); return; }
    setSaveBusy(true);
    try {
      if (isNew) {
        await req('POST', '/skills', { skill: s });
      } else {
        await req('PUT', '/skills', { skill: { ...s, oldName: initial.name } });
      }
      toast(`Skill "${s.name}" guardada`);
      onSaved(s);
    } catch (e: any) { toast(e.message, 'err'); }
    setSaveBusy(false);
  }

  async function deleteSkill() {
    if (!confirm(`¿Eliminar la skill "${s.name}"?`)) return;
    try {
      await req('DELETE', `/skills?name=${encodeURIComponent(s.name)}`);
      toast(`Skill "${s.name}" eliminada`);
      onDeleted();
    } catch (e: any) { toast(e.message, 'err'); }
  }

  return (
    <div className="agent-editor" style={{ display: 'flex' }}>
      <div className="editor-head">
        <div style={{ flex: 1 }}>
          <div className="editor-title">{isNew ? 'Nueva skill' : s.name}</div>
          <div className="editor-sub">agents/skills/</div>
        </div>
        <button className="btn ghost sm" onClick={onClose}><i className="ti ti-x" /></button>
      </div>

      <div className="editor-body">
        <div className="field">
          <label>Nombre</label>
          <input
            value={s.name ?? ''}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="nombre-de-la-skill"
            style={{ fontFamily: 'var(--mono)' }}
          />
        </div>

        <div className="field">
          <label>Descripción</label>
          <input
            value={s.description ?? ''}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="Breve descripción…"
          />
        </div>

        <div className="field">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
            <label style={{ marginBottom: 0 }}>Generar con IA</label>
            <div className="lang-toggle">
              <button className={`lang-btn${lang === 'es' ? ' active' : ''}`} onClick={() => setLang('es')}>ES</button>
              <button className={`lang-btn${lang === 'en' ? ' active' : ''}`} onClick={() => setLang('en')}>EN</button>
            </div>
          </div>
          <div className="ai-gen-area">
            <input
              className="ai-gen-input"
              value={genDesc}
              onChange={(e) => setGenDesc(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') generateContent(); }}
              placeholder="Describe el contexto tecnológico en una frase…"
              style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8 }}
            />
            <button className="btn sm primary" onClick={generateContent} disabled={genBusy} style={{ width: '100%' }}>
              {genBusy
                ? <><div className="spin" /> Generando…</>
                : <><i className="ti ti-sparkles" /> Generar contenido</>
              }
            </button>
          </div>
        </div>

        <div className="field">
          <label>Contenido</label>
          <textarea
            rows={12}
            value={s.content ?? ''}
            onChange={(e) => update({ content: e.target.value })}
            placeholder="## Technology context&#10;&#10;Bloque Markdown con el contexto tecnológico que se inyectará en el system prompt…"
          />
          {s.content && (
            <div style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'right', marginTop: 3 }}>
              {s.content.trim().split(/\s+/).length} palabras
            </div>
          )}
        </div>
      </div>

      <div className="editor-foot">
        {!isNew && (
          <button className="btn danger sm" onClick={deleteSkill}>
            <i className="ti ti-trash" />
          </button>
        )}
        <button className="btn primary" style={{ flex: 1 }} onClick={save} disabled={saveBusy}>
          {saveBusy ? <><div className="spin" /> Guardando…</> : <><i className="ti ti-device-floppy" /> Guardar</>}
        </button>
      </div>
    </div>
  );
}
