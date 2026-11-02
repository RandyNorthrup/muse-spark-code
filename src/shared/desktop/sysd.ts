// Muse Desktop (M111, D91.5) lane ST1: the system bridge's client contract.
// `muse-sysd` (lane SY, not built yet) is a Rust user service on an
// owner-only socket; its API is versioned JSON-RPC, written once here in
// zod/mini so the settings app validates every frame (AGENTS.md rule 7)
// and SY generates the JSON Schema and Rust types from the same shapes.
// The Electron main process proxies these frames to the socket; the
// renderer never sees the socket itself (threat model D57/D90: the
// renderer's only peer is the preload bridge). ST1 covers the ten
// sysd-backed system pages; ST2 extends the method table for its own.

import * as z from 'zod/mini'

// The sysd protocol version this client speaks; the socket's first frame.
export const SYSD_PROTOCOL_VERSION = 1

const nonEmptyString = z.string().check(z.minLength(1))
const percent = z.int().check(z.minimum(0), z.maximum(100))
const nonNegativeInt = z.int().check(z.nonnegative())
const positiveInt = z.int().check(z.positive())

// JSON-RPC 2.0 request envelope; ids are client-chosen opaque strings.
export const sysdRequestSchema = z.strictObject({
  jsonrpc: z.literal('2.0'),
  id: nonEmptyString,
  method: nonEmptyString,
  params: z.optional(z.record(z.string(), z.unknown())),
})
export type SysdRequest = z.infer<typeof sysdRequestSchema>

// sysd's own error codes, in JSON-RPC's server range. The renderer's shell
// maps these to fixed localized sentences; sysd's message text is never
// shown (it can name paths), only the code beside the sentence.
export const SYSD_ERROR_CODES = {
  unavailable: -32_001,
  denied: -32_002,
  failed: -32_003,
  notFound: -32_004,
} as const

// JSON-RPC 2.0 error envelope.
export const sysdErrorSchema = z.strictObject({
  jsonrpc: z.literal('2.0'),
  id: nonEmptyString,
  error: z.strictObject({
    code: z.int(),
    message: z.string(),
  }),
})
export type SysdErrorFrame = z.infer<typeof sysdErrorSchema>

// A mutation that applied; every change method returns this shape.
export const sysdOkSchema = z.strictObject({ ok: z.literal(true) })
export type SysdOk = z.infer<typeof sysdOkSchema>

// A refused or failed sysd call, carrying the wire code for the shell.
export class SysdError extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = 'SysdError'
    this.code = code
  }
}

// Network (NetworkManager through sysd). ------------------------------------

export const VPN_STATES = ['connected', 'disconnected'] as const
export type VpnState = (typeof VPN_STATES)[number]

export const wifiNetworkSchema = z.strictObject({
  ssid: nonEmptyString,
  signalPercent: percent,
  secured: z.boolean(),
  connected: z.boolean(),
  autoconnect: z.boolean(),
})
export type WifiNetwork = z.infer<typeof wifiNetworkSchema>

export const vpnConnectionSchema = z.strictObject({
  id: nonEmptyString,
  name: nonEmptyString,
  state: z.enum(VPN_STATES),
})
export type VpnConnection = z.infer<typeof vpnConnectionSchema>

export const networkStateSchema = z.strictObject({
  wifiEnabled: z.boolean(),
  wired: z.strictObject({
    connected: z.boolean(),
    name: z.optional(nonEmptyString),
  }),
  wifi: z.array(wifiNetworkSchema),
  vpn: z.array(vpnConnectionSchema),
})
export type NetworkState = z.infer<typeof networkStateSchema>

export const networkConnectWifiSchema = z.strictObject({
  ssid: nonEmptyString,
  password: z.optional(z.string()),
  autoconnect: z.boolean(),
})
export type NetworkConnectWifi = z.infer<typeof networkConnectWifiSchema>

export const networkSetVpnSchema = z.strictObject({
  id: nonEmptyString,
  connected: z.boolean(),
})
export type NetworkSetVpn = z.infer<typeof networkSetVpnSchema>

// Bluetooth (BlueZ through sysd; pairing confirms a passkey, D55). ----------

