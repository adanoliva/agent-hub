# Scripts externos en orquestaciones — Diseño técnico

> Estado: **borrador** · Fecha: 2026-06-04
> Afecta a: `src/backend/scripts-registry.js`, `src/backend/config.js`, `src/backend/server.js`

---

## 1. Objetivo

Permitir que el usuario cree scripts determinísticos personalizados (sin llamadas a IA) para usar como pasos en sus orquestaciones, sin modificar el código fuente de la aplicación.

Los scripts built-in (`prepare-context`, `quality-score`, etc.) no cambian. Los scripts externos conviven con ellos y aparecen en la misma paleta del editor de orquestaciones.

---

## 2. Localización en disco

```
APP_DIR/
└── user-scripts/
    ├── mi-script.js
    ├── lint-checker.js
    └── notify-webhook.js
```

- La carpeta `user-scripts/` se crea automáticamente en `bootstrapDirectories()` si no existe.
- Los ficheros deben tener extensión `.js`.
- El nombre del fichero (sin extensión) es el identificador del script.
- Los scripts built-in no se pueden sobreescribir: si un fichero externo tiene el mismo nombre que uno interno, el interno tiene prioridad y se emite un aviso en los logs.

---

## 3. Contrato del script externo

Un script externo es un fichero `.js` CommonJS que exporta tres campos:

```js
// APP_DIR/user-scripts/mi-script.js

exports.label       = 'Mi script personalizado';           // requerido — nombre en UI
exports.description = 'Hace algo específico al proyecto';  // requerido — descripción en UI

exports.run = async (context) => {
  const { projectPath, prevResult, stepIndex, agentOutputs } = context;

  // ... lógica determinística ...

  return {
    output:        'Texto de resultado',  // requerido — string
    filesModified: ['ruta/relativa.txt'], // requerido — array (puede ser vacío)
    data:          { cualquier: 'cosa' }, // opcional — objeto serializable
  };
};
```

### 3.1 Objeto `context` disponible

| Campo | Tipo | Descripción |
|---|---|---|
| `projectPath` | `string` | Ruta absoluta del proyecto |
| `stepIndex` | `number` | Índice del paso actual (0-based) |
| `prevResult` | `StepResult \| null` | Resultado del paso anterior |
| `agentOutputs` | `StepResult[]` | Todos los resultados anteriores |
| `orchestration` | `object` | Metadatos de la orquestación |
| `fs` | `object` | Subset seguro de `node:fs` (ver §4.3) |
| `path` | `object` | `node:path` completo |

### 3.2 Valor de retorno requerido

```ts
interface ScriptResult {
  output:        string;     // visible en el panel de ejecución
  filesModified: string[];   // rutas relativas al projectPath
  data?:         unknown;    // datos estructurados para pasos posteriores
}
```

Si `run` lanza una excepción, el paso se marca como `error` y la orquestación puede continuar o abortar según la configuración.

---

## 4. Sandbox VM

Los scripts externos se ejecutan dentro de un sandbox del módulo `node:vm` de Node.js. El objetivo es limitar el acceso accidental a APIs peligrosas, no garantizar aislamiento criptográfico.

### 4.1 Lo que el sandbox **bloquea**

| API | Motivo |
|---|---|
| `require` | Impide cargar módulos arbitrarios del sistema |
| `process` | Bloquea acceso a variables de entorno, stdin/stdout, `exit()` |
| `global` | Evita escapar del contexto vm |
| Módulos de red (`http`, `https`, `fetch`, `net`) | Sin exfiltración de datos |
| `child_process` | Sin ejecución de comandos de sistema |
| `eval` / `Function` | Sin generación dinámica de código |

### 4.2 Lo que el sandbox **permite**

| API | Alcance |
|---|---|
| `fs` (restringido) | Solo operaciones dentro de `projectPath` (ver §4.3) |
| `path` | Completo — es puro, sin efectos secundarios |
| `JSON` | Completo |
| `console` | Solo `.log` y `.error` — redirigidos a los logs de orquestación |
| Primitivas JS | `Math`, `Date`, `Array`, `Object`, `Promise`, etc. |
| `context` | El objeto de ejecución completo (ver §3.1) |

### 4.3 API `fs` restringida

Se expone un objeto `fs` proxy que valida que cada ruta apunte dentro de `projectPath` antes de ejecutar la operación real. Las rutas con `..` que saldrían del proyecto son rechazadas con un error.

Operaciones permitidas:

```js
fs.readFile(relPath)          // → Promise<string>  (UTF-8)
fs.writeFile(relPath, data)   // → Promise<void>
fs.exists(relPath)            // → Promise<boolean>
fs.listDir(relPath)           // → Promise<string[]>
fs.readJSON(relPath)          // → Promise<object>
fs.writeJSON(relPath, data)   // → Promise<void>  (pretty-print)
```

