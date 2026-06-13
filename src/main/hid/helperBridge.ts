import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { DeviceState } from '../../shared/types'

export interface HelperBridgeOptions {
  getCid: () => number
  log: (level: 'info' | 'warn' | 'error', msg: string) => void
  /** Operational TCC feedback derived from the helper's behavior. */
  onPermissionSignal?: (kind: 'input-monitoring' | 'bluetooth', state: 'authorized' | 'denied') => void
}

interface HelperEvent {
  t: string
  // device
  state?: string
  name?: string
  transport?: string
  detail?: string
  // buttons / rawxy
  cids?: number[]
  dx?: number
  dy?: number
  // perm
  bluetooth?: number
  inputMonitoring?: number
  openBlocked?: boolean
  // log
  level?: 'info' | 'warn' | 'error'
  msg?: string
}

const RESPAWN_DELAY_MS = 2000

/**
 * Spawns and supervises the native Swift HID++ helper, translating its
 * newline-JSON event stream into the same EventEmitter surface DeviceManager
 * exposed ('state' | 'buttons' | 'rawxy' | 'released'). The helper does the
 * IOHID + HID++ diversion node-hid can't do over Bluetooth.
 *
 * The helper is spawned as a child of the Electron app, so its Input Monitoring
 * and Bluetooth TCC checks attribute to AntiLogi (the responsible process) —
 * which is why those grants belong on the app, not a separate helper entry.
 */
export class HelperBridge extends EventEmitter {
  state: DeviceState = { state: 'searching' }

  private child: ChildProcess | null = null
  private buf = ''
  private disposed = false
  private respawnTimer: NodeJS.Timeout | null = null

  constructor(private readonly opts: HelperBridgeOptions) {
    super()
  }

  private helperPath(): string {
    // Packaged: bundled into Contents/Resources via electron-builder extraResources.
    const packaged = join(process.resourcesPath, 'antilogi-hid-helper')
    if (app.isPackaged && existsSync(packaged)) return packaged
    // Dev: compiled by scripts/build-helper.mjs.
    return join(app.getAppPath(), 'native', 'build', 'antilogi-hid-helper')
  }

  async start(): Promise<void> {
    this.spawnHelper()
  }

  private spawnHelper(): void {
    if (this.disposed) return
    const path = this.helperPath()
    if (!existsSync(path)) {
      this.opts.log('error', `native helper missing at ${path} — run "npm run build:helper"`)
      this.setState({ state: 'error', detail: 'Native HID helper not built. Run npm run build:helper.' })
      return
    }
    let child: ChildProcess
    try {
      child = spawn(path, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      this.opts.log('error', `failed to spawn helper: ${(err as Error).message}`)
      this.scheduleRespawn()
      return
    }
    this.child = child
    this.buf = ''

    child.stdout?.on('data', (d: Buffer) => this.onStdout(d))
    child.stderr?.on('data', (d: Buffer) => this.opts.log('warn', `helper stderr: ${d.toString().trim()}`))
    child.on('exit', (code, signal) => {
      if (this.disposed) return
      this.opts.log('warn', `helper exited (code=${code} signal=${signal}) — respawning`)
      this.child = null
      this.setState({ state: 'searching', detail: 'HID helper restarting…' })
      this.scheduleRespawn()
    })
    child.on('error', (err) => {
      this.opts.log('error', `helper process error: ${err.message}`)
    })
  }

  private scheduleRespawn(): void {
    if (this.disposed || this.respawnTimer) return
    this.respawnTimer = setTimeout(() => {
      this.respawnTimer = null
      this.spawnHelper()
    }, RESPAWN_DELAY_MS)
  }

  private send(obj: Record<string, unknown>): void {
    if (this.child?.stdin?.writable) {
      try {
        this.child.stdin.write(JSON.stringify(obj) + '\n')
      } catch {
        // pipe closed; exit handler will respawn
      }
    }
  }

  private onStdout(chunk: Buffer): void {
    this.buf += chunk.toString('utf8')
    let idx: number
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim()
      this.buf = this.buf.slice(idx + 1)
      if (!line) continue
      let evt: HelperEvent
      try {
        evt = JSON.parse(line) as HelperEvent
      } catch {
        this.opts.log('warn', `helper non-JSON line: ${line}`)
        continue
      }
      this.handle(evt)
    }
  }

  private handle(evt: HelperEvent): void {
    switch (evt.t) {
      case 'ready':
        this.send({ cmd: 'setcid', cid: this.opts.getCid() })
        this.send({ cmd: 'rescan' })
        break
      case 'device': {
        const next: DeviceState = {
          state: (evt.state as DeviceState['state']) ?? 'searching',
          name: evt.name,
          transport: evt.transport as DeviceState['transport'],
          detail: evt.detail
        }
        this.setState(next)
        // A successful connect means open (Input Monitoring) and HID++ writes
        // (Bluetooth) both worked — operational proof both grants are effective.
        if (next.state === 'connected') {
          this.opts.onPermissionSignal?.('input-monitoring', 'authorized')
          this.opts.onPermissionSignal?.('bluetooth', 'authorized')
        } else {
          this.emit('released')
        }
        break
      }
      case 'buttons':
        this.emit('buttons', evt.cids ?? [])
        break
      case 'rawxy':
        this.emit('rawxy', { dx: evt.dx ?? 0, dy: evt.dy ?? 0 })
        break
      case 'perm':
        // CBManagerAuthorization: 3 = allowedAlways.
        if (typeof evt.bluetooth === 'number') {
          this.opts.onPermissionSignal?.('bluetooth', evt.bluetooth === 3 ? 'authorized' : 'denied')
        }
        if (typeof evt.inputMonitoring === 'number') {
          this.opts.onPermissionSignal?.('input-monitoring', evt.inputMonitoring === 1 ? 'authorized' : 'denied')
        }
        if (evt.openBlocked) this.opts.onPermissionSignal?.('input-monitoring', 'denied')
        break
      case 'log':
        this.opts.log(evt.level ?? 'info', `helper: ${evt.msg ?? ''}`)
        break
      default:
        break
    }
  }

  private setState(state: DeviceState): void {
    this.state = state
    this.emit('state', state)
  }

  async rescan(): Promise<void> {
    this.send({ cmd: 'rescan' })
  }

  /** Tuning panel changed the diverted CID. */
  async applyCid(_prev: number, next: number): Promise<void> {
    this.send({ cmd: 'setcid', cid: next })
  }

  async dispose(): Promise<void> {
    this.disposed = true
    if (this.respawnTimer) clearTimeout(this.respawnTimer)
    const child = this.child
    this.child = null
    if (child) {
      // Ask the helper to un-divert + exit cleanly; force-kill if it lingers.
      try {
        child.stdin?.write(JSON.stringify({ cmd: 'shutdown' }) + '\n')
        child.stdin?.end()
      } catch {
        // ignore
      }
      await Promise.race([
        new Promise<void>((resolve) => child.once('exit', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 1000))
      ])
      if (child.exitCode === null) child.kill('SIGKILL')
    }
  }
}