export const BLUETOOTH_DEVICE_KINDS = ['audio', 'input', 'phone', 'computer', 'other'] as const
export type BluetoothDeviceKind = (typeof BLUETOOTH_DEVICE_KINDS)[number]

export const bluetoothDeviceSchema = z.strictObject({
  id: nonEmptyString,
  name: nonEmptyString,
  kind: z.enum(BLUETOOTH_DEVICE_KINDS),
  paired: z.boolean(),
  connected: z.boolean(),
  batteryPercent: z.optional(percent),
})
export type BluetoothDevice = z.infer<typeof bluetoothDeviceSchema>

export const bluetoothStateSchema = z.strictObject({
  enabled: z.boolean(),
  devices: z.array(bluetoothDeviceSchema),
})
export type BluetoothState = z.infer<typeof bluetoothStateSchema>

export const bluetoothDeviceRefSchema = z.strictObject({ id: nonEmptyString })
export type BluetoothDeviceRef = z.infer<typeof bluetoothDeviceRefSchema>

export const bluetoothPairStartedSchema = z.strictObject({
  passkey: z.string().check(z.regex(/^\d{6}$/)),
})
export type BluetoothPairStarted = z.infer<typeof bluetoothPairStartedSchema>

export const bluetoothConfirmPairSchema = z.strictObject({
  id: nonEmptyString,
  accept: z.boolean(),
})
export type BluetoothConfirmPair = z.infer<typeof bluetoothConfirmPairSchema>

export const bluetoothPairedSchema = z.strictObject({ paired: z.boolean() })
export type BluetoothPaired = z.infer<typeof bluetoothPairedSchema>

export const bluetoothSetConnectedSchema = z.strictObject({
  id: nonEmptyString,
  connected: z.boolean(),
})
export type BluetoothSetConnected = z.infer<typeof bluetoothSetConnectedSchema>

// Cellular (ModemManager through sysd). --------------------------------------

export const cellularStateSchema = z.strictObject({
  present: z.boolean(),
  enabled: z.boolean(),
  connected: z.boolean(),
  operator: z.optional(nonEmptyString),
  technology: z.optional(nonEmptyString),
  signalPercent: z.optional(percent),
})
export type CellularState = z.infer<typeof cellularStateSchema>

// Sound (PipeWire through sysd). ---------------------------------------------

export const AUDIO_DIRECTIONS = ['output', 'input'] as const
export type AudioDirection = (typeof AUDIO_DIRECTIONS)[number]

export const audioDeviceSchema = z.strictObject({
  id: nonEmptyString,
  name: nonEmptyString,
  volumePercent: percent,
  muted: z.boolean(),
  isDefault: z.boolean(),
})
export type AudioDevice = z.infer<typeof audioDeviceSchema>

export const soundStateSchema = z.strictObject({
  outputs: z.array(audioDeviceSchema),
  inputs: z.array(audioDeviceSchema),
})
export type SoundState = z.infer<typeof soundStateSchema>

export const soundDeviceRefSchema = z.strictObject({
  id: nonEmptyString,
  direction: z.enum(AUDIO_DIRECTIONS),
})
export type SoundDeviceRef = z.infer<typeof soundDeviceRefSchema>

export const soundSetVolumeSchema = z.strictObject({
  id: nonEmptyString,
  direction: z.enum(AUDIO_DIRECTIONS),
  volumePercent: percent,
})
export type SoundSetVolume = z.infer<typeof soundSetVolumeSchema>

export const soundSetMutedSchema = z.strictObject({
  id: nonEmptyString,
  direction: z.enum(AUDIO_DIRECTIONS),
  muted: z.boolean(),
})
export type SoundSetMuted = z.infer<typeof soundSetMutedSchema>

// Displays (the compositor and logind/DDC-CI brightness through sysd). -------

export const displayModeSchema = z.strictObject({
  widthPx: positiveInt,
  heightPx: positiveInt,
  refreshMilliHz: positiveInt,
})
export type DisplayMode = z.infer<typeof displayModeSchema>

export const displayOutputSchema = z.strictObject({
  id: nonEmptyString,
  name: nonEmptyString,
  connected: z.boolean(),
  enabled: z.boolean(),
  primary: z.boolean(),
  widthPx: positiveInt,
  heightPx: positiveInt,
  refreshMilliHz: positiveInt,
  scalePercent: positiveInt,
  brightnessPercent: z.optional(percent),
  modes: z.array(displayModeSchema),
})
export type DisplayOutput = z.infer<typeof displayOutputSchema>

