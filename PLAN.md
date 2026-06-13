# AntiLogi — Plan of Action

Local-first Electron app that replaces Logitech Options+ for the **M720 Triathlon** on
macOS (Apple Silicon). It speaks raw **HID++ 2.0** to the mouse, diverts the thumb
"gesture" button (**CID `0x00D0`**) at the *firmware* level, and translates
press / swipe-up / swipe-down / swipe-left / swipe-right into native macOS media
controls (Play-Pause, Volume ±, Mute, Next/Previous Track).

---

## 0. Architecture at a glance

```
┌─────────────────────────── Electron Main (Node, ARM64) ───────────────────────────┐
│                                                                                   │
│  DeviceManager ──► HidppChannel (node-hid HIDAsync)                               │
│   • enumerate VID 0x046D, usagePage 0xFF00 (receiver) / 0xFF43 (Bluetooth LE)     │
│   • ping device indexes, resolve feature 0x1B04 (Reprog Controls v4)              │
│   • setCidReporting(0xD0, divert+rawXY)  ← button never reaches macOS at all      │
│   • parse divertedButtonsEvent / divertedRawMouseXYEvent notifications            │
│        │                                                                          │
│        ▼                                                                          │
│  GestureEngine (press → accumulate dx/dy → release ⇒ click | up | down | l | r)   │
│        │                                                                          │
│        ▼                                                                          │
│  MediaController                                                                  │
│   • primary: resident `osascript -l JavaScript` daemon posting NX_SYSDEFINED      │
│     media-key events via CGEventPost  (needs Accessibility)                       │
│   • fallback: AppleScript (`set volume …`, `tell app "Spotify"/"Music" …`)        │
│                                                                                   │
│  Permissions (node-mac-permissions): Accessibility + Input Monitoring status/ask  │
│  ConfigStore (plain JSON in userData): mappings, thresholds, CID                  │
└────────────────────────────────────┬──────────────────────────────────────────────┘
                                     │ typed IPC (contextBridge, isolated preload)
┌────────────────────────────────────▼──────────────────────────────────────────────┐
│  React Renderer: device status pill, permission cards, mapping matrix,            │
│  tuning panel, live event feed                                                    │
└───────────────────────────────────────────────────────────────────────────────────┘
```

**Key design call:** we do *not* sniff mouse packets and suppress them with an event
tap. HID++ 2.0 feature `0x1B04` lets us tell the mouse itself to **divert** the
button: while diverted, the M720 stops emitting any native HID usage for CID 0xD0
and instead sends vendor-page HID++ notifications only we read. "Prevent default OS
behavior" is therefore guaranteed at the source, and every other button keeps
working normally.

---

## 1. Protocol cheat-sheet (what the bytes mean)

### Report framing
| Report | ID | Total len | Layout |
|---|---|---|---|
| Short | `0x10` | 7 | `[0x10, devIdx, featIdx/subId, (fn<<4)\|swId or addr, p0, p1, p2]` |
| Long | `0x11` | 20 | `[0x11, devIdx, featIdx, (fn<<4)\|swId, p0 … p15]` |

* `devIdx` = `0xFF` for a direct-connected (Bluetooth/USB) device *and* for the
  receiver itself; `0x01–0x06` = pairing slot when going through a Unifying receiver.
* We always send **long** reports to the mouse (BLE only supports long); receiver
  *registers* (HID++ 1.0) use short reports with subId `0x80`/`0x81`/`0x83`.
* Our software id (`swId`, low nibble of byte 3) = `0x0A`. Notifications arrive with
  swId `0`.
* Errors: byte2 == `0xFF` → HID++ 2.0 error (`[…, 0xFF, featIdx, fnsw, errCode]`);
  byte2 == `0x8F` → HID++ 1.0 error (this is also how a 1.0 receiver answers a 2.0
  ping, which is how we tell receivers apart from devices).

