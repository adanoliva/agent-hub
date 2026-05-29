# CDM v1.9 — Multi-Provider AI
## Especificación Técnica

**Versión objetivo:** 1.9.0 · **Fecha:** Mayo 2026 · **Clasificación:** Interno

---

## 1. Resumen ejecutivo

CDM actualmente soporta tres proveedores de IA: `cli` (Claude Code CLI), `api` (Anthropic API) y `github` (GitHub Models). Esta especificación detalla la ampliación a **diez providers** organizados en dos grupos funcionales — **CLIs nativos** y **APIs con subsistema CLI** — con los cambios necesarios en config, backend, tipos y frontend.

**Alcance:**
- Cuatro CLIs nativos: Claude Code, Gemini CLI, OpenAI Codex CLI, GitHub Copilot CLI
- Seis APIs (subsistema CLI): Anthropic, OpenAI, GitHub Models, Gemini, Mistral, Grok
- Rediseño completo de la sección "Proveedor de IA" en `Settings.tsx`
- Extensión de `config.json`, `types.ts`, `ai.js` y `server.js`
- Sin cambios en `subsystem-cli.js`, `agents.js`, `projects.js` ni `orchestrator.js`

---

## 2. Contexto y motivación

### 2.1 Arquitectura actual de providers

El módulo `ai.js` implementa tres ramas de ejecución. Las ramas `api` y `github` usan el subsistema CLI (`subsystem-cli.js`) para emular las capacidades de filesystem que tiene el CLI nativo. La rama `cli` delega directamente en el proceso `claude --print`.

| Provider | Tipo ejecución | Autenticación | Subsistema CLI |
|---|---|---|---|
| `cli` | Spawn proceso nativo | Suscripción Claude.ai | No (acceso real) |
| `api` | SDK Anthropic | API key `sk-ant-…` | Sí |
| `github` | fetch Azure endpoint | PAT `models:read` | Sí |

### 2.2 Problema

La UI mezcla los tres providers en una lista plana sin distinción conceptual. Al añadir nuevos providers la lista se vuelve confusa. Hay dos tipos claramente diferenciados:

- **CLI nativo:** el provider ejecuta directamente en el terminal del usuario. No pasa por el subsistema CLI.
- **API + subsistema CLI:** el provider es una API REST. El backend emula las capacidades de filesystem vía `subsystem-cli.js`.

---

## 3. Catálogo de providers

### 3.1 Grupo CLI — Procesos nativos

Estos providers requieren que el usuario tenga instalada la herramienta en su sistema. El backend detecta su presencia en el `PATH` y spawnea el proceso. El subsistema CLI no interviene.

| ID | Nombre | Instalación | Binario en PATH |
|---|---|---|---|
| `cli` | Claude Code CLI | claude.ai/code | `claude` |
| `gemini-cli` | Gemini CLI | npmjs.com / brew | `gemini` |
| `codex-cli` | OpenAI Codex CLI | npmjs.com | `codex` |
| `copilot-cli` | GitHub Copilot CLI | gh extension | `gh copilot` |

### 3.2 Grupo API — Subsistema CLI

Estos providers se invocan via HTTP/SDK. El backend les inyecta las capacidades de filesystem a través de `subsystem-cli.js`. Requieren credenciales.

| ID | Nombre | Endpoint / SDK | Credencial |
|---|---|---|---|
| `api` | Anthropic API | `@anthropic-ai/sdk` | `sk-ant-api03-…` |
| `openai` | OpenAI API | `api.openai.com` | `sk-proj-…` |
| `github` | GitHub Models | Azure inference | `ghp_…` (`models:read`) |
| `gemini-api` | Gemini API | `generativelanguage.googleapis.com` | `AIza…` |
| `mistral` | Mistral API | `api.mistral.ai` | API key |
| `grok` | Grok (xAI) | `api.x.ai` | `xai-…` |

> **Nota:** OpenAI, Gemini, Mistral y Grok exponen APIs compatibles con el formato OpenAI. La función `callOpenAICompat()` del §6.2 funciona con todos ellos sin modificación, solo cambiando `baseUrl` y `key`.

---

## 4. Cambios en `config.json` y `config.js`

### 4.1 Nuevos campos en config.json

```json
{
  "aiProvider": "cli",

  "geminiCliModel": "gemini-2.5-pro",
  "codexCliModel":  "o4-mini",

  "apiKey":         "",
  "apiModel":       "claude-sonnet-4-20250514",

  "openaiKey":      "",
  "openaiModel":    "gpt-4o-mini",

  "githubToken":    "",
  "githubModel":    "gpt-4o-mini",

  "geminiApiKey":   "",
  "geminiApiModel": "gemini-2.5-flash",

  "mistralKey":     "",
  "mistralModel":   "mistral-small-latest",

  "grokKey":        "",
  "grokModel":      "grok-3-mini"
}
```

