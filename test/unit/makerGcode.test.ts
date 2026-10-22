import * as z from 'zod/mini'
import { makerLimits as limits } from './helpers/fakeMakerMachine'
import { describe, expect, it } from 'vitest'
import { analyseGcode, type GcodeState, type Bounds } from '../../src/core/maker/gcode/analyser'
import grblArcCapture from '../fixtures/maker/grbl-arcs.json'
import klipperArcCapture from '../fixtures/maker/klipper-arcs.json'
import { gcodeClass, type GcodeDialect } from '../../src/core/maker/gcode/dialects'
import { checkGcodeLimits, effectiveLimits, limitsSchema } from '../../src/core/maker/gcode/limits'
import {
  canonicalGcodeCommand,
  serializeGcode,
  tokenizeGcode,
} from '../../src/core/maker/gcode/tokenizer'

const policy = { maxBytes: 4096, maxLines: 30, mmPerInch: 25.4 }
const initial: GcodeState = {
  position: { x: 10, y: 10, z: 10 },
  absolute: true,
  unit: 'mm',
  feedMmMin: 600,
}

const analyse = (script: string) => analyseGcode(script, 'klipper', initial, policy)

function expectCapturedArcBounds(name: string, dialect: GcodeDialect, values: unknown) {
  const [plane, command, mode, units] = z
    .tuple([
      z.enum(['G17', 'G18', 'G19']),
      z.enum(['G2', 'G3']),
      z.enum(['G90', 'G91']),
      z.enum(['G20', 'G21']),
    ])
    .parse(name.split('-'))
  const capture = dialect === 'grbl' ? grblArcCapture : klipperArcCapture
  const scale = units === 'G21' ? 1 : policy.mmPerInch
  const coordinate = (mode === 'G90' ? capture.initial.x / scale : 0).toFixed(12)
  const payload = `${units}\n${mode}\n${command} X${coordinate} Y${coordinate} Z${coordinate} ${plane === 'G19' ? 'J' : 'I'}${(capture.radiusMm / scale).toFixed(12)} F${(600 / scale).toFixed(12)}`
  const [minX, minY, minZ, maxX, maxY, maxZ] = z
    .tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])
    .parse(values)
  const captured: Bounds = {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  }
  const result = analyseGcode(payload, dialect, { ...initial, position: capture.initial }, policy)
  expect(result.unknown).toEqual([])
  const bounds = result.bounds
  expect(bounds).toBeDefined()
  if (bounds === undefined) throw new Error('missingBounds')
  for (const axis of ['x', 'y', 'z'] as const) {
    expect(bounds.min[axis]).toBeLessThanOrEqual(captured.min[axis])
    expect(bounds.max[axis]).toBeGreaterThanOrEqual(captured.max[axis])
  }
  if (captured.max.z > capture.zCapMm) {
    expect(
      checkGcodeLimits(
        result,
        {
          ...limits,
          travel: { ...limits.travel, max: { ...limits.travel.max, z: capture.zCapMm } },
        },
        true,
      ),
    ).toBe('travelLimit')
  }
}

