#!/usr/bin/env node
// Optional native-module setup.
//
// node-mac-permissions cannot compile out of the box when the project path
// contains spaces (here: "Project Roots") — its binding.gyp expands the
// node-addon-api include path with `<!@(…)`, which splits on whitespace, so
// clang receives the path in two halves. This script installs the package with
// scripts disabled, rewrites that include to a *relative* path (space-free by
// construction), and rebuilds it. N-API keeps the result ABI-compatible with
// both Node and Electron.
//
// The app runs fine without the module (Electron built-ins cover the
// Accessibility prompt/status), so every failure here downgrades to a warning
// and exit 0. Wired to `postinstall` because the package is intentionally not
// in package.json dependencies — a plain `npm install` would otherwise try to
// build it unpatched and fail the whole install.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// `npm install` inside postinstall would re-trigger postinstall — guard it.
if (process.env.ANTILOGI_SETUP_RUNNING === '1') process.exit(0)

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkgDir = join(root, 'node_modules', 'node-mac-permissions')
const builtNode = join(pkgDir, 'build', 'Release', 'permissions.node')

// Literal binding.gyp line being replaced (note the escaped quotes in-file).
const NEEDLE = '"<!@(node -p \\"require(\'node-addon-api\').include\\")"'
const REPLACEMENT = '"../node-addon-api"'

const run = (cmd, args) =>
  execFileSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ANTILOGI_SETUP_RUNNING: '1' }
  })

try {
  if (process.platform !== 'darwin') process.exit(0)
  if (existsSync(builtNode)) {
    console.log('[setup-permissions] node-mac-permissions already built — nothing to do')
    process.exit(0)
  }
  if (!existsSync(pkgDir)) {
    console.log('[setup-permissions] installing node-mac-permissions (scripts disabled)…')
    run('npm', [
      'install',
      'node-mac-permissions',
      '--no-save',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--loglevel=error'
    ])
  }
  const gypFile = join(pkgDir, 'binding.gyp')
  const original = readFileSync(gypFile, 'utf8')
  if (original.includes(NEEDLE)) {
    writeFileSync(gypFile, original.split(NEEDLE).join(REPLACEMENT))
    console.log('[setup-permissions] patched binding.gyp include path (space-safe relative path)')
  }
  console.log('[setup-permissions] rebuilding…')
  run('npm', ['rebuild', 'node-mac-permissions', '--loglevel=error'])
  if (!existsSync(builtNode)) throw new Error('build finished but permissions.node is missing')
  console.log('[setup-permissions] OK — fine-grained TCC status enabled')
} catch (err) {
  console.warn(`[setup-permissions] skipped: ${err.message}`)
  console.warn('[setup-permissions] the app still works — Accessibility falls back to Electron built-ins')
}
process.exit(0)