Todos los campos nuevos son opcionales. El spread de `readConfig()` los fusionará automáticamente en instalaciones existentes vía `DEFAULT_CONFIG`.

### 4.2 Actualizar `PUT /api/config` en server.js

Añadir los nuevos campos a la lista de campos permitidos:

```js
const ALLOWED = [
  'aiProvider', 'apiKey', 'apiModel',
  'githubToken', 'githubModel',
  'openaiKey', 'openaiModel',
  'geminiCliModel', 'codexCliModel',
  'geminiApiKey', 'geminiApiModel',
  'mistralKey', 'mistralModel',
  'grokKey', 'grokModel',
  'theme', 'closeAction',
  'agentsDirectoryUrl', 'agentsDirectoryEnabled',
];
```

---

## 5. Cambios en `types.ts`

### 5.1 Tipo AIProvider

```ts
type AIProvider =
  // CLI group
  | 'cli'          // Claude Code CLI
  | 'gemini-cli'   // Gemini CLI
  | 'codex-cli'    // OpenAI Codex CLI
  | 'copilot-cli'  // GitHub Copilot CLI
  // API group
  | 'api'          // Anthropic API (existente)
  | 'openai'       // OpenAI API
  | 'github'       // GitHub Models (existente)
  | 'gemini-api'   // Gemini API
  | 'mistral'      // Mistral API
  | 'grok';        // Grok (xAI)
```

### 5.2 Interfaz Config ampliada

```ts
interface Config {
  version:          string;
  aiProvider:       AIProvider;

  // API keys & models
  apiKey:           string;
  apiModel?:        string;
  openaiKey?:       string;
  openaiModel?:     string;
  githubToken:      string;
  githubModel:      string;
  geminiApiKey?:    string;
  geminiApiModel?:  string;
  mistralKey?:      string;
  mistralModel?:    string;
  grokKey?:         string;
  grokModel?:       string;

  // CLI models
  geminiCliModel?:  string;
  codexCliModel?:   string;

  theme:            'dark' | 'light';
  closeAction?:     'ask' | 'tray' | 'quit';
  agentsDirectoryUrl?:      string;
  agentsDirectoryEnabled?:  boolean;
  categories:       Category[];
  projects:         Project[];
}
```

---

## 6. Cambios en `ai.js`

### 6.1 Nuevas ramas en `callAI()`

```js
async function callAI(prompt, systemPrompt) {
  const cfg = readConfig();
  switch (cfg.aiProvider) {
    // ── CLI group ──────────────────────────────────────
    case 'cli':         return callCLI(prompt, { systemPrompt });
    case 'gemini-cli':  return callGeminiCLI(prompt, { systemPrompt });
    case 'codex-cli':   return callCodexCLI(prompt, { systemPrompt });
    case 'copilot-cli': return callCopilotCLI(prompt, { systemPrompt });

    // ── API group ──────────────────────────────────────
    case 'api':         return callAnthropicAPI(prompt, systemPrompt);
    case 'openai':      return callOpenAICompat(prompt, systemPrompt, {
                          baseUrl: 'https://api.openai.com/v1',
                          key: cfg.openaiKey,
                          model: cfg.openaiModel ?? 'gpt-4o-mini',
                        });
    case 'github':      return callOpenAICompat(prompt, systemPrompt, {
                          baseUrl: GITHUB_ENDPOINT,
                          key: cfg.githubToken,
                          model: cfg.githubModel ?? 'gpt-4o-mini',
                        });
    case 'gemini-api':  return callOpenAICompat(prompt, systemPrompt, {
                          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
                          key: cfg.geminiApiKey,
                          model: cfg.geminiApiModel ?? 'gemini-2.5-flash',
                        });
    case 'mistral':     return callOpenAICompat(prompt, systemPrompt, {
                          baseUrl: 'https://api.mistral.ai/v1',
                          key: cfg.mistralKey,
                          model: cfg.mistralModel ?? 'mistral-small-latest',
                        });
    case 'grok':        return callOpenAICompat(prompt, systemPrompt, {
                          baseUrl: 'https://api.x.ai/v1',
                          key: cfg.grokKey,
                          model: cfg.grokModel ?? 'grok-3-mini',
                        });
  }
}
```

### 6.2 `callOpenAICompat()` — nueva función genérica

