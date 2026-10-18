import React, { useState, useEffect } from 'react';
import { req } from '../api';
import { useStore } from '../store';
import type { Project, Orchestration, OrchestrateNode, DataFlow, ContextExtra } from '../types';
import { OrchestrationList } from '../components/orchestrations/OrchestrationList';
import { OrchestrationEditor } from '../components/orchestrations/OrchestrationEditor';
import { ExecutionPanel } from '../components/orchestrations/ExecutionPanel';
import { EMBED } from '../embed';

type SubView = 'list' | 'editor' | 'execution';

function generateNodeId(): string {
  return `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Create modal ──────────────────────────────────────────────────────────────

interface CreateModalProps {
  projectId: string;
  onCancel:  () => void;
  onCreate:  (orch: Orchestration) => void;
}

function CreateOrchestrationModal({ projectId, onCancel, onCreate }: CreateModalProps) {
  const addToast = useStore(s => s.addToast);
  const [name,        setName]        = useState('');
  const [description, setDescription] = useState('');
  const [saving,      setSaving]      = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) { addToast('El nombre es obligatorio', 'warn'); return; }
    setSaving(true);
    try {
      const orch = await req<Orchestration>('POST', '/orchestrations', {
        projectId,
        name: name.trim(),
        description: description.trim(),
        agents: [],
        nodes:  [],
      });
      onCreate(orch);
    } catch (e: any) {
      addToast(`Error al crear: ${e.message}`, 'err');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal" style={{ width: 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span>Nueva orquestación</span>
          <button className="btn ghost xs" onClick={onCancel}><i className="ti ti-x" /></button>
        </div>
        <div className="modal-body" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <label className="label">Nombre *</label>
            <input
              type="text"
              className="input"
              placeholder="Code Review & Refactor"
              value={name}
              autoFocus
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
            />
          </div>
          <div className="field">
            <label className="label">Descripción (opcional)</label>
            <input
              type="text"
              className="input"
              placeholder="Breve descripción del flujo"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onCancel}>Cancelar</button>
          <button className="btn primary" onClick={handleCreate} disabled={saving}>
            {saving ? <i className="ti ti-loader-2 spin" /> : <i className="ti ti-plus" />}
            {' '}Crear
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function Orchestrations() {
  const addToast  = useStore(s => s.addToast);
  const projects  = useStore(s => s.projects);

  const [selectedProjectId, setSelectedProjectId] = useState<string>(EMBED?.project || '');
  const [orchestrations,    setOrchestrations]    = useState<Orchestration[]>([]);
  const [subView,           setSubView]           = useState<SubView>('list');
  const [selectedOrch,      setSelectedOrch]      = useState<Orchestration | null>(null);
  const [showCreate,        setShowCreate]        = useState(false);
  const [loading,           setLoading]           = useState(false);

  const activeProjects = projects.filter(p => p.pathExists !== false);

  // Auto-select first project
  useEffect(() => {
    if (!selectedProjectId && activeProjects.length > 0) {
      setSelectedProjectId(activeProjects[0].id);
    }
  }, [activeProjects.length]);

  const loadList = () => req<Orchestration[]>('GET', `/orchestrations?projectId=${selectedProjectId}`).then(setOrchestrations);

  // Load orchestrations when project changes
  useEffect(() => {
    if (!selectedProjectId) return;
    setLoading(true);
    loadList()
      .then(() => {
        if (!EMBED || embedOpened.current) return;
        embedOpened.current = true;
        if (EMBED.mode === 'new') setShowCreate(true);
      })
      .catch(() => setOrchestrations([]))
      .finally(() => setLoading(false));
    setSubView('list');
    setSelectedOrch(null);
  }, [selectedProjectId]);

  // Embedded (VS Code): once the list is in, open the requested orchestration in the requested mode
  const embedOpened = React.useRef(false);
  const embedTarget = React.useRef(EMBED?.orch || null);
  useEffect(() => {
    const target = embedTarget.current;
    if (!target) return;
    const orch = orchestrations.find(o => o.id === target);
    if (!orch) return;
    embedTarget.current = null;
    setSelectedOrch(orch);
    setSubView(EMBED?.mode === 'execution' ? 'execution' : 'editor');
  }, [orchestrations]);

  // Executions can start or end elsewhere (VS Code, API): keep the list's "running" state current
  useEffect(() => {
    if (!selectedProjectId || subView !== 'list') return;
    const t = setInterval(() => { loadList().catch(() => {}); }, 5000);
    return () => clearInterval(t);
  }, [selectedProjectId, subView]);

  const project = activeProjects.find(p => p.id === selectedProjectId);

  const handleCreate = (orch: Orchestration) => {
    setOrchestrations(prev => [orch, ...prev]);
    setSelectedOrch(orch);
    setShowCreate(false);
    setSubView('editor');
  };

  const handleSave = async (data: Partial<Orchestration>): Promise<void> => {
    if (!selectedOrch) return;
    const updated = await req<Orchestration>('PUT', `/orchestrations/${selectedOrch.id}`, data);
    setSelectedOrch(updated);
    setOrchestrations(prev => prev.map(o => o.id === updated.id ? updated : o));
    addToast('Orquestación guardada', 'ok');
  };

  const handleDelete = (orchId: string) => {
    setOrchestrations(prev => prev.filter(o => o.id !== orchId));
    if (selectedOrch?.id === orchId) {
      setSelectedOrch(null);
      setSubView('list');
    }
  };

  const handleSelect = (orch: Orchestration) => {
    setSelectedOrch(orch);
    setSubView('editor');
  };

  const handleExecute = (orch: Orchestration) => {
    setSelectedOrch(orch);
    setSubView('execution');
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="orch-page">
      {/* Topbar */}
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-title">
            <i className="ti ti-topology-ring-2" /> Orquestaciones
          </div>
          {project && subView !== 'list' && (
            <span className="topbar-sub">{project.name}</span>
          )}
        </div>
        <div className="topbar-right">
          {subView === 'list' && (
            <>
              {!EMBED && <select
                className="input sm orch-project-select"
                value={selectedProjectId}
                onChange={e => setSelectedProjectId(e.target.value)}
              >
                {activeProjects.length === 0 && (
                  <option value="">Sin proyectos</option>
                )}
                {activeProjects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>}
              {selectedProjectId && (
                <button className="btn primary sm" style={{ marginLeft: 12 }} onClick={() => setShowCreate(true)}>
                  <i className="ti ti-plus" /> Nueva orquestación
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="orch-content">
        {selectedProjectId && !project && (
          <div className="orch-loading"><i className="ti ti-loader-2 spin" /></div>
        )}

        {!selectedProjectId && (
          <div className="orch-no-project">
            <i className="ti ti-layout-grid" />
            <p>Selecciona un proyecto para ver sus orquestaciones</p>
          </div>
        )}

        {project && subView === 'list' && (
          loading ? (
            <div className="orch-loading">
              <i className="ti ti-loader-2 spin" />
            </div>
          ) : (
            <OrchestrationList
              orchestrations={orchestrations}
              project={project!}
              onSelect={handleSelect}
              onDelete={handleDelete}
              onExecute={handleExecute}
              onRefresh={() => loadList().catch(() => {})}
              onNew={() => setShowCreate(true)}
            />
          )
        )}

        {project && subView === 'editor' && selectedOrch && (
          <OrchestrationEditor
            orchestration={selectedOrch}
            projectId={selectedProjectId}
            onSave={handleSave}
            onBack={() => setSubView('list')}
            onExecute={() => setSubView('execution')}
          />
        )}

        {project && subView === 'execution' && selectedOrch && (
          <ExecutionPanel
            orchestration={selectedOrch}
            projectId={selectedProjectId}
            onBack={() => setSubView('list')}
          />
        )}
      </div>

      {/* Create modal */}
      {showCreate && project && (
        <CreateOrchestrationModal
          projectId={selectedProjectId}
          onCreate={handleCreate}
          onCancel={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
