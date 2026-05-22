import React from 'react';

interface TopbarProps {
  title: string;
  sub?: string;
  actions?: React.ReactNode;
}

export function Topbar({ title, sub, actions }: TopbarProps) {
  return (
    <div className="topbar">
      <span className="topbar-title">{title}</span>
      <div className="topbar-sep" />
      {sub && <span className="topbar-sub">{sub}</span>}
      <div className="topbar-spacer" />
      {actions && <div className="topbar-actions">{actions}</div>}
    </div>
  );
}
