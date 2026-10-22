import * as z from 'zod/mini'

const usbId = z.pipe(
  z.string().check(z.regex(/^[\da-f]{4}$/i)),
  z.transform((value) => value.toLowerCase()),
)

/** Discovery is metadata only; an identity never proves that opening is safe. */
export const serialIdentitySchema = z.object({
  port: z.string().check(z.minLength(1)),
  vid: z.optional(usbId),
  pid: z.optional(usbId),
  serialNumber: z.optional(z.string().check(z.minLength(1))),
  description: z.optional(z.string()),
  stablePath: z.optional(z.string()),
})

export type SerialIdentity = z.infer<typeof serialIdentitySchema>
export type BoardFamily = 'esp32' | 'rp2040' | 'rp2350' | 'rp2' | 'avr'

// USB ID facts from makers-2026-10-05.md §2.2. UART bridges do not identify
// the attached microcontroller: never infer an ESP32 merely from a CP210x.
const USB_PRODUCTS = new Map([
  ['10c4:ea60', 'CP210x'],
  ['1a86:7523', 'CH340'],
  ['0403:6001', 'FT232'],
  ['0403:6010', 'FT2232'],
  ['0403:6014', 'FT232H'],
  ['0403:6015', 'FT-X'],
  ['2341:0043', 'Arduino Uno R3'],
  ['2341:8036', 'Arduino Leonardo'],
  ['303a:1001', 'Espressif USB Serial/JTAG'],
  ['2e8a:0003', 'RP2040 bootloader'],
  ['2e8a:0005', 'Raspberry Pi MicroPython'],
  ['2e8a:000a', 'Raspberry Pi Pico CDC'],
  ['2e8a:000c', 'Raspberry Pi Debug Probe'],
  ['2e8a:000f', 'RP2350 bootloader'],
])

export function identifyBoard(identity: SerialIdentity): {
  readonly name: string | undefined
  readonly family: BoardFamily | undefined
} {
  const key = `${identity.vid ?? ''}:${identity.pid ?? ''}`.toLowerCase()
  let family: BoardFamily | undefined
  switch (key) {
    case '303a:1001': {
      family = 'esp32'
      break
    }
    case '2e8a:0003': {
      family = 'rp2040'
      break
    }
    case '2e8a:000f': {
      family = 'rp2350'
      break
    }
    case '2e8a:0005':
    case '2e8a:000a': {
      family = 'rp2'
      break
    }
    case '2341:0043':
    case '2341:8036': {
      family = 'avr'
      break
    }
  }
  return { name: USB_PRODUCTS.get(key), family }
}

/** Stable links are aliases; approval binds the physical port and USB fields. */
export function isSameSerialIdentity(left: SerialIdentity, right: SerialIdentity): boolean {
  return (
    left.port === right.port &&
    left.vid === right.vid &&
    left.pid === right.pid &&
    left.serialNumber === right.serialNumber
  )
}