describe('maker G-code tokenizer and dialects', () => {
  it('serializes the canonical stream and uses it directly for analysis', () => {
    const blocks = tokenizeGcode(
      ' (ignored) g0001x+001.50 y-00 F0600 ; ignored\r\n\tm00104 S0200\n',
      policy,
    )
    expect(serializeGcode(blocks)).toBe('G1 X1.5 Y0 F600\nM104 S200')
    expect(analyseGcode(blocks, 'klipper', initial, policy)).toEqual(
      analyse(serializeGcode(blocks)),
    )
    expect(canonicalGcodeCommand(' m00104 ')).toBe('M104')
  })
  it('refuses exponent-form serialization and opaque macro arguments', () => {
    for (const payload of ['G1 X0.00000001', 'G1 X' + '9'.repeat(22), 'CUSTOM X=1'])
      expect(() => serializeGcode(tokenizeGcode(payload, policy))).toThrow('syntax')
  })
  it('retains exact lines while removing comments from analysis', () => {
    const blocks = tokenizeGcode('G01X12.5Y-2 (ignored M500); text\nM105\r\n', policy)
    expect(blocks).toMatchObject([
      { command: 'G1', parameters: { X: 12.5, Y: -2 }, raw: 'G01X12.5Y-2 (ignored M500); text' },
      { command: 'M105' },
    ])
  })
  it.each([
    'G1 X1 X2',
    'G1 X1 M500',
    'N1 G1 X2*22',
    'G1 XNaN',
    'G1 X1\u{1B}',
    'G1 (oops',
    'G1 ((x))',
    'G1 X1)',
    'G1 X20 ;\u{18}',
    'G1 X20 (comment\u{18})',
  ])('rejects ambiguous syntax %s', (script) => {
    expect(() => tokenizeGcode(script, policy)).toThrow('syntax')
  })
  it('bounds bytes and lines before analysis', () => {
    expect(() => tokenizeGcode('G1 X1'.repeat(1000), policy)).toThrow('payloadSize')
    expect(() => tokenizeGcode('M105\n'.repeat(31), policy)).toThrow('payloadSize')
  })
  it.each([
    'M500',
    'M502',
    'M997',
    'M999',
    'SHUTDOWN_MACHINE',
    'REBOOT_MACHINE',
    'SET_PIN',
    'FORCE_MOVE',
    'SET_KINEMATIC_POSITION',
    'SET_VELOCITY_LIMIT',
    'PID_CALIBRATE',
    'UPDATE_DELAYED_GCODE',
    'SET_GCODE_VARIABLE',
    'M80',
    'M81',
    'M42',
    'M303',
    'FIRMWARE_RESTART',
    'RESTART',
    'SAVE_CONFIG',
    '$X',
    '$RST=*',
    '$N0=G1X10',
    '$130=999',
  ])('refuses persistent/dangerous command %s', (command) => {
    expect(gcodeClass(command, 'marlin')).toBe('refused')
  })
  it('treats macros and unknown commands as actuation, never Stop', () => {
    for (const command of ['PAUSE', 'RESUME', 'CANCEL_PRINT', 'CUSTOM', 'G28', 'M112', 'M410']) {
      expect(gcodeClass(command, 'klipper')).toBe('actuate')
    }
    expect(gcodeClass('$$', 'grbl')).toBe('observe')
    expect(gcodeClass('STATUS', 'klipper')).toBe('observe')
    expect(gcodeClass('STATUS', 'marlin')).toBe('actuate')
  })
})
describe('maker G-code analysis and limits', () => {
  it('handles relative and absolute positions, mm/inch and modal feeds', () => {
    const result = analyse('G91\nG1 X5 F900\nG90\nG20\nG1 X1 Y2 F30\nG21\nG1 Z20')
    expect(result.bounds).toEqual({
      min: { x: 10, y: 10, z: 10 },
      max: { x: 25.4, y: 50.8, z: 20 },
    })
    expect(result.maxFeedMmMin).toBe(900)
    expect(result.unknown).toEqual([])
    expect(checkGcodeLimits(result, limits, true)).toBeUndefined()
  })
  it('includes arc extrema, not merely endpoints', () => {
    const result = analyse('G2 X10 Y10 I-20 J0')
    expect(result.bounds).toEqual({ min: { x: -30, y: -10, z: -10 }, max: { x: 10, y: 30, z: 30 } })
    expect(checkGcodeLimits(result, limits, true)).toBe('travelLimit')
  })
  it.each(['G2', 'G3'])(
    'bounds %s in unseen XZ and YZ planes and refuses the user Z cap',
    (command) => {
      for (const offset of ['I5', 'J5']) {
        const result = analyse(`${command} X10 Y10 ${offset} F600`)
        expect(result.unknown).toEqual([])
        expect(result.bounds?.min.z).toBe(5)
        expect(result.bounds?.max.z).toBe(15)
        expect(
          checkGcodeLimits(
            result,
            { ...limits, travel: { ...limits.travel, max: { ...limits.travel.max, z: 12 } } },
            true,
          ),
        ).toBe('travelLimit')
      }
    },
  )
  it('does not admit plane selectors or K arcs while bounding their offline geometry', () => {
    for (const script of ['G17', 'G18', 'G19', 'G2 K5', 'G3 J5 K5']) {
      expect(checkGcodeLimits(analyse(script), limits, true)).toBe('unknownEffects')
    }
    const result = analyse('G3 J5 K5')
    expect(result.bounds?.max.z).toBeGreaterThan(20)
  })
  it('takes maximum targets and feeds across the entire script', () => {
    const result = analyse('M104 S260\nM104 S0\nM190 R110\nG1 X20 F2000\nG1 X10 F10')
    expect(result.temperatures).toEqual({ extruder: 260, bed: 110 })
    expect(result.maxFeedMmMin).toBe(2000)
    expect(checkGcodeLimits(result, limits, true)).toBe('feedLimit')
    expect(checkGcodeLimits(analyse('M104 S260\nM104 S0'), limits, true)).toBe('temperatureLimit')
  })
  it.each([
    'G92 X0\nG1 X300',
    'G2 X20 R10',
    'G1 E10',
    'G1 X1e99',
    'STATUS ARG=1',
    'PAUSE',
    'CANCEL_PRINT',
    'CUSTOM X=10',
    'M104 S-1',
    'M104 S100 R200',
    'G90 X1',
    'G1 X20 F0',
  ])('refuses unknown effects %s', (script) => {
    expect(checkGcodeLimits(analyse(script), limits, true)).toBe('unknownEffects')
  })
  it('refuses motion before homing, without limits and beyond each limit', () => {
    expect(checkGcodeLimits(analyse('G1 X20'), limits, false)).toBe('unhomed')
    expect(checkGcodeLimits(analyse('M105'), {}, true)).toBe('unknownLimits')
    expect(checkGcodeLimits(analyse('G1 X201'), limits, true)).toBe('travelLimit')
    expect(checkGcodeLimits(analyse('G1 F1201'), limits, true)).toBe('feedLimit')
    expect(checkGcodeLimits(analyse('M140 S101'), limits, true)).toBe('temperatureLimit')
    expect(checkGcodeLimits(analyse('M500'), limits, true)).toBe('refusedCommand')
    expect(checkGcodeLimits(analyse('M104 S10'), { ...limits, extruder: undefined }, true)).toBe(
      'unknownLimits',
    )
  })
  it('never increases machine limits to user limits or supplies missing ones', () => {
    expect(effectiveLimits(limits, { ...limits, feedMmMin: 600, extruder: 300 })).toEqual({
      ...limits,
      feedMmMin: 600,
    })
    expect(effectiveLimits({}, limits)).toEqual({})
    expect(effectiveLimits(limits, {})).toEqual({})
    expect(
      limitsSchema.safeParse({ travel: { min: { x: 10, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } } })
        .success,
    ).toBe(false)
    expect(limitsSchema.safeParse({ feedMmMin: NaN }).success).toBe(false)
  })
})

describe('maker native firmware arc-plane replay captures', () => {
  it.each(Object.entries(grblArcCapture.accepted))('bounds native GRBL %s', (name, values) => {
    expect(grblArcCapture.acceptedReply).toBe('ok')
    expectCapturedArcBounds(name, 'grbl', values)
  })
  it.each(Object.entries(klipperArcCapture.accepted))(
    'bounds native Klipper %s',
    (name, values) => {
      expect(klipperArcCapture.acceptedReply).toBe('exit 0')
      expectCapturedArcBounds(name, 'klipper', values)
    },
  )
  it.each(Object.entries(klipperArcCapture.rejected))(
    'records native Klipper rejection for %s',
    (name, errors) => {
      expect(klipperArcCapture.rejectedReply).toBe('exit 255')
      expect(errors).toContain(
        name.endsWith('G20')
          ? 'Machine does not support G20 (inches) command'
          : 'G2/G3 does not support relative move mode',
      )
    },
  )
})
