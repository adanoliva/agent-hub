import React, { useState } from 'react';
import { Topbar } from '../components/layout/Topbar';
import { Modal } from '../components/ui/Modal';
import { req } from '../api';
import { useToast } from '../hooks/useToast';
import { useStore } from '../store';
import { ALL_TOOLS } from '../constants/tools';
import type { Agent, Category, Config } from '../types';

type Tab = 'general' | 'cats' | 'ext-agents';

// ── Modals state types ─────────────────────────────────────────────────────────

interface AddCatForm  { id: string; name: string; color: string }
interface AddTechForm { catId: string; catName: string; id: string; name: string }
interface ImportAgentReview {
  agent: Partial<Agent>;
  dest: string;
}

// ── Settings page ──────────────────────────────────────────────────────────────

export function Settings() {
  const toast     = useToast();
  const config    = useStore((s) => s.config);
  const setConfig = useStore((s) => s.setConfig);
  const version   = useStore((s) => s.appVersion);

  const [tab,         setTab]         = useState<Tab>('general');
  const [aiStatus,    setAiStatus]    = useState<{ provider: string; ready: boolean } | null>(null);
  const [updateMsg,   setUpdateMsg]   = useState('');
  const [importUrl,   setImportUrl]   = useState('');
  const [importBusy,  setImportBusy]  = useState(false);
  const [ghToken,     setGhToken]     = useState(config?.githubToken ?? '');
  const [ghModel,     setGhModel]     = useState(config?.githubModel ?? 'gpt-4o-mini');
  const [apiKey,      setApiKey]      = useState(config?.apiKey ?? '');

  // modals
  const [addCat,      setAddCat]      = useState<AddCatForm | null>(null);
  const [addTech,     setAddTech]     = useState<AddTechForm | null>(null);
  const [importReview,setImportReview]= useState<ImportAgentReview | null>(null);

  // import review local form
  const [irName,   setIrName]   = useState('');
  const [irDesc,   setIrDesc]   = useState('');
  const [irModel,  setIrModel]  = useState('sonnet');
  const [irSystem, setIrSystem] = useState('');
  const [irDest,   setIrDest]   = useState('global');
  const [irTools,  setIrTools]  = useState<string[]>([]);

  // ── helpers ──────────────────────────────────────────────────────────────────

  async function refreshConfig() {
    const c = await req<Config>('GET', '/config');
    setConfig(c);
  }

  async function fetchAiStatus() {
    try { setAiStatus(await req<{ provider: string; ready: boolean }>('GET', '/ai/status')); } catch {}
  }

  // Fetch AI status once when tab is general
  React.useEffect(() => { if (tab === 'general') fetchAiStatus(); }, [tab]);

  // Sync local token/key/model when config changes (e.g. on mount)
  React.useEffect(() => {
    if (config) {
      setGhToken(config.githubToken ?? '');
      setGhModel(config.githubModel ?? 'gpt-4o-mini');
      setApiKey(config.apiKey ?? '');
    }
  }, [config]);

  // ── provider actions ─────────────────────────────────────────────────────────

  async function selectProvider(p: string) {
    await req('PUT', '/config', { aiProvider: p });
    await refreshConfig();
    await fetchAiStatus();
  }

  async function saveAPIKey() {
    const key = apiKey.trim();
    if (!key) return;
    await req('PUT', '/config', { apiKey: key });
    await refreshConfig();
    toast('API key guardada');
  }

  async function saveGitHubSettings() {
    const body: Record<string, string> = { githubModel: ghModel };
    if (ghToken.trim()) body.githubToken = ghToken.trim();
    await req('PUT', '/config', body);
    await refreshConfig();
    toast(ghToken.trim() ? 'GitHub token y modelo guardados' : 'Modelo guardado');
  }

  async function recheckCLI() {
    const r = await req<{ found: boolean }>('GET', '/detect-cli');
    if (r.found) toast('Claude CLI detectado');
    else toast('CLI no encontrado. Instala Claude Code.', 'err');
    await fetchAiStatus();
  }

  function openCLIInstall() {
    const api = (window as any).api;
    if (api) api.openExternal('https://claude.ai/code');
    else window.open('https://claude.ai/code', '_blank');
  }

  // ── theme ────────────────────────────────────────────────────────────────────

  async function setTheme(theme: 'dark' | 'light') {
    document.body.classList.toggle('light', theme === 'light');
    await req('PUT', '/config', { theme });
    await refreshConfig();
  }

  // ── updates ──────────────────────────────────────────────────────────────────

  async function checkUpdate() {
    setUpdateMsg('Buscando…');
    const api = (window as any).api;
    if (!api?.checkForUpdate) {
      setUpdateMsg('Auto-update solo disponible en la versión empaquetada.');
      return;
    }
    const result = await api.checkForUpdate();
    if (result?.error) {
      setUpdateMsg('Error: ' + result.error);
      toast('Error: ' + result.error, 'err');
    } else {
      setUpdateMsg('Comprobando… (el banner aparecerá si hay nueva versión)');
    }
  }

  // ── categories ───────────────────────────────────────────────────────────────

  async function handleAddCategory() {
    if (!addCat) return;
    const { id, name, color } = addCat;
    const cleanId = id.trim().toLowerCase().replace(/\s+/g, '-');
    if (!cleanId || !name.trim()) { toast('Rellena ID y nombre', 'err'); throw new Error('validation'); }
    await req('POST', '/categories', { id: cleanId, name: name.trim(), color, technologies: [] });
    await refreshConfig();
    toast(`Categoría "${name.trim()}" creada`);
    setAddCat(null);
  }

  async function deleteCat(id: string) {
    if (!confirm('¿Eliminar esta categoría? Los agentes de sus carpetas no se borran del disco.')) return;
    await req('DELETE', `/categories/${id}`);
    await refreshConfig();
    toast('Categoría eliminada');
  }

  async function handleAddTech() {
    if (!addTech) return;
    const { catId, id, name } = addTech;
    const cleanId = id.trim().toLowerCase().replace(/\s+/g, '-');
    if (!cleanId || !name.trim()) { toast('Rellena ID y nombre', 'err'); throw new Error('validation'); }
    await req('POST', `/categories/${catId}/technologies`, { id: cleanId, name: name.trim() });
    await refreshConfig();
    toast(`Tecnología "${name.trim()}" añadida`);
    setAddTech(null);
  }

  async function deleteTech(catId: string, techId: string) {
    if (!confirm('¿Eliminar esta tecnología?')) return;
    await req('DELETE', `/categories/${catId}/technologies/${techId}`);
    await refreshConfig();
    toast('Tecnología eliminada');
  }

  // ── import agent from URL ────────────────────────────────────────────────────

  async function importFromUrl() {
    const url = importUrl.trim();
    if (!url) { toast('Introduce una URL', 'err'); return; }
    setImportBusy(true);
    try {
      const { agent } = await req<{ agent: Partial<Agent> }>('POST', '/agents/import-url', { url });
      setIrName(agent.name ?? '');
      setIrDesc(agent.description ?? '');
      setIrModel(agent.model ?? 'sonnet');
      setIrSystem(agent.system ?? '');
      setIrTools(agent.tools ?? []);
      setIrDest('global');
      setImportReview({ agent, dest: 'global' });
    } catch (e: any) {
      toast(e.message || 'Error al importar el agente', 'err');
    }
    setImportBusy(false);
  }

  async function confirmImport() {
    if (!irName.trim()) { toast('El nombre es obligatorio', 'err'); throw new Error('validation'); }
    let level = 'global', categoryId: string | undefined, techId: string | undefined;
    if (irDest.startsWith('tech:'))    { const [, c, t] = irDest.split(':'); level = 'tech';    categoryId = c; techId = t; }
    else if (irDest.startsWith('section:')) { const [, c] = irDest.split(':'); level = 'section'; categoryId = c; }
    await req('POST', '/agents', {
      level, categoryId, techId,
      agent: { name: irName.trim(), description: irDesc.trim(), model: irModel, tools: irTools, system: irSystem.trim() },
    });
    toast(`Agente "${irName.trim()}" importado`);
    setImportReview(null);
    setImportUrl('');
  }

  // ── render ───────────────────────────────────────────────────────────────────

  const cats = config?.categories ?? [];
  const provider = config?.aiProvider ?? 'cli';
  const theme    = config?.theme ?? 'dark';
  const isGitHub = provider === 'github';

  // Destination options for import modal
  const destOptions: { value: string; label: string }[] = [
    { value: 'global', label: 'Global (disponible en todos los proyectos)' },
    ...cats.flatMap((cat) => [
      { value: `section:${cat.id}`, label: `Sección: ${cat.name}` },
      ...(cat.technologies ?? []).map((tech) => ({
        value: `tech:${cat.id}:${tech.id}`,
        label: `Tech: ${cat.name} › ${tech.name}`,
      })),
    ]),
  ];

  return (
    <div className="view active" id="view-settings">
      <Topbar
        title="Ajustes"
        actions={
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '5px 10px', borderRadius: 7, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)' }}
          >
            <i className={`ti ${theme === 'dark' ? 'ti-sun' : 'ti-moon'}`} style={{ fontSize: 15 }} />
            {theme === 'dark' ? 'Claro' : 'Oscuro'}
          </button>
        }
      />

      <div className="settings-view">
        {/* Tabs */}
        <div className="drawer-tabs" style={{ margin: '-32px -32px 24px', paddingLeft: 32 }}>
          {(['general', 'cats', 'ext-agents'] as Tab[]).map((t) => (
            <div key={t} className={`drawer-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t === 'general' ? 'General' : t === 'cats' ? 'Categorías' : 'Agentes externos'}
            </div>
          ))}
        </div>

        {/* ── Tab: General ── */}
        {tab === 'general' && (
          <>
            {/* Row 1: Provider (left) + How to use (right) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start', marginBottom: 36 }}>
              {/* Left: Provider */}
              <div>
                <div className="settings-head">Proveedor de IA</div>

                <ProviderOption
                  selected={provider === 'cli'}
                  onClick={() => selectProvider('cli')}
                  title="Claude CLI"
                  badge={aiStatus?.provider === 'cli' && aiStatus?.ready
                    ? <span className="badge green"><i className="ti ti-circle-check" />detectado</span>
                    : <span className="badge gray"><i className="ti ti-circle-x" />no detectado</span>}
                  subtitle="Usa tu suscripción de Claude.ai. Sin coste adicional."
                >
                  {provider === 'cli' && aiStatus && !aiStatus.ready && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                      <button className="btn sm" onClick={(e) => { e.stopPropagation(); openCLIInstall(); }}>
                        <i className="ti ti-download" /> Instalar CLI
                      </button>
                      <button className="btn sm" onClick={(e) => { e.stopPropagation(); recheckCLI(); }}>
                        <i className="ti ti-refresh" /> Recomprobar
                      </button>
                    </div>
                  )}
                </ProviderOption>

                <ProviderOption
                  selected={provider === 'github'}
                  onClick={() => selectProvider('github')}
                  title={<>GitHub Copilot <span className="badge blue"><i className="ti ti-api" />Models API</span>{aiStatus?.provider === 'github' && aiStatus?.ready && <span className="badge green"><i className="ti ti-circle-check" />listo</span>}</>}
                  subtitle={<>Token con permiso <code style={{ fontFamily: 'var(--mono)', fontSize: 10, background: 'var(--bg3)', padding: '1px 4px', borderRadius: 3 }}>models:read</code>. Capa gratuita.</>}
                >
                  {provider === 'github' && (
                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>GitHub Personal Access Token</label>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input
                            type="password"
                            value={ghToken}
                            onChange={(e) => setGhToken(e.target.value)}
                            placeholder="ghp_…"
                            onClick={(e) => e.stopPropagation()}
                            style={{ flex: 1, fontFamily: 'var(--mono)' }}
                          />
                          <button className="btn sm" onClick={(e) => { e.stopPropagation(); saveGitHubSettings(); }}>
                            <i className="ti ti-device-floppy" />
                          </button>
                        </div>
                        <div className="hint">Settings → Developer settings → PAT → Fine-grained → Models: Read</div>
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Modelo</label>
                        <select
                          value={ghModel}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => { setGhModel(e.target.value); saveGitHubSettings(); }}
                        >
                          <option value="gpt-4o-mini">gpt-4o-mini — rápido, gratuito</option>
                          <option value="gpt-4o">gpt-4o — potente</option>
                          <option value="o1-mini">o1-mini — razonamiento</option>
                        </select>
                      </div>
                    </div>
                  )}
                </ProviderOption>

                <ProviderOption
                  selected={provider === 'api'}
                  onClick={() => selectProvider('api')}
                  title="API key de Anthropic"
                  subtitle="Requiere cuenta en console.anthropic.com"
                >
                  {provider === 'api' && (
                    <div style={{ marginTop: 12 }}>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>API key</label>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="sk-ant-api03-…"
                            onClick={(e) => e.stopPropagation()}
                            style={{ flex: 1, fontFamily: 'var(--mono)' }}
                          />
                          <button className="btn sm" onClick={(e) => { e.stopPropagation(); saveAPIKey(); }}>
                            <i className="ti ti-device-floppy" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </ProviderOption>
              </div>

              {/* Right: How to use */}
              <div>
                <div className="settings-head">Cómo usar los agentes en VS Code</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {isGitHub ? <GitHubUsageCards /> : <CLIUsageCards />}
                </div>
              </div>
            </div>

            {/* Row 2: Close behavior */}
            <div className="settings-section">
              <div className="settings-head">Al cerrar la ventana</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['ask', 'tray', 'quit'] as const).map((val) => {
                  const active = (config?.closeAction ?? 'ask') === val;
                  return (
                    <div
                      key={val}
                      style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                               background: 'var(--bg2)', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                               borderRadius: 8, padding: '10px 14px', transition: 'border-color .15s' }}
                      onClick={async () => { await req('PUT', '/config', { closeAction: val }); await refreshConfig(); }}
                    >
                      <div style={{ width: 14, height: 14, borderRadius: '50%', flexShrink: 0, position: 'relative',
                                    border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border3)'}`,
                                    background: active ? 'var(--accent)' : 'transparent', transition: 'all .15s' }}>
                        {active && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
                                                  width: 5, height: 5, borderRadius: '50%', background: '#fff' }} />}
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text0)' }}>
                          {val === 'ask' && 'Preguntar siempre'}
                          {val === 'tray' && 'Minimizar al tray'}
                          {val === 'quit' && 'Salir completamente'}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                          {val === 'ask'  && 'Muestra un diálogo al cerrar'}
                          {val === 'tray' && 'Sigue corriendo en segundo plano'}
                          {val === 'quit' && 'Cierra la app por completo'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Row 3: Updates (always last) */}
            <div className="settings-section">
              <div className="settings-head">Actualizaciones</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, fontSize: 12, color: 'var(--text2)' }}>
                  {updateMsg || `Versión actual: v${version ?? '—'}`}
                </div>
                <button className="btn sm" onClick={checkUpdate}>
                  <i className="ti ti-refresh" /> Buscar actualizaciones
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Tab: Categorías ── */}
        {tab === 'cats' && (
          <div className="settings-section">
            <div className="settings-head">Categorías y tecnologías</div>
            {cats.map((cat) => (
              <div key={cat.id} className="cat-item">
                <div className="cat-item-head">
                  <div className="cat-dot" style={{ background: cat.color }} />
                  <span className="cat-item-name">{cat.name}</span>
                  <button className="btn ghost sm" onClick={() => setAddTech({ catId: cat.id, catName: cat.name, id: '', name: '' })}>
                    <i className="ti ti-plus" /> Tech
                  </button>
                  <button className="btn ghost sm danger" onClick={() => deleteCat(cat.id)}>
                    <i className="ti ti-trash" />
                  </button>
                </div>
                <div className="tech-pills">
                  {(cat.technologies ?? []).map((t) => (
                    <span key={t.id} className="tech-pill">
                      {t.name}
                      <span className="del" onClick={() => deleteTech(cat.id, t.id)} title="Eliminar">
                        <i className="ti ti-x" />
                      </span>
                    </span>
                  ))}
                  {!(cat.technologies ?? []).length && (
                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>Sin tecnologías</span>
                  )}
                </div>
              </div>
            ))}
            <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setAddCat({ id: '', name: '', color: '#7c6af7' })}>
              <i className="ti ti-plus" /> Nueva categoría
            </button>
          </div>
        )}

        {/* ── Tab: Agentes externos ── */}
        {tab === 'ext-agents' && (
          <div className="settings-section">
            <div className="settings-head">Importar agente externo</div>
            <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 16, marginTop: 0 }}>
              Introduce la URL de un archivo de agente (<code style={{ fontFamily: 'var(--mono)', fontSize: 10, background: 'var(--bg3)', padding: '1px 4px', borderRadius: 3 }}>.md</code> con frontmatter). Agent Hub lo descargará, lo mostrará para revisión y lo guardará como un agente real en la categoría que elijas.
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label>URL del agente</label>
                <input
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  placeholder="https://ejemplo.com/mi-agente.md"
                  style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
                />
              </div>
              <button className="btn" onClick={importFromUrl} disabled={importBusy} style={{ flexShrink: 0, marginBottom: 0 }}>
                {importBusy ? <><i className="ti ti-loader-2" /> Importando…</> : <><i className="ti ti-download" /> Importar</>}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Modal: Nueva categoría ── */}
      {addCat && (
        <Modal title="Nueva categoría" confirmLabel="Crear" onConfirm={handleAddCategory} onClose={() => setAddCat(null)}>
          <div className="field">
            <label>ID (único, sin espacios)</label>
            <input value={addCat.id} onChange={(e) => setAddCat({ ...addCat, id: e.target.value })} placeholder="data-science" />
          </div>
          <div className="field">
            <label>Nombre</label>
            <input value={addCat.name} onChange={(e) => setAddCat({ ...addCat, name: e.target.value })} placeholder="Data Science" />
          </div>
          <div className="field">
            <label>Color</label>
            <input type="color" value={addCat.color} onChange={(e) => setAddCat({ ...addCat, color: e.target.value })} style={{ height: 36, padding: 2 }} />
          </div>
        </Modal>
      )}

      {/* ── Modal: Nueva tecnología ── */}
      {addTech && (
        <Modal title={`Nueva tecnología en ${addTech.catName}`} confirmLabel="Añadir" onConfirm={handleAddTech} onClose={() => setAddTech(null)}>
          <div className="field">
            <label>ID (único dentro de la categoría)</label>
            <input value={addTech.id} onChange={(e) => setAddTech({ ...addTech, id: e.target.value })} placeholder="python" />
          </div>
          <div className="field">
            <label>Nombre</label>
            <input value={addTech.name} onChange={(e) => setAddTech({ ...addTech, name: e.target.value })} placeholder="Python" />
          </div>
        </Modal>
      )}

      {/* ── Modal: Revisar e importar agente ── */}
      {importReview && (
        <Modal title="Revisar e importar agente" confirmLabel="Importar" onConfirm={confirmImport} onClose={() => setImportReview(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Nombre</label>
              <input value={irName} onChange={(e) => setIrName(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Descripción</label>
              <input value={irDesc} onChange={(e) => setIrDesc(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Modelo</label>
              <select value={irModel} onChange={(e) => setIrModel(e.target.value)}>
                <option value="sonnet">sonnet</option>
                <option value="haiku">haiku</option>
                <option value="opus">opus</option>
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Herramientas</label>
              <div style={{ background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
                {ALL_TOOLS.map((t) => (
                  <label key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, margin: '2px 6px 2px 0', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={irTools.includes(t)}
                      onChange={(e) => setIrTools(e.target.checked ? [...irTools, t] : irTools.filter((x) => x !== t))}
                    />
                    {t}
                  </label>
                ))}
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>System prompt</label>
              <textarea
                rows={6}
                value={irSystem}
                onChange={(e) => setIrSystem(e.target.value)}
                style={{ fontFamily: 'var(--mono)', fontSize: 11, resize: 'vertical' }}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Guardar en</label>
              <select value={irDest} onChange={(e) => setIrDest(e.target.value)}>
                {destOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── ProviderOption ─────────────────────────────────────────────────────────────

interface ProviderOptionProps {
  selected: boolean;
  onClick: () => void;
  title: React.ReactNode;
  subtitle: React.ReactNode;
  badge?: React.ReactNode;
  children?: React.ReactNode;
}

function ProviderOption({ selected, onClick, title, subtitle, badge, children }: ProviderOptionProps) {
  return (
    <div className={`provider-option${selected ? ' selected' : ''}`} onClick={onClick}>
      <div className="provider-option-head">
        <div className={`provider-radio${selected ? ' on' : ''}`} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text0)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
            {title}{badge}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text1)' }}>{subtitle}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Usage info cards ───────────────────────────────────────────────────────────

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '13px 15px' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', fontFamily: 'var(--mono)', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function CodeLine({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--bg1)', padding: '8px 12px', borderRadius: 6, color: 'var(--green)', marginBottom: 6 }}>
      {children}
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <code style={{ fontFamily: 'var(--mono)', fontSize: 10, background: 'var(--bg3)', padding: '1px 4px', borderRadius: 3 }}>{children}</code>;
}

function CLIUsageCards() {
  return (
    <>
      <InfoCard title="VER AGENTES DISPONIBLES">
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--bg1)', padding: '8px 12px', borderRadius: 6, color: 'var(--accent)', marginBottom: 6 }}>/agents</div>
        <div style={{ fontSize: 11, color: 'var(--text1)' }}>Lista todos los agentes activos del proyecto y los globales de <Mono>~/.claude/agents/</Mono></div>
      </InfoCard>
      <InfoCard title="INVOCAR UN AGENTE">
        <CodeLine>@unity-dev crea un sistema de inventario con ScriptableObjects</CodeLine>
        <CodeLine>@code-reviewer revisa PlayerController.cs</CodeLine>
        <div style={{ fontSize: 11, color: 'var(--text1)' }}>Usa <Mono>@nombre-del-agente</Mono> seguido de la tarea. Claude Code carga el system prompt del agente automáticamente.</div>
      </InfoCard>
      <InfoCard title="DELEGACIÓN AUTOMÁTICA">
        <div style={{ fontSize: 11, color: 'var(--text1)' }}>Si describes una tarea sin <Mono>@</Mono>, Claude Code puede elegir el agente más apropiado por su cuenta basándose en el campo <strong>description</strong> de cada agente. Por eso es importante que las descripciones sean precisas.</div>
      </InfoCard>
      <InfoCard title="DÓNDE VIVEN LOS AGENTES">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ fontFamily: 'var(--mono)', background: 'var(--green-dim)', color: 'var(--green)', padding: '2px 7px', borderRadius: 4, fontSize: 10, flexShrink: 0 }}>global</span>
            <span style={{ color: 'var(--text1)', fontFamily: 'var(--mono)', fontSize: 10 }}>~/.claude/agents/ — disponibles en cualquier proyecto</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ fontFamily: 'var(--mono)', background: 'var(--amber-dim)', color: 'var(--amber)', padding: '2px 7px', borderRadius: 4, fontSize: 10, flexShrink: 0 }}>proyecto</span>
            <span style={{ color: 'var(--text1)', fontFamily: 'var(--mono)', fontSize: 10 }}>{'{proyecto}'}/.claude/agents/ — solo en ese proyecto</span>
          </div>
        </div>
      </InfoCard>
    </>
  );
}

function GitHubUsageCards() {
  return (
    <>
      <InfoCard title="ABRIR EL CHAT DE COPILOT">
        <div style={{ fontSize: 11, color: 'var(--text1)' }}>En VS Code abre el panel de <strong>GitHub Copilot Chat</strong> con <Mono>Ctrl+Alt+I</Mono> o desde el icono de Copilot en la barra lateral.</div>
      </InfoCard>
      <InfoCard title="SELECCIONAR UN AGENTE">
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--bg1)', padding: '8px 12px', borderRadius: 6, color: 'var(--accent)', marginBottom: 6 }}>@</div>
        <div style={{ fontSize: 11, color: 'var(--text1)' }}>Escribe <Mono>@</Mono> en el chat para ver el listado de agentes disponibles. Copilot muestra los agentes del proyecto (<Mono>.github/agents/</Mono>) junto con las instrucciones base (<Mono>copilot-instructions.md</Mono>).</div>
      </InfoCard>
      <InfoCard title="INVOCAR UN AGENTE">
        <CodeLine>@unity-dev crea un sistema de inventario con ScriptableObjects</CodeLine>
        <CodeLine>@code-reviewer revisa PlayerController.cs</CodeLine>
        <div style={{ fontSize: 11, color: 'var(--text1)' }}>Usa <Mono>@nombre-del-agente</Mono> seguido de la tarea. Copilot carga el system prompt del agente definido en su archivo <Mono>.md</Mono>.</div>
      </InfoCard>
      <InfoCard title="AÑADIR CONTEXTO DE ARCHIVOS">
        <CodeLine>@unity-dev #PlayerController.cs añade doble salto</CodeLine>
        <div style={{ fontSize: 11, color: 'var(--text1)' }}>Usa <Mono>#archivo</Mono> para adjuntar ficheros como contexto. También puedes arrastrar archivos directamente al chat o usar <Mono>#codebase</Mono> para el proyecto completo.</div>
      </InfoCard>
      <InfoCard title="DÓNDE VIVEN LOS AGENTES">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ fontFamily: 'var(--mono)', background: 'var(--amber-dim)', color: 'var(--amber)', padding: '2px 7px', borderRadius: 4, fontSize: 10, flexShrink: 0 }}>proyecto</span>
            <span style={{ color: 'var(--text1)', fontFamily: 'var(--mono)', fontSize: 10 }}>{'{proyecto}'}/.github/agents/ — agentes del proyecto</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ fontFamily: 'var(--mono)', background: 'var(--blue-dim)', color: 'var(--blue)', padding: '2px 7px', borderRadius: 4, fontSize: 10, flexShrink: 0 }}>contexto</span>
            <span style={{ color: 'var(--text1)', fontFamily: 'var(--mono)', fontSize: 10 }}>{'{proyecto}'}/.github/copilot-instructions.md — instrucciones base</span>
          </div>
        </div>
      </InfoCard>
    </>
  );
}
