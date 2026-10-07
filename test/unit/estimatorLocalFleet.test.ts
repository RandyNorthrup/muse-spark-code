// M117 W: the local fleet measures this machine and refuses platforms it
// cannot name. Repository default timeout; no skips.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { fleetFromHost } from '../../src/host/estimator/localFleet'
import { chainLanes } from './helpers/estimator/fixtures'

const AS_OF = '2026-10-06T12:00:00.000Z'

beforeEach(() => {
  setUiText(EN, BASE_LOCALE)
})
afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

describe('M117 local fleet', () => {
  it('measures this machine with one serial slot per lane kind', () => {
    const fleet = fleetFromHost(
      { platform: 'darwin', arch: 'arm64', cores: 8, ramGiB: 16 },
      chainLanes(),
      AS_OF,
    )
    expect(fleet.asOf).toBe(AS_OF)
    expect(fleet.machines).toHaveLength(1)
    expect(fleet.machines[0]).toMatchObject({
      id: 'local',
      classId: 'macos-arm64',
      source: 'local',
      os: 'macos',
      architecture: 'arm64',
      cores: 8,
      ramGiB: 16,
      governorSlots: 1,
    })
    expect(fleet.machines[0]?.capacityByKind).toEqual([
      { kind: 'contracts', slots: 1 },
      { kind: 'core', slots: 1 },
    ])
    expect(fleet.roles).toEqual([{ id: 'local', laneKinds: ['contracts', 'core'] }])
    expect(fleet.accounts).toHaveLength(1)
    expect(fleet.accounts[0]).toMatchObject({ id: 'local', providerId: 'local' })
    expect(fleet.ci).toEqual([])
  })
  it('leaves disks unknown instead of guessing headroom', () => {
    const fleet = fleetFromHost(
      { platform: 'linux', arch: 'x64', cores: 4, ramGiB: 7.75 },
      chainLanes(),
      AS_OF,
    )
    expect(fleet.machines[0]?.classId).toBe('linux-x64')
    expect(fleet.machines[0]?.disks).toEqual([
      { status: 'unknown', volumeId: 'primary', roles: ['workspace', 'temp', 'state'] },
    ])
  })
  it('refuses platforms, architectures and measurements it cannot name', () => {
    const kinds = chainLanes()
    for (const host of [
      { platform: 'freebsd', arch: 'x64', cores: 8, ramGiB: 16 },
      { platform: 'linux', arch: 'mips', cores: 8, ramGiB: 16 },
      { platform: 'linux', arch: 'x64', cores: 0, ramGiB: 16 },
      { platform: 'linux', arch: 'x64', cores: 8, ramGiB: 0 },
    ])
      expect(() => fleetFromHost(host, kinds, AS_OF)).toThrow(/unsupported-platform/)
  })
})
