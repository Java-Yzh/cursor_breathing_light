import { contextBridge, ipcRenderer } from 'electron';

export type ActivityState = 'idle' | 'thinking' | 'coding';

export interface StatePayload {
  state: ActivityState;
  updated_at: number;
  source: string;
  conversation_id?: string;
}

contextBridge.exposeInMainWorld('breathingLight', {
  getState: (): Promise<StatePayload> => ipcRenderer.invoke('get-state'),
  onStateUpdate: (callback: (payload: StatePayload) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: StatePayload) =>
      callback(payload);
    ipcRenderer.on('state-update', handler);
    return () => ipcRenderer.removeListener('state-update', handler);
  },
  getPinned: (): Promise<boolean> => ipcRenderer.invoke('get-pinned'),
  setPinned: (pinned: boolean): Promise<boolean> =>
    ipcRenderer.invoke('set-pinned', pinned),
  onPinUpdate: (callback: (pinned: boolean) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, pinned: boolean) =>
      callback(pinned);
    ipcRenderer.on('pin-update', handler);
    return () => ipcRenderer.removeListener('pin-update', handler);
  },
  getScale: (): Promise<number> => ipcRenderer.invoke('get-scale'),
  setScale: (scale: number): Promise<number> => ipcRenderer.invoke('set-scale', scale),
  onScaleUpdate: (callback: (scale: number) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, scale: number) => callback(scale);
    ipcRenderer.on('scale-update', handler);
    return () => ipcRenderer.removeListener('scale-update', handler);
  },
  hidePopup: (): Promise<void> => ipcRenderer.invoke('hide-popup'),
  getFullscreen: (): Promise<boolean> => ipcRenderer.invoke('get-fullscreen'),
  toggleFullscreen: (): Promise<boolean> => ipcRenderer.invoke('toggle-fullscreen'),
  onFullscreenUpdate: (callback: (fullscreen: boolean) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, fullscreen: boolean) =>
      callback(fullscreen);
    ipcRenderer.on('fullscreen-update', handler);
    return () => ipcRenderer.removeListener('fullscreen-update', handler);
  },
});
