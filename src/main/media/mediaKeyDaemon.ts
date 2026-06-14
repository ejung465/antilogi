import { spawn, type ChildProcess } from 'node:child_process'

// Resident JXA daemon: reads NX key codes (one per line) from stdin and posts
// the matching NSSystemDefined media-key event pair via CGEventPost. osascript
// ships with macOS, so nothing is compiled or bundled; keeping one process
// alive avoids ~150 ms of spawn latency per keypress. Posting system events
// requires the host app (Electron in dev, AntiLogi.app when packaged) to hold
// Accessibility permission — without it the events are silently dropped, which
// is why MediaController checks permission before choosing this path.
const JXA_DAEMON = `
ObjC.import('Cocoa');
function tap(code) {
  function ev(down) {
    var data1 = (code << 16) | ((down ? 0x0a : 0x0b) << 8);
    return $.NSEvent.otherEventWithTypeLocationModifierFlagsTimestampWindowNumberContextSubtypeData1Data2(
      14, {x: 0, y: 0}, 0, 0, 0, 0, 8, data1, -1);
  }
  $.CGEventPost(4, ev(true).CGEvent);
  $.CGEventPost(4, ev(false).CGEvent);
}
var stdin = $.NSFileHandle.fileHandleWithStandardInput;
while (true) {
  var chunk = stdin.availableData;
  if (!chunk || chunk.length === 0) break;
  var text = $.NSString.alloc.initWithDataEncoding(chunk, 4).js;
  var lines = text.split('\\n');
  for (var i = 0; i < lines.length; i++) {
    var code = parseInt(lines[i], 10);
    if (!isNaN(code)) tap(code);
  }
}
`

export class MediaKeyDaemon {
  private child: ChildProcess | null = null
  private disposed = false

  constructor(private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void) {}

  private ensure(): ChildProcess | null {
    if (this.disposed) return null
    if (this.child && this.child.exitCode === null && !this.child.killed) return this.child
    try {
      const child = spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', JXA_DAEMON], {
        stdio: ['pipe', 'ignore', 'pipe']
      })
      child.stderr?.on('data', (d: Buffer) => this.log('warn', `media daemon: ${d.toString().trim()}`))
      child.on('exit', (code) => {
        if (!this.disposed && code !== 0 && code !== null) {
          this.log('warn', `media daemon exited with code ${code}`)
        }
        if (this.child === child) this.child = null
      })
      child.on('error', (err) => {
        this.log('error', `media daemon failed to start: ${err.message}`)
        if (this.child === child) this.child = null
      })
      this.child = child
      return child
    } catch (err) {
      this.log('error', `media daemon spawn failed: ${(err as Error).message}`)
      return null
    }
  }

  /** Returns false when the daemon is unavailable — caller should fall back. */
  send(nxCode: number): boolean {
    const child = this.ensure()
    if (!child?.stdin?.writable) return false
    try {
      child.stdin.write(`${nxCode}\n`)
      return true
    } catch {
      return false
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.child) {
      try {
        this.child.stdin?.end()
        this.child.kill()
      } catch {
        // already gone
      }
      this.child = null
    }
  }
}