Reemplaza `callGitHub()` y sirve a todos los providers OpenAI-compatibles:

```js
async function callOpenAICompat(prompt, systemPrompt, { baseUrl, key, model }) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, max_tokens: 4096 }),
  });

  const data = await res.json();
  const text = data.choices[0].message.content;
  const { prompt_tokens, completion_tokens } = data.usage ?? {};
  trackUsage({ inputTokens: prompt_tokens, outputTokens: completion_tokens });
  return text;
}
```

### 6.3 Nuevos `callXxxCLI()`

Los tres nuevos CLIs siguen el patrón de `callCLI()` adaptando binario y argumentos:

| Provider | Binario | Argumentos principales | Output |
|---|---|---|---|
| `gemini-cli` | `gemini` | `--model <m> --print` | stdout texto plano |
| `codex-cli` | `codex` | `--model <m> --quiet` | stdout texto plano |
| `copilot-cli` | `gh copilot suggest` | `-t shell` | stdout texto plano |

Todos deben respetar `opts.cwd`, `opts.timeout` y `opts.extraArgs` igual que `callCLI()`.

### 6.4 Actualizar `callAIChat()` y `callAIChatWithTokens()`

Añadir las mismas ramas del switch. Para CLIs nuevos que no soporten chat multi-turno nativo, aplanar el historial a texto igual que se hace actualmente con `'cli'`.

### 6.5 Actualizar `callAIWithSubsystemCLI()`

```js
const API_PROVIDERS = ['api', 'openai', 'github', 'gemini-api', 'mistral', 'grok'];

function callAIWithSubsystemCLI(prompt, agentSystemPrompt, opts) {
  if (!API_PROVIDERS.includes(opts.provider)) {
    throw new Error('subsystem-cli solo disponible para providers API');
  }
  return subsystemCli.execute(prompt, agentSystemPrompt, {
    ...opts,
    callAIRaw: (messages, sys) => callAIChatWithTokens(messages, sys),
  });
}
```

### 6.6 Detección de CLIs — `GET /api/detect-cli`

Ampliar para detectar todos los CLIs y devolver `checks` completo:

```js
app.get('/api/detect-cli', async (req, res) => {
  const checks = {
    'cli':         await which('claude'),
    'gemini-cli':  await which('gemini'),
    'codex-cli':   await which('codex'),
    'copilot-cli': await which('gh'),
  };
  res.json({ found: !!checks[readConfig().aiProvider], checks });
});
```

---

## 7. Cambios en `GET /api/ai/status`

```js
// Respuesta actual
{ provider: 'cli', ready: true }

// Respuesta nueva
{
  provider: 'gemini-api',
  ready: true,
  cliChecks: {
    'cli':         { found: true,  path: '/usr/local/bin/claude' },
    'gemini-cli':  { found: true,  path: '/usr/local/bin/gemini' },
    'codex-cli':   { found: false, path: null },
    'copilot-cli': { found: true,  path: '/usr/local/bin/gh' },
  }
}
```

`ready` para providers API: credencial no vacía. Para CLIs: presencia en PATH.

---

## 8. Cambios en `Settings.tsx`

### 8.1 Nuevo estado local

```ts
// CLIs — solo modelo (sin credenciales)
const [geminiCliModel, setGeminiCliModel] = useState(config?.geminiCliModel ?? 'gemini-2.5-pro');
const [codexCliModel,  setCodexCliModel]  = useState(config?.codexCliModel  ?? 'o4-mini');

// APIs — key + modelo
const [openaiKey,       setOpenaiKey]       = useState(config?.openaiKey       ?? '');
const [openaiModel,     setOpenaiModel]     = useState(config?.openaiModel     ?? 'gpt-4o-mini');
const [geminiApiKey,    setGeminiApiKey]    = useState(config?.geminiApiKey    ?? '');
const [geminiApiModel,  setGeminiApiModel]  = useState(config?.geminiApiModel  ?? 'gemini-2.5-flash');
const [mistralKey,      setMistralKey]      = useState(config?.mistralKey      ?? '');
const [mistralModel,    setMistralModel]    = useState(config?.mistralModel    ?? 'mistral-small-latest');
const [grokKey,         setGrokKey]         = useState(config?.grokKey         ?? '');
const [grokModel,       setGrokModel]       = useState(config?.grokModel       ?? 'grok-3-mini');

// Estado de detección de CLIs (del endpoint /ai/status)
const [cliChecks, setCliChecks] = useState<Record<string, { found: boolean }>>({});
```

### 8.2 Helper de guardado genérico

