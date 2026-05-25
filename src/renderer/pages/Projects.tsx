import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { req } from '../api';
import { useToast } from '../hooks/useToast';
import { useCategoryHelpers } from '../hooks/useCategoryHelpers';
import { Topbar } from '../components/layout/Topbar';
import { ProjectCard } from '../components/projects/ProjectCard';
import { ProjectDrawer } from '../components/projects/ProjectDrawer';
import { CreateProjectModal } from '../components/projects/CreateProjectModal';
import { ImportProjectModal } from '../components/projects/ImportProjectModal';
import { EditProjectModal } from '../components/projects/EditProjectModal';
import { Modal } from '../components/ui/Modal';
import type { Project } from '../types';

export function Projects() {
  const config            = useStore((s) => s.config);
  const projects          = useStore((s) => s.projects);
  const fetchProjects     = useStore((s) => s.fetchProjects);
  const pendingAction     = useStore((s) => s.pendingAction);
  const setPendingAction  = useStore((s) => s.setPendingAction);
  const toast             = useToast();
  const { catName, techName } = useCategoryHelpers();

  const [drawerProject,   setDrawerProject]   = useState<Project | null>(null);
  const [editProjectId,   setEditProjectId]   = useState<string | null>(null);
  const [editReturnId,    setEditReturnId]    = useState<string | null>(null);
  const [deleteProject,   setDeleteProject]   = useState<Project | null>(null);
  const [showCreate,      setShowCreate]      = useState(false);
  const [showImport,      setShowImport]      = useState(false);

  useEffect(() => {
    if (pendingAction === 'new-project') {
      setShowCreate(true);
      setPendingAction(null);
    }
  }, []);

  const cats = config?.categories ?? [];

  async function refresh() {
    await fetchProjects();
    // Update drawer project from fresh list
    if (drawerProject) {
      const fresh = useStore.getState().projects.find((p) => p.id === drawerProject.id);
      if (fresh) setDrawerProject(fresh);
    }
  }

  async function handleSync(id: string) {
    try {
      const r = await req<{ updated: number; added: number }>('POST', `/projects/${id}/sync`);
      toast(`Sync completado: ${r.updated} actualizado${r.updated !== 1 ? 's' : ''}, ${r.added} nuevo${r.added !== 1 ? 's' : ''}`);
      await fetchProjects();
    } catch (e: any) { toast(e.message, 'err'); }
  }

  async function handleSyncAll() {
    try {
      const results = await req<{ updated?: number; added?: number }[]>('POST', '/sync-all');
      const total = results.reduce((a, r) => a + (r.updated ?? 0) + (r.added ?? 0), 0);
      toast(`Sync global: ${total} cambios aplicados en ${results.length} proyecto${results.length !== 1 ? 's' : ''}`);
      await fetchProjects();
    } catch (e: any) { toast(e.message, 'err'); }
  }

  async function handleOpenVSCode(id: string) {
    const p = projects.find((x) => x.id === id);
    if (!p) return;
    const r = await (window as any).api?.openVSCode?.(p.path);
    if (r && !r.ok) toast(r.error, 'err');
  }

  async function handleOpenFolder(id: string) {
    const p = projects.find((x) => x.id === id);
    if (p) (window as any).api?.openPath?.(p.path);
  }

  async function handleDelete(id: string) {
    const p = projects.find((x) => x.id === id);
    if (!p) return;
    setDeleteProject(p);
  }

  async function confirmDelete() {
    if (!deleteProject) return;
    await req('DELETE', `/projects/${deleteProject.id}`);
    toast(`Proyecto "${deleteProject.name}" eliminado de Agent Hub`);
    setDrawerProject(null);
    await fetchProjects();
    setDeleteProject(null);
  }

  const topbarActions = (
    <>
      <button className="btn primary sm" onClick={() => setShowCreate(true)}>
        <i className="ti ti-plus" /> Nuevo proyecto
      </button>
      <button className="btn sm" onClick={() => setShowImport(true)}>
        <i className="ti ti-folder-plus" /> Importar
      </button>
      <button className="btn sm" onClick={handleSyncAll} title="Sync todos los proyectos">
        <i className="ti ti-refresh" /> Sync todos
      </button>
    </>
  );

  // Group by category
  const knownCats   = new Set(cats.map((c) => c.id));
  const catsWithProj = cats.filter((c) => projects.some((p) => p.categoryId === c.id));
  const uncategorized = projects.filter((p) => !knownCats.has(p.categoryId));

  const editProject = editProjectId ? projects.find((p) => p.id === editProjectId) ?? null : null;

  function restoreProjectDetail(projectId: string | null) {
    if (!projectId) return;
    const fresh = useStore.getState().projects.find((p) => p.id === projectId);
    if (fresh) setDrawerProject(fresh);
  }

  function closeEditAndReturnToDetail() {
    const targetId = editReturnId ?? editProjectId;
    setEditProjectId(null);
    setEditReturnId(null);
    restoreProjectDetail(targetId);
  }

  return (
    <div className="view active" id="view-projects">
      <Topbar title="Proyectos" actions={topbarActions} />

      <div className="projects-view">
        {projects.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 12, color: 'var(--text2)' }}>
            <i className="ti ti-folder-open" style={{ fontSize: 48, opacity: 0.2 }} />
            <div style={{ fontSize: 14, color: 'var(--text1)' }}>Sin proyectos todavía</div>
            <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 300 }}>
              Crea tu primer proyecto o importa uno existente con los botones de arriba.
            </div>
          </div>
        ) : (
          <>
            {catsWithProj.map((cat) => {
              const projs = projects.filter((p) => p.categoryId === cat.id);
              return (
                <div key={cat.id} className="cat-section">
                  <div className="cat-header">
                    <div className="cat-dot" style={{ background: cat.color }} />
                    <span className="cat-name">{cat.name}</span>
                    <span className="cat-count">{projs.length}</span>
                  </div>
                  <div className="projects-grid">
                    {projs.map((p) => (
                      <ProjectCard
                        key={p.id}
                        project={p}
                        catName={catName(p.categoryId)}
                        techName={p.techId ? techName(p.categoryId, p.techId) : ''}
                        onOpen={() => setDrawerProject(p)}
                        onSync={handleSync}
                        onVSCode={handleOpenVSCode}
                        onFolder={handleOpenFolder}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
            {uncategorized.length > 0 && (
              <div className="cat-section">
                <div className="cat-header">
                  <div className="cat-dot" style={{ background: '#888' }} />
                  <span className="cat-name">Sin categoría</span>
                </div>
                <div className="projects-grid">
                  {uncategorized.map((p) => (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      catName={catName(p.categoryId)}
                      techName={p.techId ? techName(p.categoryId, p.techId) : ''}
                      onOpen={() => setDrawerProject(p)}
                      onSync={handleSync}
                      onVSCode={handleOpenVSCode}
                      onFolder={handleOpenFolder}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Drawer */}
      {drawerProject && (
        <ProjectDrawer
          project={drawerProject}
          onClose={() => setDrawerProject(null)}
          onSync={handleSync}
          onEdit={(id) => {
            setEditReturnId(id);
            setEditProjectId(id);
            setDrawerProject(null);
          }}
          onDelete={handleDelete}
          onRefresh={refresh}
        />
      )}

      {/* Modals */}
      {showCreate && (
        <CreateProjectModal onClose={() => setShowCreate(false)} onCreated={fetchProjects} />
      )}
      {showImport && (
        <ImportProjectModal onClose={() => setShowImport(false)} onImported={fetchProjects} />
      )}
      {editProject && (
        <EditProjectModal
          project={editProject}
          onClose={closeEditAndReturnToDetail}
          onUpdated={async () => {
            await fetchProjects();
            restoreProjectDetail(editProject.id);
          }}
        />
      )}
      {deleteProject && (
        <Modal
          title="Eliminar proyecto"
          sub={`¿Eliminar &quot;${deleteProject.name}&quot; del manager?`}
          confirmLabel="Eliminar"
          confirmClass="btn danger"
          onConfirm={confirmDelete}
          onClose={() => setDeleteProject(null)}
        >
          <div style={{ fontSize: 12, color: 'var(--text1)', padding: '10px 12px', background: 'var(--bg3)', borderRadius: 6, border: '1px solid var(--border2)' }}>
            <i className="ti ti-info-circle" style={{ color: 'var(--blue)' }} />
            {' '}Solo se eliminará el proyecto de Agent Hub. La carpeta y sus archivos en{' '}
            <code style={{ fontFamily: 'var(--mono)', color: 'var(--text0)' }}>{deleteProject.path}</code>{' '}
            no se tocarán.
          </div>
        </Modal>
      )}
    </div>
  );
}
