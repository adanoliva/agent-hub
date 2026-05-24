import React, { useEffect, useState } from 'react';
import { req } from '../../api';
import { useToast } from '../../hooks/useToast';
import { useStore } from '../../store';
import { ALL_TOOLS } from '../../constants/tools';
import type { Agent, SelectedNode } from '../../types';

interface Props {
  agent: Agent;
  isNew: boolean;
  node: SelectedNode;
  onClose: () => void;
  onSaved: (agent: Agent) => void;
  onDeleted: () => void;
}

export function AgentEditor({ agent: initial, isNew, node, onClose, onSaved, onDeleted }: Props) {
  const toast    = useToast();
  const projects = useStore((s) => s.projects);

  const [a,       setA]       = useState<Agent>({ ...initial });
  const [lang,    setLang]    = useState<'es' | 'en'>('en');
  const [aiDesc,  setAiDesc]  = useState('');
  const [genBusy, setGenBusy] = useState(false);
  const [optBusy, setOptBusy] = useState(false);
  const [saveBusy,setSaveBusy]= useState(false);

  useEffect(() => { setA({ ...initial }); }, [initial]);

  const update = (patch: Partial<Agent>) => setA((prev) => ({ ...prev, ...patch }));

  function toggleTool(tool: string, checked: boolean) {
    const tools = a.tools ?? [];
    update({ tools: checked ? [...tools, tool] : tools.filter((t) => t !== tool) });
  }

  const levelPath = (() => {
    if (node.level === 'global')  return '~/.claude/agents/global/';
    if (node.level === 'section') return `agents/section-${node.categoryId}/`;
    if (node.level === 'tech')    return `agents/tech-${node.categoryId}-${node.techId}/`;
    const p = projects.find((x) => x.id === node.projectId);
    return p ? `${p.path}\\.claude\\agents\\` : '';
  })();

  async function generatePrompt() {
    if (!aiDesc.trim()) { toast('Escribe una descripción primero', 'err'); return; }
    setGenBusy(true);
    try {
      const r = await req<{ system: string }>('POST', '/ai/generate-prompt', {
        description: aiDesc.trim(),
        name:        a.name || 'agent',
        level:       node.level,
        categoryId:  node.categoryId,
        techId:      node.techId,
        tools:       a.tools ?? [],
        language:    lang,
        existingAgents: [],
      });
      update({ system: r.system });
      toast('System prompt generado');
    } catch (e: any) { toast(e.message, 'err'); }
    setGenBusy(false);
  }

  async function optimizeAgent() {
    setOptBusy(true);
    try {
      const r = await req<{ description: string; system: string }>('POST', '/ai/optimize-agent', {
        name:        a.name,
        description: a.description,
        system:      a.system,
        tools:       a.tools ?? [],
        model:       a.model ?? 'sonnet',
        language:    lang,
      });
      update({ description: r.description, system: r.system, optimized: true });
      toast('Agente optimizado — revisa y guarda cuando estés listo');
    } catch (e: any) { toast(e.message, 'err'); }
    setOptBusy(false);
  }

  async function save() {
    if (!a.name?.trim()) { toast('El agente necesita un nombre', 'err'); return; }
    setSaveBusy(true);
    try {
      if (node.level === 'project') {
        await req(isNew ? 'POST' : 'PUT', `/projects/${node.projectId}/agents`,
          isNew ? { agent: a } : { oldName: initial.name, agent: a });
      } else {
        await req(isNew ? 'POST' : 'PUT', '/agents',
          isNew
            ? { level: node.level, categoryId: node.categoryId, techId: node.techId, agent: a }
            : { level: node.level, categoryId: node.categoryId, techId: node.techId, oldName: initial.name, agent: a });
      }
      toast(`Agente "${a.name}" guardado`);
      onSaved(a);
    } catch (e: any) { toast(e.message, 'err'); }
    setSaveBusy(false);
  }

  async function deleteAgent() {
    if (!confirm(`¿Eliminar el agente "${a.name}"? Esta acción elimina el fichero .md.`)) return;
    try {
      if (node.level === 'project') {
        await req('DELETE', `/projects/${node.projectId}/agents/${a.name}`);
      } else {
        await req('DELETE', '/agents', { level: node.level, categoryId: node.categoryId, techId: node.techId, name: a.name });
      }
      toast(`Agente "${a.name}" eliminado`);
      onDeleted();
    } catch (e: any) { toast(e.message, 'err'); }
  }

  return (
    <div className="agent-editor" style={{ display: 'flex' }}>
      {/* Head */}
      <div className="editor-head">
        <div style={{ flex: 1 }}>
          <div className="editor-title">{isNew ? 'Nuevo agente' : a.name}</div>
          <div className="editor-sub">{levelPath}</div>
        </div>
        <button className="btn ghost sm" onClick={onClose}><i className="ti ti-x" /></button>
      </div>

      {/* Body */}
      <div className="editor-body">
        <div className="field">
          <label>Nombre</label>
          <input
            value={a.name ?? ''}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="nombre-del-agente"
            style={{ fontFamily: 'var(--mono)' }}
          />
        </div>

        <div className="field">
          <label>Descripción</label>
          <input
            value={a.description ?? ''}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="Breve descripción…"
          />
        </div>

        <div className="field">
          <label>Modelo</label>
          <select value={a.model ?? 'sonnet'} onChange={(e) => update({ model: e.target.value })}>
            <option value="haiku">haiku — rápido y ligero</option>
            <option value="sonnet">sonnet — equilibrado</option>
            <option value="opus">opus — máximo potencial</option>
          </select>
        </div>

        <div className="field">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
            <label style={{ marginBottom: 0 }}>Idioma del prompt</label>
            <div className="lang-toggle">
              <button className={`lang-btn${lang === 'es' ? ' active' : ''}`} onClick={() => setLang('es')}>ES</button>
              <button className={`lang-btn${lang === 'en' ? ' active' : ''}`} onClick={() => setLang('en')}>EN</button>
            </div>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1.5 }}>
            <i className="ti ti-info-circle" style={{ marginRight: 4 }} />
            Usa <strong style={{ color: 'var(--text2)' }}>inglés</strong> si el agente trabaja con código (reviews, tests, refactor, análisis). El tokenizador procesa inglés ~15% más eficientemente. Elige español solo si el agente genera respuestas en español para el usuario final.
          </div>
        </div>

        <div className="field">
          <label>Herramientas</label>
          <div className="tools-grid">
            {ALL_TOOLS.map((t) => (
              <label key={t} className="tool-check">
                <input
                  type="checkbox"
                  checked={(a.tools ?? []).includes(t)}
                  onChange={(e) => toggleTool(t, e.target.checked)}
                />
                {t}
              </label>
            ))}
          </div>
        </div>

        {/* AI generate */}
        <div className="field">
          <label>Generar con IA</label>
          <div className="ai-gen-area">
            <input
              className="ai-gen-input"
              value={aiDesc}
              onChange={(e) => setAiDesc(e.target.value)}
              placeholder="Describe el agente en una frase…"
              style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8 }}
            />
            <button className="btn sm primary" onClick={generatePrompt} disabled={genBusy} style={{ width: '100%' }}>
              {genBusy
                ? <><div className="spin" /> Generando…</>
                : <><i className="ti ti-sparkles" /> Generar system prompt</>
              }
            </button>
          </div>
        </div>

        {/* System prompt */}
        <div className="field">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <label style={{ marginBottom: 0 }}>System prompt</label>
            {!a.optimized && a.system && (
              <button
                className="btn sm"
                onClick={optimizeAgent}
                disabled={optBusy}
                style={{ gap: 5, fontSize: 11, color: 'var(--accent)', borderColor: 'rgba(124,106,247,0.3)', background: 'var(--accent-dim)' }}
              >
                {optBusy ? <><div className="spin" />Optimizando…</> : <><i className="ti ti-wand" />Optimizar con IA</>}
              </button>
            )}
            {a.optimized && (
              <span className="badge accent" style={{ fontSize: 10 }}>
                <i className="ti ti-circle-check" />optimizado
              </span>
            )}
          </div>
          <textarea
            rows={8}
            value={a.system ?? ''}
            onChange={(e) => update({ system: e.target.value, optimized: false })}
          />
          {a.system && (
            <div style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'right', marginTop: 3 }}>
              {a.system.trim().split(/\s+/).length} palabras
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="editor-foot">
        {!isNew && (
          <button className="btn danger sm" onClick={deleteAgent}>
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
