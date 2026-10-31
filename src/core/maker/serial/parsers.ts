import * as z from 'zod/mini'
import { serialIdentitySchema, type SerialIdentity } from './identity'

function json(text: string, maxBytes: number): unknown {
  if (Buffer.byteLength(text) > maxBytes) throw new Error('serial-list-oversize')
  return JSON.parse(text)
}

function hex(value: string | undefined): string | undefined {
  return value?.replace(/^0x/i, '').toLowerCase()
}

const cimRow = z.object({
  Name: z.string(),
  PNPDeviceID: z.string(),
  PortName: z.optional(z.nullable(z.string())),
})

/** CIM metadata plus the device registry's PortName; no serial-device reads. */
export function parseCimPorts(text: string, maxBytes: number): SerialIdentity[] {
  const raw = json(text, maxBytes)
  const entries = Array.isArray(raw) ? raw : [raw]
  const rows = z.array(cimRow).parse(raw === null ? [] : entries)
  return rows.flatMap((row) => {
    if (/^BTHENUM\\/i.test(row.PNPDeviceID)) return []
    const port = row.PortName ?? /\((COM\d+)\)\s*$/i.exec(row.Name)?.[1]
    if (port === undefined) return []
    if (!/^COM\d+$/i.test(port)) return []
    const usb = /VID_([\da-f]{4})&PID_([\da-f]{4})/i.exec(row.PNPDeviceID)
    const instance = row.PNPDeviceID.split('\\').at(-1)
    // Windows synthesises location IDs with '&'; those are not USB serials.
    return [
      serialIdentitySchema.parse({
        port: port.toUpperCase(),
        description: row.Name,
        ...(usb !== null && { vid: usb[1], pid: usb[2] }),
        ...(usb !== null &&
          instance !== undefined &&
          !instance.includes('&') && { serialNumber: instance }),
      }),
    ]
  })
}

const pioRow = z.object({ port: z.string(), description: z.string(), hwid: z.string() })

export function parsePlatformIoPorts(text: string, maxBytes: number): SerialIdentity[] {
  return z
    .array(pioRow)
    .parse(json(text, maxBytes))
    .map((row) => {
      const usb = /VID:PID=([\da-f]{4}):([\da-f]{4})/i.exec(row.hwid)
      const serialNumber = /(?:SER|SNR)=([^\s]+)/i.exec(row.hwid)?.[1]
      return serialIdentitySchema.parse({
        port: row.port,
        description: row.description,
        ...(usb !== null && { vid: usb[1], pid: usb[2] }),
        ...(serialNumber !== undefined && { serialNumber }),
      })
    })
}

const arduinoPort = z.object({
  port: z.object({
    address: z.string(),
    protocol: z.string(),
    label: z.optional(z.string()),
    properties: z.optional(
      z.object({
        vid: z.optional(z.string()),
        pid: z.optional(z.string()),
        serialNumber: z.optional(z.string()),
      }),
    ),
  }),
})

export function parseArduinoPorts(text: string, maxBytes: number): SerialIdentity[] {
  const rows = z
    .object({ detected_ports: z.optional(z.array(arduinoPort)) })
    .parse(json(text, maxBytes))
  return (rows.detected_ports ?? [])
    .filter((row) => row.port.protocol === 'serial')
    .map(({ port }) =>
      serialIdentitySchema.parse({
        port: port.address,
        vid: hex(port.properties?.vid),
        pid: hex(port.properties?.pid),
        serialNumber: port.properties?.serialNumber,
        description: port.label,
      }),
    )
}

/** A metadata snapshot, collected without ever reading a /dev node. */
export interface LinuxTtyMetadata {
  readonly name: string
  readonly ancestors: readonly Readonly<Record<string, string>>[]
}

export function parseLinuxPorts(
  rows: readonly LinuxTtyMetadata[],
  byId: readonly { readonly path: string; readonly target: string }[],
): SerialIdentity[] {
  return rows
    .filter((row) => /^(?:ttyUSB|ttyACM)\d+$/.test(row.name))
    .map((row) => {
      // VID, PID and serial must come from the same USB device ancestor.
      const usb = row.ancestors.find((entry) => entry['idVendor'] && entry['idProduct'])
      const port = `/dev/${row.name}`
      return serialIdentitySchema.parse({
        port,
        vid: usb?.['idVendor']?.trim(),
        pid: usb?.['idProduct']?.trim(),
        serialNumber: usb?.['serial']?.trim(),
        description: usb?.['product']?.trim(),
        stablePath: byId.find((link) => link.target === port)?.path,
      })
    })
}

/** ioreg -l -w 0: inherit USB metadata only down its own registry subtree. */
export function parseIoregPorts(text: string, maxBytes: number): SerialIdentity[] {
  if (Buffer.byteLength(text) > maxBytes) throw new Error('serial-list-oversize')
  const stack: { depth: number; fields: Map<string, string> }[] = []
  const ports: SerialIdentity[] = []
  for (const line of text.split(/\r?\n/)) {
    const node = /^(.*?)\+-o /.exec(line)
    if (node !== null) {
      const depth = node[1]?.length ?? 0
      while (stack.length > 0 && (stack.at(-1)?.depth ?? 0) >= depth) stack.pop()
      stack.push({ depth, fields: new Map(stack.at(-1)?.fields) })
      continue
    }
    const property =
      /"(idVendor|idProduct|USB Serial Number|IOCalloutDevice)"\s*=\s*(?:"([^"]*)"|(\d+))/.exec(
        line,
      )
    const fields = stack.at(-1)?.fields
    if (property === null || fields === undefined) continue
    const key = property[1] ?? ''
    fields.set(key, property[2] ?? property[3] ?? '')
    if (key !== 'IOCalloutDevice') continue
    const port = fields.get(key)
    if (!port?.startsWith('/dev/cu.')) continue
    const toHex = (name: string) => {
      const value = fields.get(name)
      return value === undefined
        ? undefined
        : Number(value).toString(HEX_RADIX).padStart(USB_ID_WIDTH, '0')
    }
    ports.push(
      serialIdentitySchema.parse({
        port,
        vid: toHex('idVendor'),
        pid: toHex('idProduct'),
        serialNumber: fields.get('USB Serial Number'),
      }),
    )
  }
  return ports
}

// Protocol widths, not tunables. The interface lane owns maker tunables.
const HEX_RADIX = '0123456789abcdef'.length
const USB_ID_WIDTH = '0000'.length