Todas las rutas son relativas a `projectPath`. Intentar leer `/etc/passwd` o `../../config.json` lanza `Error: ruta fuera del proyecto`.

### 4.4 Timeout

El timeout se resuelve en dos niveles, de más específico a más general:

1. **Override por script** — el fichero puede declarar `exports.timeout = 120_000` (en ms). Si está presente, tiene prioridad absoluta.
2. **Timeout global** — valor configurable en `config.json` bajo `externalScriptsTimeoutMs`. Por defecto: **60 000 ms (60s)**.

```js
// Ejemplo: script que necesita más tiempo
exports.timeout = 120_000;  // 2 minutos
exports.label   = 'Análisis completo de dependencias';
exports.run     = async (context) => { /* ... */ };
```

Si el script no resuelve en el tiempo asignado, se rechaza con `Error: timeout` y el paso se marca como error recuperable. El timeout máximo absoluto permitido (independientemente de lo que declare el script) es **5 minutos** — cualquier valor mayor se recorta silenciosamente a ese límite.

### 4.5 Implementación del sandbox

```js
const vm = require('node:vm');

async function runInSandbox(code, context, { timeout = 30_000 } = {}) {
  const sandbox = buildSandbox(context);          // §4.2
  vm.createContext(sandbox);
  const wrapped = `(async () => { ${code} })()`;
  const script  = new vm.Script(wrapped, { filename: context.scriptName });
  const promise = script.runInContext(sandbox, { timeout });
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout)),
  ]);
}
```

---

## 5. Carga de scripts externos en `scripts-registry.js`

### 5.1 Flujo de carga

```
loadExternalScripts()  ← llamado al arrancar el servidor y en GET /scripts
  │
  ├── leer APP_DIR/user-scripts/*.js
  ├── para cada fichero:
  │   ├── si nombre coincide con built-in → log warn, saltar
  │   ├── require(fichero) → validar exports { label, description, run }
  │   ├── si inválido → log error, saltar (la app sigue funcionando)
  │   └── registrar en EXTERNAL_SCRIPTS[name]
  └── devolver { loaded: N, errors: [...] }
```

### 5.2 Recarga en caliente

`GET /scripts` llama a `loadExternalScripts()` antes de construir la respuesta. Esto permite que el usuario añada un nuevo fichero `.js` a la carpeta y lo vea en la paleta sin reiniciar la app.

### 5.3 Prioridad de nombres

```
built-in SCRIPTS  >  EXTERNAL_SCRIPTS
```

Si un script externo tiene el mismo nombre que uno built-in, el externo se ignora. El endpoint `GET /scripts` devuelve un campo `warnings: string[]` con los conflictos detectados.

---

## 6. Cambios en la API

### `GET /api/scripts`

Respuesta ampliada:

```json
{
  "scripts": [
    { "name": "prepare-context", "label": "Preparar contexto", "description": "...", "builtin": true },
    { "name": "mi-script",       "label": "Mi script",         "description": "...", "builtin": false }
  ],
  "warnings": []
}
```

El campo `builtin` permite a la UI diferenciar visualmente los scripts built-in de los externos.

### `GET /api/scripts/validate`

Ejecuta el validador estático sobre todos los ficheros de `APP_DIR/user-scripts/` y devuelve un informe por script. No ejecuta ningún `run` — solo analiza la estructura del fichero.

```json
{
  "validatedAt": "2026-06-04T10:00:00Z",
  "summary": { "ok": 2, "warn": 1, "error": 1 },
  "results": [
    {
      "file":   "mi-script.js",
      "name":   "mi-script",
      "status": "ok",
      "issues": []
    },
    {
      "file":   "lint-checker.js",
      "name":   "lint-checker",
      "status": "warn",
      "issues": [
        { "severity": "warn", "code": "TIMEOUT_HIGH", "message": "exports.timeout (400000) supera el máximo permitido (300000). Se usará 300000 ms." }
      ]
    },
    {
      "file":   "broken.js",
      "name":   "broken",
      "status": "error",
      "issues": [
        { "severity": "error", "code": "SYNTAX_ERROR", "message": "SyntaxError: Unexpected token '}' (línea 12)" }
      ]
    },
    {
      "file":   "quality-score.js",
      "name":   "quality-score",
      "status": "error",
      "issues": [
        { "severity": "error", "code": "NAME_CONFLICT", "message": "El nombre 'quality-score' está reservado por un script built-in." }
      ]
    }
  ]
}
```

### Códigos de issue

