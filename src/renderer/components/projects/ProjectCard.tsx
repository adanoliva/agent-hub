import React from 'react';
import type { Project } from '../../types';
import { ProjectStatusBadge, ProviderBadge } from './StatusBadge';

interface Props {
  project: Project;
  catName: string;
  techName: string;
  onOpen: (id: string) => void;
  onSync: (id: string) => void;
  onVSCode: (id: string) => void;
  onFolder: (id: string) => void;
}

export function ProjectCard({ project: p, catName, techName, onOpen, onSync, onVSCode, onFolder }: Props) {
  const pending = p.pendingUpdates ?? 0;
  const exists  = p.pathExists !== false;

  return (
    <div className="proj-card" onClick={() => onOpen(p.id)}>
      <div className="proj-card-head">
        <div className="proj-card-name">{p.name}</div>
        {pending > 0 && (
          <span className="proj-pending"><i className="ti ti-refresh" />{pending}</span>
        )}
      </div>
      <div className="proj-card-meta">
        {p.techId
          ? <span className="badge blue"><i className="ti ti-code" />{techName}</span>
          : <span className="badge gray"><i className="ti ti-folder" />{catName}</span>
        }
        <ProjectStatusBadge status={p.status} />
        <ProviderBadge providers={p.aiProviders} />
        {!exists && <span className="badge coral"><i className="ti ti-map-pin-off" />ruta no encontrada</span>}
      </div>
      <div className="proj-card-actions" onClick={(e) => e.stopPropagation()}>
        <button className="btn sm ghost" onClick={() => onVSCode(p.id)} title="Abrir en VS Code">
          <i className="ti ti-brand-vscode" />
        </button>
        <button className="btn sm ghost" onClick={() => onFolder(p.id)} title="Abrir carpeta">
          <i className="ti ti-folder-open" />
        </button>
        {pending > 0 && (
          <button
            className="btn sm"
            style={{ color: 'var(--amber)', borderColor: 'rgba(251,191,36,0.3)', background: 'var(--amber-dim)' }}
            onClick={() => onSync(p.id)}
          >
            <i className="ti ti-refresh" /> Sync
          </button>
        )}
      </div>
    </div>
  );
}
