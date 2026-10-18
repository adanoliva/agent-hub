import * as vscode from 'vscode';
import * as path from 'path';
import { Api, Agent, Orchestration } from './api';
import { AppPanels } from './panel';
import { ProjectState } from './tree';

const fmtCost = (usd: number) => `$${usd.toFixed(usd < 0.01 ? 4 : 2)}`;
const fmtTokens = (n: number) => n.toLocaleString('es-ES');
const isAbort = (e: any) => e?.name === 'AbortError';

export class Commands {
  constructor(
    private readonly api: Api,
    private readonly s: ProjectState,
    private readonly out: vscode.OutputChannel,
    private readonly panels: AppPanels,
  ) {}

  private get projectId(): string {
    if (this.s.state !== 'ready' || !this.s.project) {
      throw new Error(this.s.state === 'offline' ? 'Agent Hub no está abierto' : 'Esta carpeta no es un proyecto de Agent Hub');
    }
    return encodeURIComponent(this.s.project.id);
  }

  private log(line = '') { this.out.appendLine(line); }

  // ── Agents ────────────────────────────────────────────────────────────────

  private async pickAgent(): Promise<string | undefined> {
    const pick = await vscode.window.showQuickPick(
      this.s.agents.map((a: Agent) => ({ label: a.name, description: [a.level, a.model].filter(Boolean).join(' · '), detail: a.description })),
      { title: 'Agent Hub · Elige un agente', matchOnDescription: true, matchOnDetail: true });
    return pick?.label;
  }

