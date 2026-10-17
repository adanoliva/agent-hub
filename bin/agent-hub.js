#!/usr/bin/env node
// Thin client over the Agent Hub REST API — the app (or `npm run dev:backend`) must be running.
const { parseArgs } = require('node:util');

const API = `${process.env.AGENT_HUB_URL || 'http://localhost:3737'}/api`;

const USAGE = `Uso:
  agent-hub projects
  agent-hub agents --project <nombre|id>
  agent-hub run --project <nombre|id> --agent <nombre> "<tarea>" [--max-turns N]

Variables: AGENT_HUB_URL (por defecto http://localhost:3737)`;

async function req(method, p, body) {
  let res;
  try {
    res = await fetch(API + p, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`No se puede conectar con Agent Hub en ${API}. ¿Está la app abierta?`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function findProject(ref) {
  if (!ref) throw new Error('Falta --project');
  const projects = await req('GET', '/projects');
  const p = projects.find(x => x.id === ref)
    || projects.find(x => x.name.toLowerCase() === ref.toLowerCase());
  if (!p) throw new Error(`Proyecto "${ref}" no encontrado. Usa \`agent-hub projects\`.`);
  return p;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      project:     { type: 'string', short: 'p' },
      agent:       { type: 'string', short: 'a' },
      'max-turns': { type: 'string' },
      help:        { type: 'boolean', short: 'h' },
    },
  });
  const [cmd, ...rest] = positionals;

  if (values.help || !cmd) return console.log(USAGE);

  if (cmd === 'projects') {
    for (const p of await req('GET', '/projects')) {
      console.log(`${p.id}  ${p.name}  [${p.status}]  ${p.path}`);
    }
    return;
  }

  if (cmd === 'agents') {
    const p = await findProject(values.project);
    const [own, applicable] = await Promise.all([
      req('GET', `/projects/${p.id}/agents`),
      req('GET', `/agents/applicable?projectId=${p.id}`),
    ]);
    const seen = new Set();
    for (const a of [...own.map(a => ({ ...a, level: 'project' })), ...applicable]) {
      if (seen.has(a.name)) continue;
      seen.add(a.name);
      console.log(`${a.name.padEnd(28)} ${(a.level || '').padEnd(10)} ${a.description || ''}`);
    }
    return;
  }

  if (cmd === 'run') {
    const task = rest.join(' ').trim();
    if (!values.agent || !task) throw new Error('Uso: agent-hub run --project <p> --agent <a> "<tarea>"');
    const p = await findProject(values.project);
    console.error(`> Proyecto: ${p.name}\n> Agente: ${values.agent}\n> Ejecutando…`);
    const r = await req('POST', `/projects/${p.id}/run`, {
      agent: values.agent,
      task,
      ...(values['max-turns'] && { maxTurns: Number(values['max-turns']) }),
    });
    console.log(r.result);
    console.error(`✓ ${r.provider} · ${(r.durationMs / 1000).toFixed(1)}s`);
    return;
  }

  throw new Error(`Comando desconocido: ${cmd}\n\n${USAGE}`);
}

main().catch(e => { console.error(`✗ ${e.message}`); process.exitCode = 1; });
