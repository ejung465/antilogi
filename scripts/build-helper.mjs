#!/usr/bin/env node
// Compiles the native Swift HID++ helper (native/hid-helper.swift) into a plain
// executable that the Electron main process spawns. The helper does the IOHID +
// HID++ work node-hid can't do over Bluetooth. The Bluetooth usage description is
// embedded so CoreBluetooth doesn't trip TCC even before bundling; once packaged,
// the helper is spawned by AntiLogi.app and inherits the app's Bluetooth grant.
//
// Output: native/build/antilogi-hid-helper (referenced in dev, copied into the
// app's Resources at package time via electron-builder extraResources).

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') {
  console.log('[build-helper] non-macOS — skipping native helper build')
  process.exit(0)
}

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = join(root, 'native', 'hid-helper.swift')
const plist = join(root, 'native', 'helper-Info.plist')
const outDir = join(root, 'native', 'build')
const out = join(outDir, 'antilogi-hid-helper')

if (!existsSync(src)) {
  console.error(`[build-helper] missing ${src}`)
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

try {
  console.log('[build-helper] compiling native HID++ helper…')
  execFileSync(
    'swiftc',
    [
      '-O',
      src,
      '-o',
      out,
      // Embed the Bluetooth usage description into the Mach-O.
      '-Xlinker', '-sectcreate',
      '-Xlinker', '__TEXT',
      '-Xlinker', '__info_plist',
      '-Xlinker', plist
    ],
    { cwd: root, stdio: 'inherit' }
  )
  execFileSync('codesign', ['--force', '--sign', 'AntiLogi Dev Signing', out], { cwd: root, stdio: 'inherit' })
  console.log(`[build-helper] OK → ${out}`)
} catch (err) {
  console.error(`[build-helper] FAILED: ${err.message}`)
  process.exit(1)
}
