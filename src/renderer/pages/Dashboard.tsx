import React, { useCallback, useEffect, useState } from 'react';
import { useStore } from '../store';
import { req } from '../api';
import { Topbar } from '../components/layout/Topbar';
import type { AIUsage, AIUsageEntry, DashboardData, DashboardNotification } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return 'Nunca';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1)  return 'Ahora mismo';
  if (m < 60) return `Hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Hace ${h}h`;
  return `Hace ${Math.floor(h / 24)} días`;
}

const NOTIF_META = {
  critical:     { icon: 'ti-alert-circle',   color: 'coral',  label: 'CRÍTICA'  },
  optimization: { icon: 'ti-bulb',           color: 'amber',  label: 'MEJORA'   },
  info:         { icon: 'ti-info-circle',    color: 'blue',   label: 'INFO'     },
};

const ACTION_LABEL: Record<DashboardNotification['action'], string> = {
  'open-agent':       'Abrir',
  'open-project':     'Abrir',
  'sync-project':     'Sincronizar',
  'generate-context': 'Generar',
  'optimize-agent':   'Optimizar',
};

function isDismissibleNotification(n: DashboardNotification): boolean {
  return n.type === 'optimization' || n.type === 'info';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function UsageRow({ entry, label }: { entry: AIUsageEntry; label: string }) {
  const total = entry.inputTokens + entry.outputTokens;
  return (
    <div className="dash-usage-row">
      <div className="dash-usage-row-head">
        <span className="dash-usage-row-label">{label}</span>
        {entry.estimatedCostUSD > 0 && (
          <span className="dash-usage-row-cost">{'$'}{entry.estimatedCostUSD.toFixed(4)}</span>
        )}
      </div>
      {total > 0 ? (
        <>
          <div className="dash-usage-row-tokens">
            <span><i className="ti ti-arrow-up" style={{ color: 'var(--blue)', fontSize: 10 }} /> {entry.inputTokens.toLocaleString()}</span>
            <span><i className="ti ti-arrow-down" style={{ color: 'var(--green)', fontSize: 10 }} /> {entry.outputTokens.toLocaleString()}</span>
            <span style={{ color: 'var(--text3)' }}>{entry.calls} llamadas</span>
          </div>
          <span className="dash-usage-row-since">Desde {timeAgo(entry.since)}</span>
        </>
      ) : (
        <span className="dash-usage-row-empty">Sin actividad</span>
      )}
    </div>
  );
}

function UsageCard({ usage, onReset, onResetAll }: { usage: AIUsage; onReset: () => void; onResetAll: () => void }) {
  return (
    <div className="dash-usage">
      <UsageRow entry={usage.cumulative} label="Total acumulado" />
      <div className="dash-usage-row-actions">
        <button className="btn sm ghost" onClick={onResetAll}>Reiniciar total</button>
      </div>
      <div className="dash-sep" />
      <UsageRow entry={usage.session} label="Sesión actual" />
      <div className="dash-usage-row-actions">
        <button className="btn sm ghost" onClick={onReset}>Reiniciar sesión</button>
      </div>
    </div>
  );
}

function SyncRow({ ok, label, sub }: { ok: boolean | null; label: string; sub: string }) {
  const status = ok === null ? 'off' : ok ? 'ok' : 'warn';
  const icon   = ok === null ? 'ti-plug-off' : ok ? 'ti-circle-check' : 'ti-alert-triangle';
  return (
    <div className="dash-sync-row">
      <div className={`dash-sync-dot ${status}`}><i className={`ti ${icon}`} /></div>
      <div className="dash-sync-info">
        <span className="dash-sync-label">{label}</span>
        <span className={`dash-sync-sub ${status}`}>{sub}</span>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function Dashboard() {
  const setView    = useStore((s) => s.setView);
  const navigateTo = useStore((s) => s.navigateTo);
  const config  = useStore((s) => s.config);

  const [data,     setData]     = useState<DashboardData | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [syncing,  setSyncing]  = useState(false);
  const [showAll,  setShowAll]  = useState(false);
  const [usage,    setUsage]    = useState<AIUsage | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dash, aiUsage] = await Promise.all([
        req<DashboardData>('GET', '/dashboard'),
        req<AIUsage>('GET', '/ai/usage'),
      ]);
      setData(dash);
      setUsage(aiUsage);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  async function resetUsage() {
    const fresh = await req<AIUsage>('POST', '/ai/usage/reset');
    setUsage(fresh);
  }

  async function resetAllUsage() {
    const fresh = await req<AIUsage>('POST', '/ai/usage/reset-all');
    setUsage(fresh);
  }

  useEffect(() => { load(); }, [load]);

  async function syncAll() {
    setSyncing(true);
    try { await req('POST', '/sync-all'); await load(); }
    finally { setSyncing(false); }
  }

  async function handleNotifAction(n: DashboardNotification) {
    if (n.action === 'sync-project' && n.targetId) {
      try { await req('POST', `/projects/${n.targetId}/sync`); await load(); } catch { /**/ }
    } else if (n.target === 'agent') {
      setView('agents');
    } else {
      setView('projects');
    }
  }

  async function dismissNotification(id: string) {
    try {
      await req('POST', '/dashboard/notifications/dismiss', { id });
      await load();
    } catch {
      // no-op: dashboard will stay as-is
    }
  }

  async function dismissGroup(group: 'agent' | 'scope', target: string) {
    try {
      await req('POST', '/dashboard/notifications/dismiss-group', { group, target });
      await load();
    } catch {
      // no-op: dashboard will stay as-is
    }
  }

  async function restoreHiddenNotifications() {
    try {
      await req('POST', '/dashboard/notifications/restore');
      await load();
    } catch {
      // no-op: dashboard will stay as-is
    }
  }

  // ── States ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="view active">
      <Topbar title="Dashboard" sub="inicio" />
      <div className="dash-state">
        <i className="ti ti-loader-2 dash-spin" style={{ fontSize: 28, color: 'var(--text2)' }} />
        <span>Cargando...</span>
      </div>
    </div>
  );

  if (error || !data) return (
    <div className="view active">
      <Topbar title="Dashboard" sub="inicio" />
      <div className="dash-state">
        <i className="ti ti-alert-circle" style={{ fontSize: 28, color: 'var(--coral)' }} />
        <p>Error al cargar el dashboard</p>
        <button className="btn" onClick={load}><i className="ti ti-refresh" />Reintentar</button>
      </div>
    </div>
  );

  const notifs        = data.notifications;
  const visibleNotifs = showAll ? notifs : notifs.slice(0, 5);
  const dir           = data.dirStatus;
  const dirOk         = !dir.enabled ? null : dir.lastResult?.error ? false : true;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="view active">
      <Topbar
        title="Dashboard"
                actions={
          <button className="btn sm ghost" onClick={load} title="Actualizar datos">
            <i className="ti ti-refresh" />
          </button>
        }
      />

      <div className="dash-scroll">
        <div className="dash-grid">

          {/* ── Estadísticas ── */}
          <div className="dash-card">
            <div className="dash-card-head">
              <i className="ti ti-chart-bar" />
              Estado General
            </div>

            <button className="dash-stat-row" onClick={() => setView('agents')}>
              <div className="dash-stat-main">
                <i className="ti ti-cpu" />
                <span className="dash-num">{data.agents.total}</span>
                <span className="dash-label">Agentes</span>
              </div>
              <div className="dash-subs">
                <span><i className="ti ti-circle-filled" style={{ color: 'var(--accent)', fontSize: 7 }} /> Global: {data.agents.global}</span>
                <span><i className="ti ti-circle-filled" style={{ color: 'var(--blue)', fontSize: 7 }} /> Categoría: {data.agents.section}</span>
                <span><i className="ti ti-circle-filled" style={{ color: 'var(--green)', fontSize: 7 }} /> Tecnología: {data.agents.tech}</span>
                {data.agents.uncategorized > 0 && (
                  <span><i className="ti ti-circle-filled" style={{ color: 'var(--text2)', fontSize: 7 }} /> Sin categoría: {data.agents.uncategorized}</span>
                )}
              </div>
            </button>

            <div className="dash-sep" />

            <button className="dash-stat-row" onClick={() => setView('projects')}>
              <div className="dash-stat-main">
                <i className="ti ti-layout-grid" />
                <span className="dash-num">{data.projects.total}</span>
                <span className="dash-label">Proyectos</span>
              </div>
              <div className="dash-subs">
                <span><i className="ti ti-circle-filled" style={{ color: 'var(--green)', fontSize: 7 }} /> Activos: {data.projects.active}</span>
                {data.projects.paused > 0 && (
                  <span><i className="ti ti-circle-filled" style={{ color: 'var(--amber)', fontSize: 7 }} /> Pausados: {data.projects.paused}</span>
                )}
                {data.projects.archived > 0 && (
                  <span><i className="ti ti-circle-filled" style={{ color: 'var(--text2)', fontSize: 7 }} /> Archivados: {data.projects.archived}</span>
                )}
              </div>
            </button>

            {data.lastSyncAt && (
              <>
                <div className="dash-sep" />
                <div className="dash-foot-note">
                  <i className="ti ti-clock" />
                  Última sync: {timeAgo(data.lastSyncAt)}
                </div>
              </>
            )}
          </div>

          {/* ── Sincronización ── */}
          <div className="dash-card">
            <div className="dash-card-head">
              <i className="ti ti-refresh" />
              Sincronización
            </div>

            <SyncRow
              ok={data.projects.totalPending === 0}
              label="Agentes"
              sub={data.projects.totalPending > 0
                ? `${data.projects.totalPending} pendiente${data.projects.totalPending > 1 ? 's' : ''}`
                : 'Todo sincronizado'}
            />
            <SyncRow
              ok={data.projects.withPending === 0}
              label="Proyectos"
              sub={data.projects.withPending > 0
                ? `${data.projects.withPending} desactualizado${data.projects.withPending > 1 ? 's' : ''}`
                : 'Todos al día'}
            />

            <div className="dash-sep" />

            <SyncRow
              ok={dirOk}
              label="Directorio externo"
              sub={!dir.enabled
                ? 'Deshabilitado'
                : dir.lastResult?.error
                  ? 'Error en última sync'
                  : timeAgo(dir.lastSync)}
            />

            <button
              className="btn primary"
              style={{ marginTop: 14, width: '100%', justifyContent: 'center' }}
              onClick={syncAll}
              disabled={syncing}
            >
              <i className={`ti ${syncing ? 'ti-loader-2 dash-spin' : 'ti-refresh'}`} />
              {syncing ? 'Sincronizando...' : 'Sincronizar todo'}
            </button>
          </div>

          {/* ── Notificaciones ── */}
          <div className="dash-card dash-wide">
            <div className="dash-card-head">
              <i className="ti ti-bulb" />
              Oportunidades de Mejora
              {notifs.length > 0 && (
                <span className="dash-badge-count">{notifs.length}</span>
              )}
              {(data.hiddenNotifications ?? 0) > 0 && (
                <button className="btn sm ghost" onClick={restoreHiddenNotifications} title="Volver a mostrar mejoras ocultas">
                  <i className="ti ti-restore" />
                  Restaurar ({data.hiddenNotifications})
                </button>
              )}
            </div>

            {notifs.length === 0 ? (
              <div className="dash-empty">
                <i className="ti ti-circle-check" style={{ color: 'var(--green)', fontSize: 24 }} />
                <span>Todo está optimizado</span>
                <span style={{ fontSize: 11, color: 'var(--text2)' }}>No hay recomendaciones por ahora</span>
              </div>
            ) : (
              <>
                {visibleNotifs.map((n) => {
                  const meta = NOTIF_META[n.type];
                  return (
                    <div key={n.id} className={`dash-notif dash-notif-${meta.color}`}>
                      <i className={`ti ${meta.icon}`} />
                      <div className="dash-notif-body">
                        <span className={`dash-notif-type dash-notif-type-${meta.color}`}>{meta.label}</span>
                        <span className="dash-notif-who">
                          <i className={`ti ${n.target === 'agent' ? 'ti-cpu' : 'ti-layout-grid'}`} />
                          {n.targetName}
                        </span>
                        {n.scopeLabel && (
                          <span className="dash-notif-scope">
                            <i className="ti ti-map-pin" />
                            {n.scopeLabel}
                          </span>
                        )}
                        <span className="dash-notif-msg">{n.message}</span>
                      </div>
                      <div className="dash-notif-actions">
                        <button
                          className="btn sm ghost"
                          onClick={() => handleNotifAction(n)}
                        >
                          {ACTION_LABEL[n.action]}
                        </button>
                        {isDismissibleNotification(n) && (
                          <>
                            {n.target === 'agent' && (
                              <button
                                className="btn sm ghost"
                                onClick={() => dismissGroup('agent', n.targetName)}
                                title="Ocultar todas las mejoras de este agente"
                              >
                                <i className="ti ti-filter-off" />
                              </button>
                            )}
                            {n.scopeLabel === 'Sin categoría' && (
                              <button
                                className="btn sm ghost"
                                onClick={() => dismissGroup('scope', 'Sin categoría')}
                                title="Ocultar mejoras de Sin categoría"
                              >
                                <i className="ti ti-eye-off" />
                              </button>
                            )}
                            <button
                              className="btn sm ghost"
                              onClick={() => dismissNotification(n.id)}
                              title="Ocultar esta mejora"
                            >
                              <i className="ti ti-x" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}

                {notifs.length > 5 && (
                  <button className="btn ghost" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} onClick={() => setShowAll(!showAll)}>
                    {showAll ? 'Ver menos' : `Ver todas (${notifs.length})`}
                  </button>
                )}
              </>
            )}
          </div>

          {/* ── Acciones rápidas ── */}
          <div className="dash-card">
            <div className="dash-card-head">
              <i className="ti ti-bolt" />
              Acciones Rápidas
            </div>
            <div className="dash-actions">
              <button className="btn dash-action" onClick={() => navigateTo('agents', 'new-agent')}>
                <i className="ti ti-cpu" />Nuevo Agente
              </button>
              <button className="btn dash-action" onClick={() => navigateTo('projects', 'new-project')}>
                <i className="ti ti-layout-grid" />Nuevo Proyecto
              </button>
              <button className="btn dash-action" onClick={syncAll} disabled={syncing}>
                <i className={`ti ${syncing ? 'ti-loader-2 dash-spin' : 'ti-refresh'}`} />
                {syncing ? 'Sincronizando...' : 'Sincronizar Todo'}
              </button>
              <button className="btn dash-action" onClick={() => setView('chat')}>
                <i className="ti ti-message-chatbot" />Ir a Chat
              </button>
              <button className="btn dash-action" onClick={() => setView('settings')}>
                <i className="ti ti-settings" />Ajustes
              </button>
            </div>
          </div>

          {/* ── Uso de IA ── */}
          <div className="dash-card">
            <div className="dash-card-head">
              <i className="ti ti-chart-line" />
              Uso de IA
            </div>
            {usage ? <UsageCard usage={usage} onReset={resetUsage} onResetAll={resetAllUsage} /> : (
              <div className="dash-ai-info">
                <i className="ti ti-chart-line" style={{ color: 'var(--text3)', fontSize: 24 }} />
                <p style={{ color: 'var(--text2)' }}>Cargando...</p>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
