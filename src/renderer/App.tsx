import React, { lazy, Suspense, useEffect, useState } from 'react';
import { useStore } from './store';
import { req } from './api';
import { Sidebar } from './components/layout/Sidebar';
import { Statusbar } from './components/layout/Statusbar';
import { ToastContainer } from './components/ui/Toast';
import { Wizard } from './components/ui/Wizard';
import { CloseDialog } from './components/ui/CloseDialog';
import type { Config, Project } from './types';
import { EMBED } from './embed';

const Dashboard      = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Projects       = lazy(() => import('./pages/Projects').then((m) => ({ default: m.Projects })));
const Agents         = lazy(() => import('./pages/Agents').then((m) => ({ default: m.Agents })));
const Chat           = lazy(() => import('./pages/Chat').then((m) => ({ default: m.Chat })));
const Settings       = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const Orchestrations = lazy(() => import('./pages/Orchestrations').then((m) => ({ default: m.Orchestrations })));

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, color: '#fb7185', fontFamily: 'monospace', fontSize: 13 }}>
          <strong>Error de renderizado:</strong>
          <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
            {(this.state.error as Error).message}
            {'\n'}
            {(this.state.error as Error).stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppInner() {
  const view        = useStore((s) => s.view);
  const setConfig   = useStore((s) => s.setConfig);
  const setProjects = useStore((s) => s.setProjects);
  const setVersion  = useStore((s) => s.setAppVersion);
  const addToast    = useStore((s) => s.addToast);

  const showWizard    = useStore((s) => s.showWizard);
  const setShowWizard = useStore((s) => s.setShowWizard);

  const [showCloseDialog, setShowCloseDialog] = useState(false);

  useEffect(() => {
    const api = (window as any).api;
    api?.getVersion?.().then((v: string) => setVersion(v));

    req<Config>('GET', '/config')
      .then((cfg) => {
        setConfig(cfg);
      })
      .catch(() => addToast('Error al cargar la configuración', 'err'));

    req<Project[]>('GET', '/projects')
      .then((projects) => setProjects(projects))
      .catch(() => {});

    api?.onCloseRequested?.(() => setShowCloseDialog(true));
  }, []);

  return (
    <div id="app" className={EMBED ? 'embed' : undefined}>
      {!EMBED && <Sidebar />}
      <div className="main">
        <Suspense fallback={null}>
          {view === 'dashboard'      && <Dashboard />}
          {view === 'projects'       && <Projects />}
          {view === 'agents'         && <Agents />}
          {view === 'chat'           && <Chat />}
          {view === 'settings'       && <Settings />}
          {view === 'orchestrations' && <Orchestrations />}
        </Suspense>
        {!EMBED && <Statusbar />}
      </div>
      <ToastContainer />
      {showWizard && <Wizard onDone={() => setShowWizard(false)} />}
      {showCloseDialog && (
        <CloseDialog
          onRespond={(action, remember) => {
            setShowCloseDialog(false);
            (window as any).api?.closeResponse?.(action, remember);
          }}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
