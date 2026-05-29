import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import { req } from '../../api';
import type { AIUsage } from '../../types';

const PROVIDER_LABEL: Record<string, string> = {
  cli:           'Claude Code CLI',
  'gemini-cli':  'Gemini CLI',
  'codex-cli':   'OpenAI Codex CLI',
  'copilot-cli': 'Copilot CLI (gh)',
  'aider-cli':   'Aider CLI',
  'cline-cli':   'Cline CLI',
  'goose-cli':   'Goose CLI',
  api:           'Anthropic API',
  openai:        'OpenAI API',
  github:        'GitHub Models',
  'gemini-api':  'Gemini API',
  mistral:       'Mistral API',
  grok:          'Grok (xAI)',
  deepseek:      'DeepSeek API',
  groq:          'Groq API',
  openrouter:    'OpenRouter API',
  perplexity:    'Perplexity API',
};

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function Statusbar() {
  const appVersion = useStore((s) => s.appVersion);
  const config     = useStore((s) => s.config);
  const [aiReady, setAiReady] = useState(false);
  const [usage,   setUsage]   = useState<AIUsage | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
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

  const provider = config?.aiProvider ?? 'cli';
  let providerLabel = PROVIDER_LABEL[provider];

  // Si no está en el mapa, buscar en customProviders
  const custom = (config?.customProviders || []).find(p => p.id === provider);
  if (!providerLabel && custom) {
    providerLabel = custom.name;
  }
  if (!providerLabel) providerLabel = provider;

  // Asegurar sufijo CLI o API
  let isCli = ['cli', 'gemini-cli', 'codex-cli', 'copilot-cli', 'aider-cli', 'cline-cli', 'goose-cli'].includes(provider);
  if (custom && custom.type === 'cli') isCli = true;

  if (isCli) {
    if (!providerLabel.toLowerCase().includes('cli')) providerLabel += ' CLI';
  } else {
    if (!providerLabel.toLowerCase().includes('api')) providerLabel += ' API';
  }
  const sess          = usage?.session;

  return (
    <div className="statusbar">
      {/* Izquierda: proveedor IA */}
      <div className="status-item">
        <div className={`sdot ${aiReady ? 'green' : 'amber'}`} />
        <span>{providerLabel}</span>
      </div>

      {/* Centro: consumo */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: 14 }}>
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
      </div>

      {/* Derecha: versión */}
      <div className="status-item">
        <span style={{ color: 'var(--text3)' }}>{appVersion ? `v${appVersion}` : ''}</span>
      </div>
    </div>
  );
}
