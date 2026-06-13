import { shell, systemPreferences } from 'electron'
import type { AuthState, PermissionKind, PermissionsState } from '../shared/types'

interface NodeMacPermissions {
  getAuthStatus: (type: string) => string
  askForAccessibilityAccess?: () => void
  askForInputMonitoringAccess?: (type?: string) => unknown
  askForBluetoothAccess?: () => unknown
}

const PANE_URLS: Record<PermissionKind, string> = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  'input-monitoring': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
  bluetooth: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Bluetooth'
}

/**
 * Permission status with two backends:
 *
 * 1. node-mac-permissions (primary) — fine-grained TCC status incl. "denied".
 *    Built via scripts/setup-permissions-module.mjs because its stock gyp file
 *    cannot compile from a path containing spaces.
 * 2. Electron built-ins (fallback) — systemPreferences.isTrustedAccessibilityClient
 *    is the same AXIsProcessTrusted gate CGEventPost checks, and passing true
 *    shows the native OS prompt.
 *
 * Three TCC services matter here (verified on this machine):
 * - accessibility    → posting media-key events (CGEventPost)
 * - bluetooth        → opening the BLE HID vendor collection (direct-BT M720);
 *                      CLI processes are silently denied, proper .app bundles
 *                      get the system prompt on first open attempt
 * - input-monitoring → opening HID interfaces on some macOS builds/transports
 *
 * Input Monitoring and Bluetooth additionally take ground-truth hints from
 * DeviceManager: if an open succeeds on a transport, that gate is effectively
 * passed regardless of what TCC's per-binary table claims.
 *
 * Dev-mode caveat: TCC attributes grants to the *binary*, which under
 * `npm run dev` is "Electron" (inside node_modules), not "AntiLogi" and not
 * your terminal. The packaged app has its own stable identity.
 */
export class Permissions {
  private mod: NodeMacPermissions | null = null
  private timer: NodeJS.Timeout | null = null
  private hints: Partial<Record<'input-monitoring' | 'bluetooth', AuthState>> = {}
  private last: PermissionsState = { accessibility: 'unknown', inputMonitoring: 'unknown', bluetooth: 'unknown' }

  constructor(private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void) {}

  async init(): Promise<void> {
    try {
      this.mod = (await import('node-mac-permissions')) as unknown as NodeMacPermissions
      this.log('info', 'permissions backend: node-mac-permissions (native TCC status)')
    } catch (err) {
      this.log(
        'warn',
        `node-mac-permissions unavailable (${(err as Error).message}) — using Electron built-ins; run "npm run setup:permissions" to enable it`
      )
    }
    this.last = this.read()
  }

  read(): PermissionsState {
    const norm = (v: string): AuthState =>
      v === 'authorized' || v === 'denied' || v === 'restricted' || v === 'not determined' ? v : 'unknown'

    let accessibility: AuthState = 'unknown'
    if (this.mod) {
      try {
        accessibility = norm(this.mod.getAuthStatus('accessibility'))
      } catch {
        accessibility = this.readAccessibilityNative()
      }
    } else {
      accessibility = this.readAccessibilityNative()
    }

    const merged = (kind: 'input-monitoring' | 'bluetooth'): AuthState => {
      const hint = this.hints[kind]
      if (hint === 'authorized') return hint // an open succeeded — operational truth wins
      let tcc: AuthState = 'unknown'
      if (this.mod) {
        try {
          tcc = norm(this.mod.getAuthStatus(kind))
        } catch {
          // keep unknown
        }
      }
      if (tcc !== 'unknown') return tcc
      return hint ?? 'unknown'
    }

    return { accessibility, inputMonitoring: merged('input-monitoring'), bluetooth: merged('bluetooth') }
  }

  private readAccessibilityNative(): AuthState {
    try {
      return systemPreferences.isTrustedAccessibilityClient(false) ? 'authorized' : 'not determined'
    } catch {
      return 'unknown'
    }
  }

  /** DeviceManager reports operational truth: HID opens worked or were blocked. */
  setHint(kind: 'input-monitoring' | 'bluetooth', state: 'authorized' | 'denied'): void {
    this.hints[kind] = state
  }

  /**
   * Register the Electron main process in the Input Monitoring list at startup so
   * "AntiLogi" appears there for the user to enable — the helper child then
   * inherits that grant via responsible-process attribution. Idempotent: macOS
   * only shows the prompt while undetermined, otherwise this just ensures listing.
   */
  primeInputMonitoring(): void {
    try {
      this.mod?.askForInputMonitoringAccess?.('listen')
    } catch (err) {
      this.log('warn', `priming input monitoring failed: ${(err as Error).message}`)
    }
  }

  get current(): PermissionsState {
    return this.last
  }

  isAccessibilityGranted(): boolean {
    return this.last.accessibility === 'authorized'
  }

  watch(intervalMs: number, onChange: (state: PermissionsState) => void): void {
    this.timer = setInterval(() => {
      const next = this.read()
      const changed =
        next.accessibility !== this.last.accessibility ||
        next.inputMonitoring !== this.last.inputMonitoring ||
        next.bluetooth !== this.last.bluetooth
      this.last = next
      if (changed) onChange(next)
    }, intervalMs)
  }

  async request(kind: PermissionKind): Promise<void> {
    const current =
      kind === 'accessibility'
        ? this.last.accessibility
        : kind === 'bluetooth'
          ? this.last.bluetooth
          : this.last.inputMonitoring
    // Always invoke the native request API first. Even when macOS won't re-show
    // the prompt (already determined), the call registers THIS app (the Electron
    // main process) in the relevant privacy list so the user can toggle it on —
    // which is what the helper child then inherits via responsible-process. The
    // `current` hint can read "denied" from the helper's failed open even when the
    // main app has never been registered, so we must not gate on it.
    void current
    try {
      if (kind === 'accessibility') {
        if (this.mod?.askForAccessibilityAccess) this.mod.askForAccessibilityAccess()
        else systemPreferences.isTrustedAccessibilityClient(true)
      } else if (kind === 'input-monitoring' && this.mod?.askForInputMonitoringAccess) {
        this.mod.askForInputMonitoringAccess('listen')
      } else if (kind === 'bluetooth' && this.mod?.askForBluetoothAccess) {
        this.mod.askForBluetoothAccess()
      }
    } catch (err) {
      this.log('warn', `native permission prompt failed: ${(err as Error).message}`)
    }
    // Also open the exact pane so the user can flip the toggle if no prompt shows.
    await shell.openExternal(PANE_URLS[kind])
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
  }
}
