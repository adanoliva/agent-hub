import * as vscode from 'vscode';
import * as path from 'path';
import { Api } from './api';
import { ProjectState } from './tree';

const PARTICIPANT = 'agentHub.chat';
const fmtCost = (usd: number) => `$${usd.toFixed(usd < 0.01 ? 4 : 2)}`;

/**
 * @agenthub in VS Code's chat view.
 *   (no command) → the app's project chat: reads files, context and skills, never modifies anything
 *   /run <agent> <task> → runs an agent on the project, with live progress
 *   /agents → lists the project's agents
 */
export function registerChat(ctx: vscode.ExtensionContext, api: Api, s: ProjectState): void {
  if (!vscode.chat?.createChatParticipant) return;   // editor without the chat view

  const handler: vscode.ChatRequestHandler = async (request, context, stream, token) => {
    if (s.state !== 'ready') await s.load();
    if (s.state !== 'ready' || !s.project) {
      stream.markdown(s.state === 'offline'
        ? 'Agent Hub no está abierto. Abre la aplicación y vuelve a preguntar.'
        : 'Esta carpeta no es un proyecto de Agent Hub. Impórtala desde la app (Proyectos → Importar).');
      return;
    }
    const projectId = s.project.id;
    const ac = new AbortController();
    token.onCancellationRequested(() => ac.abort());

    if (request.command === 'agents') {
      stream.markdown(s.agents.map(a => `- **${a.name}**${a.level ? ` _(${a.level})_` : ''}${a.description ? ' — ' + a.description : ''}`).join('\n') || 'Este proyecto no tiene agentes.');
      return;
    }

    if (request.command === 'run') {
      const [name = '', ...rest] = request.prompt.trim().split(/\s+/);
      const task = rest.join(' ').trim();
      const agent = s.agents.find(a => a.name.toLowerCase() === name.toLowerCase());
      if (!agent || !task) {
        stream.markdown(`Uso: \`/run <agente> <tarea>\`. Agentes: ${s.agents.map(a => '`' + a.name + '`').join(', ')}`);
        return;
      }
      stream.progress(`${agent.name}: ejecutando…`);
      try {
        for await (const ev of api.ndjson(`/projects/${encodeURIComponent(projectId)}/run?stream=1`, { agent: agent.name, task }, ac.signal)) {
          if (ev.type === 'start') stream.progress(`${agent.name} · ${ev.provider}${ev.skills?.length ? ' · skills: ' + ev.skills.join(', ') : ''}`);
          else if (ev.type === 'tool') stream.progress(`${ev.name} ${ev.detail ? path.basename(String(ev.detail)) : ''}`);
          else if (ev.type === 'warn') stream.markdown(`> ${ev.text}\n\n`);
          else if (ev.type === 'error') throw new Error(ev.error);
          else if (ev.type === 'result') {
            const cost = ev.costUnavailable ? 'coste n/d' : ev.costUSD ? `~${fmtCost(ev.costUSD)}` : '';
            stream.markdown(ev.result);
            stream.markdown(`\n\n_${agent.name} · ${(ev.durationMs / 1000).toFixed(1)}s · ${((ev.inputTokens || 0) + (ev.outputTokens || 0)).toLocaleString('es-ES')} tokens${cost ? ' · ' + cost : ''}_`);
          }
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError') stream.markdown(`**Error:** ${e.message}`);
      }
      return;
    }

    // Project chat: only this participant's plain turns make up the conversation
    const messages: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const turn of context.history) {
      if (turn.participant !== PARTICIPANT || turn.command) continue;
      if (turn instanceof vscode.ChatRequestTurn) messages.push({ role: 'user', content: turn.prompt });
      else if (turn instanceof vscode.ChatResponseTurn) {
        const text = turn.response
          .filter((p): p is vscode.ChatResponseMarkdownPart => p instanceof vscode.ChatResponseMarkdownPart)
          .map(p => p.value.value).join('');
        if (text) messages.push({ role: 'assistant', content: text });
      }
    }
    messages.push({ role: 'user', content: request.prompt });

    stream.progress('Leyendo el proyecto…');
    try {
      const r = await api.req<{ reply: string }>('POST', '/chat', { messages, projectId }, ac.signal);
      stream.markdown(r.reply);
    } catch (e: any) {
      if (e?.name !== 'AbortError') stream.markdown(`**Error:** ${e.message}`);
    }
  };

  const participant = vscode.chat.createChatParticipant(PARTICIPANT, handler);
  participant.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'agent-hub.svg');
  ctx.subscriptions.push(participant);
}
