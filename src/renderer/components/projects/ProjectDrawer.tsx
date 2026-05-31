import React, { useEffect, useState } from 'react';
import { req } from '../../api';
import { useToast } from '../../hooks/useToast';
import { useCategoryHelpers } from '../../hooks/useCategoryHelpers';
import { ProjectStatusBadge, ProviderBadge, SyncStatusBadge } from './StatusBadge';
import { ExcludeAgentModal } from './ExcludeAgentModal';
import type { Project, SyncPreview, SyncStatus } from '../../types';
import { PROJECT_PROVIDERS } from '../../constants/projects';

type DrawerTab = 'context' | 'sync';

interface Props {
  project: Project;
  onClose: () => void;
  onSync: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
}

export function ProjectDrawer({ project: p, onClose, onSync, onEdit, onDelete, onRefresh }: Props) {
  const toast              = useToast();
  const { catName, techName } = useCategoryHelpers();
  const providers          = p.aiProviders || ['claude'];

  const [tab,        setTab]        = useState<DrawerTab>('context');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({});
  const [syncPreview, setSyncPreview] = useState<SyncPreview | null>(null);
  const [allAgents, setAllAgents]   = useState<{ name: string; level?: string }[]>([]);
  const [agentQuery, setAgentQuery] = useState('');
  const [selectedToAdd, setSelectedToAdd] = useState<string[]>([]);
  const [showCrossAdd, setShowCrossAdd] = useState(false);
  const [ctxContent, setCtxContent] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [excludeAgent, setExcludeAgent] = useState<string | null>(null);

  const isCtxTab  = tab === 'context';

  async function refreshSyncData() {
    try {
      const [status, preview] = await Promise.all([
        req<SyncStatus>('GET', `/projects/${p.id}/sync-status`),
        req<SyncPreview>('GET', `/projects/${p.id}/sync-preview`),
      ]);
      setSyncStatus(status);
      setSyncPreview(preview);
    } catch {
      // no-op
    }
  }

  // Load sync status on mount
  useEffect(() => {
    refreshSyncData();

    req<{ name: string; level?: string }[]>('GET', '/agents/flat')
      .then(setAllAgents)
      .catch(() => setAllAgents([]));
  }, [p.id]);

  // Live refresh while drawer is open
  useEffect(() => {
    const interval = setInterval(() => {
      refreshSyncData();
    }, 15_000);
    return () => clearInterval(interval);
  }, [p.id]);

  // Load context file when tab changes to ctx
  useEffect(() => {
    if (!isCtxTab) return;
    // Always request the central context for the editor
    req<{ content: string; filePath: string; label: string }>('GET', `/projects/${p.id}/context?type=central`)
      .then((r) => { 
        setCtxContent(r.content ?? ''); 
      })
      .catch(() => { setCtxContent(''); });
  }, [p.id, tab]);

  async function saveCtx() {
    try {
      // Backend now writes to central and all providers when saving
      await req('PUT', `/projects/${p.id}/context`, { content: ctxContent, type: 'central' });
      toast('Contexto guardado y sincronizado');
    } catch (e: any) { toast(e.message, 'err'); }
  }

  async function generateCtx() {
    setGenLoading(true);
    try {
      // Use the central type for generation
      const { content } = await req<{ content: string }>('POST', `/projects/${p.id}/generate-context?type=central`);
      setCtxContent(content);
      toast('Contexto generado — revísalo y guarda para sincronizar');
    } catch (e: any) { toast(e.message, 'err'); }
    finally { setGenLoading(false); }
  }

  async function openVSCode() {
    const r = await (window as any).api?.openVSCode?.(p.path);
    if (r && !r.ok) toast(r.error, 'err');
  }

  function openFolder() {
    (window as any).api?.openPath?.(p.path);
  }

  async function handleIncludeAgent(agentName: string) {
    const excluded = (p.excludedAgents ?? []).filter((a) => a !== agentName);
    try {
      await req('PUT', `/projects/${p.id}`, { excludedAgents: excluded });
      await req('POST', `/projects/${p.id}/sync`);
      onRefresh();
      toast(`"${agentName}" incluido y sincronizado`);
      await refreshSyncData();
    } catch (e: any) { toast(e.message, 'err'); }
  }

  async function handleAddCrossCategoryAgents() {
    if (selectedToAdd.length === 0) return;

    const toAdd = selectedToAdd.filter((name) => !syncStatus[name]);
    if (toAdd.length === 0) {
      toast('Los agentes seleccionados ya están en este proyecto', 'warn');
      return;
    }

    const included = [...new Set([...(p.includedAgents ?? []), ...toAdd])];
    try {
      await req('PUT', `/projects/${p.id}`, { includedAgents: included });
      await req('POST', `/projects/${p.id}/sync`);
      onRefresh();
      setAgentQuery('');
      setSelectedToAdd([]);
      toast(`${toAdd.length} agente${toAdd.length !== 1 ? 's' : ''} añadido${toAdd.length !== 1 ? 's' : ''} al proyecto`);
      await refreshSyncData();
    } catch (e: any) {
      toast(e.message, 'err');
    }
  }

  function toggleCandidate(agentName: string) {
    setSelectedToAdd((prev) => prev.includes(agentName)
      ? prev.filter((n) => n !== agentName)
      : [...prev, agentName]);
  }

  function selectFilteredCandidates() {
    const filteredNames = filteredCrossAgents.map((a) => a.name);
    setSelectedToAdd((prev) => [...new Set([...prev, ...filteredNames])]);
  }

  function clearSelectedCandidates() {
    setSelectedToAdd([]);
  }

  async function handleRemoveCrossCategoryAgent(agentName: string) {
    const included = (p.includedAgents ?? []).filter((a) => a !== agentName);
    try {
      await req('PUT', `/projects/${p.id}`, { includedAgents: included });
      await req('DELETE', `/projects/${p.id}/agents/${encodeURIComponent(agentName)}`);
      onRefresh();
      toast(`"${agentName}" eliminado del proyecto`);
      await refreshSyncData();
    } catch (e: any) {
      toast(e.message, 'err');
    }
  }

  const syncValues  = Object.values(syncStatus);
  const okCount     = syncValues.filter((s) => s.status === 'ok').length;
  const pendCount   = syncValues.filter((s) => s.status === 'outdated' || s.status === 'new').length;
  const exclCount   = syncValues.filter((s) => s.status === 'excluded').length;
  const uniqueByName = new Map<string, { name: string; level?: string }>();
  for (const a of allAgents) {
    if (!uniqueByName.has(a.name)) uniqueByName.set(a.name, a);
  }

  const availableCrossAgents = [...uniqueByName.values()]
    .filter((a) => !syncStatus[a.name])
    .sort((a, b) => a.name.localeCompare(b.name));

  const normalizedQuery = agentQuery.trim().toLowerCase();
  const filteredCrossAgents = normalizedQuery
    ? availableCrossAgents.filter((a) => (`${a.name} ${a.level || ''}`).toLowerCase().includes(normalizedQuery))
    : availableCrossAgents;

  return (
    <>
      <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal project-info-modal">
          {/* Head */}
          <div className="drawer-head">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div className="drawer-title">{p.name}</div>
              <button className="btn ghost sm" onClick={onClose}><i className="ti ti-x" /></button>
            </div>
            <div className="drawer-meta">
              {p.techId && <span className="badge blue"><i className="ti ti-code" />{techName(p.categoryId, p.techId)}</span>}
              <span className="badge gray"><i className="ti ti-folder" />{catName(p.categoryId)}</span>
              <ProjectStatusBadge status={p.status} />
              <ProviderBadge providers={p.aiProviders} />
            </div>
          </div>

          {/* Tabs */}
          <div className="drawer-tabs">
            <div
              className={`drawer-tab${tab === 'context' ? ' active' : ''}`}
              onClick={() => setTab('context')}
            >
              <i className="ti ti-file-description" style={{ marginRight: 6 }} />
              Contexto
            </div>
            <div
              className={`drawer-tab${tab === 'sync' ? ' active' : ''}`}
              onClick={() => setTab('sync')}
            >
              Agentes <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text2)' }}>{Object.keys(syncStatus).length}</span>
            </div>
          </div>

          {/* Body */}
          <div className="drawer-body">
            {isCtxTab ? (
              <>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 10 }}>Sincronizado en todos los proveedores ({providers.join(', ')})</div>
                <textarea
                  className="claude-md-editor"
                  value={ctxContent}
                  onChange={(e) => setCtxContent(e.target.value)}
                />
              </>
            ) : (
              <>
                <div className="drawer-agent-add">
                  <button
                    className="drawer-agent-add-head drawer-agent-add-toggle"
                    onClick={() => setShowCrossAdd((v) => !v)}
                    aria-expanded={showCrossAdd}
                    type="button"
                  >
                    <span className="drawer-agent-add-title">
                      <i className="ti ti-link" />
                      <span>Añadir agente de otra categoría</span>
                    </span>
                    <span className="drawer-agent-add-summary">
                      {selectedToAdd.length > 0 ? `${selectedToAdd.length} seleccionado${selectedToAdd.length !== 1 ? 's' : ''}` : 'Opcional'}
                    </span>
                    <i className={`ti ${showCrossAdd ? 'ti-chevron-up' : 'ti-chevron-down'}`} />
                  </button>

                  {showCrossAdd && (
                    <>
                      <div className="drawer-agent-search-wrap">
                        <i className="ti ti-search" />
                        <input
                          className="drawer-agent-search"
                          value={agentQuery}
                          onChange={(e) => setAgentQuery(e.target.value)}
                          placeholder="Buscar por nombre o nivel..."
                        />
                        {agentQuery && (
                          <button className="btn ghost sm" onClick={() => setAgentQuery('')}>
                            <i className="ti ti-x" />
                          </button>
                        )}
                      </div>

                      <div className="drawer-agent-candidates">
                        {filteredCrossAgents.length === 0 ? (
                          <div className="drawer-agent-empty">Sin resultados</div>
                        ) : (
                          filteredCrossAgents.map((a) => (
                            <label key={`${a.name}-${a.level || 'x'}`} className="drawer-agent-option">
                              <input
                                type="checkbox"
                                checked={selectedToAdd.includes(a.name)}
                                onChange={() => toggleCandidate(a.name)}
                              />
                              <span className="drawer-agent-option-name">{a.name}</span>
                              <span className="drawer-agent-option-level">{a.level || 'global'}</span>
                            </label>
                          ))
                        )}
                      </div>

                      <div className="drawer-agent-bulk-actions">
                        <button
                          className="btn sm ghost"
                          onClick={selectFilteredCandidates}
                          disabled={filteredCrossAgents.length === 0}
                        >
                          <i className="ti ti-checks" /> Seleccionar filtrados
                        </button>
                        <button
                          className="btn sm ghost"
                          onClick={clearSelectedCandidates}
                          disabled={selectedToAdd.length === 0}
                        >
                          <i className="ti ti-clear-all" /> Limpiar selección
                        </button>
                      </div>

                      <div className="drawer-agent-add-row">
                        <span className="drawer-agent-selected-count">
                          {selectedToAdd.length} seleccionado{selectedToAdd.length !== 1 ? 's' : ''} · {filteredCrossAgents.length} filtrado{filteredCrossAgents.length !== 1 ? 's' : ''}
                        </span>
                        <button className="btn sm" onClick={handleAddCrossCategoryAgents} disabled={selectedToAdd.length === 0}>
                          <i className="ti ti-plus" /> Añadir seleccionados
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {syncPreview && (
                  <div className="drawer-sync-preview">
                    <div className="drawer-sync-preview-head">
                      <span><i className="ti ti-list-details" /> Preview de sync</span>
                      <button className="btn sm ghost" onClick={refreshSyncData} title="Actualizar preview">
                        <i className="ti ti-refresh" />
                      </button>
                    </div>
                    <div className="drawer-sync-preview-stats">
                      <span className="badge amber"><i className="ti ti-plus" /> Añadir: {syncPreview.summary.toAdd}</span>
                      <span className="badge blue"><i className="ti ti-refresh" /> Actualizar: {syncPreview.summary.toUpdate}</span>
                      <span className="badge gray"><i className="ti ti-check" /> Al día: {syncPreview.summary.upToDate}</span>
                    </div>

                    {(syncPreview.toAdd.length > 0 || syncPreview.toUpdate.length > 0) ? (
                      <div className="drawer-sync-preview-list">
                        {syncPreview.toAdd.slice(0, 5).map((a) => (
                          <div key={`add-${a.name}`} className="drawer-sync-preview-item">
                            <span className="drawer-sync-preview-name">{a.name}</span>
                            <span className="drawer-sync-preview-action add">Añadir</span>
                          </div>
                        ))}
                        {syncPreview.toUpdate.slice(0, 5).map((a) => (
                          <div key={`update-${a.name}`} className="drawer-sync-preview-item">
                            <span className="drawer-sync-preview-name">{a.name}</span>
                            <span className="drawer-sync-preview-action update">Actualizar</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="drawer-sync-preview-empty">Sin cambios pendientes para aplicar</div>
                    )}
                  </div>
                )}

                <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: 'var(--text1)' }}>
                    {okCount} al día, {pendCount} pendientes{exclCount ? `, ${exclCount} excluido${exclCount !== 1 ? 's' : ''}` : ''}
                  </span>
                </div>
                {Object.keys(syncStatus).length === 0
                  ? <div style={{ color: 'var(--text2)', fontSize: 12 }}>Sin agentes registrados</div>
                  : Object.entries(syncStatus).map(([name, entry]) => {
                    const isExcluded = entry.status === 'excluded';
                    const isLocal    = entry.status === 'local';
                    const isIncluded = (p.includedAgents ?? []).includes(name);
                    return (
                      <div key={name} className="sync-agent-row">
                        <span className="sync-agent-name">{name}</span>
                        <span className="sync-agent-level">{entry.agent?.level ?? ''}</span>
                        <SyncStatusBadge status={entry.status} />
                        {!isLocal && (
                          <button
                            className="btn ghost sm"
                            style={{ padding: '2px 6px', fontSize: 10, flexShrink: 0 }}
                            onClick={() => {
                              if (isIncluded) handleRemoveCrossCategoryAgent(name);
                              else if (isExcluded) handleIncludeAgent(name);
                              else setExcludeAgent(name);
                            }}
                            title={isIncluded ? 'Quitar agente añadido manualmente' : isExcluded ? 'Incluir en el proyecto' : 'Excluir del proyecto'}
                          >
                            <i className={`ti ${isIncluded ? 'ti-x' : isExcluded ? 'ti-eye' : 'ti-eye-off'}`} />
                          </button>
                        )}
                      </div>
                    );
                  })
                }
              </>
            )}
          </div>

          {/* Footer */}
          <div className="drawer-foot">
            {isCtxTab ? (
              <>
                <button className="btn primary" onClick={saveCtx}><i className="ti ti-device-floppy" /> Guardar</button>
                <button className="btn" onClick={generateCtx} disabled={genLoading}>
                  {genLoading
                    ? <><i className="ti ti-loader-2" style={{ animation: 'spin 1s linear infinite' }} /> Analizando...</>
                    : <><i className="ti ti-wand" /> Generar con IA</>
                  }
                </button>
              </>
            ) : (
              <button className="btn" onClick={() => { onSync(p.id); onClose(); }}>
                <i className="ti ti-refresh" /> Sync este proyecto
              </button>
            )}
            <button className="btn" onClick={openVSCode}><i className="ti ti-brand-vscode" /> VS Code</button>
            <button className="btn" onClick={openFolder}><i className="ti ti-folder-open" /> Carpeta</button>
            <div style={{ flex: 1 }} />
            <button className="btn sm ghost" onClick={() => onEdit(p.id)} title="Editar proyecto"><i className="ti ti-pencil" /></button>
            <button className="btn danger sm" onClick={() => onDelete(p.id)}><i className="ti ti-trash" /></button>
          </div>
        </div>
      </div>

      {excludeAgent && (
        <ExcludeAgentModal
          projectId={p.id}
          agentName={excludeAgent}
          excludedAgents={p.excludedAgents ?? []}
          onClose={() => setExcludeAgent(null)}
          onExcluded={async () => {
            onRefresh();
            await refreshSyncData();
          }}
        />
      )}
    </>
  );
}
