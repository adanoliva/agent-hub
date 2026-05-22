import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Topbar } from '../components/layout/Topbar';
import { req } from '../api';
import { useToast } from '../hooks/useToast';
import { AgentsTree } from '../components/agents/AgentsTree';
import { AgentsCenter } from '../components/agents/AgentsCenter';
import { AgentEditor } from '../components/agents/AgentEditor';
import type { Agent, SelectedNode } from '../types';

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

  const sugAbortRef = useRef<AbortController | null>(null);

  const loadAgents = useCallback(async (n: SelectedNode) => {
    try {
      let data: Agent[];
      if (n.level === 'project') {
        data = n.projectId ? await req<Agent[]>('GET', `/projects/${n.projectId}/agents`) : [];
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

  function handleSelectAgent(agent: Agent) {
    openEditor(agent, false);
  }

  function handleUseSuggestion(agent: Agent) {
    openEditor(agent, true);
  }

  function handleNewAgent() {
    setSelectedAgent(null);
    openEditor({ ...NEW_AGENT }, true);
  }

  function handleCloseEditor() {
    setEditorAgent(null);
    setSelectedAgent(null);
  }

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

  return (
    <div className="view active" id="view-agents">
      <Topbar title="Agentes" />
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
