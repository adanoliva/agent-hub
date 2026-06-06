import React, { useState, useEffect, useRef, useMemo } from 'react';
import { req, API_BASE } from '../../api';
import type { Agent, BrowserStatus, Orchestration, OrchestrationNode, ExecutionLog, ExecutionResult, StepResult, QualityScore, AtomicOp, OpsLedger } from '../../types';
import { useStore } from '../../store';

function computeLevels(nodes: OrchestrationNode[]): OrchestrationNode[][] {
  const inDeg = new Map(nodes.map(n => [n.id, n.dependsOn.length]));
  const succ  = new Map<string, string[]>(nodes.map(n => [n.id, []]));
  for (const n of nodes)
    for (const dep of n.dependsOn)
      succ.get(dep)?.push(n.id);
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const levels: OrchestrationNode[][] = [];
  let frontier = nodes.filter(n => n.dependsOn.length === 0);
  while (frontier.length > 0) {
    levels.push(frontier);
    const next: OrchestrationNode[] = [];
    for (const node of frontier)
      for (const s of (succ.get(node.id) ?? [])) {
        const d = (inDeg.get(s) ?? 0) - 1;
        inDeg.set(s, d);
        if (d === 0) next.push(nodeMap.get(s)!);
      }
    frontier = next;
  }
  return levels;
}

interface Props {
  orchestration: Orchestration;
  projectId:     string;
  onBack:        () => void;
}

interface StepInput {
  stepIndex: number;
  agentName: string;
  userMessage: string;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString(); } catch { return ''; }
}

const STATUS_ICONS: Record<string, string> = {
  success: 'ti-circle-check',
  partial: 'ti-alert-triangle',
  failed:  'ti-circle-x',
};

function fmtAgentName(name: string): string {
  if (name.startsWith('__script:')) {
    return name.replace('__script:', '').replace('__', '').replace(/-/g, ' ');
  }
  return name;
}

