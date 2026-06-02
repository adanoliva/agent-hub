import React from 'react';
import type { OrchestrateNode } from '../../types';

interface Props {
  agents:          string[];
  nodes:           OrchestrateNode[];
  inputNode?:      OrchestrateNode;
  selectedNode:    number | null;      // -1 = inputNode selected
  onSelectNode:    (idx: number) => void;
  onNodeDragStart: (idx: number, e: React.DragEvent) => void;
  onDropAtZone:    (zone: number) => void;
  dragOverZone:    number | null;
  onDragOverZone:  (zone: number | null) => void;
  isDragging:      boolean;
  draggingNodeIdx: number | null;
  onRemoveAgent:   (idx: number) => void;
  agentModels?:    Record<string, string>;
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

function hasConfig(node: OrchestrateNode): boolean {
  return !!(
    node.contextExtra?.fixed?.freeText?.trim() ||
    (node.contextExtra?.fixed?.files?.length ?? 0) > 0 ||
    (node.contextExtra?.temporal?.length ?? 0) > 0
  );
}

const NODE_H = 80;
const ZONE_H = 48;  // connection gap between nodes

export const CANVAS_SLOT_H        = NODE_H + ZONE_H;   // 128
export const CANVAS_PAD_TOP       = 16;
export const CANVAS_ZONE_H        = ZONE_H;
export const CANVAS_W_CONST       = 300;
export const CANVAS_ORCH_NODE_H   = NODE_H;             // same height as agent nodes
export const CANVAS_ORCH_CONN_H   = 0;
export const CANVAS_AGENTS_OFFSET = CANVAS_PAD_TOP + CANVAS_ORCH_NODE_H + CANVAS_ORCH_CONN_H;

const ORCH_NODE_H = CANVAS_ORCH_NODE_H;
const NODE_W      = 244;
const SLOT_H      = CANVAS_SLOT_H;
const PAD_TOP     = CANVAS_PAD_TOP;
const PAD_BOT     = 24;
const CANVAS_W    = CANVAS_W_CONST;
const CX          = CANVAS_W / 2;
const ORCH_CONN_H = CANVAS_ORCH_CONN_H;

// Arrow and line geometry
const LINE_TOP_GAP = 3;    // gap from node bottom to line start
const ARROW_H      = 13;   // height of arrowhead
const ARROW_W      = 7;    // half-width of arrowhead
const LINE_END_GAP = 2;    // gap from arrowhead tip to node top

export function NodeCanvas({
  agents, nodes, inputNode, selectedNode, onSelectNode,
  onNodeDragStart, onDropAtZone, dragOverZone, onDragOverZone,
  isDragging, draggingNodeIdx, onRemoveAgent, agentModels = {},
}: Props) {
  const n = agents.length;

  const orchNodeTop  = PAD_TOP;
  const orchNodeBot  = orchNodeTop + ORCH_NODE_H;
  const agentsOffset = orchNodeBot + ORCH_CONN_H;
  const canvasH      = agentsOffset + Math.max(n, 0) * SLOT_H + ZONE_H + PAD_BOT;
  const nodeLeft     = (CANVAS_W - NODE_W) / 2;

  const yNodeTop    = (i: number) => agentsOffset + i * SLOT_H + ZONE_H;
  const yNodeBottom = (i: number) => agentsOffset + (i + 1) * SLOT_H;

  const inputCfg = !!(
    inputNode?.contextExtra?.fixed?.freeText?.trim() ||
    (inputNode?.contextExtra?.fixed?.files?.length ?? 0) > 0 ||
    (inputNode?.contextExtra?.temporal?.length ?? 0) > 0
  );
  const inputConnEndY = n > 0 ? yNodeTop(0) : agentsOffset;
  const inputConnMidY = (orchNodeBot + inputConnEndY) / 2;
  const inputConnSel  = selectedNode === -1;

  const hasSelection = selectedNode !== null;

  // Which agent indices are "active" (participants of the selected connection)
  function agentState(i: number): 'active' | 'inactive' | 'neutral' {
    if (!hasSelection) return 'neutral';
    if (selectedNode === -1) return i === 0 ? 'active' : 'inactive';
    return (i === selectedNode || i === selectedNode + 1) ? 'active' : 'inactive';
  }

  const orchState = !hasSelection ? 'neutral' : selectedNode === -1 ? 'active' : 'inactive';

  function renderConn(
    y1: number, y2: number, midY: number,
    sel: boolean, cfg: boolean,
    onClick: () => void,
  ) {
    const lineY1   = y1 + LINE_TOP_GAP;
    const arrowTip = y2 - LINE_END_GAP;
    const arrowBot = arrowTip - ARROW_H;
    const lineY2   = arrowBot;

    return (
      <g style={{ cursor: 'pointer' }} onClick={onClick}>
        {/* Click target */}
        <rect x={CX - 22} y={y1} width={44} height={y2 - y1} fill="transparent" />

        {/* Track */}
        <line
          x1={CX} y1={lineY1} x2={CX} y2={lineY2}
          stroke="rgba(124,106,247,.12)" strokeWidth={6} strokeLinecap="round"
        />

        {/* Animated flow line */}
        <line
          x1={CX} y1={lineY1} x2={CX} y2={lineY2}
          className={`orch-conn-flow${sel ? ' selected' : ''}`}
          strokeWidth={sel ? 2.5 : 2}
          strokeLinecap="round"
          strokeDasharray="6 5"
        />

        {/* Arrowhead */}
        <polygon
          points={`${CX - ARROW_W},${arrowBot} ${CX + ARROW_W},${arrowBot} ${CX},${arrowTip}`}
          className={`orch-conn-arrow${sel ? ' selected' : ''}`}
        />

        {/* Mid dot */}
        <circle
          cx={CX} cy={midY} r={12}
          className={`orch-conn-dot${sel ? ' selected' : ''}${cfg ? ' configured' : ''}`}
        />
        {cfg
          ? <text x={CX} y={midY + 4.5} textAnchor="middle" fontSize={12} className="orch-conn-dot-icon">⚙</text>
          : <text x={CX} y={midY + 4}   textAnchor="middle" fontSize={11} className="orch-conn-dot-icon-dim">↓</text>
        }
      </g>
    );
  }

  return (
    <div className="orch-node-canvas" style={{ position: 'relative', width: CANVAS_W, height: canvasH }}>

      {/* Empty state */}
      {n === 0 && (
        <div className="orch-canvas-empty" style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
          <i className="ti ti-topology-ring-2" />
          <p>Arrastra agentes desde el panel izquierdo para construir tu flujo</p>
        </div>
      )}

      {/* ── SVG: connections (below nodes) ── */}
      <svg
        width={CANVAS_W}
        height={canvasH}
        style={{ position: 'absolute', top: 0, left: 0, zIndex: 1, pointerEvents: isDragging ? 'none' : 'all' }}
      >
        {/* Orquestador → Agent[0] */}
        {n > 0 && renderConn(
          orchNodeBot, inputConnEndY, inputConnMidY,
          inputConnSel, inputCfg,
          () => onSelectNode(-1),
        )}

        {/* Inter-agent connections */}
        {nodes.map((node, i) => {
          const y1   = yNodeBottom(i);
          const y2   = yNodeTop(i + 1);
          const midY = (y1 + y2) / 2;
          return renderConn(y1, y2, midY, selectedNode === i, hasConfig(node), () => onSelectNode(i));
        })}
      </svg>

      {/* ── Orchestrator node — same card structure as agent nodes ── */}
      <div
        className={`orch-node-agent orch-node-entry node-${orchState}`}
        style={{ position: 'absolute', top: orchNodeTop, left: nodeLeft, width: NODE_W, height: ORCH_NODE_H, zIndex: 2 }}
      >
        <div className="orch-node-icon"><i className="ti ti-circuit-diode" /></div>
        <div className="orch-node-info">
          <div className="orch-node-name">Orquestador</div>
          <span className="orch-node-model model-orch">punto de entrada</span>
        </div>
        <span className="orch-node-entry-badge">INICIO</span>
      </div>

      {/* ── Drop zones ── */}
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
      {agents.map((agentName, i) => {
        const model    = agentModels[agentName] || '';
        const isScript = agentName.startsWith('__script:');
        const label    = isScript ? getScriptLabel(agentName) : agentName;
        return (
          <div
            key={i}
            className={`orch-node-agent${isScript ? ' orch-node-script' : ''}${model ? ` model-${model}` : ''} node-${agentState(i)}${draggingNodeIdx === i ? ' dragging' : ''}`}
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
            <div className="orch-node-info">
              <div className="orch-node-name" title={agentName}>{label}</div>
              {isScript
                ? <span className="orch-node-model model-script">script</span>
                : model && <span className={`orch-node-model model-${model}`}>{model}</span>
              }
            </div>
            <button
              className="btn ghost xs orch-node-remove"
              onClick={e => { e.stopPropagation(); onRemoveAgent(i); }}
              title="Quitar"
            >
              <i className="ti ti-x" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
