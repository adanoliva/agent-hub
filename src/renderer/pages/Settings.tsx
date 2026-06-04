import React, { useState } from 'react';

import { Topbar } from '../components/layout/Topbar';
import { Modal } from '../components/ui/Modal';
import { req } from '../api';
import { useToast } from '../hooks/useToast';
import { useStore } from '../store';
import { ALL_TOOLS } from '../constants/tools';
import type { Agent, AgentDirectoryStatus, AIProvider, Category, Config, CustomAIProvider } from '../types';

type Tab = 'general' | 'cats' | 'ext-agents';

interface ScriptValidationIssue { severity: 'error' | 'warn'; code: string; message: string; }
interface ScriptValidationResult { file: string; name: string; status: 'ok' | 'warn' | 'error'; issues: ScriptValidationIssue[]; }
interface ScriptValidationReport { validatedAt: string; summary: { ok: number; warn: number; error: number }; results: ScriptValidationResult[]; }

type CLICheck = { found: boolean; path: string | null };

// ── Modals state types ─────────────────────────────────────────────────────────

interface AddCatForm  { id: string; name: string; color: string }
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

  // External scripts validation
  const [scriptValidating,  setScriptValidating]  = useState(false);
  const [scriptReport,      setScriptReport]       = useState<ScriptValidationReport | null>(null);
  const [scriptExpandedIdx, setScriptExpandedIdx]  = useState<number | null>(null);

  // Custom Providers
  const [customProviders, setCustomProviders] = useState<CustomAIProvider[]>(config?.customProviders ?? []);
  const [editingCustom,   setEditingCustom]   = useState<Partial<CustomAIProvider> | null>(null);
  const [showCustomChoice, setShowCustomChoice] = useState(false);
  const [customHeadersRaw, setCustomHeadersRaw] = useState('');
  const [customArgsRaw,    setCustomArgsRaw]    = useState('');

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

  // DeepSeek API
  const [deepseekKey,   setDeepseekKey]   = useState(config?.deepseekKey ?? '');
  const [deepseekModel, setDeepseekModel] = useState(config?.deepseekModel ?? 'deepseek-chat');

  // Groq API
  const [groqKey,   setGroqKey]   = useState(config?.groqKey ?? '');
  const [groqModel, setGroqModel] = useState(config?.groqModel ?? 'llama-3.3-70b-versatile');

  // OpenRouter API
  const [openrouterKey,   setOpenrouterKey]   = useState(config?.openrouterKey ?? '');
  const [openrouterModel, setOpenrouterModel] = useState(config?.openrouterModel ?? 'anthropic/claude-3.5-sonnet');

  // Perplexity API
  const [perplexityKey,   setPerplexityKey]   = useState(config?.perplexityKey ?? '');
  const [perplexityModel, setPerplexityModel] = useState(config?.perplexityModel ?? 'sonar-reasoning-pro');

  // Directory state
  const DEFAULT_DIR_URL = 'https://github.com/adanoliva/agents-directory';
  const [dirUrl,      setDirUrl]      = useState(config?.agentsDirectoryUrl ?? DEFAULT_DIR_URL);
  const [dirEnabled,  setDirEnabled]  = useState(config?.agentsDirectoryEnabled ?? true);
  const [dirStatus,   setDirStatus]   = useState<AgentDirectoryStatus | null>(null);
  const [dirSyncing,  setDirSyncing]  = useState(false);

  // modals
  const [addCat,      setAddCat]      = useState<AddCatForm | null>(null);
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
      setDeepseekKey(config.deepseekKey ?? '');
      setDeepseekModel(config.deepseekModel ?? 'deepseek-chat');
      setGroqKey(config.groqKey ?? '');
      setGroqModel(config.groqModel ?? 'llama-3.3-70b-versatile');
      setOpenrouterKey(config.openrouterKey ?? '');
      setOpenrouterModel(config.openrouterModel ?? 'anthropic/claude-3.5-sonnet');
      setPerplexityKey(config.perplexityKey ?? '');
      setPerplexityModel(config.perplexityModel ?? 'sonar-reasoning-pro');
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
        deepseekKey, deepseekModel,
        groqKey, groqModel,
        openrouterKey, openrouterModel,
        perplexityKey, perplexityModel,
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
        deepseekKey, deepseekModel,
        groqKey, groqModel,
        openrouterKey, openrouterModel,
        perplexityKey, perplexityModel,
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


  // ── external scripts ─────────────────────────────────────────────────────────

  async function validateScripts() {
    setScriptValidating(true);
    setScriptReport(null);
    setScriptExpandedIdx(null);
    try {
      const report = await req<ScriptValidationReport>('GET', '/scripts/validate');
      setScriptReport(report);
    } catch {
      toast('Error al validar scripts', 'err');
    } finally {
      setScriptValidating(false);
    }
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
    let level = 'global', categoryId: string | undefined;
    if (irDest.startsWith('section:')) { const [, c] = irDest.split(':'); level = 'section'; categoryId = c; }
    await req('POST', '/agents', {
      level, categoryId,
      agent: { name: irName.trim(), description: irDesc.trim(), model: irModel, tools: irTools, system: irSystem.trim() },
    });
    toast(`Agente "${irName.trim()}" importado`);
    setImportReview(null);
    setImportUrl('');
  }

  // ── custom provider actions ──────────────────────────────────────────────────

  async function handleSaveCustom() {
    if (!editingCustom?.name || !editingCustom?.id) { toast('ID y Nombre son obligatorios', 'err'); throw new Error('validation'); }
    
    let headers: Record<string, string> = {};
    try { if (customHeadersRaw.trim()) headers = JSON.parse(customHeadersRaw); }
    catch { toast('JSON de Headers inválido', 'err'); throw new Error('validation'); }

    let args: string[] = [];
    try { if (customArgsRaw.trim()) args = JSON.parse(customArgsRaw); }
    catch { toast('JSON de Argumentos inválido (debe ser un array)', 'err'); throw new Error('validation'); }

    const newProvider: CustomAIProvider = {
      ...editingCustom as CustomAIProvider,
      headers,
      cliArgs: args,
    };

    const updated = editingCustom.id && customProviders.some(p => p.id === editingCustom.id)
      ? customProviders.map(p => p.id === editingCustom.id ? newProvider : p)
      : [...customProviders, { ...newProvider, id: newProvider.id || `custom-${Date.now()}` }];

    setCustomProviders(updated);
    await req('PUT', '/config', { customProviders: updated });
    await refreshConfig();
    setEditingCustom(null);
    toast('Proveedor guardado');
  }

  async function deleteCustom(id: string) {
    if (!confirm('¿Eliminar este proveedor personalizado?')) return;
    const updated = customProviders.filter(p => p.id !== id);
    setCustomProviders(updated);
    await req('PUT', '/config', { customProviders: updated });
    if (pendingProvider === id) setPendingProvider('cli');
    await refreshConfig();
    toast('Proveedor eliminado');
  }

  function startEditCustom(p: Partial<CustomAIProvider>) {
    setEditingCustom(p);
    setCustomHeadersRaw(JSON.stringify(p.headers || {}, null, 2));
    setCustomArgsRaw(JSON.stringify(p.cliArgs || (p.type === 'cli' ? ['--prompt'] : []), null, 2));
  }

  async function importCustomFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const data = JSON.parse(event.target?.result as string);
          if (!data.name || !data.type) throw new Error('Formato inválido');
          startEditCustom({ ...data, id: data.id || `custom-${Date.now()}` });
          setShowCustomChoice(false); // Cerrar solo si es válido
        } catch { toast('Archivo JSON inválido', 'err'); }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  // ── render ───────────────────────────────────────────────────────────────────

  const cats     = config?.categories ?? [];
  const isGitHub = pendingProvider === 'github' || pendingProvider === 'copilot-cli';
  const cliChecks = aiStatus?.cliChecks ?? {};

  // Destination options for import modal
  const destOptions: { value: string; label: string }[] = [
    { value: 'global', label: 'Global (disponible en todos los proyectos)' },
    ...cats.map((cat) => ({ value: `section:${cat.id}`, label: `Sección: ${cat.name}` })),
  ];

  return (
    <div className="view active" id="view-settings">
      <Topbar
        title="Ajustes"
      />

      <div className="settings-view">
        {/* Tabs */}
        <div className="drawer-tabs" style={{ margin: '-32px -32px 24px', paddingLeft: 32 }}>
          {(['general', 'cats', 'ext-agents'] as Tab[]).map((t) => (
            <div key={t} className={`drawer-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t === 'general' ? 'General' : t === 'cats' ? 'Categorías' : 'Directorio de Agentes'}
            </div>
          ))}
        </div>

        {/* ── Tab: General ── */}
        {tab === 'general' && (
          <>
            {/* Provider Section (Full Width) */}
            <div style={{ marginBottom: 36 }}>
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
                    
                    <AIRadioRow value="aider-cli" label="Aider CLI" selected={pendingProvider === 'aider-cli'} onSelect={setPendingProvider}
                      badge={cliChecks['aider-cli']?.found ? <span className="badge green"><i className="ti ti-check" /></span> : <span className="badge gray"><i className="ti ti-x" /></span>} />
                    
                    <AIRadioRow value="cline-cli" label="Cline CLI" selected={pendingProvider === 'cline-cli'} onSelect={setPendingProvider}
                      badge={cliChecks['cline-cli']?.found ? <span className="badge green"><i className="ti ti-check" /></span> : <span className="badge gray"><i className="ti ti-x" /></span>} />
                    
                    <AIRadioRow value="goose-cli" label="Goose CLI" selected={pendingProvider === 'goose-cli'} onSelect={setPendingProvider}
                      badge={cliChecks['goose-cli']?.found ? <span className="badge green"><i className="ti ti-check" /></span> : <span className="badge gray"><i className="ti ti-x" /></span>} />

                    {/* Custom CLI Providers */}
                    {customProviders.filter(p => p.type === 'cli').map(p => (
                      <AIRadioRow 
                        key={p.id} value={p.id} label={p.name} selected={pendingProvider === p.id} onSelect={setPendingProvider}
                        onEdit={() => startEditCustom(p)} onDelete={() => deleteCustom(p.id)}
                      />
                    ))}

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
                    <AIRadioRow value="deepseek"   label="DeepSeek API"    selected={pendingProvider === 'deepseek'}   onSelect={setPendingProvider} />
                    <AIRadioRow value="groq"       label="Groq API"        selected={pendingProvider === 'groq'}       onSelect={setPendingProvider} />
                    <AIRadioRow value="openrouter" label="OpenRouter API"  selected={pendingProvider === 'openrouter'} onSelect={setPendingProvider} />
                    <AIRadioRow value="perplexity" label="Perplexity API"  selected={pendingProvider === 'perplexity'} onSelect={setPendingProvider} />

                    {/* Custom API Providers */}
                    {customProviders.filter(p => p.type === 'api').map(p => (
                      <AIRadioRow 
                        key={p.id} value={p.id} label={p.name} selected={pendingProvider === p.id} onSelect={setPendingProvider}
                        onEdit={() => startEditCustom(p)} onDelete={() => deleteCustom(p.id)}
                      />
                    ))}
                  </div>
                </div>

                {/* ── Config panel para el proveedor seleccionado ── */}
                <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>

                  {/* Built-in logic ... */}
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

                  {pendingProvider === 'deepseek' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>API Key <span style={{ color: 'var(--text3)', fontWeight: 400 }}>platform.deepseek.com</span></label>
                        <input type="password" value={deepseekKey} onChange={(e) => setDeepseekKey(e.target.value)}
                          placeholder="sk-…" style={{ fontFamily: 'var(--mono)' }} />
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Modelo</label>
                        <select value={deepseekModel} onChange={(e) => setDeepseekModel(e.target.value)}>
                          <option value="deepseek-chat">DeepSeek-V3 (Chat)</option>
                          <option value="deepseek-reasoner">DeepSeek-R1 (Reasoner)</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {pendingProvider === 'groq' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>API Key <span style={{ color: 'var(--text3)', fontWeight: 400 }}>console.groq.com</span></label>
                        <input type="password" value={groqKey} onChange={(e) => setGroqKey(e.target.value)}
                          placeholder="gsk-…" style={{ fontFamily: 'var(--mono)' }} />
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Modelo</label>
                        <select value={groqModel} onChange={(e) => setGroqModel(e.target.value)}>
                          <option value="llama-3.3-70b-versatile">Llama 3.3 70B (Versatile)</option>
                          <option value="llama-3.1-8b-instant">Llama 3.1 8B (Instant)</option>
                          <option value="mixtral-8x7b-32768">Mixtral 8x7B</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {pendingProvider === 'openrouter' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>API Key <span style={{ color: 'var(--text3)', fontWeight: 400 }}>openrouter.ai</span></label>
                        <input type="password" value={openrouterKey} onChange={(e) => setOpenrouterKey(e.target.value)}
                          placeholder="sk-or-…" style={{ fontFamily: 'var(--mono)' }} />
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Modelo</label>
                        <input value={openrouterModel} onChange={(e) => setOpenrouterModel(e.target.value)}
                          placeholder="anthropic/claude-3.5-sonnet" />
                        <div className="hint">Ej: anthropic/claude-3.5-sonnet, google/gemini-pro-1.5, etc.</div>
                      </div>
                    </div>
                  )}

                  {pendingProvider === 'perplexity' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>API Key <span style={{ color: 'var(--text3)', fontWeight: 400 }}>www.perplexity.ai/settings/api</span></label>
                        <input type="password" value={perplexityKey} onChange={(e) => setPerplexityKey(e.target.value)}
                          placeholder="pplx-…" style={{ fontFamily: 'var(--mono)' }} />
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Modelo</label>
                        <select value={perplexityModel} onChange={(e) => setPerplexityModel(e.target.value)}>
                          <option value="sonar-reasoning-pro">Sonar Reasoning Pro</option>
                          <option value="sonar-reasoning">Sonar Reasoning</option>
                          <option value="sonar">Sonar (Fast)</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Action bar ── */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                  <button className="btn sm" onClick={() => setShowCustomChoice(true)}>
                    <i className="ti ti-plus" /> Proveedor personalizado
                  </button>

                  <div style={{ flex: 1 }} />

                  {testResult && (
                    <span style={{ fontSize: 11, color: testResult.ok ? 'var(--green)' : 'var(--coral)', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <i className={`ti ${testResult.ok ? 'ti-circle-check' : 'ti-alert-circle'}`} />
                      {testResult.ok ? `Conexión OK (${testResult.latencyMs}ms)` : testResult.error}
                    </span>
                  )}
                  
                  {['api','openai','github','gemini-api','mistral','grok', 'deepseek', 'groq', 'openrouter', 'perplexity'].includes(pendingProvider) || customProviders.some(p => p.id === pendingProvider) ? (
                    <button className="btn sm ghost" onClick={testConn} disabled={testing || saving}>
                      {testing ? <><i className="ti ti-loader-2" /> Probando…</> : <><i className="ti ti-plug" /> Probar conexión</>}
                    </button>
                  ) : null}
                  
                  <button className="btn primary sm" onClick={saveAll} disabled={saving || testing}>
                    {saving ? <><i className="ti ti-loader-2" /> Guardando…</> : <><i className="ti ti-device-floppy" /> Guardar</>}
                  </button>
                </div>
              </div>

            {/* Scripts personalizados */}
            <div className="settings-section">
              <div className="settings-head">Scripts personalizados</div>
              <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 0, marginBottom: 12 }}>
                Añade ficheros <code>.js</code> a la carpeta <code>user-scripts/</code> junto al ejecutable para crear pasos de orquestación sin IA. <a
                  href="#"
                  style={{ color: 'var(--accent)' }}
                  onClick={e => { e.preventDefault(); (window as any).api?.openPath?.(config ? '' : ''); }}
                >Ver guía</a>
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <code style={{ fontSize: 11, color: 'var(--text2)', background: 'var(--bg3)', padding: '3px 8px', borderRadius: 5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  user-scripts/
                </code>
                <button className="btn sm ghost" onClick={() => (window as any).api?.openPath?.('user-scripts')}>
                  <i className="ti ti-folder-open" /> Abrir carpeta
                </button>
                <button className="btn sm" onClick={validateScripts} disabled={scriptValidating}>
                  {scriptValidating
                    ? <><i className="ti ti-loader-2" /> Validando…</>
                    : <><i className="ti ti-shield-check" /> Validar scripts</>
                  }
                </button>
              </div>

              {scriptReport && (
                <div style={{ fontSize: 12 }}>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 10, color: 'var(--text2)' }}>
                    <span style={{ color: 'var(--green)' }}><i className="ti ti-check" /> {scriptReport.summary.ok} correctos</span>
                    {scriptReport.summary.warn > 0 && <span style={{ color: 'var(--amber)' }}><i className="ti ti-alert-triangle" /> {scriptReport.summary.warn} advertencia{scriptReport.summary.warn !== 1 ? 's' : ''}</span>}
                    {scriptReport.summary.error > 0 && <span style={{ color: 'var(--coral)' }}><i className="ti ti-x" /> {scriptReport.summary.error} error{scriptReport.summary.error !== 1 ? 'es' : ''}</span>}
                  </div>
                  {scriptReport.results.length === 0 ? (
                    <div style={{ color: 'var(--text3)', fontStyle: 'italic' }}>No se encontraron ficheros .js en la carpeta user-scripts/</div>
                  ) : (
                    scriptReport.results.map((r, idx) => (
                      <div key={r.file} style={{ background: 'var(--bg2)', border: `1px solid ${r.status === 'error' ? 'var(--coral)' : r.status === 'warn' ? 'var(--amber)' : 'var(--border)'}`, borderRadius: 6, marginBottom: 6, overflow: 'hidden' }}>
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: r.issues.length > 0 ? 'pointer' : 'default' }}
                          onClick={() => r.issues.length > 0 && setScriptExpandedIdx(scriptExpandedIdx === idx ? null : idx)}
                        >
                          {r.status === 'ok'    && <i className="ti ti-check"          style={{ color: 'var(--green)', fontSize: 13 }} />}
                          {r.status === 'warn'  && <i className="ti ti-alert-triangle" style={{ color: 'var(--amber)', fontSize: 13 }} />}
                          {r.status === 'error' && <i className="ti ti-x"              style={{ color: 'var(--coral)', fontSize: 13 }} />}
                          <code style={{ flex: 1, color: 'var(--text1)' }}>{r.file}</code>
                          {r.issues.length > 0 && <i className={`ti ti-chevron-${scriptExpandedIdx === idx ? 'up' : 'down'}`} style={{ color: 'var(--text3)', fontSize: 11 }} />}
                        </div>
                        {scriptExpandedIdx === idx && r.issues.length > 0 && (
                          <div style={{ borderTop: '1px solid var(--border)', padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {r.issues.map((issue, ii) => (
                              <div key={ii} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                                <code style={{ fontSize: 10, color: issue.severity === 'error' ? 'var(--coral)' : 'var(--amber)', whiteSpace: 'nowrap', flexShrink: 0 }}>{issue.code}</code>
                                <span style={{ color: 'var(--text2)' }}>{issue.message}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Row 2: Application (Compact: Close behavior + Updates + Wizard on the right) */}
            <div className="settings-section">
              <div className="settings-head">Aplicación</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1 }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--text1)' }}>Al cerrar:</span>
                  <select 
                    style={{ padding: '4px 8px', fontSize: 12, width: 'auto' }}
                    value={config?.closeAction ?? 'ask'}
                    onChange={async (e) => { await req('PUT', '/config', { closeAction: e.target.value }); await refreshConfig(); }}
                  >
                    <option value="ask">Preguntar siempre</option>
                    <option value="tray">Minimizar al tray</option>
                    <option value="quit">Salir completamente</option>
                  </select>
                </div>

                <div style={{ height: 16, width: 1, background: 'var(--border2)' }} />

                <button className="btn sm ghost" onClick={checkUpdate}>
                  <i className="ti ti-refresh" /> Buscar actualizaciones
                </button>
                <button className="btn sm ghost" onClick={() => setShowWizardFromSettings(true)}>
                  <i className="ti ti-wand" /> Ver wizard
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Tab: Categorías ── */}
        {tab === 'cats' && (
          <div className="settings-section">
            <div className="settings-head">Categorías</div>
            <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 0, marginBottom: 12 }}>
              Las categorías agrupan agentes por dominio. La especificidad tecnológica se define mediante skills en cada proyecto.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button className="btn sm" onClick={() => setAddCat({ id: '', name: '', color: '#7c6af7' })}>
                <i className="ti ti-plus" /> Nueva categoría
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
              {cats.map((cat) => (
                <div key={cat.id} className="cat-item">
                  <div className="cat-item-head">
                    <div className="cat-dot" style={{ background: cat.color }} />
                    <i className={`ti ${cat.icon || 'ti-folder'}`} style={{ color: cat.color, fontSize: 14 }} />
                    <span className="cat-item-name">{cat.name}</span>
                    <button className="btn ghost sm danger" onClick={() => deleteCat(cat.id)}>
                      <i className="ti ti-trash" />
                    </button>
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

      {/* ── Modal: Elección de proveedor custom ── */}
      {showCustomChoice && (
        <Modal title="Añadir proveedor personalizado" onClose={() => setShowCustomChoice(false)} hideFooter>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div 
              className="choice-card"
              onClick={() => { setShowCustomChoice(false); startEditCustom({ type: 'api', isOpenAICompatible: true }); }}
              style={{ padding: 20, borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border)', cursor: 'pointer', textAlign: 'center', transition: 'all .2s' }}
            >
              <i className="ti ti-settings" style={{ fontSize: 32, color: 'var(--accent)', marginBottom: 12, display: 'block' }} />
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Configurar a mano</div>
              <div style={{ fontSize: 11, color: 'var(--text2)' }}>Define URL, claves y cabeceras manualmente</div>
            </div>
            <div 
              className="choice-card"
              onClick={() => { setShowCustomChoice(false); importCustomFile(); }}
              style={{ padding: 20, borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border)', cursor: 'pointer', textAlign: 'center', transition: 'all .2s' }}
            >
              <i className="ti ti-file-import" style={{ fontSize: 32, color: 'var(--green)', marginBottom: 12, display: 'block' }} />
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Importar JSON</div>
              <div style={{ fontSize: 11, color: 'var(--text2)' }}>Carga un archivo de configuración compartido</div>
            </div>
          </div>

          <div style={{ height: 1, background: 'var(--border)', margin: '20px 0' }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <InfoCard title="GUÍA: INTEGRACIÓN CORPORATIVA (AZURE / OPENAI)">
              <div style={{ fontSize: 12, color: 'var(--text1)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ margin: 0 }}>Para conectar sistemas de IA empresariales o proxies internos:</p>
                <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <li>Crea un <strong>Nuevo Proveedor</strong> de tipo API.</li>
                  <li>Selecciona <strong>"Azure / Enterprise"</strong> si usas Azure API Management o gateways con seguridad especial.</li>
                  <li>Añade en <strong>Headers</strong> las claves requeridas (ej: <code>Ocp-Apim-Subscription-Key</code>).</li>
                  <li>Pega la <strong>Base URL</strong> del endpoint corporativo.</li>
                </ol>
              </div>
            </InfoCard>

            <InfoCard title="CONSEJO: COMPARTIR CONFIGURACIÓN">
              <div style={{ fontSize: 12, color: 'var(--text1)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ margin: 0 }}>Puedes exportar tus proveedores configurados a un archivo <strong>.json</strong> para que otros compañeros lo importen al instante.</p>
                <div style={{ background: 'var(--bg1)', padding: 8, borderRadius: 6, fontSize: 11, border: '1px solid var(--border)' }}>
                  El archivo incluirá la URL, el modelo y los headers, permitiendo que el equipo use la misma infraestructura con sus propias credenciales.
                </div>
              </div>
            </InfoCard>
          </div>
        </Modal>
      )}

      {/* ── Modal: Proveedor IA Custom ── */}
      {editingCustom && (
        <Modal 
          title={editingCustom.id ? 'Editar Proveedor' : 'Nuevo Proveedor Personalizado'} 
          confirmLabel="Guardar" 
          onConfirm={handleSaveCustom} 
          onClose={() => setEditingCustom(null)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label>Nombre</label>
                <input value={editingCustom.name || ''} onChange={(e) => setEditingCustom({ ...editingCustom, name: e.target.value })} placeholder="Ej: Mi Empresa IA" />
              </div>
              <div className="field" style={{ width: 120, marginBottom: 0 }}>
                <label>Tipo</label>
                <select value={editingCustom.type || 'api'} onChange={(e) => setEditingCustom({ ...editingCustom, type: e.target.value as any })}>
                  <option value="api">API (HTTP)</option>
                  <option value="cli">CLI (Nativo)</option>
                </select>
              </div>
            </div>

            <div className="field" style={{ marginBottom: 0 }}>
              <label>ID Único (interno)</label>
              <input value={editingCustom.id || ''} onChange={(e) => setEditingCustom({ ...editingCustom, id: e.target.value })} placeholder="empresa-prod" disabled={!!editingCustom.id && customProviders.some(p => p.id === editingCustom.id)} />
            </div>

            {editingCustom.type === 'api' && (
              <>
                <div style={{ display: 'flex', gap: 10, background: 'var(--bg2)', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                    <input type="radio" checked={editingCustom.isOpenAICompatible ?? true} onChange={() => setEditingCustom({ ...editingCustom, isOpenAICompatible: true })} />
                    OpenAI Standard
                  </label>
                  <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                    <input type="radio" checked={!(editingCustom.isOpenAICompatible ?? true)} onChange={() => setEditingCustom({ ...editingCustom, isOpenAICompatible: false })} />
                    Azure / Enterprise
                  </label>
                </div>

                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Base URL</label>
                  <input value={editingCustom.baseUrl || ''} onChange={(e) => setEditingCustom({ ...editingCustom, baseUrl: e.target.value })} placeholder="https://..." style={{ fontFamily: 'var(--mono)' }} />
                </div>

                <div className="field" style={{ marginBottom: 0 }}>
                  <label>API Key</label>
                  <input type="password" value={editingCustom.apiKey || ''} onChange={(e) => setEditingCustom({ ...editingCustom, apiKey: e.target.value })} placeholder="sk-..." style={{ fontFamily: 'var(--mono)' }} />
                </div>

                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Modelo por defecto</label>
                  <input value={editingCustom.model || ''} onChange={(e) => setEditingCustom({ ...editingCustom, model: e.target.value })} placeholder="gpt-4o" />
                </div>

                {!editingCustom.isOpenAICompatible && (
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Headers Adicionales (JSON)</label>
                    <textarea 
                      rows={4} value={customHeadersRaw} onChange={(e) => setCustomHeadersRaw(e.target.value)}
                      placeholder='{ "Ocp-Apim-Subscription-Key": "..." }'
                      style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
                    />
                  </div>
                )}
              </>
            )}

            {editingCustom.type === 'cli' && (
              <>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Binario / Comando</label>
                  <input value={editingCustom.cliBin || ''} onChange={(e) => setEditingCustom({ ...editingCustom, cliBin: e.target.value })} placeholder="my-ai-cli" style={{ fontFamily: 'var(--mono)' }} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Argumentos (JSON Array)</label>
                  <input value={customArgsRaw} onChange={(e) => setCustomArgsRaw(e.target.value)} placeholder='["--prompt"]' style={{ fontFamily: 'var(--mono)' }} />
                </div>
              </>
            )}
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
  onEdit?: () => void;
  onDelete?: () => void;
}

function AIRadioRow({ value, label, selected, onSelect, badge, extra, onEdit, onDelete }: AIRadioRowProps) {
  return (
    <div
      onClick={() => onSelect(value)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
        borderRadius: 6, cursor: 'pointer', marginBottom: 2,
        background: selected ? 'var(--bg3)' : 'transparent',
        border: `1px solid ${selected ? 'var(--accent)' : 'transparent'}`,
        transition: 'all .12s',
      }}
    >
      <div className={`provider-radio${selected ? ' on' : ''}`} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 12, fontWeight: selected ? 600 : 400, color: selected ? 'var(--text0)' : 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {extra}
      {badge}
      {(onEdit || onDelete) && (
        <div style={{ display: 'flex', gap: 4, marginLeft: 4 }} onClick={e => e.stopPropagation()}>
          {onEdit && <button className="btn icon sm ghost" onClick={onEdit} title="Editar"><i className="ti ti-edit" style={{ fontSize: 13 }} /></button>}
          {onDelete && <button className="btn icon sm ghost danger" onClick={onDelete} title="Eliminar"><i className="ti ti-trash" style={{ fontSize: 13 }} /></button>}
        </div>
      )}
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
