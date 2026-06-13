// AntiLogi native HID++ helper.
//
// Why this exists: node-hid cannot open the M720 over Bluetooth on macOS — its
// device-open path is rejected. The native IOHIDManager/IOKit path CAN, given
// Input Monitoring (to open) + Bluetooth (to write HID++). This helper does the
// raw HID++ work and speaks newline-delimited JSON to the Electron main process:
//   stdin  : commands   {"cmd":"setcid","cid":208} | {"cmd":"rescan"} | {"cmd":"shutdown"}
//   stdout : events      {"t":"device",...} {"t":"buttons",...} {"t":"rawxy",...}
//                        {"t":"perm",...} {"t":"log",...} {"t":"ready"}
//
// Crucial detail learned the hard way: open via the registry path + IOHIDDeviceOpen
// ONLY. Calling IOHIDManagerOpen *and* IOHIDDeviceOpen double-opens the device and
// leaves SetReport returning kIOReturnNotOpen.
//
// Build: swiftc -O native/hid-helper.swift -o <out>/antilogi-hid-helper

import Foundation
import IOKit
import IOKit.hid
import CoreBluetooth

// MARK: - Protocol constants (mirror src/main/hid/constants.ts)

let LOGITECH = 0x046D
let REPORT_LONG: UInt8 = 0x11
let SW_ID: UInt8 = 0x0A
let DEV_IDX_DIRECT: UInt8 = 0xFF
let FEATURE_ROOT = 0x0000
let FEATURE_DEVICE_NAME = 0x0005
let FEATURE_REPROG_CONTROLS = 0x1B04
let HIDPP2_ERROR: UInt8 = 0xFF
let HIDPP1_ERROR: UInt8 = 0x8F
let FLAG_DIVERT: UInt8 = 0x01
let FLAG_DIVERT_VALID: UInt8 = 0x02
let FLAG_RAW_XY: UInt8 = 0x10
let FLAG_RAW_XY_VALID: UInt8 = 0x20
let EVT_DIVERTED_BUTTONS: UInt8 = 0x0
let EVT_DIVERTED_RAW_XY: UInt8 = 0x1

// MARK: - JSON stdout (thread-safe, line-buffered)

let outLock = NSLock()
func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          let str = String(data: data, encoding: .utf8) else { return }
    outLock.lock(); defer { outLock.unlock() }
    FileHandle.standardOutput.write((str + "\n").data(using: .utf8)!)
}
func log(_ level: String, _ msg: String) { emit(["t": "log", "level": level, "msg": msg]) }

func prop(_ d: IOHIDDevice, _ k: String) -> Int { (IOHIDDeviceGetProperty(d, k as CFString) as? Int) ?? -1 }

// MARK: - HID++ device wrapper

final class HidppDevice {
    let dev: IOHIDDevice
    private let inputBuf: UnsafeMutablePointer<UInt8>
    private let inputCap = 64
    // request/response correlation
    private var pendingMatch: ((ArraySlice<UInt8>) -> Bool)?
    private var pendingResult: [UInt8]?
    // notification sink
    var onButtons: (([Int]) -> Void)?
    var onRawXY: ((Int, Int) -> Void)?

    init(_ d: IOHIDDevice) {
        dev = d
        inputBuf = UnsafeMutablePointer<UInt8>.allocate(capacity: inputCap)
    }

    func startReading() {
        let ctx = Unmanaged.passUnretained(self).toOpaque()
        let cb: IOHIDReportCallback = { context, _, _, _, _, report, len in
            let me = Unmanaged<HidppDevice>.fromOpaque(context!).takeUnretainedValue()
            me.onReport(report, len)
        }
        IOHIDDeviceRegisterInputReportCallback(dev, inputBuf, inputCap, cb, ctx)
        IOHIDDeviceScheduleWithRunLoop(dev, CFRunLoopGetCurrent(), CFRunLoopMode.defaultMode.rawValue)
    }

    private func onReport(_ report: UnsafePointer<UInt8>, _ len: Int) {
        guard len >= 4 else { return }
        let bytes = Array(UnsafeBufferPointer(start: report, count: len))
        // First, offer to an in-flight request.
        if let match = pendingMatch, match(bytes[...]) {
            pendingResult = bytes
            pendingMatch = nil
            return
        }
        // Otherwise, an unsolicited HID++ notification.
        guard bytes[0] == REPORT_LONG || bytes[0] == 0x10 else { return }
        handleNotification(bytes)
    }

    private var reprogFeatureIndex: UInt8 = 0
    private var targetCid: Int = 0x00D0

