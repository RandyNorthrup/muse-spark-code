// M110r Y2: the node notices its own address changes and dials home.
import { isIP } from 'node:net'
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import { describe, expect, it } from 'vitest'
import { compareStrings } from '../../src/shared/canonicalJson'
import { diffAddresses, snapshotAddresses, watchAddresses } from '../../src/runtime/node/netWatch'

describe('address snapshots', () => {
  it('lists the real external addresses, sorted and stable', () => {
    const first = snapshotAddresses()
    const second = snapshotAddresses()
    expect(first).toEqual(second)
    expect(first.toSorted(compareStrings)).toEqual(first)
    const real = networkInterfaces()
    const external = new Set<string>()
    const families = Object.values(real)
    for (const infos of families) {
      const family = infos ?? []
      for (const info of family) {
        if (info.internal) {
          continue
        }
        expect(isIP(info.address)).not.toBe(0)
        external.add(info.address)
      }
    }
    expect(new Set(first)).toEqual(external)
  })
  it('diffs additions and removals', () => {
    expect(diffAddresses(['a'], ['a'])).toEqual({ added: [], removed: [] })
    expect(diffAddresses(['a'], ['a', 'b'])).toEqual({ added: ['b'], removed: [] })
    expect(diffAddresses(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] })
  })
})

const lister = (sets: readonly (readonly string[])[]) => {
  let index = 0
  return (): Record<string, NetworkInterfaceInfo[] | undefined> => {
    const addresses = sets[Math.min(index, sets.length - 1)] ?? []
    index += 1
    return {
      eth0: addresses.map((address): NetworkInterfaceInfo => {
        const info: NetworkInterfaceInfo = {
          address,
          family: 'IPv4',
          internal: false,
          mac: '00:00:00:00:00:00',
          netmask: '255.255.255.0',
          cidr: `${address}/24`,
        }
        return info
      }),
    }
  }
}

describe('watchAddresses', () => {
  it('reports a renumber and then stays quiet, and stops on request', async () => {
    const seen: { added: readonly string[]; removed: readonly string[] }[] = []
    const stop = watchAddresses({
      pollMs: 5,
      list: lister([['192.0.2.154'], ['192.0.2.191'], ['192.0.2.191']]),
      onChange: (change) => {
        seen.push(change)
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 40))
    stop()
    await new Promise((resolve) => setTimeout(resolve, 15))
    expect(seen).toEqual([{ added: ['192.0.2.191'], removed: ['192.0.2.154'] }])
  })
})
