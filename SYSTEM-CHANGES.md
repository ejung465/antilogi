# AntiLogi — Complete System Change Log

**Date:** June 13, 2026
**Machine:** Ethans-MacBook-Air (arm64, macOS 26)

This document covers every change made to the Mac during development and use of AntiLogi —
permissions, hidden files, keychain entries, installed software, and app data.

---

## 1. macOS Privacy Permissions (TCC Database)

Stored by macOS in a protected SQLite database. Persist until you revoke them or delete the app.

| Permission | Granted To | Why |
|---|---|---|
| **Input Monitoring** | `/Applications/AntiLogi.app` | Required to open the M720's HID interface over Bluetooth |
| **Bluetooth** | `/Applications/AntiLogi.app` | Required to write HID++ commands (setCidReporting) to the mouse |
| **Accessibility** | `/Applications/AntiLogi.app` | Required for CGEventPost media-key events (volume/play-pause) |

**How to revoke:** System Settings → Privacy & Security → each section → toggle off AntiLogi.

---

## 2. Keychain (Login Keychain)

**Location:** `~/Library/Keychains/login.keychain-db`

| Entry | Type | Purpose |
|---|---|---|
| **AntiLogi Dev Signing** | Certificate + Private Key (Code Signing) | Self-signed cert used to sign the app and helper binary so macOS TCC grants survive rebuilds. Expires 2036. |

To view: Keychain Access → login keychain → My Certificates → "AntiLogi Dev Signing".
To remove: right-click → Delete in Keychain Access (also removes the private key).

---

## 3. SSH Keys

**Location:** `~/.ssh/`

| File | Purpose |
|---|---|
| `~/.ssh/id_ed25519` | **Private key** — keep secret, do not share or upload |
| `~/.ssh/id_ed25519.pub` | Public key — registered on GitHub to authenticate `git push` |
| `~/.ssh/known_hosts` | github.com host fingerprint added (normal on first SSH connection) |

The public key is registered under GitHub account (ejung465) at Settings → SSH keys → "MacBook Air".
To remove: `rm ~/.ssh/id_ed25519 ~/.ssh/id_ed25519.pub` and delete the key on GitHub.

---

## 4. Installed Application

**Location:** `/Applications/AntiLogi.app`
**Size:** ~288 MB

The 288 MB is almost entirely the Electron (Chromium) runtime. Actual AntiLogi code is a few MB.

| Path inside .app | What It Is |
|---|---|
| `Contents/MacOS/AntiLogi` | Electron main binary |
| `Contents/Resources/antilogi-hid-helper` | Compiled Swift HID++ helper (132 KB) |
| `Contents/Resources/app.asar` | Bundled JS/React renderer |
| `Contents/Frameworks/AntiLogi Helper*.app` | Electron GPU/Renderer/Plugin sub-processes — normal internals, not junk |

To remove: drag `/Applications/AntiLogi.app` to Trash, then revoke TCC permissions above.

---

## 5. App Data & Cache

**Location:** `~/Library/Application Support/antilogi/`
**Size:** ~5.6 MB

Electron writes its runtime data here automatically.

| Path | Size | What It Is |
|---|---|---|
| `config.json` | <1 KB | Gesture mappings and engine settings (written on first launch) |
| `Cache/` | 3.6 MB | Electron/Chromium renderer cache |
| `GPUCache/`, `DawnGraphiteCache/`, `DawnWebGPUCache/` | 1.6 MB | GPU shader cache |
| `Code Cache/` | 228 KB | V8 JS compiled bytecode |
| `Cookies`, `Local Storage`, etc. | small | Standard Electron storage (no remote content — the app never loads URLs) |

The caches rebuild automatically on next launch. `config.json` holds your button mappings.
To remove everything: `rm -rf ~/Library/Application\ Support/antilogi/`

---

## 6. App Preferences

**Location:** `~/Library/Preferences/dev.local.antilogi.plist`
**Size:** <1 KB

Standard macOS preferences file written by Electron. Stores window state (size, position).
To remove: `rm ~/Library/Preferences/dev.local.antilogi.plist`

---

## 7. Project Source Code (External Drive)

**Location:** `/Volumes/JPX_Beta_Mac_Ext/Project Roots/AntiLogi/`
**Note:** None of this is on Macintosh HD.

| Path | Size | Notes |
|---|---|---|
| `node_modules/` | 485 MB | npm dependencies. Delete freely — `npm install` regenerates. |
| `native/build/antilogi-hid-helper` | 132 KB | Compiled Swift binary. `npm run build:helper` regenerates. |
| `out/` | varies | electron-vite build output. Gitignored, rebuilt by `npm run build`. |
| `release/` | varies | Packaged .dmg output. Gitignored, rebuilt by `npm run build:mac`. |
| Source files | ~1 MB | TypeScript, Swift, config — backed up on GitHub. |

---

## 8. GitHub Remote Repository

**URL:** https://github.com/ejung465/antilogi

| Commit | Description |
|---|---|
| `977f96b` | AntiLogi: M720 gesture button → macOS media controls over Bluetooth |
| `ec0701a` | Sign with self-signed cert so TCC grants survive rebuilds |

The SSH key in section 3 authenticates pushes.

---

## 9. Cleanup Performed

All of the following were found and deleted after the project was complete:

| File | What It Was |
|---|---|
| `/tmp/al.conf`, `/tmp/al-key.pem`, `/tmp/al-cert.pem`, `/tmp/al.p12` | Temp files from self-signed cert creation (cert is in Keychain — these copies deleted) |
| `/tmp/antilogi.crt`, `/tmp/antilogi.key`, `/tmp/antilogi.p12` | Temp files from an earlier cert attempt |
| `/tmp/antilogi-dev.log`, `/tmp/antilogi-npm*.log` | Dev session log files |
| `/tmp/hidmon`, `/tmp/hidmon*.out` | HID monitor debug binaries and output from development |
| `/tmp/probe.log` | HID++ probe output |
| `/tmp/testfile` | codesign test file |
| `~/Library/Logs/DiagnosticReports/antilogi-hid-helper-*.ips` (×4) | Crash reports from SIGABRT debugging during development |
| `~/Library/Logs/DiagnosticReports/AntiLogiHelper-*.ips` | Crash report from helper debugging |
| `~/Library/Application Support/CrashReporter/AntiLogiHelper_*.plist` | Crash reporter metadata |
| `~/Library/Application Support/CrashReporter/antilogi-hid-helper_*.plist` | Crash reporter metadata |

---

## Summary: Permanent Footprint on Macintosh HD

| Location | Size | Safe to Delete? |
|---|---|---|
| `/Applications/AntiLogi.app` | 288 MB | Yes — removes the app |
| `~/Library/Application Support/antilogi/` | 5.6 MB | Yes — removes settings/cache |
| `~/Library/Preferences/dev.local.antilogi.plist` | <1 KB | Yes — removes window state |
| `~/Library/Keychains/login.keychain-db` | shared, +small | Delete only "AntiLogi Dev Signing" entry via Keychain Access |
| `~/.ssh/id_ed25519*` | <1 KB | Only if you no longer need GitHub SSH access |

**Total footprint on Macintosh HD: ~294 MB**, almost entirely the Electron runtime inside the .app bundle.
