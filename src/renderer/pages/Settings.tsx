import React, { useState } from 'react';

import { Topbar } from '../components/layout/Topbar';
import { Modal } from '../components/ui/Modal';
import { req } from '../api';
import { useToast } from '../hooks/useToast';
import { useStore } from '../store';
import { ALL_TOOLS } from '../constants/tools';
import type { Agent, AgentDirectoryStatus, AIProvider, BrowserStatus, Category, Config } from '../types';

type Tab = 'general' | 'cats' | 'ext-agents' | 'browser';

type CLICheck = { found: boolean; path: string | null };

// ── Modals state types ─────────────────────────────────────────────────────────

interface AddCatForm  { id: string; name: string; color: string }
interface AddTechForm { catId: string; catName: string; id: string; name: string }
interface ImportAgentReview {
  agent: Partial<Agent>;
  dest: string;
}

// ── Settings page ──────────────────────────────────────────────────────────────

export function Settings() {
  const toast                   = useToast();
  const config                  = useStore((s) => s.config);
  const setConfig               = useStore((s) => s.setConfig);
  const version                 = useStore((s) => s.appVersion);
  const setShowWizardFromSettings = useStore((s) => s.setShowWizard);

  const [tab,         setTab]         = useState<Tab>('general');
  const [editorTab,   setEditorTab]   = useState<'vscode' | 'intellij' | 'eclipse'>('vscode');
  const [aiStatus,    setAiStatus]    = useState<{ provider: string; ready: boolean; cliChecks?: Record<string, CLICheck> } | null>(null);
  const [pendingProvider, setPendingProvider] = useState<AIProvider>(config?.aiProvider ?? 'cli');
  const [saving,      setSaving]      = useState(false);
  const [testing,     setTesting]     = useState(false);
  const [testResult,  setTestResult]  = useState<{ ok: boolean; error?: string; latencyMs?: number } | null>(null);
  const [updateMsg,   setUpdateMsg]   = useState('');
  const [importUrl,   setImportUrl]   = useState('');
  const [importBusy,  setImportBusy]  = useState(false);

  // Anthropic API
  const [apiKey,      setApiKey]      = useState(config?.apiKey ?? '');
  const [apiModel,    setApiModel]    = useState(config?.apiModel ?? 'claude-sonnet-4-20250514');

  // OpenAI API
  const [openaiKey,   setOpenaiKey]   = useState(config?.openaiKey ?? '');
  const [openaiModel, setOpenaiModel] = useState(config?.openaiModel ?? 'gpt-4o-mini');

  // GitHub Models
  const [ghToken,     setGhToken]     = useState(config?.githubToken ?? '');
  const [ghModel,     setGhModel]     = useState(config?.githubModel ?? 'gpt-4o-mini');

  // Gemini API
  const [geminiApiKey,   setGeminiApiKey]   = useState(config?.geminiApiKey ?? '');
  const [geminiApiModel, setGeminiApiModel] = useState(config?.geminiApiModel ?? 'gemini-2.5-flash');

  // Mistral API
  const [mistralKey,   setMistralKey]   = useState(config?.mistralKey ?? '');
  const [mistralModel, setMistralModel] = useState(config?.mistralModel ?? 'mistral-small-latest');

  // Grok (xAI)
  const [grokKey,   setGrokKey]   = useState(config?.grokKey ?? '');
  const [grokModel, setGrokModel] = useState(config?.grokModel ?? 'grok-3-mini');

  // CLI models
  const [geminiCliModel, setGeminiCliModel] = useState(config?.geminiCliModel ?? 'gemini-2.5-pro');
  const [codexCliModel,  setCodexCliModel]  = useState(config?.codexCliModel  ?? 'o4-mini');

  // Directory state
  const DEFAULT_DIR_URL = 'https://github.com/adanoliva/agents-directory';
  const [dirUrl,      setDirUrl]      = useState(config?.agentsDirectoryUrl ?? DEFAULT_DIR_URL);
  const [dirEnabled,  setDirEnabled]  = useState(config?.agentsDirectoryEnabled ?? true);
  const [dirStatus,   setDirStatus]   = useState<AgentDirectoryStatus | null>(null);
  const [dirSyncing,  setDirSyncing]  = useState(false);

  // Browser state
  const [browserStatus,   setBrowserStatus]   = useState<BrowserStatus | null>(null);
  const [browserLoading,  setBrowserLoading]  = useState(false);
  const [browserMsg,      setBrowserMsg]      = useState('');

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
    try { setAiStatus(await req<{ provider: string; ready: boolean; cliChecks?: Record<string, CLICheck> }>('GET', '/ai/status')); } catch {}
  }

  // Fetch AI status once when tab is general
  React.useEffect(() => { if (tab === 'general') fetchAiStatus(); }, [tab]);

  // Sync local token/key/model when config changes (e.g. on mount)
  React.useEffect(() => {
    if (config) {
      setApiKey(config.apiKey ?? '');
      setApiModel(config.apiModel ?? 'claude-sonnet-4-20250514');
      setOpenaiKey(config.openaiKey ?? '');
      setOpenaiModel(config.openaiModel ?? 'gpt-4o-mini');
      setGhToken(config.githubToken ?? '');
      setGhModel(config.githubModel ?? 'gpt-4o-mini');
      setGeminiApiKey(config.geminiApiKey ?? '');
      setGeminiApiModel(config.geminiApiModel ?? 'gemini-2.5-flash');
      setMistralKey(config.mistralKey ?? '');
      setMistralModel(config.mistralModel ?? 'mistral-small-latest');
      setGrokKey(config.grokKey ?? '');
      setGrokModel(config.grokModel ?? 'grok-3-mini');
      setGeminiCliModel(config.geminiCliModel ?? 'gemini-2.5-pro');
      setCodexCliModel(config.codexCliModel ?? 'o4-mini');
      setPendingProvider(config.aiProvider ?? 'cli');
      setDirUrl(config.agentsDirectoryUrl ?? DEFAULT_DIR_URL);
      setDirEnabled(config.agentsDirectoryEnabled ?? true);
    }
  }, [config]);

  // Load directory status when tab is open
  React.useEffect(() => {
    if (tab === 'ext-agents') {
      req<AgentDirectoryStatus>('GET', '/agents-directory/status')
        .then(setDirStatus)
        .catch(() => {});
    }
  }, [tab]);

  // Load browser status when tab is open
  React.useEffect(() => {
    if (tab === 'browser') {
      req<BrowserStatus>('GET', '/browser/status')
        .then(setBrowserStatus)
        .catch(() => {});
    }
  }, [tab]);

  // ── provider actions ─────────────────────────────────────────────────────────

  async function saveAll() {
    setSaving(true);
    setTestResult(null);
    try {
      await req('PUT', '/config', {
        aiProvider: pendingProvider,
        apiKey, apiModel,
        openaiKey, openaiModel,
        githubToken: ghToken, githubModel: ghModel,
        geminiApiKey, geminiApiModel,
        mistralKey, mistralModel,
        grokKey, grokModel,
        geminiCliModel, codexCliModel,
      });
      await refreshConfig();
      await fetchAiStatus();
      toast('Guardado');
    } catch { toast('Error al guardar', 'err'); }
    setSaving(false);
  }

  async function testConn() {
    setTesting(true);
    setTestResult(null);
    try {
      await req('PUT', '/config', {
        aiProvider: pendingProvider,
        apiKey, apiModel,
        openaiKey, openaiModel,
        githubToken: ghToken, githubModel: ghModel,
        geminiApiKey, geminiApiModel,
        mistralKey, mistralModel,
        grokKey, grokModel,
        geminiCliModel, codexCliModel,
      });
      await refreshConfig();
      const r = await req<{ ok: boolean; error?: string; latencyMs?: number }>('POST', '/ai/test-connection');
      setTestResult(r);
      if (r.ok) toast(`Conexión OK (${r.latencyMs}ms)`);
      else toast('Error: ' + r.error, 'err');
    } catch (e: any) {
      setTestResult({ ok: false, error: e.message });
      toast('Error al probar conexión', 'err');
    }
    setTesting(false);
  }

  async function recheckCLI() {
    await req<{ found: boolean; checks: Record<string, CLICheck> }>('GET', '/detect-cli');
    await fetchAiStatus();
    toast('CLIs recomprobados');
  }

  function openExternal(url: string) {
    const api = (window as any).api;
    if (api) api.openExternal(url);
    else window.open(url, '_blank');
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

  // ── agents directory ─────────────────────────────────────────────────────────

  async function saveDirConfig() {
    await req('PUT', '/config', { agentsDirectoryUrl: dirUrl.trim(), agentsDirectoryEnabled: dirEnabled });
    await refreshConfig();
    toast('Configuración del directorio guardada');
  }

  async function triggerSync() {
    setDirSyncing(true);
    try {
      await req('POST', '/agents-directory/sync');
      // Poll until done
      const poll = async () => {
        const s = await req<AgentDirectoryStatus>('GET', '/agents-directory/status');
        setDirStatus(s);
        if (s.syncing) setTimeout(poll, 600);
        else {
          setDirSyncing(false);
          if (s.lastResult?.error) toast('Error: ' + s.lastResult.error, 'err');
          else toast(`Sincronizado: ${s.lastResult?.updated ?? 0} actualizado(s), ${s.lastResult?.skipped ?? 0} sin cambios`);
        }
      };
      setTimeout(poll, 600);
    } catch (e: any) {
      setDirSyncing(false);
      toast('Error al sincronizar: ' + e.message, 'err');
    }
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

  // ── browser actions ──────────────────────────────────────────────────────────

  async function refreshBrowserStatus() {
    try {
      const s = await req<BrowserStatus>('GET', '/browser/status');
      setBrowserStatus(s);
    } catch {}
  }

  async function connectBrowser() {
    setBrowserLoading(true);
    setBrowserMsg('');
    try {
      const port = config?.browserCdpPort ?? 9222;
      const r = await req<any>('POST', '/browser/connect', {
        port,
        browserKey: config?.browserPreferredBrowser === 'auto' ? undefined : config?.browserPreferredBrowser,
      });
      setBrowserStatus(r);
      toast('Navegador conectado');
    } catch (e: any) {
      setBrowserMsg(e.message || 'Error al conectar');
      toast('No se pudo conectar al navegador', 'err');
    }
    setBrowserLoading(false);
  }

  async function disconnectBrowser() {
    setBrowserLoading(true);
    try {
      await req('POST', '/browser/disconnect');
      await refreshBrowserStatus();
      toast('Navegador desconectado');
    } catch {}
    setBrowserLoading(false);
  }

  async function launchBrowser(key: string) {
    setBrowserLoading(true);
    setBrowserMsg('');
    try {
      await req('POST', '/browser/launch', { browserKey: key, port: config?.browserCdpPort ?? 9222 });
      setBrowserMsg('Navegador relanzado. Conectando en unos segundos…');
      setTimeout(async () => {
        await refreshBrowserStatus();
        setBrowserMsg('');
        setBrowserLoading(false);
      }, 4000);
    } catch (e: any) {
      setBrowserMsg(e.message || 'Error al relanzar');
      setBrowserLoading(false);
    }
  }

  async function saveBrowserConfig(patch: Record<string, unknown>) {
    await req('PUT', '/config', patch);
    await refreshConfig();
  }

  // ── render ───────────────────────────────────────────────────────────────────

  const cats     = config?.categories ?? [];
  const theme    = config?.theme ?? 'dark';
  const isGitHub = pendingProvider === 'github' || pendingProvider === 'copilot-cli';
  const cliChecks = aiStatus?.cliChecks ?? {};

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
          {(['general', 'cats', 'ext-agents', 'browser'] as Tab[]).map((t) => (
            <div key={t} className={`drawer-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t === 'general' ? 'General' : t === 'cats' ? 'Categorías' : t === 'ext-agents' ? 'Directorio de Agentes' : (
                <>
                  Navegador
                  {browserStatus?.connected && <span className="badge green" style={{ marginLeft: 6 }}><i className="ti ti-circle-check" />conectado</span>}
                </>
              )}
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

                {/* ── Two-column radio selector ── */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>

                  {/* CLI column */}
                  <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
                    <div className="provider-group-label" style={{ marginTop: 0 }}>
                      <i className="ti ti-terminal" />CLI — Procesos nativos
                    </div>
                    <AIRadioRow value="cli" label="Claude Code CLI" selected={pendingProvider === 'cli'} onSelect={setPendingProvider}
                      badge={cliChecks['cli']?.found ? <span className="badge green"><i className="ti ti-check" /></span> : <span className="badge gray"><i className="ti ti-x" /></span>} />
                    <AIRadioRow value="gemini-cli" label="Gemini CLI" selected={pendingProvider === 'gemini-cli'} onSelect={setPendingProvider}
                      badge={cliChecks['gemini-cli']?.found ? <span className="badge green"><i className="ti ti-check" /></span> : <span className="badge gray"><i className="ti ti-x" /></span>} />
                    <AIRadioRow value="codex-cli" label="OpenAI Codex CLI" selected={pendingProvider === 'codex-cli'} onSelect={setPendingProvider}
                      badge={cliChecks['codex-cli']?.found ? <span className="badge green"><i className="ti ti-check" /></span> : <span className="badge gray"><i className="ti ti-x" /></span>}
                      extra={<span className="badge amber"><i className="ti ti-flask" />exp</span>} />
                    <AIRadioRow value="copilot-cli" label="Copilot CLI (gh)" selected={pendingProvider === 'copilot-cli'} onSelect={setPendingProvider}
                      badge={cliChecks['copilot-cli']?.found ? <span className="badge green"><i className="ti ti-check" /></span> : <span className="badge gray"><i className="ti ti-x" /></span>} />
                    <button className="btn sm ghost" onClick={recheckCLI} style={{ marginTop: 8, width: '100%', justifyContent: 'center' }}>
                      <i className="ti ti-radar" /> Buscar CLIs en el sistema
                    </button>
                  </div>

                  {/* API column */}
                  <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
                    <div className="provider-group-label" style={{ marginTop: 0 }}>
                      <i className="ti ti-api" />API — Subsistema CLI
                    </div>
                    <AIRadioRow value="api"        label="Anthropic API"   selected={pendingProvider === 'api'}        onSelect={setPendingProvider} />
                    <AIRadioRow value="openai"     label="OpenAI API"      selected={pendingProvider === 'openai'}     onSelect={setPendingProvider} />
                    <AIRadioRow value="github"     label="GitHub Models"   selected={pendingProvider === 'github'}     onSelect={setPendingProvider}
                      extra={<span className="badge blue"><i className="ti ti-api" />free</span>} />
                    <AIRadioRow value="gemini-api" label="Gemini API"      selected={pendingProvider === 'gemini-api'} onSelect={setPendingProvider} />
                    <AIRadioRow value="mistral"    label="Mistral API"     selected={pendingProvider === 'mistral'}    onSelect={setPendingProvider} />
                    <AIRadioRow value="grok"       label="Grok (xAI)"      selected={pendingProvider === 'grok'}       onSelect={setPendingProvider} />
                  </div>
                </div>

                {/* ── Config panel para el proveedor seleccionado ── */}
                <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>

                  {pendingProvider === 'cli' && (
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text1)', marginBottom: 8 }}>
                        <strong>Claude Code CLI</strong> — usa tu suscripción de Claude.ai, sin coste adicional.
                      </div>
                      {cliChecks['cli']?.found
                        ? <div style={{ fontSize: 11, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 5 }}>
                            <i className="ti ti-circle-check" /> Detectado en <code style={{ fontFamily: 'var(--mono)', fontSize: 10, marginLeft: 4 }}>{cliChecks['cli'].path}</code>
                          </div>
                        : <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span style={{ fontSize: 11, color: 'var(--text3)' }}>No detectado en PATH</span>
                            <button className="btn sm ghost" onClick={() => openExternal('https://claude.ai/code')}><i className="ti ti-download" /> Instalar</button>
                          </div>
                      }
                    </div>
                  )}

                  {pendingProvider === 'gemini-cli' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ fontSize: 12, color: 'var(--text1)' }}>
                        <strong>Gemini CLI</strong> — instala con <code style={{ fontFamily: 'var(--mono)', fontSize: 10, background: 'var(--bg3)', padding: '1px 4px', borderRadius: 3 }}>npm i -g @google/generative-ai-cli</code>
                        {cliChecks['gemini-cli']?.found
                          ? <span style={{ color: 'var(--green)', marginLeft: 8 }}><i className="ti ti-circle-check" /> detectado</span>
                          : <span style={{ color: 'var(--text3)', marginLeft: 8 }}>no detectado</span>}
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Modelo</label>
                        <select value={geminiCliModel} onChange={(e) => setGeminiCliModel(e.target.value)}>
                          <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                          <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {pendingProvider === 'codex-cli' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ fontSize: 12, color: 'var(--text1)' }}>
                        <strong>OpenAI Codex CLI</strong> (experimental) — instala con <code style={{ fontFamily: 'var(--mono)', fontSize: 10, background: 'var(--bg3)', padding: '1px 4px', borderRadius: 3 }}>npm i -g @openai/codex</code>
                        {cliChecks['codex-cli']?.found
                          ? <span style={{ color: 'var(--green)', marginLeft: 8 }}><i className="ti ti-circle-check" /> detectado</span>
                          : <span style={{ color: 'var(--text3)', marginLeft: 8 }}>no detectado</span>}
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Modelo</label>
                        <select value={codexCliModel} onChange={(e) => setCodexCliModel(e.target.value)}>
                          <option value="o4-mini">o4-mini</option>
                          <option value="gpt-4o">gpt-4o</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {pendingProvider === 'copilot-cli' && (
                    <div style={{ fontSize: 12, color: 'var(--text1)' }}>
                      <strong>GitHub Copilot CLI</strong> — requiere <code style={{ fontFamily: 'var(--mono)', fontSize: 10, background: 'var(--bg3)', padding: '1px 4px', borderRadius: 3 }}>gh</code> + extensión copilot.
                      {cliChecks['copilot-cli']?.found
                        ? <span style={{ color: 'var(--green)', marginLeft: 8 }}><i className="ti ti-circle-check" /> gh detectado en {cliChecks['copilot-cli'].path}</span>
                        : <span style={{ color: 'var(--text3)', marginLeft: 8 }}>gh no encontrado en PATH</span>}
                    </div>
                  )}

                  {pendingProvider === 'api' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>API Key <span style={{ color: 'var(--text3)', fontWeight: 400 }}>console.anthropic.com</span></label>
                        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                          placeholder="sk-ant-api03-…" style={{ fontFamily: 'var(--mono)' }} />
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Modelo</label>
                        <select value={apiModel} onChange={(e) => setApiModel(e.target.value)}>
                          <option value="claude-sonnet-4-20250514">claude-sonnet-4 — equilibrado</option>
                          <option value="claude-haiku-4-5-20251001">claude-haiku-4 — rápido</option>
                          <option value="claude-opus-4-20250514">claude-opus-4 — máxima capacidad</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {pendingProvider === 'openai' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>API Key <span style={{ color: 'var(--text3)', fontWeight: 400 }}>platform.openai.com</span></label>
                        <input type="password" value={openaiKey} onChange={(e) => setOpenaiKey(e.target.value)}
                          placeholder="sk-proj-…" style={{ fontFamily: 'var(--mono)' }} />
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Modelo</label>
                        <select value={openaiModel} onChange={(e) => setOpenaiModel(e.target.value)}>
                          <option value="gpt-4o-mini">gpt-4o-mini — rápido</option>
                          <option value="gpt-4o">gpt-4o — potente</option>
                          <option value="o4-mini">o4-mini — razonamiento</option>
                          <option value="o3">o3 — máxima capacidad</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {pendingProvider === 'github' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Personal Access Token <span style={{ color: 'var(--text3)', fontWeight: 400 }}>permiso models:read</span></label>
                        <input type="password" value={ghToken} onChange={(e) => setGhToken(e.target.value)}
                          placeholder="ghp_…" style={{ fontFamily: 'var(--mono)' }} />
                        <div className="hint">Settings → Developer settings → PAT → Fine-grained → Models: Read</div>
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Modelo</label>
                        <select value={ghModel} onChange={(e) => setGhModel(e.target.value)}>
                          <option value="gpt-4o-mini">gpt-4o-mini — rápido, gratuito</option>
                          <option value="gpt-4o">gpt-4o — potente</option>
                          <option value="o1-mini">o1-mini — razonamiento</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {pendingProvider === 'gemini-api' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>API Key <span style={{ color: 'var(--text3)', fontWeight: 400 }}>aistudio.google.com</span></label>
                        <input type="password" value={geminiApiKey} onChange={(e) => setGeminiApiKey(e.target.value)}
                          placeholder="AIza…" style={{ fontFamily: 'var(--mono)' }} />
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Modelo</label>
                        <select value={geminiApiModel} onChange={(e) => setGeminiApiModel(e.target.value)}>
                          <option value="gemini-2.5-flash">gemini-2.5-flash — rápido</option>
                          <option value="gemini-2.5-pro">gemini-2.5-pro — potente</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {pendingProvider === 'mistral' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>API Key <span style={{ color: 'var(--text3)', fontWeight: 400 }}>console.mistral.ai</span></label>
                        <input type="password" value={mistralKey} onChange={(e) => setMistralKey(e.target.value)}
                          placeholder="API key de Mistral" style={{ fontFamily: 'var(--mono)' }} />
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Modelo</label>
                        <select value={mistralModel} onChange={(e) => setMistralModel(e.target.value)}>
                          <option value="mistral-small-latest">mistral-small — rápido</option>
                          <option value="mistral-medium-latest">mistral-medium</option>
                          <option value="mistral-large-latest">mistral-large — potente</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {pendingProvider === 'grok' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>API Key <span style={{ color: 'var(--text3)', fontWeight: 400 }}>console.x.ai</span></label>
                        <input type="password" value={grokKey} onChange={(e) => setGrokKey(e.target.value)}
                          placeholder="xai-…" style={{ fontFamily: 'var(--mono)' }} />
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Modelo</label>
                        <select value={grokModel} onChange={(e) => setGrokModel(e.target.value)}>
                          <option value="grok-3-mini">grok-3-mini — rápido</option>
                          <option value="grok-3">grok-3 — potente</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Action bar ── */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {testResult && (
                    <span style={{ flex: 1, fontSize: 11, color: testResult.ok ? 'var(--green)' : 'var(--coral)', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <i className={`ti ${testResult.ok ? 'ti-circle-check' : 'ti-alert-circle'}`} />
                      {testResult.ok ? `Conexión OK (${testResult.latencyMs}ms)` : testResult.error}
                    </span>
                  )}
                  {!testResult && <span style={{ flex: 1 }} />}
                  {['api','openai','github','gemini-api','mistral','grok'].includes(pendingProvider) && (
                    <button className="btn sm ghost" onClick={testConn} disabled={testing || saving}>
                      {testing ? <><i className="ti ti-loader-2" /> Probando…</> : <><i className="ti ti-plug" /> Probar conexión</>}
                    </button>
                  )}
                  <button className="btn primary sm" onClick={saveAll} disabled={saving || testing}>
                    {saving ? <><i className="ti ti-loader-2" /> Guardando…</> : <><i className="ti ti-device-floppy" /> Guardar</>}
                  </button>
                </div>
              </div>

              {/* Right: How to use */}
              <div>
                <div className="settings-head">Cómo usar los agentes</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                  {(['vscode', 'intellij', 'eclipse'] as const).map((e) => (
                    <button
                      key={e}
                      className={`btn sm${editorTab === e ? ' primary' : ' ghost'}`}
                      onClick={() => setEditorTab(e)}
                    >
                      <i className={`ti ${e === 'vscode' ? 'ti-brand-vscode' : e === 'intellij' ? 'ti-brand-kotlin' : 'ti-eclipse'}`} />
                      {e === 'vscode' ? 'VS Code' : e === 'intellij' ? 'IntelliJ' : 'Eclipse'}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {editorTab === 'vscode'   && (isGitHub ? <GitHubUsageCards /> : <CLIUsageCards />)}
                  {editorTab === 'intellij' && <IntelliJUsageCards isGitHub={isGitHub} />}
                  {editorTab === 'eclipse'  && <EclipseUsageCards  isGitHub={isGitHub} />}
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

            {/* Row 3: Updates + wizard (compact row) */}
            <div className="settings-section">
              <div className="settings-head">Aplicación</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text2)', flex: 1 }}>
                  {updateMsg || `v${version ?? '—'}`}
                </span>
                <button className="btn sm" onClick={checkUpdate}>
                  <i className="ti ti-refresh" /> Buscar actualizaciones
                </button>
                <button className="btn sm" onClick={() => setShowWizardFromSettings(true)}>
                  <i className="ti ti-wand" /> Ver wizard
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Tab: Categorías ── */}
        {tab === 'cats' && (
          <div className="settings-section">
            <div className="settings-head">Categorías y tecnologías</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button className="btn sm" onClick={() => setAddCat({ id: '', name: '', color: '#7c6af7' })}>
                <i className="ti ti-plus" /> Nueva categoría
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
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
            </div>
          </div>
        )}

        {/* ── Tab: Directorio de Agentes ── */}
        {tab === 'ext-agents' && (
          <>
            {/* Directory config */}
            <div className="settings-section">
              <div className="settings-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Directorio de Agentes</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, fontSize: 12, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={dirEnabled}
                    onChange={(e) => setDirEnabled(e.target.checked)}
                  />
                  Activado
                </label>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 16, marginTop: 0 }}>
                Repositorio GitHub que actúa como fuente de agentes. Los agentes se descargan al arrancar y se versionan por archivo.
              </p>

              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}>
                <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                  <label>URL del repositorio</label>
                  <input
                    value={dirUrl}
                    onChange={(e) => setDirUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo"
                    style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
                    disabled={!dirEnabled}
                  />
                </div>
                <button className="btn" onClick={saveDirConfig} style={{ flexShrink: 0, marginBottom: 0 }}>
                  <i className="ti ti-device-floppy" /> Guardar
                </button>
              </div>

              {/* Status row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                {dirStatus?.lastSync ? (
                  <span style={{ fontSize: 12, color: 'var(--text2)' }}>
                    <i className="ti ti-clock" style={{ marginRight: 4 }} />
                    Última sync: {new Date(dirStatus.lastSync).toLocaleString()}
                  </span>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>Sin sincronizar</span>
                )}
                {(dirStatus?.agentCount ?? 0) > 0 && (
                  <span className="badge gray">
                    <i className="ti ti-cpu" />{dirStatus!.agentCount} agentes
                  </span>
                )}
                {(dirStatus?.pendingConflicts?.length ?? 0) > 0 && (
                  <span className="badge amber">
                    <i className="ti ti-git-merge" />{dirStatus!.pendingConflicts.length} conflicto(s)
                  </span>
                )}
                <button
                  className="btn sm"
                  onClick={triggerSync}
                  disabled={dirSyncing || !dirEnabled}
                  style={{ marginLeft: 'auto' }}
                >
                  {dirSyncing
                    ? <><i className="ti ti-loader-2" /> Sincronizando…</>
                    : <><i className="ti ti-refresh" /> Sincronizar ahora</>}
                </button>
              </div>

              {/* Pending conflicts */}
              {dirStatus && dirStatus.pendingConflicts?.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--amber)' }}>
                    <i className="ti ti-git-merge" style={{ marginRight: 6 }} />Conflictos pendientes
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {dirStatus.pendingConflicts.map((c) => (
                      <div key={c.fileKey} style={{
                        background: 'var(--bg3)', borderRadius: 8, padding: '10px 12px',
                        display: 'flex', alignItems: 'center', gap: 10,
                      }}>
                        <i className="ti ti-file-text" style={{ color: 'var(--text3)' }} />
                        <span style={{ flex: 1, fontSize: 12, fontFamily: 'var(--mono)' }}>{c.name}</span>
                        <button className="btn sm" onClick={async () => {
                          await req('POST', '/agents-directory/resolve-conflict', { fileKey: c.fileKey, action: 'keep' });
                          const s = await req<AgentDirectoryStatus>('GET', '/agents-directory/status');
                          setDirStatus(s);
                          toast('Versión local conservada');
                        }}>Mantener la mía</button>
                        <button className="btn sm accent" onClick={async () => {
                          await req('POST', '/agents-directory/resolve-conflict', { fileKey: c.fileKey, action: 'update' });
                          const s = await req<AgentDirectoryStatus>('GET', '/agents-directory/status');
                          setDirStatus(s);
                          toast('Agente actualizado desde el directorio');
                        }}>Actualizar</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Import single agent from URL */}
            <div className="settings-section">
              <div className="settings-head">Importar agente puntual</div>
              <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 16, marginTop: 0 }}>
                Introduce la URL de un archivo <code style={{ fontFamily: 'var(--mono)', fontSize: 10, background: 'var(--bg3)', padding: '1px 4px', borderRadius: 3 }}>.md</code> con frontmatter para importarlo una sola vez.
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
          </>
        )}

        {/* ── Tab: Navegador ── */}
        {tab === 'browser' && (
          <>
            {/* Connection status */}
            <div className="settings-section">
              <div className="settings-head" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <i className="ti ti-browser" style={{ fontSize: 16 }} />
                Estado de la conexión
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button className="btn sm" onClick={refreshBrowserStatus} disabled={browserLoading}>
                    <i className="ti ti-refresh" /> Actualizar
                  </button>
                  {browserStatus?.connected
                    ? <button className="btn sm danger" onClick={disconnectBrowser} disabled={browserLoading}><i className="ti ti-unlink" /> Desconectar</button>
                    : <button className="btn sm primary" onClick={connectBrowser} disabled={browserLoading}><i className="ti ti-link" /> Conectar</button>
                  }
                </div>
              </div>

              {browserMsg && (
                <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 12, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 6 }}>
                  <i className="ti ti-info-circle" style={{ marginRight: 6 }} />{browserMsg}
                </div>
              )}

              {browserStatus ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 14px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8 }}>
                    <i className={`ti ti-browser`} style={{ fontSize: 20, color: 'var(--text3)' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text0)' }}>
                        {browserStatus.connected ? 'Navegador conectado' : browserStatus.cdpActive ? 'CDP activo (no conectado)' : 'Sin conexión'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                        Puerto CDP: {browserStatus.cdpPort}
                        {browserStatus.browserKey && <> · {browserStatus.browserKey}</>}
                      </div>
                    </div>
                    {browserStatus.connected
                      ? <span className="badge green"><i className="ti ti-circle-check" />conectado</span>
                      : browserStatus.cdpActive
                        ? <span className="badge amber"><i className="ti ti-bolt" />CDP activo</span>
                        : <span className="badge gray"><i className="ti ti-circle-x" />desconectado</span>
                    }
                  </div>

                  {/* Open tabs */}
                  {browserStatus.tabs.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Pestañas abiertas ({browserStatus.tabs.length})
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
                        {browserStatus.tabs.map((tab) => (
                          <div key={tab.id} style={{ fontSize: 11, color: 'var(--text2)', padding: '5px 8px', background: 'var(--bg3)', borderRadius: 5, display: 'flex', gap: 8, alignItems: 'center' }}>
                            <i className="ti ti-world" style={{ flexShrink: 0 }} />
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tab.title || tab.url}</span>
                            <span style={{ color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{tab.url}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text3)', padding: '12px 0' }}>Cargando estado…</div>
              )}
            </div>

            {/* Browser config */}
            <div className="settings-section">
              <div className="settings-head">Configuración</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Navegador preferido</label>
                  <select
                    value={config?.browserPreferredBrowser ?? 'auto'}
                    onChange={(e) => saveBrowserConfig({ browserPreferredBrowser: e.target.value })}
                  >
                    <option value="auto">Auto-detectar</option>
                    <option value="chrome">Google Chrome</option>
                    <option value="edge">Microsoft Edge</option>
                    <option value="brave">Brave Browser</option>
                    <option value="firefox">Mozilla Firefox (parcial)</option>
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Puerto CDP</label>
                  <input
                    type="number"
                    value={config?.browserCdpPort ?? 9222}
                    onChange={(e) => saveBrowserConfig({ browserCdpPort: Number(e.target.value) })}
                    min={1024}
                    max={65535}
                    style={{ fontFamily: 'var(--mono)' }}
                  />
                  <div className="hint">Por defecto 9222. Cambia solo si hay conflicto.</div>
                </div>
              </div>
            </div>

            {/* Installed browsers */}
            {browserStatus && (
              <div className="settings-section">
                <div className="settings-head">Navegadores instalados</div>
                {browserStatus.installed.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>No se encontraron navegadores compatibles.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {browserStatus.installed.map((b) => (
                      <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8 }}>
                        <i className="ti ti-browser" style={{ fontSize: 18, color: 'var(--text3)' }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text0)' }}>{b.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{b.engine === 'chromium' ? 'Chromium — soporte completo CDP' : 'Firefox — soporte parcial'}</div>
                        </div>
                        <button
                          className="btn sm ghost"
                          onClick={() => launchBrowser(b.key)}
                          disabled={browserLoading}
                          title="Relanzar con remote debugging activo"
                        >
                          <i className="ti ti-player-play" /> Relanzar con CDP
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* How to use */}
            <div className="settings-section">
              <div className="settings-head">Cómo usar el navegador en orquestaciones</div>
              <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ padding: '10px 12px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 7 }}>
                  <strong>1.</strong> Abre Chrome/Edge con la sesión activa (Jira, GitHub, etc.)
                </div>
                <div style={{ padding: '10px 12px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 7 }}>
                  <strong>2.</strong> Haz clic en <strong>Relanzar con CDP</strong> o en <strong>Conectar</strong> si ya tienes el puerto activo.
                </div>
                <div style={{ padding: '10px 12px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 7 }}>
                  <strong>3.</strong> En el editor de orquestaciones, activa <i className="ti ti-toggle-right" style={{ verticalAlign: 'middle' }} /> <strong>Requiere navegador</strong> en la configuración de ejecución.
                </div>
                <div style={{ padding: '10px 12px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 7 }}>
                  <strong>4.</strong> Los agentes podrán usar <code style={{ fontFamily: 'var(--mono)', fontSize: 10, background: 'var(--bg3)', padding: '1px 4px', borderRadius: 3 }}>TOOL: browser_get</code> y <code style={{ fontFamily: 'var(--mono)', fontSize: 10, background: 'var(--bg3)', padding: '1px 4px', borderRadius: 3 }}>TOOL: browser_action</code> para interactuar con la página.
                </div>
              </div>
            </div>
          </>
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

// ── AIRadioRow ─────────────────────────────────────────────────────────────────

interface AIRadioRowProps {
  value: AIProvider;
  label: string;
  selected: boolean;
  onSelect: (p: AIProvider) => void;
  badge?: React.ReactNode;
  extra?: React.ReactNode;
}

function AIRadioRow({ value, label, selected, onSelect, badge, extra }: AIRadioRowProps) {
  return (
    <div
      onClick={() => onSelect(value)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px',
        borderRadius: 6, cursor: 'pointer', marginBottom: 2,
        background: selected ? 'var(--bg3)' : 'transparent',
        border: `1px solid ${selected ? 'var(--accent)' : 'transparent'}`,
        transition: 'all .12s',
      }}
    >
      <div className={`provider-radio${selected ? ' on' : ''}`} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 12, fontWeight: selected ? 600 : 400, color: selected ? 'var(--text0)' : 'var(--text1)' }}>
        {label}
      </span>
      {extra}
      {badge}
    </div>
  );
}

// ── ProviderGroup ──────────────────────────────────────────────────────────────

function ProviderGroup({ label, icon, children }: { label: string; icon: string; children?: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div className="provider-group-label">
        <i className={`ti ${icon}`} />
        {label}
      </div>
      {children}
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

function IntelliJUsageCards({ isGitHub }: { isGitHub: boolean }) {
  return (
    <>
      {!isGitHub && (
        <>
          <InfoCard title="PLUGIN CLAUDE CODE">
            <div style={{ fontSize: 11, color: 'var(--text1)' }}>Instala el plugin oficial <strong>Claude Code</strong> de Anthropic desde <strong>JetBrains Marketplace</strong>: <Mono>Settings → Plugins → Marketplace → "Claude Code"</Mono>. Requiere tener Claude Code CLI instalado en el sistema.</div>
          </InfoCard>
          <InfoCard title="INVOCAR UN AGENTE">
            <CodeLine>@unity-dev crea un sistema de inventario</CodeLine>
            <div style={{ fontSize: 11, color: 'var(--text1)' }}>El plugin carga automáticamente los agentes de <Mono>.claude/agents/</Mono> y los globales de <Mono>~/.claude/agents/</Mono>. Usa <Mono>@nombre-del-agente</Mono> en el panel de Claude.</div>
          </InfoCard>
          <InfoCard title="DÓNDE VIVEN LOS AGENTES">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontFamily: 'var(--mono)', background: 'var(--green-dim)', color: 'var(--green)', padding: '2px 7px', borderRadius: 4, fontSize: 10, flexShrink: 0 }}>global</span>
                <span style={{ color: 'var(--text1)', fontFamily: 'var(--mono)', fontSize: 10 }}>~/.claude/agents/</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontFamily: 'var(--mono)', background: 'var(--amber-dim)', color: 'var(--amber)', padding: '2px 7px', borderRadius: 4, fontSize: 10, flexShrink: 0 }}>proyecto</span>
                <span style={{ color: 'var(--text1)', fontFamily: 'var(--mono)', fontSize: 10 }}>{'{proyecto}'}/.claude/agents/</span>
              </div>
            </div>
          </InfoCard>
        </>
      )}
      {isGitHub && (
        <>
          <InfoCard title="PLUGIN GITHUB COPILOT">
            <div style={{ fontSize: 11, color: 'var(--text1)' }}>Instala el plugin oficial desde JetBrains Marketplace: <Mono>Settings → Plugins → Marketplace → "GitHub Copilot"</Mono>. Inicia sesión con tu cuenta de GitHub que tenga acceso a Copilot.</div>
          </InfoCard>
          <InfoCard title="INVOCAR UN AGENTE">
            <CodeLine>@code-reviewer revisa DatabaseManager.java</CodeLine>
            <div style={{ fontSize: 11, color: 'var(--text1)' }}>Abre el chat de Copilot con <Mono>Alt+Shift+C</Mono>. Escribe <Mono>@</Mono> para ver los agentes disponibles de <Mono>.github/agents/</Mono>. La experiencia es similar a VS Code.</div>
          </InfoCard>
          <InfoCard title="DÓNDE VIVEN LOS AGENTES">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontFamily: 'var(--mono)', background: 'var(--amber-dim)', color: 'var(--amber)', padding: '2px 7px', borderRadius: 4, fontSize: 10, flexShrink: 0 }}>proyecto</span>
                <span style={{ color: 'var(--text1)', fontFamily: 'var(--mono)', fontSize: 10 }}>{'{proyecto}'}/.github/agents/</span>
              </div>
            </div>
          </InfoCard>
        </>
      )}
    </>
  );
}

function EclipseUsageCards({ isGitHub }: { isGitHub: boolean }) {
  return (
    <>
      {!isGitHub && (
        <>
          <InfoCard title="CLAUDE CODE VÍA TERMINAL">
            <div style={{ fontSize: 11, color: 'var(--text1)' }}>Eclipse no dispone de plugin oficial de Claude Code. La forma recomendada es abrir un terminal integrado: <Mono>Window → Show View → Terminal</Mono> y ejecutar <Mono>claude</Mono> desde ahí. Los agentes de <Mono>.claude/agents/</Mono> se cargan automáticamente.</div>
          </InfoCard>
          <InfoCard title="INVOCAR UN AGENTE">
            <CodeLine>@unity-dev crea un sistema de inventario</CodeLine>
            <div style={{ fontSize: 11, color: 'var(--text1)' }}>Usa <Mono>@nombre-del-agente</Mono> seguido de la tarea directamente en el terminal donde corre <Mono>claude</Mono>.</div>
          </InfoCard>
          <InfoCard title="DÓNDE VIVEN LOS AGENTES">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontFamily: 'var(--mono)', background: 'var(--green-dim)', color: 'var(--green)', padding: '2px 7px', borderRadius: 4, fontSize: 10, flexShrink: 0 }}>global</span>
                <span style={{ color: 'var(--text1)', fontFamily: 'var(--mono)', fontSize: 10 }}>~/.claude/agents/</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontFamily: 'var(--mono)', background: 'var(--amber-dim)', color: 'var(--amber)', padding: '2px 7px', borderRadius: 4, fontSize: 10, flexShrink: 0 }}>proyecto</span>
                <span style={{ color: 'var(--text1)', fontFamily: 'var(--mono)', fontSize: 10 }}>{'{proyecto}'}/.claude/agents/ — vía terminal integrado</span>
              </div>
            </div>
          </InfoCard>
        </>
      )}
      {isGitHub && (
        <>
          <InfoCard title="PLUGIN GITHUB COPILOT">
            <div style={{ fontSize: 11, color: 'var(--text1)' }}>Instala el plugin oficial desde Eclipse Marketplace: <Mono>Help → Eclipse Marketplace → buscar "GitHub Copilot"</Mono>. Requiere Eclipse 2023-03 o superior y Java 17+.</div>
          </InfoCard>
          <InfoCard title="INVOCAR UN AGENTE">
            <CodeLine>@code-reviewer revisa DatabaseManager.java</CodeLine>
            <div style={{ fontSize: 11, color: 'var(--text1)' }}>Abre el chat desde <Mono>Window → Show View → GitHub Copilot Chat</Mono>. Escribe <Mono>@</Mono> para ver los agentes de <Mono>.github/agents/</Mono>.</div>
          </InfoCard>
          <InfoCard title="DÓNDE VIVEN LOS AGENTES">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontFamily: 'var(--mono)', background: 'var(--blue-dim)', color: 'var(--blue)', padding: '2px 7px', borderRadius: 4, fontSize: 10, flexShrink: 0 }}>proyecto</span>
                <span style={{ color: 'var(--text1)', fontFamily: 'var(--mono)', fontSize: 10 }}>{'{proyecto}'}/.github/agents/</span>
              </div>
            </div>
          </InfoCard>
        </>
      )}
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
