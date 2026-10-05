import { describe, expect, it, vi } from 'vitest'
import { checkFlashIdentity } from '../../src/core/maker/flashIdentity'
import { identifyBoard, isSameSerialIdentity } from '../../src/core/maker/serial/identity'
import { listSerialPorts, linuxSerialSnapshot } from '../../src/core/maker/serial/listPorts'
import {
  parseArduinoPorts,
  parseCimPorts,
  parseIoregPorts,
  parseLinuxPorts,
  parsePlatformIoPorts,
} from '../../src/core/maker/serial/parsers'

const LIMITS = { maxBytes: 16_384, maxPorts: 100, maxAncestors: 20 }

describe('serial metadata parsers', () => {
  it('parses USB CIM rows and excludes Bluetooth and manufactured location serials', () => {
    const rows = parseCimPorts(
      JSON.stringify([
        { Name: 'USB Serial (COM7)', PNPDeviceID: String.raw`USB\VID_10C4&PID_EA60\0001` },
        { Name: 'Bluetooth (COM8)', PNPDeviceID: String.raw`BTHENUM\VID_10C4&PID_EA60\address` },
        { Name: 'Uno (COM9)', PNPDeviceID: String.raw`USB\VID_2341&PID_0043\5&123&0&2` },
      ]),
      LIMITS.maxBytes,
    )
    expect(rows).toEqual([
      {
        port: 'COM7',
        description: 'USB Serial (COM7)',
        vid: '10c4',
        pid: 'ea60',
        serialNumber: '0001',
      },
      { port: 'COM9', description: 'Uno (COM9)', vid: '2341', pid: '0043' },
    ])
    expect(parseCimPorts('null', LIMITS.maxBytes)).toEqual([])
    expect(
      parseCimPorts(
        JSON.stringify({ Name: 'Port (COM1)', PNPDeviceID: String.raw`ACPI\PNP0501` }),
        LIMITS.maxBytes,
      )[0]?.port,
    ).toBe('COM1')
  })

  it('parses user tool JSON and rejects malformed/oversize results', () => {
    expect(
      parsePlatformIoPorts(
        '[{"port":"/dev/ttyUSB0","description":"Bridge","hwid":"USB VID:PID=10C4:EA60 SNR=0001"}]',
        LIMITS.maxBytes,
      )[0],
    ).toMatchObject({ vid: '10c4', pid: 'ea60', serialNumber: '0001' })
    const rows = parseArduinoPorts(
      JSON.stringify({
        detected_ports: [
          {
            port: {
              address: '/dev/ttyACM0',
              protocol: 'serial',
              properties: { vid: '0x303A', pid: '0x1001', serialNumber: 'ESP' },
            },
          },
          { port: { address: 'host.local', protocol: 'network' } },
        ],
      }),
      LIMITS.maxBytes,
    )
    expect(rows).toEqual([{ port: '/dev/ttyACM0', vid: '303a', pid: '1001', serialNumber: 'ESP' }])
    expect(parseArduinoPorts('{}', LIMITS.maxBytes)).toEqual([])
    expect(() => parsePlatformIoPorts('[{"port":2}]', LIMITS.maxBytes)).toThrow()
    expect(() => parseCimPorts('[]', 1)).toThrow('serial-list-oversize')
    expect(() => parseArduinoPorts('{', LIMITS.maxBytes)).toThrow()
  })

  it('pairs Linux aliases with one USB ancestor and excludes console nodes', () => {
    expect(
      parseLinuxPorts(
        [
          {
            name: 'ttyACM0',
            ancestors: [
              { product: 'interface' },
              { idVendor: '2e8a\n', idProduct: '0003\n', serial: 'PICO\n', product: 'Pico' },
            ],
          },
          { name: 'ttyUSB0', ancestors: [] },
          { name: 'tty0', ancestors: [] },
        ],
        [{ path: '/dev/serial/by-id/usb-Pico-PICO', target: '/dev/ttyACM0' }],
      ),
    ).toEqual([
      {
        port: '/dev/ttyACM0',
        vid: '2e8a',
        pid: '0003',
        serialNumber: 'PICO',
        description: 'Pico',
        stablePath: '/dev/serial/by-id/usb-Pico-PICO',
      },
      { port: '/dev/ttyUSB0' },
    ])
  })

  it('inherits ioreg USB fields without leaking identity into a sibling device', () => {
    const text = `+-o Root
  +-o Pico
    "idVendor" = 11914
    "idProduct" = 3
    "USB Serial Number" = "PICO"
    +-o serial
      "IOCalloutDevice" = "/dev/cu.usbmodem1"
  +-o Unknown
    +-o serial
      "IOCalloutDevice" = "/dev/cu.usbmodem2"`
    expect(parseIoregPorts(text, LIMITS.maxBytes)).toEqual([
      { port: '/dev/cu.usbmodem1', vid: '2e8a', pid: '0003', serialNumber: 'PICO' },
      { port: '/dev/cu.usbmodem2' },
    ])
    expect(() => parseIoregPorts(text, 1)).toThrow('serial-list-oversize')
  })

  it('lists without any open primitive and runs only a listing command', async () => {
    const run = vi.fn().mockResolvedValue('[]')
    expect(
      await listSerialPorts({
        ...LIMITS,
        platform: 'linux',
        tool: { kind: 'pio', executable: '/user/pio' },
        run,
      }),
    ).toEqual([])
    expect(run).toHaveBeenCalledExactlyOnceWith('/user/pio', ['device', 'list', '--json-output'])
    const linuxSnapshot = vi.fn().mockResolvedValue({ rows: [], byId: [] })
    await listSerialPorts({ ...LIMITS, platform: 'linux', run, linuxSnapshot })
    expect(run).toHaveBeenCalledTimes(1)
    expect(linuxSnapshot).toHaveBeenCalledTimes(1)
  })

  it('collects real rig sysfs metadata without device reads', async () => {
    const snapshot = await linuxSerialSnapshot(LIMITS)
    expect(snapshot.rows.every((row) => /^(?:ttyUSB|ttyACM)\d+$/.test(row.name))).toBe(true)
  })
})

