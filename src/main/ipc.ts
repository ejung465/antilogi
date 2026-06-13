import { BrowserWindow, ipcMain } from 'electron'
import {
  IPC,
  type AppState,
  type EngineSettings,
  type Mappings,
  type MediaAction,
  type PermissionKind,
  type PushChannel,
  type PushPayloads
} from '../shared/types'

export interface IpcDeps {
  getState: () => AppState
  setMappings: (mappings: Partial<Mappings>) => void
  setEngine: (engine: Partial<EngineSettings>) => Promise<void>
  rescan: () => Promise<void>
  openPermission: (kind: PermissionKind) => Promise<void>
  testAction: (action: MediaAction) => Promise<void>
}

export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle(IPC.GetState, () => deps.getState())
  ipcMain.handle(IPC.SetMappings, (_e, mappings: Partial<Mappings>) => deps.setMappings(mappings))
  ipcMain.handle(IPC.SetEngine, (_e, engine: Partial<EngineSettings>) => deps.setEngine(engine))
  ipcMain.handle(IPC.Rescan, () => deps.rescan())
  ipcMain.handle(IPC.OpenPermission, (_e, kind: PermissionKind) => deps.openPermission(kind))
  ipcMain.handle(IPC.TestAction, (_e, action: MediaAction) => deps.testAction(action))
}

export function push<C extends PushChannel>(channel: C, payload: PushPayloads[C]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}
