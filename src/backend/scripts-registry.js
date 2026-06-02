/**
 * scripts-registry.js — Deterministic Node.js scripts for orchestrations.
 * No AI calls. Each script receives an execution context and returns a ScriptResult.
 */

const fs   = require('fs');
const path = require('path');
const { ensureDir } = require('./config');

// ── Helpers ───────────────────────────────────────────────────────────────────

function walkProject(projectPath, maxDepth = 5, depth = 0) {
  const excluded = new Set([
    '.git', 'node_modules', '.next', 'dist', 'build', 'coverage',
    '.agent-hub', '__pycache__', '.venv', 'venv', '.turbo', 'out', '.cache',
  ]);
  const results = [];
  if (depth > maxDepth) return results;
  try {
    const entries = fs.readdirSync(projectPath, { withFileTypes: true });
    for (const e of entries) {
      if (excluded.has(e.name) || (e.name.startsWith('.') && e.isDirectory())) continue;
      const full = path.join(projectPath, e.name);
      if (e.isDirectory()) {
        results.push(...walkProject(full, maxDepth, depth + 1).map(r => ({
          ...r,
          path: e.name + '/' + r.path,
        })));
      } else if (e.isFile()) {
        try {
          const stat = fs.statSync(full);
          results.push({
            path:     e.name,
            size:     stat.size,
            ext:      path.extname(e.name).toLowerCase(),
            modified: stat.mtime.toISOString(),
          });
        } catch {}
      }
    }
  } catch {}
  return results;
}

function detectConventions(files) {
  const exts = files.map(f => f.ext);
  const names = files.map(f => f.path);
  const hasExt = (e) => exts.includes(e);
  const hasName = (n) => names.some(p => p.includes(n));

  let primaryLanguage = 'unknown';
  if (hasExt('.ts') || hasExt('.tsx'))      primaryLanguage = 'typescript';
  else if (hasExt('.js') || hasExt('.jsx')) primaryLanguage = 'javascript';
  else if (hasExt('.py'))                   primaryLanguage = 'python';
  else if (hasExt('.rs'))                   primaryLanguage = 'rust';
  else if (hasExt('.go'))                   primaryLanguage = 'go';
  else if (hasExt('.java'))                 primaryLanguage = 'java';

  const hasTests = hasName('.test.') || hasName('.spec.') || hasName('__tests__');
  let testPattern = null;
  if (hasExt('.ts') || hasExt('.tsx')) testPattern = '**/*.test.ts';
  else if (hasExt('.js'))              testPattern = '**/*.test.js';
  else if (hasExt('.py'))              testPattern = 'test_*.py';

  let framework = null;
  if (hasName('next.config'))           framework = 'next';
  else if (hasName('vite.config'))      framework = 'vite';
  else if (hasName('angular.json'))     framework = 'angular';
  else if (hasName('vue.config'))       framework = 'vue';
  else if (hasName('package.json') && (hasExt('.tsx') || hasExt('.jsx'))) framework = 'react';

  return { primaryLanguage, hasTests, testPattern, framework };
}

// ── Script implementations ────────────────────────────────────────────────────

