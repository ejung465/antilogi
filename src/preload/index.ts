import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type AppState,
  type EngineSettings,
  type Mappings,
  type MediaAction,
  type PermissionKind,
  type PushChannel
} from '../shared/types'

const PUSH_CHANNELS: ReadonlySet<string> = new Set([
  IPC.PushDevice,
  IPC.PushPermissions,
  IPC.PushGesture,
  IPC.PushMedia,
  IPC.PushLog
])

const api = {
  getState: (): Promise<AppState> => ipcRenderer.invoke(IPC.GetState),
  setMappings: (mappings: Partial<Mappings>): Promise<void> => ipcRenderer.invoke(IPC.SetMappings, mappings),
  setEngine: (engine: Partial<EngineSettings>): Promise<void> => ipcRenderer.invoke(IPC.SetEngine, engine),
  rescan: (): Promise<void> => ipcRenderer.invoke(IPC.Rescan),
  openPermission: (kind: PermissionKind): Promise<void> => ipcRenderer.invoke(IPC.OpenPermission, kind),
  testAction: (action: MediaAction): Promise<void> => ipcRenderer.invoke(IPC.TestAction, action),
  on: (channel: PushChannel, listener: (payload: unknown) => void): (() => void) => {
    if (!PUSH_CHANNELS.has(channel)) throw new Error(`unknown push channel: ${channel}`)
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
}

contextBridge.exposeInMainWorld('antilogi', api)
