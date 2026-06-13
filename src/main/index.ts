import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import {
  IPC,
  type AppState,
  type EngineSettings,
  type GestureEvent,
  type LogEntry,
  type Mappings
} from '../shared/types'
import { GestureEngine } from './hid/gestureEngine'
import { HelperBridge } from './hid/helperBridge'
import { push, registerIpc } from './ipc'
import { MediaController } from './media/mediaController'
import { Permissions } from './permissions'
import { ConfigStore, defaultConfigPath } from './store'

function log(level: LogEntry['level'], msg: string): void {
  const line = `[antilogi] ${level}: ${msg}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
  push(IPC.PushLog, { level, msg, at: Date.now() })
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 800,
    minHeight: 580,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0e1014',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    log('info', 'window shown')
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  // The renderer never loads remote content; anything that tries opens externally.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

async function bootstrap(): Promise<void> {
  const store = new ConfigStore(defaultConfigPath(app.getPath('userData')))

  const permissions = new Permissions(log)
  await permissions.init()
  // Register AntiLogi in the Input Monitoring list up front so the helper child
  // (which opens the HID device) inherits the grant via responsible-process.
  permissions.primeInputMonitoring()
  permissions.watch(2500, (state) => push(IPC.PushPermissions, state))

  const media = new MediaController({
    isAccessibilityGranted: () => permissions.isAccessibilityGranted(),
    log,
    onFired: (event) => push(IPC.PushMedia, event)
  })

  const engine = new GestureEngine({
    mappings: () => store.get().mappings,
    tuning: () => store.get().engine,
    targetCid: () => store.get().engine.cid,
    onAction: (direction, action) => {
      const event: GestureEvent = { direction, action, at: Date.now() }
      push(IPC.PushGesture, event)
      void media.perform(action)
    }
  })

  const devices = new HelperBridge({
    getCid: () => store.get().engine.cid,
    log,
    onPermissionSignal: (kind, state) => permissions.setHint(kind, state)
  })
  devices.on('state', (state) => push(IPC.PushDevice, state))
  devices.on('buttons', (cids: number[]) => engine.onButtons(cids))
  devices.on('rawxy', ({ dx, dy }: { dx: number; dy: number }) => engine.onRawXY(dx, dy))
  devices.on('released', () => engine.reset())

  registerIpc({
    getState: (): AppState => ({
      device: devices.state,
      permissions: permissions.current,
      mappings: store.get().mappings,
      engine: store.get().engine
    }),
    setMappings: (mappings: Partial<Mappings>) => {
      store.update({ mappings })
    },
    setEngine: async (engineSettings: Partial<EngineSettings>) => {
      const previousCid = store.get().engine.cid
      const next = store.update({ engine: engineSettings }).engine
      if (engineSettings.cid !== undefined && next.cid !== previousCid) {
        await devices.applyCid(previousCid, next.cid)
      }
    },
    rescan: () => devices.rescan(),
    openPermission: (kind) => permissions.request(kind),
    testAction: (action) => media.perform(action)
  })

  await devices.start()
  log('info', 'main ready')

  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    // Un-divert so the thumb button returns to stock behavior, then leave.
    void Promise.race([devices.dispose(), new Promise((resolve) => setTimeout(resolve, 1200))]).finally(() => {
      media.dispose()
      permissions.dispose()
      app.quit()
    })
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    } else {
      createWindow()
    }
  })

  void app.whenReady().then(() => {
    createWindow()
    void bootstrap()
  })

  // Keep remapping in the background when the window closes (standard macOS
  // behavior); quitting the app entirely is what un-diverts the button.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}