describe('flash target identity', () => {
  it('refuses a known Pico/ESP32 mismatch and reports a match', () => {
    expect(
      checkFlashIdentity(
        { port: '/dev/ttyACM0', vid: '2e8a', pid: '0003' },
        { idfTarget: 'esp32s3' },
      ).status,
    ).toBe('mismatch')
    expect(
      checkFlashIdentity(
        { port: 'COM7', vid: '303a', pid: '1001' },
        { fqbn: 'esp32:esp32:esp32s3' },
      ).status,
    ).toBe('match')
    expect(
      checkFlashIdentity({ port: 'COM7', vid: '2341', pid: '0043' }, { fqbn: 'arduino:avr:uno' })
        .status,
    ).toBe('match')
  })

  it('never turns a UART bridge, Debug Probe or ambiguous target into a board match', () => {
    for (const [vid, pid] of [
      ['10c4', 'ea60'],
      ['0403', '6001'],
      ['2e8a', '000c'],
      ['2e8a', '0005'],
    ]) {
      expect(checkFlashIdentity({ port: 'COM7', vid, pid }, { idfTarget: 'esp32' }).status).toBe(
        'unknown',
      )
      expect(identifyBoard({ port: 'COM7', vid, pid }).name).toBeDefined()
    }
    expect(
      checkFlashIdentity(
        { port: 'COM7', vid: '303a', pid: '1001' },
        { idfTarget: 'esp32', family: 'rp2350' },
      ).status,
    ).toBe('unknown')
    expect(
      isSameSerialIdentity(
        { port: 'COM7', serialNumber: 'one' },
        { port: 'COM7', serialNumber: 'two' },
      ),
    ).toBe(false)
  })
})
