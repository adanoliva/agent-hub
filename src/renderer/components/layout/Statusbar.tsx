import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import { req } from '../../api';
import type { AIUsage } from '../../types';

const PROVIDER_LABEL: Record<string, string> = {
  cli:    'Claude CLI',
  api:    'Anthropic API',
  github: 'GitHub Copilot',
};

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function Statusbar() {
  const appVersion = useStore((s) => s.appVersion);
  const config     = useStore((s) => s.config);
  const [online, setOnline]   = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const [usage,  setUsage]    = useState<AIUsage | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    req('GET', '/health').then(() => setOnline(true)).catch(() => setOnline(false));
    req<{ provider: string; ready: boolean }>('GET', '/ai/status')
      .then((s) => setAiReady(s.ready)).catch(() => setAiReady(false));

    const fetchUsage = () =>
      req<AIUsage>('GET', '/ai/usage').then(setUsage).catch(() => {});
    fetchUsage();
    pollRef.current = setInterval(fetchUsage, 30_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  useEffect(() => {
    if (!config) return;
    req<{ provider: string; ready: boolean }>('GET', '/ai/status')
      .then((s) => setAiReady(s.ready)).catch(() => setAiReady(false));
  }, [config?.aiProvider]);

  const provider      = config?.aiProvider ?? 'cli';
  const providerLabel = PROVIDER_LABEL[provider] ?? provider;
  const sess          = usage?.session;
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
      <div className="status-item status-usage">
        <span style={{ color: 'var(--text3)' }}>Total</span>
        <i className="ti ti-arrow-up" style={{ fontSize: 10, color: 'var(--blue)' }} />
        <span>{fmtTokens(usage?.cumulative.inputTokens ?? 0)}</span>
        <i className="ti ti-arrow-down" style={{ fontSize: 10, color: 'var(--green)' }} />
        <span>{fmtTokens(usage?.cumulative.outputTokens ?? 0)}</span>
      </div>
      <div className="status-item status-usage">
        <span style={{ color: 'var(--text3)' }}>Sesión</span>
        <i className="ti ti-arrow-up" style={{ fontSize: 10, color: 'var(--blue)' }} />
        <span>{fmtTokens(sess?.inputTokens ?? 0)}</span>
        <i className="ti ti-arrow-down" style={{ fontSize: 10, color: 'var(--green)' }} />
        <span>{fmtTokens(sess?.outputTokens ?? 0)}</span>
      </div>
      <div className="status-item" style={{ marginLeft: 'auto' }}>
        <span style={{ color: 'var(--text3)' }}>{appVersion ? `v${appVersion}` : ''}</span>
      </div>
    </div>
  );
}
