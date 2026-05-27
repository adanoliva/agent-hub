import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Topbar } from '../components/layout/Topbar';
import { req } from '../api';
import { useStore } from '../store';
import { useToast } from '../hooks/useToast';
import { AgentsTree } from '../components/agents/AgentsTree';
import { AgentsCenter } from '../components/agents/AgentsCenter';
import { AgentEditor } from '../components/agents/AgentEditor';
import type { Agent, AgentDirectoryStatus, SelectedNode, SyncConflict } from '../types';

const DEFAULT_NODE: SelectedNode = { level: 'global', categoryId: null, techId: null, projectId: null };
const NEW_AGENT: Agent = { name: '', description: '', tools: ['Read'], model: 'sonnet', system: '' };
const SUGGESTIONS_CACHE_KEY = 'cdm-agent-suggestions-cache';

function suggestionsNodeKey(node: SelectedNode) {
  return [node.level, node.categoryId ?? '', node.techId ?? '', node.projectId ?? ''].join('::');
}

function readStoredSuggestionsCache(): Record<string, Agent[]> {
  try {
    const raw = localStorage.getItem(SUGGESTIONS_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredSuggestionsCache(cache: Record<string, Agent[]>) {
  try {
    localStorage.setItem(SUGGESTIONS_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

export function Agents() {
  const toast                = useToast();
  const pendingAction        = useStore((s) => s.pendingAction);
  const pendingAgentToEdit   = useStore((s) => s.pendingAgentToEdit);
  const setPendingAction     = useStore((s) => s.setPendingAction);
  const setPendingAgentToEdit = useStore((s) => s.setPendingAgentToEdit);
  const navigateTo           = useStore((s) => s.navigateTo);
  const setPendingChatAgent  = useStore((s) => s.setPendingChatAgent);
  const projects             = useStore((s) => s.projects);
  const config               = useStore((s) => s.config);

  const [node,               setNode]               = useState<SelectedNode>(DEFAULT_NODE);
  const [expanded,           setExpanded]           = useState<Set<string>>(() => {
    const keys = ['cats', 'projs'];
    (config?.categories ?? []).forEach((c) => keys.push('cat-' + c.id));
    return new Set(keys);
  });
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
  const pendingAgentNameRef                          = useRef<string | null>(null);
  const pendingNodeRef                               = useRef<SelectedNode | null>(null);
  const didInitialLoadRef                            = useRef(false);
  const suggestionsCacheRef                          = useRef<Record<string, Agent[]>>(readStoredSuggestionsCache());

  const sugAbortRef = useRef<AbortController | null>(null);

  // ── Agent loading ──────────────────────────────────────────────────────────

  const loadAgents = useCallback(async (n: SelectedNode) => {
    try {
      console.log('📡 loadAgents called with level:', n.level);
      let data: Agent[];
      if (n.level === 'project') {
        data = n.projectId ? await req<Agent[]>('GET', `/projects/${n.projectId}/agents`) : [];
      } else if (n.level === 'uncategorized') {
        console.log('🔄 Loading uncategorized agents...');
        data = await req<Agent[]>('GET', '/agents?level=uncategorized');
        console.log('📦 Uncategorized agents loaded:', data.map(a => a.name));
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

  const loadSuggestions = useCallback(async (n: SelectedNode, force = false, currentSuggestions: Agent[] = []) => {
    if (n.level === 'uncategorized') { setSuggestions([]); return; }
    sugAbortRef.current?.abort();
    const ctrl = new AbortController();
    sugAbortRef.current = ctrl;

    const alreadySuggested = currentSuggestions.map((s) => s.name);

    setSuggestionsLoading(true);
    try {
      let data: Agent[];
      if (n.level === 'project') {
        const url = force
          ? '/ai/project-suggestions/refresh'
          : `/ai/project-suggestions?projectId=${n.projectId}`;
        data = force
          ? await req<Agent[]>('POST', url, { projectId: n.projectId, alreadySuggested })
          : await req<Agent[]>('GET', url);
      } else {
        const url = force ? '/ai/suggestions/refresh' : '/ai/suggestions';
        if (force) {
          data = await req<Agent[]>('POST', url, {
            level: n.level, categoryId: n.categoryId ?? null, techId: n.techId ?? null,
            alreadySuggested,
          });
        } else {
          const q = new URLSearchParams({ level: n.level, force: 'false' });
          if (n.categoryId) q.set('categoryId', n.categoryId);
          if (n.techId)     q.set('techId', n.techId);
          data = await req<Agent[]>('GET', `${url}?${q}`);
        }
      }
      if (!ctrl.signal.aborted) {
        const nextCache = { ...suggestionsCacheRef.current, [suggestionsNodeKey(n)]: data };
        suggestionsCacheRef.current = nextCache;
        writeStoredSuggestionsCache(nextCache);
        setSuggestions(data);
      }
    } catch (e: any) {
      if (!ctrl.signal.aborted) {
        setSuggestions([]);
        if (force) toast('No se pudieron generar sugerencias: ' + e.message, 'err');
      }
    } finally {
      if (sugAbortRef.current === ctrl) setSuggestionsLoading(false);
    }
  }, [toast]);

  const selectNode = useCallback((n: SelectedNode) => {
    console.log('✅ selectNode called with:', n);
    const currentKey = suggestionsNodeKey(node);
    const nextCurrentCache = { ...suggestionsCacheRef.current, [currentKey]: suggestions };
    suggestionsCacheRef.current = nextCurrentCache;
    writeStoredSuggestionsCache(nextCurrentCache);
    setNode(n);
    setSuggestions(nextCurrentCache[suggestionsNodeKey(n)] ?? []);
    setSelectedAgent(null);
    setEditorAgent(null);
  }, [node, suggestions]);

  useEffect(() => {
    if (pendingAction === 'new-agent') {
      setEditorAgent({ ...NEW_AGENT });
      setEditorIsNew(true);
      setPendingAction(null);
    }
  }, []);

  useEffect(() => {
    if (pendingAgentToEdit) {
      console.log('🔵 pendingAgentToEdit triggered:', pendingAgentToEdit);
      pendingAgentNameRef.current = pendingAgentToEdit.name;
      didInitialLoadRef.current = true;
      const targetNode: SelectedNode = {
        level: pendingAgentToEdit.level as any,
        categoryId: pendingAgentToEdit.categoryId || null,
        techId: pendingAgentToEdit.techId || null,
        projectId: pendingAgentToEdit.projectId || null,
      };
      pendingNodeRef.current = targetNode;
      console.log('🎯 targetNode created:', targetNode);

      // Expand tree nodes to show the agent's location
      setExpanded((prev) => {
        const next = new Set(prev);
        // Always expand categories and projects
        next.add('cats');
        next.add('projs');
        // If agent is in a tech or section, expand its category
        if (pendingAgentToEdit.categoryId) {
          next.add('cat-' + pendingAgentToEdit.categoryId);
        }
        console.log('📦 setExpanded called with:', Array.from(next));
        return next;
      });

      console.log('🔄 calling selectNode...');
      selectNode(targetNode);
    }
  }, [pendingAgentToEdit, setPendingAgentToEdit, selectNode]);

  // When agents are loaded and we have a pending agent, open it
  useEffect(() => {
    if (pendingAgentNameRef.current && agents.length > 0) {
      const agentName = pendingAgentNameRef.current;
      const agentToOpen = agents.find((a) => a.name === agentName);
      if (agentToOpen) {
        const targetNode = pendingNodeRef.current;
        if (targetNode) {
          setNode(targetNode);
          loadAgents(targetNode);
        }
        openEditor(agentToOpen, false);
        pendingAgentNameRef.current = null;
        pendingNodeRef.current = null;
        setPendingAgentToEdit(null);
      }
    }
  }, [agents, loadAgents, setPendingAgentToEdit]);

  useEffect(() => {
    loadAgents(node);
    return () => { sugAbortRef.current?.abort(); };
  }, [node, loadAgents]);

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
    setSuggestions((prev) => {
      const next = prev.filter((s) => s.name !== saved.name);
      const nextCache = { ...suggestionsCacheRef.current, [suggestionsNodeKey(node)]: next };
      suggestionsCacheRef.current = nextCache;
      writeStoredSuggestionsCache(nextCache);
      return next;
    });
    await loadAgents(node);
  }

  async function handleDeleted() {
    setEditorAgent(null);
    setSelectedAgent(null);
    await loadAgents(node);
  }

  function handleRefreshSuggestions() {
    const current = suggestions;
    setSuggestions([]);
    loadSuggestions(node, true, current);
  }

  function handleChatWithAgent(agent: Agent) {
    setPendingChatAgent(agent.name);
    navigateTo('chat');
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
          onChatWithAgent={handleChatWithAgent}
        />
      </div>

      {editorAgent && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && handleCloseEditor()}>
          <div className="modal agent-editor-modal" onClick={(e) => e.stopPropagation()}>
            <AgentEditor
              agent={editorAgent}
              isNew={editorIsNew}
              node={node}
              onClose={handleCloseEditor}
              onSaved={handleSaved}
              onDeleted={handleDeleted}
            />
          </div>
        </div>
      )}
    </div>
  );
}
