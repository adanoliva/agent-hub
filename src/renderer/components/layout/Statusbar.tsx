import React, { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { req } from '../../api';

const PROVIDER_LABEL: Record<string, string> = {
  cli:    'Claude CLI',
  api:    'Anthropic API',
  github: 'GitHub Copilot',
};

export function Statusbar() {
  const appVersion = useStore((s) => s.appVersion);
  const config     = useStore((s) => s.config);
  const [online, setOnline]   = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const [appDir, setAppDir]   = useState('—');

  useEffect(() => {
    req('GET', '/health')
      .then(() => setOnline(true))
      .catch(() => setOnline(false));

    req<{ provider: string; ready: boolean }>('GET', '/ai/status')
      .then((s) => setAiReady(s.ready))
      .catch(() => setAiReady(false));

    const api = (window as any).api;
    api?.getAppDir?.().then((d: string) => setAppDir(d));
  }, []);

  // Re-check AI status when provider changes
  useEffect(() => {
    if (!config) return;
    req<{ provider: string; ready: boolean }>('GET', '/ai/status')
      .then((s) => setAiReady(s.ready))
      .catch(() => setAiReady(false));
  }, [config?.aiProvider]);

  const provider = config?.aiProvider ?? 'cli';
  const providerLabel = PROVIDER_LABEL[provider] ?? provider;

  return (
    <div className="statusbar">
      <div className="status-item">
        <div className={`sdot ${online ? 'green' : 'red'}`} />
        <span>{online ? 'Conectado' : 'Desconectado'}</span>
      </div>
      <div className="status-item">
        <div className={`sdot ${aiReady ? 'green' : 'amber'}`} />
        <span>{providerLabel}</span>
      </div>
      <div className="status-item">
        <i className="ti ti-folder" style={{ fontSize: 11 }} />
        <span style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {appDir}
        </span>
      </div>
      <div className="status-item" style={{ marginLeft: 'auto' }}>
        <span style={{ color: 'var(--text3)' }}>{appVersion ? `v${appVersion}` : ''}</span>
      </div>
    </div>
  );
}