### Session bring-up (happy path, direct Bluetooth)
```
→ 11 FF 00 1A 00 00 5A        ping (IRoot.getProtocolVersion, magic 0x5A)
← 11 FF 00 1A 04 05 5A        HID++ 4.5 → it's a HID++ 2.0+ device
→ 11 FF 00 0A 1B 04 …         IRoot.getFeature(0x1B04)
← 11 FF 00 0A 08 …            feature index 0x08 (example; discovered at runtime)
→ 11 FF 08 3A 00 D0 33 00 00  setCidReporting(CID 0x00D0, flags 0x33)
← 11 FF 08 3A 00 D0 33 00 00  echo = accepted; thumb button now silent to macOS
```
`flags 0x33` = divert(0x01) + divertValid(0x02) + rawXY(0x10) + rawXYValid(0x20).

### Runtime notifications we parse
```
press:    11 FF 08 00 00 D0 00 00 ...   divertedButtonsEvent — CID list now held
move:     11 FF 08 10 DX DX DY DY ...   divertedRawMouseXYEvent — int16 BE deltas
release:  11 FF 08 00 00 00 00 00 ...   CID list no longer contains 0xD0
```
While the diverted button is held, pointer motion is consumed as raw XY (cursor
freezes — same behavior as Options+ gestures).

### Receiver-path extras (HID++ 1.0, devIdx 0xFF to the receiver)
* `0x80 0x00 [00 09 00]` — enable wireless + software-present notifications, so the
  receiver pushes `0x41` (device connected / woke) and `0x40` (disconnected). Flag
  bits vary by receiver generation; failures are non-fatal because we also poll.
* `0x83 0xB5 [0x20+slot-1]` — read pairing info (wireless PID, e.g. M720 ≈ `0x405E`)
  to report "paired but asleep" before the mouse answers pings.

### macOS media keys (output side)
`NSEvent` type 14 (`NSSystemDefined`), subtype 8, `data1 = (code<<16) | (0x0A or
0x0B)<<8` (down/up), posted with `CGEventPost`. Codes from
`IOKit/hidsystem/ev_keymap.h`: SOUND_UP 0, SOUND_DOWN 1, MUTE 7, PLAY 16, NEXT 17,
PREVIOUS 18 (FAST 19 / REWIND 20 as alternates if a player ignores 17/18).

---

## 2. Known platform constraints (read before debugging)

1. **macOS TCC / Input Monitoring.** Opening Logitech's vendor-page HID collections
   sometimes returns `kIOReturnNotPermitted` until the *host process* gets Input
   Monitoring. In dev that identity is **"Electron"** (the binary inside
   `node_modules`), not your terminal name, and a packaged build is **AntiLogi.app**.
   The app detects open failures, flips the UI to "permission blocked", and offers
   the one-click grant.
2. **Accessibility** is required for `CGEventPost` (the media keys). Same dev-mode
   identity caveat. Until granted we fall back to AppleScript volume / app-targeted
   transport control, so the app stays useful.
3. **Bluetooth direct vs. receiver.** macOS exposes the M720's HID++ vendor
   collection over BLE as usagePage `0xFF43` — when it does, everything works
   identically to the receiver path. If a given macOS build hides that collection
   (or the device sleeps), interception over BT is impossible *by anyone* in
   userspace; our fallback is (a) periodic re-enumeration + reopen polling,
   (b) Input-Monitoring prompt, (c) recommending the Unifying receiver path, which
   is rock-solid. `npm run probe` tells you in 5 seconds which case you're in.
4. **Logi Options+ / LogiMgr / Karabiner conflict.** If Logitech's agent is running
   it will re-assert its own diversion table and fight us. Quit/uninstall it
   (`pgrep -fl logioptionsplus` to check). We also re-assert divert every 45 s and
   on every reconnect, which wins against sleep resets.
5. **Diversion is volatile** (cleared by power-cycle/channel switch). Handled via
   receiver `0x41` notifications + periodic re-assert + rescan loop.

---

## 3. Phased execution plan

