import * as vscode from 'vscode';
import { Api } from './api';
import { ProjectState, ProjectTree } from './tree';
import { Commands } from './commands';
import { registerChat } from './chat';
import { AppPanels } from './panel';

export function activate(ctx: vscode.ExtensionContext): void {
  const api   = new Api();
  const state = new ProjectState(api);
  const out   = vscode.window.createOutputChannel('Agent Hub');
  const cmds  = new Commands(api, state, out, new AppPanels(api, ctx.extensionUri));

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'workbench.view.extension.agentHub';
  const paintStatus = () => {
    if (state.state === 'noFolder') { status.hide(); return; }
    if (state.state === 'offline') {
      status.text = '$(debug-disconnect) Agent Hub';
      status.tooltip = 'Agent Hub no está abierto';
    } else if (state.state === 'unregistered') {
      status.text = '$(circle-slash) Agent Hub';
      status.tooltip = 'Esta carpeta no es un proyecto de Agent Hub';
    } else {
      status.text = `$(hubot) ${state.provider || 'Agent Hub'}`;
      status.tooltip = `Agent Hub · ${state.project!.name} · ${state.agents.length} agentes · ${state.orchestrations.length} orquestaciones`;
    }
    status.show();
  };
  state.onDidChange(paintStatus);

  // Errors from commands surface as notifications instead of failing silently
  const run = (fn: (...a: any[]) => Promise<unknown>) => async (...a: any[]) => {
    try { await fn(...a); }
    catch (e: any) { vscode.window.showErrorMessage(`Agent Hub: ${e.message}`); }
  };

  ctx.subscriptions.push(
    out, status,
    vscode.window.registerTreeDataProvider('agentHub.project', new ProjectTree(state)),
    vscode.commands.registerCommand('agentHub.refresh',             run(() => state.load())),
    vscode.commands.registerCommand('agentHub.runAgent',            run((a?) => cmds.runAgent(a))),
    vscode.commands.registerCommand('agentHub.runAgentOnSelection', run((a?) => cmds.runAgent(a, true))),
    vscode.commands.registerCommand('agentHub.runOrchestration',    run((a?) => cmds.runOrchestration(a))),
    vscode.commands.registerCommand('agentHub.editOrchestration',   run((a?) => cmds.editOrchestration(a))),
    vscode.commands.registerCommand('agentHub.newOrchestration',    run(() => cmds.newOrchestration())),
    vscode.commands.registerCommand('agentHub.stopOrchestration',   run((a?) => cmds.stopOrchestration(a))),
    vscode.commands.registerCommand('agentHub.followExecution',     run((o) => cmds.followExecution(o, o.activeExecutionId))),
    vscode.commands.registerCommand('agentHub.openExecution',       run((o: string, e: string) => cmds.openExecution(o, e))),
    vscode.commands.registerCommand('agentHub.syncAgents',          run(() => cmds.syncAgents())),
    vscode.commands.registerCommand('agentHub.showOutput',          run(async () => out.show())),
    vscode.workspace.onDidChangeWorkspaceFolders(() => state.load()),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('agentHub.url')) state.load(); }),
    // Coming back to the editor after using the app (or opening it) refreshes the view
    vscode.window.onDidChangeWindowState(w => { if (w.focused) state.load(); }),
  );

  // Orchestrations and executions are files in the project: the app (or a teammate's pull) changing them refreshes the view
  const watcher = vscode.workspace.createFileSystemWatcher('**/.agent-hub/{orchestrations,executions}/**');
  let pending: NodeJS.Timeout | undefined;
  const soon = () => { clearTimeout(pending); pending = setTimeout(() => state.load(), 800); };
  watcher.onDidCreate(soon); watcher.onDidChange(soon); watcher.onDidDelete(soon);
  ctx.subscriptions.push(watcher);

  registerChat(ctx, api, state);
  state.load();
}

export function deactivate(): void {}