export const displaysStateSchema = z.strictObject({
  outputs: z.array(displayOutputSchema),
})
export type DisplaysState = z.infer<typeof displaysStateSchema>

export const displaysSetOutputSchema = z.strictObject({
  id: nonEmptyString,
  enabled: z.optional(z.boolean()),
  widthPx: z.optional(positiveInt),
  heightPx: z.optional(positiveInt),
  refreshMilliHz: z.optional(positiveInt),
  scalePercent: z.optional(positiveInt),
  primary: z.optional(z.boolean()),
})
export type DisplaysSetOutput = z.infer<typeof displaysSetOutputSchema>

export const displaysSetBrightnessSchema = z.strictObject({
  id: nonEmptyString,
  brightnessPercent: percent,
})
export type DisplaysSetBrightness = z.infer<typeof displaysSetBrightnessSchema>

// Power and sleep (UPower, power-profiles-daemon and logind through sysd). --

export const BATTERY_STATES = ['charging', 'discharging', 'full', 'empty', 'unknown'] as const
export type BatteryState = (typeof BATTERY_STATES)[number]

export const POWER_PROFILES = ['power-saver', 'balanced', 'performance'] as const
export type PowerProfile = (typeof POWER_PROFILES)[number]

export const LID_CLOSE_ACTIONS = ['sleep', 'lock', 'nothing'] as const
export type LidCloseAction = (typeof LID_CLOSE_ACTIONS)[number]
export const lidCloseActionSchema = z.enum(LID_CLOSE_ACTIONS)

export const POWER_BUTTON_ACTIONS = ['prompt', 'sleep', 'shutdown'] as const
export type PowerButtonAction = (typeof POWER_BUTTON_ACTIONS)[number]
export const powerButtonActionSchema = z.enum(POWER_BUTTON_ACTIONS)

export const batterySchema = z.strictObject({
  percent: percent,
  state: z.enum(BATTERY_STATES),
  minutesLeft: z.optional(nonNegativeInt),
})
export type Battery = z.infer<typeof batterySchema>

export const powerStateSchema = z.strictObject({
  batteries: z.array(batterySchema),
  profile: z.enum(POWER_PROFILES),
  displayOffMinutes: nonNegativeInt,
  sleepMinutes: nonNegativeInt,
  onLidClose: z.enum(LID_CLOSE_ACTIONS),
  onPowerButton: z.enum(POWER_BUTTON_ACTIONS),
})
export type PowerState = z.infer<typeof powerStateSchema>

export const powerSetProfileSchema = z.strictObject({ profile: z.enum(POWER_PROFILES) })
export type PowerSetProfile = z.infer<typeof powerSetProfileSchema>

export const powerSetTimeoutsSchema = z.strictObject({
  displayOffMinutes: nonNegativeInt,
  sleepMinutes: nonNegativeInt,
})
export type PowerSetTimeouts = z.infer<typeof powerSetTimeoutsSchema>

export const powerSetActionsSchema = z.strictObject({
  onLidClose: lidCloseActionSchema,
  onPowerButton: powerButtonActionSchema,
})
export type PowerSetActions = z.infer<typeof powerSetActionsSchema>

// Printers (CUPS through sysd; driverless IPP, no cups-browsed, D73). --------

export const PRINTER_STATUSES = ['idle', 'printing', 'offline', 'error'] as const
export type PrinterStatus = (typeof PRINTER_STATUSES)[number]

export const printerSchema = z.strictObject({
  id: nonEmptyString,
  name: nonEmptyString,
  status: z.enum(PRINTER_STATUSES),
  isDefault: z.boolean(),
})
export type Printer = z.infer<typeof printerSchema>

export const printersStateSchema = z.strictObject({
  printers: z.array(printerSchema),
})
export type PrintersState = z.infer<typeof printersStateSchema>

export const printerRefSchema = z.strictObject({ id: nonEmptyString })
export type PrinterRef = z.infer<typeof printerRefSchema>

export const printersAddSchema = z.strictObject({ uri: nonEmptyString })
export type PrintersAdd = z.infer<typeof printersAddSchema>

