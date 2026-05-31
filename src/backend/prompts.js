// Prompts centralizados para todas las operaciones IA de Agent Hub.
// Cada función recibe los parámetros dinámicos y devuelve el string listo para enviar.
// Para cambiar el comportamiento de cualquier botón "Generar / Optimizar con IA", editar aquí.

// ── Generar system prompt de agente ───────────────────────────────────────────

function agentPrompt({ name, description, level, toolsNote, existingNote, langInstr }) {
  return `You are an expert at writing system prompts for Claude Code sub-agents.

Create structured content for a Claude Code agent with the following details:

Agent name: ${name}
Brief description: ${description}
Agent level: ${level}
${toolsNote}
${existingNote}

Return ONLY valid JSON with this exact shape:
{
  "role": "string, concise role title",
  "objective": "string, one sentence, max 20 words",
  "responsibilities": ["3 to 5 concise bullet items"],
  "boundaries": ["3 to 5 concise do-not rules"],
  "outputFormat": ["2 to 4 concise output requirements"]
}

Content requirements:
- Be specific and actionable, avoid generic filler
- Keep focus on one core responsibility for this agent
- Do NOT copy the user's brief description verbatim in any field
- No markdown, no commentary outside JSON
${langInstr}

Output ONLY JSON.`;
}

// ── Optimizar system prompt de agente ─────────────────────────────────────────

function optimizeAgent({ name, model, toolList, description, system, langTarget }) {
  return `Rewrite this Claude Code agent's system prompt to be maximally token-efficient. Your goal is to cut tokens, not add them.

Agent: ${name || 'agent'} (model: ${model}, tools: ${toolList})
Current description: ${description || '(none)'}

Current system prompt:
---
${system}
---

Rules for the rewrite:
- Target: 50-100 words. Never exceed 120.
- Remove ALL filler: "You are an expert", "Your goal is", "Always remember", generic encouragement.
- Remove instructions the model already follows by default (be accurate, be helpful, etc.).
- Keep ONLY what is specific and differentiating for THIS agent's task.
- Use imperative verbs. No preamble.
- Write in ${langTarget}.
- Preserve the ORIGINAL FORMAT exactly: keep the same section headers, their order, list style, and spacing style.
- Do NOT add, remove, or rename sections.
- If the original prompt has a custom template, keep that template and only tighten wording.
- If the current description is vague or generic, write a sharper one (one action sentence, max 80 chars, in ${langTarget}).

Respond ONLY with valid JSON, no markdown:
{"description":"<sharp one-sentence description>","system":"<rewritten prompt that preserves original format>"}`;
}

// ── Sugerencias de agentes por nivel ──────────────────────────────────────────

function agentSuggestions({ context, existing }) {
  return `You are an expert at designing Claude Code sub-agents for software development workflows.

Context: I need agent suggestions for the following level:
${context}

${existing}

Generate exactly 3 agent suggestions that would be genuinely useful at this level.
Each suggestion must be distinct and non-redundant with the existing agents above.

Respond with ONLY a valid JSON array. No markdown, no explanation, no preamble.
Each item must have exactly these fields:
- name: string (kebab-case, e.g. "unity-audio-dev")
- description: string (one sentence, max 80 chars)
- tools: array of strings from: ["Bash", "Read", "Write", "Grep", "Edit", "WebFetch", "WebSearch", "TodoRead", "TodoWrite"]
- model: string, one of: "haiku", "sonnet", "opus"
- system: string (40-80 word system prompt, plain text, concise and actionable)

Example format:
[
  {
    "name": "example-agent",
    "description": "Does one specific thing well",
    "tools": ["Read", "Write"],
    "model": "sonnet",
    "system": "You are an expert in..."
  }
]`;
}

// ── Sugerencias de agentes para un proyecto concreto ──────────────────────────

function projectSuggestions({ project, contextSection, existing, categoryName, techName }) {
  return `You are an expert at designing Claude Code sub-agents for software development projects.

PROJECT:
- Name: ${project.name}
- Description: ${project.description || 'Not provided'}
- Category: ${categoryName || project.categoryId || 'Unknown'}
- Technology: ${techName || project.techId || 'Unknown'}
- AI Providers: ${(project.aiProviders || ['claude']).join(', ')}

${contextSection}

${existing}

Based on the project documentation and characteristics above, suggest exactly 3 Claude Code agents that would be GENUINELY USEFUL for THIS SPECIFIC PROJECT.
Prioritize agents that address:
1. The actual tech stack and architecture described in the documentation
2. Recurring tasks or conventions mentioned in the docs
3. Gaps not covered by the existing agents

Respond with ONLY a valid JSON array. No markdown, no explanation.
Each item must have exactly these fields:
- name: string (kebab-case, specific to the project)
- description: string (one sentence, max 80 chars, in Spanish)
- tools: array of strings from: ["Bash", "Read", "Write", "Grep", "Edit", "WebFetch", "WebSearch", "TodoRead", "TodoWrite"]
- model: string, one of: "haiku", "sonnet", "opus"
- system: string (40-80 word system prompt, plain text, in Spanish, concise and actionable)`;
}