  /** arg: tree item (agent) or explorer Uri, depending on where it was invoked */
  async runAgent(arg?: any, onFile = false): Promise<void> {
    const projectId = this.projectId;
    const agent = arg?.agent?.name || await this.pickAgent();
    if (!agent) return;

    // Explorer passes the file Uri; the editor command uses the active file and its selection
    let fileBlock = '';
    if (onFile) {
      const editor = vscode.window.activeTextEditor;
      const uri: vscode.Uri | undefined = arg instanceof vscode.Uri ? arg : editor?.document.uri;
      if (!uri) { vscode.window.showWarningMessage('No hay ningún fichero abierto'); return; }
      const rel = vscode.workspace.asRelativePath(uri, false);
      const sel = editor && editor.document.uri.toString() === uri.toString() && !editor.selection.isEmpty ? editor.selection : null;
      fileBlock = sel
        ? `\n\n## Fragmento seleccionado\n${rel} (líneas ${sel.start.line + 1}-${sel.end.line + 1})\n\`\`\`\n${editor!.document.getText(sel)}\n\`\`\``
        : `\n\n## Fichero\n${rel}`;
    }

    const task = await vscode.window.showInputBox({
      title: `Agent Hub · ${agent}`,
      prompt: onFile ? 'Qué quieres que haga con este fichero / selección' : 'Tarea para el agente',
      ignoreFocusOut: true,
      validateInput: v => v.trim() ? null : 'Escribe la tarea',
    });
    if (!task) return;

    this.out.show(true);
    this.log(`━━ ${agent} · ${new Date().toLocaleTimeString()} ━━`);
    this.log(`> ${task.trim()}${fileBlock ? ' (+ ' + (fileBlock.includes('Fragmento') ? 'selección' : 'fichero') + ')' : ''}`);

    const ac = new AbortController();
    let result: any = null;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Agent Hub · ${agent}`, cancellable: true },
      async (progress, token) => {
        token.onCancellationRequested(() => ac.abort());
        progress.report({ message: 'ejecutando…' });
        try {
          for await (const ev of this.api.ndjson(`/projects/${projectId}/run?stream=1`, { agent, task: task.trim() + fileBlock }, ac.signal)) {
            switch (ev.type) {
              case 'start':
                this.log(`  proveedor: ${ev.provider}${ev.skills?.length ? ' · skills: ' + ev.skills.join(', ') : ''}`);
                break;
              case 'tool':
                this.log(`  · ${ev.name} ${ev.detail || ''}`);
                progress.report({ message: `${ev.name} ${ev.detail ? path.basename(String(ev.detail)) : ''}` });
                break;
              case 'text': this.log(`  ${ev.text.replace(/\n/g, '\n  ')}`); break;
              case 'warn': case 'info': this.log(`  [${ev.type}] ${ev.text}`); break;
              case 'result': result = ev; break;
              case 'error': throw new Error(ev.error);
            }
          }
        } catch (e: any) {
          if (isAbort(e)) { this.log('  ✕ Cancelado'); return; }
          this.log(`  ✕ ${e.message}`);
          vscode.window.showErrorMessage(`Agent Hub · ${agent}: ${e.message}`);
        }
      });
    if (!result) return;

    const cost = result.costUnavailable ? 'coste n/d' : result.costUSD ? `~${fmtCost(result.costUSD)}` : '';
    this.log('');
    this.log(result.result);
    this.log('');
    this.log(`  ✓ ${(result.durationMs / 1000).toFixed(1)}s · ${fmtTokens((result.inputTokens || 0) + (result.outputTokens || 0))} tokens${cost ? ' · ' + cost : ''}`);
    if (result.mcpIgnored?.length) this.log(`  [warn] MCP no aplicado con este proveedor: ${result.mcpIgnored.join(', ')}`);

    const open = await vscode.window.showInformationMessage(`${agent} ha terminado (${(result.durationMs / 1000).toFixed(0)}s)`, 'Ver resultado');
    if (open) {
      const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: `# ${agent}\n\n> ${task.trim()}\n\n${result.result}\n` });
      vscode.window.showTextDocument(doc, { preview: true });
    }
  }

  // ── Orchestrations ────────────────────────────────────────────────────────

  private async pickOrchestration(): Promise<Orchestration | undefined> {
    if (!this.s.orchestrations.length) {
      const create = await vscode.window.showInformationMessage('Este proyecto no tiene orquestaciones', 'Crear una');
      if (create) await this.newOrchestration();
      return;
    }
    const pick = await vscode.window.showQuickPick(
      this.s.orchestrations.map(o => ({ label: o.name, description: o.nodes.map(n => n.agentName).join(' → '), detail: o.description, o })),
      { title: 'Agent Hub · Elige una orquestación', matchOnDescription: true });
    return pick?.o;
  }

  /** The app's execution panel (fields, cost estimate, live progress, gates, result with diffs) in an editor tab */
  async runOrchestration(arg?: any): Promise<void> {
    this.projectId;   // fails early when not ready
    const orch: Orchestration | undefined = arg?.orch || await this.pickOrchestration();
    if (orch) await this.panels.show(this.s.project!.id, 'execution', orch);
  }

  /** The app's canvas editor in an editor tab */
  async editOrchestration(arg?: any): Promise<void> {
    this.projectId;
    const orch: Orchestration | undefined = arg?.orch || arg || await this.pickOrchestration();
    if (orch) await this.panels.show(this.s.project!.id, 'editor', orch);
  }

  /** Stops an orchestration's running execution, wherever it was launched from */
  async stopOrchestration(arg?: any): Promise<void> {
    const orch: Orchestration | undefined = arg?.orch;
    if (!orch?.activeExecutionId) return;
    await this.api.req('POST', `/orchestrations/${encodeURIComponent(orch.id)}/cancel?executionId=${encodeURIComponent(orch.activeExecutionId)}`);
    this.log(`━━ «${orch.name}»: cancelación solicitada ━━`);
    vscode.window.setStatusBarMessage(`Agent Hub: deteniendo «${orch.name}»…`, 4000);
    setTimeout(() => this.s.load(), 1500);
  }

  /** Live log, gates and final summary of an execution: just launched, or already running (clicked in the view) */
  async followExecution(orch: Orchestration, executionId: string): Promise<void> {
    const id = encodeURIComponent(orch.id);
    this.out.show(true);
    this.log(`━━ Orquestación «${orch.name}» · ${new Date().toLocaleTimeString()} ━━`);
    const ac = new AbortController();
    let final: { event: string; data: any } | null = null;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Agent Hub · ${orch.name}`, cancellable: true },
      async (progress, token) => {
        token.onCancellationRequested(() => {
          this.api.req('POST', `/orchestrations/${id}/cancel?executionId=${encodeURIComponent(executionId)}`).catch(() => {});
        });
        try {
          for await (const { event, data } of this.api.sse(`/orchestrations/${id}/execute/stream?executionId=${encodeURIComponent(executionId)}`, ac.signal)) {
            if (event === 'message') {
              this.log(`  ${data.level === 'error' ? '✕' : data.level === 'warn' ? '!' : '·'} ${data.message}`);
              // Logs are replayed on connect, step events aren't: the first step may start before we listen
              if (data.level !== 'error') progress.report({ message: String(data.message).replace(/^[━\s]+|[━\s]+$/g, '').slice(0, 80) });
            } else if (event === 'step-start') {
              const d = data.data;
              progress.report({ message: `paso ${d.stepIndex + 1}/${d.totalSteps}: ${d.agentName}` });
            } else if (event === 'gate-open') {
              await this.resolveGate(id, executionId, data.data);
            } else if (event === 'browser-required') {
              vscode.window.showWarningMessage(`«${data.data.agentName}» necesita el navegador: continúa la ejecución desde Agent Hub.`);
            } else if (event === 'completed' || event === 'cancelled' || event === 'error') {
              final = { event, data };
              break;
            }
          }
        } catch (e: any) {
          if (!isAbort(e)) final = { event: 'error', data: { message: e.message } };
        }
      });

    ac.abort();
    const f = final as { event: string; data: any } | null;
    if (f?.event === 'completed') {
      const r = f.data.data;
      const tokens = (r.totalTokensUsed?.input || 0) + (r.totalTokensUsed?.output || 0);
      const summary = `${r.status} · ${r.stepsCompleted}/${r.totalSteps} pasos · ${(r.duration / 1000).toFixed(0)}s · ${fmtTokens(tokens)} tokens${r.estimatedCost ? ` · ~${fmtCost(r.estimatedCost)}` : ''}`;
      this.log(`  ✓ ${summary}`);
      const show = r.status === 'success'
        ? vscode.window.showInformationMessage(`«${orch.name}»: ${summary}`, 'Ver resultado')
        : vscode.window.showWarningMessage(`«${orch.name}»: ${summary}`, 'Ver resultado');
      if (await show) await this.openExecution(orch.id, executionId);
    } else if (f?.event === 'cancelled') {
      const reason = f.data.data?.reason === 'budget_exceeded' ? ' (presupuesto agotado)' : '';
      this.log(`  ✕ Cancelada${reason}`);
      vscode.window.showWarningMessage(`«${orch.name}» cancelada${reason}`);
    } else if (f?.event === 'error') {
      const msg = f.data.message || f.data.data?.message || 'error';
      this.log(`  ✕ ${msg}`);
      vscode.window.showErrorMessage(`«${orch.name}»: ${msg}`);
    }
    await this.s.load();
  }

  private async resolveGate(orchId: string, executionId: string, gate: { nodeId: string; agentName: string }): Promise<void> {
    this.log(`  ⏸ Revisión pendiente tras «${gate.agentName}»`);
    const choice = await vscode.window.showWarningMessage(
      `Revisa los cambios de «${gate.agentName}» antes de continuar`,
      { modal: true, detail: 'Puedes ver el diff en el control de código fuente.' },
      'Aprobar', 'Revisar…', 'Cancelar orquestación');
    let action: 'approve' | 'revise' | 'cancel' = 'cancel';
    let feedbackText: string | undefined;
    if (choice === 'Aprobar') action = 'approve';
    else if (choice === 'Revisar…') {
      feedbackText = await vscode.window.showInputBox({ title: `Feedback para ${gate.agentName}`, prompt: 'Qué debe cambiar', ignoreFocusOut: true });
      action = feedbackText ? 'revise' : 'approve';
    }
    await this.api.req('POST', `/orchestrations/${orchId}/executions/${encodeURIComponent(executionId)}/gate`, { action, feedbackText, nodeId: gate.nodeId });
    this.log(`  ▶ ${action === 'approve' ? 'Aprobado' : action === 'revise' ? 'Revisión: ' + feedbackText : 'Cancelada'}`);
  }

  /** The app's own creation flow: name, then the canvas editor */
  async newOrchestration(): Promise<void> {
    this.projectId;
    await this.panels.show(this.s.project!.id, 'new');
  }

  async openExecution(orchId: string, executionId: string): Promise<void> {
    const r = await this.api.req<any>('GET', `/orchestrations/${encodeURIComponent(orchId)}/executions/${encodeURIComponent(executionId)}`);
    const orch = this.s.orchestrations.find(o => o.id === orchId);
    const md: string[] = [
      `# ${orch?.name || orchId}`,
      '',
      `**${r.status}** · ${r.stepsCompleted ?? '?'}/${r.totalSteps ?? '?'} pasos · ${r.duration ? (r.duration / 1000).toFixed(0) + 's' : ''} · ${new Date(r.startedAt).toLocaleString()}`,
      r.totalTokensUsed ? `${fmtTokens(r.totalTokensUsed.input + r.totalTokensUsed.output)} tokens${r.estimatedCost ? ` · ~${fmtCost(r.estimatedCost)}${r.estimatedCostIsApprox ? ' (aprox.)' : ''}` : ''}` : '',
    ];
    for (const step of r.results || []) {
      md.push('', `## ${step.stepIndex + 1}. ${step.agentName} — ${step.status}`);
      md.push(`${(step.duration / 1000).toFixed(1)}s · ${fmtTokens((step.tokensUsed?.input || 0) + (step.tokensUsed?.output || 0))} tokens${step.costUnavailable ? ' · coste n/d' : step.estimatedCost ? ` · ~${fmtCost(step.estimatedCost)}` : ''}`);
      if (step.error) md.push('', `> **Error:** ${step.error.message}`);
      if (step.filesModified?.length) md.push('', '**Ficheros modificados:**', ...step.filesModified.map((f: string) => `- \`${f}\``));
      if (step.gitCommitSha) {
        const d = await this.api.req<{ diff: string; truncated: boolean }>('GET',
          `/orchestrations/${encodeURIComponent(orchId)}/executions/${encodeURIComponent(executionId)}/steps/${step.stepIndex}/diff`).catch(() => null);
        if (d) md.push('', `**Diff** (commit \`${step.gitCommitSha.slice(0, 7)}\`)`, '', '```diff', d.diff.trimEnd(), '```', d.truncated ? '_Diff truncado: ábrelo con `git show`._' : '');
      }
      if (step.output?.response) md.push('', step.output.response);
    }
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: md.join('\n') + '\n' });
    vscode.window.showTextDocument(doc, { preview: true });
  }

  async syncAgents(): Promise<void> {
    const r = await this.api.req<{ added?: number; updated?: number }>('POST', `/projects/${this.projectId}/sync`);
    vscode.window.showInformationMessage(`Agentes sincronizados: ${r.added || 0} nuevos, ${r.updated || 0} actualizados`);
    await this.s.load();
  }
}
