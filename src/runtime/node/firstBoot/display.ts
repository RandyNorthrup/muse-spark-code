// M110os OS3: the console screen and its QR. The machine shows its
// address, name, certificate fingerprint and the one-time setup code, with
// the code also as a QR. Text comes from the installed table at call time.
import { hostname, networkInterfaces } from 'node:os'
import qrcode from 'qrcode-generator'
import { UI_TEXT } from '../../../shared/l10n/text'

export interface ConsoleFacts {
  readonly address: string
  readonly name: string
  readonly fingerprint: string
  readonly code: string
}

/** The first outward IPv4 address, or undefined with no network yet. */
export function primaryLanAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    if (addresses === undefined) continue
    for (const address of addresses) {
      if (address.family === 'IPv4' && !address.internal) return address.address
    }
  }
  return undefined
}

/** What the console shows as its address: the LAN address or the .local name. */
export function displayAddress(): string {
  return primaryLanAddress() ?? `${hostname()}.local`
}

/** The QR payload: the setup address and code as ASCII JSON. */
export function setupQrPayload(address: string, code: string): string {
  return JSON.stringify({ v: 1, url: `http://${address}/`, code })
}

/** The encoder throws its overflow as a bare string, not an Error. */
function qrMessage(cause: unknown): string | undefined {
  if (typeof cause === 'string') return cause
  return cause instanceof Error ? cause.message : undefined
}

function isOverflow(cause: unknown): boolean {
  return qrMessage(cause)?.includes('code length overflow') ?? false
}

/**
The payload as block-character QR rows with a quiet zone, or undefined
when the payload does not fit any version. Anything else the encoder
throws is unexpected and propagates.
*/
export function qrBlocks(payload: string): string[] | undefined {
  try {
    return renderQr(payload)
  } catch (error: unknown) {
    if (isOverflow(error)) return undefined
    throw error
  }
}

function renderQr(payload: string): string[] {
  const code = qrcode(0, 'M')
  code.addData(payload)
  code.make()
  const size = code.getModuleCount()
  const rows: string[] = []
  const edge = `  ${'  '.repeat(size)}  `
  rows.push(edge)
  for (let row = 0; row < size; row += 1) {
    let line = '  '
    for (let column = 0; column < size; column += 1) line += code.isDark(row, column) ? '██' : '  '
    rows.push(`${line}  `)
  }
  rows.push(edge)
  return rows
}

/** The console screen: address, name, fingerprint, code, and its QR. */
export function consoleDisplay(facts: ConsoleFacts): string {
  const text = UI_TEXT.nodeOs
  const lines = [
    text.setupTitle,
    `${text.consoleAddress}: ${facts.address}`,
    `${text.consoleName}: ${facts.name}`,
    `${text.consoleFingerprint}: ${facts.fingerprint}`,
    `${text.consoleCode}: ${facts.code}`,
  ]
  const qr = qrBlocks(setupQrPayload(facts.address, facts.code))
  if (qr !== undefined) lines.push('', ...qr)
  return lines.join('\n')
}
