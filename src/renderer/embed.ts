// Agent Hub shown inside another app (the VS Code extension's webview), focused on one project's orchestrations:
//   /?embed=1&project=<id>&orch=<id>&mode=editor|execution|new
// No sidebar, statusbar or wizard; the project is fixed by the host.
const q = new URLSearchParams(window.location.search);

export const EMBED = q.get('embed') === '1'
  ? { project: q.get('project') || '', orch: q.get('orch'), mode: q.get('mode') as 'editor' | 'execution' | 'new' | null }
  : null;
