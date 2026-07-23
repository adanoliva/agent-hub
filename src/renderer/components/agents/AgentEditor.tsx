import React, { useEffect, useState } from 'react';
import { req } from '../../api';
import { useToast } from '../../hooks/useToast';
import { useStore } from '../../store';
import { TOOL_GROUPS } from '../../constants/tools';
import type { Agent, Skill, SelectedNode } from '../../types';

interface Props {
  agent: Agent;
  isNew: boolean;
  node: SelectedNode;
  forceKey?: number;
  onClose: () => void;
  onSaved: (agent: Agent) => void;
  onDeleted: () => void;
}

export function AgentEditor({ agent: initial, isNew, node, forceKey, onClose, onSaved, onDeleted }: Props) {
  const toast    = useToast();
  const projects = useStore((s) => s.projects);

  const [a,        setA]        = useState<Agent>({ ...initial });
  const [lang,     setLang]     = useState<'es' | 'en'>('en');
  const [aiDesc,   setAiDesc]   = useState('');
  const [genBusy,  setGenBusy]  = useState(false);
  const [optBusy,  setOptBusy]  = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [allSkills,      setAllSkills]      = useState<Skill[]>([]);
  const [allMcpServers,  setAllMcpServers]  = useState<{ name: string }[]>([]);

  // Always-fresh ref — avoids stale closure in async save().
  const aRef = React.useRef<Agent>(a);
  useEffect(() => { aRef.current = a; });

  // Reset editor state when: different agent, isNew changes, or an explicit forceKey bump
  // (forceKey is incremented by parent after save to sync with server response).
  const prevKeyRef = React.useRef<string>(`${initial.name}::${isNew}::${forceKey ?? 0}`);
  useEffect(() => {
    const key = `${initial.name}::${isNew}::${forceKey ?? 0}`;
    if (key !== prevKeyRef.current) {
      prevKeyRef.current = key;
      setA({ ...initial });
    }
  }, [initial, isNew, forceKey]);

  useEffect(() => {
    if (node.level === 'project' || initial.level === 'project') {
      req<Skill[]>('GET', '/skills/flat').then(setAllSkills).catch(() => {});
    }
    const pid = node.projectId ?? (initial.projectId ?? '');
    req<{ name: string }[]>('GET', `/mcp/servers${pid ? `?projectId=${pid}` : ''}`)
      .then(setAllMcpServers).catch(() => {});
  }, [node.level, node.projectId, initial.level, initial.projectId]);

  const update = (patch: Partial<Agent>) => setA((prev) => ({ ...prev, ...patch }));

  function toggleTool(tool: string, checked: boolean) {
    setA((prev) => {
      const tools = prev.tools ?? [];
      return { ...prev, tools: checked ? [...tools, tool] : tools.filter((t) => t !== tool) };
    });
  }

  const levelPath = (() => {
    if (node.level === 'global')  return '~/.claude/agents/global/';
    if (node.level === 'section') return `agents/section-${node.categoryId}/`;
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
    const agentToSave = aRef.current;
    if (!agentToSave.name?.trim()) { toast('El agente necesita un nombre', 'err'); return; }
    setSaveBusy(true);
    const effectiveLevel    = agentToSave.level ?? node.level;
    const effectiveProject  = agentToSave.projectId ?? node.projectId;
    const effectiveCategory = agentToSave.categoryId ?? node.categoryId;
    try {
      let saved: Agent;
      if (effectiveLevel === 'project') {
        saved = await req<Agent>(isNew ? 'POST' : 'PUT', `/projects/${effectiveProject}/agents`,
          isNew ? { agent: agentToSave } : { oldName: initial.name, agent: agentToSave });
      } else {
        saved = await req<Agent>(isNew ? 'POST' : 'PUT', '/agents',
          isNew
            ? { level: effectiveLevel, categoryId: effectiveCategory, agent: agentToSave }
            : { level: effectiveLevel, categoryId: effectiveCategory, oldName: initial.name, agent: agentToSave });
      }
      toast(`Agente "${agentToSave.name}" guardado`);
      onSaved(saved);
    } catch (e: any) { toast(e.message, 'err'); }
    setSaveBusy(false);
  }

  async function deleteAgent() {
    if (!confirm(`¿Eliminar el agente "${a.name}"? Esta acción elimina el fichero .md.`)) return;
    try {
      if (node.level === 'project') {
        await req('DELETE', `/projects/${node.projectId}/agents/${a.name}`);
      } else {
        await req('DELETE', '/agents', { level: node.level, categoryId: node.categoryId, name: a.name });
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
          <label>Permisos</label>
          <div className="tool-groups">
            {TOOL_GROUPS.map(group => {
              const active = group.tools.every(t => (a.tools ?? []).includes(t));
              const partial = !active && group.tools.some(t => (a.tools ?? []).includes(t));
              const toggle = () => {
                setA((prev) => {
                  const current = prev.tools ?? [];
                  const allActive = group.tools.every(t => current.includes(t));
                  if (allActive) {
                    return { ...prev, tools: current.filter(t => !group.tools.includes(t)) };
                  }
                  const missing = group.tools.filter(t => !current.includes(t));
                  return { ...prev, tools: [...current, ...missing] };
                });
              };
              return (
                <button
                  key={group.id}
                  type="button"
                  className={`tool-group-btn${active ? ' active' : ''}${partial ? ' partial' : ''}`}
                  onClick={toggle}
                  title={group.tools.join(', ')}
                >
                  <i className={`ti ${group.icon}`} />
                  <span>{group.label}</span>
                  {active && <i className="ti ti-check tool-group-check" />}
                  {partial && <i className="ti ti-minus tool-group-check" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Skills — nivel proyecto (node o propio del agente) */}
        {(node.level === 'project' || a.level === 'project') && (allSkills.length > 0 || (a.skills || []).length > 0) && (
          <div className="field">
            <label>Skills asociadas</label>
            <div className="agent-skills-selector">
              {(a.skills || []).map(skillName => (
                <span key={skillName} className="tool-pill agent-skill-chip">
                  <i className="ti ti-puzzle" />
                  {skillName}
                  <button
                    className="agent-skill-remove"
                    onClick={() => update({ skills: (a.skills || []).filter(s => s !== skillName) })}
                    title="Quitar"
                  >×</button>
                </span>
              ))}
              {allSkills.filter(s => !(a.skills || []).includes(s.name)).length > 0 && (
                <select
                  className="input sm agent-skill-add"
                  value=""
                  onChange={e => {
                    if (!e.target.value) return;
                    update({ skills: [...(a.skills || []), e.target.value] });
                  }}
                >
                  <option value="">Añadir skill…</option>
                  {allSkills.filter(s => !(a.skills || []).includes(s.name)).map(s => (
                    <option key={s.name} value={s.name}>{s.name}{s.description ? ` — ${s.description}` : ''}</option>
                  ))}
                </select>
              )}
            </div>
            <p className="agent-hint">
              Las skills inyectan conocimiento tecnológico en el system prompt. Mantén el prompt enfocado en la tarea; el contexto técnico va en skills.
            </p>
          </div>
        )}

        {/* MCP Servers */}
        {(allMcpServers.length > 0 || (a.mcp_servers || []).length > 0) && (
          <div className="field">
            <label>Servidores MCP</label>
            <div className="agent-skills-selector">
              {(a.mcp_servers || []).map(srvName => (
                <span key={srvName} className="tool-pill agent-skill-chip">
                  <i className="ti ti-plug-connected" />
                  {srvName}
                  <button
                    className="agent-skill-remove"
                    onClick={() => update({ mcp_servers: (a.mcp_servers || []).filter(s => s !== srvName) })}
                    title="Quitar"
                  >×</button>
                </span>
              ))}
              {allMcpServers.filter(s => !(a.mcp_servers || []).includes(s.name)).length > 0 && (
                <select
                  className="input sm agent-skill-add"
                  value=""
                  onChange={e => {
                    if (!e.target.value) return;
                    update({ mcp_servers: [...(a.mcp_servers || []), e.target.value] });
                  }}
                >
                  <option value="">Añadir servidor MCP…</option>
                  {allMcpServers.filter(s => !(a.mcp_servers || []).includes(s.name)).map(s => (
                    <option key={s.name} value={s.name}>{s.name}</option>
                  ))}
                </select>
              )}
            </div>
            <p className="agent-hint">
              Los servidores MCP aportan herramientas externas (GitHub, Linear, etc.) al agente durante la ejecución.
            </p>
          </div>
        )}

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
          <div style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1.6, marginTop: 8, padding: '7px 9px', background: 'var(--bg2)', borderRadius: 6, borderLeft: '2px solid var(--accent)' }}>
            <i className="ti ti-topology-ring-2" style={{ marginRight: 5, color: 'var(--accent)' }} />
            <strong style={{ color: 'var(--text2)' }}>Si usarás este agente en una orquestación</strong>, el prompt debe indicar explícitamente:<br />
            <span style={{ paddingLeft: 14, display: 'block', marginTop: 3 }}>
              · que lea el contexto del proyecto (<code style={{ fontSize: 9 }}>CLAUDE.md</code>)<br />
              · qué información recibe del paso anterior<br />
              · qué produce y entrega al siguiente agente
            </span>
          </div>
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
