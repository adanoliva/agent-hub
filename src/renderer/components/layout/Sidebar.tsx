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
  { view: 'dashboard', icon: 'ti-home',            label: 'Inicio'    },
  { view: 'projects',  icon: 'ti-layout-grid',     label: 'Proyectos' },
  { view: 'agents',    icon: 'ti-cpu',             label: 'Agentes'   },
  { view: 'chat',      icon: 'ti-message-chatbot', label: 'Chat IA'   },
  { view: 'settings',  icon: 'ti-settings',        label: 'Ajustes', bottom: true },
];

export function Sidebar() {
  const view    = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);

  return (
    <nav className="sidebar">
      <div className="sidebar-logo"><i className="ti ti-robot" /></div>
      {NAV.filter((n) => !n.bottom).map((n) => (
        <button
          key={n.view}
          className={`nav-btn${view === n.view ? ' active' : ''}`}
          onClick={() => setView(n.view)}
          title={n.label}
        >
          <i className={`ti ${n.icon}`} />
          <span className="tip">{n.label}</span>
        </button>
      ))}
      <div className="sidebar-spacer" />
      {NAV.filter((n) => n.bottom).map((n) => (
        <button
          key={n.view}
          className={`nav-set${view === n.view ? ' active' : ''}`}
          onClick={() => setView(n.view)}
          title={n.label}
        >
          <i className={`ti ${n.icon}`} />
          <span className="tip">{n.label}</span>
        </button>
      ))}
    </nav>
  );
}
