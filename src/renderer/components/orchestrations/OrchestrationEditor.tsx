import React, { useState, useEffect, useRef } from 'react';
import { req } from '../../api';
import type { Orchestration, OrchestrateNode, DataFlow, ContextExtra, Agent } from '../../types';
import { NodeCanvas, getAgentIcon, CANVAS_SLOT_H, CANVAS_AGENTS_OFFSET } from './NodeCanvas';
import { ConnectionConfigurator } from './ConnectionConfigurator';
import { useStore } from '../../store';

interface Props {
  orchestration: Orchestration;
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

function makeNode(from: number, to: number): OrchestrateNode {
  return {
    id:           `node-${from}-${to}-${Date.now()}`,
    from,
    to,
    dataFlow:     { ...DEFAULT_DATA_FLOW },
    contextExtra: { fixed: { freeText: '', files: [] }, temporal: [] },
  };
}

export function OrchestrationEditor({ orchestration, onSave, onBack, onExecute }: Props) {
  const addToast = useStore(s => s.addToast);

  const [name,        setName]        = useState(orchestration.name);
  const [description, setDescription] = useState(orchestration.description);
  const [agents,      setAgents]      = useState<string[]>(orchestration.agents);
  const [nodes,       setNodes]       = useState<OrchestrateNode[]>(orchestration.nodes);
  const [inputNode,   setInputNode]   = useState<OrchestrateNode>(() =>
    orchestration.inputNode ?? {
      id:           `input-node-${Date.now()}`,
      from:         -1,
      to:           0,
      dataFlow:     { agentOutput: false, filesModified: false, projectContext: true },
      contextExtra: { fixed: { freeText: '', files: [] }, temporal: [] },
    }
  );
  const [selectedNode, setSelectedNode] = useState<number | null>(null);  // -1 = inputNode
  const [isSaving,    setIsSaving]    = useState(false);
  const [validating,  setValidating]  = useState(false);

  // DnD state
  const [isDragging,      setIsDragging]      = useState(false);
  const [draggingNodeIdx, setDraggingNodeIdx] = useState<number | null>(null);
  const [dragOverZone,    setDragOverZone]    = useState<number | null>(null);
  const draggingRef = useRef<{ type: 'palette' | 'node'; payload: string | number } | null>(null);
  const [errors,      setErrors]      = useState<string[]>([]);

  const [allAgents,   setAllAgents]   = useState<Agent[]>([]);
  const [agentSearch, setAgentSearch] = useState('');


  // Load all agents for this project: applicable (global/section/tech) + project-level.
  // After loading, purge from the canvas any agent that no longer exists on disk.
  useEffect(() => {
    const applyAgents = (fetched: Agent[], currentAgents: string[], currentNodes: OrchestrateNode[]) => {
      const seen = new Set<string>();
      const merged: Agent[] = [];
      for (const a of fetched) {
        if (!seen.has(a.name)) { seen.add(a.name); merged.push(a); }
      }
      setAllAgents(merged);

      // Remove from the canvas any agent that no longer exists on disk
      const existingNames = new Set(merged.map(a => a.name));
      const cleaned = currentAgents.filter(name => existingNames.has(name));
      if (cleaned.length !== currentAgents.length) {
        setAgents(cleaned);
        setNodes(rebuildNodes(cleaned, currentNodes));
      }
    };

    // Capture state snapshots at effect run time (mount / project change)
    const snapshotAgents = agents;
    const snapshotNodes  = nodes;

    if (!orchestration.projectId) {
      req<Agent[]>('GET', '/agents/flat')
        .then(a => applyAgents(a, snapshotAgents, snapshotNodes))
        .catch(() => {});
      return;
    }
    Promise.all([
      req<Agent[]>('GET', `/agents/applicable?projectId=${encodeURIComponent(orchestration.projectId)}`).catch(() => [] as Agent[]),
      req<Agent[]>('GET', `/projects/${encodeURIComponent(orchestration.projectId)}/agents`).catch(() => [] as Agent[]),
    ]).then(([applicable, projectAgents]) =>
      applyAgents([...applicable, ...projectAgents], snapshotAgents, snapshotNodes),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orchestration.projectId]);

  // Rebuild nodes preserving config by position
  const rebuildNodes = (newAgents: string[], currentNodes: OrchestrateNode[]): OrchestrateNode[] => {
    if (newAgents.length < 2) return [];
    return Array.from({ length: newAgents.length - 1 }, (_, i) => {
      const old = currentNodes[i];
      return old ? { ...old, from: i, to: i + 1 } : makeNode(i, i + 1);
    });
  };

  const removeAgent = (index: number) => {
    const newAgents = agents.filter((_, i) => i !== index);
    const newNodes  = rebuildNodes(newAgents, nodes);
    setAgents(newAgents);
    setNodes(newNodes);
    if (selectedNode !== null && selectedNode >= newNodes.length) {
      setSelectedNode(newNodes.length > 0 ? newNodes.length - 1 : null);
    }
  };

  // ── DnD handlers ──
  const dragGhostRef = useRef<HTMLElement | null>(null);

  const clearDragGhost = (e: React.DragEvent) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    canvas.style.cssText = 'position:fixed;top:-9999px;left:-9999px;pointer-events:none';
    document.body.appendChild(canvas);
    e.dataTransfer.setDragImage(canvas, 0, 0);
    dragGhostRef.current = canvas;
  };

  const handlePaletteDragStart = (agentName: string, e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'copy';
    clearDragGhost(e);
    draggingRef.current = { type: 'palette', payload: agentName };
    setIsDragging(true);
    setDraggingNodeIdx(null);
  };

  const handleNodeDragStart = (idx: number, e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    clearDragGhost(e);
    draggingRef.current = { type: 'node', payload: idx };
    setIsDragging(true);
    setDraggingNodeIdx(idx);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setDraggingNodeIdx(null);
    setDragOverZone(null);
    draggingRef.current = null;
    if (dragGhostRef.current) {
      document.body.removeChild(dragGhostRef.current);
      dragGhostRef.current = null;
    }
  };

  const handleDropAtZone = (zone: number) => {
    const drag = draggingRef.current;
    if (!drag) return;
    let newAgents = [...agents];
    if (drag.type === 'palette') {
      const agentName = drag.payload as string;
      if (agents.includes(agentName)) return;
      newAgents.splice(zone, 0, agentName);
    } else {
      const fromIdx = drag.payload as number;
      const [moved] = newAgents.splice(fromIdx, 1);
      const insertAt = zone > fromIdx ? zone - 1 : zone;
      newAgents.splice(insertAt, 0, moved);
      setSelectedNode(null);
    }
    setAgents(newAgents);
    setNodes(rebuildNodes(newAgents, nodes));
    handleDragEnd();
  };

  const handleUpdateNode = (updated: OrchestrateNode) => {
    if (updated.from === -1) {
      setInputNode(updated);
    } else {
      setNodes(ns => ns.map(n => n.id === updated.id ? updated : n));
    }
  };

  const handleValidate = async () => {
    if (agents.length < 2) {
      setErrors(['Necesitas al menos 2 agentes']);
      return;
    }
    setValidating(true);
    try {
      // Save first so validation uses current state
      await onSave({ name, description, agents, nodes });
      const result = await req<{ valid: boolean; errors: string[] }>(
        'POST', `/orchestrations/${orchestration.id}/validate`
      );
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
      await onSave({ name, description, agents, nodes, inputNode });
      setErrors([]);
    } finally {
      setIsSaving(false);
    }
  };

  const filteredAgents = allAgents.filter(a =>
    !agents.includes(a.name) && (
      a.name.toLowerCase().includes(agentSearch.toLowerCase()) ||
      a.description?.toLowerCase().includes(agentSearch.toLowerCase())
    )
  );

  const agentModels: Record<string, string> = {};
  for (const a of allAgents) {
    const m = a.model || '';
    if (m.includes('haiku'))  agentModels[a.name] = 'haiku';
    else if (m.includes('opus'))   agentModels[a.name] = 'opus';
    else if (m.includes('sonnet')) agentModels[a.name] = 'sonnet';
  }

  function modelShort(m: string): string {
    if (!m) return '';
    if (m.includes('haiku'))  return 'haiku';
    if (m.includes('opus'))   return 'opus';
    if (m.includes('sonnet')) return 'sonnet';
    return '';
  }

  // Canvas needs a stable drag end when pointer leaves window
  const canvasPanelRef  = useRef<HTMLDivElement>(null);

  // Pan-on-background-drag
  const isPanning       = useRef(false);
  const panStartY       = useRef(0);
  const panStartScroll  = useRef(0);
  const [panning, setPanning] = useState(false);

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging) return;
    const t = e.target as HTMLElement;
    const onBackground =
      t === canvasPanelRef.current ||
      t.classList.contains('orch-node-canvas') ||
      t.classList.contains('orch-canvas-empty');
    if (!onBackground) return;
    isPanning.current    = true;
    panStartY.current    = e.clientY;
    panStartScroll.current = canvasPanelRef.current?.scrollTop ?? 0;
    setPanning(true);
    e.preventDefault();
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPanning.current || !canvasPanelRef.current) return;
    canvasPanelRef.current.scrollTop = panStartScroll.current - (e.clientY - panStartY.current);
  };

  const stopPanning = () => {
    if (!isPanning.current) return;
    isPanning.current = false;
    setPanning(false);
  };

  // Panel-level drag handlers — work regardless of precise cursor position over zones
  const handleCanvasDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = draggingRef.current.type === 'palette' ? 'copy' : 'move';
    // Calculate zone from cursor Y relative to canvas content
    const panel = canvasPanelRef.current;
    if (!panel) return;
    const panelRect = panel.getBoundingClientRect();
    // panel has padding:20px, canvas is centered horizontally but top-aligned
    const yRelCanvas = e.clientY - panelRect.top - 20 + panel.scrollTop;
    const zone = Math.max(0, Math.min(agents.length, Math.round((yRelCanvas - CANVAS_AGENTS_OFFSET - CANVAS_SLOT_H / 4) / CANVAS_SLOT_H)));
    setDragOverZone(zone);
  };

  const handleCanvasDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const panel = canvasPanelRef.current;
    if (!panel) return;
    const panelRect = panel.getBoundingClientRect();
    const yRelCanvas = e.clientY - panelRect.top - 20 + panel.scrollTop;
    const zone = Math.max(0, Math.min(agents.length, Math.round((yRelCanvas - CANVAS_AGENTS_OFFSET - CANVAS_SLOT_H / 4) / CANVAS_SLOT_H)));
    handleDropAtZone(zone);
  };
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

      {/* Validation errors */}
      {errors.length > 0 && (
        <div className="orch-error-banner">
          {errors.map((e, i) => (
            <div key={i}><i className="ti ti-alert-circle" /> {e}</div>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="orch-editor-body" onDragEnd={handleDragEnd}>
        {/* Left: Agent palette */}
        <div className="orch-palette-panel">
          <div className="orch-panel-title">
            <i className="ti ti-package" /> Agentes
            {agents.length > 0 && (
              <span className="orch-palette-used-count">{agents.length} en uso</span>
            )}
          </div>
          <div className="orch-picker-search">
            <i className="ti ti-search" />
            <input
              type="text"
              placeholder="Buscar..."
              value={agentSearch}
              onChange={e => setAgentSearch(e.target.value)}
            />
          </div>
          <div className="orch-palette-list">
            {filteredAgents.length === 0 ? (
              <div className="orch-picker-empty">
                {agentSearch
                  ? 'Sin resultados'
                  : agents.length > 0 && allAgents.length > 0 && allAgents.every(a => agents.includes(a.name))
                    ? <><i className="ti ti-checks" style={{ fontSize: 22, marginBottom: 6, display: 'block' }} />Todos los agentes están en el flujo</>
                    : 'Sin agentes disponibles'
                }
              </div>
            ) : (
              filteredAgents.map(a => (
                <div
                  key={a.name}
                  className="orch-palette-card"
                  draggable
                  onDragStart={e => handlePaletteDragStart(a.name, e)}
                  title="Arrastra al canvas para añadir"
                >
                  <div className="orch-palette-card-icon">
                    <i className={`ti ${getAgentIcon(a.name)}`} />
                  </div>
                  <div className="orch-palette-info">
                    <div className="orch-palette-name">{a.name}</div>
                    {a.description && <div className="orch-palette-desc">{a.description}</div>}
                    {modelShort(a.model) && (
                      <span className={`orch-palette-model model-${modelShort(a.model)}`}>{modelShort(a.model)}</span>
                    )}
                  </div>
                  <i className="ti ti-grip-vertical orch-palette-grip" />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Center: Canvas */}
        <div
          className={`orch-canvas-panel${panning || isDragging ? ' panning' : ''}`}
          ref={canvasPanelRef}
          onDragOver={handleCanvasDragOver}
          onDrop={handleCanvasDrop}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverZone(null); }}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={stopPanning}
          onMouseLeave={stopPanning}
        >
          <NodeCanvas
            agents={agents}
            nodes={nodes}
            inputNode={inputNode}
            selectedNode={selectedNode}
            onSelectNode={idx => setSelectedNode(selectedNode === idx ? null : idx)}
            onNodeDragStart={handleNodeDragStart}
            onDropAtZone={handleDropAtZone}
            dragOverZone={dragOverZone}
            onDragOverZone={setDragOverZone}
            isDragging={isDragging}
            draggingNodeIdx={draggingNodeIdx}
            onRemoveAgent={removeAgent}
            agentModels={agentModels}
          />
        </div>

        {/* Right: Connection configurator */}
        <div className="orch-config-panel">
          {selectedNode === -1 ? (
            <ConnectionConfigurator
              node={inputNode}
              fromAgent="Orquestador"
              toAgent={agents[0] ?? ''}
              isInputNode
              onUpdate={handleUpdateNode}
            />
          ) : selectedNode !== null && nodes[selectedNode] ? (
            <ConnectionConfigurator
              node={nodes[selectedNode]}
              fromAgent={agents[nodes[selectedNode].from]}
              toAgent={agents[nodes[selectedNode].to]}
              onUpdate={handleUpdateNode}
            />
          ) : (
            <div className="orch-config-placeholder">
              <i className="ti ti-arrows-exchange" />
              <p>Selecciona una conexión<br />para configurarla</p>
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
          disabled={agents.length < 2 || errors.length > 0}
        >
          <i className="ti ti-player-play" /> Ejecutar
        </button>
      </div>
    </div>
  );
}
