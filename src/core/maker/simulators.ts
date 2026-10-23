// D83.7/D215 (RLF-DEVICES): the printer, CNC and microcontroller
// simulators. Virtual machines with documented behavior: they model
// opens, sends, stops and errors, and journal every receipt. The
// golden rule: every physical action is proven on a simulator first,
// and simulator receipts never qualify real hardware. Responses are
// virtual-machine wording, Marlin/GRBL-flavored where trivial; no
// byte-wire fidelity with real firmware is claimed (that qualification
// rides M103's machine lanes with hardware).
import { createHash } from 'node:crypto'
import type { MakerTarget } from '../../shared/maker'
import { MAKER_AXIS_KEY, makerLineCommand, makerWordValue, parseMakerWords } from './classify'
import { makerPayloadDigest } from './approval'
import type { MakerEnvelopeLimits } from './analysis'
import type {
  MakerConnectionResponse,
  MakerMachineConnection,
  MakerMachineState,
  MakerPosition,
  MakerReceipt,
  MakerStopWarning,
} from './executors'

/** Virtual ambient temperature in C. */
const SIM_AMBIENT_C = 20

/** GRBL reports positions to 3 decimals; Marlin-flavored lines use 2. */
const GRBL_POSITION_DECIMALS = 3

/** D83.5's GRBL stop bytes: feed hold, jog cancel, soft reset. */
const GRBL_FEED_HOLD = 0x21
const GRBL_JOG_CANCEL = 0x85
const GRBL_SOFT_RESET = 0x18

function simDigest(bytes: Uint8Array): string {
  return makerPayloadDigest(bytes)
}

