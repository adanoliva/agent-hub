import React, { useState, useEffect, useRef } from 'react';
import { req } from '../../api';
import type { Orchestration, OrchestrateNode, DataFlow, ContextExtra, Agent } from '../../types';
import { NodeCanvas, getAgentIcon, CANVAS_SLOT_H, CANVAS_PAD_TOP } from './NodeCanvas';
import { ConnectionConfigurator } from './ConnectionConfigurator';
import { useStore } from '../../store';

interface Props {
  orchestration: Orchestration;
  onSave:        (data: Partial<Orchestration>) => Promise<void>;
  onBack:        () => void;
  onExecute:     () => void;
}

const DEFAULT_DATA_FLOW: DataFlow = {
  agentOutput:   true,
  filesModified: true,
  projectContext:      true,
  selectiveFiles: [],
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
    dataFlow:     { ...DEFAULT_DATA_FLOW, selectiveFiles: [] },
    contextExtra: { fixed: { freeText: '', files: [] }, temporal: [] },
  };
}

export function OrchestrationEditor({ orchestration, onSave, onBack, onExecute }: Props) {
  const addToast = useStore(s => s.addToast);

  const [name,        setName]        = useState(orchestration.name);
  const [description, setDescription] = useState(orchestration.description);
  const [agents,      setAgents]      = useState<string[]>(orchestration.agents);
  const [nodes,       setNodes]       = useState<OrchestrateNode[]>(orchestration.nodes);
  const [selectedNode, setSelectedNode] = useState<number | null>(null);
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

  // Load available agents
  useEffect(() => {
    req<Agent[]>('GET', '/agents/flat')
      .then(a => setAllAgents(a))
      .catch(() => {});
  }, []);

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
  const handlePaletteDragStart = (agentName: string, e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'copy';
    draggingRef.current = { type: 'palette', payload: agentName };
    setIsDragging(true);
    setDraggingNodeIdx(null);
  };

  const handleNodeDragStart = (idx: number, e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    draggingRef.current = { type: 'node', payload: idx };
    setIsDragging(true);
    setDraggingNodeIdx(idx);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setDraggingNodeIdx(null);
    setDragOverZone(null);
    draggingRef.current = null;
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
    setNodes(ns => ns.map(n => n.id === updated.id ? updated : n));
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
      await onSave({ name, description, agents, nodes });
      setErrors([]);
    } finally {
      setIsSaving(false);
    }
  };

  const filteredAgents = allAgents.filter(a =>
    a.name.toLowerCase().includes(agentSearch.toLowerCase()) ||
    a.description?.toLowerCase().includes(agentSearch.toLowerCase())
  );

  // Canvas needs a stable drag end when pointer leaves window
  const canvasPanelRef = useRef<HTMLDivElement>(null);

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
    const zone = Math.max(0, Math.min(agents.length, Math.round((yRelCanvas - CANVAS_PAD_TOP - CANVAS_SLOT_H / 4) / CANVAS_SLOT_H)));
    setDragOverZone(zone);
  };

  const handleCanvasDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const panel = canvasPanelRef.current;
    if (!panel) return;
    const panelRect = panel.getBoundingClientRect();
    const yRelCanvas = e.clientY - panelRect.top - 20 + panel.scrollTop;
    const zone = Math.max(0, Math.min(agents.length, Math.round((yRelCanvas - CANVAS_PAD_TOP - CANVAS_SLOT_H / 4) / CANVAS_SLOT_H)));
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
              <div className="orch-picker-empty">Sin resultados</div>
            ) : (
              filteredAgents.map(a => {
                const inUse = agents.includes(a.name);
                return (
                  <div
                    key={a.name}
                    className={`orch-palette-card${inUse ? ' in-use' : ''}`}
                    draggable={!inUse}
                    onDragStart={e => !inUse && handlePaletteDragStart(a.name, e)}
                    title={inUse ? 'Ya está en la secuencia' : 'Arrastra al canvas para añadir'}
                  >
                    <div className="orch-palette-card-icon">
                      <i className={`ti ${getAgentIcon(a.name)}`} />
                    </div>
                    <div className="orch-palette-info">
                      <div className="orch-palette-name">{a.name}</div>
                      {a.description && <div className="orch-palette-desc">{a.description}</div>}
                    </div>
                    {inUse
                      ? <i className="ti ti-check orch-palette-check" />
                      : <i className="ti ti-grip-vertical orch-palette-grip" />
                    }
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Center: Canvas */}
        <div
          className="orch-canvas-panel"
          ref={canvasPanelRef}
          onDragOver={handleCanvasDragOver}
          onDrop={handleCanvasDrop}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverZone(null); }}
        >
          <NodeCanvas
            agents={agents}
            nodes={nodes}
            selectedNode={selectedNode}
            onSelectNode={idx => setSelectedNode(selectedNode === idx ? null : idx)}
            onNodeDragStart={handleNodeDragStart}
            onDropAtZone={handleDropAtZone}
            dragOverZone={dragOverZone}
            onDragOverZone={setDragOverZone}
            isDragging={isDragging}
            draggingNodeIdx={draggingNodeIdx}
            onRemoveAgent={removeAgent}
          />
        </div>

        {/* Right: Connection configurator */}
        <div className="orch-config-panel">
          {selectedNode !== null && nodes[selectedNode] ? (
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