```ts
async function saveProvider(fields: Record<string, unknown>) {
  await req('PUT', '/config', fields);
  await refreshConfig();
  toast('Guardado');
}

// Ejemplos
saveProvider({ openaiKey: openaiKey.trim(), openaiModel });
saveProvider({ geminiApiKey: geminiApiKey.trim(), geminiApiModel });
```

### 8.3 Estructura visual

La sección pasa de lista plana a dos grupos separados:

```
┌─ "Proveedor de IA" (settings-head)
│
├─ Label "CLI — Procesos nativos"
│   ├─ ProviderOption: Claude Code CLI
│   ├─ ProviderOption: Gemini CLI
│   ├─ ProviderOption: OpenAI Codex CLI
│   └─ ProviderOption: GitHub Copilot CLI
│
├─ ─────────────── separador ───────────────
│
└─ Label "API — Subsistema CLI"
    ├─ ProviderOption: Anthropic API
    ├─ ProviderOption: OpenAI API
    ├─ ProviderOption: GitHub Models
    ├─ ProviderOption: Gemini API
    ├─ ProviderOption: Mistral API
    └─ ProviderOption: Grok (xAI)
```

### 8.4 Nuevo componente `ProviderGroup`

```tsx
function ProviderGroup({ label, icon, children }: {
  label: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="provider-group-label">
        <i className={`ti ${icon}`} />
        {label}
      </div>
      {children}
    </div>
  );
}
```

Uso:

```tsx
<ProviderGroup label="CLI — Procesos nativos" icon="ti-terminal">
  <ProviderOption ... /> {/* claude code */}
  <ProviderOption ... /> {/* gemini cli */}
  ...
</ProviderGroup>

<div className="provider-group-separator" />

<ProviderGroup label="API — Subsistema CLI" icon="ti-api">
  <ProviderOption ... /> {/* anthropic */}
  ...
</ProviderGroup>
```

### 8.5 Contenido expandido por provider

| Provider | Campos expandidos | Acciones |
|---|---|---|
| Claude Code CLI | — | Botón instalar + recomprobar |
| Gemini CLI | Select modelo | Badge detected / not found |
| Codex CLI | Select modelo | Badge detected / not found |
| Copilot CLI | — | Badge detected / not found |
| Anthropic API | Input key + select modelo | Botón guardar |
| OpenAI API | Input key + select modelo | Botón guardar |
| GitHub Models | Input PAT + select modelo | Botón guardar |
| Gemini API | Input key + select modelo | Botón guardar |
| Mistral API | Input key + select modelo | Botón guardar |
| Grok (xAI) | Input key + select modelo | Botón guardar |

### 8.6 Modelos disponibles por provider

| Provider | Opciones |
|---|---|
| Anthropic API | `claude-sonnet-4-20250514`, `claude-haiku-4-5-20251001`, `claude-opus-4-20250514` |
| OpenAI | `gpt-4o-mini`, `gpt-4o`, `o4-mini`, `o3` |
| GitHub Models | `gpt-4o-mini`, `gpt-4o`, `o1-mini` |
| Gemini API | `gemini-2.5-flash`, `gemini-2.5-pro` |
| Mistral | `mistral-small-latest`, `mistral-medium-latest`, `mistral-large-latest` |
| Grok | `grok-3-mini`, `grok-3` |
| Gemini CLI | `gemini-2.5-pro`, `gemini-2.5-flash` |
| Codex CLI | `o4-mini`, `gpt-4o` |

### 8.7 CSS necesario en `styles.css`

```css
.provider-group-label {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text3);
  padding: 4px 2px 8px;
  margin-top: 12px;
}

.provider-group-label i {
  font-size: 13px;
}

.provider-group-separator {
  height: 1px;
  background: var(--border);
  margin: 12px 0;
}
```

### 8.8 Actualizar el `useEffect` de sincronización de config

```ts
React.useEffect(() => {
  if (config) {
    // existentes
    setGhToken(config.githubToken ?? '');
    setGhModel(config.githubModel ?? 'gpt-4o-mini');
    setApiKey(config.apiKey ?? '');
    // nuevos CLIs
    setGeminiCliModel(config.geminiCliModel ?? 'gemini-2.5-pro');
    setCodexCliModel(config.codexCliModel   ?? 'o4-mini');
    // nuevas APIs
    setOpenaiKey(config.openaiKey           ?? '');
    setOpenaiModel(config.openaiModel       ?? 'gpt-4o-mini');
    setGeminiApiKey(config.geminiApiKey     ?? '');
    setGeminiApiModel(config.geminiApiModel ?? 'gemini-2.5-flash');
    setMistralKey(config.mistralKey         ?? '');
    setMistralModel(config.mistralModel     ?? 'mistral-small-latest');
    setGrokKey(config.grokKey               ?? '');
    setGrokModel(config.grokModel           ?? 'grok-3-mini');
  }
}, [config]);
```

