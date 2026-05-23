import React, { useEffect, useRef, useState } from 'react';
import { req } from '../../api';
import { useToast } from '../../hooks/useToast';
import { useStore } from '../../store';
import type { Config, Project } from '../../types';

type AiChoice = 'cli' | 'github' | 'api';

interface WizardProps {
  onDone: () => void;
}

export function Wizard({ onDone }: WizardProps) {
  const toast      = useToast();
  const setConfig  = useStore((s) => s.setConfig);
  const setProjects = useStore((s) => s.setProjects);

  const [step,       setStep]       = useState(0);
  const [aiChoice,   setAiChoice]   = useState<AiChoice>('cli');
  const [cliFound,   setCliFound]   = useState(false);
  const [cliPath,    setCliPath]     = useState<string | null>(null);
  const [cliChecked, setCliChecked]  = useState(false);
  const [ghToken,    setGhToken]    = useState('');
  const [ghModel,    setGhModel]    = useState('gpt-4o-mini');
  const [apiKey,     setApiKey]     = useState('');
  const [setupLog,    setSetupLog]   = useState<{ icon: string; color: string; msg: string }[]>([]);
  const [setupDone,   setSetupDone]  = useState(false);
  const [setupBusy,   setSetupBusy]  = useState(false);
  const [noShowAgain, setNoShowAgain] = useState(false);

  const TOTAL = 3;

  // ── Step 1: detect CLI on mount ──────────────────────────────────────────────

  useEffect(() => {
    if (step === 1 && !cliChecked) {
      detectCLI();
    }
  }, [step]);

  async function detectCLI() {
    try {
      const r = await req<{ found: boolean; path?: string }>('GET', '/detect-cli');
      setCliFound(r.found);
      setCliPath(r.path ?? null);
      if (r.found) setAiChoice('cli');
    } catch {}
    setCliChecked(true);
  }

  async function recheckCLI() {
    setCliChecked(false);
    try {
      const r = await req<{ found: boolean; path?: string }>('GET', '/detect-cli');
      setCliFound(r.found);
      setCliPath(r.path ?? null);
      if (r.found) { setAiChoice('cli'); toast('Claude CLI detectado'); }
      else toast('CLI no encontrado aún', 'err');
    } catch {}
    setCliChecked(true);
  }

  // ── Step 2: run setup on mount ───────────────────────────────────────────────

  useEffect(() => {
    if (step === 2 && !setupBusy && !setupDone) {
      runSetup();
    }
  }, [step]);

  async function runSetup() {
    setSetupBusy(true);
    setSetupLog([{ icon: 'spin', color: '', msg: 'Creando estructura de carpetas…' }]);
    try {
      const r = await req<{ agentsCreated: number }>('POST', '/setup', {});
      setSetupLog([
        { icon: 'ti-check', color: 'var(--green)', msg: `Estructura creada · ${r.agentsCreated} agentes cargados` },
        { icon: 'ti-check', color: 'var(--green)', msg: '¡Todo listo!' },
      ]);
      const [cfg, projs] = await Promise.all([
        req<Config>('GET', '/config'),
        req<Project[]>('GET', '/projects'),
      ]);
      setConfig(cfg);
      setProjects(projs);
      toast('Configuración completada');
      setSetupDone(true);
    } catch (e: any) {
      setSetupLog([{ icon: 'ti-x', color: 'var(--coral)', msg: `Error: ${e.message}` }]);
    }
    setSetupBusy(false);
  }

  // ── Navigation ───────────────────────────────────────────────────────────────

  async function handleNext() {
    if (step === 1) {
      const body: Record<string, string> = { aiProvider: aiChoice };
      if (aiChoice === 'api')    body.apiKey      = apiKey.trim();
      if (aiChoice === 'github') { body.githubToken = ghToken.trim(); body.githubModel = ghModel; }
      await req('PUT', '/config', body);
    }
    if (step + 1 >= TOTAL) { close(); return; }
    setStep((s) => s + 1);
  }

  function close() {
    if (noShowAgain) localStorage.setItem('cdm-wizard-done', '1');
    else localStorage.removeItem('cdm-wizard-done');
    onDone();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function openCLIInstall() {
    const api = (window as any).api;
    if (api) api.openExternal('https://claude.ai/code');
    else window.open('https://claude.ai/code', '_blank');
  }

  const nextLabel   = ['Comenzar', 'Continuar', 'Finalizar'][step];
  const skipLabel   = ['Omitir todo', 'Configurar más tarde', ''][step];
  const nextDisabled = step === 2 && !setupDone;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="wiz-overlay">
      <div className="wiz-card">
        {/* Head */}
        <div className="wiz-head">
          <div className="wiz-dots">
            {Array.from({ length: TOTAL }).map((_, i) => (
              <div
                key={i}
                className={`wiz-dot${i < step ? ' done' : i === step ? ' cur' : ''}`}
              />
            ))}
          </div>
          <div className="wiz-title">
            {['¡Bienvenido a Agent Hub!', 'Conectar con Claude', 'Generando estructura base'][step]}
          </div>
          <div className="wiz-sub">
            {step === 0 && 'Gestiona agentes de Claude Code, organiza proyectos y genera contexto con IA.'}
            {step === 1 && 'Elige cómo quieres que la app acceda a Claude para generar agentes y sugerencias.'}
            {step === 2 && (setupDone ? 'La aplicación está configurada y lista para usar.' : 'Creando carpetas y cargando agentes por defecto…')}
          </div>
        </div>

        {/* Body */}
        <div className="wiz-body">
          {step === 0 && <WelcomeStep />}
          {step === 1 && (
            <AIStep
              cliFound={cliFound}
              cliPath={cliPath}
              cliChecked={cliChecked}
              choice={aiChoice}
              ghToken={ghToken}
              ghModel={ghModel}
              apiKey={apiKey}
              onChoice={setAiChoice}
              onGhToken={setGhToken}
              onGhModel={setGhModel}
              onApiKey={setApiKey}
              onRecheck={recheckCLI}
              onInstall={openCLIInstall}
            />
          )}
          {step === 2 && <SetupStep log={setupLog} />}
        </div>

        {/* Foot */}
        <div className="wiz-foot">
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 11, color: 'var(--text2)', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={noShowAgain}
              onChange={(e) => setNoShowAgain(e.target.checked)}
              style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
            No mostrar al inicio
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {skipLabel && (
              <span className="wiz-skip" onClick={close}>{skipLabel}</span>
            )}
            <button className="btn primary" onClick={handleNext} disabled={nextDisabled}>
              {nextLabel} <i className="ti ti-arrow-right" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step 0: Welcome ────────────────────────────────────────────────────────────

const FEATURES = [
  { emoji: '🤖', title: 'Agentes en 4 niveles', sub: 'Global → Categoría → Tech → Proyecto' },
  { emoji: '✨', title: 'IA integrada',          sub: 'Genera system prompts con Claude' },
  { emoji: '🔄', title: 'Sync inteligente',      sub: 'Propaga cambios a todos los proyectos' },
  { emoji: '📁', title: 'Proyectos autónomos',   sub: 'Cada proyecto lleva sus propios agentes' },
];

function WelcomeStep() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {FEATURES.map((f) => (
        <div key={f.title} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 18, marginBottom: 6 }}>{f.emoji}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text0)', marginBottom: 3 }}>{f.title}</div>
          <div style={{ fontSize: 11, color: 'var(--text1)' }}>{f.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ── Step 1: AI provider ────────────────────────────────────────────────────────

interface AIStepProps {
  cliFound: boolean;
  cliPath: string | null;
  cliChecked: boolean;
  choice: AiChoice;
  ghToken: string;
  ghModel: string;
  apiKey: string;
  onChoice: (c: AiChoice) => void;
  onGhToken: (v: string) => void;
  onGhModel: (v: string) => void;
  onApiKey: (v: string) => void;
  onRecheck: () => void;
  onInstall: () => void;
}

function AIStep({ cliFound, cliPath, cliChecked, choice, ghToken, ghModel, apiKey,
  onChoice, onGhToken, onGhModel, onApiKey, onRecheck, onInstall }: AIStepProps) {

  if (!cliChecked) {
    return (
      <div className="setup-item">
        <div className="spin" /><span>Detectando Claude CLI…</span>
      </div>
    );
  }

  return (
    <>
      {/* CLI */}
      <div className={`ai-opt${choice === 'cli' ? ' on' : ''}`} onClick={() => onChoice('cli')}>
        <div className="ai-opt-head">
          <div className={`ai-radio${choice === 'cli' ? ' on' : ''}`} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text0)', display: 'flex', alignItems: 'center', gap: 8 }}>
              Claude CLI
              {cliFound
                ? <span className="badge green"><i className="ti ti-circle-check" />detectado</span>
                : <span className="badge gray"><i className="ti ti-circle-x" />no encontrado</span>}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text1)', marginTop: 2 }}>Usa tu suscripción de Claude.ai. Sin coste adicional.</div>
            {cliFound && cliPath && (
              <div style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'var(--mono)', marginTop: 3 }}>{cliPath}</div>
            )}
          </div>
        </div>
        {!cliFound && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={(e) => { e.stopPropagation(); onInstall(); }}>
              <i className="ti ti-download" /> Instalar Claude CLI
            </button>
            <button className="btn sm" onClick={(e) => { e.stopPropagation(); onRecheck(); }}>
              <i className="ti ti-refresh" /> Ya lo instalé
            </button>
          </div>
        )}
      </div>

      <Divider />

      {/* GitHub */}
      <div className={`ai-opt${choice === 'github' ? ' on' : ''}`} onClick={() => onChoice('github')}>
        <div className="ai-opt-head">
          <div className={`ai-radio${choice === 'github' ? ' on' : ''}`} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text0)', display: 'flex', alignItems: 'center', gap: 8 }}>
              GitHub Copilot <span className="badge blue"><i className="ti ti-api" />Models API</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text1)', marginTop: 2 }}>Usa tu cuenta de GitHub. Capa gratuita disponible.</div>
          </div>
        </div>
        {choice === 'github' && (
          <div style={{ marginTop: 12 }}>
            <div className="field" style={{ marginBottom: 8 }}>
              <label>GitHub Personal Access Token</label>
              <input
                type="password"
                value={ghToken}
                onChange={(e) => onGhToken(e.target.value)}
                placeholder="ghp_…"
                onClick={(e) => e.stopPropagation()}
                style={{ fontFamily: 'var(--mono)' }}
              />
              <div className="hint">github.com → Settings → Developer settings → Personal access tokens → Fine-grained → <strong>Models: Read</strong></div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Modelo</label>
              <select
                value={ghModel}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onGhModel(e.target.value)}
              >
                <option value="gpt-4o-mini">gpt-4o-mini (rápido, gratuito)</option>
                <option value="gpt-4o">gpt-4o (potente)</option>
                <option value="o1-mini">o1-mini (razonamiento)</option>
              </select>
            </div>
          </div>
        )}
      </div>

      <Divider />

      {/* API */}
      <div className={`ai-opt${choice === 'api' ? ' on' : ''}`} onClick={() => onChoice('api')}>
        <div className="ai-opt-head">
          <div className={`ai-radio${choice === 'api' ? ' on' : ''}`} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text0)' }}>API key de Anthropic</div>
            <div style={{ fontSize: 11, color: 'var(--text1)', marginTop: 2 }}>Acceso directo a Claude. Requiere cuenta en console.anthropic.com.</div>
          </div>
        </div>
        {choice === 'api' && (
          <div style={{ marginTop: 12 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>API key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => onApiKey(e.target.value)}
                placeholder="sk-ant-api03-…"
                onClick={(e) => e.stopPropagation()}
                style={{ fontFamily: 'var(--mono)' }}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Step 2: Setup log ──────────────────────────────────────────────────────────

interface LogEntry { icon: string; color: string; msg: string }

function SetupStep({ log }: { log: LogEntry[] }) {
  return (
    <div>
      {log.map((entry, i) => (
        <div key={i} className="setup-item">
          {entry.icon === 'spin'
            ? <div className="spin" />
            : <i className={`ti ${entry.icon}`} style={{ fontSize: 14, color: entry.color }} />}
          <span>{entry.msg}</span>
        </div>
      ))}
    </div>
  );
}

// ── Divider ────────────────────────────────────────────────────────────────────

function Divider() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0' }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      <span style={{ fontSize: 11, color: 'var(--text2)' }}>o</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}