| Código | Severidad | Condición |
|---|---|---|
| `SYNTAX_ERROR` | `error` | El fichero no parsea como JS válido |
| `MISSING_LABEL` | `error` | `exports.label` no existe o no es string |
| `MISSING_DESCRIPTION` | `error` | `exports.description` no existe o no es string |
| `MISSING_RUN` | `error` | `exports.run` no existe |
| `RUN_NOT_FUNCTION` | `error` | `exports.run` existe pero no es función |
| `NAME_CONFLICT` | `error` | El nombre colisiona con un built-in |
| `TIMEOUT_NOT_NUMBER` | `warn` | `exports.timeout` existe pero no es número |
| `TIMEOUT_HIGH` | `warn` | `exports.timeout` supera el máximo de 300 000 ms |
| `LABEL_EMPTY` | `warn` | `exports.label` es un string vacío |
| `DESCRIPTION_EMPTY` | `warn` | `exports.description` es un string vacío |

Un script con cualquier issue de severidad `error` no se carga en la paleta. Los de severidad `warn` sí se cargan pero con comportamiento ajustado (p.ej. timeout recortado al máximo).

### No hay endpoints nuevos de CRUD

Los scripts externos se gestionan directamente en el sistema de archivos. La app no proporciona un editor de scripts — el usuario edita los `.js` con su editor habitual.

---

## 7. Cambios en la UI

### 7.1 Paleta de orquestaciones (`OrchestrationEditor.tsx`)

La sección de scripts de la paleta se divide en dos grupos:

```
── Scripts ──────────────────────────────
  [prepare-context]   Preparar contexto
  [quality-score]     Quality Score
  ...

── Scripts personalizados ───────────────
  [mi-script]         Mi script
  [lint-checker]      Lint checker  ⚠
```

Si no hay scripts externos, el segundo grupo no se muestra. Los scripts externos tienen un badge distinto en el lienzo (`model-script-external`) para distinguirlos visualmente. Si un script tiene issues de tipo `warn`, muestra un icono `⚠` junto al nombre en la paleta.

### 7.2 Panel de validación (`Settings.tsx`)

En la pestaña **General** de Ajustes se añade una sección **Scripts personalizados** con:

- Ruta de la carpeta `user-scripts/` en disco (con botón para abrirla en el explorador).
- Botón **"Validar scripts"** — llama a `GET /api/scripts/validate` y muestra el informe inline.
- Resultado por script con icono de estado (`✓` / `⚠` / `✗`), nombre del fichero y lista de issues expandible.
- Resumen numérico: `2 correctos · 1 advertencia · 1 error`.

El validador **no se ejecuta automáticamente** al abrir Ajustes — solo cuando el usuario pulsa el botón, para evitar I/O innecesario.

---

## 8. Gestión de errores

| Escenario | Comportamiento |
|---|---|
| Fichero `.js` con sintaxis inválida | Se ignora al cargar; error en logs; no bloquea la app |
| Script sin `exports.run` | Se ignora al cargar; warning en `GET /scripts` |
| Script que lanza excepción en ejecución | Paso marcado `error`; mensaje de error visible en el panel |
| Script que supera el timeout | Paso marcado `error` con mensaje "timeout (30s)" |
| Script que intenta acceder fuera de `projectPath` | Excepción sincróna: "ruta fuera del proyecto" |
| Script que intenta usar `require` | `ReferenceError: require is not defined` (no disponible en sandbox) |

---

## 9. Restricciones y no-objetivos

- **Sin sandbox criptográfico**: `node:vm` no es una sandbox de seguridad total. Un script malicioso con suficiente conocimiento puede escapar. El objetivo es prevenir errores accidentales, no ataques deliberados.
- **Sin editor integrado**: la app no proporciona un editor de scripts. El fichero `.js` se edita externamente.
- **Sin versionado de scripts externos**: no hay hash ni control de versiones para los scripts del usuario.
- **Sin soporte para ESM**: los scripts externos deben usar CommonJS (`exports.run = ...`), no `export default`.

---

## 10. Ficheros afectados

| Fichero | Cambio |
|---|---|
| `src/backend/config.js` | `bootstrapDirectories` crea `APP_DIR/user-scripts/` |
| `src/backend/scripts-registry.js` | `loadExternalScripts()`, `validateExternalScripts()`, `runInSandbox()`, `buildSandbox()`, ajuste de `run()` y `listScripts()` |
| `src/backend/server.js` | `GET /api/scripts` devuelve `{ scripts, warnings }`; nuevo `GET /api/scripts/validate` |
| `src/renderer/components/orchestrations/OrchestrationEditor.tsx` | Paleta con dos grupos + badge `builtin` + icono `⚠` en scripts con warnings |
| `src/renderer/pages/Settings.tsx` | Sección "Scripts personalizados" con botón validar e informe inline |
| `docs/backend.md` | Actualizar §12b |
