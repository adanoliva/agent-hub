import * as vscode from 'vscode';
import { Api, Orchestration } from './api';

export type PanelMode = 'editor' | 'execution' | 'new';

/**
 * Agent Hub's own orchestration screens (canvas editor, execution panel with estimate, gates and diffs) in an
 * editor tab: the running app, served by its local API, in an iframe and in embed mode (src/renderer/embed.ts).
 * Same UI as the app, nothing to keep in sync here.
 */
export class AppPanels {
  private readonly panels = new Map<string, vscode.WebviewPanel>();

  constructor(private readonly api: Api, private readonly extensionUri: vscode.Uri) {}

  async show(projectId: string, mode: PanelMode, orch?: Orchestration): Promise<void> {
    const key = `${orch?.id || 'new'}:${mode}`;
    const existing = this.panels.get(key);
    if (existing) { existing.reveal(); return; }

    const title = mode === 'new' ? 'Nueva orquestación' : mode === 'execution' ? `▶ ${orch!.name}` : orch!.name;
    const panel = vscode.window.createWebviewPanel('agentHub.app', title, vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true });   // keeps a running execution's panel alive in a hidden tab
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'agent-hub.svg');
    this.panels.set(key, panel);
    panel.onDidDispose(() => this.panels.delete(key));

    const params = new URLSearchParams({ embed: '1', project: projectId, mode, ...(orch && { orch: orch.id }) });
    // asExternalUri: the right address when VS Code runs remotely (SSH, WSL, Codespaces)
    const url = (await vscode.env.asExternalUri(vscode.Uri.parse(`${this.api.base}/?${params}`))).toString(true);
    const origin = new URL(url).origin;
    panel.webview.html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin}; style-src 'unsafe-inline';">
  <style>html, body, iframe { margin: 0; padding: 0; border: 0; width: 100%; height: 100%; overflow: hidden; background: #0d0d0f; }</style>
</head>
<body><iframe src="${url}" allow="clipboard-read; clipboard-write"></iframe></body>
</html>`;
  }
}
