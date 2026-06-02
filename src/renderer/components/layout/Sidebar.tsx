import React from 'react';
import { useStore } from '../../store';
import type { View } from '../../types';

interface NavItem {
  view: View;
  icon: string;
  label: string;
  bottom?: boolean;
}

const NAV: NavItem[] = [
  { view: 'dashboard',      icon: 'ti-home',             label: 'Dashboard'     },
  { view: 'agents',         icon: 'ti-cpu',              label: 'Agentes'       },
  { view: 'projects',       icon: 'ti-layout-grid',      label: 'Proyectos'     },
  { view: 'orchestrations', icon: 'ti-topology-ring-2',  label: 'Orquestaciones'},
  { view: 'chat',           icon: 'ti-message-chatbot',  label: 'Chat IA',  bottom: true },
  { view: 'settings',       icon: 'ti-settings',         label: 'Ajustes',  bottom: true },
];

export function Sidebar() {
  const view             = useStore((s) => s.view);
  const setView          = useStore((s) => s.setView);
  const isOrchestrating  = useStore((s) => s.isOrchestrating);

  const lockTitle = 'Orquestación en curso — espera a que termine o cancela';

  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        {isOrchestrating
          ? <i className="ti ti-loader-2 spin" style={{ color: 'var(--accent)' }} />
          : <i className="ti ti-robot" />}
      </div>
      {NAV.filter((n) => !n.bottom).map((n) => (
        <button
          key={n.view}
          className={`nav-btn${view === n.view ? ' active' : ''}${isOrchestrating && view !== n.view ? ' nav-locked' : ''}`}
          onClick={() => { if (!isOrchestrating || view === n.view) setView(n.view); }}
          title={isOrchestrating && view !== n.view ? lockTitle : n.label}
          aria-disabled={isOrchestrating && view !== n.view}
        >
          <i className={`ti ${n.icon}`} />
          <span className="tip">{n.label}</span>
        </button>
      ))}
      <div className="sidebar-spacer" />
      {NAV.filter((n) => n.bottom).map((n) => (
        <button
          key={n.view}
          className={`nav-set${view === n.view ? ' active' : ''}${isOrchestrating && view !== n.view ? ' nav-locked' : ''}`}
          onClick={() => { if (!isOrchestrating || view === n.view) setView(n.view); }}
          title={isOrchestrating && view !== n.view ? lockTitle : n.label}
          aria-disabled={isOrchestrating && view !== n.view}
        >
          <i className={`ti ${n.icon}`} />
          <span className="tip">{n.label}</span>
        </button>
      ))}
    </nav>
  );
}
