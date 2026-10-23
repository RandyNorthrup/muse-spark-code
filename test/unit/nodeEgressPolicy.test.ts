// M110b W1: the egress policy allowlists names, blocks cloud metadata
// on every host, refuses connections with any non-public answer, and
// rate limits only at the person's rate. Pure, over real addresses.
import { describe, expect, it } from 'vitest'
import {
  checkRate,
  expandIpv6,
  initialRate,
  isMetadataIp,
  isNameAllowed,
  parseConnectTarget,
  selectUsableAnswers,
} from '../../src/runtime/node/egress/policy'

const POLICY = { allow: ['example.com', '*.pypi.org', '93.184.215.14'] }

describe('egress policy', () => {
  it('matches exact names and anything below a wildcard, never the apex', () => {
    expect(isNameAllowed(POLICY, 'example.com')).toBe(true)
    expect(isNameAllowed(POLICY, 'EXAMPLE.com.')).toBe(true)
    expect(isNameAllowed(POLICY, 'files.pypi.org')).toBe(true)
    expect(isNameAllowed(POLICY, 'a.b.pypi.org')).toBe(true)
    expect(isNameAllowed(POLICY, 'pypi.org')).toBe(false)
    expect(isNameAllowed(POLICY, 'notpypi.org')).toBe(false)
    expect(isNameAllowed(POLICY, 'evil.com')).toBe(false)
    expect(isNameAllowed({ allow: [] }, 'example.com')).toBe(false)
  })
  it('CONNECT targets split host and port, and refuse anything else', () => {
    expect(parseConnectTarget('example.com:443')).toEqual({ host: 'example.com', port: 443 })
    expect(parseConnectTarget('[::1]:8080')).toEqual({ host: '::1', port: 8080 })
    expect(parseConnectTarget('[fd00:ec2::254]:443')).toEqual({ host: 'fd00:ec2::254', port: 443 })
    expect(parseConnectTarget('example.com')).toBeUndefined()
    expect(parseConnectTarget('example.com:http')).toBeUndefined()
    expect(parseConnectTarget('example.com:0')).toBeUndefined()
    expect(parseConnectTarget('example.com:65536')).toBeUndefined()
    expect(parseConnectTarget('[::1')).toBeUndefined()
    expect(parseConnectTarget('[::1]')).toBeUndefined()
    expect(parseConnectTarget(':443')).toBeUndefined()
  })
  it('IP literals match exactly only, never by wildcard', () => {
    expect(isNameAllowed(POLICY, '93.184.215.14')).toBe(true)
    expect(isNameAllowed({ allow: ['*.184.215.14'] }, '93.184.215.14')).toBe(false)
    expect(isNameAllowed(POLICY, '93.184.215.15')).toBe(false)
  })
  it('cloud metadata is blocked in every form it takes', () => {
    expect(isMetadataIp('169.254.169.254')).toBe(true)
    expect(isMetadataIp('[fd00:ec2::254]')).toBe(true)
    expect(isMetadataIp('FD00:EC2::254%eth0')).toBe(true)
    expect(isMetadataIp('fd00:0ec2:0000:0000:0000:0000:0000:0254')).toBe(true)
    expect(isMetadataIp('::ffff:169.254.169.254')).toBe(true)
    expect(isMetadataIp('93.184.215.14')).toBe(false)
    expect(isMetadataIp('example.com')).toBe(false)
    expect(expandIpv6('fd00:ec2::254')).toBe('fd00:0ec2:0000:0000:0000:0000:0000:0254')
    expect(expandIpv6('::ffff:1.2.3.4')).toBe('0000:0000:0000:0000:0000:ffff:0102:0304')
    expect(expandIpv6('not-an-ip')).toBeUndefined()
    expect(expandIpv6('1:2:3:4:5:6:7:8:9')).toBeUndefined()
  })
  it('any metadata or non-public answer refuses the connection whole', () => {
    expect(selectUsableAnswers(['93.184.215.14'], { isKnown: true, prefixes: [] })).toEqual({
      ok: true,
      usable: ['93.184.215.14'],
    })
    expect(
      selectUsableAnswers(['93.184.215.14', '169.254.169.254'], { isKnown: true, prefixes: [] }),
    ).toEqual({ ok: false, reason: 'metadata', address: '169.254.169.254' })
    expect(
      selectUsableAnswers(['93.184.215.14', '10.1.2.3'], { isKnown: true, prefixes: [] }),
    ).toEqual({ ok: false, reason: 'private-address', address: '10.1.2.3' })
  })
  it('without a known NAT64 answer only IPv4 answers are used', () => {
    const nat64 = { isKnown: false, prefixes: [] }
    expect(
      selectUsableAnswers(['93.184.215.14', '2606:2800:220:1:248:1893:25c8:1946'], nat64),
    ).toEqual({ ok: true, usable: ['93.184.215.14'] })
    expect(selectUsableAnswers(['2606:2800:220:1:248:1893:25c8:1946'], nat64)).toEqual({
      ok: false,
      reason: 'nat64-unknown',
      address: '2606:2800:220:1:248:1893:25c8:1946',
    })
  })
  it('new connections pace to the person’s rate, unlimited without one, closed at zero', () => {
    const free = checkRate(undefined, { tokens: 0, lastMono: 0 }, 9999)
    expect(free.ok).toBe(true)
    expect(free.state).toEqual({ tokens: 0, lastMono: 0 })
    const shut = checkRate(0, initialRate(4, 1000), 1000)
    expect(shut.ok).toBe(false)
    let state = initialRate(2, 1000)
    expect(checkRate(2, state, 1000).ok).toBe(true)
    state = checkRate(2, state, 1000).state
    expect(checkRate(2, state, 1000).ok).toBe(true)
    state = checkRate(2, state, 1000).state
    expect(checkRate(2, state, 1000).ok).toBe(false)
    state = checkRate(2, state, 1000).state
    expect(checkRate(2, state, 2000).ok).toBe(true)
  })
})
