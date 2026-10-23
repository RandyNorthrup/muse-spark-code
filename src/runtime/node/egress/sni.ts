// D90.5's TLS SNI check (M110b W1): read the ClientHello's server name
// so the proxy requires it to match the CONNECT host — a client that
// connects for one name and greets as another is dropped. Total: never
// throws. Short input says how much it needs (the server waits, bounded
// by the record's own length, at most one TLS record); non-TLS passes
// through (plain HTTP); no SNI passes through (the tunnel already
// reaches the authorized address, and TLS itself checks the name);
// TLS-looking garbage is malformed (dropped, never passed blind). The
// name must be ASCII letters, digits, dots and hyphens (RFC 6066 sends
// DNS hostnames; literals are forbidden) within DNS length.
const RECORD_HEADER_LEN = 5
const RECORD_TYPE_HANDSHAKE = 0x16
const VERSION_MAJOR_TLS = 0x03
const HANDSHAKE_CLIENT_HELLO = 0x01
const EXT_SERVER_NAME = 0x00
const NAME_HOST = 0x00
const TLS_MAX_RECORD_BYTES = 16_384
const DNS_MAX_NAME_BYTES = 253
const RECORD_LEN_OFFSET = 3
const HELLO_LEN_OFFSET = 6
const HANDSHAKE_HEADER_LEN = 4
const CLIENT_VERSION_LEN = 2
const CLIENT_RANDOM_LEN = 32
const EXT_HEADER_LEN = 4
const SERVER_NAME_LIST_OFFSET = 6
const SERVER_NAME_ENTRY_HEADER = 3
const SERVER_NAME_LIST_LEN = 2
const BYTE_BITS = 8
const TWO_BYTE_BITS = 16
const CHAR_DIGIT_0 = 0x30
const CHAR_DIGIT_9 = 0x39
const CHAR_UPPER_A = 0x41
const CHAR_UPPER_Z = 0x5a
const CHAR_LOWER_A = 0x61
const CHAR_LOWER_Z = 0x7a
const CHAR_HYPHEN = 0x2d
const CHAR_DOT = 0x2e

export type SniOutcome =
  | { readonly kind: 'not-tls' }
  | { readonly kind: 'no-sni' }
  | { readonly kind: 'sni'; readonly serverName: string }
  | { readonly kind: 'truncated'; readonly need: number }
  | { readonly kind: 'malformed' }

function u16(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << BYTE_BITS) | (bytes[at + 1] ?? 0)
}

function u24(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] ?? 0) << TWO_BYTE_BITS) | ((bytes[at + 1] ?? 0) << BYTE_BITS) | (bytes[at + 2] ?? 0)
  )
}

function isHostnameByte(byte: number): boolean {
  return (
    (byte >= CHAR_DIGIT_0 && byte <= CHAR_DIGIT_9) ||
    (byte >= CHAR_UPPER_A && byte <= CHAR_UPPER_Z) ||
    (byte >= CHAR_LOWER_A && byte <= CHAR_LOWER_Z) ||
    byte === CHAR_HYPHEN ||
    byte === CHAR_DOT
  )
}

export function parseClientHelloSni(bytes: Uint8Array): SniOutcome {
  if (bytes.length === 0) return { kind: 'truncated', need: RECORD_HEADER_LEN }
  if (bytes[0] !== RECORD_TYPE_HANDSHAKE) return { kind: 'not-tls' }
  if (bytes.length < 2) return { kind: 'truncated', need: RECORD_HEADER_LEN }
  if (bytes[1] !== VERSION_MAJOR_TLS) return { kind: 'not-tls' }
  if (bytes.length < RECORD_HEADER_LEN) return { kind: 'truncated', need: RECORD_HEADER_LEN }
  const recordLen = u16(bytes, RECORD_LEN_OFFSET)
  if (recordLen > TLS_MAX_RECORD_BYTES) return { kind: 'malformed' }
  const need = RECORD_HEADER_LEN + recordLen
  if (bytes.length < need) return { kind: 'truncated', need }
  if (bytes[RECORD_HEADER_LEN] !== HANDSHAKE_CLIENT_HELLO) return { kind: 'malformed' }
  const helloLen = u24(bytes, HELLO_LEN_OFFSET)
  if (RECORD_HEADER_LEN + HANDSHAKE_HEADER_LEN + helloLen > need) return { kind: 'malformed' }
  let at = RECORD_HEADER_LEN + HANDSHAKE_HEADER_LEN
  const end = at + helloLen
  if (at + CLIENT_VERSION_LEN + CLIENT_RANDOM_LEN > end) return { kind: 'malformed' }
  at += CLIENT_VERSION_LEN + CLIENT_RANDOM_LEN
  const takeVector = (lenBytes: 1 | 2): { from: number; length: number } | undefined => {
    if (at + lenBytes > end) return undefined
    const length = lenBytes === 1 ? (bytes[at] ?? 0) : u16(bytes, at)
    at += lenBytes
    if (at + length > end) return undefined
    const from = at
    at += length
    return { from, length }
  }
  if (takeVector(1) === undefined) return { kind: 'malformed' }
  if (takeVector(2) === undefined) return { kind: 'malformed' }
  if (takeVector(1) === undefined) return { kind: 'malformed' }
  const extensions = takeVector(2)
  if (extensions === undefined) return { kind: 'no-sni' }
  let ext = extensions.from
  const extEnd = ext + extensions.length
  const decoder = new TextDecoder()
  while (ext + EXT_HEADER_LEN <= extEnd) {
    const type = u16(bytes, ext)
    const length = u16(bytes, ext + 2)
    if (ext + EXT_HEADER_LEN + length > extEnd) return { kind: 'malformed' }
    if (type === EXT_SERVER_NAME) return serverName(bytes, ext, length, decoder)
    ext += EXT_HEADER_LEN + length
  }
  return { kind: ext === extEnd ? 'no-sni' : 'malformed' }
}

function serverName(
  bytes: Uint8Array,
  ext: number,
  length: number,
  decoder: TextDecoder,
): SniOutcome {
  if (length < SERVER_NAME_LIST_LEN) return { kind: 'malformed' }
  const listLen = u16(bytes, ext + EXT_HEADER_LEN)
  if (listLen + SERVER_NAME_LIST_LEN > length) return { kind: 'malformed' }
  let name = ext + SERVER_NAME_LIST_OFFSET
  const nameEnd = name + listLen
  while (name + SERVER_NAME_ENTRY_HEADER <= nameEnd) {
    const nameType = bytes[name] ?? 1
    const nameLen = u16(bytes, name + 1)
    if (name + SERVER_NAME_ENTRY_HEADER + nameLen > nameEnd) return { kind: 'malformed' }
    if (nameType === NAME_HOST) {
      const raw = bytes.subarray(
        name + SERVER_NAME_ENTRY_HEADER,
        name + SERVER_NAME_ENTRY_HEADER + nameLen,
      )
      if (raw.length === 0 || raw.length > DNS_MAX_NAME_BYTES) return { kind: 'malformed' }
      return raw.every((byte) => isHostnameByte(byte))
        ? { kind: 'sni', serverName: decoder.decode(raw) }
        : { kind: 'malformed' }
    }
    name += SERVER_NAME_ENTRY_HEADER + nameLen
  }
  return { kind: 'malformed' }
}
