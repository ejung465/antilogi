# AntiLogi

Local-first replacement for Logitech Options+ on macOS (Apple Silicon), focused on the
**M720 Triathlon** thumb "gesture" button. The app speaks raw **HID++ 2.0** to the
mouse, diverts the gesture button (CID `0x00D0`) inside the firmware — so macOS never
sees its default behavior — and maps press / swipe ↑ ↓ ← → to native media controls.

See [PLAN.md](PLAN.md) for the architecture, the HID++ byte-level cheat-sheet, and the
phased build plan.

## Prerequisites

- macOS on Apple Silicon (built and tested on arm64)
- Node 20+ (`node-hid` ships darwin-arm64 N-API prebuilds; `node-mac-permissions`
  compiles with the Xcode Command Line Tools)
- **Quit Logitech software first.** If Logi Options+ / LogiMgr is running it will
  re-assert its own button table and fight this app. `npm run probe` warns if it
  spots one.

## Quickstart

```bash
npm install
npm run probe   # hardware ground truth — no GUI, safe to run any time
npm run dev     # launch the app with hot reload
```

`npm run probe` tells you in a few seconds which transport works (Unifying receiver
→ usagePage `0xFF00`, direct Bluetooth → usagePage `0xFF43`), whether macOS lets us
open it, and whether CID `0x00D0` is in the mouse's control table. If the mouse is
asleep, wiggle it and re-run.

## Permissions (one-time)

| Permission | Why | Where |
|---|---|---|
| **Input Monitoring** | **required** — opening the M720's HID interface to read/divert the button | System Settings → Privacy & Security → Input Monitoring |
| **Bluetooth** | **required** — writing HID++ (`setCidReporting`) to the BLE mouse; without it the write is `kIOReturnNotPermitted` | System Settings → Privacy & Security → Bluetooth |
| **Accessibility** | posting NX media-key events (`CGEventPost`). Optional — volume/play-pause fall back to AppleScript without it | System Settings → Privacy & Security → Accessibility |

**Granting (important):** Bluetooth auto-prompts on first launch — click Allow. **Input Monitoring usually must be added manually:** open System Settings → Privacy & Security → Input Monitoring, click **`+`**, and browse to `/Applications/AntiLogi.app`. Enable the toggle, then choose **Quit & Reopen** (or relaunch). The bundled HID helper, spawned by AntiLogi, inherits both grants via responsible-process attribution — so you grant the app, not a separate helper.

Both have Grant buttons in the app. **Dev-mode gotcha:** TCC attributes permissions
to the *binary*, which under `npm run dev` is **"Electron"** (from `node_modules`),
not "AntiLogi" and not your terminal — though your terminal may *also* need Input
Monitoring for `npm run probe`. Restart the app after granting. A packaged build
(`npm run build:mac`) has its own stable identity, which is the long-term fix.

