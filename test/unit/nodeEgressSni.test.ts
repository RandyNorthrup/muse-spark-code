// M110b W1: the SNI check reads the ClientHello's server name, passes
// plain bytes through, and drops TLS-looking garbage — never passing
// blind. Over two real hellos, captured 2026-10-22:
// `openssl s_client -connect example.com:443 -msg` (with SNI) and
// `openssl s_client -connect 1.1.1.1:443 -noservername -msg`
// (without); mutations below only corrupt and truncate the real bytes.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseClientHelloSni } from '../../src/runtime/node/egress/sni'

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'egress')
const HELLO = new Uint8Array(readFileSync(path.join(FIXTURES, 'clienthello-example.bin')))
const NO_SNI = new Uint8Array(readFileSync(path.join(FIXTURES, 'clienthello-nosni.bin')))

describe('sni check', () => {
  it('reads the server name out of the recorded hello', () => {
    expect(parseClientHelloSni(HELLO)).toEqual({ kind: 'sni', serverName: 'example.com' })
  })
  it('a hello without the extension passes through as no-sni', () => {
    expect(parseClientHelloSni(NO_SNI)).toEqual({ kind: 'no-sni' })
  })
  it('plain bytes are not TLS and pass through', () => {
    const http = new TextEncoder().encode('GET https://example.com/ HTTP/1.1\r\nHost: x\r\n\r\n')
    expect(parseClientHelloSni(http)).toEqual({ kind: 'not-tls' })
    expect(parseClientHelloSni(new Uint8Array([0x15, 0x03, 0x01, 0x00, 0x02, 0x01, 0x00]))).toEqual(
      {
        kind: 'not-tls',
      },
    )
  })
  it('short input says how much it needs, up to one record', () => {
    expect(parseClientHelloSni(new Uint8Array(0))).toEqual({ kind: 'truncated', need: 5 })
    expect(parseClientHelloSni(HELLO.subarray(0, 1))).toEqual({ kind: 'truncated', need: 5 })
    expect(parseClientHelloSni(HELLO.subarray(0, 100))).toEqual({
      kind: 'truncated',
      need: HELLO.length,
    })
    expect(parseClientHelloSni(NO_SNI.subarray(0, 100))).toEqual({
      kind: 'truncated',
      need: NO_SNI.length,
    })
  })
  it('TLS-looking garbage is malformed, never passed blind', () => {
    const badVersion = Uint8Array.from(HELLO)
    badVersion[1] = 0x04
    expect(parseClientHelloSni(badVersion)).toEqual({ kind: 'not-tls' })
    const badHandshake = Uint8Array.from(HELLO)
    badHandshake[5] = 0x02
    expect(parseClientHelloSni(badHandshake)).toEqual({ kind: 'malformed' })
    const huge = Uint8Array.from([
      0x16,
      0x03,
      0x01,
      0x40,
      0x01,
      ...Array.from({ length: 64 }, () => 0),
    ])
    expect(parseClientHelloSni(huge)).toEqual({ kind: 'malformed' })
    const nameAt = Buffer.from(HELLO).indexOf('example.com')
    expect(nameAt).toBeGreaterThan(0)
    const flipped = Uint8Array.from(HELLO)
    flipped[nameAt] = (flipped[nameAt] ?? 0) ^ 0x80
    expect(parseClientHelloSni(flipped)).toEqual({ kind: 'malformed' })
  })
})