// ── Generar / reducir contexto del proyecto (CLAUDE.md / copilot-instructions) ─

function generateContext({ fileLabel, projectInfo, existingContext, structure, dependencies, existingReadme }) {
  if (existingContext) {
    return `Tienes el ${fileLabel} actual de un proyecto. Debes reescribirlo aplicando estas reglas:

1. **Menos es más**: elimina cualquier sección obvia, repetitiva o que un agente de IA pueda inferir del código.
2. **Máximo 100 líneas**: si el original supera ese límite, sintetiza sin perder información esencial.
3. **Solo lo no deducible**: arquitectura, decisiones de diseño, convenciones propias, comandos clave, qué evitar. Nada de tutoriales básicos.
4. **Conserva el conocimiento real**: no elimines detalles únicos del proyecto que no están en el código.

## Contexto detectado del proyecto

${projectInfo}

## Contenido actual del archivo

${existingContext}

Devuelve únicamente el contenido reescrito del archivo. Sin explicaciones, sin bloques de código envolventes.`;
  }

  return `Genera un ${fileLabel} para este proyecto. Reglas:

1. **Máximo 100 líneas**.
2. **Solo lo esencial para un agente de IA**: stack, comandos clave, convenciones propias, estructura relevante, qué evitar. Sin tutoriales básicos.
3. **Markdown limpio**. Solo el contenido del archivo, sin explicaciones adicionales.

## Información del proyecto

${projectInfo}

## Estructura

${structure}

## Dependencias

${dependencies}

${existingReadme ? '## README\n' + existingReadme : ''}`;
}

// ── Adaptar system prompt para otro proveedor ─────────────────────────────────

function adaptForProvider({ agent, targetProvider }) {
  if (targetProvider === 'github') {
    return `You are adapting a Claude Code sub-agent's system prompt so it works correctly with GitHub Copilot in VS Code.

Agent name: ${agent.name}
Agent purpose: ${agent.description}

Original system prompt (written for Claude):
---
${agent.system}
---

Rewrite this system prompt for GitHub Copilot following these rules:
- GitHub Copilot runs inside VS Code and has access to: codebase search, terminal, GitHub repositories, file editing, fetch
- Replace Claude tool names with their GitHub Copilot equivalents where needed (e.g. "Read files" → "search the codebase", "run Bash" → "use the terminal")
- Remove any references to Claude-specific capabilities (extended thinking, etc.)
- Keep the agent's core role, expertise, tone and approach exactly the same
- Use second person ("you") consistently
- Keep the same language as the original
- Length: similar to the original (do not expand significantly)

Output ONLY the rewritten system prompt. No preamble, no explanation, no code fences.`;
  }
  return null;
}

// ── Protocolo de handoff entre agentes de orquestación ───────────────────────
// Inyectado al final del system prompt de cada agente no-final.
// El extractor en orchestrator.js busca la línea HANDOFF: para construir
// el mensaje de entrada del siguiente agente sin pasar prose completo.

function agentHandoffInstruction() {
  return `
# PROTOCOLO DE SALIDA

Al terminar tu tarea escribe como última línea de tu respuesta, sin nada después:
HANDOFF: {"done":"<una frase: qué lograste>","changed":["<ruta/relativa.ext>"],"issues":["<problema crítico si hay alguno>"],"next":"<instrucción concreta para el siguiente agente>"}

Reglas del HANDOFF:
- "done": máximo 15 palabras, qué fue completado
- "changed": solo rutas relativas al proyecto; array vacío si no tocaste archivos
- "issues": array vacío si no hay problemas; solo incluye lo que el siguiente agente debe saber
- "next": una instrucción accionable específica, máximo 20 palabras
- JSON en una sola línea, sin saltos de línea dentro`;
}

// Formatea el handoff extraído como bloque de entrada para el siguiente agente.
// Mucho más compacto que pasar el prose completo del paso anterior.
function formatHandoffAsInput(handoff, fromAgent) {
  const lines = [`## Paso anterior: ${fromAgent}`, `✓ ${handoff.done}`];
  if (handoff.changed?.length > 0) lines.push(`Archivos: ${handoff.changed.join(', ')}`);
  if (handoff.issues?.length > 0)  lines.push(`Issues: ${handoff.issues.join(' · ')}`);
  if (handoff.next)                lines.push(`Acción solicitada: ${handoff.next}`);
  return lines.join('\n');
}

module.exports = {
  agentPrompt,
  optimizeAgent,
  agentSuggestions,
  projectSuggestions,
  generateContext,
  adaptForProvider,
  agentHandoffInstruction,
  formatHandoffAsInput,
};
