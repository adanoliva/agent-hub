import React from 'react';
import type { Skill } from '../../types';

interface Props {
  skills: Skill[];
  totalSkills: number;
  selectedSkill: string | null;
  onSelectSkill: (skill: Skill) => void;
  onNewSkill: () => void;
  searchActive?: boolean;
}

export function SkillsCenter({ skills, totalSkills, selectedSkill, onSelectSkill, onNewSkill, searchActive }: Props) {
  const isEmpty = skills.length === 0;

  return (
    <div className="agents-center" id="skills-center">
      <div className="agents-panel-head">
        <span className="agents-panel-title">
          {searchActive
            ? <><i className="ti ti-search" style={{ marginRight: 6, color: 'var(--text2)' }} />Resultados de búsqueda</>
            : <><i className="ti ti-puzzle" style={{ marginRight: 6 }} />Skills</>
          }
          {skills.length > 0 && (
            <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
              {searchActive && totalSkills !== skills.length ? `${skills.length} / ${totalSkills}` : skills.length}
            </span>
          )}
        </span>
        {!searchActive && (
          <button className="btn sm primary" onClick={onNewSkill}>
            <i className="ti ti-plus" /> Nuevo skill
          </button>
        )}
      </div>

      <div className="agents-content">
        {isEmpty ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, gap: 10, color: 'var(--text2)' }}>
            <i className={`ti ${searchActive ? 'ti-search-off' : 'ti-puzzle'}`} style={{ fontSize: 40, opacity: 0.2 }} />
            <div style={{ fontSize: 13, color: 'var(--text1)' }}>{searchActive ? 'Sin resultados' : 'Sin skills'}</div>
            <div style={{ fontSize: 12 }}>{searchActive ? 'Prueba con otro término' : 'Crea el primero para inyectar contexto tecnológico'}</div>
          </div>
        ) : (
          <div className="agents-grid">
            {skills.map((s) => (
              <div
                key={s.name}
                className={`agent-card${selectedSkill === s.name ? ' selected' : ''}`}
                style={{ borderLeftColor: 'var(--accent)' }}
                onClick={() => onSelectSkill(s)}
              >
                <div className="agent-card-head">
                  <span className="agent-icon"><i className="ti ti-puzzle" /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text0)', fontFamily: 'var(--mono)' }}>{s.name}</div>
                    {s.description && (
                      <div className="agent-desc">{s.description}</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