function QualityBadge({ qs }: { qs: QualityScore }) {
  const [expanded, setExpanded] = React.useState(false);
  const colorMap = { green: 'green', amber: 'amber', red: 'coral' } as const;
  const iconMap  = { green: 'ti-check', amber: 'ti-alert-triangle', red: 'ti-x' } as const;
  return (
    <div className="orch-quality-badge-wrap">
      <button
        className={`badge ${colorMap[qs.grade]} orch-quality-badge`}
        onClick={() => setExpanded(v => !v)}
        title="Quality Score — click para ver detalles"
      >
        <i className={`ti ${iconMap[qs.grade]}`} />
        QS {qs.score}/100
      </button>
      {expanded && (
        <div className="orch-quality-checks">
          {qs.checks.map((c, i) => (
            <div key={i} className={`orch-quality-check ${c.passed ? 'passed' : 'failed'}`}>
              <i className={`ti ${c.passed ? 'ti-check' : 'ti-x'}`} />
              <span>{c.name}{c.detail ? ` (${c.detail})` : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ExecutionPanel({ orchestration, projectId, onBack }: Props) {
  const addToast           = useStore(s => s.addToast);
  const setIsOrchestrating = useStore(s => s.setIsOrchestrating);
  const config             = useStore(s => s.config);

  const CLI_NATIVE = ['cli', 'gemini-cli', 'codex-cli', 'copilot-cli', 'aider-cli', 'cline-cli', 'goose-cli'];
  const provider   = config?.aiProvider ?? 'cli';
  const isNativeCLI = CLI_NATIVE.includes(provider) ||
    (config?.customProviders?.some(p => p.id === provider && p.type === 'cli') ?? false);

  // Temporal context values collected from user
  const [temporalValues, setTemporalValues] = useState<Record<string, string>>({});

  // Execution state
  const [isRunning,   setIsRunning]   = useState(false);
  const [logs,        setLogs]        = useState<ExecutionLog[]>([]);
  const [result,      setResult]      = useState<ExecutionResult | null>(null);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [stepsDone,        setStepsDone]        = useState<StepResult[]>([]);
  const [stepInputs,       setStepInputs]       = useState<StepInput[]>([]);
  const [activeNodeIds,    setActiveNodeIds]     = useState<Set<string>>(new Set());
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [rollingBack,    setRollingBack]     = useState<number | null>(null);
  const [cancelling,     setCancelling]      = useState(false);
  const [cancelReason,   setCancelReason]    = useState<{ type: 'budget_exceeded'; spent: number; limit: number } | null>(null);
  const [browserPause,   setBrowserPause]    = useState<{ stepIndex: number; agentName: string } | null>(null);
  const [browserContinuing, setBrowserContinuing] = useState(false);

  // Ops ledger state
  const [opsLedger,      setOpsLedger]      = useState<OpsLedger | null>(null);
  const [opsTab,         setOpsTab]         = useState<'steps' | 'ops'>('steps');
  const [revertingOpId,  setRevertingOpId]  = useState<string | null>(null);

  // Gate HITL state
  const [gateOpen,      setGateOpen]      = useState<{ nodeId: string; agentName: string } | null>(null);
  const [gateDecision,  setGateDecision]  = useState<'revise' | null>(null);
  const [gateFeedback,  setGateFeedback]  = useState('');
  const [gateResolving, setGateResolving] = useState(false);

  // Agent objects — loaded to detect browser tools
  const [agentObjects,     setAgentObjects]     = useState<Agent[]>([]);
  const [agentsLoading,    setAgentsLoading]    = useState(true);
  const [agentsLoadError,  setAgentsLoadError]  = useState(false);

  // Browser CDP state
  const [browserStatus,  setBrowserStatus]  = useState<BrowserStatus | null>(null);
  const [browserBusy,    setBrowserBusy]    = useState(false);
  const [browserMsg,     setBrowserMsg]     = useState('');

  const logsEndRef     = useRef<HTMLDivElement>(null);
  const esRef          = useRef<EventSource | null>(null);
  const execStartedAt  = useRef<string>(new Date().toISOString());
  const stepsDoneRef   = useRef<StepResult[]>([]);

  // Temporal context fields — keyed by nodeId (DAG format)
  const temporalFields = orchestration.nodes.flatMap(node =>
    (node.contextExtra?.temporal || []).map(t => ({
      nodeId:      node.id,
      tempId:      t.id,
      key:         `${node.id}-${t.id}`,
      label:       t.label,
      type:        t.type,
      placeholder: t.placeholder,
      required:    t.required,
    }))
  );

  useEffect(() => {
    const names = new Set(orchestration.nodes.map(n => n.agentName));
    const pid   = projectId;
    setAgentsLoading(true);
    setAgentsLoadError(false);
    Promise.all([
      pid
        ? req<Agent[]>('GET', `/agents/applicable?projectId=${encodeURIComponent(pid)}`)
        : req<Agent[]>('GET', '/agents/flat'),
      pid
        ? req<Agent[]>('GET', `/projects/${encodeURIComponent(pid)}/agents`)
        : Promise.resolve([] as Agent[]),
    ]).then(([base, proj]) => {
      // Project agents take precedence over same-named global agents.
      const projNames = new Set(proj.map(a => a.name));
      const filteredBase = base.filter(a => !projNames.has(a.name));
      const seen = new Set<string>();
      const merged: Agent[] = [];
      for (const a of [...proj, ...filteredBase]) {
        if (!seen.has(a.name)) { seen.add(a.name); merged.push(a); }
      }
      setAgentObjects(merged.filter(a => names.has(a.name)));
    }).catch(() => {
      setAgentsLoadError(true);
    }).finally(() => {
      setAgentsLoading(false);
    });
  }, [orchestration.id, orchestration.nodes.map(n => n.agentName).join(','), projectId]);

  const needsBrowser = useMemo(
    () => agentObjects.some(a => a.tools?.some(t => t.startsWith('browser_'))),
    [agentObjects],
  );

  useEffect(() => {
    if (!needsBrowser) return;
    req<BrowserStatus>('GET', '/browser/status').then(setBrowserStatus).catch(() => {});
  }, [needsBrowser, orchestration.id]);

  async function launchBrowserCdp() {
    setBrowserBusy(true);
    setBrowserMsg('Iniciando navegador con CDP…');
    try {
      const status = browserStatus ?? await req<BrowserStatus>('GET', '/browser/status');
      if (status?.installed?.length) {
        const preferred = status.installed.find(b => b.engine === 'chromium') ?? status.installed[0];
        await req('POST', '/browser/launch', { browserKey: preferred.key, port: 9222 });
      }
      setBrowserMsg('Esperando que arranque el navegador…');
      let attempts = 0;
      const poll = async () => {
        attempts++;
        try {
          const s = await req<BrowserStatus>('GET', '/browser/status');
          if (s.connected) { setBrowserStatus(s); setBrowserMsg(''); setBrowserBusy(false); return; }
          if (s.cdpActive) {
            await req('POST', '/browser/connect', { port: 9222 }).catch(() => {});
            const s2 = await req<BrowserStatus>('GET', '/browser/status');
            setBrowserStatus(s2); setBrowserMsg(''); setBrowserBusy(false); return;
          }
        } catch {}
        if (attempts < 5) setTimeout(poll, 2000);
        else {
          setBrowserMsg('No se pudo conectar. Abre Chrome/Edge con --remote-debugging-port=9222 y pulsa de nuevo.');
          setBrowserBusy(false);
          req<BrowserStatus>('GET', '/browser/status').then(setBrowserStatus).catch(() => {});
        }
      };
      setTimeout(poll, 2500);
    } catch (e: any) {
      setBrowserMsg(e.message || 'Error al iniciar el navegador');
      setBrowserBusy(false);
    }
  }

  async function connectBrowserCdp() {
    setBrowserBusy(true);
    setBrowserMsg('');
    try {
      await req('POST', '/browser/connect', { port: 9222 });
      const s = await req<BrowserStatus>('GET', '/browser/status');
      setBrowserStatus(s);
    } catch (e: any) {
      setBrowserMsg(e.message || 'Error al conectar');
    }
    setBrowserBusy(false);
  }

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Cleanup SSE on unmount and release orchestration lock
  useEffect(() => {
    return () => {
      esRef.current?.close();
      setIsOrchestrating(false);
    };
  }, []);

  const missingFields  = temporalFields.filter(f => f.required && !temporalValues[f.key]?.trim());
  // Browser gate only applies when using an API provider (SubsystemCLI handles browser_ tools).
  // Native CLIs manage their own tools — no CDP gate needed.
  const browserGateActive = needsBrowser && !isNativeCLI;
  const browserBlocked = browserGateActive && !!browserStatus && !browserStatus.connected;
  const browserLoading = browserGateActive && !browserStatus;
  const canExecute     = missingFields.length === 0 && !browserBlocked && !browserLoading && !agentsLoading;

  const handleStart = async () => {
    if (missingFields.length > 0) {
      addToast(`Campos requeridos: ${missingFields.map(m => m.label || m.key).join(', ')}`, 'err');
      return;
    }

    setIsRunning(true);
    setLogs([]);
    setResult(null);
    setStepsDone([]);
    setStepInputs([]);
    setActiveNodeIds(new Set());
    setCurrentStepIndex(0);
    setCancelling(false);
    setCancelReason(null);
    setIsOrchestrating(true);
    execStartedAt.current  = new Date().toISOString();
    stepsDoneRef.current   = [];

    try {
      const resp = await req<{ executionId: string; status: string }>(
        'POST', `/orchestrations/${orchestration.id}/execute`,
        { projectId, temporalContexts: temporalValues },
      );
      setExecutionId(resp.executionId);

      const url = `${API_BASE}/orchestrations/${orchestration.id}/execute/stream?executionId=${resp.executionId}`;
      const es  = new EventSource(url);
      esRef.current = es;

      es.addEventListener('message', e => {
        try { setLogs(prev => [...prev, JSON.parse(e.data)]); } catch {}
      });

      es.addEventListener('step-start', e => {
        try {
          const payload = JSON.parse(e.data);
          const data = payload.data || payload;
          if (data.stepIndex != null) setCurrentStepIndex(data.stepIndex);
          if (data.nodeId) setActiveNodeIds(prev => new Set([...prev, data.nodeId]));
        } catch {}
      });

      es.addEventListener('step-input', e => {
        try {
          const payload = JSON.parse(e.data);
          const si: StepInput = payload.data || payload;
          setStepInputs(prev => [...prev.filter(x => x.stepIndex !== si.stepIndex), si]);
        } catch {}
      });

      es.addEventListener('step-done', e => {
        try {
          const payload = JSON.parse(e.data);
          const step: StepResult = payload.data || payload;
          setStepsDone(prev => { const next = [...prev, step]; stepsDoneRef.current = next; return next; });
          if (step.nodeId) setActiveNodeIds(prev => { const s = new Set(prev); s.delete(step.nodeId!); return s; });
        } catch {}
      });

      es.addEventListener('step-warning', e => {
        try {
          const payload = JSON.parse(e.data);
          const data = payload.data || payload;
          addToast(`Advertencia en paso ${data.stepIndex + 1}: ${JSON.stringify(data.issues)}`, 'warn');
        } catch {}
      });

      es.addEventListener('gate-open', e => {
        try {
          const payload = JSON.parse(e.data);
          const data    = payload.data || payload;
          setGateOpen({ nodeId: data.nodeId, agentName: data.agentName });
          setGateDecision(null);
          setGateFeedback('');
        } catch {}
      });

      es.addEventListener('browser-required', e => {
        try {
          const payload = JSON.parse(e.data);
          const data    = payload.data || payload;
          setBrowserPause({ stepIndex: data.stepIndex, agentName: data.agentName });
          // Refresh browser status so the UI shows current state
          req<BrowserStatus>('GET', '/browser/status').then(setBrowserStatus).catch(() => {});
        } catch {}
      });

      es.addEventListener('browser-continued', () => {
        setBrowserPause(null);
        setBrowserContinuing(false);
      });

      es.addEventListener('cancelled', e => {
        let payload: any = null;
        try { payload = JSON.parse((e as MessageEvent).data); } catch {}
        const isBudget = payload?.reason === 'budget_exceeded';
        const budgetData = isBudget && payload?.data ? payload.data : null;
        if (budgetData) {
          setCancelReason({ type: 'budget_exceeded', spent: budgetData.spent, limit: budgetData.limit });
        }
        const now = new Date().toISOString();
        const doneSteps = stepsDoneRef.current;
        setResult(prev => prev ?? {
          orchestrationId: orchestration.id,
          projectId,
          executionId:     executionId ?? '',
          startedAt:       execStartedAt.current,
          completedAt:     now,
          duration:        Date.now() - new Date(execStartedAt.current).getTime(),
          status:          'failed' as const,
          stepsCompleted:  doneSteps.length,
          totalSteps:      orchestration.nodes.length,
          totalTokensUsed: { input: 0, output: 0 },
          estimatedCost:   0,
          results:         doneSteps,
          errors:          budgetData
            ? [{ message: `Presupuesto agotado: $${budgetData.spent?.toFixed(4)} de $${budgetData.limit?.toFixed(4)}`, category: 'budget_exceeded', recoverable: false }]
            : [{ message: 'Ejecución cancelada', category: 'cancelled', recoverable: false }],
          summary:         { filesModified: 0, filesCreated: 0, filesDeleted: 0, linesAdded: 0, linesRemoved: 0 },
          changes:         [],
          backups:         {},
        });
        setIsRunning(false);
        setIsOrchestrating(false);
        setCancelling(false);
        setBrowserPause(null);
        setGateOpen(null);
        es.close();
        addToast(isBudget ? 'Presupuesto agotado — ejecución detenida' : 'Ejecución cancelada', isBudget ? 'err' : 'warn');
      });

      es.addEventListener('completed', e => {
        try {
          const payload = JSON.parse(e.data);
          setResult(payload.data || payload);
        } catch {}
        setIsRunning(false);
        setIsOrchestrating(false);
        setGateOpen(null);
        es.close();
        // Load ops ledger after execution completes
        req<OpsLedger>('GET', `/orchestrations/${orchestration.id}/ops`)
          .then(setOpsLedger).catch(() => {});
      });

      es.addEventListener('error', () => {
        setIsRunning(false);
        setIsOrchestrating(false);
        addToast('Conexión con el servidor interrumpida', 'err');
        es.close();
      });

    } catch (e: any) {
      addToast(`Error al iniciar: ${e.message}`, 'err');
      setIsRunning(false);
      setIsOrchestrating(false);
    }
  };

  const handleResolveGate = async (action: 'approve' | 'revise' | 'cancel') => {
    if (!executionId || !gateOpen || gateResolving) return;
    if (action === 'revise' && gateDecision !== 'revise') {
      setGateDecision('revise');
      return;
    }
    setGateResolving(true);
    try {
      await req('POST', `/orchestrations/${orchestration.id}/executions/${executionId}/gate`, {
        action,
        feedbackText: action === 'revise' ? gateFeedback : undefined,
        nodeId:       gateOpen.nodeId,
      });
      setGateOpen(null);
      setGateDecision(null);
      setGateFeedback('');
    } catch (e: any) {
      addToast(`Error al resolver gate: ${e.message}`, 'err');
    } finally {
      setGateResolving(false);
    }
  };

  const handleBrowserContinue = async () => {
    if (!executionId || browserContinuing) return;
    setBrowserContinuing(true);
    try {
      await req('POST', `/orchestrations/${orchestration.id}/browser-continue?executionId=${executionId}`);
    } catch (e: any) {
      addToast(`Error al continuar: ${e.message}`, 'err');
      setBrowserContinuing(false);
    }
  };

  const handleCancel = async () => {
    if (!executionId || cancelling) return;
    setCancelling(true);
    try {
      await req('POST', `/orchestrations/${orchestration.id}/cancel?executionId=${executionId}`);
    } catch {
      // Even if the request fails, close the SSE
      esRef.current?.close();
      setIsRunning(false);
      setIsOrchestrating(false);
      setCancelling(false);
    }
  };

  const handleRevertOp = async (opId: string) => {
    if (revertingOpId) return;
    setRevertingOpId(opId);
    try {
      const { op } = await req<{ ok: boolean; op: AtomicOp }>(
        'POST', `/orchestrations/${orchestration.id}/ops/${opId}/revert`
      );
      setOpsLedger(prev => prev ? { ...prev, ops: prev.ops.map(o => o.id === opId ? op : o) } : prev);
      addToast('Operación marcada como revertida', 'ok');
    } catch (e: any) {
      addToast(`Error: ${e.message}`, 'err');
    } finally {
      setRevertingOpId(null);
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

  // ── PRE-EXECUTION FORM ──────────────────────────────────────────────────────

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
              <span>{orchestration.nodes.length} agente{orchestration.nodes.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="orch-exec-info-item">
              <i className="ti ti-clock" />
              <span>Timeout: {Math.round((orchestration.executionConfig?.timeout || 1_800_000) / 1000)}s total</span>
            </div>
            {orchestration.executionConfig?.stopOnError && (
              <div className="orch-exec-info-item">
                <i className="ti ti-alert-triangle" />
                <span>Se detendrá ante el primer error</span>
              </div>
            )}
          </div>

          {temporalFields.length > 0 && (() => {
            const groups = temporalFields.reduce((acc, f) => {
              (acc[f.nodeId] ??= []).push(f);
              return acc;
            }, {} as Record<string, typeof temporalFields>);
            const nodeOrder = orchestration.nodes.map(n => n.id);
            const sortedIds = Object.keys(groups).sort((a, b) => nodeOrder.indexOf(a) - nodeOrder.indexOf(b));
            return (
              <section className="orch-exec-section">
                <h4><i className="ti ti-input-check" /> Contexto adicional</h4>
                {sortedIds.map(nodeId => {
                  const node = orchestration.nodes.find(n => n.id === nodeId);
                  return (
                  <div key={nodeId}>
                    <div className="orch-exec-node-label">
                      <i className="ti ti-cpu" />
                      {node?.agentName ?? nodeId}
                    </div>
                    {groups[nodeId].map(f => (
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
                  </div>
                  );
                })}
              </section>
            );
          })()}

          {needsBrowser && isNativeCLI && (
            <section className="orch-exec-section">
              <div className="orch-exec-info-item" style={{ color: 'var(--amber)' }}>
                <i className="ti ti-alert-triangle" />
                <span>
                  Este agente declara herramientas <code>browser_*</code>, pero el proveedor activo (<strong>{provider}</strong>) es un CLI nativo que gestiona su propio acceso al navegador.
                  Las herramientas CDP de Agent Hub no estarán disponibles; el CLI usará sus propias capacidades.
                </span>
              </div>
            </section>
          )}

          {agentsLoadError && (
            <div className="orch-error-banner" style={{ marginBottom: 12 }}>
              <i className="ti ti-alert-triangle" />
              No se pudieron cargar los agentes. Si alguno requiere navegador CDP, conéctalo manualmente antes de ejecutar.
            </div>
          )}

          {needsBrowser && !isNativeCLI && (
            <section className="orch-exec-section orch-exec-browser">
              <h4><i className="ti ti-browser" /> Navegador CDP</h4>
              <div className="orch-exec-browser-row">
                <div className="orch-exec-browser-status">
                  {!browserStatus ? (
                    <span style={{ color: 'var(--text3)', fontSize: 12 }}><i className="ti ti-loader-2 spin" style={{ marginRight: 4 }} />Comprobando…</span>
                  ) : browserStatus.connected ? (
                    <span className="badge green"><i className="ti ti-circle-check" />conectado · puerto {browserStatus.cdpPort}</span>
                  ) : browserStatus.cdpActive ? (
                    <span className="badge amber"><i className="ti ti-bolt" />CDP activo (sin conectar)</span>
                  ) : (
                    <span className="badge gray"><i className="ti ti-circle-x" />sin conexión</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {browserStatus && !browserStatus.connected && browserStatus.cdpActive && (
                    <button className="btn sm primary" onClick={connectBrowserCdp} disabled={browserBusy}>
                      <i className="ti ti-link" /> Conectar
                    </button>
                  )}
                  <button className="btn sm ghost" onClick={launchBrowserCdp} disabled={browserBusy}>
                    <i className={browserBusy ? 'ti ti-loader-2 spin' : 'ti ti-refresh'} /> Reiniciar con CDP
                  </button>
                </div>
              </div>
              {browserMsg && (
                <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6, padding: '6px 8px', background: 'var(--bg3)', borderRadius: 5 }}>
                  <i className="ti ti-info-circle" style={{ marginRight: 4 }} />{browserMsg}
                </div>
              )}
              {browserStatus && !browserStatus.connected && (
                <div style={{ fontSize: 11, color: 'var(--coral)', marginTop: 6 }}>
                  <i className="ti ti-alert-triangle" style={{ marginRight: 4 }} />
                  Conecta el navegador antes de ejecutar.
                </div>
              )}
            </section>
          )}

          <div className="orch-exec-actions">
            <button className="btn ghost" onClick={onBack}>
              <i className="ti ti-arrow-left" /> Volver
            </button>
            <button
              className="btn primary"
              onClick={handleStart}
              disabled={!canExecute}
              title={
                agentsLoading          ? 'Cargando agentes…' :
                browserLoading         ? 'Comprobando estado del navegador…' :
                browserBlocked         ? 'Conecta el navegador CDP antes de ejecutar' :
                missingFields.length   ? `Completa los campos: ${missingFields.map(f => f.label || f.key).join(', ')}` :
                ''
              }
            >
              <i className="ti ti-player-play" /> Comenzar ejecución
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── RUNNING ─────────────────────────────────────────────────────────────────

  if (isRunning) {
    return (
      <div className="orch-exec-panel">
        <div className="orch-exec-running">
          <div className="orch-exec-running-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <i className="ti ti-loader-2 spin" />
              <h3>Ejecutando: {orchestration.name}</h3>
            </div>
            <button
              className="btn danger sm"
              onClick={handleCancel}
              disabled={cancelling}
              title="Cancela la ejecución al terminar el paso actual"
            >
              {cancelling
                ? <><i className="ti ti-loader-2 spin" /> Cancelando…</>
                : <><i className="ti ti-player-stop" /> Cancelar</>}
            </button>
          </div>

          {/* Browser authentication pause */}
          {browserPause && (
            <div className="orch-browser-pause">
              <div className="orch-browser-pause-header">
                <i className="ti ti-browser" style={{ fontSize: 22, color: 'var(--accent)' }} />
                <div>
                  <div className="orch-browser-pause-title">Autenticación requerida</div>
                  <div className="orch-browser-pause-sub">
                    Paso {browserPause.stepIndex + 1}: <strong>{fmtAgentName(browserPause.agentName)}</strong>
                  </div>
                </div>
              </div>

              <div className="orch-browser-pause-body">
                <p>El navegador ha sido abierto. Navega a la URL que necesites, inicia sesión (incluido MFA si es necesario) y pulsa <strong>Continuar</strong> cuando estés listo.</p>

                {browserStatus && (
                  <div className="orch-browser-pause-status">
                    {browserStatus.connected ? (
                      <span className="badge green"><i className="ti ti-circle-check" />Navegador conectado · puerto {browserStatus.cdpPort}</span>
                    ) : (
                      <span className="badge amber"><i className="ti ti-alert-triangle" />Navegador no conectado</span>
                    )}
                    {browserStatus.tabs?.length > 0 && (
                      <div className="orch-browser-tabs">
                        {browserStatus.tabs.map((t, i) => (
                          <div key={i} className="orch-browser-tab">
                            <i className="ti ti-browser" />
                            <span className="orch-browser-tab-title">{t.title || t.url}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="orch-browser-pause-actions">
                <button className="btn ghost sm" onClick={handleCancel} disabled={cancelling}>
                  <i className="ti ti-x" /> Cancelar
                </button>
                <button
                  className="btn primary"
                  onClick={handleBrowserContinue}
                  disabled={browserContinuing}
                >
                  {browserContinuing
                    ? <><i className="ti ti-loader-2 spin" /> Continuando…</>
                    : <><i className="ti ti-player-play" /> Continuar ejecución</>}
                </button>
              </div>
            </div>
          )}

          {/* Gate HITL panel */}
          {gateOpen && (
            <div className="orch-gate-panel">
              <div className="orch-gate-header">
                <i className="ti ti-user-check" />
                <span>Revisión requerida — <strong>{gateOpen.agentName}</strong></span>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text1)' }}>El paso anterior ha completado. Revisa el resultado antes de continuar.</p>
              {gateDecision === 'revise' && (
                <textarea
                  className="orch-gate-feedback"
                  placeholder="Feedback para el agente (opcional)…"
                  value={gateFeedback}
                  onChange={e => setGateFeedback(e.target.value)}
                />
              )}
              <div className="orch-gate-actions">
                <button className="btn primary" onClick={() => handleResolveGate('approve')} disabled={gateResolving}>
                  <i className="ti ti-check" /> Aprobar
                </button>
                {gateDecision !== 'revise' ? (
                  <button className="btn" onClick={() => handleResolveGate('revise')} disabled={gateResolving}>
                    <i className="ti ti-refresh" /> Revisar
                  </button>
                ) : (
                  <button className="btn" onClick={() => handleResolveGate('revise')} disabled={gateResolving}>
                    {gateResolving ? <i className="ti ti-loader-2 spin" /> : <i className="ti ti-send" />} Enviar feedback
                  </button>
                )}
                <button className="btn danger" onClick={() => handleResolveGate('cancel')} disabled={gateResolving}>
                  <i className="ti ti-x" /> Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Step-by-step data flow — grouped by topological level */}
          {(() => {
            const levels = computeLevels(orchestration.nodes);
            // Map nodeId → topological index (for fallback currentStepIndex matching)
            const topoIdx = new Map<string, number>();
            let ti = 0;
            for (const lvl of levels) for (const n of lvl) topoIdx.set(n.id, ti++);

            function renderNode(node: OrchestrationNode) {
              const i        = topoIdx.get(node.id) ?? 0;
              const done     = stepsDone.find(s => s.nodeId === node.id || s.stepIndex === i);
              const input    = stepInputs.find(s => (s as any).nodeId === node.id || s.stepIndex === i);
              const isActive = !done && (
                activeNodeIds.has(node.id) ||
                (activeNodeIds.size === 0 && i === currentStepIndex)
              );
              return (
                <div key={node.id} className={`orch-step-flow-row ${done ? `done-${done.status}` : ''} ${isActive ? 'active' : ''}`}>
                  <div className="orch-step-flow-head">
                    <div className="orch-step-indicator">
                      {done ? (
                        <i className={`ti ${done.status === 'success' ? 'ti-check' : 'ti-x'}`} />
                      ) : isActive ? (
                        <i className="ti ti-loader-2 spin" />
                      ) : (
                        <span>{i + 1}</span>
                      )}
                    </div>
                    <span className="orch-step-name">{fmtAgentName(node.agentName)}</span>
                    {done && <span className="orch-step-dur">{fmtDuration(done.duration)}</span>}
                  </div>

                  {input && (
                    <details className="orch-step-data-section">
                      <summary>
                        <i className="ti ti-arrow-right" style={{ color: 'var(--blue)' }} />
                        Recibe
                      </summary>
                      <pre className="orch-step-data-pre">{input.userMessage}</pre>
                    </details>
                  )}

                  {done?.output?.handoff && (
                    <div className="orch-step-data-section orch-handoff-box">
                      <div className="orch-handoff-label">
                        <i className="ti ti-arrow-right-circle" style={{ color: 'var(--green)' }} />
                        Entrega al siguiente
                      </div>
                      <div className="orch-handoff-done">{done.output.handoff.done}</div>
                      {done.output.handoff.next && (
                        <div className="orch-handoff-next">
                          <i className="ti ti-message" /> {done.output.handoff.next}
                        </div>
                      )}
                      {done.output.handoff.issues?.length > 0 && (
                        <div className="orch-handoff-issues">
                          {done.output.handoff.issues.map((iss: string, j: number) => (
                            <span key={j}><i className="ti ti-alert-triangle" /> {iss}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {done?.status === 'error' && done.error && (
                    <div className="orch-step-data-section orch-step-error-inline">
                      <i className="ti ti-alert-circle" /> {done.error.message}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div className="orch-steps-flow">
                {levels.map((lvl, li) => (
                  <React.Fragment key={li}>
                    {li > 0 && (
                      <div className="orch-level-connector">
                        <i className="ti ti-chevron-down" />
                      </div>
                    )}
                    <div className={`orch-step-level${lvl.length > 1 ? ' parallel' : ''}`}>
                      {lvl.map(renderNode)}
                    </div>
                  </React.Fragment>
                ))}
              </div>
            );
          })()}

          {/* Live logs (collapsed by default) */}
          <details className="orch-logs-wrap">
            <summary className="orch-logs-summary">
              <i className="ti ti-terminal" /> Logs en vivo ({logs.length})
            </summary>
            <div className="orch-logs">
              {logs.map((log, i) => (
                <div key={i} className={`orch-log-line level-${log.level}`}>
                  <span className="orch-log-time">{fmtTime(log.timestamp)}</span>
                  <span className="orch-log-msg">{log.message}</span>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </details>
        </div>
      </div>
    );
  }

  // ── RESULT ──────────────────────────────────────────────────────────────────

  if (result) {
    const statusIcon = STATUS_ICONS[result.status] || 'ti-help';

    return (
      <div className="orch-exec-panel">
        {cancelReason?.type === 'budget_exceeded' && (
          <div className="orch-budget-exceeded-banner">
            <div className="orch-budget-exceeded-icon"><i className="ti ti-coins-off" /></div>
            <div className="orch-budget-exceeded-body">
              <strong>Presupuesto agotado</strong>
              <p>
                La orquestación se detuvo al alcanzar el límite configurado.
                Gastado: <code>${cancelReason.spent.toFixed(4)}</code> de <code>${cancelReason.limit.toFixed(4)}</code>.
              </p>
            </div>
          </div>
        )}
        <div className="orch-exec-result">
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

          <div className="orch-result-stats">
            <div className="orch-stat">
              <i className="ti ti-clock" /><span>{fmtDuration(result.duration)}</span>
            </div>
            <div className="orch-stat">
              <i className="ti ti-file-diff" /><span>{result.summary.filesModified} archivos</span>
            </div>
            {(result.totalTokensUsed.input + result.totalTokensUsed.output) > 0 && (
              <div className="orch-stat">
                <i className="ti ti-coin" />
                <span>{(result.totalTokensUsed.input + result.totalTokensUsed.output).toLocaleString()} tokens</span>
              </div>
            )}
            {result.estimatedCost > 0 && (
              <div className="orch-stat orch-stat-cost">
                <i className="ti ti-receipt" /><span>~${result.estimatedCost.toFixed(4)}</span>
              </div>
            )}
          </div>

          {result.changes.length > 0 && (
            <section className="orch-result-section">
              <h4><i className="ti ti-files" /> Archivos modificados ({result.changes.length})</h4>
              <div className="orch-changes-list">
                {result.changes.map((c, i) => (
                  <div key={i} className="orch-change-item">
                    <i className="ti ti-file" /><span>{c.path}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Tabs: Pasos / Operaciones */}
          <div className="orch-result-tabs">
            <button
              className={`orch-result-tab${opsTab === 'steps' ? ' active' : ''}`}
              onClick={() => setOpsTab('steps')}
            >
              <i className="ti ti-list-details" /> Pasos
            </button>
            <button
              className={`orch-result-tab${opsTab === 'ops' ? ' active' : ''}`}
              onClick={() => setOpsTab('ops')}
            >
              <i className="ti ti-files" /> Operaciones
              {opsLedger && opsLedger.ops.length > 0 && (
                <span className="orch-ops-count">{opsLedger.ops.length}</span>
              )}
            </button>
          </div>

          {/* Steps detail with full data flow */}
          {opsTab === 'steps' && <section className="orch-result-section">
            <h4 style={{ display: 'none' }} />
            {result.results.map((step, i) => (
              <div key={i} className={`orch-step-result status-${step.status}`}>
                <div className="orch-step-result-header">
                  <div className="orch-step-result-title">
                    <span className="orch-step-num">{i + 1}</span>
                    <span className="orch-step-result-name">{fmtAgentName(step.agentName)}</span>
                    <span className={`orch-step-badge ${step.status}`}>
                      {step.status === 'success' && <><i className="ti ti-check" /> Exitoso</>}
                      {step.status === 'error'   && <><i className="ti ti-x" /> Error</>}
                      {step.status === 'warning' && <><i className="ti ti-alert-triangle" /> Advertencia</>}
                    </span>
                    {step.qualityScore && <QualityBadge qs={step.qualityScore} />}
                    {step.revisions && step.revisions.length > 0 && (
                      <span className="badge amber" title={`${step.revisions.length} revisión(es)`}>
                        <i className="ti ti-history" />{step.revisions.length}
                      </span>
                    )}
                    {step.gitCommitSha && (
                      <span className="orch-step-git-sha" title={step.gitCommitSha}>
                        <i className="ti ti-git-commit" />{step.gitCommitSha.slice(0, 7)}
                      </span>
                    )}
                    <span className="orch-step-dur">{fmtDuration(step.duration)}</span>
                    {(step.tokensUsed.input + step.tokensUsed.output) > 0 && (
                      <span className="orch-step-tokens">
                        <i className="ti ti-coin" />
                        {(step.tokensUsed.input + step.tokensUsed.output).toLocaleString()}
                        {step.estimatedCost > 0 && ` · ~$${step.estimatedCost.toFixed(4)}`}
                      </span>
                    )}
                  </div>
                  {step.backupPath && (
                    <button
                      className="btn ghost sm"
                      disabled={rollingBack === step.stepIndex}
                      onClick={() => handleRollback(step.stepIndex)}
                    >
                      {rollingBack === step.stepIndex
                        ? <><i className="ti ti-loader-2 spin" /> Deshaciendo...</>
                        : <><i className="ti ti-history" /> Deshacer</>}
                    </button>
                  )}
                </div>

                {step.error && (
                  <div className="orch-step-error">
                    <i className="ti ti-alert-circle" /> {step.error.message}
                  </div>
                )}

                {/* Input the agent received */}
                {step.input?.userMessage && (
                  <details className="orch-step-details">
                    <summary>
                      <i className="ti ti-arrow-right" style={{ color: 'var(--blue)', marginRight: 4 }} />
                      Entrada recibida
                    </summary>
                    <pre className="orch-step-data-pre">{step.input.userMessage.slice(0, 3000)}</pre>
                  </details>
                )}

                {/* Handoff produced */}
                {step.output?.handoff && (
                  <div className="orch-handoff-box">
                    <div className="orch-handoff-label">
                      <i className="ti ti-arrow-right-circle" style={{ color: 'var(--green)' }} />
                      Entrega al siguiente agente
                    </div>
                    <div className="orch-handoff-done">{step.output.handoff.done}</div>
                    {step.output.handoff.next && (
                      <div className="orch-handoff-next">
                        <i className="ti ti-message" /> {step.output.handoff.next}
                      </div>
                    )}
                    {step.output.handoff.changed?.length > 0 && (
                      <div className="orch-handoff-changed">
                        {step.output.handoff.changed.map((f: string, j: number) => (
                          <span key={j} className="orch-file-chip"><i className="ti ti-file" />{f}</span>
                        ))}
                      </div>
                    )}
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
                    <summary>Respuesta completa del agente</summary>
                    <div className="orch-step-response">{step.output.response.slice(0, 3000)}</div>
                  </details>
                )}
              </div>
            ))}
          </section>}

          {/* Operaciones tab */}
          {opsTab === 'ops' && (
            <section className="orch-result-section">
              {!opsLedger || opsLedger.ops.length === 0 ? (
                <p style={{ color: 'var(--text3)', fontSize: 12 }}>No hay operaciones registradas para esta ejecución.</p>
              ) : (
                <div className="orch-exec-ops">
                  {opsLedger.ops.map(op => (
                    <div key={op.id} className={`orch-exec-op-row${op.status === 'reverted' ? ' reverted' : ''}`}>
                      <i className={`ti ${op.kind === 'add' ? 'ti-file-plus' : op.kind === 'remove' ? 'ti-file-minus' : 'ti-file-pencil'}`} />
                      <span className="orch-exec-op-path">{op.filePath}</span>
                      <span className="orch-exec-op-agent">{fmtAgentName(op.agentName)}</span>
                      <span className={`badge ${op.status === 'reverted' ? 'gray' : 'green'}`}>{op.status}</span>
                      {op.status === 'applied' && (
                        <button
                          className="btn ghost xs"
                          disabled={revertingOpId === op.id}
                          onClick={() => handleRevertOp(op.id)}
                          title="Marcar como revertida"
                        >
                          {revertingOpId === op.id ? <i className="ti ti-loader-2 spin" /> : <i className="ti ti-arrow-back" />}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

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

          <div className="orch-exec-actions">
            <button className="btn ghost" onClick={onBack}>
              <i className="ti ti-arrow-left" /> Volver
            </button>
            <button className="btn" onClick={() => { setResult(null); setLogs([]); setStepsDone([]); setStepInputs([]); }}>
              <i className="ti ti-refresh" /> Ejecutar de nuevo
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