    func handleNotification(_ d: [UInt8]) {
        guard reprogFeatureIndex != 0, d.count >= 8 else { return }
        guard d[2] == reprogFeatureIndex, (d[3] & 0x0F) == 0 else { return }
        let evt = d[3] >> 4
        if evt == EVT_DIVERTED_BUTTONS {
            var cids: [Int] = []
            var i = 4
            while i + 1 < d.count && i <= 10 {
                let cid = (Int(d[i]) << 8) | Int(d[i + 1])
                if cid != 0 { cids.append(cid) }
                i += 2
            }
            onButtons?(cids)
        } else if evt == EVT_DIVERTED_RAW_XY {
            let dx = Int(Int16(bitPattern: (UInt16(d[4]) << 8) | UInt16(d[5])))
            let dy = Int(Int16(bitPattern: (UInt16(d[6]) << 8) | UInt16(d[7])))
            onRawXY?(dx, dy)
        }
    }

    /// Synchronous HID++ exchange: SetReport, then pump the run loop until the
    /// matching reply arrives or we time out. Serial by construction.
    @discardableResult
    private func transact(_ payload: [UInt8], match: @escaping (ArraySlice<UInt8>) -> Bool, timeout: Double) -> [UInt8]? {
        pendingResult = nil
        pendingMatch = match
        let r = payload.withUnsafeBufferPointer {
            IOHIDDeviceSetReport(dev, kIOHIDReportTypeOutput, CFIndex(payload[0]), $0.baseAddress!, payload.count)
        }
        if r != kIOReturnSuccess {
            pendingMatch = nil
            log("warn", String(format: "SetReport failed 0x%08X", r))
            return nil
        }
        let deadline = Date().addingTimeInterval(timeout)
        while pendingResult == nil && Date() < deadline {
            CFRunLoopRunInMode(.defaultMode, 0.02, true)
        }
        pendingMatch = nil
        return pendingResult
    }

    private func longRequest(_ devIdx: UInt8, _ featIdx: UInt8, _ fn: UInt8, _ params: [UInt8] = [], timeout: Double = 2.0) -> [UInt8]? {
        let fnsw = ((fn & 0x0F) << 4) | SW_ID
        var p = [UInt8](repeating: 0, count: 20)
        p[0] = REPORT_LONG; p[1] = devIdx; p[2] = featIdx; p[3] = fnsw
        for (i, b) in params.enumerated() where i < 16 { p[4 + i] = b }
        return transact(p, match: { d in
            guard d.count >= 4, d[d.startIndex + 1] == devIdx else { return false }
            let b2 = d[d.startIndex + 2], b3 = d[d.startIndex + 3]
            if b2 == featIdx && b3 == fnsw { return true }
            if (b2 == HIDPP2_ERROR || b2 == HIDPP1_ERROR) && b3 == featIdx { return true }
            return false
        }, timeout: timeout)
    }

    func ping() -> (Int, Int)? {
        guard let r = longRequest(DEV_IDX_DIRECT, 0x00, 0x01, [0, 0, 0x5A], timeout: 1.5) else { return nil }
        if r[2] == HIDPP1_ERROR || r[2] == HIDPP2_ERROR { return nil }
        return (Int(r[4]), Int(r[5]))
    }

    func featureIndex(_ feature: Int) -> UInt8? {
        guard let r = longRequest(DEV_IDX_DIRECT, 0x00, 0x00, [UInt8((feature >> 8) & 0xFF), UInt8(feature & 0xFF)]) else { return nil }
        if r[2] == HIDPP1_ERROR || r[2] == HIDPP2_ERROR { return nil }
        return r[4] == 0 ? nil : r[4]
    }

    func deviceName() -> String? {
        guard let fi = featureIndex(FEATURE_DEVICE_NAME), let lenR = longRequest(DEV_IDX_DIRECT, fi, 0x00) else { return nil }
        let length = Int(lenR[4]); var name = ""
        while name.count < length && name.count < 64 {
            guard let chunk = longRequest(DEV_IDX_DIRECT, fi, 0x01, [UInt8(name.count)]) else { break }
            name += String(bytes: chunk[4...].prefix(16).filter { $0 != 0 }, encoding: .ascii) ?? ""
        }
        return name.isEmpty ? nil : String(name.prefix(length)).trimmingCharacters(in: .whitespaces)
    }

    /// Resolve 0x1B04 and verify the target CID is present.
    func setupReprog(cid: Int) -> Bool {
        guard let fi = featureIndex(FEATURE_REPROG_CONTROLS) else { return false }
        reprogFeatureIndex = fi
        targetCid = cid
        guard let countR = longRequest(DEV_IDX_DIRECT, fi, 0x00) else { return false }
        let count = Int(countR[4])
        var found = false
        var cidList: [String] = []
        for i in 0..<count {
            guard let info = longRequest(DEV_IDX_DIRECT, fi, 0x01, [UInt8(i)]) else { continue }
            let c = (Int(info[4]) << 8) | Int(info[5])
            cidList.append(String(format: "0x%04X", c))
            if c == cid { found = true }
        }
        log("info", "control table: \(cidList.joined(separator: ", "))")
        return found
    }

