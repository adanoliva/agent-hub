import React, { useState, useEffect, useRef } from 'react';
import { req } from '../../api';
import type { Orchestration, OrchestrationNode, DataFlow, ContextExtra, Agent, ExecutionConfig } from '../../types';
import { NodeCanvas, NODE_W, NODE_H, getAgentIcon, autoLayoutNodes } from './NodeCanvas';
import type { SelectedEdge } from './NodeCanvas';
import { ConnectionConfigurator, type ScriptParamSchema } from './ConnectionConfigurator';
import { useStore } from '../../store';

interface Props {
  orchestration: Orchestration;
  projectId:     string;
  onSave:        (data: Partial<Orchestration>) => Promise<void>;
  onBack:        () => void;
  onExecute:     () => void;
}

const DEFAULT_DATA_FLOW: DataFlow = {
  agentOutput:    true,
  filesModified:  true,
  projectContext: false,
};

const DEFAULT_CONTEXT_EXTRA: ContextExtra = {
  fixed:    { freeText: '', files: [] },
  temporal: [],
};

function makeNode(agentName: string, x: number, y: number): OrchestrationNode {
  return {
    id:           `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    agentName,
    dependsOn:    [],
    isRoot:       false,
    x,
    y,
    dataFlow:     { ...DEFAULT_DATA_FLOW },
    contextExtra: { ...DEFAULT_CONTEXT_EXTRA, fixed: { freeText: '', files: [] }, temporal: [] },
  };
}

export function OrchestrationEditor({ orchestration, projectId, onSave, onBack, onExecute }: Props) {
  const addToast = useStore(s => s.addToast);
  const projects = useStore(s => s.projects);

  const [name,         setName]         = useState(orchestration.name);
  const [description,  setDescription]  = useState(orchestration.description);
  const [dagNodes,     setDagNodes]     = useState<OrchestrationNode[]>(() => orchestration.nodes ?? []);
  const [selectedEdge, setSelectedEdge] = useState<SelectedEdge | null>(null);
  // Same defaults as workflows.create / the orchestrator, for orchestrations saved before these fields existed
  const [execConfig,   setExecConfig]   = useState<ExecutionConfig>(() => ({
    stopOnError: true, validateAfterEachStep: false, maxTurns: 10, timeout: 1_800_000, stepTimeout: 600_000,
    ...(orchestration.executionConfig as Partial<ExecutionConfig> | undefined),
  }));
  const [showExecConfig, setShowExecConfig] = useState(false);
  const setMinutes = (key: 'timeout' | 'stepTimeout') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setExecConfig(c => ({ ...c, [key]: Math.max(1, Number(e.target.value) || 1) * 60_000 }));
  const [isSaving,     setIsSaving]     = useState(false);
  const [validating,   setValidating]   = useState(false);
  const [errors,       setErrors]       = useState<string[]>([]);

  const [allAgents,    setAllAgents]    = useState<Agent[]>([]);
  const [agentSearch,  setAgentSearch]  = useState('');
  const [scripts,      setScripts]      = useState<Array<{ name: string; label: string; description: string; builtin: boolean; hasWarnings?: boolean; params?: ScriptParamSchema[] }>>([]);
  const [paletteTab,   setPaletteTab]   = useState<'agents' | 'scripts'>('agents');
  const [paletteOpen,  setPaletteOpen]  = useState(true);

  // DnD from palette
  const [isDragging,   setIsDragging]   = useState(false);
  const draggingRef  = useRef<{ agentName: string } | null>(null);
  const dragGhostRef = useRef<HTMLElement | null>(null);
  const canvasPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    req<{ scripts: Array<{ name: string; label: string; description: string; builtin: boolean; hasWarnings?: boolean; params?: ScriptParamSchema[] }>; warnings: string[] }>('GET', '/scripts')
      .then(res => setScripts(res.scripts ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const applyAgents = (fetched: Agent[], canPurge: boolean) => {
      const seen = new Set<string>();
      const merged: Agent[] = [];
      for (const a of fetched) {
        if (!seen.has(a.name)) { seen.add(a.name); merged.push(a); }
      }
      setAllAgents(merged);

      if (!canPurge) return;
      const existingNames = new Set(merged.map(a => a.name));
      setDagNodes(prev => {
        const cleaned = prev.filter(n => n.agentName.startsWith('__script:') || existingNames.has(n.agentName));
        if (cleaned.length === prev.length) return prev;
        return cleaned.map(n => ({ ...n, dependsOn: n.dependsOn.filter(id => cleaned.some(c => c.id === id)) }));
      });
    };

    if (!projectId) {
      req<Agent[]>('GET', '/agents/flat').then(a => applyAgents(a, true)).catch(() => {});
      return;
    }
    const project  = projects.find(p => p.id === projectId);
    const excluded = new Set(project?.excludedAgents ?? []);
    Promise.all([
      req<Agent[]>('GET', `/agents/applicable?projectId=${encodeURIComponent(projectId)}`).catch(() => null),
      req<Agent[]>('GET', `/projects/${encodeURIComponent(projectId)}/agents`).catch(() => null),
    ]).then(([applicable, projectAgents]) => {
      const bothOk              = applicable !== null && projectAgents !== null;
      const resolvedApplicable  = applicable    ?? [];
      const resolvedProject     = projectAgents ?? [];
      const projectNames        = new Set(resolvedProject.map(a => a.name));
      const filteredApplicable  = resolvedApplicable.filter(a => !excluded.has(a.name) && !projectNames.has(a.name));
      applyAgents([...resolvedProject, ...filteredApplicable], bothOk);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleUpdateNode = (updated: OrchestrationNode) => {
    setDagNodes(ns => ns.map(n => n.id === updated.id ? updated : n));
  };

  const handleValidate = async () => {
    if (dagNodes.length < 2) { setErrors(['Necesitas al menos 2 nodos']); return; }
    setValidating(true);
    try {
      await onSave({ name, description, nodes: dagNodes, executionConfig: execConfig });
      const result = await req<{ valid: boolean; errors: string[] }>('POST', `/orchestrations/${orchestration.id}/validate`);
      setErrors(result.errors || []);
      if (result.valid) addToast('Validación correcta', 'ok');
    } catch (e: any) {
      setErrors([e.message || 'Error de validación']);
    } finally {
      setValidating(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) { addToast('El nombre es obligatorio', 'warn'); return; }
    setIsSaving(true);
    try {
      await onSave({ name, description, nodes: dagNodes, executionConfig: execConfig, projectId });
      setErrors([]);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Palette DnD ──

  const clearDragGhost = (e: React.DragEvent) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    canvas.style.cssText = 'position:fixed;top:-9999px;left:-9999px;pointer-events:none';
    document.body.appendChild(canvas);
    e.dataTransfer.setDragImage(canvas, 0, 0);
    dragGhostRef.current = canvas;
  };

  const handlePaletteDragStart = (agentName: string, e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'copy';
    clearDragGhost(e);
    draggingRef.current = { agentName };
    setIsDragging(true);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    draggingRef.current = null;
    if (dragGhostRef.current) {
      document.body.removeChild(dragGhostRef.current);
      dragGhostRef.current = null;
    }
  };

  const handleCanvasDragOver = (e: React.DragEvent) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!draggingRef.current) return;
    const { agentName } = draggingRef.current;

    if (!agentName.startsWith('__script:') && dagNodes.some(n => n.agentName === agentName)) {
      handleDragEnd();
      return;
    }

    const panel = canvasPanelRef.current!;
    const rect  = panel.getBoundingClientRect();
    // Position relative to the NodeCanvas (which starts after 24px padding of the panel)
    const dropX = e.clientX - rect.left + panel.scrollLeft - 24;
    const dropY = e.clientY - rect.top  + panel.scrollTop  - 24;

    // If dropped onto an existing node, auto-connect below it
    const targetNode = dagNodes.find(n => {
      const nx = n.x ?? 0, ny = n.y ?? 0;
      return dropX >= nx && dropX <= nx + NODE_W && dropY >= ny && dropY <= ny + NODE_H;
    });

    const newNode = makeNode(
      agentName,
      targetNode ? (targetNode.x ?? 0) : Math.max(0, dropX - NODE_W / 2),
      targetNode ? (targetNode.y ?? 0) + NODE_H + 80 : Math.max(0, dropY - NODE_H / 2),
    );
    if (targetNode) newNode.dependsOn = [targetNode.id];

    setDagNodes(ns => [...ns, newNode]);
    handleDragEnd();
  };

  // ── Derived data ──

  const agentNamesInCanvas = new Set(dagNodes.filter(n => !n.agentName.startsWith('__script:')).map(n => n.agentName));
  const filteredAgents = allAgents.filter(a =>
    !agentNamesInCanvas.has(a.name) && (
      a.name.toLowerCase().includes(agentSearch.toLowerCase()) ||
      a.description?.toLowerCase().includes(agentSearch.toLowerCase())
    )
  );

  const builtinScripts  = scripts.filter(s => s.builtin);
  const externalScripts = scripts.filter(s => !s.builtin);

  const agentModels: Record<string, string>       = {};
  const agentDescriptions: Record<string, string> = {};
  for (const a of allAgents) {
    const m = a.model || '';
    if (m.includes('haiku'))       agentModels[a.name] = 'haiku';
    else if (m.includes('opus'))   agentModels[a.name] = 'opus';
    else if (m.includes('sonnet')) agentModels[a.name] = 'sonnet';
    agentDescriptions[a.name] = a.description || '';
  }
  for (const s of scripts)
    agentDescriptions[`__script:${s.name}__`] = s.description || '';

  function getScriptParamsForAgent(agentName: string): ScriptParamSchema[] {
    if (!agentName?.startsWith('__script:')) return [];
    const n = agentName.replace(/^__script:/, '').replace(/__$/, '');
    return scripts.find(s => s.name === n)?.params ?? [];
  }

  const scriptsWithRequiredParams = new Set(
    scripts.filter(s => s.params?.some(p => p.required)).map(s => s.name)
  );

  function modelShort(m: string): string {
    if (!m) return '';
    if (m.includes('haiku'))  return 'haiku';
    if (m.includes('opus'))   return 'opus';
    if (m.includes('sonnet')) return 'sonnet';
    return '';
  }

  // Connection configurator node
  const configuratorNode   = selectedEdge ? dagNodes.find(n => n.id === selectedEdge.toId) ?? null : null;
  const isInputNode        = selectedEdge?.fromId === null;
  const fromAgentName      = selectedEdge?.fromId
    ? dagNodes.find(n => n.id === selectedEdge.fromId)?.agentName ?? ''
    : 'Orquestador';
  const toAgentName        = configuratorNode?.agentName ?? '';
  const scriptParams       = getScriptParamsForAgent(toAgentName);

  return (
    <div className="orch-editor">
      {/* Header */}
      <div className="orch-editor-header">
        <div className="orch-editor-title">
          <input
            type="text"
            className="orch-name-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Nombre de la orquestación"
          />
          <input
            type="text"
            className="orch-desc-input"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Descripción (opcional)"
          />
        </div>
        <div className="orch-editor-actions">
          <button className={`btn ghost${showExecConfig ? ' active' : ''}`} onClick={() => setShowExecConfig(v => !v)}
            title="Timeouts, turnos y comportamiento ante errores">
            <i className="ti ti-adjustments-horizontal" />{' '}Ejecución
          </button>
          <button className="btn ghost" onClick={handleValidate} disabled={validating || isSaving}>
            {validating ? <i className="ti ti-loader-2 spin" /> : <i className="ti ti-check" />}
            {' '}Validar
          </button>
          <button className="btn primary" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <i className="ti ti-loader-2 spin" /> : <i className="ti ti-device-floppy" />}
            {' '}Guardar
          </button>
        </div>
      </div>

      {showExecConfig && (
        <div className="orch-exec-config">
          <label>
            <span>Timeout total</span>
            <input type="number" className="input" min={1} value={Math.round(execConfig.timeout / 60_000)} onChange={setMinutes('timeout')} />
            <span className="orch-exec-config-unit">min</span>
          </label>
          <label>
            <span>Timeout por paso</span>
            <input type="number" className="input" min={1} value={Math.round((execConfig.stepTimeout ?? 600_000) / 60_000)} onChange={setMinutes('stepTimeout')} />
            <span className="orch-exec-config-unit">min</span>
          </label>
          <label>
            <span>Turnos máx. por paso</span>
            <input type="number" className="input" min={1} max={100} value={execConfig.maxTurns}
              onChange={e => setExecConfig(c => ({ ...c, maxTurns: Math.min(100, Math.max(1, Number(e.target.value) || 1)) }))} />
          </label>
          <label title="Se comprueba al terminar cada nivel. Solo con Claude (CLI o API): el resto de proveedores no informa del coste">
            <span>Presupuesto máx.</span>
            <span className="orch-exec-config-unit">$</span>
            <input type="number" className="input" min={0} step={0.5} placeholder="sin límite"
              value={execConfig.maxBudgetUSD || ''}
              onChange={e => setExecConfig(c => ({ ...c, maxBudgetUSD: Math.max(0, Number(e.target.value) || 0) || undefined }))} />
          </label>
          <label className="orch-exec-config-check">
            <input type="checkbox" checked={execConfig.stopOnError} onChange={e => setExecConfig(c => ({ ...c, stopOnError: e.target.checked }))} />
            <span>Detener ante el primer error</span>
          </label>
          {(execConfig.stepTimeout ?? 600_000) > execConfig.timeout && (
            <div className="orch-exec-config-warn">
              <i className="ti ti-alert-triangle" /> El timeout por paso supera al total: cada paso tendrá como mucho lo que quede del total.
            </div>
          )}
        </div>
      )}

      {errors.length > 0 && (
        <div className="orch-error-banner">
          {errors.map((e, i) => (
            <div key={i}><i className="ti ti-alert-circle" /> {e}</div>
          ))}
        </div>
      )}

      <div className="orch-editor-body" onDragEnd={handleDragEnd}>
        {/* Left: palette */}
        <div className={`orch-palette-panel${paletteOpen ? '' : ' collapsed'}`}>
          {paletteOpen ? (
            <>
              <div className="orch-palette-header">
                <div className="orch-palette-tabs">
                  <button
                    className={`orch-palette-tab${paletteTab === 'agents' ? ' active' : ''}`}
                    onClick={() => setPaletteTab('agents')}
                  >
                    <i className="ti ti-cpu" />
                    Agentes
                    {filteredAgents.length > 0 && (
                      <span className="orch-palette-tab-count">{filteredAgents.length}</span>
                    )}
                  </button>
                  <button
                    className={`orch-palette-tab${paletteTab === 'scripts' ? ' active' : ''}`}
                    onClick={() => setPaletteTab('scripts')}
                  >
                    <i className="ti ti-terminal-2" />
                    Scripts
                    {scripts.length > 0 && (
                      <span className="orch-palette-tab-count">{scripts.length}</span>
                    )}
                  </button>
                </div>
                <button className="orch-palette-collapse-btn" onClick={() => setPaletteOpen(false)} title="Colapsar paleta">
                  <i className="ti ti-layout-sidebar-left-collapse" />
                </button>
              </div>

              {paletteTab === 'agents' && (
                <div className="orch-picker-search">
                  <i className="ti ti-search" />
                  <input
                    type="text"
                    placeholder="Buscar agente…"
                    value={agentSearch}
                    onChange={e => setAgentSearch(e.target.value)}
                  />
                  {agentSearch && (
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 0, display: 'flex' }} onClick={() => setAgentSearch('')}>
                      <i className="ti ti-x" style={{ fontSize: 11 }} />
                    </button>
                  )}
                </div>
              )}

              <div className="orch-palette-list">
                {paletteTab === 'agents' ? (
                  filteredAgents.length === 0 ? (
                    <div className="orch-picker-empty">
                      {agentSearch ? 'Sin resultados' : 'Sin agentes disponibles'}
                    </div>
                  ) : (
                    filteredAgents.map(a => (
                      <div
                        key={a.name}
                        className="orch-palette-card"
                        draggable
                        onDragStart={e => handlePaletteDragStart(a.name, e)}
                        title={a.description || 'Arrastra al canvas para añadir'}
                      >
                        <div className="orch-palette-card-icon">
                          <i className={`ti ${getAgentIcon(a.name)}`} />
                        </div>
                        <div className="orch-palette-info">
                          <div className="orch-palette-name">{a.name}</div>
                          {a.description && <div className="orch-palette-desc">{a.description}</div>}
                          {modelShort(a.model ?? '') && (
                            <span className={`orch-palette-model model-${modelShort(a.model ?? '')}`}>{modelShort(a.model ?? '')}</span>
                          )}
                        </div>
                        <i className="ti ti-grip-vertical orch-palette-grip" />
                      </div>
                    ))
                  )
                ) : (
                  scripts.length === 0 ? (
                    <div className="orch-picker-empty">Sin scripts disponibles</div>
                  ) : (
                    <>
                      {builtinScripts.length > 0 && (
                        <>
                          <div className="orch-palette-section-label">Scripts</div>
                          {builtinScripts.map(s => (
                            <div
                              key={s.name}
                              className="orch-palette-card orch-palette-card-script"
                              draggable
                              onDragStart={e => handlePaletteDragStart(`__script:${s.name}__`, e)}
                              title={s.description || 'Script determinístico — sin IA'}
                            >
                              <div className="orch-palette-card-icon orch-palette-card-icon-script">
                                <i className="ti ti-terminal-2" />
                              </div>
                              <div className="orch-palette-info">
                                <div className="orch-palette-name">{s.label}</div>
                                {s.description && <div className="orch-palette-desc">{s.description}</div>}
                                <span className="orch-palette-script-badge">sin IA · determinístico</span>
                              </div>
                              <i className="ti ti-grip-vertical orch-palette-grip" />
                            </div>
                          ))}
                        </>
                      )}
                      {externalScripts.length > 0 && (
                        <>
                          <div className="orch-palette-section-label">Scripts personalizados</div>
                          {externalScripts.map(s => (
                            <div
                              key={s.name}
                              className="orch-palette-card orch-palette-card-script orch-palette-card-script-external"
                              draggable
                              onDragStart={e => handlePaletteDragStart(`__script:${s.name}__`, e)}
                              title={s.description || 'Script externo — sin IA'}
                            >
                              <div className="orch-palette-card-icon orch-palette-card-icon-script">
                                <i className="ti ti-puzzle" />
                              </div>
                              <div className="orch-palette-info">
                                <div className="orch-palette-name">
                                  {s.label}
                                  {s.hasWarnings && <i className="ti ti-alert-triangle" style={{ color: 'var(--amber)', fontSize: 11, marginLeft: 5 }} />}
                                </div>
                                {s.description && <div className="orch-palette-desc">{s.description}</div>}
                                <span className="orch-palette-script-badge">personalizado · sin IA</span>
                              </div>
                              <i className="ti ti-grip-vertical orch-palette-grip" />
                            </div>
                          ))}
                        </>
                      )}
                    </>
                  )
                )}
              </div>

              {dagNodes.length > 0 && (
                <div className="orch-palette-inuse">
                  <i className="ti ti-layout-list" />
                  {dagNodes.length} en el flujo
                </div>
              )}
            </>
          ) : (
            <div className="orch-palette-strip">
              <button className="orch-palette-strip-btn" onClick={() => setPaletteOpen(true)} title="Expandir paleta">
                <i className="ti ti-layout-sidebar-left-expand" />
              </button>
              <div className="orch-palette-strip-divider" />
              <button
                className={`orch-palette-strip-btn${paletteTab === 'agents' ? ' active' : ''}`}
                onClick={() => { setPaletteTab('agents'); setPaletteOpen(true); }}
                title={`Agentes (${filteredAgents.length} disponibles)`}
              >
                <i className="ti ti-cpu" />
              </button>
              <button
                className={`orch-palette-strip-btn${paletteTab === 'scripts' ? ' active' : ''}`}
                onClick={() => { setPaletteTab('scripts'); setPaletteOpen(true); }}
                title={`Scripts (${builtinScripts.length + externalScripts.length})`}
              >
                <i className="ti ti-terminal-2" />
              </button>
            </div>
          )}
        </div>

        {/* Center: Canvas */}
        <div
          className={`orch-canvas-panel${isDragging ? ' panning' : ''}`}
          ref={canvasPanelRef}
          onDragOver={handleCanvasDragOver}
          onDrop={handleCanvasDrop}
        >
          <NodeCanvas
            nodes={dagNodes}
            onNodesChange={setDagNodes}
            selectedEdge={selectedEdge}
            onSelectEdge={setSelectedEdge}
            agentModels={agentModels}
            agentDescriptions={agentDescriptions}
            externalScriptNames={new Set(externalScripts.map(s => s.name))}
            scriptsWithRequiredParams={scriptsWithRequiredParams}
            isDraggingFromPalette={isDragging}
          />
        </div>

        {/* Right: Connection configurator */}
        <div className="orch-config-panel">
          {configuratorNode ? (
            <ConnectionConfigurator
              node={configuratorNode}
              fromAgent={fromAgentName}
              toAgent={toAgentName}
              isInputNode={isInputNode}
              onUpdate={handleUpdateNode}
              scriptParams={scriptParams}
            />
          ) : (
            <div className="orch-config-placeholder">
              <i className="ti ti-arrows-exchange" />
              <p>Selecciona una arista o un nodo raíz para configurarlo</p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="orch-editor-footer">
        <button className="btn ghost" onClick={onBack}>
          <i className="ti ti-arrow-left" /> Volver
        </button>
        <button
          className="btn primary"
          onClick={onExecute}
          disabled={dagNodes.length < 2 || errors.length > 0}
        >
          <i className="ti ti-player-play" /> Ejecutar
        </button>
      </div>
    </div>
  );
}