### Phase 0 — Preflight  ✅ (done in this session)
- [x] Node ≥ 20 (have 24), Xcode CLT (needed by `node-mac-permissions` gyp build),
      arm64, empty project dir, git available.

### Phase 1 — Scaffold
- [ ] `git init`, `.gitignore`, `package.json` (CJS, `main: out/main/index.js`).
- [ ] electron-vite + React + TS toolchain: `electron.vite.config.ts`, root
      `tsconfig.json` (main/preload/shared), `src/renderer/tsconfig.json` (web).
- [ ] Deps: `node-hid`, `node-mac-permissions`, `react`, `react-dom`;
      dev: `electron`, `electron-vite`, `@vitejs/plugin-react`, `typescript`,
      `electron-builder`, `@types/*`. (node-hid is N-API with darwin-arm64
      prebuilds → no electron-rebuild needed.)
- [ ] `uipro init --ai claude` for design primitives (per workspace policy).
- **Accept:** `npm install` exits 0 on arm64; tree matches layout below.

### Phase 2 — HID++ transport & protocol (`src/main/hid/`)
- [ ] `constants.ts` — VID, usage pages, report ids, feature ids, CID 0xD0, flag bits.
- [ ] `hidpp.ts` — `HidppChannel`: serialized request queue over `HIDAsync`,
      request/response matching incl. both error formats, timeouts, notification
      emitter; helpers `ping`, `getFeatureIndex`, `getDeviceName`;
      `ReprogControls` (feature 0x1B04: list CIDs, setCidReporting).
- **Accept:** `npm run probe` against real hardware prints protocol version,
  feature index, and the CID table including 0x00D0.

### Phase 3 — Device lifecycle (`deviceManager.ts`)
- [ ] Enumerate-filter-open candidates (receiver first, then BLE), slot probing
      1–6 via receiver, direct `0xFF` for BLE.
- [ ] Divert setup, notification routing to engine, receiver `0x40/0x41` handling,
      4 s rescan poll while disconnected, 45 s divert re-assert, un-divert on quit
      (button returns to stock behavior when the app closes).
- [ ] Permission-failure classification → `permission-blocked` UI state.
- **Accept:** unplug/replug receiver or toggle BT — UI recovers to Connected
  without restarting the app.

### Phase 4 — Gesture engine (`gestureEngine.ts`)
- [ ] State machine: press → accumulate int16 deltas → release.
- [ ] Tap vs swipe threshold (default 20 counts); dominant-axis direction
      (HID y+ = down).
- [ ] Volume actions repeat *during* the drag every `volumeInterval` (default 75
      counts) like Options+/logiops; transport actions fire once on release.
- **Accept:** unit-testable pure class; live feed shows correct directions.

### Phase 5 — Media output (`media/`)
- [ ] `mediaKeyDaemon.ts` — resident `osascript -l JavaScript` child (JXA +
      ObjC bridge) reading key codes from stdin, posting NX media events;
      auto-respawn; killed on quit. No compilation step, ships with macOS.
- [ ] `mediaController.ts` — picks daemon when Accessibility granted, else
      AppleScript fallback (`set volume output volume ±7`, mute toggle,
      Spotify→Music playpause/next/previous); emits "fired" events for the UI.
- **Accept:** with Accessibility granted, volume HUD appears and Now Playing
  (any app) responds; without it, system volume + Spotify/Music still work.

### Phase 6 — Permissions (`permissions.ts`)
- [ ] `node-mac-permissions` status for `accessibility` + `input-monitoring`,
      polled every 2.5 s, pushed to renderer.
- [ ] Grant actions: native ask where the API exists, else deep-link to the exact
      System Settings pane (`x-apple.systempreferences:…Privacy_Accessibility` /
      `…Privacy_ListenEvent`). Module load is defensive so the app still boots if
      the native module is missing.
- **Accept:** pills flip to "Granted" within ~3 s of toggling in System Settings.

