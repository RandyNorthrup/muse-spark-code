import { open, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { type SerialIdentity } from './identity'
import {
  parseArduinoPorts,
  parseCimPorts,
  parseIoregPorts,
  parseLinuxPorts,
  parsePlatformIoPorts,
  type LinuxTtyMetadata,
} from './parsers'

export interface PortListDependencies {
  readonly platform: NodeJS.Platform
  readonly maxBytes: number
  readonly maxPorts: number
  readonly maxAncestors: number
  /** Already-discovered user tool. Listing does not probe by opening ports. */
  readonly tool?: { readonly kind: 'pio' | 'arduino-cli'; readonly executable: string }
  /** The host's bounded process runner; no shell interpolation. */
  readonly run: (file: string, args: readonly string[]) => Promise<string>
  readonly powershell?: string
  readonly linuxSnapshot?: () => Promise<{
    readonly rows: readonly LinuxTtyMetadata[]
    readonly byId: readonly { readonly path: string; readonly target: string }[]
  }>
}

/** Discovery has no serial provider or open primitive by construction. */
export async function listSerialPorts(deps: PortListDependencies): Promise<SerialIdentity[]> {
  let ports: SerialIdentity[]
  if (deps.tool?.kind === 'pio') {
    ports = parsePlatformIoPorts(
      await deps.run(deps.tool.executable, ['device', 'list', '--json-output']),
      deps.maxBytes,
    )
  } else if (deps.tool?.kind === 'arduino-cli') {
    ports = parseArduinoPorts(
      await deps.run(deps.tool.executable, ['board', 'list', '--json']),
      deps.maxBytes,
    )
  } else
    switch (deps.platform) {
      case 'win32': {
        if (deps.powershell === undefined) throw new Error('serial-powershell-unavailable')
        ports = parseCimPorts(
          await deps.run(deps.powershell, [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            String.raw`ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_PnPEntity -Filter "PNPClass='Ports'" | ForEach-Object { $portName = (Get-ItemProperty -LiteralPath ('Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Enum\' + $_.PNPDeviceID + '\Device Parameters') -Name PortName -ErrorAction SilentlyContinue).PortName; [pscustomobject]@{ Name = $_.Name; PNPDeviceID = $_.PNPDeviceID; PortName = $portName } })`,
          ]),
          deps.maxBytes,
        )

        break
      }
      case 'darwin': {
        // The full registry dump is megabytes on a real Mac and outgrows the
        // runner's buffer; the USB plane carries every USB serial device
        // with the ancestors its VID/PID and serial number inherit from,
        // and the serial-client class names every callout device (Bluetooth
        // included). USB rows win where both name a port.
        const usb = parseIoregPorts(
          await deps.run('/usr/sbin/ioreg', ['-p', 'IOUSB', '-l', '-w', '0']),
          deps.maxBytes,
        )
        const callouts = parseIoregPorts(
          await deps.run('/usr/sbin/ioreg', ['-r', '-c', 'IOSerialBSDClient', '-l', '-w', '0']),
          deps.maxBytes,
        )
        const byPort = new Map(callouts.map((port) => [port.port, port]))
        for (const port of usb) byPort.set(port.port, port)
        ports = []
        for (const port of byPort.values()) ports.push(port)

        break
      }
      case 'linux': {
        const snapshot = await (deps.linuxSnapshot?.() ?? linuxSerialSnapshot(deps))
        ports = parseLinuxPorts(snapshot.rows, snapshot.byId)

        break
      }
      default: {
        throw new Error('serial-platform-unavailable')
      }
    }
  if (ports.length > deps.maxPorts) throw new Error('serial-list-too-many')
  return ports
}

function isAbsent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Only sysfs metadata is opened here, never a serial device. */
async function attribute(file: string, maxBytes: number): Promise<string | undefined> {
  try {
    const handle = await open(file, 'r')
    try {
      const buffer = Buffer.alloc(maxBytes + 1)
      const { bytesRead } = await handle.read(buffer)
      if (bytesRead > maxBytes) throw new Error('serial-metadata-oversize')
      return buffer.subarray(0, bytesRead).toString('utf8').trim()
    } finally {
      await handle.close()
    }
  } catch (error: unknown) {
    if (isAbsent(error)) return undefined
    throw error
  }
}

export async function linuxSerialSnapshot(
  limits: Pick<PortListDependencies, 'maxBytes' | 'maxPorts' | 'maxAncestors'>,
): Promise<{
  readonly rows: LinuxTtyMetadata[]
  readonly byId: { path: string; target: string }[]
}> {
  const entries = await readdir('/sys/class/tty')
  const names = entries.filter((name) => /^(?:ttyUSB|ttyACM)\d+$/.test(name))
  if (names.length > limits.maxPorts) throw new Error('serial-list-too-many')
  const rows: LinuxTtyMetadata[] = []
  for (const name of names) {
    const ancestors: Record<string, string>[] = []
    let directory = await realpath(`/sys/class/tty/${name}/device`)
    for (
      let depth = 0;
      depth < limits.maxAncestors && directory.startsWith('/sys/devices/');
      depth += 1
    ) {
      const fields: Record<string, string> = {}
      for (const key of ['idVendor', 'idProduct', 'serial', 'product']) {
        const value = await attribute(path.join(directory, key), limits.maxBytes)
        if (value !== undefined) fields[key] = value
      }
      ancestors.push(fields)
      directory = path.dirname(directory)
    }
    rows.push({ name, ancestors })
  }
  const byId: { path: string; target: string }[] = []
  try {
    const links = await readdir('/dev/serial/by-id')
    if (links.length > limits.maxPorts) throw new Error('serial-list-too-many')
    for (const name of links) {
      const file = path.join('/dev/serial/by-id', name)
      try {
        byId.push({ path: file, target: await realpath(file) })
      } catch (error: unknown) {
        if (!isAbsent(error)) throw error
      }
    }
  } catch (error: unknown) {
    if (!isAbsent(error)) throw error
  }
  return { rows, byId }
}
