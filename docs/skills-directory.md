# Skills Directory — Plan de implementación

> Feature: búsqueda e importación de skills desde [skills.sh](https://skills.sh)
> Estado: pendiente de implementación
> Fecha: 2026-06-12

---

## Contexto

[skills.sh](https://skills.sh) es un directorio público de ~679K skills para agentes IA (Claude Code, Cursor, Copilot, Gemini, etc.), creado por Vercel y open source. Cada skill es un fichero `SKILL.md` alojado en un repositorio público de GitHub.

**Formato de una skill en skills.sh:** markdown plano, compatible con el formato de skills que ya usa Agent Hub (`---` frontmatter + cuerpo).

**API de skills.sh:** requiere autenticación por token OIDC de Vercel (generado automáticamente en el runtime de Vercel). No hay API keys estáticas ni acceso público sin auth.

**Solución adoptada:** proxy serverless propio desplegado en Vercel (cuenta del proyecto), hardcodeado en Agent Hub. Ningún usuario configura nada.

---

## Resumen de piezas

```
[1] Repo actual:  agent-hub (adanoliva/agent-hub en Vercel)
    └── api/skills/  ← funciones serverless añadidas al mismo deploy
[2] Backend:      src/backend/skills.js  (+5 funciones)
                  src/backend/server.js  (+2 endpoints)
[3] Frontend:     SkillsCenter.tsx       (+botón Directorio)
                  SkillDirectoryModal.tsx (componente nuevo)
                  Agents.tsx             (+estado y handler)
```

---

## Parte 1 — Proxy Vercel (mismo repo `agent-hub`)

La web de Agent Hub ya está desplegada en Vercel desde `docs/web/`. Las funciones serverless se añaden en una carpeta `api/` en la raíz del mismo repo. Vercel las detecta automáticamente junto al site estático.

### Estructura resultante

```
agent-hub/                        ← repo actual (sin cambios en src/)
├── api/                          ← NUEVO — funciones serverless del proxy
│   └── skills/
│       ├── search.js             ← GET /api/skills/search?q=&limit=
│       └── [...path].js          ← GET /api/skills/:owner/:repo/:skill
├── docs/
│   └── web/                      ← web estática (ya desplegada, sin tocar)
│       └── index.html
├── vercel.json                   ← NUEVO — une web estática + funciones
└── src/                          ← Electron (no se despliega en Vercel)
```

### `vercel.json` (raíz del repo)

```json
{
  "outputDirectory": "docs/web",
  "functions": {
    "api/**/*.js": { "runtime": "@vercel/node" }
  }
}
```

### `api/skills/search.js`

```js
import { getVercelOidcToken } from '@vercel/oidc';

export default async function handler(req, res) {
  const { q, limit = 20 } = req.query;
  if (!q) return res.status(400).json({ error: 'q required' });

  const token    = await getVercelOidcToken();
  const upstream = `https://skills.sh/api/v1/skills/search?q=${encodeURIComponent(q)}&limit=${limit}`;
  const r        = await fetch(upstream, { headers: { Authorization: `Bearer ${token}` } });

  res.setHeader('Cache-Control', 's-maxage=60');
  res.status(r.status).json(await r.json());
}
```

### `api/skills/[...path].js`

Catch-all para el detalle de una skill individual (`/vercel-labs/skills/find-skills`):

```js
import { getVercelOidcToken } from '@vercel/oidc';

export default async function handler(req, res) {
  const { path } = req.query; // array: ['vercel-labs', 'skills', 'find-skills']
  const token    = await getVercelOidcToken();
  const joined   = Array.isArray(path) ? path.join('/') : path;
  const upstream = `https://skills.sh/api/v1/skills/${joined}`;
  const r        = await fetch(upstream, { headers: { Authorization: `Bearer ${token}` } });

  res.setHeader('Cache-Control', 's-maxage=300');
  res.status(r.status).json(await r.json());
}
```

### `package.json` en raíz (solo si no existe ya)

Añadir la dependencia del OIDC al `package.json` del repo principal. Si Vercel usa el `package.json` raíz para instalar deps de las funciones, basta con añadir:

```json
"dependencies": {
  "@vercel/oidc": "^1.0.0"
}
```

> Si el `package.json` raíz tiene devDependencies de Electron que no deben instalarse en Vercel, crear un `package.json` propio dentro de `api/` con solo `{ "dependencies": { "@vercel/oidc": "^1.0.0" } }`. Vercel lo detecta y lo usa para las funciones de esa carpeta.

### URLs resultantes

```
https://ao-agent-hub.vercel.app/                          ← web actual (sin cambios)
https://ao-agent-hub.vercel.app/api/skills/search?q=react ← proxy nuevo
https://ao-agent-hub.vercel.app/api/skills/vercel-labs/skills/find-skills
```

### Constante en Agent Hub

En `src/backend/skills.js`:

```js
const SKILLS_PROXY = 'https://ao-agent-hub.vercel.app/api/skills';
```

---

## Parte 2 — Backend (`src/backend/skills.js`)

### Tipos de respuesta

```ts
// Resultado de búsqueda (viene del proxy / skills.sh)
interface SkillResult {
  name:        string;   // nombre de la skill
  slug:        string;   // identificador único dentro del repo
  source:      string;   // owner/repo — ej: "vercel-labs/skills"
  description: string;
  installs:    number;
  url:         string;   // URL de la página en skills.sh
}
```

### Función `searchSkillsDirectory(q, limit = 20)`

```js
async function searchSkillsDirectory(q, limit = 20) {
  const url = `${SKILLS_PROXY}/search?q=${encodeURIComponent(q)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Skills directory error: ${res.status}`);
  const data = await res.json();
  // data.skills o data directamente según respuesta real de la API
  return (data.skills ?? data ?? []).map(s => ({
    name:        s.name   || s.slug,
    slug:        s.slug,
    source:      s.source,
    description: s.description || '',
    installs:    s.installs    || 0,
    url:         `https://skills.sh${s.url || '/' + s.source + '/' + s.slug}`,
  }));
}
```

### Función `fetchSkillDetail(source, slug)`

Llama al proxy de detalle, extrae el `SKILL.md` del array `files[]` y lo parsea:

```js
async function fetchSkillDetail(source, slug) {
  const url = `${SKILLS_PROXY}/${source}/${slug}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Skill not found: ${source}/${slug}`);
  const data = await res.json();

  // data.files = [{ path: 'SKILL.md', contents: '...' }, ...]
  const skillFile = (data.files || []).find(f => f.path.endsWith('SKILL.md'));
  if (!skillFile) throw new Error('SKILL.md not found in response');

  return parseSkillContent(skillFile.contents, data.name || slug);
}
```

### Función `importSkillFromUrl(url)`

Soporta tres formatos de URL:

| Formato | Ejemplo |
|---|---|
| Página de skills.sh | `https://skills.sh/vercel-labs/skills/find-skills` |
| GitHub blob | `https://github.com/owner/repo/blob/main/.../SKILL.md` |
| GitHub raw | `https://raw.githubusercontent.com/owner/repo/main/.../SKILL.md` |

