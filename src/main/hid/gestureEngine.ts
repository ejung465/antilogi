import type { GestureDirection, Mappings, MediaAction } from '../../shared/types'

export interface GestureEngineDeps {
  mappings: () => Mappings
  tuning: () => { tapThreshold: number; volumeInterval: number }
  targetCid: () => number
  onAction: (direction: GestureDirection, action: MediaAction) => void
}

type SwipeDirection = Exclude<GestureDirection, 'click'>

const REPEATABLE: ReadonlySet<MediaAction> = new Set<MediaAction>(['volup', 'voldown'])

/**
 * Press → accumulate raw deltas → release state machine for the diverted button.
 *
 * Transport-style actions fire once on release: a small total displacement is a
 * tap ('click' mapping), otherwise the dominant axis picks the swipe mapping.
 * Volume-style actions instead repeat *while dragging*, once per volumeInterval
 * counts, so a long pull sweeps the volume continuously like Options+ does.
 */
export class GestureEngine {
  private pressed = false
  private accX = 0
  private accY = 0
  private repeatsFired = 0
  private consumed = 0
  private lastAxis: 'x' | 'y' | null = null

  constructor(private readonly deps: GestureEngineDeps) {}

  /** Feed from divertedButtonsEvent: the list of currently held diverted CIDs. */
  onButtons(heldCids: number[]): void {
    const held = heldCids.includes(this.deps.targetCid())
    if (held && !this.pressed) {
      this.pressed = true
      this.accX = 0
      this.accY = 0
      this.repeatsFired = 0
      this.consumed = 0
      this.lastAxis = null
    } else if (!held && this.pressed) {
      this.finish()
    }
  }

  /** Feed from divertedRawMouseXYEvent while the button is held. */
  onRawXY(dx: number, dy: number): void {
    if (!this.pressed) return
    this.accX += dx
    this.accY += dy
    const dominant = this.dominant()
    if (!dominant) return
    if (dominant.axis !== this.lastAxis) {
      this.lastAxis = dominant.axis
      this.consumed = 0
    }
    const action = this.deps.mappings()[dominant.dir]
    if (!REPEATABLE.has(action)) return
    const { volumeInterval } = this.deps.tuning()
    while (dominant.mag - this.consumed >= volumeInterval) {
      this.consumed += volumeInterval
      this.repeatsFired++
      this.deps.onAction(dominant.dir, action)
    }
  }

  /** Called when the device drops off so a stuck "pressed" state cannot linger. */
  reset(): void {
    this.pressed = false
    this.accX = 0
    this.accY = 0
    this.repeatsFired = 0
    this.consumed = 0
    this.lastAxis = null
  }

  private dominant(): { dir: SwipeDirection; mag: number; axis: 'x' | 'y' } | null {
    const ax = Math.abs(this.accX)
    const ay = Math.abs(this.accY)
    if (ax === 0 && ay === 0) return null
    if (ax >= ay) return { dir: this.accX > 0 ? 'right' : 'left', mag: ax, axis: 'x' }
    // HID convention: positive Y = pulling the mouse toward you.
    return { dir: this.accY > 0 ? 'down' : 'up', mag: ay, axis: 'y' }
  }

  private finish(): void {
    const { tapThreshold } = this.deps.tuning()
    const dominant = this.dominant()
    if (this.repeatsFired === 0) {
      if (!dominant || dominant.mag < tapThreshold) {
        this.deps.onAction('click', this.deps.mappings().click)
      } else {
        this.deps.onAction(dominant.dir, this.deps.mappings()[dominant.dir])
      }
    }
    this.reset()
  }
}
