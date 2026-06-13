// Shared contract between main, preload and renderer.

export type MediaAction = 'none' | 'playpause' | 'next' | 'previous' | 'volup' | 'voldown' | 'mute'

export type GestureDirection = 'click' | 'up' | 'down' | 'left' | 'right'

export type Mappings = Record<GestureDirection, MediaAction>

export const DEFAULT_MAPPINGS: Mappings = {
  click: 'playpause',
  up: 'volup',
  down: 'voldown',
  left: 'previous',
  right: 'next'
}

export const MEDIA_ACTION_LABELS: Record<MediaAction, string> = {
  none: 'Do nothing',
  playpause: 'Play / Pause',
  next: 'Next track',
  previous: 'Previous track',
  volup: 'Volume up',
  voldown: 'Volume down',
  mute: 'Mute toggle'
}

export type AuthState = 'authorized' | 'denied' | 'restricted' | 'not determined' | 'unknown'

export interface PermissionsState {
  accessibility: AuthState
  inputMonitoring: AuthState
  /** Gates opening Bluetooth-LE HID devices (the direct-BT path to the M720). */
  bluetooth: AuthState
}

export type PermissionKind = 'accessibility' | 'input-monitoring' | 'bluetooth'

export type DeviceConnState = 'searching' | 'connected' | 'unreachable' | 'permission-blocked' | 'error'

export interface DeviceState {
  state: DeviceConnState
  name?: string
  transport?: 'unifying' | 'bluetooth' | 'usb'
  detail?: string
}

export interface EngineSettings {
  /** Counts of motion below which a press+release counts as a tap, not a swipe. */
  tapThreshold: number
  /** Counts of motion per repeated volume step while dragging. */
  volumeInterval: number
  /** HID++ control id being diverted (0x00D0 = M720 thumb gesture button). */
  cid: number
}

export interface AppState {
  device: DeviceState
  permissions: PermissionsState
  mappings: Mappings
  engine: EngineSettings
}

export interface GestureEvent {
  direction: GestureDirection
  action: MediaAction
  at: number
}

export interface MediaFiredEvent {
  action: MediaAction
  via: 'media-keys' | 'applescript'
  at: number
}

export interface LogEntry {
  level: 'info' | 'warn' | 'error'
  msg: string
  at: number
}

export const IPC = {
  GetState: 'app:get-state',
  SetMappings: 'mappings:set',
  SetEngine: 'engine:set',
  Rescan: 'device:rescan',
  OpenPermission: 'permissions:open',
  TestAction: 'media:test',
  PushDevice: 'push:device',
  PushPermissions: 'push:permissions',
  PushGesture: 'push:gesture',
  PushMedia: 'push:media',
  PushLog: 'push:log'
} as const

export interface PushPayloads {
  'push:device': DeviceState
  'push:permissions': PermissionsState
  'push:gesture': GestureEvent
  'push:media': MediaFiredEvent
  'push:log': LogEntry
}

export type PushChannel = keyof PushPayloads
