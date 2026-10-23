// RLF-DEVICES: D83.2's action classes, decided by our code. Refused
// commands never send even with approval; unknown commands ask as
// actuate; CNC gets no model-proposed motion or firing this delivery.
import { describe, expect, it } from 'vitest'
import { classifyMakerLine, classifyMakerPayload } from '../../src/core/maker/classify'

describe('maker classifier', () => {
  it('refuses the D83.2 table on a printer', () => {
    for (const line of [
      'M997',
      'M502',
      'M500',
      'SAVE_CONFIG',
      'FIRMWARE_RESTART',
      'RESTART',
      'M80',
      'M81',
      'M42 P4 S255',
      'M303 E0 S200 C5',
      'N12 M500*67',
      'm500 ; lowercase still matches',
    ]) {
      expect(classifyMakerLine('printer', line).class, line).toBe('refused')
    }
    expect(classifyMakerPayload('printer', 'G28\nM500\n').class).toBe('refused')
    expect(classifyMakerPayload('printer', 'G28\nM500\n').refused).toHaveLength(1)
  })

  it('refuses composed stops: the stop tool sends them, never a payload', () => {
    expect(classifyMakerLine('printer', 'M112').class).toBe('refused')
    expect(classifyMakerLine('printer', 'M410').class).toBe('refused')
    expect(classifyMakerLine('cnc', '!').class).toBe('refused')
    expect(classifyMakerLine('cnc', 'G1 X1 !').class).toBe('refused')
  })

  it('reads GRBL dollars: settings read, writes refused', () => {
    for (const line of ['$$', '$#', '$G', '$I', '$N', '?']) {
      expect(classifyMakerLine('cnc', line).class, line).toBe('observe')
    }
    for (const line of ['$X', '$RST=*', '$N0=G92X0', '$100=80']) {
      const lineClass = classifyMakerLine('cnc', line)
      expect(lineClass.class, line).toBe('refused')
      expect(lineClass.reason, line).toBe('refused-command')
    }
  })

  it('refuses CNC motion and firing this delivery, asks on a printer', () => {
    for (const line of ['G0 X1', 'G1 X1 Y1 F800', 'G2 X1 I0.5', '$H', '$J=X1 F800', 'M3 S12000']) {
      expect(classifyMakerLine('cnc', line).reason, line).toBe('cnc-delivery')
      expect(classifyMakerLine('printer', line).class, line).toBe('actuate')
    }
  })

  it('asks unknown commands as actuate and names them', () => {
    const payload = classifyMakerPayload('printer', 'G1 X1\nFOO_BAR Q1\n')
    expect(payload.class).toBe('actuate')
    expect(payload.unknownCommands).toEqual(['FOO_BAR'])
    const macro = classifyMakerPayload('printer', 'CANCEL_PRINT\n')
    expect(macro.class).toBe('actuate')
    expect(macro.unknownCommands).toEqual([])
  })

  it('reads without asking: printer and MCU observes', () => {
    expect(classifyMakerPayload('printer', 'M105\nM114\nM115\nM503\n').class).toBe('observe')
    expect(classifyMakerLine('printer', '').class).toBe('observe')
  })

  it('refuses irreversible chip operations in composed commands', () => {
    expect(classifyMakerLine('mcu', 'esptool write_efuse RD_DIS 1').class).toBe('refused')
    expect(classifyMakerLine('mcu', 'avrdude -Ulfuse:w:0x62:m').class).toBe('refused')
    expect(classifyMakerLine('printer', 'M117 hello').class).toBe('actuate')
  })
})
