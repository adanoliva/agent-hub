import React from 'react';
import { useStore } from '../../store';
import { useCategoryHelpers } from '../../hooks/useCategoryHelpers';
import { AgentCard } from './AgentCard';
import type { Agent, SelectedNode } from '../../types';

interface Props {
  node: SelectedNode;
  agents: Agent[];
  suggestions: Agent[];
  suggestionsLoading: boolean;
  selectedAgent: string | null;
  onSelectAgent: (agent: Agent) => void;
  onUseSuggestion: (agent: Agent) => void;
  onNewAgent: () => void;
  onRefreshSuggestions: () => void;
  onChatWithAgent?: (agent: Agent) => void;
  searchActive?: boolean;
}

export function AgentsCenter({
  node, agents, suggestions, suggestionsLoading,
  selectedAgent, onSelectAgent, onUseSuggestion, onNewAgent, onRefreshSuggestions,
  onChatWithAgent, searchActive,
}: Props) {
  const config   = useStore((s) => s.config);
  const projects = useStore((s) => s.projects);
  const { catName, techName } = useCategoryHelpers();

  const isProject = node.level === 'project';

  const title = (() => {
    if (node.level === 'section') return catName(node.categoryId ?? '');
    if (node.level === 'tech')    return `${catName(node.categoryId ?? '')} → ${techName(node.categoryId ?? '', node.techId ?? '')}`;
    if (node.level === 'project') return projects.find((p) => p.id === node.projectId)?.name ?? 'Proyecto';
    if (node.level === 'uncategorized') return 'Sin categoría';
    return 'Global';
  })();

  const isEmpty = !agents.length && !suggestionsLoading && !suggestions.length;

  return (
    <div className="agents-center" id="agents-center">
      <div className="agents-panel-head">
        <span className="agents-panel-title">
          {searchActive ? <><i className="ti ti-search" style={{ marginRight: 6, color: 'var(--text2)' }} />Resultados de búsqueda</> : title}
        </span>
        {!searchActive && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn sm primary" onClick={onNewAgent}>
              <i className="ti ti-plus" /> Nuevo agente
            </button>
            <button className="btn sm" onClick={onRefreshSuggestions} disabled={suggestionsLoading}>
              {suggestionsLoading
                ? <div className="spin" />
                : <i className="ti ti-sparkles" />
              }
              {' '}{isProject ? 'Sugerir para este proyecto' : 'Sugerir más'}
            </button>
          </div>
        )}
      </div>

      <div className="agents-content" id="agents-content">
        {isEmpty ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, gap: 10, color: 'var(--text2)' }}>
            <i className={`ti ${searchActive ? 'ti-search-off' : 'ti-cpu'}`} style={{ fontSize: 40, opacity: 0.2 }} />
            <div style={{ fontSize: 13, color: 'var(--text1)' }}>{searchActive ? 'Sin resultados' : 'Sin agentes en este nivel'}</div>
            <div style={{ fontSize: 12 }}>{searchActive ? 'Prueba con otro término' : 'Crea el primero o espera las sugerencias de IA'}</div>
          </div>
        ) : (
          <div className="agents-grid">
            {agents.map((a) => (
              <AgentCard
                key={a.name}
                agent={a}
                node={node}
                selected={selectedAgent === a.name}
                onClick={() => onSelectAgent(a)}
                onChatWith={onChatWithAgent}
              />
            ))}

            {!suggestionsLoading && suggestions.length > 0 && (
              <>
                <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 8, marginTop: agents.length ? 8 : 0, marginBottom: 4 }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'var(--mono)', letterSpacing: '.05em' }}>
                    {isProject ? 'sugerencias para este proyecto' : 'sugerencias'}
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
                {suggestions.map((s, i) => (
                  <AgentCard
                    key={`sug-${i}`}
                    agent={s}
                    node={node}
                    suggested
                    onClick={() => onUseSuggestion(s)}
                  />
                ))}
              </>
            )}

            {suggestionsLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text2)', fontSize: 12, gridColumn: '1/-1' }}>
                <div className="spin" />
                {isProject ? 'Analizando el proyecto…' : 'Generando sugerencias…'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
