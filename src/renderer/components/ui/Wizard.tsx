import React, { useEffect, useState } from 'react';
import { req } from '../../api';
import { useToast } from '../../hooks/useToast';
import { useStore } from '../../store';
import type { Config, Project } from '../../types';

type AiChoice = 'cli' | 'github' | 'api';

interface WizardProps {
  onDone: () => void;
}

export function Wizard({ onDone }: WizardProps) {
  const toast       = useToast();
  const setConfig   = useStore((s) => s.setConfig);
  const setProjects = useStore((s) => s.setProjects);

  const [step,        setStep]        = useState(0);
  const [aiChoice,    setAiChoice]    = useState<AiChoice>('cli');
  const [cliFound,    setCliFound]    = useState(false);
  const [cliPath,     setCliPath]     = useState<string | null>(null);
  const [cliChecked,  setCliChecked]  = useState(false);
  const [ghToken,     setGhToken]     = useState('');
  const [ghModel,     setGhModel]     = useState('gpt-4o-mini');
  const [apiKey,      setApiKey]      = useState('');
  const [finishing,   setFinishing]   = useState(false);
  const [noShowAgain, setNoShowAgain] = useState(false);

  const TOTAL = 4;

  useEffect(() => {
    if (step === 3 && !cliChecked) detectCLI();
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

  async function handleNext() {
    if (step < TOTAL - 1) { setStep((s) => s + 1); return; }
    // Last step: save config + run setup
    setFinishing(true);
    try {
      const body: Record<string, string> = { aiProvider: aiChoice };
      if (aiChoice === 'api')    body.apiKey      = apiKey.trim();
      if (aiChoice === 'github') { body.githubToken = ghToken.trim(); body.githubModel = ghModel; }
      await req('PUT', '/config', body);
      await req('POST', '/setup', {});
      const [cfg, projs] = await Promise.all([
        req<Config>('GET', '/config'),
        req<Project[]>('GET', '/projects'),
      ]);
      setConfig(cfg);
      setProjects(projs);
      toast('¡Agent Hub listo!');
      close();
    } catch (e: any) {
      toast(`Error al configurar: ${e.message}`, 'err');
    }
    setFinishing(false);
  }

  function close() {
    if (noShowAgain) localStorage.setItem('cdm-wizard-done', '1');
    else localStorage.removeItem('cdm-wizard-done');
    onDone();
  }

  function openCLIInstall() {
    const api = (window as any).api;
    if (api) api.openExternal('https://claude.ai/code');
    else window.open('https://claude.ai/code', '_blank');
  }

  const isLastStep  = step === TOTAL - 1;
  const nextLabel   = isLastStep ? (finishing ? 'Configurando…' : 'Comenzar') : 'Siguiente';
  const nextDisabled = finishing;

  const TITLES = [
    '¡Bienvenido a Agent Hub!',
    'Proyectos y Agentes',
    'IA integrada y más',
    'Conecta tu IA',
  ];
  const SUBS = [
    'Tu centro de comando para agentes de IA. Organiza, sincroniza y potencia tus proyectos.',
    'Crea agentes en 4 niveles de alcance y sincronízalos automáticamente a tus proyectos.',
    'Genera prompts, chatea con contexto y orquesta agentes para tareas complejas.',
    'Elige cómo quieres que la app acceda a la IA para generar agentes y sugerencias.',
  ];

  return (
    <div className="wiz-overlay">
      <div className="wiz-card">
        {/* Head */}
        <div className="wiz-head">
          <div className="wiz-dots">
            {Array.from({ length: TOTAL }).map((_, i) => (
              <div key={i} className={`wiz-dot${i < step ? ' done' : i === step ? ' cur' : ''}`} />
            ))}
          </div>
          <div className="wiz-title">{TITLES[step]}</div>
          <div className="wiz-sub">{SUBS[step]}</div>
        </div>

        {/* Body */}
        <div className="wiz-body">
          {step === 0 && <WelcomeSlide />}
          {step === 1 && <AgentsSlide />}
          {step === 2 && <FeaturesSlide />}
          {step === 3 && (
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
            <span className="wiz-skip" onClick={close}>Omitir</span>
            <button className="btn primary" onClick={handleNext} disabled={nextDisabled}>
              {nextLabel} <i className={`ti ${finishing ? 'ti-loader-2' : 'ti-arrow-right'}`} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Slide 0: Welcome ───────────────────────────────────────────────────────────

function WelcomeSlide() {
  return (
    <div className="wiz-welcome">
      <div className="wiz-hero-icon">
        <i className="ti ti-robot" />
      </div>
      <div className="wiz-welcome-pills">
        <span className="badge accent"><i className="ti ti-cpu" />Agentes</span>
        <span className="badge blue"><i className="ti ti-layout-grid" />Proyectos</span>
        <span className="badge green"><i className="ti ti-message-chatbot" />Chat IA</span>
        <span className="badge gray"><i className="ti ti-topology-ring-2" />Orquestaciones</span>
      </div>
      <p className="wiz-welcome-desc">
        Agent Hub centraliza la gestión de agentes de <strong>IA</strong>, los sincroniza a tus proyectos y te da acceso para generar, optimizar y ejecutar agentes directamente desde la app.
      </p>
    </div>
  );
}

// ── Slide 1: Projects & Agents ─────────────────────────────────────────────────

const LEVELS = [
  { icon: 'ti-globe',         color: 'var(--accent)', label: 'Global',     sub: 'Disponible en todos los proyectos' },
  { icon: 'ti-folder',        color: 'var(--blue)',   label: 'Categoría',  sub: 'Solo proyectos de esa categoría' },
  { icon: 'ti-code',          color: 'var(--green)',  label: 'Tecnología', sub: 'Solo proyectos con esa tech' },
  { icon: 'ti-layout-grid',   color: 'var(--amber)',  label: 'Proyecto',   sub: 'Exclusivo de un proyecto concreto' },
];

function AgentsSlide() {
  return (
    <div className="wiz-feature-list">
      {LEVELS.map((l, i) => (
        <div key={l.label} className="wiz-feature-row">
          <div className="wiz-feature-icon" style={{ color: l.color, background: `${l.color}18` }}>
            <i className={`ti ${l.icon}`} />
          </div>
          <div className="wiz-feature-text">
            <span className="wiz-feature-label">{l.label}</span>
            <span className="wiz-feature-sub">{l.sub}</span>
          </div>
          {i < LEVELS.length - 1 && (
            <div className="wiz-level-arrow"><i className="ti ti-arrow-down" /></div>
          )}
        </div>
      ))}
      <div className="wiz-feature-tip">
        <i className="ti ti-info-circle" />
        Los cambios en un agente se propagan automáticamente a todos los proyectos que lo usan al sincronizar.
      </div>
    </div>
  );
}

// ── Slide 2: Features ──────────────────────────────────────────────────────────

const FEATS = [
  {
    icon: 'ti-message-chatbot',
    color: 'var(--accent)',
    title: 'Chat con contexto',
    sub: 'Habla con la IA usando tus agentes como system prompt. Usa @menciones para activarlos.',
  },
  {
    icon: 'ti-topology-ring-2',
    color: 'var(--blue)',
    title: 'Orquestaciones',
    sub: 'Encadena varios agentes en secuencia para ejecutar flujos de trabajo complejos sobre tu proyecto.',
  },
  {
    icon: 'ti-file-description',
    color: 'var(--green)',
    title: 'Contexto generado',
    sub: 'Genera el archivo de contexto analizando tu proyecto con IA.',
  },
  {
    icon: 'ti-sparkles',
    color: 'var(--amber)',
    title: 'Sugerencias IA',
    sub: 'La app sugiere agentes relevantes para cada categoría o proyecto basándose en su contenido.',
  },
];

function FeaturesSlide() {
  return (
    <div className="wiz-feats-grid">
      {FEATS.map((f) => (
        <div key={f.title} className="wiz-feat-card">
          <div className="wiz-feat-icon" style={{ color: f.color, background: `${f.color}18` }}>
            <i className={`ti ${f.icon}`} />
          </div>
          <div>
            <div className="wiz-feat-title">{f.title}</div>
            <div className="wiz-feat-sub">{f.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Slide 3: AI provider ───────────────────────────────────────────────────────

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
