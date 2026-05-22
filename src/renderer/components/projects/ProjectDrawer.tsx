import React, { useEffect, useState } from 'react';
import { req } from '../../api';
import { useToast } from '../../hooks/useToast';
import { useCategoryHelpers } from '../../hooks/useCategoryHelpers';
import { ProjectStatusBadge, ProviderBadge, SyncStatusBadge } from './StatusBadge';
import { ExcludeAgentModal } from './ExcludeAgentModal';
import type { Project, SyncStatus } from '../../types';

type DrawerTab = 'ctx-claude' | 'ctx-github' | 'sync';

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
  const provider           = (p.aiProvider ?? 'claude') as string;

  const defaultTab: DrawerTab = provider === 'github' ? 'ctx-github' : 'ctx-claude';
  const [tab,        setTab]        = useState<DrawerTab>(defaultTab);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({});
  const [ctxContent, setCtxContent] = useState('');
  const [ctxPath,    setCtxPath]    = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [excludeAgent, setExcludeAgent] = useState<string | null>(null);

  const isCtxTab  = tab === 'ctx-claude' || tab === 'ctx-github';
  const ctxType   = tab === 'ctx-github' ? 'github' : 'claude';
  const ctxLabel  = ctxType === 'github' ? 'copilot-instructions.md' : 'CLAUDE.md';

  // Load sync status on mount
  useEffect(() => {
    req<SyncStatus>('GET', `/projects/${p.id}/sync-status`)
      .then(setSyncStatus)
      .catch(() => {});
  }, [p.id]);

  // Load context file when tab changes to ctx
  useEffect(() => {
    if (!isCtxTab) return;
    req<{ content: string; filePath: string }>('GET', `/projects/${p.id}/context?type=${ctxType}`)
      .then((r) => { setCtxContent(r.content ?? ''); setCtxPath(r.filePath ?? ''); })
      .catch(() => { setCtxContent(''); setCtxPath(''); });
  }, [p.id, tab]);

  async function saveCtx() {
    try {
      await req('PUT', `/projects/${p.id}/context`, { content: ctxContent, type: ctxType });
      toast(`${ctxLabel} guardado`);
    } catch (e: any) { toast(e.message, 'err'); }
  }

  async function generateCtx() {
    setGenLoading(true);
    try {
      const { content } = await req<{ content: string }>('POST', `/projects/${p.id}/generate-context?type=${ctxType}`);
      setCtxContent(content);
      toast(`${ctxLabel} generado — revísalo y guarda cuando estés listo`);
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
      const status = await req<SyncStatus>('GET', `/projects/${p.id}/sync-status`);
      setSyncStatus(status);
    } catch (e: any) { toast(e.message, 'err'); }
  }

  const syncValues  = Object.values(syncStatus);
  const okCount     = syncValues.filter((s) => s.status === 'ok').length;
  const pendCount   = syncValues.filter((s) => s.status === 'outdated' || s.status === 'new').length;
  const exclCount   = syncValues.filter((s) => s.status === 'excluded').length;

  const ctxTabs = () => {
    if (provider === 'both') return (
      <>
        <div className={`drawer-tab${tab === 'ctx-claude' ? ' active' : ''}`} onClick={() => setTab('ctx-claude')}>CLAUDE.md</div>
        <div className={`drawer-tab${tab === 'ctx-github' ? ' active' : ''}`} onClick={() => setTab('ctx-github')}>Copilot</div>
      </>
    );
    if (provider === 'github') return (
      <div className={`drawer-tab${isCtxTab ? ' active' : ''}`} onClick={() => setTab('ctx-github')}>copilot-instructions.md</div>
    );
    return (
      <div className={`drawer-tab${isCtxTab ? ' active' : ''}`} onClick={() => setTab('ctx-claude')}>CLAUDE.md</div>
    );
  };

  return (
    <>
      <div className="drawer-overlay">
        <div className="drawer">
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
              <ProviderBadge provider={provider} />
            </div>
          </div>

          {/* Tabs */}
          <div className="drawer-tabs">
            {ctxTabs()}
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
                <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 10, fontFamily: 'var(--mono)' }}>{ctxPath}</div>
                <textarea
                  className="claude-md-editor"
                  value={ctxContent}
                  onChange={(e) => setCtxContent(e.target.value)}
                />
              </>
            ) : (
              <>
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
                    return (
                      <div key={name} className="sync-agent-row">
                        <span className="sync-agent-name">{name}</span>
                        <span className="sync-agent-level">{entry.agent?.level ?? ''}</span>
                        <SyncStatusBadge status={entry.status} />
                        {!isLocal && (
                          <button
                            className="btn ghost sm"
                            style={{ padding: '2px 6px', fontSize: 10, flexShrink: 0 }}
                            onClick={() => isExcluded ? handleIncludeAgent(name) : setExcludeAgent(name)}
                            title={isExcluded ? 'Incluir en el proyecto' : 'Excluir del proyecto'}
                          >
                            <i className={`ti ${isExcluded ? 'ti-eye' : 'ti-eye-off'}`} />
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
            const status = await req<SyncStatus>('GET', `/projects/${p.id}/sync-status`);
            setSyncStatus(status);
          }}
        />
      )}
    </>
  );
}
