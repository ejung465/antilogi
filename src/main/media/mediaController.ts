import { execFile } from 'node:child_process'
import type { MediaAction, MediaFiredEvent } from '../../shared/types'
import { MediaKeyDaemon } from './mediaKeyDaemon'

// NX_KEYTYPE_* from IOKit/hidsystem/ev_keymap.h. These drive the system-wide
// "Now Playing" session (any media app) and show the native volume HUD.
// If a particular player ignores next/previous (17/18), the legacy scan codes
// are FAST = 19 and REWIND = 20 — a one-line swap here.
const NX_CODES: Record<Exclude<MediaAction, 'none'>, number> = {
  volup: 0,
  voldown: 1,
  mute: 7,
  playpause: 16,
  next: 17,
  previous: 18
}

function transportScript(verb: string): string {
  // `is running` does not launch the app; targeting an app triggers macOS's
  // per-app Automation consent prompt on first use (separate from Accessibility).
  return [
    'if application "Spotify" is running then',
    `\ttell application "Spotify" to ${verb}`,
    'else if application "Music" is running then',
    `\ttell application "Music" to ${verb}`,
    'end if'
  ].join('\n')
}

function volumeScript(delta: number): string {
  return [
    `set v to (output volume of (get volume settings)) + ${delta}`,
    'if v > 100 then set v to 100',
    'if v < 0 then set v to 0',
    'set volume output volume v'
  ].join('\n')
}

// Used while Accessibility has not been granted yet: system volume works
// unconditionally; transport control works for Spotify/Music via Apple events.
const APPLESCRIPT_FALLBACKS: Record<Exclude<MediaAction, 'none'>, string> = {
  volup: volumeScript(7),
  voldown: volumeScript(-7),
  mute: 'set volume output muted (not (output muted of (get volume settings)))',
  playpause: transportScript('playpause'),
  next: transportScript('next track'),
  previous: transportScript('previous track')
}

export class MediaController {
  private readonly daemon: MediaKeyDaemon

  constructor(
    private readonly deps: {
      isAccessibilityGranted: () => boolean
      log: (level: 'info' | 'warn' | 'error', msg: string) => void
      onFired: (event: MediaFiredEvent) => void
    }
  ) {
    this.daemon = new MediaKeyDaemon(deps.log)
  }

  async perform(action: MediaAction): Promise<void> {
    if (action === 'none') return
    if (this.deps.isAccessibilityGranted() && this.daemon.send(NX_CODES[action])) {
      this.deps.onFired({ action, via: 'media-keys', at: Date.now() })
      return
    }
    try {
      await this.runAppleScript(APPLESCRIPT_FALLBACKS[action])
      this.deps.onFired({ action, via: 'applescript', at: Date.now() })
    } catch (err) {
      this.deps.log('error', `media action "${action}" failed: ${(err as Error).message}`)
    }
  }

  private runAppleScript(script: string): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile('/usr/bin/osascript', ['-e', script], { timeout: 5000 }, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  dispose(): void {
    this.daemon.dispose()
  }
}
