# Guía para desarrolladores de scripts externos

> Agent Hub — Scripts de orquestación personalizados
> Versión del motor: **2.2.0** · Fecha: 2026-06-04

Esta guía cubre la creación de scripts determinísticos avanzados para usar como pasos en orquestaciones de Agent Hub. Se asume conocimiento de Node.js y familiaridad con el concepto de orquestaciones de la app.

---

## Índice

1. [Cómo funciona un script en una orquestación](#1-cómo-funciona-un-script-en-una-orquestación)
2. [Estructura mínima](#2-estructura-mínima)
3. [El objeto `context`](#3-el-objeto-context)
4. [El objeto `fs` (filesystem seguro)](#4-el-objeto-fs-filesystem-seguro)
5. [Trabajar con resultados de pasos anteriores](#5-trabajar-con-resultados-de-pasos-anteriores)
6. [Devolver datos estructurados](#6-devolver-datos-estructurados)
7. [Timeout y scripts de larga duración](#7-timeout-y-scripts-de-larga-duración)
8. [Errores y casos de fallo](#8-errores-y-casos-de-fallo)
9. [El sandbox: qué puedes y qué no puedes hacer](#9-el-sandbox-qué-puedes-y-qué-no-puedes-hacer)
10. [Ejemplos completos](#10-ejemplos-completos)
11. [Depuración](#11-depuración)
12. [Convenciones recomendadas](#12-convenciones-recomendadas)

---

## 1. Cómo funciona un script en una orquestación

Un script es un paso de orquestación sin IA. Se ejecuta de forma síncrona o asíncrona, recibe el contexto de ejecución (proyecto, resultados anteriores, metadatos) y devuelve un resultado que el siguiente paso puede leer.

```
[Agente A] → [__script:mi-script] → [Agente B]
               ↑
               Lee el output de A
               Escribe archivos si necesita
               Devuelve datos para B
```

Los scripts son ideales para:
- Validar o transformar el output de un agente antes de pasarlo al siguiente.
- Leer, escribir o analizar archivos del proyecto sin consumir tokens.
- Preparar contexto estructurado (índices, listas de archivos, checksums).
- Comprobar condiciones del entorno (existencia de archivos, formato de código, tests).

---

## 2. Estructura mínima

Crea un fichero `.js` en la carpeta `user-scripts/` de Agent Hub (normalmente junto al ejecutable):

```
AgentHub/
└── user-scripts/
    └── mi-script.js
```

Contenido mínimo:

```js
exports.label       = 'Mi primer script';
exports.description = 'Descripción breve que aparece en la paleta.';

exports.run = async (context) => {
  return {
    output:        'Script ejecutado correctamente.',
    filesModified: [],
  };
};
```

La app detecta el fichero automáticamente al cargar `GET /api/scripts`. No hace falta reiniciar.

### Campos exportados

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `label` | `string` | Sí | Nombre visible en la paleta y el lienzo |
| `description` | `string` | Sí | Descripción visible en la paleta |
| `run` | `async function` | Sí | Función de ejecución |
| `timeout` | `number` | No | Timeout en ms para este script (ver §7) |

---

## 3. El objeto `context`

`run` recibe un único argumento `context` con todo lo que el script puede necesitar:

```js
exports.run = async ({
  projectPath,      // string  — ruta absoluta del proyecto en disco
  stepIndex,        // number  — índice del paso actual (0-based)
  prevResult,       // StepResult | null — resultado del paso inmediatamente anterior
  agentOutputs,     // StepResult[]     — todos los resultados anteriores (indexados)
  orchestration,    // object           — metadatos de la orquestación
  fs,               // object           — API de filesystem segura (ver §4)
  path,             // object           — node:path completo
}) => {
  // ...
};
```

### `orchestration`

```js
{
  id:          'orch-abc123',
  name:        'Pipeline de refactor',
  description: '...',
  agents:      ['refactor-expert', '__script:validate-json', 'doc-writer'],
}
```

### `StepResult`

Estructura de cada elemento en `agentOutputs` (y de `prevResult`):

```js
{
  stepIndex:     0,
  agentName:     'refactor-expert',
  output: {
    response:  'He refactorizado los siguientes archivos...',  // texto del agente
    handoff:   { done: '...', changed: [...], next: '...' },   // si el agente lo incluyó
  },
  filesModified: ['src/utils.ts', 'src/index.ts'],
  tokensUsed:    { input: 1200, output: 450 },
  estimatedCost: 0.009,
  duration:      8420,   // ms
  status:        'success',  // 'success' | 'error' | 'warning'
  qualityScore:  { score: 87, grade: 'green', ... },
}
```

---

## 4. El objeto `fs` (filesystem seguro)

`context.fs` es un wrapper seguro sobre `node:fs` que restringe todas las operaciones al directorio del proyecto. Todas las rutas son **relativas a `projectPath`**.

```js
// Leer un fichero como string UTF-8
const content = await fs.readFile('src/index.ts');

// Escribir (crea directorios intermedios si no existen)
await fs.writeFile('reports/analysis.txt', 'Resultado...');

// Comprobar si existe
const exists = await fs.exists('package.json');  // → true | false

// Listar directorio
const entries = await fs.listDir('src');  // → ['index.ts', 'utils.ts', ...]

// Leer JSON
const pkg = await fs.readJSON('package.json');  // → objeto JS

// Escribir JSON (pretty-print automático)
await fs.writeJSON('reports/result.json', { score: 95 });
```

### Restricciones del `fs`

- Rutas con `..` que saldrían de `projectPath` lanzan `Error: ruta fuera del proyecto`.
- No hay acceso a rutas absolutas — solo relativas.
- Los directorios del sistema (`.git`, `node_modules`) se pueden leer pero **no** escribir.

Si necesitas leer un fichero fuera del proyecto (p.ej. una configuración global), no es posible desde un script externo — es una restricción de diseño deliberada.

---

## 5. Trabajar con resultados de pasos anteriores

### Leer el output del agente anterior

```js
exports.run = async ({ prevResult }) => {
  if (!prevResult || prevResult.status === 'error') {
    return { output: 'Sin resultado previo válido.', filesModified: [] };
  }

  const agentResponse = prevResult.output.response;
  // agentResponse es el texto completo que el agente escribió
  // ...
};
```

### Leer el output de un paso específico

```js
exports.run = async ({ agentOutputs }) => {
  const paso2 = agentOutputs[1];  // índice 0-based
  if (!paso2) return { output: 'Paso 2 no disponible.', filesModified: [] };

  const filesModifiedInStep2 = paso2.filesModified;
  // ...
};
```

### Extraer JSON del output de un agente

Los agentes pueden devolver JSON embebido en su respuesta. Patrón de extracción robusto:

```js
function extractJSON(text) {
  const match = text.match(/```json\s*([\s\S]*?)```/) ||
                text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!match) return null;
  try { return JSON.parse(match[1] || match[0]); }
  catch { return null; }
}

exports.run = async ({ prevResult }) => {
  const parsed = extractJSON(prevResult?.output?.response || '');
  if (!parsed) {
    return { output: 'El agente no devolvió JSON válido.', filesModified: [], data: { valid: false } };
  }
  // usar parsed...
};
```

### Leer archivos modificados por un agente

```js
exports.run = async ({ prevResult, fs }) => {
  const modified = prevResult?.filesModified ?? [];
  const contents = {};

  for (const relPath of modified) {
    const exists = await fs.exists(relPath);
    if (exists) {
      contents[relPath] = await fs.readFile(relPath);
    }
  }

  return {
    output:        `Leídos ${Object.keys(contents).length} archivos.`,
    filesModified: [],
    data:          { contents },
  };
};
```

---

## 6. Devolver datos estructurados

El campo `data` del resultado es libre y lo pueden leer los pasos posteriores a través de `agentOutputs[i].data` (disponible también en el paso del script en `prevResult.data` si el siguiente paso es un agente — el motor lo serializa en el prompt del agente como contexto adicional).

```js
exports.run = async ({ fs }) => {
  const pkg    = await fs.readJSON('package.json');
  const result = {
    name:         pkg.name,
    version:      pkg.version,
    dependencies: Object.keys(pkg.dependencies || {}),
    devDeps:      Object.keys(pkg.devDependencies || {}),
  };

  return {
    output:        `Proyecto: ${result.name} v${result.version}. ${result.dependencies.length} dependencias.`,
    filesModified: [],
    data:          result,  // el agente siguiente puede leer esto en su contexto
  };
};
```

---

## 7. Timeout y scripts de larga duración

Por defecto el motor aplica el timeout global configurado en Agent Hub (60s). Si tu script necesita más tiempo, decláralo explícitamente:

```js
exports.timeout = 180_000;  // 3 minutos
exports.label   = 'Análisis profundo de dependencias';
exports.run     = async (context) => { /* ... */ };
```

**Límite máximo absoluto:** 5 minutos (300 000 ms). Valores mayores se recortan silenciosamente.

### Estrategias para scripts lentos

Si tu script procesa muchos archivos, divide el trabajo para que sea cancelable antes del timeout:

```js
exports.run = async ({ projectPath, fs }) => {
  const entries = await fs.listDir('src');
  const results = [];

  for (const entry of entries) {
    // Procesar de uno en uno — permite que el timeout interrumpa entre iteraciones
    const content = await fs.readFile(`src/${entry}`);
    results.push(analyze(content));
  }

  return { output: JSON.stringify(results), filesModified: [] };
};
```

---

## 8. Errores y casos de fallo

### Lanzar un error deliberado

```js
exports.run = async ({ prevResult }) => {
  if (prevResult?.status !== 'success') {
    throw new Error('El paso anterior falló. No puedo continuar.');
  }
  // ...
};
```

El motor captura el error, marca el paso como `error` y (dependiendo de la configuración de la orquestación) puede abortar o continuar.

### Devolver un warning sin abortar

Si quieres indicar un problema pero permitir que la orquestación continúe, devuelve el error en `data` y usa `output` descriptivo:

```js
exports.run = async ({ fs }) => {
  const exists = await fs.exists('package.json');
  if (!exists) {
    return {
      output:        'ADVERTENCIA: no se encontró package.json.',
      filesModified: [],
      data:          { warning: 'missing-package-json' },
    };
  }
  // ...
};
```

### Errores comunes y sus causas

| Error | Causa probable |
|---|---|
| `ReferenceError: require is not defined` | Intentaste usar `require()` — no está disponible en el sandbox |
| `Error: ruta fuera del proyecto` | La ruta pasada a `fs.*` sale de `projectPath` |
| `Error: timeout` | El script tardó más del timeout configurado |
| `SyntaxError` al cargar | El fichero `.js` tiene un error de sintaxis — revisa con `node mi-script.js` |
| `Error: Script sin exports.run` | Falta la función `run` en el fichero |

---

## 9. El sandbox: qué puedes y qué no puedes hacer

### Disponible

```js
// Matemáticas y fecha
const now   = new Date();
const rand  = Math.random();
const bytes = Math.ceil(size / 1024);

// Operaciones de array/objeto
const sorted   = files.sort((a, b) => a.localeCompare(b));
const filtered = items.filter(x => x.ext === '.ts');
const grouped  = items.reduce((acc, x) => { ... }, {});

// JSON
const obj  = JSON.parse(text);
const text = JSON.stringify(obj, null, 2);

// Promesas y async/await
const results = await Promise.all(items.map(async item => { ... }));

// Consola (redirigida a logs de orquestación)
console.log('Procesando:', fileName);
console.error('Algo salió mal:', err.message);

// path (node:path completo)
const ext  = path.extname('archivo.ts');   // → '.ts'
const base = path.basename('src/foo.ts');  // → 'foo.ts'
const rel  = path.relative(base, full);
```

### No disponible

```js
// ❌ require — no existe en el sandbox
const fs = require('fs');  // ReferenceError

// ❌ fetch / http — sin acceso a red
fetch('https://api.ejemplo.com');  // ReferenceError

// ❌ process — sin acceso a variables de entorno ni control de proceso
process.env.SECRET_KEY;  // ReferenceError

// ❌ child_process — sin ejecución de comandos
const { exec } = require('child_process');  // ReferenceError

// ❌ acceso fuera del proyecto via fs
await fs.readFile('../../config.json');  // Error: ruta fuera del proyecto
```

---

## 10. Ejemplos completos

### 10.1 Contar líneas de código por extensión

```js
exports.label       = 'Contador de líneas';
exports.description = 'Cuenta líneas de código por extensión de archivo.';

exports.run = async ({ fs }) => {
  const entries = await fs.listDir('src');
  const counts  = {};

  async function processDir(dir) {
    const items = await fs.listDir(dir).catch(() => []);
    for (const item of items) {
      const relPath = dir ? `${dir}/${item}` : item;
      const isDir   = !item.includes('.');  // heurística simple
      if (isDir) {
        await processDir(relPath);
      } else {
        const ext     = item.split('.').pop() || 'sin-ext';
        const content = await fs.readFile(relPath).catch(() => '');
        const lines   = content.split('\n').length;
        counts[ext]   = (counts[ext] || 0) + lines;
      }
    }
  }

  await processDir('src');

  const total   = Object.values(counts).reduce((a, b) => a + b, 0);
  const summary = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([ext, n]) => `  .${ext}: ${n} líneas`)
    .join('\n');

  return {
    output:        `Total: ${total} líneas\n${summary}`,
    filesModified: [],
    data:          { counts, total },
  };
};
```

### 10.2 Validar que el agente anterior modificó los archivos esperados

```js
exports.label       = 'Verificar archivos modificados';
exports.description = 'Comprueba que el agente anterior tocó los archivos requeridos.';

const REQUIRED_FILES = ['src/index.ts', 'src/types.ts'];

exports.run = async ({ prevResult }) => {
  const modified = prevResult?.filesModified ?? [];
  const missing  = REQUIRED_FILES.filter(f => !modified.includes(f));

  if (missing.length > 0) {
    throw new Error(`El agente no modificó los archivos requeridos: ${missing.join(', ')}`);
  }

  return {
    output:        `Verificación correcta. Archivos requeridos presentes: ${REQUIRED_FILES.join(', ')}`,
    filesModified: [],
    data:          { verified: true },
  };
};
```

### 10.3 Generar un informe en Markdown y guardarlo

```js
exports.label       = 'Generar informe de orquestación';
exports.description = 'Escribe un resumen Markdown con los resultados de todos los pasos.';

exports.run = async ({ agentOutputs, orchestration, fs }) => {
  const lines = [
    `# Informe: ${orchestration.name}`,
    `> Generado: ${new Date().toLocaleString('es-ES')}`,
    '',
  ];

  for (const step of agentOutputs) {
    const status = step.status === 'success' ? '✓' : '✗';
    lines.push(`## ${status} Paso ${step.stepIndex + 1} — ${step.agentName}`);
    lines.push('');
    lines.push('**Archivos modificados:**');
    if (step.filesModified.length > 0) {
      step.filesModified.forEach(f => lines.push(`- \`${f}\``));
    } else {
      lines.push('_Ninguno_');
    }
    lines.push('');
    lines.push('**Resumen del output:**');
    lines.push(step.output.response.slice(0, 300) + (step.output.response.length > 300 ? '...' : ''));
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  const reportPath = `.agent-hub/reports/${orchestration.id}-report.md`;
  await fs.writeFile(reportPath, lines.join('\n'));

  return {
    output:        `Informe generado en ${reportPath}`,
    filesModified: [reportPath],
    data:          { reportPath },
  };
};
```

### 10.4 Script con timeout extendido para análisis pesado

```js
exports.label       = 'Análisis de dependencias circulares';
exports.description = 'Detecta importaciones circulares en el proyecto TypeScript.';
exports.timeout     = 120_000;  // 2 minutos

exports.run = async ({ fs, path }) => {
  const srcFiles = [];

  async function walk(dir) {
    const items = await fs.listDir(dir).catch(() => []);
    for (const item of items) {
      const rel = `${dir}/${item}`;
      if (item.endsWith('.ts') || item.endsWith('.tsx')) {
        srcFiles.push(rel);
      } else if (!item.includes('.')) {
        await walk(rel);
      }
    }
  }

  await walk('src');

  const importMap = {};
  for (const file of srcFiles) {
    const content = await fs.readFile(file).catch(() => '');
    const imports = [...content.matchAll(/from ['"](\.[^'"]+)['"]/g)]
      .map(m => m[1]);
    importMap[file] = imports;
  }

  // Detección simple de ciclos (DFS)
  const cycles = [];
  function dfs(node, visited = new Set(), stack = []) {
    if (stack.includes(node)) { cycles.push([...stack, node]); return; }
    if (visited.has(node)) return;
    visited.add(node);
    stack.push(node);
    for (const dep of (importMap[node] || [])) {
      dfs(dep, visited, [...stack]);
    }
  }
  srcFiles.forEach(f => dfs(f));

  const output = cycles.length > 0
    ? `Se detectaron ${cycles.length} ciclos de importación.\n` + cycles.map(c => c.join(' → ')).join('\n')
    : 'Sin dependencias circulares detectadas.';

  return { output, filesModified: [], data: { cycles, srcFiles: srcFiles.length } };
};
```

---

## 11. Depuración

### Validador integrado en la app

Agent Hub incluye un validador estático accesible desde **Ajustes → General → Scripts personalizados → Validar scripts**. Analiza todos los ficheros de la carpeta `user-scripts/` sin ejecutarlos y reporta:

- **✓ Correcto** — el script carga y cumple todos los requisitos.
- **⚠ Advertencia** — carga y funciona, pero hay algo ajustable (p.ej. timeout demasiado alto).
- **✗ Error** — el script no se cargará en la paleta. Se muestra el motivo exacto.

Úsalo después de crear o modificar un script antes de añadirlo a una orquestación.

### Probar el script fuera de la app

Para verificar que el fichero no tiene errores de sintaxis antes de abrir la app:

```powershell
node -e "require('./user-scripts/mi-script.js'); console.log('OK')"
```

Ten en cuenta que `require` sí existe cuando ejecutas directamente con Node — solo está bloqueado dentro del sandbox de la app. Los errores de lógica que dependen del contexto de ejecución (acceso a `fs`, `prevResult`, etc.) solo se detectan ejecutando el script en una orquestación real.

### Ver logs en tiempo de ejecución

`console.log` y `console.error` dentro del script se redirigen a los logs de la orquestación. Son visibles en el panel de ejecución si hay algún error, y siempre en el fichero `logs.jsonl` dentro de `.agent-hub/`.

### Errores de carga silenciosos

Si el validador no detecta el script, comprueba:
1. Que el fichero tiene extensión `.js` (no `.mjs`, no `.ts`).
2. Que está directamente en `user-scripts/` y no en un subdirectorio.
3. Que usa `exports.xxx = ...` (CommonJS), no `export default`.

---

## 12. Convenciones recomendadas

- **Nombrar el fichero en kebab-case**: `validate-output.js`, `generate-report.js`.
- **`output` siempre informativo**: el texto de `output` aparece en el panel de ejecución — que sea legible para el usuario, no solo para el siguiente agente.
- **`data` para comunicación entre pasos**: usa `output` para humanos, `data` para máquinas.
- **No asumir que `prevResult` existe**: siempre comprueba `prevResult?.output?.response` con optional chaining.
- **No modificar `.git/`**: aunque el filesystem no lo bloquea explícitamente para lectura, escribir en `.git/` puede corromper el repositorio.
- **Documentar los campos de `data`**: si el script devuelve un objeto complejo en `data`, añade un comentario con su estructura — los agentes posteriores usarán esa información en su prompt.
