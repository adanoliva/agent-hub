import * as vscode from 'vscode';
import * as path from 'path';
import { Api, Agent, CostEstimate, OrchNode, Orchestration } from './api';
import { ProjectState } from './tree';

const fmtCost = (usd: number) => `$${usd.toFixed(usd < 0.01 ? 4 : 2)}`;
const fmtTokens = (n: number) => n.toLocaleString('es-ES');
const isAbort = (e: any) => e?.name === 'AbortError';

export class Commands {
  constructor(
    private readonly api: Api,
    private readonly s: ProjectState,
    private readonly out: vscode.OutputChannel,
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

  /** Temporal fields the orchestration asks for before running (same keys as the app: `${nodeId}-${fieldId}`) */
  private async askTemporal(orch: Orchestration): Promise<Record<string, string> | undefined> {
    const values: Record<string, string> = {};
    for (const node of orch.nodes) {
      for (const f of node.contextExtra?.temporal || []) {
        const key = `${node.id}-${f.id}`;
        if (f.type === 'file') {
          const [uri] = await vscode.window.showOpenDialog({ title: `${f.label} (${node.agentName})`, canSelectMany: false }) || [];
          if (!uri) { if (f.required) return; continue; }
          values[key] = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        } else {
          const v = await vscode.window.showInputBox({
            title: `${orch.name} · ${node.agentName}`, prompt: f.label, placeHolder: f.placeholder, ignoreFocusOut: true,
            validateInput: x => f.required && !x.trim() ? 'Campo obligatorio' : null,
          });
          if (v === undefined) return;
          if (v.trim()) values[key] = v;
        }
      }
    }
    return values;
  }

  private estimateText(e: CostEstimate): string {
    const h = e.totals.history;
    const lines = [h
      ? `Media de ${h.runs} ejecución${h.runs !== 1 ? 'es' : ''} anterior${h.runs !== 1 ? 'es' : ''}: ${fmtTokens(h.input + h.output)} tokens${h.costUSD !== null ? ` · ~${fmtCost(h.costUSD)}` : ' · coste n/d'}`
      : 'Primera ejecución: el coste real depende de cuántos turnos use cada agente.'];
    lines.push(`Mínimo de entrada: ${fmtTokens(e.totals.inputTokens)} tokens${e.totals.minCostUSD !== null ? ` (~${fmtCost(e.totals.minCostUSD)})` : ' · coste n/d con este proveedor'}`);
    if (e.nativeCLI) lines.push('El CLI añade su propio prompt y herramientas.');
    return lines.join('\n');
  }

  async runOrchestration(arg?: any): Promise<void> {
    this.projectId;   // fails early when not ready
    const orch: Orchestration | undefined = arg?.orch || await this.pickOrchestration();
    if (!orch) return;
    const id = encodeURIComponent(orch.id);

    const temporal = await this.askTemporal(orch);
    if (!temporal) return;

    const estimate = await this.api.req<CostEstimate>('GET', `/orchestrations/${id}/estimate`).catch(() => null);
    const ec = orch.executionConfig || {};
    const detail = [
      `${orch.nodes.length} pasos: ${orch.nodes.map(n => n.agentName).join(' → ')}`,
      `Timeout: ${Math.round((ec.timeout || 1_800_000) / 60_000)} min total · ${Math.round((ec.stepTimeout || 600_000) / 60_000)} min por paso`
        + (ec.maxBudgetUSD ? ` · presupuesto máx. ${fmtCost(ec.maxBudgetUSD)}${estimate && !estimate.priced ? ' (sin efecto con este proveedor)' : ''}` : ''),
      estimate ? '\n' + this.estimateText(estimate) : '',
    ].join('\n');
    const go = await vscode.window.showInformationMessage(`¿Ejecutar «${orch.name}»?`, { modal: true, detail }, 'Ejecutar');
    if (go !== 'Ejecutar') return;

    let executionId: string;
    try {
      ({ executionId } = await this.api.req<{ executionId: string }>('POST', `/orchestrations/${id}/execute`, { temporalContexts: temporal }));
    } catch (e: any) {
      vscode.window.showErrorMessage(`No se pudo lanzar «${orch.name}»: ${e.message}`);
      return;
    }

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

  /** A linear chain of agents. Parallel branches, gates and scripts are edited in the app's canvas. */
  async newOrchestration(): Promise<void> {
    this.projectId;   // fails early when not ready
    const projectId = this.s.project!.id;
    const name = await vscode.window.showInputBox({ title: 'Nueva orquestación (1/3)', prompt: 'Nombre', ignoreFocusOut: true, validateInput: v => v.trim() ? null : 'Obligatorio' });
    if (!name) return;
    const task = await vscode.window.showInputBox({ title: 'Nueva orquestación (2/3)', prompt: 'Descripción de la tarea (lo que recibe el primer agente)', ignoreFocusOut: true });
    if (task === undefined) return;

    const chain: string[] = [];
    for (;;) {
      const done = { label: '$(check) Terminar', description: chain.length ? `${chain.length} paso${chain.length !== 1 ? 's' : ''}` : '', done: true };
      const items = this.s.agents
        .filter(a => !chain.includes(a.name))   // the canvas allows each agent once
        .map(a => ({ label: a.name, description: [a.level, a.model].filter(Boolean).join(' · '), detail: a.description, done: false }));
      const pick = await vscode.window.showQuickPick(chain.length ? [done, ...items] : items, {
        title: `Nueva orquestación (3/3) · paso ${chain.length + 1}`,
        placeHolder: chain.length ? chain.join(' → ') + ' → …' : 'Primer agente',
        ignoreFocusOut: true, matchOnDetail: true,
      });
      if (!pick) return;
      if (pick.done) break;
      chain.push(pick.label);
    }

    // Same geometry as the app's auto-layout (NODE_W 244, first level at y=200, 160 px per level)
    const stamp = Date.now().toString(36);
    const nodes: OrchNode[] = chain.map((agentName, i) => ({
      id: `node-${stamp}-${i}`,
      agentName,
      dependsOn: i ? [`node-${stamp}-${i - 1}`] : [],
      ...(i === 0 && { isRoot: true }),
      x: 278, y: 200 + i * 160,
      dataFlow: { agentOutput: true, filesModified: true, projectContext: i === 0 },
      contextExtra: { fixed: { freeText: i === 0 ? task.trim() : '', files: [] }, temporal: [] },
    }));

    try {
      const orch = await this.api.req<Orchestration>('POST', '/orchestrations', { projectId, name: name.trim(), description: '', nodes });
      await this.s.load();
      const next = await vscode.window.showInformationMessage(
        `Orquestación «${orch.name}» creada (${chain.join(' → ')}). Para ramas paralelas, gates o scripts, edítala en Agent Hub.`, 'Ejecutar ahora');
      if (next) await this.runOrchestration({ orch });
    } catch (e: any) {
      vscode.window.showErrorMessage(`No se pudo crear la orquestación: ${e.message}`);
    }
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
