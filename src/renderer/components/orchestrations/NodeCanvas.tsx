import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { OrchestrationNode } from '../../types';

export const NODE_W = 244;
export const NODE_H = 80;
const CTRL_OFFSET = 80;

export interface SelectedEdge {
  fromId: string | null;  // null = root node (no predecessor)
  toId:   string;
}

interface ScriptMeta {
  name:    string;
  label:   string;
  builtin: boolean;
}

interface Props {
  nodes:                      OrchestrationNode[];
  onNodesChange:              (nodes: OrchestrationNode[]) => void;
  selectedEdge:               SelectedEdge | null;
  onSelectEdge:               (edge: SelectedEdge | null) => void;
  executionState?:            Map<string, 'pending' | 'running' | 'done' | 'error'>;
  scripts?:                   ScriptMeta[];
  agentModels?:               Record<string, string>;
  agentDescriptions?:         Record<string, string>;
  externalScriptNames?:       Set<string>;
  scriptsWithRequiredParams?: Set<string>;
  isDraggingFromPalette?:     boolean;
}

export function getAgentIcon(name: string): string {
  if (name.startsWith('__script:')) return 'ti-terminal-2';
  const n = name.toLowerCase();
  if (n.includes('test'))     return 'ti-flask';
  if (n.includes('refactor')) return 'ti-wand';
  if (n.includes('doc'))      return 'ti-file-description';
  if (n.includes('security')) return 'ti-shield';
  if (n.includes('review'))   return 'ti-eye';
  if (n.includes('git'))      return 'ti-git-branch';
  if (n.includes('debug'))    return 'ti-bug';
  if (n.includes('api'))      return 'ti-api';
  return 'ti-cpu';
}

function getScriptLabel(name: string): string {
  return name.replace(/^__script:/, '').replace(/__$/, '');
}

function hasNodeConfig(node: OrchestrationNode): boolean {
  return !!(
    node.contextExtra?.fixed?.freeText?.trim() ||
    (node.contextExtra?.fixed?.files?.length ?? 0) > 0 ||
    (node.contextExtra?.temporal?.length ?? 0) > 0
  );
}

function bezierPt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function topologicalLevels(nodes: OrchestrationNode[]): string[][] {
  const inDeg = new Map(nodes.map(n => [n.id, n.dependsOn.length]));
  const succ  = new Map<string, string[]>(nodes.map(n => [n.id, []]));
  for (const n of nodes)
    for (const dep of n.dependsOn)
      succ.get(dep)?.push(n.id);

  const levels: string[][] = [];
  let frontier = nodes.filter(n => n.dependsOn.length === 0).map(n => n.id);
  while (frontier.length > 0) {
    levels.push(frontier);
    const next: string[] = [];
    for (const id of frontier)
      for (const s of (succ.get(id) ?? [])) {
        const d = (inDeg.get(s) ?? 0) - 1;
        inDeg.set(s, d);
        if (d === 0) next.push(s);
      }
    frontier = next;
  }
  return levels;
}

const ORCH_ABOVE = 100; // px gap between Orchestrator bottom and first level

export function autoLayoutNodes(nodes: OrchestrationNode[]): OrchestrationNode[] {
  if (nodes.length === 0) return nodes;
  const levels = topologicalLevels(nodes);
  const LEVEL_H  = 160;
  const GAP_X    = 32;
  // Leave room above for the Orchestrator node (NODE_H=80) + gap (100) + padding (20)
  const PAD_Y    = 20 + NODE_H + ORCH_ABOVE;
  const CENTER_X = 400;

  const nodeMap = new Map(nodes.map(n => [n.id, { ...n }]));

  for (let li = 0; li < levels.length; li++) {
    const lvl    = levels[li];
    const totalW = lvl.length * NODE_W + (lvl.length - 1) * GAP_X;
    const startX = CENTER_X - totalW / 2;
    lvl.forEach((id, j) => {
      const node = nodeMap.get(id)!;
      node.x = Math.max(20, startX + j * (NODE_W + GAP_X));
      node.y = PAD_Y + li * LEVEL_H;
    });
  }

  return nodes.map(n => nodeMap.get(n.id) ?? n);
}