Until Accessibility is granted the app still works in degraded mode: volume changes
go through AppleScript (`set volume`), play/pause/next/previous target Spotify or
Music directly (triggering macOS's per-app Automation consent on first use).

## How it works

Over Bluetooth, `node-hid` **cannot** open the M720 on macOS — its open path is
rejected. So the HID work runs in a small native Swift helper
(`native/hid-helper.swift` → `antilogi-hid-helper`), bundled into the app and
spawned by the Electron main process; they talk newline-delimited JSON over stdio.

1. The helper opens the mouse's single IOHIDDevice via the **registry path**
   (`IOServiceMatching("IOHIDDevice")` → `IOHIDDeviceOpen`). Opening via
   `IOHIDManagerOpen` *and* `IOHIDDeviceOpen` double-opens and breaks writes.
2. It engages Bluetooth (CoreBluetooth `CBCentralManager`, waits for `poweredOn`)
   — HID++ **writes** require the Bluetooth grant.
3. HID++ handshake: `IRoot.getProtocolVersion` ping, resolve feature `0x1B04`
   (Reprogrammable Controls v4), confirm CID `0x00D0` is in the control table,
   then `setCidReporting(cid, divert | rawXY)`.
4. The thumb button now emits only HID++ notifications: `divertedButtonsEvent`
   (press/release) and `divertedRawMouseXYEvent` (int16 dx/dy while held). The
   helper streams these as JSON; `helperBridge.ts` re-emits them to the engine.
5. The gesture engine classifies tap vs swipe (dominant axis); volume mappings
   repeat every *N* counts during the drag, transport mappings fire on release.
6. Media output: a resident `osascript -l JavaScript` daemon posts
   `NSSystemDefined` media-key events via `CGEventPost` (needs Accessibility),
   with an AppleScript fallback (`set volume`, Spotify/Music transport) otherwise.
7. The helper is a child of AntiLogi, so its Input Monitoring + Bluetooth checks
   attribute to the app. On quit it un-diverts the button, restoring stock behavior.

Mappings and tuning persist in `~/Library/Application Support/antilogi/config.json`.

### Build the native helper

`npm run build:helper` compiles the Swift helper (run automatically by
`npm run dev` and `npm run build`). Requires the Xcode Command Line Tools.

## Scripts

| Command | What |
|---|---|
| `npm run dev` | electron-vite dev mode with renderer HMR |
| `npm run probe` | standalone HID++ diagnostic (works without the app) |
| `npm run typecheck` | strict TS over main/preload/shared and renderer |
| `npm run build` | typecheck + production bundles into `out/` |
| `npm run build:mac` | unsigned arm64 `.dmg` in `release/` |

Debugging: renderer DevTools via `Cmd+Opt+I`; main-process logs are prefixed
`[antilogi]` in the terminal and mirrored into the in-app **Live events** feed.

## Troubleshooting

| Symptom | Likely cause → fix |
|---|---|
| Device card stuck on *Searching* | Probe first. Receiver unplugged / BT not paired; or vendor collection hidden over BT → use the receiver. |
| *Permission blocked* | Over Bluetooth: grant **Bluetooth** (the app triggers the system prompt on first open attempt; for the CLI probe you must add your terminal in the pane manually — CLI denials are silent). Receiver/USB: grant **Input Monitoring**. Dev grants go to "Electron", packaged to AntiLogi. Then Rescan. |
| *Asleep / unreachable* | M720 power-saves aggressively. Move/click the mouse; the 4 s poll + receiver wake notification reconnect automatically. |
| Gestures appear in the feed but nothing happens | Accessibility missing (check the card) — or grant happened mid-session: restart the app. |
| Next/Previous ignored by your player | Some apps only honor the legacy codes: in `src/main/media/mediaController.ts` change `next: 17, previous: 18` to `19` / `20` (FAST/REWIND). |
| Button still does its old default | Logi Options+ agent is running and re-grabbing the device — quit it (`pgrep -fl logioptionsplus`). |
| Swipe up/down feel inverted | Swap the ↑/↓ mappings in the UI (HID y+ = toward you). |
| `npm install` fails on `node-mac-permissions` | Needs Xcode CLT: `xcode-select --install`. The app boots without the module (statuses read "unknown"). |

## Bluetooth interception on macOS (solved)

Full HID++ gesture diversion over Bluetooth **works** — confirmed on macOS 26 /
arm64 with all five gestures. The two things that make it work, both non-obvious:

1. **Use native IOHIDManager, not node-hid.** node-hid's open is rejected for the
   M720 over BT; `IOHIDDeviceOpen` via the registry path succeeds.
2. **Two permissions, attributed correctly.** Opening needs **Input Monitoring**;
   writing HID++ needs **Bluetooth** (engaged via CoreBluetooth). Running the HID
   code in a bundled helper spawned by AntiLogi lets it inherit both grants from
   the app via responsible-process attribution.

Caveats: the helper must run inside an `.app` bundle (a bare CLI binary using
CoreBluetooth is killed by TCC). Unsigned/adhoc builds lose their TCC grants on
every rebuild (new code-signing hash) — for stable grants across rebuilds, sign
with a real Developer ID. If you rebuild during development, re-add the app under
Input Monitoring (and `tccutil reset ListenEvent dev.local.antilogi` to clear the
stale entry).
