import React from 'react';
import type { SyncEntry } from '../../types';

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

export function ProviderBadge({ provider }: { provider: string }) {
  if (provider === 'github') return <span className="badge gray"><i className="ti ti-brand-github" />Copilot</span>;
  if (provider === 'both')   return <span className="badge gray"><i className="ti ti-git-merge" />Ambos</span>;
  return <span className="badge gray"><i className="ti ti-robot" />Claude</span>;
}
