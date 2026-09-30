import { describe, expect, it } from 'vitest'
import { addressFamily, isPublicAddress, nat64PrefixesOf } from '../../src/core/web/publicAddress'

describe('isPublicAddress (M69)', () => {
  it('refuses every non-public IPv4 block, at both edges', () => {
    for (const address of [
      '0.0.0.0',
      '0.255.255.255',
      '10.0.0.0',
      '10.255.255.255',
      '100.64.0.0',
      '100.100.100.200',
      '100.127.255.255',
      '127.0.0.1',
      '127.255.255.254',
      '169.254.0.0',
      '169.254.169.254',
      '169.254.255.255',
      '172.16.0.0',
      '172.31.255.255',
      '192.0.0.192',
      '192.0.2.1',
      '192.88.99.1',
      '192.168.0.1',
      '192.168.255.255',
      '198.18.0.1',
      '198.19.255.255',
      '198.51.100.7',
      '203.0.113.9',
      '224.0.0.1',
      '239.255.255.255',
      '240.0.0.1',
      '255.255.255.255',
      '168.63.129.16',
    ]) {
      expect(isPublicAddress(address), address).toBe(false)
    }
  })

  it('accepts the public addresses just outside those blocks', () => {
    for (const address of [
      '1.1.1.1',
      '8.8.8.8',
      '9.255.255.255',
      '11.0.0.0',
      '100.63.255.255',
      '100.128.0.0',
      '126.255.255.255',
      '128.0.0.0',
      '169.253.255.255',
      '169.255.0.0',
      '172.15.255.255',
      '172.32.0.0',
      '192.167.255.255',
      '192.169.0.0',
      '198.17.255.255',
      '198.20.0.0',
      '223.255.255.255',
      '168.63.129.17',
      '93.184.215.14',
    ]) {
      expect(isPublicAddress(address), address).toBe(true)
    }
  })

  it('accepts only global unicast IPv6, outside its special blocks', () => {
    for (const address of [
      '::',
      '::1',
      'fe80::1',
      'febf::1',
      'fc00::1',
      'fd00:ec2::254',
      'ff02::1',
      '100::1',
      '64:ff9b:1::1',
      '2001::1',
      '2001:0:4136:e378::1',
      '2001:1ff::1',
      '2001:db8::1',
      '3fff::1',
      '5f00::1',
    ]) {
      expect(isPublicAddress(address), address).toBe(false)
    }
    for (const address of ['2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450::1']) {
      expect(isPublicAddress(address), address).toBe(true)
    }
  })

  it('judges an IPv6 form that carries an IPv4 address by that address', () => {
    for (const address of [
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:10.1.2.3',
      '::ffff:169.254.169.254',
      '::127.0.0.1',
      '64:ff9b::10.0.0.1',
      '64:ff9b::a9fe:a9fe',
      '2002:7f00:1::1',
      '2002:c0a8:101::',
    ]) {
      expect(isPublicAddress(address), address).toBe(false)
    }
    for (const address of ['::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::1']) {
      expect(isPublicAddress(address), address).toBe(true)
    }
  })

  it('refuses a zoned address, a name and anything that is not an address', () => {
    for (const text of ['fe80::1%eth0', '2606:4700::1%1', 'example.com', '', '1.2.3', '::g']) {
      expect(isPublicAddress(text), text).toBe(false)
    }
  })

  it("finds the network's NAT64 prefixes from ipv4only.arpa, in every RFC 6052 layout", () => {
    // RFC 6052 §2.4's examples, with 192.0.0.170 in place of 192.0.2.33.
    const answers: Readonly<Record<number, string>> = {
      32: '2001:db8:c000:aa::',
      40: '2001:db8:1c0:0:aa::',
      48: '2001:db8:122:c000:0:aa00::',
      56: '2001:db8:122:3c0:0:aa::',
      64: '2001:db8:122:344:c0:0:aa00:0',
      96: '2001:db8:122:344::c000:aa',
    }
    for (const [length, answer] of Object.entries(answers)) {
      expect(
        nat64PrefixesOf([answer]).map((prefix) => prefix.length),
        answer,
      ).toContain(Number(length))
    }
    expect(nat64PrefixesOf(['2001:db8::1', 'not an address', '192.0.0.170'])).toEqual([])
  })

  it('judges an address under a discovered NAT64 prefix by the IPv4 address it carries', () => {
    const prefixes = nat64PrefixesOf(['2a01:4f8:c0c:1234:c0:0:aa00:0'])
    expect(prefixes).toEqual([{ prefix: 0x2a_01_04_f8_0c_0c_12_34n, length: 64 }])
    // 10.0.0.5 and 169.254.169.254 under the prefix: not public, whatever 2000::/3 says.
    expect(isPublicAddress('2a01:4f8:c0c:1234:a:0:500:0', prefixes)).toBe(false)
    expect(isPublicAddress('2a01:4f8:c0c:1234:a9:fea9:fe00:0', prefixes)).toBe(false)
    expect(isPublicAddress('2a01:4f8:c0c:1234:a:0:500:0')).toBe(true)
    // 8.8.8.8 under it is public, and an address outside it is judged as IPv6.
    expect(isPublicAddress('2a01:4f8:c0c:1234:8:808:800:0', prefixes)).toBe(true)
    expect(isPublicAddress('2606:4700:4700::1111', prefixes)).toBe(true)
    expect(isPublicAddress('8.8.8.8', prefixes)).toBe(true)
  })

  it('names the family of an address and of nothing else', () => {
    expect(addressFamily('8.8.8.8')).toBe(4)
    expect(addressFamily('2606:4700::1')).toBe(6)
    expect(addressFamily('::ffff:1.2.3.4')).toBe(6)
    expect(addressFamily('example.com')).toBeUndefined()
  })
})