```js
async function importSkillFromUrl(rawUrl) {
  const url = rawUrl.trim();

  // skills.sh page URL → proxy detail
  const skillsShMatch = url.match(/^https:\/\/skills\.sh\/([^/]+\/[^/]+)\/([^/?]+)/);
  if (skillsShMatch) {
    const [, source, slug] = skillsShMatch;
    return fetchSkillDetail(source, slug);
  }

  // GitHub blob URL → convert to raw
  const ghBlobMatch = url.match(/^https:\/\/github\.com\/(.+)\/blob\/(.+)$/);
  if (ghBlobMatch) {
    const rawUrl2 = `https://raw.githubusercontent.com/${ghBlobMatch[1]}/${ghBlobMatch[2]}`;
    return fetchRawSkill(rawUrl2);
  }

  // Raw URL → fetch directly
  if (url.includes('raw.githubusercontent.com')) {
    return fetchRawSkill(url);
  }

  throw new Error('URL no reconocida. Usa una URL de skills.sh o de GitHub.');
}

async function fetchRawSkill(rawUrl) {
  const res = await fetch(rawUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar la skill`);
  const content = await res.text();
  const slug    = rawUrl.split('/').slice(-2, -1)[0] || 'skill-importada';
  return parseSkillContent(content, slug);
}
```

### Función auxiliar `parseSkillContent(markdown, fallbackName)`

Reutiliza la lógica ya existente en `parseSkillFile`, pero desde string:

```js
function parseSkillContent(markdown, fallbackName) {
  const raw   = markdown.replace(/^﻿/, '').replace(/\r/g, '');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { name: fallbackName, description: '', content: raw.trim() };
  }
  const fm   = match[1];
  const body = match[2].trim();
  const nameM = fm.match(/^name:\s*(.+)$/m);
  const descM = fm.match(/^description:\s*(.+)$/m);
  return {
    name:        nameM?.[1]?.trim() || fallbackName,
    description: descM?.[1]?.trim() || '',
    content:     body,
  };
}
```

---

## Parte 2b — Backend (`src/backend/server.js`)

### `GET /api/skills/directory/search`

```js
app.get('/api/skills/directory/search', async (req, res) => {
  const { q, limit } = req.query;
  if (!q?.trim()) return res.status(400).json({ error: 'q required' });
  try {
    const results = await skills.searchSkillsDirectory(q.trim(), Number(limit) || 20);
    res.json(results);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
```

### `POST /api/skills/import-url`

```js
app.post('/api/skills/import-url', async (req, res) => {
  const { url, force = false } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const parsed = await skills.importSkillFromUrl(url);
    if (!force && /* skill ya existe */ fs.existsSync(path.join(SKILLS_DIR, `${parsed.name}.md`))) {
      return res.status(409).json({ error: `La skill "${parsed.name}" ya existe`, existing: parsed });
    }
    force ? skills.updateSkill(parsed) : skills.createSkill(parsed);
    res.json({ skill: parsed });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
```

---

## Parte 3 — Frontend

### `SkillsCenter.tsx` — cambio mínimo

Nueva prop `onOpenDirectory: () => void`. Botón "Directorio" junto a "Nuevo skill":

```tsx
{!searchActive && (
  <>
    <button className="btn sm ghost" onClick={onOpenDirectory}>
      <i className="ti ti-world-download" /> Directorio
    </button>
    <button className="btn sm primary" onClick={onNewSkill}>
      <i className="ti ti-plus" /> Nuevo
    </button>
  </>
)}
```

### `SkillDirectoryModal.tsx` — componente nuevo

Modal 640px con dos tabs: **Buscar** y **Por URL**.

**Props:**
```ts
interface Props {
  onClose:   () => void;
  onImported: (skill: Skill) => void;
}
```

**Estado interno:**
```ts
tab:         'search' | 'url'
query:       string            // input de búsqueda
results:     SkillResult[]
searching:   boolean
importingId: string | null     // slug en curso de importación
urlInput:    string
urlBusy:     boolean
conflict:    { skill: Skill; url: string } | null  // skill ya existe
```

**Layout — Tab Buscar:**
```
┌─────────────────────────────────────────────────┐
│  Buscar   Por URL                               │
│ ─────────────────────────────────────────────── │
│  [ 🔍 react hooks...               ] [Buscar]  │
│ ─────────────────────────────────────────────── │
│  react-patterns             vercel-labs/skills  │
│  Patrones modernos de React 18 con hooks        │
│  ↓ 12.4K installs                  [Importar]  │
│                                                 │
│  nextjs-routing             vercel-labs/skills  │
│  App Router y RSC conventions                   │
│  ↓ 8.2K installs                   [Importar]  │
└─────────────────────────────────────────────────┘
```

**Layout — Tab Por URL:**
```
┌─────────────────────────────────────────────────┐
│  Buscar   Por URL                               │
│ ─────────────────────────────────────────────── │
│  Pega la URL de skills.sh o un fichero GitHub:  │
│  [ https://skills.sh/...                      ] │
│                                     [Importar]  │
│                                                 │
│  Formatos aceptados:                            │
│  · skills.sh/owner/repo/skill-name              │
│  · github.com/owner/repo/blob/main/.../SKILL.md │
│  · raw.githubusercontent.com/...               │
└─────────────────────────────────────────────────┘
```

**Conflicto (skill ya existe):**
Cuando el backend devuelve 409, el modal muestra inline:
> _La skill "react-patterns" ya existe en tu biblioteca. ¿Sobrescribir con la versión del directorio?_
> `[Cancelar]` `[Sobrescribir]`

**Flujo de import (ambas tabs):**
1. `POST /api/skills/import-url { url, force? }`
2. Si 200 → `onImported(skill)` → modal cierra
3. Si 409 → muestra confirmación de sobrescritura → segundo request con `{ force: true }`

### `Agents.tsx` — cambios mínimos

```tsx
const [showSkillDirectory, setShowSkillDirectory] = useState(false);

async function handleSkillImported(skill: Skill) {
  await loadSkills();
  setShowSkillDirectory(false);
  // opcional: seleccionar la skill recién importada
  setSelectedSkill(skill.name);
}
```

Renderizado (junto al `SkillEditor`):
```tsx
{showSkillDirectory && (
  <SkillDirectoryModal
    onClose={() => setShowSkillDirectory(false)}
    onImported={handleSkillImported}
  />
)}
```

`SkillsCenter` recibe `onOpenDirectory={() => setShowSkillDirectory(true)}`.

---

## Flujo completo end-to-end

### Búsqueda e importación

```
Usuario abre modal → tab Buscar
  → escribe "react hooks" → Enter / botón Buscar
  → GET /api/skills/directory/search?q=react+hooks
      → proxy → skills.sh/api/v1/skills/search → resultados
  → muestra lista de skills

Usuario clica [Importar] en "react-patterns"
  → POST /api/skills/import-url { url: "https://skills.sh/vercel-labs/skills/react-patterns" }
      → importSkillFromUrl() → fetchSkillDetail("vercel-labs/skills", "react-patterns")
      → proxy → skills.sh/api/v1/skills/vercel-labs/skills/react-patterns
      → extrae SKILL.md → parseSkillContent()
      → createSkill({ name, description, content })
  → 200 { skill }
  → onImported(skill) → loadSkills() → modal cierra → skill visible en lista
```

### Import por URL

```
Usuario pega "https://github.com/supabase/agent-skills/blob/main/skills/postgres/SKILL.md"
  → POST /api/skills/import-url { url }
      → detecta formato GitHub blob → convierte a raw.githubusercontent.com
      → fetch() → parseSkillContent()
      → createSkill()
  → 200 { skill }
```

---

## Archivos afectados

| Archivo | Tipo de cambio |
|---|---|
| `api/skills/search.js` | Nuevo — función serverless en repo actual |
| `api/skills/[...path].js` | Nuevo — función serverless en repo actual |
| `vercel.json` | Nuevo — une web estática (`docs/web/`) + funciones (`api/`) |
| `src/backend/skills.js` | +5 funciones: `searchSkillsDirectory`, `fetchSkillDetail`, `importSkillFromUrl`, `fetchRawSkill`, `parseSkillContent` |
| `src/backend/server.js` | +2 endpoints: `GET /skills/directory/search`, `POST /skills/import-url` |
| `src/renderer/components/agents/SkillsCenter.tsx` | +prop `onOpenDirectory`, +botón Directorio |
| `src/renderer/components/agents/SkillDirectoryModal.tsx` | Componente nuevo |
| `src/renderer/pages/Agents.tsx` | +estado `showSkillDirectory`, +handler `handleSkillImported` |
| `docs/backend.md` | Actualizar §5b — añadir nuevas funciones y endpoints |
| `docs/frontend.md` | Actualizar §SkillsCenter, añadir §SkillDirectoryModal |

---

## Consideraciones de despliegue

- **Infraestructura:** cero repos nuevos, cero proyectos nuevos en Vercel — todo va en el mismo deploy que la web actual
- **Cuenta Vercel:** gratuita (free tier: 100K invocaciones/mes, suficiente para una app de escritorio)
- **Rate limit skills.sh:** 600 req/min compartidas entre todos los usuarios de Agent Hub a través del proxy — holgado para uso manual interactivo
- **Caché en proxy:** `s-maxage=60` en search, `s-maxage=300` en detail — reduce llamadas a skills.sh ante búsquedas repetidas
- **Colisión con `package.json` de Electron:** si Vercel intenta instalar las deps de Electron al desplegar, crear `api/package.json` independiente con solo `@vercel/oidc`. Vercel lo usa para las funciones sin tocar el `package.json` raíz
- **Abuso del proxy:** la URL es pública. Si se convierte en problema, añadir un header secreto (`X-Agent-Hub-Key`) verificado en el proxy y hardcodeado en Agent Hub
