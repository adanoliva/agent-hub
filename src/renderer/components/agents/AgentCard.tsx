import React from 'react';
import type { Agent, SelectedNode } from '../../types';
import { agentIcon, MODEL_ICON, LEVEL_COLOR } from '../../constants/tools';

interface Props {
  agent: Agent;
  selected?: boolean;
  suggested?: boolean;
  node: SelectedNode;
  onClick: () => void;
  onChatWith?: (agent: Agent) => void;
  onExecute?: (agent: Agent) => void;
}

export function AgentCard({ agent: a, selected, suggested, node, onClick, onChatWith, onExecute }: Props) {
  const ic        = agentIcon(a.name);
  const model     = a.model || 'sonnet';
  const mIcon     = MODEL_ICON[model] ?? 'ti-bolt';
  const iconColor = suggested ? 'var(--text2)' : (LEVEL_COLOR[node.level] ?? 'var(--accent)');
  const isProject = node.level === 'project' && !suggested;

  return (
    <div
      className={`agent-card${selected ? ' selected' : ''}${suggested ? ' suggested' : ''}`}
      onClick={onClick}
    >
      <div className="agent-card-head">
        <div className="agent-icon" style={{ background: 'var(--bg3)' }}>
          <i className={`ti ${ic}`} style={{ color: iconColor }} />
        </div>
        <span className="agent-name">{a.name}</span>
        {suggested && (
          <span className="badge accent" style={{ fontSize: 9 }}>
            <i className="ti ti-sparkles" />sugerido
          </span>
        )}
      </div>
      <div className="agent-desc">{a.description ?? ''}</div>
      <div className="agent-footer">
        {(a.tools ?? []).slice(0, 3).map((t) => (
          <span key={t} className="tool-pill">{t}</span>
        ))}
        {(a.tools ?? []).length > 3 && (
          <span style={{ fontSize: 10, color: 'var(--text3)' }}>+{(a.tools ?? []).length - 3}</span>
        )}
        <span className={`tool-pill model-${model}`} style={{ marginLeft: 'auto' }}>
          <i className={`ti ${mIcon}`} />{model}
        </span>
      </div>

      {isProject && (onChatWith || onExecute) && (
        <div className="agent-card-actions" onClick={(e) => e.stopPropagation()}>
          {onChatWith && (
            <button
              className="btn ghost sm"
              onClick={() => onChatWith(a)}
              title="Abrir chat con este agente"
            >
              <i className="ti ti-message-chatbot" /> Chat
            </button>
          )}
          {onExecute && (
            <button
              className="btn sm"
              onClick={() => onExecute(a)}
              title="Ejecutar tarea rápida"
              style={{ color: 'var(--amber)' }}
            >
              <i className="ti ti-zap" /> Ejecutar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
