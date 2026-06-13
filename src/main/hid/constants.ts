// Logitech HID++ protocol constants.
// Sources: Logitech "HID++ 2.0 features" public drafts, Solaar and logiops.

export const LOGITECH_VID = 0x046d

// macOS exposes Logitech's vendor-specific HID++ collections under these usage pages.
export const USAGE_PAGE_RECEIVER = 0xff00 // Unifying/Nano receivers and corded/USB devices
export const USAGE_PAGE_BLE = 0xff43 // HID++ over Bluetooth LE (HOGP)

export const REPORT_ID_SHORT = 0x10 // 7-byte reports (receiver registers; not available over BLE)
export const REPORT_ID_LONG = 0x11 // 20-byte reports (all device traffic in this app)
export const SHORT_LEN = 7
export const LONG_LEN = 20

// 0xFF addresses a direct-connected device or the receiver itself;
// devices paired to a Unifying receiver live at slots 0x01..0x06.
export const DEVICE_IDX_DIRECT = 0xff
export const RECEIVER_SLOT_MIN = 1
export const RECEIVER_SLOT_MAX = 6

// Low nibble of byte 3 tags who issued a request; notifications carry 0 there.
export const SW_ID = 0x0a

// HID++ 2.0 feature ids
export const FEATURE_ROOT = 0x0000
export const FEATURE_DEVICE_NAME = 0x0005
export const FEATURE_REPROG_CONTROLS_V4 = 0x1b04

// Error markers (byte 2 of a response)
export const HIDPP1_ERROR = 0x8f
export const HIDPP2_ERROR = 0xff

// HID++ 1.0 receiver sub-ids
export const SUBID_DEVICE_DISCONNECTED = 0x40
export const SUBID_DEVICE_CONNECTED = 0x41
export const SUBID_SET_REGISTER = 0x80
export const SUBID_GET_REGISTER = 0x81
export const SUBID_GET_LONG_REGISTER = 0x83

// HID++ 1.0 receiver registers
export const REG_NOTIFICATIONS = 0x00
export const REG_PAIRING_INFO = 0xb5

// Thumb "gesture" button on the M720 Triathlon.
export const CID_M720_GESTURE = 0x00d0

// Feature 0x1B04 setCidReporting flag bits
export const FLAG_DIVERT = 0x01
export const FLAG_DIVERT_VALID = 0x02
export const FLAG_RAW_XY = 0x10
export const FLAG_RAW_XY_VALID = 0x20

// Feature 0x1B04 notification event numbers (high nibble of byte 3)
export const EVT_DIVERTED_BUTTONS = 0x0
export const EVT_DIVERTED_RAW_XY = 0x1
