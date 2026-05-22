// Thin wrapper around window.api (preload context bridge)
// Returns no-ops when running outside Electron (e.g. browser dev)

const api = (typeof window !== 'undefined' && (window as any).api) || null;

export function useElectron() {
  return {
    getVersion:    (): Promise<string>      => api?.getVersion()      ?? Promise.resolve('dev'),
    getAppDir:     (): Promise<string>      => api?.getAppDir()       ?? Promise.resolve(''),
    isDev:         (): Promise<boolean>     => api?.isDev()           ?? Promise.resolve(true),
    minimize:      ()                       => api?.minimize(),
    hide:          ()                       => api?.hide(),
    openPath:      (p: string)              => api?.openPath(p),
    openExternal:  (url: string)            => api?.openExternal(url),
    openVSCode:    (p: string)              => api?.openVSCode(p),
    pickFolder:    (): Promise<string|null> => api?.pickFolder()      ?? Promise.resolve(null),
    checkForUpdate:()                       => api?.checkForUpdate?.(),
    downloadUpdate:()                       => api?.downloadUpdate?.(),
    installUpdate: ()                       => api?.installUpdate?.(),
    onUpdateAvailable: (cb: (info: any) => void) => api?.onUpdateAvailable?.(cb),
    onUpdateProgress:  (cb: (pct: number) => void) => api?.onUpdateProgress?.(cb),
    onUpdateReady:     (cb: () => void)     => api?.onUpdateReady?.(cb),
    onUpdateError:     (cb: (msg: string) => void) => api?.onUpdateError?.(cb),
  };
}
