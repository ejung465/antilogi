import type { AuthState, DeviceState, PermissionKind } from '../../shared/types'
import { EventFeed } from './components/EventFeed'
import { MappingMatrix } from './components/MappingMatrix'
import { Pill, StatusCard, type PillTone } from './components/StatusCard'
import { TuningCard } from './components/TuningCard'
import { useBridge } from './hooks/useBridge'

const DEVICE_LABELS: Record<DeviceState['state'], { tone: PillTone; label: string }> = {
  connected: { tone: 'ok', label: 'Connected' },
  searching: { tone: 'idle', label: 'Searching…' },
  unreachable: { tone: 'warn', label: 'Asleep / unreachable' },
  'permission-blocked': { tone: 'bad', label: 'Permission blocked' },
  error: { tone: 'bad', label: 'Error' }
}

const TRANSPORT_LABELS = {
  unifying: 'via Unifying receiver',
  bluetooth: 'via Bluetooth',
  usb: 'via USB'
} as const

function PermissionRow({
  label,
  hint,
  state,
  onGrant
}: {
  label: string
  hint: string
  state: AuthState
  onGrant: () => void
}) {
  const tone: PillTone = state === 'authorized' ? 'ok' : state === 'denied' ? 'bad' : state === 'unknown' ? 'idle' : 'warn'
  return (
    <div className="perm-row">
      <div className="perm-info">
        <span>{label}</span>
        <small>{hint}</small>
      </div>
      <div className="perm-actions">
        <Pill tone={tone} label={state} />
        {state !== 'authorized' ? (
          <button className="ghost" onClick={onGrant}>
            Grant…
          </button>
        ) : null}
      </div>
    </div>
  )
}

export default function App() {
  const { state, feed, setMapping, setEngine, rescan, test, openPermission } = useBridge()
  const device = state.device
  const badge = DEVICE_LABELS[device.state]
  const grant = (kind: PermissionKind) => () => openPermission(kind)

  return (
    <div className="app">
      <header className="titlebar">
        <span className="brand">AntiLogi</span>
        <span className="sub">M720 Triathlon gesture remapper</span>
      </header>

      <main>
        <div className="grid2">
          <StatusCard
            title="Device"
            pill={<Pill tone={badge.tone} label={badge.label} />}
            action={
              <button className="ghost" onClick={rescan}>
                Rescan
              </button>
            }
          >
            <p className="big">{device.name ?? 'Logitech M720 Triathlon'}</p>
            <p className="muted">{device.transport ? TRANSPORT_LABELS[device.transport] : 'no transport yet'}</p>
            {device.detail ? <p className="muted small">{device.detail}</p> : null}
          </StatusCard>

          <StatusCard title="macOS permissions">
            <PermissionRow
              label="Accessibility"
              hint="required to post media-key events system-wide"
              state={state.permissions.accessibility}
              onGrant={grant('accessibility')}
            />
            <PermissionRow
              label="Bluetooth"
              hint="gates opening the BLE HID device when connected without a receiver"
              state={state.permissions.bluetooth}
              onGrant={grant('bluetooth')}
            />
            <PermissionRow
              label="Input Monitoring"
              hint="needed on some macOS versions to open the HID++ interface"
              state={state.permissions.inputMonitoring}
              onGrant={grant('input-monitoring')}
            />
            <p className="muted small">
              In dev mode macOS lists this app as “Electron”. Re-launch after granting.
            </p>
          </StatusCard>
        </div>

        <div className="grid2">
          <StatusCard title="Gesture mappings">
            <MappingMatrix mappings={state.mappings} onChange={setMapping} onTest={test} />
          </StatusCard>
          <TuningCard engine={state.engine} onChange={setEngine} />
        </div>

        <StatusCard title="Live events" className="card-feed">
          <EventFeed items={feed} />
        </StatusCard>
      </main>
    </div>
  )
}
