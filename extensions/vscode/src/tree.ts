import * as vscode from 'vscode';
import * as path from 'path';
import { Api, Agent, ExecutionMeta, Orchestration, Project } from './api';

export type State = 'offline' | 'unregistered' | 'noFolder' | 'ready';

const samePath = (a: string, b: string) => {
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
};

/** What the extension knows about the open project. Everything comes from the running app. */
export class ProjectState {
  state: State = 'offline';
  project: Project | null = null;
  agents: Agent[] = [];
  orchestrations: Orchestration[] = [];
  executions: (ExecutionMeta & { orchName: string })[] = [];
  provider = '';
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(private readonly api: Api) {}

  async load(): Promise<void> {
    try {
      await this.fetch();
    } catch {
      this.state = 'offline';
    }
    if (this.state !== 'ready') {
      this.project = null;
      this.agents = []; this.orchestrations = []; this.executions = [];
    }
    await vscode.commands.executeCommand('setContext', 'agentHub.state', this.state);
    this.changed.fire();
  }

  private async fetch(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders || [];
    if (!folders.length) { this.state = 'noFolder'; return; }
    if (!(await this.api.isUp())) { this.state = 'offline'; return; }

    const projects = await this.api.req<Project[]>('GET', '/projects');
    this.project = projects.find(p => folders.some(f => samePath(p.path, f.uri.fsPath))) || null;
    if (!this.project) { this.state = 'unregistered'; return; }

    const id = encodeURIComponent(this.project.id);
    const [own, applicable, orchs, status] = await Promise.all([
      this.api.req<Agent[]>('GET', `/projects/${id}/agents`),
      this.api.req<Agent[]>('GET', `/agents/applicable?projectId=${id}`),
      this.api.req<Orchestration[]>('GET', `/orchestrations?projectId=${id}`),
      this.api.req<{ provider: string }>('GET', '/ai/status').catch(() => ({ provider: '' })),
    ]);
    // Project agents win over same-named global/section ones, as in the app
    const seen = new Set<string>();
    this.agents = [...own.map(a => ({ ...a, level: 'project' })), ...applicable]
      .filter(a => !seen.has(a.name) && seen.add(a.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.orchestrations = orchs;
    this.provider = status.provider;

    const perOrch = await Promise.all(orchs.map(o =>
      this.api.req<ExecutionMeta[]>('GET', `/orchestrations/${encodeURIComponent(o.id)}/executions`)
        .then(list => list.map(e => ({ ...e, orchName: o.name })))
        .catch(() => [])));
    this.executions = perOrch.flat()
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, 10);
    this.state = 'ready';
  }
}

type Node =
  | { kind: 'header' }
  | { kind: 'pendingSync'; count: number }
  | { kind: 'group'; group: 'agents' | 'orchestrations' | 'executions' }
  | { kind: 'agent'; agent: Agent }
  | { kind: 'orchestration'; orch: Orchestration }
  | { kind: 'execution'; exec: ExecutionMeta & { orchName: string } };

const STATUS_ICON: Record<string, [string, string]> = {
  success: ['pass',    'testing.iconPassed'],
  partial: ['warning', 'list.warningForeground'],
  failed:  ['error',   'testing.iconFailed'],
  running: ['loading~spin', ''],
};

export function timeAgo(iso?: string): string {
  if (!iso) return '';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

export class ProjectTree implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly s: ProjectState) {
    s.onDidChange(() => this.changed.fire());
  }

  getChildren(node?: Node): Node[] {
    const s = this.s;
    if (s.state !== 'ready') return [];   // the welcome view explains why
    if (!node) {
      return [
        { kind: 'header' },
        ...(s.project?.pendingUpdates ? [{ kind: 'pendingSync' as const, count: s.project.pendingUpdates }] : []),
        { kind: 'group', group: 'agents' },
        { kind: 'group', group: 'orchestrations' },
        { kind: 'group', group: 'executions' },
      ];
    }
    if (node.kind !== 'group') return [];
    if (node.group === 'agents') return s.agents.map(agent => ({ kind: 'agent', agent }));
    if (node.group === 'orchestrations') return s.orchestrations.map(orch => ({ kind: 'orchestration', orch }));
    return s.executions.map(exec => ({ kind: 'execution', exec }));
  }

  getTreeItem(node: Node): vscode.TreeItem {
    const s = this.s;
    switch (node.kind) {
      case 'header': {
        const it = new vscode.TreeItem(s.project!.name);
        it.iconPath = new vscode.ThemeIcon('folder-library');
        it.description = s.provider;
        it.tooltip = `${s.project!.path}\nProveedor: ${s.provider || '?'}`;
        return it;
      }
      case 'pendingSync': {
        const it = new vscode.TreeItem(`${node.count} agente${node.count !== 1 ? 's' : ''} pendiente${node.count !== 1 ? 's' : ''} de sincronizar`);
        it.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
        it.contextValue = 'pendingSync';
        it.command = { command: 'agentHub.syncAgents', title: 'Sincronizar agentes' };
        return it;
      }
      case 'group': {
        const [label, icon, count] = {
          agents:         ['Agentes', 'hubot', s.agents.length],
          orchestrations: ['Orquestaciones', 'type-hierarchy', s.orchestrations.length],
          executions:     ['Ejecuciones recientes', 'history', s.executions.length],
        }[node.group] as [string, string, number];
        const it = new vscode.TreeItem(label, node.group === 'executions'
          ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded);
        it.iconPath = new vscode.ThemeIcon(icon);
        it.description = String(count);
        return it;
      }
      case 'agent': {
        const a = node.agent;
        const it = new vscode.TreeItem(a.name);
        it.iconPath = new vscode.ThemeIcon(a.level === 'project' ? 'person' : 'hubot');
        it.description = [a.level, a.model].filter(Boolean).join(' · ');
        it.tooltip = a.description || a.name;
        it.contextValue = 'agent';
        return it;
      }
      case 'orchestration': {
        const o = node.orch;
        const it = new vscode.TreeItem(o.name);
        it.iconPath = new vscode.ThemeIcon('type-hierarchy-sub');
        const steps = o.nodes.length;
        it.description = `${steps} paso${steps !== 1 ? 's' : ''}${o.lastExecutedAt ? ' · ' + timeAgo(o.lastExecutedAt) : ''}`;
        it.tooltip = [o.description, o.nodes.map(n => n.agentName).join(' → ')].filter(Boolean).join('\n');
        it.contextValue = 'orchestration';
        return it;
      }
      case 'execution': {
        const e = node.exec;
        const it = new vscode.TreeItem(e.orchName);
        const [icon, color] = STATUS_ICON[e.status] || ['circle-outline', ''];
        it.iconPath = new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined);
        it.description = `${e.status} · ${timeAgo(e.startedAt)}`;
        it.command = { command: 'agentHub.openExecution', title: 'Ver resultado', arguments: [e.orchestrationId, e.executionId] };
        return it;
      }
    }
  }
}
