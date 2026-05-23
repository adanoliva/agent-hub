import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Topbar } from '../components/layout/Topbar';
import { req } from '../api';
import { useToast } from '../hooks/useToast';
import { AgentsTree } from '../components/agents/AgentsTree';
import { AgentsCenter } from '../components/agents/AgentsCenter';
import { AgentEditor } from '../components/agents/AgentEditor';
import type { Agent, AgentDirectoryStatus, SelectedNode, SyncConflict } from '../types';

const DEFAULT_NODE: SelectedNode = { level: 'global', categoryId: null, techId: null, projectId: null };
const NEW_AGENT: Agent = { name: '', description: '', tools: ['Read'], model: 'sonnet', system: '' };

export function Agents() {
  const toast = useToast();

  const [node,               setNode]               = useState<SelectedNode>(DEFAULT_NODE);
  const [expanded,           setExpanded]           = useState<Set<string>>(new Set());
  const [agents,             setAgents]             = useState<Agent[]>([]);
  const [suggestions,        setSuggestions]        = useState<Agent[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [selectedAgent,      setSelectedAgent]      = useState<string | null>(null);
  const [editorAgent,        setEditorAgent]        = useState<Agent | null>(null);
  const [editorIsNew,        setEditorIsNew]        = useState(false);

  // Sync state
  const [syncStatus,         setSyncStatus]         = useState<AgentDirectoryStatus | null>(null);
  const [showConflicts,      setShowConflicts]      = useState(false);
  const pollRef                                      = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasSyncingRef                                = useRef(false);

  const sugAbortRef = useRef<AbortController | null>(null);

  // ── Agent loading ──────────────────────────────────────────────────────────

  const loadAgents = useCallback(async (n: SelectedNode) => {
    try {
      let data: Agent[];
      if (n.level === 'project') {
        data = n.projectId ? await req<Agent[]>('GET', `/projects/${n.projectId}/agents`) : [];
      } else if (n.level === 'uncategorized') {
        data = await req<Agent[]>('GET', '/agents?level=uncategorized');
      } else {
        const q = new URLSearchParams({ level: n.level });
        if (n.categoryId) q.set('categoryId', n.categoryId);
        if (n.techId)     q.set('techId', n.techId);
        data = await req<Agent[]>('GET', `/agents?${q}`);
      }
      setAgents(data);
    } catch (e: any) {
      toast(e.message, 'err');
      setAgents([]);
    }
  }, [toast]);

  const loadSuggestions = useCallback(async (n: SelectedNode, force = false) => {
    if (n.level === 'uncategorized') { setSuggestions([]); return; }
    sugAbortRef.current?.abort();
    const ctrl = new AbortController();
    sugAbortRef.current = ctrl;

    setSuggestionsLoading(true);
    try {
      let data: Agent[];
      if (n.level === 'project') {
        const url = force
          ? '/ai/project-suggestions/refresh'
          : `/ai/project-suggestions?projectId=${n.projectId}`;
        data = force
          ? await req<Agent[]>('POST', url, { projectId: n.projectId })
          : await req<Agent[]>('GET', url);
      } else {
        const url = force ? '/ai/suggestions/refresh' : '/ai/suggestions';
        if (force) {
          data = await req<Agent[]>('POST', url, {
            level: n.level, categoryId: n.categoryId ?? null, techId: n.techId ?? null,
          });
        } else {
          const q = new URLSearchParams({ level: n.level, force: 'false' });
          if (n.categoryId) q.set('categoryId', n.categoryId);
          if (n.techId)     q.set('techId', n.techId);
          data = await req<Agent[]>('GET', `${url}?${q}`);
        }
      }
      if (!ctrl.signal.aborted) setSuggestions(data);
    } catch (e: any) {
      if (!ctrl.signal.aborted) {
        setSuggestions([]);
        if (force) toast('No se pudieron generar sugerencias: ' + e.message, 'err');
      }
    } finally {
      if (!ctrl.signal.aborted) setSuggestionsLoading(false);
    }
  }, [toast]);

  const selectNode = useCallback(async (n: SelectedNode) => {
    setNode(n);
    setSuggestions([]);
    setSelectedAgent(null);
    setEditorAgent(null);
    await loadAgents(n);
    loadSuggestions(n);
  }, [loadAgents, loadSuggestions]);

  useEffect(() => {
    loadAgents(DEFAULT_NODE);
    loadSuggestions(DEFAULT_NODE);
    return () => { sugAbortRef.current?.abort(); };
  }, []);

  // ── Directory sync polling ─────────────────────────────────────────────────

  const fetchSyncStatus = useCallback(async () => {
    try {
      const status = await req<AgentDirectoryStatus>('GET', '/agents-directory/status');
      setSyncStatus(status);

      if (status.syncing) {
        wasSyncingRef.current = true;
      } else {
        // Stop polling when done
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }

        // Only react to a sync that finished during this session
        if (wasSyncingRef.current) {
          wasSyncingRef.current = false;

          if (status.pendingConflicts.length > 0) setShowConflicts(true);

          if (status.lastResult && !status.lastResult.error) {
            await loadAgents(node);
            if (status.lastResult.updated > 0) {
              toast(`Directorio sincronizado: ${status.lastResult.updated} agente(s) actualizado(s)`);
            }
          }
        } else if (status.pendingConflicts.length > 0) {
          // Surface unresolved conflicts that existed before this session
          setShowConflicts(true);
        }
      }
    } catch {}
  }, [node, loadAgents, toast]);

  useEffect(() => {
    // Check on mount
    fetchSyncStatus();

    // Start polling to detect an in-progress sync
    pollRef.current = setInterval(fetchSyncStatus, 600);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // ── Conflict resolution ────────────────────────────────────────────────────

  async function resolveConflict(fileKey: string, action: 'keep' | 'update') {
    try {
      await req('POST', '/agents-directory/resolve-conflict', { fileKey, action });
      setSyncStatus((prev) => prev
        ? { ...prev, pendingConflicts: prev.pendingConflicts.filter((c) => c.fileKey !== fileKey) }
        : prev
      );
      if (action === 'update') await loadAgents(node);
    } catch (e: any) {
      toast('Error al resolver conflicto: ' + e.message, 'err');
    }
  }

  // ── Agent handlers ─────────────────────────────────────────────────────────

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function openEditor(agent: Agent, isNew: boolean) {
    setEditorAgent({ ...agent });
    setEditorIsNew(isNew);
    if (!isNew) setSelectedAgent(agent.name);
  }

  function handleSelectAgent(agent: Agent)    { openEditor(agent, false); }
  function handleUseSuggestion(agent: Agent)  { openEditor(agent, true); }
  function handleNewAgent()                   { setSelectedAgent(null); openEditor({ ...NEW_AGENT }, true); }
  function handleCloseEditor()                { setEditorAgent(null); setSelectedAgent(null); }

  async function handleSaved(saved: Agent) {
    setEditorIsNew(false);
    setSelectedAgent(saved.name);
    await loadAgents(node);
  }

  async function handleDeleted() {
    setEditorAgent(null);
    setSelectedAgent(null);
    await loadAgents(node);
  }

  function handleRefreshSuggestions() {
    setSuggestions([]);
    loadSuggestions(node, true);
  }

  // ── First-sync overlay ─────────────────────────────────────────────────────

  const isFirstSync = syncStatus?.firstSync && syncStatus?.syncing;
  const progress    = syncStatus?.progress;

  return (
    <div className="view active" id="view-agents">
      <Topbar title="Agentes" />

      {/* First-run sync overlay */}
      {isFirstSync && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 100,
          background: 'var(--bg1)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 20,
        }}>
          <i className="ti ti-cloud-download" style={{ fontSize: 40, color: 'var(--accent)' }} />
          <div style={{ fontSize: 16, fontWeight: 600 }}>Descargando directorio de agentes…</div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>
            {progress?.current ? `${progress.current}` : 'Conectando…'}
          </div>
          {progress && progress.total > 0 && (
            <div style={{ width: 320 }}>
              <div style={{
                height: 4, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', background: 'var(--accent)',
                  width: `${Math.round((progress.done / progress.total) * 100)}%`,
                  transition: 'width .2s',
                }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6, textAlign: 'center' }}>
                {progress.done} / {progress.total}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Conflicts modal */}
      {showConflicts && syncStatus && syncStatus.pendingConflicts.length > 0 && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 99,
          background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 12,
            padding: 28, width: 480, maxHeight: '70vh', display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              <i className="ti ti-git-merge" style={{ marginRight: 8, color: 'var(--amber)' }} />
              Conflictos de sincronización
            </div>
            <p style={{ fontSize: 12, color: 'var(--text2)', margin: 0 }}>
              Estos agentes fueron modificados tanto en el directorio remoto como localmente. Elige qué versión conservar.
            </p>
            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {syncStatus.pendingConflicts.map((c: SyncConflict) => (
                <div key={c.fileKey} style={{
                  background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <i className="ti ti-file-text" style={{ color: 'var(--text3)', flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 13, fontFamily: 'var(--mono)' }}>{c.name}</span>
                  <button className="btn sm" onClick={() => resolveConflict(c.fileKey, 'keep')} style={{ flexShrink: 0 }}>
                    Mantener la mía
                  </button>
                  <button className="btn sm accent" onClick={() => resolveConflict(c.fileKey, 'update')} style={{ flexShrink: 0 }}>
                    Actualizar
                  </button>
                </div>
              ))}
            </div>
            {syncStatus.pendingConflicts.length === 0 && (
              <button className="btn" onClick={() => setShowConflicts(false)}>Cerrar</button>
            )}
          </div>
        </div>
      )}

      <div className="agents-view">
        <AgentsTree
          selected={node}
          expanded={expanded}
          onSelect={selectNode}
          onToggle={toggleExpanded}
        />
        <AgentsCenter
          node={node}
          agents={agents}
          suggestions={suggestions}
          suggestionsLoading={suggestionsLoading}
          selectedAgent={selectedAgent}
          onSelectAgent={handleSelectAgent}
          onUseSuggestion={handleUseSuggestion}
          onNewAgent={handleNewAgent}
          onRefreshSuggestions={handleRefreshSuggestions}
        />
        {editorAgent && (
          <AgentEditor
            agent={editorAgent}
            isNew={editorIsNew}
            node={node}
            onClose={handleCloseEditor}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
          />
        )}
      </div>
    </div>
  );
}