function hasCycle(nodes: OrchestrationNode[], fromId: string, toId: string): boolean {
  const succ = new Map<string, string[]>(nodes.map(n => [n.id, []]));
  for (const n of nodes)
    for (const dep of n.dependsOn)
      succ.get(dep)?.push(n.id);

  const queue   = [toId];
  const visited = new Set([toId]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === fromId) return true;
    for (const s of (succ.get(cur) ?? []))
      if (!visited.has(s)) { visited.add(s); queue.push(s); }
  }
  return false;
}

export function NodeCanvas({
  nodes, onNodesChange, selectedEdge, onSelectEdge,
  executionState, agentModels = {}, agentDescriptions = {},
  externalScriptNames = new Set(), scriptsWithRequiredParams = new Set(),
}: Props) {
  const [dragging,   setDragging]   = useState<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [mousePos,   setMousePos]   = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-layout on mount if any node lacks position
  useEffect(() => {
    if (nodes.length > 0 && nodes.some(n => n.x == null || n.y == null))
      onNodesChange(autoLayoutNodes(nodes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cancel connecting on Escape
  useEffect(() => {
    if (!connecting) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { setConnecting(null); setMousePos(null); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [connecting]);

  const getCanvasPos = useCallback((clientX: number, clientY: number) => {
    const rect   = containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const parent = containerRef.current?.parentElement;
    return {
      x: clientX - rect.left + (parent?.scrollLeft ?? 0),
      y: clientY - rect.top  + (parent?.scrollTop  ?? 0),
    };
  }, []);

  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    if (connecting) return;
    e.stopPropagation();
    const pos  = getCanvasPos(e.clientX, e.clientY);
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    setDragging({ nodeId, offsetX: pos.x - (node.x ?? 0), offsetY: pos.y - (node.y ?? 0) });
  }, [connecting, nodes, getCanvasPos]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const pos = getCanvasPos(e.clientX, e.clientY);
    if (connecting) setMousePos(pos);
    if (!dragging) return;
    onNodesChange(nodes.map(n =>
      n.id === dragging.nodeId
        ? { ...n, x: Math.max(0, pos.x - dragging.offsetX), y: Math.max(0, pos.y - dragging.offsetY) }
        : n
    ));
  }, [dragging, connecting, nodes, onNodesChange, getCanvasPos]);

  const handleMouseUp = useCallback(() => setDragging(null), []);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (connecting) { setConnecting(null); setMousePos(null); return; }
    const t = e.target as Element;
    if (t === containerRef.current || t.closest('.orch-canvas-svg') && !t.closest('.orch-edge-group'))
      onSelectEdge(null);
  }, [connecting, onSelectEdge]);

  const handleNodeClick = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (dragging) return;
    if (connecting) {
      if (connecting === '__orch__') {
        // Connecting from Orchestrator → floating node only
        const target = nodes.find(n => n.id === nodeId);
        if (target && target.dependsOn.length === 0 && target.isRoot === false) {
          onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, isRoot: true } : n));
          onSelectEdge({ fromId: null, toId: nodeId });
        }
        setConnecting(null);
        setMousePos(null);
        return;
      }
      if (connecting === nodeId) { setConnecting(null); return; }
      const target = nodes.find(n => n.id === nodeId);
      if (!target || target.dependsOn.includes(connecting)) { setConnecting(null); return; }
      if (hasCycle(nodes, connecting, nodeId)) { setConnecting(null); return; }
      onNodesChange(nodes.map(n =>
        n.id === nodeId ? { ...n, dependsOn: [...n.dependsOn, connecting] } : n
      ));
      onSelectEdge({ fromId: connecting, toId: nodeId });
      setConnecting(null);
      setMousePos(null);
      return;
    }
    const node = nodes.find(n => n.id === nodeId);
    // Only select the Orch→node edge if the node is an actual root (not floating)
    if (node?.dependsOn.length === 0 && node.isRoot !== false) onSelectEdge({ fromId: null, toId: nodeId });
  }, [dragging, connecting, nodes, onNodesChange, onSelectEdge]);

  const handlePortOutClick = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    setConnecting(prev => prev === nodeId ? null : nodeId);
  }, []);

  const handleEdgeClick = useCallback((fromId: string, toId: string) => {
    if (connecting) return;
    onSelectEdge({ fromId, toId });
  }, [connecting, onSelectEdge]);

  const handleDeleteEdge = useCallback((e: React.MouseEvent, fromId: string, toId: string) => {
    e.stopPropagation();
    onNodesChange(nodes.map(n =>
      n.id === toId ? { ...n, dependsOn: n.dependsOn.filter(id => id !== fromId) } : n
    ));
    if (selectedEdge?.fromId === fromId && selectedEdge?.toId === toId) onSelectEdge(null);
  }, [nodes, onNodesChange, selectedEdge, onSelectEdge]);

  const handleRemoveNode = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    const remaining = nodes.filter(n => n.id !== nodeId).map(n => ({ ...n, dependsOn: n.dependsOn.filter(id => id !== nodeId) }));
    onNodesChange(remaining);
    if (selectedEdge?.toId === nodeId || selectedEdge?.fromId === nodeId) onSelectEdge(null);
    if (connecting === nodeId) setConnecting(null);
    // Cancel orch-connecting if no floating nodes remain after removal
    if (connecting === '__orch__') {
      const stillFloating = remaining.some(n => n.dependsOn.length === 0 && n.isRoot === false);
      if (!stillFloating) setConnecting(null);
    }
  }, [nodes, onNodesChange, selectedEdge, onSelectEdge, connecting]);

  const handleAutoLayout = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onNodesChange(autoLayoutNodes(nodes));
  }, [nodes, onNodesChange]);

  const nodeMap  = new Map(nodes.map(n => [n.id, n]));
  const roots    = nodes.filter(n => n.dependsOn.length === 0 && n.isRoot !== false);
  const floating = nodes.filter(n => n.dependsOn.length === 0 && n.isRoot === false);

  // Orchestrator node: centered above root nodes, not stored in dagNodes
  const orchCenterX = roots.length > 0
    ? roots.reduce((sum, n) => sum + (n.x ?? 0) + NODE_W / 2, 0) / roots.length
    : 440;
  const orchX = Math.max(20, orchCenterX - NODE_W / 2);
  const orchY = roots.length > 0
    ? Math.min(...roots.map(n => n.y ?? (NODE_H + ORCH_ABOVE + 20))) - ORCH_ABOVE - NODE_H
    : 20;
  const orchBottom = orchY + NODE_H;

  const canvasW = Math.max(880, ...nodes.map(n => (n.x ?? 0) + NODE_W + 80), orchX + NODE_W + 80);
  const canvasH = Math.max(520, ...nodes.map(n => (n.y ?? 0) + NODE_H + 120), orchBottom + 120);

  const connectingNode = connecting && connecting !== '__orch__' ? nodeMap.get(connecting) : null;
  const connX = connecting === '__orch__'
    ? orchX + NODE_W / 2
    : connectingNode ? (connectingNode.x ?? 0) + NODE_W / 2 : 0;
  const connY = connecting === '__orch__'
    ? orchBottom
    : connectingNode ? (connectingNode.y ?? 0) + NODE_H : 0;

  return (
    <div
      className="orch-canvas-2d"
      ref={containerRef}
      style={{ position: 'relative', width: canvasW, height: canvasH, userSelect: dragging ? 'none' : undefined }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleCanvasClick}
    >
      {nodes.length === 0 && (
        <div className="orch-canvas-empty" style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
          <i className="ti ti-topology-ring-2" />
          <p>Arrastra agentes desde el panel izquierdo para construir tu flujo</p>
        </div>
      )}

      {nodes.length > 1 && (
        <button className="btn ghost sm orch-auto-layout-btn" onClick={handleAutoLayout} title="Reordenar automáticamente">
          <i className="ti ti-layout-distribute-vertical" /> Reordenar
        </button>
      )}

      {/* SVG edges layer */}
      <svg
        className="orch-canvas-svg"
        width={canvasW}
        height={canvasH}
        style={{ position: 'absolute', top: 0, left: 0, zIndex: 1, pointerEvents: 'none' }}
      >
        {/* Orchestrator → root node edges */}
        {roots.map(root => {
          const x1 = orchX + NODE_W / 2;
          const y1 = orchBottom;
          const x2 = (root.x ?? 0) + NODE_W / 2;
          const y2 = root.y ?? 0;
          const cp1x = x1; const cp1y = y1 + CTRL_OFFSET;
          const cp2x = x2; const cp2y = y2 - CTRL_OFFSET;
          const d = `M ${x1} ${y1} C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${x2} ${y2}`;
          const isSelected = selectedEdge?.fromId === null && selectedEdge?.toId === root.id;
          const configured = hasNodeConfig(root);
          const mx = bezierPt(x1, cp1x, cp2x, x2, 0.5);
          const my = bezierPt(y1, cp1y, cp2y, y2, 0.5);
          const adx = x2 - cp2x; const ady = y2 - cp2y;
          const alen = Math.sqrt(adx * adx + ady * ady) || 1;
          const anx = adx / alen; const any = ady / alen;
          const apx = -any; const apy = anx;
          const AL = 10; const AW = 5;
          const aBase = { x: x2 - anx * AL, y: y2 - any * AL };
          return (
            <g
              key={`orch-${root.id}`}
              className={`orch-edge-group${isSelected ? ' selected' : ''}`}
              style={{ pointerEvents: 'all', cursor: 'pointer' }}
              onClick={() => !connecting && onSelectEdge({ fromId: null, toId: root.id })}
            >
              <path d={d} stroke="transparent" strokeWidth={16} fill="none" />
              <path d={d} stroke="rgba(124,106,247,.12)" strokeWidth={6} fill="none" strokeLinecap="round" />
              <path d={d} className={`orch-conn-flow${isSelected ? ' selected' : ''}`} strokeWidth={isSelected ? 2.5 : 2} fill="none" strokeLinecap="round" strokeDasharray="6 5" />
              <polygon points={`${x2},${y2} ${aBase.x + apx * AW},${aBase.y + apy * AW} ${aBase.x - apx * AW},${aBase.y - apy * AW}`} className={`orch-conn-arrow${isSelected ? ' selected' : ''}`} />
              <circle cx={mx} cy={my} r={12} className={`orch-conn-dot${isSelected ? ' selected' : ''}${configured ? ' configured' : ''}`} />
              {configured
                ? <text x={mx} y={my + 4.5} textAnchor="middle" fontSize={12} className="orch-conn-dot-icon">⚙</text>
                : <text x={mx} y={my + 4}   textAnchor="middle" fontSize={11} className="orch-conn-dot-icon-dim">↓</text>
              }
              {isSelected && (
                <g
                  style={{ cursor: 'pointer', pointerEvents: 'all' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onNodesChange(nodes.map(n => n.id === root.id ? { ...n, isRoot: false } : n));
                    onSelectEdge(null);
                  }}
                >
                  <circle cx={mx} cy={my - 22} r={9} fill="var(--bg2)" stroke="var(--coral)" strokeWidth={1.5} />
                  <text x={mx} y={my - 18} textAnchor="middle" fontSize={10} style={{ fill: 'var(--coral)', fontWeight: 700, pointerEvents: 'none' }}>✕</text>
                </g>
              )}
            </g>
          );
        })}

        {nodes.flatMap(toNode =>
          toNode.dependsOn.map(fromId => {
            const fromNode = nodeMap.get(fromId);
            if (!fromNode) return null;

            const x1 = (fromNode.x ?? 0) + NODE_W / 2;
            const y1 = (fromNode.y ?? 0) + NODE_H;
            const x2 = (toNode.x ?? 0) + NODE_W / 2;
            const y2 = (toNode.y ?? 0);
            const cp1x = x1; const cp1y = y1 + CTRL_OFFSET;
            const cp2x = x2; const cp2y = y2 - CTRL_OFFSET;
            const d = `M ${x1} ${y1} C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${x2} ${y2}`;

            const isSelected = selectedEdge?.fromId === fromId && selectedEdge?.toId === toNode.id;
            const configured = hasNodeConfig(toNode);
            const mx = bezierPt(x1, cp1x, cp2x, x2, 0.5);
            const my = bezierPt(y1, cp1y, cp2y, y2, 0.5);

            const adx = x2 - cp2x; const ady = y2 - cp2y;
            const alen = Math.sqrt(adx * adx + ady * ady) || 1;
            const anx = adx / alen; const any = ady / alen;
            const apx = -any; const apy = anx;
            const AL = 10; const AW = 5;
            const aBase = { x: x2 - anx * AL, y: y2 - any * AL };

            return (
              <g
                key={`${fromId}-${toNode.id}`}
                className={`orch-edge-group${isSelected ? ' selected' : ''}`}
                style={{ pointerEvents: 'all', cursor: 'pointer' }}
                onClick={() => handleEdgeClick(fromId, toNode.id)}
              >
                <path d={d} stroke="transparent" strokeWidth={16} fill="none" />
                <path d={d} stroke="rgba(124,106,247,.12)" strokeWidth={6} fill="none" strokeLinecap="round" />
                <path
                  d={d}
                  className={`orch-conn-flow${isSelected ? ' selected' : ''}`}
                  strokeWidth={isSelected ? 2.5 : 2}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray="6 5"
                />
                <polygon
                  points={`${x2},${y2} ${aBase.x + apx * AW},${aBase.y + apy * AW} ${aBase.x - apx * AW},${aBase.y - apy * AW}`}
                  className={`orch-conn-arrow${isSelected ? ' selected' : ''}`}
                />
                <circle
                  cx={mx} cy={my} r={12}
                  className={`orch-conn-dot${isSelected ? ' selected' : ''}${configured ? ' configured' : ''}`}
                />
                {configured
                  ? <text x={mx} y={my + 4.5} textAnchor="middle" fontSize={12} className="orch-conn-dot-icon">⚙</text>
                  : <text x={mx} y={my + 4}   textAnchor="middle" fontSize={11} className="orch-conn-dot-icon-dim">↓</text>
                }
                {toNode.gateAfter && (
                  <text x={mx + 20} y={my + 4} textAnchor="middle" fontSize={11} style={{ fill: 'var(--amber)', pointerEvents: 'none' }}>⏸</text>
                )}
                {isSelected && (
                  <g
                    style={{ cursor: 'pointer', pointerEvents: 'all' }}
                    onClick={(e) => handleDeleteEdge(e as unknown as React.MouseEvent, fromId, toNode.id)}
                  >
                    <circle cx={mx} cy={my - 22} r={9} fill="var(--bg2)" stroke="var(--coral)" strokeWidth={1.5} />
                    <text x={mx} y={my - 18} textAnchor="middle" fontSize={10} style={{ fill: 'var(--coral)', fontWeight: 700, pointerEvents: 'none' }}>✕</text>
                  </g>
                )}
              </g>
            );
          })
        )}

        {/* In-progress connection line */}
        {connecting && (connecting === '__orch__' || connectingNode) && mousePos && (
          <line
            x1={connX} y1={connY} x2={mousePos.x} y2={mousePos.y}
            stroke="var(--accent)"
            strokeWidth={2}
            strokeDasharray="5 4"
            style={{ pointerEvents: 'none' }}
          />
        )}
      </svg>

      {/* Orchestrator entry node — static, not in dagNodes */}
      <div
        className={`orch-node-agent orch-node-entry${connecting === '__orch__' ? ' connecting-source' : ''}`}
        style={{ position: 'absolute', left: orchX, top: orchY, width: NODE_W, height: NODE_H, zIndex: 2, cursor: 'default' }}
      >
        <div className="orch-node-icon"><i className="ti ti-circuit-diode" /></div>
        <div className="orch-node-info">
          <div className="orch-node-name">Orquestador</div>
          <span className="orch-node-model model-orch">punto de entrada</span>
        </div>
        <span className="orch-node-entry-badge">INICIO</span>
        {!executionState && floating.length > 0 && (
          <div
            className={`orch-node-port-out${connecting === '__orch__' ? ' active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setConnecting(prev => prev === '__orch__' ? null : '__orch__'); }}
            title="Conectar con nodo flotante"
          />
        )}
      </div>

      {/* Nodes */}
      {nodes.map(node => {
        const isScript   = node.agentName.startsWith('__script:');
        const scriptName = isScript ? getScriptLabel(node.agentName) : '';
        const isExternal = isScript && externalScriptNames.has(scriptName);
        const label      = isScript ? scriptName : node.agentName;
        const model      = agentModels[node.agentName] || '';
        const desc       = agentDescriptions[node.agentName] || '';
        const missingParams = isScript && scriptsWithRequiredParams.has(scriptName)
          && !(node.scriptParams && Object.keys(node.scriptParams).length > 0);

        const execStatus  = executionState?.get(node.id);
        const isSelFrom   = selectedEdge?.fromId === node.id;
        const isSelTo     = selectedEdge?.toId   === node.id;
        const isConnSrc   = connecting === node.id;
        const isFloating  = node.dependsOn.length === 0 && node.isRoot === false;
        // Valid target when connecting from Orchestrator: only floating nodes
        // Valid target when connecting from another node: any node except source
        const isValidConnTarget = connecting === '__orch__'
          ? isFloating
          : !!(connecting && connecting !== node.id);
        const isDragged   = dragging?.nodeId === node.id;

        let cls = 'orch-node-agent';
        if (isScript)   cls += ' orch-node-script';
        if (isFloating) cls += ' orch-floating';
        if (model)      cls += ` model-${model}`;
        if (execStatus === 'running')  cls += ' exec-running';
        else if (execStatus === 'done')   cls += ' exec-done';
        else if (execStatus === 'error')  cls += ' exec-error';
        else if (execStatus === 'pending') cls += ' exec-pending';
        if (isSelFrom || isSelTo) cls += ' node-active';
        if (isConnSrc) cls += ' connecting-source';

        return (
          <div
            key={node.id}
            className={cls}
            title={desc || label}
            style={{
              position: 'absolute',
              left:   node.x ?? 0,
              top:    node.y ?? 0,
              width:  NODE_W,
              height: NODE_H,
              zIndex: isDragged ? 10 : 2,
              cursor: isDragged ? 'grabbing' : (connecting ? (isValidConnTarget ? 'crosshair' : 'not-allowed') : 'grab'),
              opacity: connecting ? (isConnSrc ? 1 : (isValidConnTarget ? 1 : 0.6)) : 1,
            }}
            onMouseDown={e => handleNodeMouseDown(e, node.id)}
            onClick={e => handleNodeClick(e, node.id)}
          >
            <div className="orch-node-drag-handle"><i className="ti ti-grip-vertical" /></div>
            <div className="orch-node-index">{nodes.indexOf(node) + 1}</div>
            <div className="orch-node-icon"><i className={`ti ${getAgentIcon(node.agentName)}`} /></div>
            <div className="orch-node-info">
              <div className="orch-node-name">
                {label}
                {missingParams && (
                  <i className="ti ti-alert-triangle" style={{ color: 'var(--amber)', fontSize: 11, marginLeft: 5 }} title="Faltan parámetros obligatorios" />
                )}
              </div>
              {isScript
                ? <span className={`orch-node-model ${isExternal ? 'model-script-external' : 'model-script'}`}>{isExternal ? 'personalizado' : 'script'}</span>
                : model && <span className={`orch-node-model model-${model}`}>{model}</span>
              }
            </div>

            {execStatus === 'running' && (
              <i className="ti ti-loader-2 spin" style={{ color: 'var(--accent)', fontSize: 14, flexShrink: 0 }} />
            )}

            <button
              className="btn ghost xs orch-node-remove"
              onClick={e => handleRemoveNode(e, node.id)}
              title="Quitar"
            >
              <i className="ti ti-x" />
            </button>

            {/* Port-out (bottom) — shown unless in read-only execution mode */}
            {!executionState && (
              <div
                className={`orch-node-port-out${isConnSrc ? ' active' : ''}`}
                onClick={e => handlePortOutClick(e, node.id)}
                title="Conectar con otro nodo"
              />
            )}

            {/* Port-in indicator (top) — shown only when this node is a valid connection target */}
            {isValidConnTarget && (
              <div className="orch-node-port-in" />
            )}
          </div>
        );
      })}
    </div>
  );
}
