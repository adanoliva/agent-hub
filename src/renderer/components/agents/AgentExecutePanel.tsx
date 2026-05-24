import React, { useEffect, useRef, useState } from 'react';
import { req } from '../../api';
import { useStore } from '../../store';
import type { Agent, ProjectContextInfo } from '../../types';

type Phase =
  | 'validating'
  | 'warn-no-model'
  | 'warn-no-context'
  | 'warn-default'
  | 'warn-mismatch'
  | 'ready'
  | 'running'
  | 'result'
  | 'error';

interface Props {
  agent: Agent;
  projectId: string;
  projectName: string;
  onBack: () => void;
  onOpenChat: (agent: Agent) => void;
}

function renderMarkdown(text: string): string {
  if (!text) return '';
  let s = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  s = s.replace(/```([^`]*?)```/gs, (_, code) => `<pre><code>${code.trim()}</code></pre>`);
  s = s.replace(/`([^`]+?)`/g, '<code>$1</code>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<![*_])([*_])(?![*_])(.+?)(?<![*_])\1(?![*_])/g, '<em>$2</em>');
  s = s.replace(/### (.+)/g, '<h3>$1</h3>');
  s = s.replace(/## (.+)/g, '<h2>$1</h2>');
  s = s.replace(/# (.+)/g, '<h1>$1</h1>');
  s = s.replace(/\n/g, '<br>');
  return s;
}

function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function AgentExecutePanel({ agent, projectId, projectName, onBack, onOpenChat }: Props) {
  const navigateTo        = useStore((s) => s.navigateTo);
  const setPendingChatAgent = useStore((s) => s.setPendingChatAgent);

  const [phase,    setPhase]    = useState<Phase>('validating');
  const [ctx,      setCtx]      = useState<ProjectContextInfo | null>(null);
  const [result,   setResult]   = useState<string>('');
  const [task,     setTask]     = useState<string>('');
  const [duration, setDuration] = useState<number>(0);
  const [errMsg,   setErrMsg]   = useState<string>('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    validate();
    return () => { mountedRef.current = false; };
  }, []);

  async function validate() {
    if (!agent.model) { setPhase('warn-no-model'); return; }
    try {
      const info = await req<ProjectContextInfo>('GET', `/projects/${projectId}/context?type=auto`);
      if (!mountedRef.current) return;
      setCtx(info);
      if (info.isEmpty)   { setPhase('warn-no-context'); return; }
      if (info.isDefault) { setPhase('warn-default'); return; }
      if (info.mismatch)  { setPhase('warn-mismatch'); return; }
      setPhase('ready');
    } catch {
      setPhase('ready'); // Si no se puede validar, dejar pasar
    }
  }

  async function execute() {
    setPhase('running');
    try {
      const data = await req<{ result: string; task: string; durationMs: number }>(
        'POST',
        `/projects/${projectId}/execute-task`,
        { agent },
      );
      if (!mountedRef.current) return;
      setResult(data.result);
      setTask(data.task);
      setDuration(data.durationMs);
      setPhase('result');
    } catch (e: any) {
      if (!mountedRef.current) return;
      setErrMsg(e.message || 'Error desconocido');
      setPhase('error');
    }
  }

  function copyResult() {
    navigator.clipboard.writeText(result).catch(() => {});
  }

  function openChat() {
    setPendingChatAgent(agent.name);
    navigateTo('chat');
  }

  // ── UI helpers ────────────────────────────────────────────────────────────────

  const providerLabel = ctx
    ? ctx.type === 'github' ? 'GitHub Copilot' : 'Claude'
    : '—';

  const contextLabel = ctx
    ? `${ctx.label} (${fmt(ctx.sizeBytes)})`
    : '—';

  const providerOk = ctx && !ctx.mismatch;

  // ── Render ────────────────────────────────────────────────────────────────────

  if (phase === 'validating') {
    return (
      <div className="exec-panel">
        <div className="exec-loading">
          <div className="spin" />
          <span>Validando contexto…</span>
        </div>
      </div>
    );
  }

  if (phase === 'warn-no-model') {
    return (
      <div className="exec-panel">
        <div className="exec-warning-box coral">
          <i className="ti ti-alert-circle" style={{ fontSize: 24, color: 'var(--coral)' }} />
          <div className="exec-warning-title">Agente incompleto</div>
          <p>Este agente no tiene modelo especificado. Asigna uno antes de ejecutar.</p>
          <div className="exec-warning-actions">
            <button className="btn" onClick={onBack}>Volver</button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'warn-no-context') {
    return (
      <div className="exec-panel">
        <div className="exec-warning-box coral">
          <i className="ti ti-file-off" style={{ fontSize: 24, color: 'var(--coral)' }} />
          <div className="exec-warning-title">Sin contexto de proyecto</div>
          <p>Este proyecto no tiene <strong>CLAUDE.md</strong> ni <strong>copilot-instructions.md</strong>. Las tareas necesitan contexto del proyecto para actuar de forma informada.</p>
          <div className="exec-warning-actions">
            <button className="btn primary" onClick={() => {
              req('POST', `/projects/${projectId}/generate-context?type=${ctx?.type || 'claude'}`)
                .then(() => validate())
                .catch(() => {});
            }}>
              <i className="ti ti-sparkles" /> Generar contexto
            </button>
            <button className="btn" onClick={onBack}>Cancelar</button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'warn-default') {
    return (
      <div className="exec-panel">
        <div className="exec-warning-box amber">
          <i className="ti ti-alert-triangle" style={{ fontSize: 24, color: 'var(--amber)' }} />
          <div className="exec-warning-title">Contexto insuficiente</div>
          <p>El archivo <strong>{ctx?.label}</strong> parece ser el generado por defecto y no tiene suficiente contenido real. Recomendamos editarlo primero para que el agente actúe con más precisión.</p>
          <div className="exec-warning-actions">
            <button className="btn primary" onClick={execute}>
              <i className="ti ti-zap" /> Ejecutar de todas formas
            </button>
            <button className="btn" onClick={onBack}>Cancelar</button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'warn-mismatch') {
    return (
      <div className="exec-panel">
        <div className="exec-warning-box amber">
          <i className="ti ti-switch-horizontal" style={{ fontSize: 24, color: 'var(--amber)' }} />
          <div className="exec-warning-title">Mismatch de proveedor</div>
          <p>{ctx?.mismatchDetails?.message}. La tarea funcionará pero puede no ser óptima.</p>
          <div className="exec-warning-actions">
            <button className="btn primary" onClick={execute}>
              <i className="ti ti-zap" /> Ejecutar de todas formas
            </button>
            <button className="btn" onClick={onBack}>Cancelar</button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'running') {
    return (
      <div className="exec-panel">
        <div className="exec-loading">
          <div className="spin" style={{ width: 28, height: 28 }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>Ejecutando tarea…</span>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>Analizando proyecto con {agent.name}…</span>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="exec-panel">
        <div className="exec-warning-box coral">
          <i className="ti ti-alert-circle" style={{ fontSize: 24, color: 'var(--coral)' }} />
          <div className="exec-warning-title">Error durante ejecución</div>
          <p style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{errMsg}</p>
          <p style={{ fontSize: 11, color: 'var(--text2)' }}>
            Posibles causas: proveedor no disponible, sin créditos o error de conexión.
          </p>
          <div className="exec-warning-actions">
            <button className="btn primary" onClick={execute}>
              <i className="ti ti-refresh" /> Reintentar
            </button>
            <button className="btn" onClick={onBack}>Volver</button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'result') {
    return (
      <div className="exec-panel">
        <div className="exec-result-header">
          <i className="ti ti-circle-check" style={{ color: 'var(--green)', fontSize: 18 }} />
          <span>Tarea completada en {fmtMs(duration)}</span>
        </div>

        <div className="exec-section-label">Resultado</div>
        <div
          className="exec-result-body"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(result) }}
        />

        <div className="exec-result-foot">
          <button className="btn ghost sm" onClick={copyResult}>
            <i className="ti ti-clipboard" /> Copiar
          </button>
          <button className="btn ghost sm" onClick={openChat}>
            <i className="ti ti-message-chatbot" /> Discutir en chat
          </button>
          <button className="btn sm" onClick={onBack} style={{ marginLeft: 'auto' }}>
            <i className="ti ti-arrow-left" /> Volver
          </button>
        </div>
      </div>
    );
  }

  // phase === 'ready'
  return (
    <div className="exec-panel">
      <div className="exec-section-label">Resumen de la tarea</div>

      <div className="exec-summary">
        <div className="exec-row">
          <span className="exec-row-label">Agente</span>
          <span className="exec-row-value" style={{ fontFamily: 'var(--mono)' }}>{agent.name}</span>
        </div>
        <div className="exec-row">
          <span className="exec-row-label">Descripción</span>
          <span className="exec-row-value">{agent.description || '—'}</span>
        </div>
        <div className="exec-row">
          <span className="exec-row-label">Modelo</span>
          <span className="exec-row-value" style={{ fontFamily: 'var(--mono)' }}>{agent.model || '—'}</span>
        </div>
        <div className="exec-row">
          <span className="exec-row-label">Herramientas</span>
          <span className="exec-row-value">{(agent.tools ?? []).join(', ') || '—'}</span>
        </div>
        <div className="exec-row">
          <span className="exec-row-label">Contexto</span>
          <span className="exec-row-value">{contextLabel}</span>
        </div>
        <div className="exec-row">
          <span className="exec-row-label">Proyecto</span>
          <span className="exec-row-value">{projectName}</span>
        </div>
        <div className="exec-row">
          <span className="exec-row-label">Proveedor</span>
          <span className="exec-row-value">
            {providerLabel}
            {ctx && (
              <span className={`badge ${providerOk ? 'green' : 'amber'}`} style={{ marginLeft: 8 }}>
                <i className={`ti ${providerOk ? 'ti-check' : 'ti-alert-triangle'}`} />
                {providerOk ? 'Compatible' : 'Mismatch'}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="exec-section-label" style={{ marginTop: 20 }}>Tarea predefinida</div>
      <div className="exec-task-desc">
        <i className="ti ti-target" style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
        <span>{ctx ? (
          (() => {
            // Muestra el task derivado como preview
            const combined = `${agent.name} ${agent.description || ''}`.toLowerCase();
            if (/review|revisor|code.?review/.test(combined)) return 'Revisar código en busca de bugs y oportunidades de mejora';
            if (/test|spec|testing/.test(combined)) return 'Analizar cobertura de tests y proponer plan de pruebas';
            if (/doc|readme|wiki/.test(combined)) return 'Revisar documentación e identificar qué falta';
            if (/perf|performance|optim|rendimiento/.test(combined)) return 'Identificar cuellos de botella de rendimiento';
            if (/security|seguridad|auth/.test(combined)) return 'Revisión de seguridad del proyecto';
            if (/refactor|clean|architect/.test(combined)) return 'Análisis de arquitectura y propuesta de refactorización';
            if (/debug|fix|bug/.test(combined)) return 'Búsqueda de bugs y comportamientos inesperados';
            return 'Análisis general del proyecto';
          })()
        ) : '—'}</span>
      </div>

      <div className="exec-foot">
        <button className="btn" onClick={onBack}>
          <i className="ti ti-arrow-left" /> Volver
        </button>
        <button className="btn primary" onClick={execute}>
          <i className="ti ti-zap" /> Ejecutar
        </button>
      </div>
    </div>
  );
}
