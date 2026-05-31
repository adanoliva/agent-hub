import React from 'react';
import type { SyncEntry } from '../../types';
import { PROJECT_PROVIDERS } from '../../constants/projects';

export function ProjectStatusBadge({ status }: { status: 'active' | 'paused' | 'archived' }) {
  if (status === 'active')   return <span className="badge green"><i className="ti ti-circle-check" />activo</span>;
  if (status === 'paused')   return <span className="badge amber"><i className="ti ti-player-pause" />pausado</span>;
  if (status === 'archived') return <span className="badge gray"><i className="ti ti-archive" />archivado</span>;
  return <span className="badge gray">{status}</span>;
}

export function SyncStatusBadge({ status }: { status: SyncEntry['status'] }) {
  if (status === 'ok')       return <span className="badge green"><i className="ti ti-circle-check" />ok</span>;
  if (status === 'outdated') return <span className="badge amber"><i className="ti ti-refresh" />actualizar</span>;
  if (status === 'new')      return <span className="badge blue"><i className="ti ti-sparkles" />nuevo</span>;
  if (status === 'local')    return <span className="badge gray"><i className="ti ti-device-laptop" />local</span>;
  if (status === 'excluded') return <span className="badge gray"><i className="ti ti-eye-off" />excluido</span>;
  return <span className="badge gray">{status}</span>;
}

export function ProviderBadge({ providers }: { providers: string[] }) {
  const list = providers || ['claude'];
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {list.map(id => {
        const config = PROJECT_PROVIDERS[id];
        if (!config) return null;
        return (
          <span key={id} className="badge gray" title={config.label} style={{ padding: '2px 6px' }}>
            <i className={`ti ${config.icon}`} style={{ margin: 0 }} />
          </span>
        );
      })}
    </div>
  );
}
