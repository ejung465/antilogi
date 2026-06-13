#!/usr/bin/env node
// AntiLogi hardware probe — run with `npm run probe`.
//
// Standalone HID++ diagnostic (no Electron involved): enumerates Logitech
// interfaces, classifies receiver vs direct device, dumps the 0x1B04 control
// table and verifies the gesture CID is reachable. It intentionally duplicates
// a small slice of src/main/hid so it works even when the app build is broken.

import { execFile } from 'node:child_process'

const VID = 0x046d
const PAGE_RECEIVER = 0xff00
const PAGE_BLE = 0xff43
const SW_ID = 0x0a
const GESTURE_CID = 0x00d0

const hex = (n, w = 2) => '0x' + Number(n).toString(16).toUpperCase().padStart(w, '0')

const mod = await import('node-hid')
const HID = mod.default ?? mod

function request(dev, payload, matcher, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const onData = (d) => {
      const m = matcher(d)
      if (!m) return
      cleanup()
      if (m.err) reject(new Error(m.err))
      else resolve(m.params)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('timeout'))
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      dev.removeListener('data', onData)
    }
    dev.on('data', onData)
    Promise.resolve(dev.write(payload)).catch((e) => {
      cleanup()
      reject(e)
    })
  })
}

function longRequest(dev, devIdx, featIdx, fn, params = [], timeoutMs = 1500) {
  const fnsw = ((fn & 0x0f) << 4) | SW_ID
  const buf = Buffer.alloc(20)
  buf[0] = 0x11
  buf[1] = devIdx
  buf[2] = featIdx
  buf[3] = fnsw
  Buffer.from(params).copy(buf, 4)
  return request(
    dev,
    buf,
    (d) => {
      if ((d[0] !== 0x10 && d[0] !== 0x11) || d[1] !== devIdx) return null
      if (d[2] === featIdx && d[3] === fnsw) return { params: d.subarray(4) }
      if (d[2] === 0xff && d[3] === featIdx && d[4] === fnsw) return { err: `hidpp2:${d[5]}` }
      if (d[2] === 0x8f && d[3] === featIdx && d[4] === fnsw) return { err: `hidpp1:${d[5]}` }
      return null
    },
    timeoutMs
  )
}

async function ping(dev, devIdx, timeoutMs = 1200) {
  try {
    const p = await longRequest(dev, devIdx, 0x00, 0x01, [0, 0, 0x5a], timeoutMs)
    return { major: p[0], minor: p[1] }
  } catch (e) {
    if (e.message === 'hidpp1:1') return { major: 1, minor: 0 } // receiver itself
    if (e.message.startsWith('hidpp1:') || e.message === 'timeout') return null
    throw e
  }
}

async function getName(dev, devIdx) {
  const featIdx = (await longRequest(dev, devIdx, 0x00, 0x00, [0x00, 0x05]))[0]
  if (!featIdx) return null
  const length = (await longRequest(dev, devIdx, featIdx, 0x00))[0]
  let name = ''
  while (name.length < length && name.length < 64) {
    const chunk = await longRequest(dev, devIdx, featIdx, 0x01, [name.length])
    name += chunk.toString('latin1')
  }
  return name.slice(0, length).replace(/\0+$/, '').trim()
}

async function inspect(dev, devIdx, label) {
  const name = await getName(dev, devIdx).catch(() => null)
  console.log(`  ${label}: ${name ?? '(name unreadable)'}`)
  const featIdx = (await longRequest(dev, devIdx, 0x00, 0x00, [0x1b, 0x04]))[0]
  if (!featIdx) {
    console.log('    ✗ feature 0x1B04 unsupported — buttons cannot be diverted on this device')
    return false
  }
  console.log(`    feature 0x1B04 (Reprog Controls v4) at index ${hex(featIdx)}`)
  const count = (await longRequest(dev, devIdx, featIdx, 0x00))[0]
  const cids = []
  for (let i = 0; i < count; i++) {
    const p = await longRequest(dev, devIdx, featIdx, 0x01, [i])
    cids.push(p.readUInt16BE(0))
  }
  console.log(`    control table: ${cids.map((c) => hex(c, 4)).join(', ')}`)
  if (cids.includes(GESTURE_CID)) {
    console.log(`    ✓ gesture button ${hex(GESTURE_CID, 4)} present — AntiLogi can divert it on this path`)
    return true
  }
  console.log(`    ✗ ${hex(GESTURE_CID, 4)} not in the table — pick one of the CIDs above in the app's Tuning panel`)
  return false
}