export const printersAddedSchema = z.strictObject({ id: nonEmptyString })
export type PrintersAdded = z.infer<typeof printersAddedSchema>

// Storage (udisks2 through sysd; removable media never auto-runs, D73). ------

export const storageVolumeSchema = z.strictObject({
  id: nonEmptyString,
  name: nonEmptyString,
  sizeBytes: nonNegativeInt,
  usedBytes: nonNegativeInt,
  mountPoint: z.optional(nonEmptyString),
  removable: z.boolean(),
  ejectable: z.boolean(),
})
export type StorageVolume = z.infer<typeof storageVolumeSchema>

export const storageStateSchema = z.strictObject({
  volumes: z.array(storageVolumeSchema),
})
export type StorageState = z.infer<typeof storageStateSchema>

export const storageEjectSchema = z.strictObject({ id: nonEmptyString })
export type StorageEject = z.infer<typeof storageEjectSchema>

// Date and time (timedate1 through sysd). -------------------------------------

export const dateTimeStateSchema = z.strictObject({
  automatic: z.boolean(),
  timezone: nonEmptyString,
  zoneNames: z.array(nonEmptyString),
  nowUnixMs: nonNegativeInt,
})
export type DateTimeState = z.infer<typeof dateTimeStateSchema>

export const dateTimeSetAutomaticSchema = z.strictObject({ automatic: z.boolean() })
export type DateTimeSetAutomatic = z.infer<typeof dateTimeSetAutomaticSchema>

export const dateTimeSetTimezoneSchema = z.strictObject({ timezone: nonEmptyString })
export type DateTimeSetTimezone = z.infer<typeof dateTimeSetTimezoneSchema>

export const dateTimeSetManualSchema = z.strictObject({ unixMs: nonNegativeInt })
export type DateTimeSetManual = z.infer<typeof dateTimeSetManualSchema>

// Language and region (locale1 through sysd; names come from the OS, so the
// page never carries its own language-name table). ----------------------------

export const localeNameSchema = z.strictObject({
  code: nonEmptyString,
  name: nonEmptyString,
})
export type LocaleName = z.infer<typeof localeNameSchema>

export const localeStateSchema = z.strictObject({
  language: nonEmptyString,
  region: nonEmptyString,
  languages: z.array(localeNameSchema),
  regions: z.array(localeNameSchema),
})
export type LocaleState = z.infer<typeof localeStateSchema>

export const localeSetSchema = z.strictObject({
  language: nonEmptyString,
  region: nonEmptyString,
})
export type LocaleSet = z.infer<typeof localeSetSchema>

// The method table: every frame the settings app sends or parses. ------------

const emptyParams = z.strictObject({})

interface SysdMethodDef<Params, Result> {
  readonly params: z.ZodMiniType<Params>
  readonly result: z.ZodMiniType<Result>
}

function method<Params, Result>(
  params: z.ZodMiniType<Params>,
  result: z.ZodMiniType<Result>,
): SysdMethodDef<Params, Result> {
  return { params, result }
}