const SCRIPTS = {

  'prepare-context': async ({ projectPath, orchestration }) => {
    const files = walkProject(projectPath);
    const conventions = detectConventions(files);
    const contextDir  = path.join(projectPath, '.agent-hub', 'context');
    ensureDir(contextDir);

    const canonical = {
      generatedAt:         new Date().toISOString(),
      projectFiles:        files.slice(0, 500),
      detectedConventions: conventions,
      orchestrationScope:  orchestration.agents || [],
      previousOutputs:     [],
    };

    const canonicalPath = path.join(contextDir, 'canonical.json');
    fs.writeFileSync(canonicalPath, JSON.stringify(canonical, null, 2), 'utf8');

    const summary = [
      `Proyecto analizado: ${files.length} archivos detectados.`,
      `Lenguaje principal: ${conventions.primaryLanguage}`,
      conventions.framework ? `Framework: ${conventions.framework}` : '',
      conventions.hasTests   ? `Tests detectados (patrón: ${conventions.testPattern})` : 'Sin tests detectados',
      `Contexto canónico guardado en .agent-hub/context/canonical.json`,
    ].filter(Boolean).join('\n');

    return {
      output:        summary,
      filesModified: ['.agent-hub/context/canonical.json'],
      data:          canonical,
    };
  },

  'generate-file-index': async ({ projectPath }) => {
    const files = walkProject(projectPath);
    const index = {
      generatedAt: new Date().toISOString(),
      total:       files.length,
      files:       files.slice(0, 500),
      byExtension: files.reduce((acc, f) => {
        acc[f.ext || '(sin ext)'] = (acc[f.ext || '(sin ext)'] || 0) + 1;
        return acc;
      }, {}),
    };
    return {
      output:        JSON.stringify(index),
      filesModified: [],
      data:          index,
    };
  },

  'diff-since-step': async ({ projectPath, stepIndex, agentOutputs, context }) => {
    const sinceStep = context?.data?.sinceStep ?? stepIndex - 1;
    const prev      = agentOutputs[sinceStep];
    if (!prev) {
      return { output: 'No hay paso de referencia disponible.', filesModified: [], data: { changed: [] } };
    }
    const changed = prev.filesModified || [];
    return {
      output:        `Archivos modificados desde el paso ${sinceStep + 1}:\n${changed.map(f => `- ${f}`).join('\n') || '(ninguno)'}`,
      filesModified: [],
      data:          { changed },
    };
  },

  'validate-json': async ({ prevResult }) => {
    const resp = prevResult?.output?.response || '';
    const trimmed = resp.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return {
        output:        JSON.stringify({ valid: null, error: 'El output no parece ser JSON' }),
        filesModified: [],
        data:          { valid: null },
      };
    }
    try {
      JSON.parse(trimmed);
      return {
        output:        JSON.stringify({ valid: true }),
        filesModified: [],
        data:          { valid: true },
      };
    } catch (e) {
      return {
        output:        JSON.stringify({ valid: false, error: e.message }),
        filesModified: [],
        data:          { valid: false, error: e.message },
      };
    }
  },

  'quality-score': async ({ projectPath, prevResult, orchestration, stepIndex }) => {
    const resp          = prevResult?.output?.response || '';
    const filesModified = prevResult?.filesModified || [];
    const checks        = [];

    // Check 1: produced a response
    const hasResponse = resp.trim().length > 0;
    checks.push({ name: 'Agente produjo respuesta', passed: hasResponse });

    // Check 2: JSON valid if output looks like JSON
    let jsonValid = null;
    if (resp.trim().startsWith('{') || resp.trim().startsWith('[')) {
      try { JSON.parse(resp.trim()); jsonValid = true; }
      catch { jsonValid = false; }
      checks.push({ name: 'Output JSON válido', passed: jsonValid === true });
    }

    // Check 3: modified at least one file (only for non-script steps)
    const producedFiles = filesModified.length;
    const hadFileTask   = resp.toLowerCase().includes('creat') ||
                          resp.toLowerCase().includes('modif') ||
                          resp.toLowerCase().includes('escrib') ||
                          resp.toLowerCase().includes('write') ||
                          resp.toLowerCase().includes('updated');
    if (hadFileTask) {
      checks.push({ name: 'Modificó archivos', passed: producedFiles > 0, detail: `${producedFiles} archivo(s)` });
    }

    // Check 4: response is substantive (>100 chars)
    checks.push({ name: 'Respuesta sustancial', passed: resp.length > 100, detail: `${resp.length} caracteres` });

    const passed = checks.filter(c => c.passed).length;
    const total  = checks.length;
    const score  = Math.round((passed / total) * 100);
    const grade  = score >= 75 ? 'green' : score >= 50 ? 'amber' : 'red';

    const qualityScore = {
      score,
      grade,
      filesProduced:  producedFiles,
      filesExpected:  hadFileTask ? 1 : 0,
      jsonValid,
      coverageRatio:  null,
      checks,
    };

    return {
      output:        JSON.stringify(qualityScore),
      filesModified: [],
      data:          { qualityScore },
    };
  },

  'validate-output': async ({ prevResult }) => {
    const issues = [];
    const resp   = prevResult?.output?.response || '';

    if (resp.trim().startsWith('{') || resp.trim().startsWith('[')) {
      try { JSON.parse(resp); }
      catch (e) { issues.push({ rule: 'json-valid', message: `Output no parsea como JSON: ${e.message}` }); }
    }

    return {
      output:        JSON.stringify({ passed: issues.length === 0, issues }),
      filesModified: [],
      data:          { passed: issues.length === 0, issues },
    };
  },
};

// ── Public API ────────────────────────────────────────────────────────────────

function isScript(agentName) {
  return typeof agentName === 'string' && agentName.startsWith('__script:');
}

function getScriptName(agentName) {
  return agentName.replace(/^__script:/, '').replace(/__$/, '');
}

function hasScript(scriptName) {
  return Object.prototype.hasOwnProperty.call(SCRIPTS, scriptName);
}

async function run(scriptName, context) {
  const fn = SCRIPTS[scriptName];
  if (!fn) throw new Error(`Script desconocido: "${scriptName}"`);
  return fn(context);
}

function listScripts() {
  return [
    { name: 'prepare-context',   label: 'Preparar contexto',        description: 'Analiza el proyecto y genera el índice canónico de archivos y convenciones.' },
    { name: 'generate-file-index', label: 'Índice de archivos',     description: 'Lista estructurada de todos los archivos del proyecto con estadísticas.' },
    { name: 'diff-since-step',   label: 'Diff desde paso anterior', description: 'Compara el estado del filesystem con el de un paso anterior.' },
    { name: 'validate-json',     label: 'Validar JSON',             description: 'Verifica que el output del paso anterior es JSON válido.' },
    { name: 'quality-score',     label: 'Quality Score',            description: 'Calcula una puntuación de calidad del paso anterior sin usar IA.' },
    { name: 'validate-output',   label: 'Validar output',           description: 'Valida el output del paso anterior según reglas configurables.' },
  ];
}

module.exports = { isScript, getScriptName, hasScript, run, listScripts };
