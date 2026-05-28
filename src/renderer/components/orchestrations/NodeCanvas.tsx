import React from 'react';
import type { OrchestrateNode } from '../../types';

interface Props {
  agents:          string[];
  nodes:           OrchestrateNode[];
  inputNode?:      OrchestrateNode;    // Orquestador → Agent[0] connection
  selectedNode:    number | null;      // -1 = inputNode selected
  onSelectNode:    (idx: number) => void;
  onNodeDragStart: (idx: number, e: React.DragEvent) => void;
  onDropAtZone:    (zone: number) => void;
  dragOverZone:    number | null;
  onDragOverZone:  (zone: number | null) => void;
  isDragging:      boolean;
  draggingNodeIdx: number | null;
  onRemoveAgent:   (idx: number) => void;
}

export function getAgentIcon(name: string): string {
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

function hasConfig(node: OrchestrateNode): boolean {
  return !!(
    node.contextExtra?.fixed?.freeText?.trim() ||
    (node.contextExtra?.fixed?.files?.length ?? 0) > 0 ||
    (node.contextExtra?.temporal?.length ?? 0) > 0 ||
    (node.dataFlow?.selectiveFiles?.length ?? 0) > 0
  );
}

// Exported so parent can compute zone from cursor Y
export const CANVAS_SLOT_H       = 100; // ZONE_H + NODE_H
export const CANVAS_PAD_TOP      = 10;
export const CANVAS_ZONE_H       = 32;
export const CANVAS_W_CONST      = 270;
export const CANVAS_ORCH_NODE_H  = 44;   // height of Orchestrator fixed node
export const CANVAS_ORCH_CONN_H  = 40;   // gap between Orchestrator node and first agent zone
// Agents Y-offset = CANVAS_PAD_TOP + CANVAS_ORCH_NODE_H + CANVAS_ORCH_CONN_H
export const CANVAS_AGENTS_OFFSET = CANVAS_PAD_TOP + CANVAS_ORCH_NODE_H + CANVAS_ORCH_CONN_H;

const ZONE_H       = CANVAS_ZONE_H;
const NODE_H       = 68;
const ORCH_NODE_H  = CANVAS_ORCH_NODE_H;
const NODE_W       = 190;
const SLOT_H       = CANVAS_SLOT_H;
const PAD_TOP      = CANVAS_PAD_TOP;
const PAD_BOT      = 10;
const CANVAS_W     = CANVAS_W_CONST;
const CX           = CANVAS_W / 2;
const ORCH_CONN_H  = CANVAS_ORCH_CONN_H;

export function NodeCanvas({
  agents, nodes, inputNode, selectedNode, onSelectNode,
  onNodeDragStart, onDropAtZone, dragOverZone, onDragOverZone,
  isDragging, draggingNodeIdx, onRemoveAgent,
}: Props) {
  const n = agents.length;

  // Layout: Orchestrator node → ORCH_CONN_H gap → (zones + agent nodes)
  const orchNodeTop  = PAD_TOP;
  const orchNodeBot  = orchNodeTop + ORCH_NODE_H;
  const agentsOffset = orchNodeBot + ORCH_CONN_H;  // where agent slots start
  const canvasH      = agentsOffset + Math.max(n, 0) * SLOT_H + ZONE_H + PAD_BOT;
  const nodeLeft     = (CANVAS_W - NODE_W) / 2;

  const yNodeTop    = (i: number) => agentsOffset + i * SLOT_H + ZONE_H;
  const yNodeBottom = (i: number) => agentsOffset + (i + 1) * SLOT_H;

  // inputNode config indicator
  const inputCfg = !!(
    inputNode?.contextExtra?.fixed?.freeText?.trim() ||
    (inputNode?.contextExtra?.fixed?.files?.length ?? 0) > 0 ||
    (inputNode?.contextExtra?.temporal?.length ?? 0) > 0
  );
  const inputConnMidY = orchNodeBot + ORCH_CONN_H / 2;
  const inputConnSel  = selectedNode === -1;

  return (
    <div className="orch-node-canvas" style={{ position: 'relative', width: CANVAS_W, height: canvasH }}>

      {/* Empty state */}
      {n === 0 && (
        <div className="orch-canvas-empty" style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
          <i className="ti ti-topology-ring-2" />
          <p>Arrastra agentes desde el panel izquierdo</p>
        </div>
      )}

      {/* ── Orchestrator (fixed entry node) ── */}
      <div
        style={{
          position: 'absolute',
          top: orchNodeTop,
          left: nodeLeft,
          width: NODE_W,
          height: ORCH_NODE_H,
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--bg3)',
          border: '1.5px solid var(--accent)',
          borderRadius: 8,
          padding: '0 12px',
          cursor: 'default',
          userSelect: 'none',
        }}
      >
        <i className="ti ti-circuit-diode" style={{ color: 'var(--accent)', fontSize: 16 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', flex: 1 }}>Orquestador</span>
        <span style={{ fontSize: 10, color: 'var(--text3)' }}>entrada</span>
      </div>

      {/* ── SVG: inputNode connection + inter-agent connections ── */}
      <svg
        width={CANVAS_W}
        height={canvasH}
        style={{ position: 'absolute', top: 0, left: 0, zIndex: 1, pointerEvents: isDragging ? 'none' : 'all' }}
      >
        {/* Orquestador → Agent[0] connection */}
        {n > 0 && (
          <g style={{ cursor: 'pointer' }} onClick={() => onSelectNode(-1)}>
            <rect x={CX - 16} y={orchNodeBot} width={32} height={ORCH_CONN_H} fill="transparent" />
            <line
              x1={CX} y1={orchNodeBot} x2={CX} y2={agentsOffset - 8}
              className={`orch-conn-line${inputConnSel ? ' selected' : ''}`}
              strokeWidth={inputConnSel ? 3 : 2}
            />
            <polygon
              points={`${CX - 6},${agentsOffset - 8} ${CX + 6},${agentsOffset - 8} ${CX},${agentsOffset}`}
              className={`orch-conn-arrow${inputConnSel ? ' selected' : ''}`}
            />
            <circle
              cx={CX} cy={inputConnMidY} r={9}
              className={`orch-conn-dot${inputConnSel ? ' selected' : ''}${inputCfg ? ' configured' : ''}`}
            />
            {inputCfg && (
              <text x={CX} y={inputConnMidY + 4} textAnchor="middle" fontSize={9} className="orch-conn-dot-icon">⚙</text>
            )}
          </g>
        )}

        {/* Inter-agent connections */}
        {nodes.map((node, i) => {
          const y1   = yNodeBottom(i);
          const y2   = yNodeTop(i + 1);
          const midY = (y1 + y2) / 2;
          const sel  = selectedNode === i;
          const cfg  = hasConfig(node);

          return (
            <g key={node.id} style={{ cursor: 'pointer' }} onClick={() => onSelectNode(i)}>
              <rect x={CX - 16} y={y1} width={32} height={y2 - y1} fill="transparent" />
              <line
                x1={CX} y1={y1} x2={CX} y2={y2 - 8}
                className={`orch-conn-line${sel ? ' selected' : ''}`}
                strokeWidth={sel ? 3 : 2}
              />
              <polygon
                points={`${CX - 6},${y2 - 8} ${CX + 6},${y2 - 8} ${CX},${y2}`}
                className={`orch-conn-arrow${sel ? ' selected' : ''}`}
              />
              <circle
                cx={CX} cy={midY} r={9}
                className={`orch-conn-dot${sel ? ' selected' : ''}${cfg ? ' configured' : ''}`}
              />
              {cfg && (
                <text x={CX} y={midY + 4} textAnchor="middle" fontSize={9} className="orch-conn-dot-icon">⚙</text>
              )}
            </g>
          );
        })}
      </svg>

      {/* ── Drop zones — visual feedback only ── */}
      {Array.from({ length: n + 1 }, (_, zi) => (
        <div
          key={`zone-${zi}`}
          className={`orch-drop-zone${dragOverZone === zi ? ' active' : ''}${isDragging ? ' dragging-active' : ''}`}
          style={{
            position: 'absolute',
            top:      agentsOffset + zi * SLOT_H,
            left:     nodeLeft,
            width:    NODE_W,
            height:   ZONE_H,
            zIndex:   3,
            pointerEvents: 'none',
          }}
        />
      ))}

      {/* ── Agent nodes ── */}
      {agents.map((agentName, i) => (
        <div
          key={i}
          className={`orch-node-agent${draggingNodeIdx === i ? ' dragging' : ''}`}
          draggable
          onDragStart={e => onNodeDragStart(i, e)}
          style={{
            position: 'absolute',
            top:      yNodeTop(i),
            left:     nodeLeft,
            width:    NODE_W,
            height:   NODE_H,
            zIndex:   2,
          }}
        >
          <div className="orch-node-drag-handle"><i className="ti ti-grip-vertical" /></div>
          <div className="orch-node-index">{i + 1}</div>
          <div className="orch-node-icon"><i className={`ti ${getAgentIcon(agentName)}`} /></div>
          <div className="orch-node-name" title={agentName}>{agentName}</div>
          <button
            className="btn ghost xs orch-node-remove"
            onClick={e => { e.stopPropagation(); onRemoveAgent(i); }}
            title="Quitar"
          >
            <i className="ti ti-x" />
          </button>
        </div>
      ))}
    </div>
  );
}