---

## 9. Impacto en otros módulos

### 9.1 `projects.js` — `getContextAuto()`

Actualizar la clasificación de grupos:

```js
const CLAUDE_GROUP = ['cli', 'gemini-cli', 'codex-cli', 'api', 'openai',
                      'gemini-api', 'mistral', 'grok'];
const GITHUB_GROUP = ['github', 'copilot-cli'];

// CLAUDE.md para CLAUDE_GROUP, copilot-instructions.md para GITHUB_GROUP
```

### 9.2 `orchestrator.js`

```js
const CLI_PROVIDERS = ['cli', 'gemini-cli', 'codex-cli', 'copilot-cli'];
const API_PROVIDERS = ['api', 'openai', 'github', 'gemini-api', 'mistral', 'grok'];

if (CLI_PROVIDERS.includes(provider)) {
  return callNativeCLI(provider, prompt, opts);
} else {
  return callAIWithSubsystemCLI(prompt, agentSystem, { ...opts, provider });
}
```

### 9.3 `Wizard.tsx`

Actualizar para mostrar los mismos dos grupos con los diez providers. La lógica de guardado no cambia: `POST /api/setup` con el provider y credencial seleccionados.

### 9.4 `dashboard.js` y `templates.js`

Sin cambios. El dashboard opera sobre `project.aiProvider` (`'claude' | 'github' | 'both'`), que no se modifica. Las plantillas dependen de `categoryId` y `techId`, no del AI provider.

---

## 10. Plan de implementación

### Orden recomendado

1. **Tipos y config** — `types.ts` + `config.js` DEFAULT_CONFIG + `server.js` ALLOWED list
2. **Backend AI** — `ai.js`: `callOpenAICompat()`, nuevas ramas, detección CLIs en `/ai/status`
3. **Frontend Settings** — `Settings.tsx`: estado, helpers, `ProviderGroup`, `ProviderOption`s, CSS
4. **Impacto en otros módulos** — `projects.js`, `orchestrator.js`, `Wizard.tsx`
5. **QA** — probar cada provider con llamada simple antes de integración completa

### Estimación

| Fase | Archivos | Estimación |
|---|---|---|
| 1 — Tipos y config | `types.ts`, `config.js`, `server.js` | ~30 min |
| 2 — Backend AI | `ai.js` | ~2 h |
| 3 — Frontend Settings | `Settings.tsx`, `styles.css` | ~3 h |
| 4 — Otros módulos | `projects.js`, `orchestrator.js`, `Wizard.tsx` | ~1 h |
| 5 — QA | Manual | ~1 h |
| **Total** | | **~7-8 h** |

### Estrategia de testing por provider

Para cada nuevo provider, verificar en orden:

1. `GET /api/ai/status` devuelve `ready: true`
2. `POST /api/chat` con mensaje corto
3. Chat multi-turno (dos mensajes consecutivos)
4. Subsistema CLI (solo APIs): `POST /api-fs/projects/:id/execute-agent`
5. Ejecución sobre proyecto: `POST /api/projects/:id/execute-task`

---

## 11. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Gemini CLI no acepta `--print`; formato de salida diferente | Media | Leer docs; posible flag `--output-format text` |
| Codex CLI en beta; API inestable | Alta | Marcar como "experimental" en UI con badge amber |
| Copilot CLI no soporta llamadas no-interactivas | Media | `gh copilot suggest -t shell` acepta stdin; probar antes |
| Rate limits distintos por provider | Baja | El tracking de tokens ya lo gestiona; documentar en UI |
| Grok API key con prefijo distinto (`xai-…`) | Baja | Validación en frontend con regex `/^xai-/` |

---

## 12. Apéndice — Endpoints y modelos por defecto

| Provider | Base URL | Modelo por defecto |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Gemini API | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` |
| Mistral | `https://api.mistral.ai/v1` | `mistral-small-latest` |
| Grok (xAI) | `https://api.x.ai/v1` | `grok-3-mini` |
| GitHub Models | `https://models.inference.ai.azure.com` | `gpt-4o-mini` |

Todos los endpoints son compatibles con `POST /chat/completions` del estándar OpenAI. La función `callOpenAICompat()` del §6.2 funciona con todos sin modificación.

---

*CDM v1.9 — Multi-Provider AI · Documento interno*
