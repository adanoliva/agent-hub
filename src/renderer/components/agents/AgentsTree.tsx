import React from 'react';
import { useStore } from '../../store';
import { useCategoryHelpers } from '../../hooks/useCategoryHelpers';
import type { SelectedNode } from '../../types';

export type AgentsMode = 'agents' | 'skills';

interface Props {
  selected: SelectedNode;
  expanded: Set<string>;
  onSelect: (node: SelectedNode) => void;
  onToggle: (key: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
  mode: AgentsMode;
  onModeChange: (m: AgentsMode) => void;
}

function isActive(selected: SelectedNode, level: string, catId: string | null, projId: string | null) {
  return selected.level === level
    && selected.categoryId === catId
    && selected.projectId === projId;
}

export function AgentsTree({ selected, expanded, onSelect, onToggle, search, onSearchChange, mode, onModeChange }: Props) {
  const config   = useStore((s) => s.config);
  const projects = useStore((s) => s.projects);
  const { catColor } = useCategoryHelpers();

  const cats  = config?.categories ?? [];
  const catsOpen  = expanded.has('cats');
  const projsOpen = expanded.has('projs');

  function selectNode(level: SelectedNode['level'], catId: string | null, projId: string | null) {
    onSelect({ level, categoryId: catId ?? null, projectId: projId ?? null });
  }

  return (
    <div className="agents-tree" id="agents-tree">
      {/* Mode toggle */}
      <div className="tree-mode-toggle">
        <button
          className={`tree-mode-btn${mode === 'agents' ? ' active' : ''}`}
          onClick={() => onModeChange('agents')}
        >
          <i className="ti ti-cpu" /> Agentes
        </button>
        <button
          className={`tree-mode-btn${mode === 'skills' ? ' active' : ''}`}
          onClick={() => onModeChange('skills')}
        >
          <i className="ti ti-puzzle" /> Skills
        </button>
      </div>

      {/* Search */}
      <div className="tree-search">
        <i className="ti ti-search tree-search-icon" />
        <input
          className="tree-search-input"
          type="text"
          placeholder="Buscar agente…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {search && (
          <button className="tree-search-clear" onClick={() => onSearchChange('')}>
            <i className="ti ti-x" />
          </button>
        )}
      </div>

      {/* Global */}
      <div
        className={`tree-node${isActive(selected, 'global', null, null) ? ' active' : ''}`}
        onClick={() => selectNode('global', null, null)}
      >
        <i className="ti ti-world tree-icon" style={{ color: 'var(--green)' }} />
        <span className="tree-label">Global</span>
      </div>

      {/* Categories header */}
      <div className="tree-node" style={{ marginTop: 8 }} onClick={() => onToggle('cats')}>
        <i className={`ti ti-chevron-right tree-chevron${catsOpen ? ' open' : ''}`} />
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text2)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
          Categorías
        </span>
      </div>

      {catsOpen && cats.map((cat) => {
        const catActive = isActive(selected, 'section', cat.id, null);
        return (
          <div
            key={cat.id}
            className={`tree-node${catActive ? ' active' : ''}`}
            onClick={() => selectNode('section', cat.id, null)}
          >
            <div className="tree-indent" />
            <i className={`ti ${cat.icon || 'ti-folder'} tree-icon`} style={{ color: cat.color }} />
            <span className="tree-label">{cat.name}</span>
          </div>
        );
      })}

      {/* Projects header */}
      <div className="tree-node" style={{ marginTop: 8 }} onClick={() => onToggle('projs')}>
        <i className={`ti ti-chevron-right tree-chevron${projsOpen ? ' open' : ''}`} />
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text2)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
          Proyectos
        </span>
      </div>

      {projsOpen && (
        <>
          {projects.map((p) => {
            const pending = p.pendingUpdates ?? 0;
            return (
              <div
                key={p.id}
                className={`tree-node${isActive(selected, 'project', null, p.id) ? ' active' : ''}`}
                onClick={() => selectNode('project', null, p.id)}
              >
                <div className="tree-indent" />
                <i className="ti ti-folder tree-icon" style={{ color: catColor(p.categoryId) }} />
                <span className="tree-label">{p.name}</span>
                {pending > 0 && (
                  <span className="tree-badge">
                    <i className="ti ti-refresh" style={{ fontSize: 9 }} />{pending}
                  </span>
                )}
              </div>
            );
          })}
          {!projects.length && (
            <div className="tree-node" style={{ paddingLeft: 28, color: 'var(--text3)', fontSize: 11, pointerEvents: 'none' }}>
              Sin proyectos
            </div>
          )}
        </>
      )}

      {/* Sin Categoría — agents from directory that don't follow standard folder naming */}
      <div
        className={`tree-node${isActive(selected, 'uncategorized', null, null) ? ' active' : ''}`}
        style={{ marginTop: 8 }}
        onClick={() => selectNode('uncategorized', null, null)}
      >
        <i className="ti ti-folder-question tree-icon" style={{ color: 'var(--text3)' }} />
        <span className="tree-label" style={{ color: 'var(--text2)' }}>Sin categoría</span>
      </div>
    </div>
  );
}
