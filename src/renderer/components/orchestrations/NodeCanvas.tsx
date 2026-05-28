import React from 'react';
import type { OrchestrateNode } from '../../types';

interface Props {
  agents:          string[];
  nodes:           OrchestrateNode[];
  selectedNode:    number | null;
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
export const CANVAS_SLOT_H  = 100; // ZONE_H + NODE_H
export const CANVAS_PAD_TOP = 10;
export const CANVAS_ZONE_H  = 32;
export const CANVAS_W_CONST = 270;

const ZONE_H   = CANVAS_ZONE_H;
const NODE_H   = 68;
const NODE_W   = 190;
const SLOT_H   = CANVAS_SLOT_H;
const PAD_TOP  = CANVAS_PAD_TOP;
const PAD_BOT  = 10;
const CANVAS_W = CANVAS_W_CONST;
const CX       = CANVAS_W / 2;

export function NodeCanvas({
  agents, nodes, selectedNode, onSelectNode,
  onNodeDragStart, onDropAtZone, dragOverZone, onDragOverZone,
  isDragging, draggingNodeIdx, onRemoveAgent,
}: Props) {
  const n       = agents.length;
  const canvasH = PAD_TOP + Math.max(n, 0) * SLOT_H + ZONE_H + PAD_BOT;
  const nodeLeft = (CANVAS_W - NODE_W) / 2;

  const yNodeTop    = (i: number) => PAD_TOP + i * SLOT_H + ZONE_H;
  const yNodeBottom = (i: number) => PAD_TOP + (i + 1) * SLOT_H;

  return (
    <div className="orch-node-canvas" style={{ position: 'relative', width: CANVAS_W, height: canvasH }}>

      {/* Empty state — rendered behind everything via z-index */}
      {n === 0 && (
        <div className="orch-canvas-empty" style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
          <i className="ti ti-topology-ring-2" />
          <p>Arrastra agentes desde el panel izquierdo</p>
        </div>
      )}

      {/* ── SVG connections — below zones, no pointer-events when dragging ── */}
      <svg
        width={CANVAS_W}
        height={canvasH}
        style={{ position: 'absolute', top: 0, left: 0, zIndex: 1, pointerEvents: isDragging ? 'none' : 'all' }}
      >
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

      {/* ── Drop zones — visual feedback only, events handled by parent panel ── */}
      {Array.from({ length: n + 1 }, (_, zi) => (
        <div
          key={`zone-${zi}`}
          className={`orch-drop-zone${dragOverZone === zi ? ' active' : ''}${isDragging ? ' dragging-active' : ''}`}
          style={{
            position: 'absolute',
            top:      PAD_TOP + zi * SLOT_H,
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