function pgrep(pattern) {
  return new Promise((resolve) => {
    execFile('pgrep', ['-fl', pattern], (_err, stdout) => resolve((stdout ?? '').trim()))
  })
}

async function tccStatuses() {
  try {
    const perms = (await import('node-mac-permissions')).default
    return { bluetooth: perms.getAuthStatus('bluetooth'), im: perms.getAuthStatus('input-monitoring') }
  } catch {
    return null // optional module not built — guidance stays generic
  }
}

console.log('AntiLogi hardware probe')
console.log('=======================')

for (const proc of ['logioptionsplus', 'LogiMgr']) {
  const out = await pgrep(proc)
  if (out) {
    console.log(`⚠ ${proc} is running — Logitech's own agent will fight AntiLogi for the button:`)
    console.log(`   ${out.split('\n').join('\n   ')}`)
  }
}

const all = await (HID.devicesAsync ? HID.devicesAsync() : Promise.resolve(HID.devices()))
const logi = all.filter((d) => d.vendorId === VID)
if (logi.length === 0) {
  console.log('\n✗ No Logitech HID devices visible at all. Plug in the receiver or pair the mouse over Bluetooth.')
  process.exit(1)
}

console.log(`\nLogitech HID entries (${logi.length}):`)
for (const d of logi) {
  console.log(
    `  pid ${hex(d.productId, 4)}  usagePage ${hex(d.usagePage ?? 0, 4)}  usage ${hex(d.usage ?? 0)}  ${d.product ?? ''}`
  )
}

const candidates = logi.filter((d) => d.path && (d.usagePage === PAGE_RECEIVER || d.usagePage === PAGE_BLE))
if (candidates.length === 0) {
  console.log('\n✗ No HID++ vendor collection (usagePage 0xFF00 / 0xFF43) is exposed.')
  console.log('  Over Bluetooth that means macOS is hiding the vendor collection on this build —')
  console.log('  use the Unifying receiver path instead, which always exposes 0xFF00.')
  process.exit(1)
}

let ready = false
for (const cand of candidates) {
  console.log(`\nOpening ${cand.product ?? cand.path} (usagePage ${hex(cand.usagePage, 4)})…`)
  let dev
  try {
    dev = await HID.HIDAsync.open(cand.path)
  } catch (e) {
    console.log(`  ✗ open failed: ${e.message}`)
    // TCC-gated opens fail with a generic message; read the actual gate states.
    const tcc = await tccStatuses()
    if (tcc) console.log(`  TCC for this process — bluetooth: ${tcc.bluetooth}, input-monitoring: ${tcc.im}`)
    if (cand.usagePage === PAGE_BLE && tcc?.bluetooth !== 'authorized') {
      console.log('  → BLE HID opens are gated by the *Bluetooth* permission. CLI processes are denied')
      console.log('    silently (no prompt). Fix for this probe: System Settings → Privacy & Security →')
      console.log('    Bluetooth → add your terminal app. The AntiLogi app itself triggers the proper')
      console.log('    system prompt on first launch, so `npm run dev` does not need this manual step.')
    } else {
      console.log('  → grant Input Monitoring (System Settings → Privacy & Security) to your terminal,')
      console.log('    and to "Electron" when running the app in dev mode, then re-run.')
    }
    continue
  }
  try {
    const version = await ping(dev, 0xff)
    if (!version) {
      console.log('  no HID++ response — skipping')
    } else if (version.major >= 2) {
      console.log(`  direct HID++ ${version.major}.${version.minor} device (${cand.usagePage === PAGE_BLE ? 'Bluetooth' : 'USB'})`)
      ready = (await inspect(dev, 0xff, 'device')) || ready
    } else {
      console.log('  HID++ 1.0 receiver — probing pairing slots 1–6')
      for (let slot = 1; slot <= 6; slot++) {
        const v = await ping(dev, slot, 900).catch(() => null)
        if (v && v.major >= 2) {
          console.log(`  slot ${slot}: HID++ ${v.major}.${v.minor} device awake`)
          ready = (await inspect(dev, slot, `slot ${slot}`)) || ready
        } else {
          console.log(`  slot ${slot}: no response (empty, or asleep — wiggle the mouse and re-run)`)
        }
      }
    }
  } catch (e) {
    console.log(`  ✗ probe error: ${e.message}`)
  } finally {
    if (dev) await dev.close().catch(() => undefined)
  }
}

console.log(
  ready
    ? '\n✓ READY — at least one path can divert the gesture button. `npm run dev` will work.'
    : '\n✗ NOT READY — see messages above (device asleep? permissions? different CID?).'
)
