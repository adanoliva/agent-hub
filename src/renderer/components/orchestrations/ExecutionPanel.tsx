import React, { useState, useEffect, useRef } from 'react';
import { req } from '../../api';
import type { Orchestration, ExecutionLog, ExecutionResult, StepResult } from '../../types';
import { useStore } from '../../store';

interface Props {
  orchestration: Orchestration;
  onBack:        () => void;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(1);
  return `${s}s`;
}

function fmtTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString(); } catch { return ''; }
}

const STATUS_ICONS: Record<string, string> = {
  success: 'ti-circle-check',
  partial: 'ti-alert-triangle',
  failed:  'ti-circle-x',
};

export function ExecutionPanel({ orchestration, onBack }: Props) {
  const addToast  = useStore(s => s.addToast);
  const navigateTo = useStore(s => s.navigateTo);

  // Temporal context values collected from user
  const [temporalValues, setTemporalValues] = useState<Record<string, string>>({});

  // Execution state
  const [isRunning,   setIsRunning]   = useState(false);
  const [logs,        setLogs]        = useState<ExecutionLog[]>([]);
  const [result,      setResult]      = useState<ExecutionResult | null>(null);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [stepsDone,   setStepsDone]   = useState<StepResult[]>([]);
  const [rollingBack, setRollingBack] = useState<number | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const esRef      = useRef<EventSource | null>(null);

  // Collect all temporal context fields: inputNode first, then inter-agent nodes
  const temporalFields = [
    // inputNode fields — key prefix "input-"
    ...(orchestration.inputNode?.contextExtra?.temporal || []).map(t => ({
      nodeIndex:   -1,
      tempId:      t.id,
      key:         `input-${t.id}`,
      label:       t.label,
      type:        t.type,
      placeholder: t.placeholder,
      required:    t.required,
    })),
    // Inter-agent node fields — key prefix "{nodeIdx}-"
    ...orchestration.nodes.flatMap((node, nodeIdx) =>
      (node.contextExtra?.temporal || []).map(t => ({
        nodeIndex:   nodeIdx,
        tempId:      t.id,
        key:         `${nodeIdx}-${t.id}`,
        label:       t.label,
        type:        t.type,
        placeholder: t.placeholder,
        required:    t.required,
      }))
    ),
  ];

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => { esRef.current?.close(); };
  }, []);

  const handleStart = async () => {
    const missing = temporalFields.filter(f => f.required && !temporalValues[f.key]?.trim());
    if (missing.length > 0) {
      addToast(`Campos requeridos: ${missing.map(m => m.label || m.key).join(', ')}`, 'err');
      return;
    }

    setIsRunning(true);
    setLogs([]);
    setResult(null);
    setStepsDone([]);

    try {
      const resp = await req<{ executionId: string; status: string }>(
        'POST', `/orchestrations/${orchestration.id}/execute`,
        { projectId: orchestration.projectId, temporalContexts: temporalValues },
      );
      setExecutionId(resp.executionId);

      const url = `/api/orchestrations/${orchestration.id}/execute/stream?executionId=${resp.executionId}`;
      const es  = new EventSource(url);
      esRef.current = es;

      es.addEventListener('message', e => {
        try {
          const log: ExecutionLog = JSON.parse(e.data);
          setLogs(prev => [...prev, log]);
        } catch {}
      });

      es.addEventListener('step-done', e => {
        try {
          const payload = JSON.parse(e.data);
          const step: StepResult = payload.data || payload;
          setStepsDone(prev => [...prev, step]);
        } catch {}
      });

      es.addEventListener('completed', e => {
        try {
          const payload = JSON.parse(e.data);
          const execResult: ExecutionResult = payload.data || payload;
          setResult(execResult);
        } catch {}
        setIsRunning(false);
        es.close();
      });

      es.addEventListener('error', () => {
        // SSE connection error (not orchestration error — that comes as event)
        if (isRunning) {
          addToast('Conexión con el servidor interrumpida', 'err');
          setIsRunning(false);
        }
        es.close();
      });

    } catch (e: any) {
      addToast(`Error al iniciar: ${e.message}`, 'err');
      setIsRunning(false);
    }
  };

  const handleRollback = async (stepIndex: number) => {
    if (!executionId) return;
    setRollingBack(stepIndex);
    try {
      await req('POST', `/orchestrations/${orchestration.id}/executions/${executionId}/rollback`, { stepIndex });
      addToast(`Paso ${stepIndex + 1} deshecho`, 'ok');
    } catch (e: any) {
      addToast(`Error al deshacer: ${e.message}`, 'err');
    } finally {
      setRollingBack(null);
    }
  };

  // ── PRE-EXECUTION FORM ────────────────────────────────────────────────────

  if (!isRunning && !result) {
    return (
      <div className="orch-exec-panel">
        <div className="orch-exec-form">
          <div className="orch-exec-form-header">
            <i className="ti ti-player-play" />
            <div>
              <h3>Ejecutar: {orchestration.name}</h3>
              {orchestration.description && <p>{orchestration.description}</p>}
            </div>
          </div>

          <div className="orch-exec-info">
            <div className="orch-exec-info-item">
              <i className="ti ti-cpu" />
              <span>{orchestration.agents.length} agentes en secuencia</span>
            </div>
            <div className="orch-exec-info-item">
              <i className="ti ti-clock" />
              <span>Timeout: {Math.round((orchestration.executionConfig?.timeout || 300000) / 1000)}s por paso</span>
            </div>
            {orchestration.executionConfig?.stopOnError && (
              <div className="orch-exec-info-item">
                <i className="ti ti-alert-triangle" />
                <span>Se detendrá ante el primer error</span>
              </div>
            )}
          </div>

          {temporalFields.length > 0 && (
            <section className="orch-exec-section">
              <h4><i className="ti ti-input-check" /> Contexto adicional</h4>
              {temporalFields.map(f => (
                <div key={f.key} className="orch-exec-field">
                  <label>
                    {f.label || f.key}
                    {f.required && <span className="orch-required">*</span>}
                  </label>
                  {f.type === 'file' ? (
                    <input
                      type="file"
                      className="input"
                      onChange={async e => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const text = await file.text();
                        setTemporalValues(v => ({ ...v, [f.key]: text }));
                      }}
                    />
                  ) : (
                    <textarea
                      className="input"
                      rows={3}
                      placeholder={f.placeholder || ''}
                      value={temporalValues[f.key] || ''}
                      onChange={e => setTemporalValues(v => ({ ...v, [f.key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </section>
          )}

          <div className="orch-exec-actions">
            <button className="btn ghost" onClick={onBack}>
              <i className="ti ti-arrow-left" /> Volver
            </button>
            <button className="btn primary" onClick={handleStart}>
              <i className="ti ti-player-play" /> Comenzar ejecución
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── RUNNING ───────────────────────────────────────────────────────────────

  if (isRunning) {
    return (
      <div className="orch-exec-panel">
        <div className="orch-exec-running">
          <div className="orch-exec-running-header">
            <i className="ti ti-loader-2 spin" />
            <h3>Ejecutando: {orchestration.name}</h3>
          </div>

          {/* Steps progress */}
          <div className="orch-steps-progress">
            {orchestration.agents.map((agentName, i) => {
              const done = stepsDone.find(s => s.stepIndex === i);
              const isActive = !done && i === stepsDone.length;
              return (
                <div key={i} className={`orch-step-row ${done ? `done-${done.status}` : ''} ${isActive ? 'active' : ''}`}>
                  <div className="orch-step-indicator">
                    {done ? (
                      <i className={`ti ${done.status === 'success' ? 'ti-check' : 'ti-x'}`} />
                    ) : isActive ? (
                      <i className="ti ti-loader-2 spin" />
                    ) : (
                      <span>{i + 1}</span>
                    )}
                  </div>
                  <span className="orch-step-name">{agentName}</span>
                  {done && <span className="orch-step-dur">{fmtDuration(done.duration)}</span>}
                </div>
              );
            })}
          </div>

          {/* Live logs */}
          <div className="orch-logs">
            {logs.map((log, i) => (
              <div key={i} className={`orch-log-line level-${log.level}`}>
                <span className="orch-log-time">{fmtTime(log.timestamp)}</span>
                <span className="orch-log-msg">{log.message}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    );
  }

  // ── RESULT ────────────────────────────────────────────────────────────────

  if (result) {
    const statusIcon = STATUS_ICONS[result.status] || 'ti-help';

    return (
      <div className="orch-exec-panel">
        <div className="orch-exec-result">
          {/* Result header */}
          <div className={`orch-result-header status-${result.status}`}>
            <i className={`ti ${statusIcon}`} />
            <div>
              <h3>
                {result.status === 'success' && 'Ejecución completada'}
                {result.status === 'partial' && 'Ejecución parcial'}
                {result.status === 'failed'  && 'Ejecución fallida'}
              </h3>
              <p>{result.stepsCompleted}/{result.totalSteps} pasos completados</p>
            </div>
          </div>

          {/* Stats */}
          <div className="orch-result-stats">
            <div className="orch-stat">
              <i className="ti ti-clock" />
              <span>{fmtDuration(result.duration)}</span>
            </div>
            <div className="orch-stat">
              <i className="ti ti-file-diff" />
              <span>{result.summary.filesModified} archivos</span>
            </div>
            {(result.totalTokensUsed.input + result.totalTokensUsed.output) > 0 && (
              <div className="orch-stat">
                <i className="ti ti-coin" />
                <span>{(result.totalTokensUsed.input + result.totalTokensUsed.output).toLocaleString()} tokens</span>
              </div>
            )}
            {result.estimatedCost > 0 && (
              <div className="orch-stat orch-stat-cost">
                <i className="ti ti-receipt" />
                <span>~${result.estimatedCost.toFixed(4)}</span>
              </div>
            )}
          </div>

          {/* Changed files */}
          {result.changes.length > 0 && (
            <section className="orch-result-section">
              <h4><i className="ti ti-files" /> Archivos modificados ({result.changes.length})</h4>
              <div className="orch-changes-list">
                {result.changes.map((c, i) => (
                  <div key={i} className="orch-change-item">
                    <i className="ti ti-file" />
                    <span>{c.path}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Steps detail */}
          <section className="orch-result-section">
            <h4><i className="ti ti-list-details" /> Resultados por paso</h4>
            {result.results.map((step, i) => (
              <div key={i} className={`orch-step-result status-${step.status}`}>
                <div className="orch-step-result-header">
                  <div className="orch-step-result-title">
                    <span className="orch-step-num">{i + 1}</span>
                    <span className="orch-step-result-name">{step.agentName}</span>
                    <span className={`orch-step-badge ${step.status}`}>
                      {step.status === 'success' && <><i className="ti ti-check" /> Exitoso</>}
                      {step.status === 'error'   && <><i className="ti ti-x" /> Error</>}
                      {step.status === 'warning' && <><i className="ti ti-alert-triangle" /> Advertencia</>}
                    </span>
                    <span className="orch-step-dur">{fmtDuration(step.duration)}</span>
                    {(step.tokensUsed.input + step.tokensUsed.output) > 0 && (
                      <span className="orch-step-tokens">
                        <i className="ti ti-coin" />
                        {(step.tokensUsed.input + step.tokensUsed.output).toLocaleString()}
                        {step.estimatedCost > 0 && ` · ~$${step.estimatedCost.toFixed(4)}`}
                      </span>
                    )}
                  </div>
                  {step.error?.recoverable && (
                    <button
                      className="btn ghost sm"
                      disabled={rollingBack === step.stepIndex}
                      onClick={() => handleRollback(step.stepIndex)}
                    >
                      {rollingBack === step.stepIndex
                        ? <><i className="ti ti-loader-2 spin" /> Deshaciendo...</>
                        : <><i className="ti ti-history" /> Deshacer paso</>}
                    </button>
                  )}
                </div>

                {step.error && (
                  <div className="orch-step-error">
                    <i className="ti ti-alert-circle" /> {step.error.message}
                  </div>
                )}

                {step.filesModified.length > 0 && (
                  <details className="orch-step-details">
                    <summary>{step.filesModified.length} archivo(s) modificado(s)</summary>
                    <div className="orch-step-files">
                      {step.filesModified.map(f => (
                        <span key={f} className="orch-file-chip">{f}</span>
                      ))}
                    </div>
                  </details>
                )}

                {step.output.response && (
                  <details className="orch-step-details">
                    <summary>Respuesta del agente</summary>
                    <div className="orch-step-response">{step.output.response.slice(0, 2000)}</div>
                  </details>
                )}
              </div>
            ))}
          </section>

          {/* Logs */}
          <section className="orch-result-section">
            <details>
              <summary className="orch-logs-summary"><i className="ti ti-terminal" /> Ver logs ({logs.length})</summary>
              <div className="orch-logs compact">
                {logs.map((log, i) => (
                  <div key={i} className={`orch-log-line level-${log.level}`}>
                    <span className="orch-log-time">{fmtTime(log.timestamp)}</span>
                    <span className="orch-log-msg">{log.message}</span>
                  </div>
                ))}
              </div>
            </details>
          </section>

          {/* Actions */}
          <div className="orch-exec-actions">
            <button className="btn ghost" onClick={onBack}>
              <i className="ti ti-arrow-left" /> Volver
            </button>
            <button className="btn" onClick={() => { setResult(null); setLogs([]); setStepsDone([]); }}>
              <i className="ti ti-refresh" /> Ejecutar de nuevo
            </button>
            {result.status !== 'failed' && (
              <button className="btn ghost" onClick={() => navigateTo('chat')}>
                <i className="ti ti-message-chatbot" /> Discutir en chat
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