### Phase 7 — IPC + React UI
- [ ] `src/shared/types.ts` — single source of truth for actions, mappings,
      state, push-channel payload map.
- [ ] Preload `contextBridge` API (`window.antilogi`): `getState`, `setMappings`,
      `setEngine`, `rescan`, `openPermission`, `testAction`, typed `on()` with
      channel allowlist. `contextIsolation` on, renderer sandboxed.
- [ ] React app: status header, Device card (name/transport/state + Rescan),
      Permissions card (2 rows + Grant buttons), Mapping matrix (Press/↑/↓/←/→
      selects + per-row Test), Tuning card (thresholds + CID hex), live event feed.
      Dark, minimal, hand-rolled CSS, hiddenInset title bar.
- **Accept:** `npm run typecheck` clean; mapping change persists across restart
  (JSON in `~/Library/Application Support/antilogi/`).

### Phase 8 — Verification
- [ ] `npm run typecheck` + `npm run build` (electron-vite production bundles).
- [ ] `npm run probe` — hardware ground truth (enumeration, ping, CID dump,
      Options+-agent conflict warning).
- [ ] Smoke-launch `npm run dev`, confirm main-process log lines, kill.
- [ ] **Manual (requires the physical mouse + you):** grant the two permissions,
      hold thumb button, swipe each direction, watch feed + actual media result.

### Phase 9 — Packaging & future work
- [ ] `npm run build:mac` → electron-builder dmg (arm64, unsigned `identity: null`,
      `asarUnpack` for `.node`); packaged app gives TCC a stable identity.
- Future: menu-bar/tray mode, login item, per-app profiles, battery readout
  (feature 0x1000), multi-device support, Lightspeed receivers, signing/notarization.

---

## 4. File map

```
AntiLogi/
├─ PLAN.md  README.md  package.json  electron.vite.config.ts
├─ tsconfig.json                  # main + preload + shared (node side)
├─ scripts/probe.mjs              # standalone hardware diagnostic (no Electron)
└─ src/
   ├─ shared/types.ts             # actions, mappings, IPC contract
   ├─ main/
   │  ├─ index.ts                 # bootstrap, window, wiring, clean shutdown
   │  ├─ ipc.ts  store.ts  permissions.ts
   │  ├─ hid/constants.ts  hid/hidpp.ts  hid/deviceManager.ts  hid/gestureEngine.ts
   │  └─ media/mediaController.ts  media/mediaKeyDaemon.ts
   ├─ preload/index.ts  preload/index.d.ts
   └─ renderer/
      ├─ index.html  tsconfig.json
      └─ src/ main.tsx  App.tsx  styles.css  hooks/useBridge.ts
         └─ components/ StatusCard.tsx MappingMatrix.tsx TuningCard.tsx EventFeed.tsx
```

## 5. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| BLE vendor collection not exposed/openable on this macOS build | **confirmed: exposed but TCC-gated** | probe proved 0xFF43 is present; opens are gated by the *Bluetooth* permission (CLI = silent denial, app bundle = system prompt). Bluetooth is now a tracked permission with UI grant; receiver path & rescan polling remain the fallbacks |
| Options+ agent fighting diversion | med (if installed) | probe warns; README says quit it; 45 s re-assert |
| `NEXT/PREV` NX codes ignored by some players | low | constants documented; one-line swap to FAST/REWIND |
| Receiver notification flag bits vary | low | enable call is best-effort; polling covers it |
| `node-mac-permissions` gyp build fails | low (CLT present) | module is optional at runtime; pane deep-links still work |
| Dev-mode TCC identity confusion ("Electron" vs app name) | med | documented in README + UI hint; packaged build fixes identity |

## 6. How to run (full detail in README.md)

```bash
npm install          # once
npm run probe        # hardware sanity check, no GUI
npm run dev          # HMR dev app
npm run typecheck    # strict TS over node + web sides
npm run build:mac    # unsigned arm64 dmg in release/
```