    func setReporting(cid: Int, divert: Bool, rawXY: Bool) -> Bool {
        guard reprogFeatureIndex != 0 else { return false }
        var flags = FLAG_DIVERT_VALID | FLAG_RAW_XY_VALID
        if divert { flags |= FLAG_DIVERT }
        if rawXY { flags |= FLAG_RAW_XY }
        let p: [UInt8] = [UInt8((cid >> 8) & 0xFF), UInt8(cid & 0xFF), flags, 0, 0]
        return longRequest(DEV_IDX_DIRECT, reprogFeatureIndex, 0x03, p) != nil
    }

    func close() {
        IOHIDDeviceUnscheduleFromRunLoop(dev, CFRunLoopGetCurrent(), CFRunLoopMode.defaultMode.rawValue)
        IOHIDDeviceClose(dev, IOOptionBits(kIOHIDOptionsTypeNone))
    }
}

// MARK: - Manager: discovery, lifecycle, command handling

final class Manager {
    private var current: HidppDevice?
    private var connected = false
    private var targetCid = 0x00D0
    private var lastReassert = Date.distantPast
    // HID++ requests pump the run loop while awaiting replies, which can re-enter
    // timer/command handlers. This guard serializes all device work to one at a time.
    private var busy = false

    /// Registry-path enumeration + open. NO IOHIDManagerOpen (avoids NotOpen on write).
    private func findAndOpen() {
        var iter: io_iterator_t = 0
        guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOHIDDevice"), &iter) == KERN_SUCCESS else { return }
        defer { IOObjectRelease(iter) }
        var svc = IOIteratorNext(iter)
        var sawLogitech = false
        var openBlocked = false
        while svc != 0 {
            let created = IOHIDDeviceCreate(kCFAllocatorDefault, svc)
            IOObjectRelease(svc)
            svc = IOIteratorNext(iter)
            guard let d = created, prop(d, kIOHIDVendorIDKey) == LOGITECH else { continue }
            // The M720 is one IOHIDDevice; its HID++ pipe carries 20-byte reports.
            let outMax = prop(d, kIOHIDMaxOutputReportSizeKey)
            guard outMax >= 19 || prop(d, kIOHIDPrimaryUsagePageKey) >= 0xFF00 || prop(d, kIOHIDMaxInputReportSizeKey) >= 19 else { continue }
            sawLogitech = true
            let r = IOHIDDeviceOpen(d, IOOptionBits(kIOHIDOptionsTypeNone))
            if r != kIOReturnSuccess {
                openBlocked = true
                continue
            }
            let hp = HidppDevice(d)
            hp.startReading()
            guard let ver = hp.ping() else { hp.close(); continue }
            log("info", "HID++ \(ver.0).\(ver.1) device opened")
            if !hp.setupReprog(cid: targetCid) {
                emit(["t": "device", "state": "connected", "name": hp.deviceName() ?? "M720 Triathlon",
                      "detail": String(format: "CID 0x%04X not found — adjust in Tuning", targetCid)])
                hp.close(); continue
            }
            hp.onButtons = { cids in emit(["t": "buttons", "cids": cids]) }
            hp.onRawXY = { dx, dy in emit(["t": "rawxy", "dx": dx, "dy": dy]) }
            _ = hp.setReporting(cid: targetCid, divert: true, rawXY: true)
            let name = hp.deviceName() ?? "M720 Triathlon"
            current = hp
            connected = true
            lastReassert = Date()
            emit(["t": "device", "state": "connected", "name": name, "transport": "bluetooth",
                  "detail": String(format: "gesture button (CID 0x%04X) diverted", targetCid)])
            return
        }
        if openBlocked {
            emit(["t": "perm", "openBlocked": true])
            emit(["t": "device", "state": "permission-blocked",
                  "detail": "macOS blocked opening the mouse. Grant Input Monitoring (and Bluetooth), then rescan."])
        } else if !sawLogitech {
            emit(["t": "device", "state": "searching", "detail": "Mouse not found. Is it paired over Bluetooth and awake?"])
        } else {
            emit(["t": "device", "state": "unreachable", "detail": "Mouse present but not answering — wiggle it to wake."])
        }
    }

    func tick() {
        if busy { return }
        busy = true; defer { busy = false }
        if !connected {
            findAndOpen()
            return
        }
        // Re-assert diversion periodically (volatile across sleep / channel switch).
        if Date().timeIntervalSince(lastReassert) > 45 {
            lastReassert = Date()
            if current?.setReporting(cid: targetCid, divert: true, rawXY: true) != true {
                log("warn", "divert re-assert failed — dropping connection")
                dropConnection("Mouse stopped answering — rescanning…")
            }
        }
    }