function fingerprintOf(canonical: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

abstract class MakerSimulatorBase implements MakerMachineConnection {
  public abstract readonly target: MakerTarget
  protected seq = 0
  protected readonly journal: MakerReceipt[] = []

  public abstract readState(): MakerMachineState
  public abstract readLimits(): MakerEnvelopeLimits
  public abstract open(): Promise<MakerConnectionResponse>
  public abstract close(): Promise<MakerConnectionResponse>
  public abstract send(payload: Uint8Array): Promise<MakerConnectionResponse>
  public abstract stop(): Promise<MakerConnectionResponse & { readonly warning?: MakerStopWarning }>

  public receipts(): readonly MakerReceipt[] {
    return [...this.journal]
  }

  protected receive(
    kind: MakerReceipt['kind'],
    bytes: Uint8Array,
    response: string,
    stateBefore: string,
  ): MakerConnectionResponse {
    const receipt: MakerReceipt = {
      seq: this.seq,
      kind,
      digest: simDigest(bytes),
      byteLength: bytes.byteLength,
      response,
      stateBefore,
      stateAfter: this.fingerprint(),
    }
    this.seq += 1
    this.journal.push(receipt)
    return { response, receipt }
  }

  protected abstract fingerprint(): string
}

export interface PrinterSimRecord {
  readonly target: MakerTarget
  /** The machine's reported envelope; undefined reports no limits. */
  readonly limits: MakerEnvelopeLimits | undefined
  readonly softLimits: boolean
  readonly startHomed: boolean
  readonly startPosition: MakerPosition
}

export function printerSimRecord(overrides?: Partial<PrinterSimRecord>): PrinterSimRecord {
  return {
    target: {
      kind: 'printer',
      name: 'Ender (simulator)',
      endpoint: 'sim://printer/0',
      vidPid: '1A86:7523',
      usbSerial: 'SIM0001',
      reportedAs: 'virtual-marlin 2.1',
      simulated: true,
    },
    limits: {
      travelMm: { min: { x: 0, y: 0, z: 0 }, max: { x: 220, y: 220, z: 250 } },
      maxTempC: 260,
      maxFeedMmMin: 9000,
    },
    softLimits: true,
    startHomed: false,
    startPosition: { x: 0, y: 0, z: 0 },
    ...overrides,
  }
}

interface PrinterSimState {
  open: boolean
  position: { x: number; y: number; z: number }
  homedAxes: { x: boolean; y: boolean; z: boolean }
  nozzleTemp: number
  bedTemp: number
  nozzleTarget: number
  bedTarget: number
  printing: boolean
  halted: boolean
}

/**
A virtual Marlin-style printer on a virtual serial port. Opening the
port resets the board (D83.3's warning made real): position lost,
unhomed, heaters off, halt cleared. Heating is instant; travel
clamps to the record envelope with the clamp noted.
*/
export class PrinterSimulator extends MakerSimulatorBase {
  private readonly state: PrinterSimState
  public readonly target: MakerTarget
  public constructor(private readonly record: PrinterSimRecord) {
    super()
    this.target = record.target
    this.state = {
      open: false,
      position: { ...record.startPosition },
      homedAxes: {
        x: record.startHomed,
        y: record.startHomed,
        z: record.startHomed,
      },
      nozzleTemp: SIM_AMBIENT_C,
      bedTemp: SIM_AMBIENT_C,
      nozzleTarget: 0,
      bedTarget: 0,
      printing: false,
      halted: false,
    }
  }

  private clampTravel(next: { x: number; y: number; z: number }): boolean {
    const travel = this.record.limits?.travelMm
    if (travel === undefined) {
      this.state.position = next
      return false
    }
    let didClamp = false
    const position = { ...next }
    for (const axis of ['x', 'y', 'z'] as const) {
      const floor = travel.min?.[axis]
      const ceiling = travel.max?.[axis]
      const clampedValue = Math.min(
        ceiling ?? position[axis],
        Math.max(floor ?? position[axis], position[axis]),
      )
      if (clampedValue === position[axis]) continue
      position[axis] = clampedValue
      didClamp = true
    }
    this.state.position = position
    return didClamp
  }

  private sendLine(line: string): string {
    const command = makerLineCommand(line)
    if (command === '') return 'ok'
    if (command !== 'M999' && this.state.halted)
      return 'Error: Printer halted. Send M999 to resume.'
    const words = parseMakerWords(line)
    if (command === 'G28') {
      const hasNamedAxes = words.some((word) => ['X', 'Y', 'Z'].includes(word.letter))
      for (const [upper, key] of Object.entries(MAKER_AXIS_KEY)) {
        if (hasNamedAxes && words.every((word) => word.letter !== upper)) continue
        this.state.position[key] = 0
        this.state.homedAxes[key] = true
      }
      return 'ok'
    }
    if (['G0', 'G1', 'G2', 'G3'].includes(command)) {
      const next = { ...this.state.position }
      for (const axis of ['X', 'Y', 'Z'] as const) {
        const raw = makerWordValue(words, axis)
        if (raw === undefined || raw === null) continue
        next[MAKER_AXIS_KEY[axis]] = raw
      }
      const didClamp = this.clampTravel(next)
      return didClamp ? 'ok // clamped to travel' : 'ok'
    }
    if (['M104', 'M109'].includes(command)) {
      const temp = makerWordValue(words, 'S')
      if (temp !== undefined && temp !== null) {
        this.state.nozzleTarget = temp
        this.state.nozzleTemp = temp
      }
      return 'ok'
    }
    if (['M140', 'M190'].includes(command)) {
      const temp = makerWordValue(words, 'S')
      if (temp !== undefined && temp !== null) {
        this.state.bedTarget = temp
        this.state.bedTemp = temp
      }
      return 'ok'
    }
    if (command === 'M105')
      return `ok T:${this.state.nozzleTemp.toFixed(1)} /${this.state.nozzleTarget.toFixed(1)} B:${this.state.bedTemp.toFixed(1)} /${this.state.bedTarget.toFixed(1)}`
    if (command === 'M114')
      return `X:${this.state.position.x.toFixed(2)} Y:${this.state.position.y.toFixed(2)} Z:${this.state.position.z.toFixed(2)} ok`
    if (command === 'M115')
      return 'FIRMWARE_NAME:virtual-marlin FIRMWARE_VERSION:2.1 EXTRUDER_COUNT:1 EMERGENCY_PARSER:1 ok'
    if (command === 'M503') return 'ok // settings: virtual-marlin defaults'
    if (command === 'M24') {
      this.state.printing = true
      return 'ok'
    }
    if (command === 'M25') {
      this.state.printing = false
      return 'ok'
    }
    if (command === 'M27') return this.state.printing ? 'SD printing ok' : 'Not SD printing ok'
    if (command === 'M112') {
      this.state.halted = true
      this.state.nozzleTarget = 0
      this.state.bedTarget = 0
      this.state.printing = false
      return 'Error: Printer halted. kill() called!'
    }
    if (command === 'M999') {
      this.state.halted = false
      return 'ok'
    }
    return command.startsWith('M') || command.startsWith('G') || command.startsWith('T')
      ? 'ok'
      : `echo:Unknown command: "${command}"\nok`
  }

  public readState(): MakerMachineState {
    return {
      fingerprint: this.fingerprint(),
      open: this.state.open,
      position: { ...this.state.position },
      homed: this.state.homedAxes.x && this.state.homedAxes.y && this.state.homedAxes.z,
      softLimits: this.record.softLimits,
    }
  }

  public readLimits(): MakerEnvelopeLimits {
    return this.record.limits ?? {}
  }

  protected fingerprint(): string {
    return fingerprintOf({
      open: this.state.open,
      position: this.state.position,
      homedAxes: this.state.homedAxes,
      nozzleTemp: this.state.nozzleTemp,
      bedTemp: this.state.bedTemp,
      nozzleTarget: this.state.nozzleTarget,
      bedTarget: this.state.bedTarget,
      printing: this.state.printing,
      halted: this.state.halted,
      seq: this.seq,
    })
  }

  public open(): Promise<MakerConnectionResponse> {
    const before = this.fingerprint()
    if (this.state.open)
      return Promise.resolve(this.receive('open', new Uint8Array(0), 'already open', before))
    this.state.open = true
    // The serial open resets the board: everything returns to boot.
    this.state.position = { x: 0, y: 0, z: 0 }
    this.state.homedAxes = { x: false, y: false, z: false }
    this.state.nozzleTemp = SIM_AMBIENT_C
    this.state.bedTemp = SIM_AMBIENT_C
    this.state.nozzleTarget = 0
    this.state.bedTarget = 0
    this.state.printing = false
    this.state.halted = false
    return Promise.resolve(this.receive('open', new Uint8Array(0), 'ok', before))
  }

  public close(): Promise<MakerConnectionResponse> {
    const before = this.fingerprint()
    this.state.open = false
    return Promise.resolve(this.receive('close', new Uint8Array(0), 'ok', before))
  }

  public send(payload: Uint8Array): Promise<MakerConnectionResponse> {
    const before = this.fingerprint()
    if (!this.state.open)
      return Promise.resolve(this.receive('send', payload, 'Error: not open', before))
    const text = Buffer.from(payload).toString('utf8')
    const responses = text.split('\n').map((line) => this.sendLine(line))
    return Promise.resolve(this.receive('send', payload, responses.join('\n'), before))
  }

  public stop(): Promise<MakerConnectionResponse & { readonly warning?: MakerStopWarning }> {
    const before = this.fingerprint()
    const bytes = new TextEncoder().encode('M112\n')
    if (!this.state.open)
      return Promise.resolve(this.receive('stop', bytes, 'Error: not open', before))
    this.state.halted = true
    this.state.nozzleTarget = 0
    this.state.bedTarget = 0
    this.state.printing = false
    const { response, receipt } = this.receive(
      'stop',
      bytes,
      'Error: Printer halted. kill() called!',
      before,
    )
    return Promise.resolve({ response, receipt })
  }
}

export interface CncSimRecord {
  readonly target: MakerTarget
  readonly limits: MakerEnvelopeLimits | undefined
  readonly softLimits: boolean
  readonly startHomed: boolean
  /** GRBL `$Nx=` startup lines; motion in them warns the stop (D83.5). */
  readonly startupLines: readonly string[]
}

export function cncSimRecord(overrides?: Partial<CncSimRecord>): CncSimRecord {
  return {
    target: {
      kind: 'cnc',
      name: 'Mill (simulator)',
      endpoint: 'sim://cnc/0',
      vidPid: '1A86:7523',
      usbSerial: 'SIM0002',
      reportedAs: 'virtual-grbl 1.1',
      simulated: true,
    },
    limits: {
      travelMm: { min: { x: 0, y: 0, z: 0 }, max: { x: 300, y: 180, z: 45 } },
      maxFeedMmMin: 2000,
    },
    softLimits: true,
    startHomed: false,
    startupLines: [],
    ...overrides,
  }
}

interface CncSimState {
  open: boolean
  position: { x: number; y: number; z: number }
  homed: boolean
  alarm: boolean
  spindle: 'off' | 'cw' | 'ccw'
}

/** Motion words that make a `$N` startup line hold motion (D83.5). */
const STARTUP_MOTION_PATTERN = /\b(G0|G1|G2|G3|G28|G38|\$H|\$J)\b/i

/**
A virtual GRBL-style mill. Status, settings and alarm reads answer;
motion past the envelope raises the soft-limit alarm; `$H` homes; the
stop is feed hold, jog cancel, soft reset, with the `$N` warning.
*/
export class CncSimulator extends MakerSimulatorBase {
  private readonly state: CncSimState
  public readonly target: MakerTarget
  public constructor(private readonly record: CncSimRecord) {
    super()
    this.target = record.target
    this.state = {
      open: false,
      position: { x: 0, y: 0, z: 0 },
      homed: record.startHomed,
      alarm: false,
      spindle: 'off',
    }
  }

  private statusReport(): string {
    const state = this.state.alarm ? 'Alarm' : 'Idle'
    const { x, y, z } = this.state.position
    return `<${state}|MPos:${x.toFixed(GRBL_POSITION_DECIMALS)},${y.toFixed(GRBL_POSITION_DECIMALS)},${z.toFixed(GRBL_POSITION_DECIMALS)}|FS:0,0>`
  }

  private settingsReport(): string {
    const soft = this.record.softLimits ? 1 : 0
    return [
      `$20=${String(soft)} (soft limits)`,
      '$21=1 (hard limits)',
      '$22=1 (homing)',
      'ok',
    ].join('\n')
  }

  private startupReport(): string {
    if (this.record.startupLines.length === 0) return 'ok'
    return [
      ...this.record.startupLines.map((line, index) => `$N${String(index)}=${line}`),
      'ok',
    ].join('\n')
  }

  private moveTo(next: { x: number; y: number; z: number }): string {
    if (this.state.alarm) return 'error: alarm lock'
    if (!this.state.homed) {
      this.state.alarm = true
      return 'error: homing required'
    }
    const travel = this.record.limits?.travelMm
    if (travel !== undefined && this.record.softLimits) {
      for (const axis of ['x', 'y', 'z'] as const) {
        const floor = travel.min?.[axis]
        const ceiling = travel.max?.[axis]
        if (
          (floor !== undefined && next[axis] < floor) ||
          (ceiling !== undefined && next[axis] > ceiling)
        ) {
          this.state.alarm = true
          return 'ALARM:2 soft limit'
        }
      }
    }
    this.state.position = next
    return 'ok'
  }

  private sendLine(line: string): string {
    const trimmed = line.trim()
    if (trimmed === '') return 'ok'
    const command = makerLineCommand(line)
    if (command === '?') return this.statusReport()
    if (command === '$$') return this.settingsReport()
    if (command === '$#') return '[G54:0.000,0.000,0.000]\nok'
    if (command === '$G') return '[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]\nok'
    if (command === '$I') return '[VER:virtual-grbl 1.1:]\nok'
    if (command === '$N') return this.startupReport()
    if (this.state.alarm && !['$H', '$X'].includes(command)) return 'error: alarm lock'
    if (command === '$X') {
      this.state.alarm = false
      return 'ok'
    }
    if (command === '$H') {
      this.state.position = { x: 0, y: 0, z: 0 }
      this.state.homed = true
      this.state.alarm = false
      return 'ok'
    }
    const words = parseMakerWords(line)
    if (command === '$J') {
      const next = { ...this.state.position }
      for (const axis of ['X', 'Y', 'Z'] as const) {
        const raw = makerWordValue(words, axis)
        if (raw === undefined || raw === null) continue
        next[MAKER_AXIS_KEY[axis]] += raw
      }
      return this.moveTo(next)
    }
    if (['G0', 'G1', 'G2', 'G3'].includes(command)) {
      const next = { ...this.state.position }
      for (const axis of ['X', 'Y', 'Z'] as const) {
        const raw = makerWordValue(words, axis)
        if (raw === undefined || raw === null) continue
        next[MAKER_AXIS_KEY[axis]] = raw
      }
      return this.moveTo(next)
    }
    if (['M3', 'M4'].includes(command)) {
      this.state.spindle = command === 'M3' ? 'cw' : 'ccw'
      return 'ok'
    }
    if (command === 'M5') {
      this.state.spindle = 'off'
      return 'ok'
    }
    return command.startsWith('$') || command.startsWith('M') || command.startsWith('G')
      ? 'ok'
      : 'error: unknown command'
  }

  public readState(): MakerMachineState {
    return {
      fingerprint: this.fingerprint(),
      open: this.state.open,
      position: { ...this.state.position },
      homed: this.state.homed,
      softLimits: this.record.softLimits,
    }
  }

  public readLimits(): MakerEnvelopeLimits {
    return this.record.limits ?? {}
  }

  protected fingerprint(): string {
    return fingerprintOf({
      open: this.state.open,
      position: this.state.position,
      homed: this.state.homed,
      alarm: this.state.alarm,
      spindle: this.state.spindle,
      seq: this.seq,
    })
  }

  public open(): Promise<MakerConnectionResponse> {
    const before = this.fingerprint()
    if (this.state.open)
      return Promise.resolve(this.receive('open', new Uint8Array(0), 'already open', before))
    this.state.open = true
    this.state.position = { x: 0, y: 0, z: 0 }
    this.state.homed = false
    this.state.alarm = false
    this.state.spindle = 'off'
    return Promise.resolve(this.receive('open', new Uint8Array(0), 'ok', before))
  }

  public close(): Promise<MakerConnectionResponse> {
    const before = this.fingerprint()
    this.state.open = false
    return Promise.resolve(this.receive('close', new Uint8Array(0), 'ok', before))
  }

  public send(payload: Uint8Array): Promise<MakerConnectionResponse> {
    const before = this.fingerprint()
    if (!this.state.open)
      return Promise.resolve(this.receive('send', payload, 'error: not open', before))
    const text = Buffer.from(payload).toString('utf8')
    const responses = text.split('\n').map((line) => this.sendLine(line))
    return Promise.resolve(this.receive('send', payload, responses.join('\n'), before))
  }

  public stop(): Promise<MakerConnectionResponse & { readonly warning?: MakerStopWarning }> {
    const before = this.fingerprint()
    const bytes = new Uint8Array([GRBL_FEED_HOLD, GRBL_JOG_CANCEL, GRBL_SOFT_RESET])
    if (!this.state.open)
      return Promise.resolve(this.receive('stop', bytes, 'error: not open', before))
    this.state.alarm = true
    this.state.spindle = 'off'
    const hasStartupMotion = this.record.startupLines.some((line) =>
      STARTUP_MOTION_PATTERN.test(line),
    )
    const { response, receipt } = this.receive('stop', bytes, 'ok', before)
    return Promise.resolve({
      response,
      receipt,
      ...(hasStartupMotion && { warning: 'startupMotion' as const }),
    })
  }
}

export interface McuSimRecord {
  readonly target: MakerTarget
  readonly chip: string
  readonly flashCapacityBytes: number
}

/** The virtual RP2040 board's flash: 2097152 bytes (2 MiB), RP2040-flavored. */
const MCU_FLASH_BYTES = 2_097_152

export function mcuSimRecord(overrides?: Partial<McuSimRecord>): McuSimRecord {
  return {
    target: {
      kind: 'mcu',
      name: 'Pico (simulator)',
      endpoint: 'sim://mcu/0',
      vidPid: '2E8A:0005',
      usbSerial: 'SIMRP2040',
      reportedAs: 'virtual-rp2040',
      simulated: true,
    },
    chip: 'RP2040',
    flashCapacityBytes: MCU_FLASH_BYTES,
    ...overrides,
  }
}

interface McuSimState {
  open: boolean
  resetCount: number
  flash: Uint8Array
}

/**
A virtual RP2040-style board on a virtual serial port. Opening the
port resets the board and preserves flash; a send programs the image
at offset zero with a read-back verify. Stop sends nothing to the
board: it only ends extension-side streams, and still journals.
*/
export class McuSimulator extends MakerSimulatorBase {
  private readonly state: McuSimState
  public readonly target: MakerTarget
  public constructor(private readonly record: McuSimRecord) {
    super()
    this.target = record.target
    this.state = { open: false, resetCount: 0, flash: new Uint8Array(0) }
  }

  public readState(): MakerMachineState {
    return {
      fingerprint: this.fingerprint(),
      open: this.state.open,
      board: { chip: this.record.chip },
      flashCapacityBytes: this.record.flashCapacityBytes,
    }
  }

  public readLimits(): MakerEnvelopeLimits {
    return {}
  }

  protected fingerprint(): string {
    return fingerprintOf({
      open: this.state.open,
      resetCount: this.state.resetCount,
      flashSha: simDigest(this.state.flash),
      seq: this.seq,
    })
  }

  /** The programmed image, for receipt-level assertions. */
  public flashBytes(): Uint8Array {
    return new Uint8Array(this.state.flash)
  }

  public open(): Promise<MakerConnectionResponse> {
    const before = this.fingerprint()
    if (this.state.open)
      return Promise.resolve(this.receive('open', new Uint8Array(0), 'already open', before))
    this.state.open = true
    this.state.resetCount += 1
    return Promise.resolve(this.receive('open', new Uint8Array(0), 'ok', before))
  }

  public close(): Promise<MakerConnectionResponse> {
    const before = this.fingerprint()
    this.state.open = false
    return Promise.resolve(this.receive('close', new Uint8Array(0), 'ok', before))
  }

  public send(payload: Uint8Array): Promise<MakerConnectionResponse> {
    const before = this.fingerprint()
    if (!this.state.open)
      return Promise.resolve(this.receive('send', payload, 'Error: not open', before))
    if (payload.byteLength > this.record.flashCapacityBytes)
      return Promise.resolve(this.receive('send', payload, 'Error: image exceeds flash', before))
    this.state.flash = new Uint8Array(payload)
    const response = `ok ${String(payload.byteLength)} bytes programmed and verified`
    return Promise.resolve(this.receive('send', payload, response, before))
  }

  public stop(): Promise<MakerConnectionResponse & { readonly warning?: MakerStopWarning }> {
    const before = this.fingerprint()
    const { response, receipt } = this.receive(
      'stop',
      new Uint8Array(0),
      'ok: streams stopped',
      before,
    )
    return Promise.resolve({ response, receipt })
  }
}
