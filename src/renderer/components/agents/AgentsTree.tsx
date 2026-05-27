import React from 'react';
import { useStore } from '../../store';
import { useCategoryHelpers } from '../../hooks/useCategoryHelpers';
import type { SelectedNode } from '../../types';

interface Props {
  selected: SelectedNode;
  expanded: Set<string>;
  onSelect: (node: SelectedNode) => void;
  onToggle: (key: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
}

function isActive(selected: SelectedNode, level: string, catId: string | null, techId: string | null, projId: string | null) {
  return selected.level === level
    && selected.categoryId === catId
    && selected.techId === techId
    && selected.projectId === projId;
}

export function AgentsTree({ selected, expanded, onSelect, onToggle, search, onSearchChange }: Props) {
  const config   = useStore((s) => s.config);
  const projects = useStore((s) => s.projects);
  const { catColor } = useCategoryHelpers();

  const cats  = config?.categories ?? [];
  const catsOpen  = expanded.has('cats');
  const projsOpen = expanded.has('projs');

  function selectNode(level: SelectedNode['level'], catId: string | null, techId: string | null, projId: string | null) {
    onSelect({ level, categoryId: catId ?? null, techId: techId ?? null, projectId: projId ?? null });
  }

  return (
    <div className="agents-tree" id="agents-tree">
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
        className={`tree-node${isActive(selected, 'global', null, null, null) ? ' active' : ''}`}
        onClick={() => selectNode('global', null, null, null)}
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
        const catOpen   = expanded.has('cat-' + cat.id);
        const catActive = isActive(selected, 'section', cat.id, null, null);
        return (
          <React.Fragment key={cat.id}>
            <div
              className={`tree-node${catActive ? ' active' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggle('cat-' + cat.id); selectNode('section', cat.id, null, null); }}
            >
              <div className="tree-indent" />
              <i className={`ti ti-chevron-right tree-chevron${catOpen ? ' open' : ''}`} />
              <i className={`ti ${cat.icon || 'ti-folder'} tree-icon`} style={{ color: cat.color }} />
              <span className="tree-label">{cat.name}</span>
            </div>
            {catOpen && (
              <>
                {cat.technologies?.map((tech) => (
                  <div
                    key={tech.id}
                    className={`tree-node${isActive(selected, 'tech', cat.id, tech.id, null) ? ' active' : ''}`}
                    onClick={() => selectNode('tech', cat.id, tech.id, null)}
                  >
                    <div className="tree-indent" />
                    <div className="tree-indent" />
                    <i className="ti ti-code tree-icon" style={{ color: cat.color }} />
                    <span className="tree-label">{tech.name}</span>
                  </div>
                ))}
                {!cat.technologies?.length && (
                  <div className="tree-node" style={{ paddingLeft: 40, color: 'var(--text3)', fontSize: 11, pointerEvents: 'none' }}>
                    Sin tecnologías
                  </div>
                )}
              </>
            )}
          </React.Fragment>
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
                className={`tree-node${isActive(selected, 'project', null, null, p.id) ? ' active' : ''}`}
                onClick={() => selectNode('project', null, null, p.id)}
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
        className={`tree-node${isActive(selected, 'uncategorized', null, null, null) ? ' active' : ''}`}
        style={{ marginTop: 8 }}
        onClick={() => selectNode('uncategorized', null, null, null)}
      >
        <i className="ti ti-folder-question tree-icon" style={{ color: 'var(--text3)' }} />
        <span className="tree-label" style={{ color: 'var(--text2)' }}>Sin categoría</span>
      </div>
    </div>
  );
}