    private func dropConnection(_ detail: String) {
        current?.close(); current = nil; connected = false
        emit(["t": "device", "state": "searching", "detail": detail])
    }

    func setCid(_ cid: Int) {
        if busy { return }
        busy = true; defer { busy = false }
        let old = targetCid
        targetCid = cid
        if connected, let c = current {
            if old != cid { _ = c.setReporting(cid: old, divert: false, rawXY: false) }
            if !c.setupReprog(cid: cid) {
                emit(["t": "device", "state": "connected", "detail": String(format: "CID 0x%04X not found", cid)])
                return
            }
            _ = c.setReporting(cid: cid, divert: true, rawXY: true)
            emit(["t": "device", "state": "connected", "detail": String(format: "gesture button (CID 0x%04X) diverted", cid)])
        }
    }

    func rescan() {
        if busy { return }
        if !connected {
            busy = true; defer { busy = false }
            findAndOpen()
        } else {
            tick()
        }
    }

    func shutdown() {
        if let c = current { _ = c.setReporting(cid: targetCid, divert: false, rawXY: false); c.close() }
        current = nil; connected = false
    }
}

// MARK: - CoreBluetooth — engages the Bluetooth grant that HID++ *writes* require.
//
// Permission matrix (confirmed empirically on macOS 26):
//   - Input Monitoring  → required to OPEN the device (registry-path IOHIDDeviceOpen)
//   - Bluetooth         → required to WRITE HID++ (IOHIDDeviceSetReport to the BLE
//                         device); without an active CoreBluetooth session the write
//                         returns kIOReturnNotPermitted (0xE00002E2)
// Needs NSBluetoothAlwaysUsageDescription in the binary's embedded Info.plist
// (linked via -sectcreate __TEXT __info_plist) or TCC aborts the process.

final class BT: NSObject, CBCentralManagerDelegate {
    var mgr: CBCentralManager!
    var onReady: (() -> Void)?
    private var firedReady = false
    func start() { mgr = CBCentralManager(delegate: self, queue: nil) }
    func centralManagerDidUpdateState(_ c: CBCentralManager) {
        let auth = CBCentralManager.authorization.rawValue
        emit(["t": "perm", "bluetooth": auth, "btState": c.state.rawValue])
        // HID++ writes need Bluetooth live first. Gate discovery on poweredOn so
        // the first SetReport doesn't race ahead of the grant (→ NotPermitted).
        if c.state == .poweredOn && !firedReady {
            firedReady = true
            onReady?()
        }
    }
}

// MARK: - main

setbuf(stdout, nil)

// Register for Input Monitoring properly so macOS lists the app and shows the
// prompt. A registry-path IOHIDDeviceOpen alone fails NotPermitted WITHOUT
// adding the app to the Input Monitoring list, leaving the user unable to grant.
let imAccess = IOHIDRequestAccess(kIOHIDRequestTypeListenEvent)
emit(["t": "perm", "inputMonitoring": imAccess ? 1 : 0])
log("info", "Input Monitoring access: \(imAccess ? "granted" : "not yet — enable AntiLogi in System Settings → Input Monitoring")")

let manager = Manager()
let bt = BT()
var discoveryTimer: Timer?
bt.onReady = {
    manager.tick()
    discoveryTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { _ in manager.tick() }
}
bt.start()
emit(["t": "ready"])
// Fallback: if CoreBluetooth never reaches poweredOn within 4s (e.g. BT off, or
// running without bundle context), start discovery anyway so IOHID still runs.
Timer.scheduledTimer(withTimeInterval: 4.0, repeats: false) { _ in
    if discoveryTimer == nil {
        manager.tick()
        discoveryTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { _ in manager.tick() }
    }
}

// stdin command reader on a background thread → dispatch to main run loop.
let stdinQueue = DispatchQueue(label: "antilogi.stdin")
stdinQueue.async {
    while let line = readLine(strippingNewline: true) {
        guard let data = line.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let cmd = obj["cmd"] as? String else { continue }
        DispatchQueue.main.async {
            switch cmd {
            case "setcid": if let cid = obj["cid"] as? Int { manager.setCid(cid) }
            case "rescan": manager.rescan()
            case "shutdown": manager.shutdown(); exit(0)
            default: break
            }
        }
    }
    // stdin closed (parent exited) → clean up and quit.
    DispatchQueue.main.async { manager.shutdown(); exit(0) }
}

// Discovery is started by bt.onReady (or the 4s fallback above).
CFRunLoopRun()
