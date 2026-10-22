import { execFile } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { checkFlashIdentity } from '../../src/core/maker/flashIdentity'
import { identifyBoard, isSameSerialIdentity } from '../../src/core/maker/serial/identity'
import { listSerialPorts } from '../../src/core/maker/serial/listPorts'
import {
  parseArduinoPorts,
  parseCimPorts,
  parseIoregPorts,
  parseLinuxPorts,
  parsePlatformIoPorts,
} from '../../src/core/maker/serial/parsers'

const LIMITS = { maxBytes: 16_384, maxPorts: 100, maxAncestors: 20 }

function runMetadataCommand(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { timeout: 20_000, windowsHide: true }, (error, stdout) => {
      if (error === null) resolve(stdout)
      else reject(new Error('test-metadata-command-failed', { cause: error }))
    })
  })
}

function runEmptyCim(_file: string, args: readonly string[]): Promise<string> {
  const command = args
    .at(-1)!
    .replace('Get-CimInstance Win32_PnPEntity -Filter "PNPClass=\'Ports\'"', '@()')
  return runMetadataCommand('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    command,
  ])
}

function recordingRun() {
  const calls: [string, readonly string[]][] = []
  const run = (file: string, args: readonly string[]) => {
    calls.push([file, args])
    return runMetadataCommand(file, args)
  }
  return { calls, run }
}

describe('serial metadata parsers', () => {
  it('uses the actual Windows port property and only a final COM suffix as fallback', () => {
    const rows = parseCimPorts(
      JSON.stringify([
        { Name: 'Bench ESP32 (COM7) (COM8)', PNPDeviceID: String.raw`USB\VID_303A&PID_1001\ESP8` },
        {
          Name: 'Bench ESP32 (COM7) (COM8)',
          PNPDeviceID: String.raw`USB\VID_303A&PID_1001\ESP9`,
          PortName: 'com9',
        },
        { Name: 'Unrelated (COM7) description', PNPDeviceID: String.raw`ACPI\PNP0501` },
        { Name: 'Misleading (COM7)', PNPDeviceID: String.raw`ACPI\PNP0501`, PortName: 'invalid' },
      ]),
      LIMITS.maxBytes,
    )
    expect(rows.map(({ port, serialNumber }) => ({ port, serialNumber }))).toEqual([
      { port: 'COM8', serialNumber: 'ESP8' },
      { port: 'COM9', serialNumber: 'ESP9' },
    ])
  })

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

  it('collects real rig platform metadata without device reads', async () => {
    const ports = await listSerialPorts({
      ...LIMITS,
      maxBytes: 1024 * 1024,
      platform: process.platform,
      powershell: 'powershell.exe',
      run: runMetadataCommand,
    })
    expect(
      ports.every((port) => {
        switch (process.platform) {
          case 'win32': {
            return /^COM\d+$/i.test(port.port)
          }
          case 'darwin': {
            return port.port.startsWith('/dev/cu.')
          }
          default: {
            return /^\/dev\/(?:ttyUSB|ttyACM)\d+$/.test(port.port)
          }
        }
      }),
    ).toBe(true)
  })

  if (process.platform === 'win32')
    it('emits a JSON array for an empty real PowerShell enumeration', async () => {
      expect(
        await listSerialPorts({
          ...LIMITS,
          platform: 'win32',
          powershell: 'powershell.exe',
          run: runEmptyCim,
        }),
      ).toEqual([])
    })

  if (process.platform === 'win32')
    it('projects the registry PortName through the real PowerShell enumeration command', async () => {
      const ports = await listSerialPorts({
        ...LIMITS,
        platform: 'win32',
        powershell: 'powershell.exe',
        run: (file, args) =>
          runMetadataCommand(file, [
            ...args.slice(0, -1),
            String.raw`function Get-CimInstance { [pscustomobject]@{ Name = 'Bench ESP32 (COM7) (COM8)'; PNPDeviceID = 'USB\VID_303A&PID_1001\ESP9' } }; function Get-ItemProperty { param($LiteralPath, $Name, $ErrorAction); if ($LiteralPath -ne 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Enum\USB\VID_303A&PID_1001\ESP9\Device Parameters' -or $Name -ne 'PortName') { throw 'test-registry-target' }; [pscustomobject]@{ PortName = 'COM9' } }; ` +
              (args.at(-1) ?? ''),
          ]),
      })
      expect(ports).toEqual([
        {
          port: 'COM9',
          description: 'Bench ESP32 (COM7) (COM8)',
          vid: '303a',
          pid: '1001',
          serialNumber: 'ESP9',
        },
      ])
    })

  it('refuses unavailable discovery without opening a device', async () => {
    // The recording wrapper observes the real runner; the refusals below
    // throw before any command runs, so the record stays empty.
    const { calls, run } = recordingRun()
    await expect(listSerialPorts({ ...LIMITS, platform: 'win32', run })).rejects.toThrow(
      'serial-powershell-unavailable',
    )
    await expect(listSerialPorts({ ...LIMITS, platform: 'freebsd', run })).rejects.toThrow(
      'serial-platform-unavailable',
    )
    expect(calls).toEqual([])
  })

  it.runIf(process.platform === 'darwin')(
    'asks ioreg only for the USB plane and the serial-client class',
    async () => {
      const { calls, run } = recordingRun()
      await listSerialPorts({ ...LIMITS, maxBytes: 1024 * 1024, platform: 'darwin', run })
      expect(calls).toEqual([
        ['/usr/sbin/ioreg', ['-p', 'IOUSB', '-l', '-w', '0']],
        ['/usr/sbin/ioreg', ['-r', '-c', 'IOSerialBSDClient', '-l', '-w', '0']],
      ])
    },
  )
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

  it('refuses ESP32 flashing on a Pico firmware ID without guessing the Pico chip generation', () => {
    for (const pid of ['0005', '000a']) {
      expect(
        checkFlashIdentity({ port: 'COM7', vid: '2e8a', pid }, { idfTarget: 'esp32' }).status,
      ).toBe('mismatch')
      expect(
        checkFlashIdentity({ port: 'COM7', vid: '2e8a', pid }, { family: 'rp2350' }).status,
      ).toBe('unknown')
    }
  })
})