export const SYSD_METHODS = {
  'network.get': method(emptyParams, networkStateSchema),
  'network.setWifiEnabled': method(z.strictObject({ enabled: z.boolean() }), sysdOkSchema),
  'network.connectWifi': method(networkConnectWifiSchema, sysdOkSchema),
  'network.disconnectWifi': method(emptyParams, sysdOkSchema),
  'network.forgetWifi': method(z.strictObject({ ssid: nonEmptyString }), sysdOkSchema),
  'network.setVpn': method(networkSetVpnSchema, sysdOkSchema),
  'bluetooth.get': method(emptyParams, bluetoothStateSchema),
  'bluetooth.setEnabled': method(z.strictObject({ enabled: z.boolean() }), sysdOkSchema),
  'bluetooth.startPair': method(bluetoothDeviceRefSchema, bluetoothPairStartedSchema),
  'bluetooth.confirmPair': method(bluetoothConfirmPairSchema, bluetoothPairedSchema),
  'bluetooth.setConnected': method(bluetoothSetConnectedSchema, sysdOkSchema),
  'bluetooth.remove': method(bluetoothDeviceRefSchema, sysdOkSchema),
  'cellular.get': method(emptyParams, cellularStateSchema),
  'cellular.setEnabled': method(z.strictObject({ enabled: z.boolean() }), sysdOkSchema),
  'cellular.setConnected': method(z.strictObject({ connected: z.boolean() }), sysdOkSchema),
  'sound.get': method(emptyParams, soundStateSchema),
  'sound.setVolume': method(soundSetVolumeSchema, sysdOkSchema),
  'sound.setMuted': method(soundSetMutedSchema, sysdOkSchema),
  'sound.setDefault': method(soundDeviceRefSchema, sysdOkSchema),
  'displays.get': method(emptyParams, displaysStateSchema),
  'displays.setOutput': method(displaysSetOutputSchema, sysdOkSchema),
  'displays.setBrightness': method(displaysSetBrightnessSchema, sysdOkSchema),
  'power.get': method(emptyParams, powerStateSchema),
  'power.setProfile': method(powerSetProfileSchema, sysdOkSchema),
  'power.setTimeouts': method(powerSetTimeoutsSchema, sysdOkSchema),
  'power.setActions': method(powerSetActionsSchema, sysdOkSchema),
  'printers.get': method(emptyParams, printersStateSchema),
  'printers.setDefault': method(printerRefSchema, sysdOkSchema),
  'printers.add': method(printersAddSchema, printersAddedSchema),
  'printers.remove': method(printerRefSchema, sysdOkSchema),
  'storage.get': method(emptyParams, storageStateSchema),
  'storage.eject': method(storageEjectSchema, sysdOkSchema),
  'datetime.get': method(emptyParams, dateTimeStateSchema),
  'datetime.setAutomatic': method(dateTimeSetAutomaticSchema, sysdOkSchema),
  'datetime.setTimezone': method(dateTimeSetTimezoneSchema, sysdOkSchema),
  'datetime.setManual': method(dateTimeSetManualSchema, sysdOkSchema),
  'locale.get': method(emptyParams, localeStateSchema),
  'locale.set': method(localeSetSchema, sysdOkSchema),
} as const

export type SysdMethod = keyof typeof SYSD_METHODS
export const SYSD_METHOD_NAMES = Object.keys(SYSD_METHODS) as SysdMethod[]

export type SysdParams<M extends SysdMethod> = z.infer<(typeof SYSD_METHODS)[M]['params']>
export type SysdResult<M extends SysdMethod> = z.infer<(typeof SYSD_METHODS)[M]['result']>

// The renderer's sysd caller. The transport (the main process's proxy to
// the owner-only socket) lands with lane SY; the settings shell holds one
// of these and its absence is the honest "service unavailable" state.
export interface SysdClient {
  request<M extends SysdMethod>(method: M, params: SysdParams<M>): Promise<SysdResult<M>>
}

// Encode one JSON-RPC request, validating the caller's params first.
export function encodeSysdRequest<M extends SysdMethod>(
  id: string,
  method: M,
  params: SysdParams<M>,
): SysdRequest {
  const parsed = z.parse(SYSD_METHODS[method].params, params)
  return { jsonrpc: '2.0', id, method, params: parsed }
}

const sysdSuccessSchema = z.strictObject({
  jsonrpc: z.literal('2.0'),
  id: nonEmptyString,
  result: z.unknown(),
})

// JSON-RPC's Internal error, used when a response answers another request.
const JSON_RPC_INTERNAL_ERROR = -32_603

// Parse one JSON-RPC response for the method that was sent: the id must
// echo, an error envelope becomes a SysdError carrying its code, and a
// success result is validated before use.
export function parseSysdResponse<M extends SysdMethod>(
  method: M,
  id: string,
  data: unknown,
): SysdResult<M> {
  const failed = z.safeParse(sysdErrorSchema, data)
  if (failed.success) {
    if (failed.data.id !== id) {
      throw new SysdError(JSON_RPC_INTERNAL_ERROR, `sysd answered request ${id} with another id`)
    }
    throw new SysdError(failed.data.error.code, failed.data.error.message)
  }
  const parsed = z.parse(sysdSuccessSchema, data)
  if (parsed.id !== id) {
    throw new SysdError(JSON_RPC_INTERNAL_ERROR, `sysd answered request ${id} with another id`)
  }
  return z.parse(SYSD_METHODS[method].result, parsed.result) as SysdResult<M>
}
