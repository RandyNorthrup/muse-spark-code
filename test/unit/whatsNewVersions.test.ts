// What's New's version arithmetic and choice of releases (M99, PLAN.md D79).

import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  decideUpdate,
  isVersion,
  hasHighlights,
  releasesToShow,
} from '../../src/core/whatsNew/whatsNewVersions'

describe('compareVersions', () => {
  it('orders by semver precedence, prereleases below their release', () => {
    const ordered = [
      '0.9.9',
      '0.10.0-alpha',
      '0.10.0-alpha.1',
      '0.10.0-alpha.beta',
      '0.10.0-beta',
      '0.10.0-beta.2',
      '0.10.0-beta.11',
      '0.10.0-rc.1',
      '0.10.0',
      '0.10.1',
      '1.0.0',
    ]
    for (let index = 1; index < ordered.length; index += 1) {
      const older = ordered[index - 1] ?? ''
      const newer = ordered[index] ?? ''
      expect(compareVersions(older, newer), `${older} < ${newer}`).toBe(-1)
      expect(compareVersions(newer, older), `${newer} > ${older}`).toBe(1)
    }
    expect(compareVersions('0.12.1', '0.12.1')).toBe(0)
    // Build metadata takes no part in precedence.
    expect(compareVersions('0.12.1+build.5', '0.12.1')).toBe(0)
  })

  it('throws on a text that is not a version', () => {
    expect(() => compareVersions('0.12', '0.12.1')).toThrow('Not a semantic version: 0.12')
    expect(() => compareVersions('0.12.1', 'v0.12.1')).toThrow('v0.12.1')
    expect(isVersion('01.2.3')).toBe(false)
    expect(isVersion(12)).toBe(false)
    expect(isVersion('0.12.1')).toBe(true)
  })
})

describe('decideUpdate', () => {
  it('records a fresh install and shows nothing', () => {
    expect(decideUpdate({ previous: undefined, current: '0.13.0', hasEarlierUse: false })).toEqual({
      kind: 'firstInstall',
    })
    // A stored value that is not a version counts as none.
    expect(decideUpdate({ previous: 7, current: '0.13.0', hasEarlierUse: false }).kind).toBe(
      'firstInstall',
    )
  })

  it('takes an install with signs of earlier use as an upgrade from an unknown version', () => {
    expect(decideUpdate({ previous: undefined, current: '0.13.0', hasEarlierUse: true })).toEqual({
      kind: 'upgrade',
      from: undefined,
    })
  })

  it('shows an upgrade, and neither the same version nor a downgrade', () => {
    expect(decideUpdate({ previous: '0.12.1', current: '0.13.0', hasEarlierUse: true })).toEqual({
      kind: 'upgrade',
      from: '0.12.1',
    })
    expect(decideUpdate({ previous: '0.13.0', current: '0.13.0', hasEarlierUse: true }).kind).toBe(
      'notNewer',
    )
    expect(decideUpdate({ previous: '0.14.0', current: '0.13.0', hasEarlierUse: true }).kind).toBe(
      'notNewer',
    )
    // A release after its own prerelease is an upgrade; the reverse is not.
    expect(
      decideUpdate({ previous: '0.13.0-rc.1', current: '0.13.0', hasEarlierUse: true }).kind,
    ).toBe('upgrade')
    expect(
      decideUpdate({ previous: '0.13.0', current: '0.13.0-rc.1', hasEarlierUse: true }).kind,
    ).toBe('notNewer')
  })
})

const RELEASES = [
  { version: '0.13.1', highlights: [] },
  { version: '0.13.0', highlights: ['big'] },
  { version: '0.12.1', highlights: [] },
  { version: '0.12.0', highlights: [] },
  { version: '0.11.0', highlights: ['older'] },
]

function versions(list: readonly { version: string }[]): string[] {
  return list.map((release) => release.version)
}

describe('releasesToShow', () => {
  it('after an upgrade from a known version: every release after it, up to the current one', () => {
    expect(versions(releasesToShow(RELEASES, '0.12.0', '0.13.1'))).toEqual([
      '0.13.1',
      '0.13.0',
      '0.12.1',
    ])
    expect(versions(releasesToShow(RELEASES, '0.13.0', '0.13.1'))).toEqual(['0.13.1'])
    // A release newer than the running one is never shown.
    expect(versions(releasesToShow(RELEASES, '0.12.1', '0.13.0'))).toEqual(['0.13.0'])
  })

  it('otherwise: back to the newest release with Highlights, or the current one alone', () => {
    expect(versions(releasesToShow(RELEASES, undefined, '0.13.1'))).toEqual(['0.13.1', '0.13.0'])
    expect(versions(releasesToShow(RELEASES, undefined, '0.12.1'))).toEqual([
      '0.12.1',
      '0.12.0',
      '0.11.0',
    ])
    expect(versions(releasesToShow(RELEASES.slice(2, 4), undefined, '0.12.1'))).toEqual(['0.12.1'])
    expect(releasesToShow(RELEASES, undefined, '0.10.0')).toEqual([])
  })

  it('reads the releases in any order', () => {
    expect(versions(releasesToShow(RELEASES.toReversed(), '0.12.0', '0.13.1'))).toEqual([
      '0.13.1',
      '0.13.0',
      '0.12.1',
    ])
  })
})

describe('hasHighlights', () => {
  it('opens the page when any release has Highlights; a fixes-only patch gets the notification', () => {
    expect(hasHighlights(RELEASES.slice(0, 2))).toBe(true)
    expect(hasHighlights(RELEASES.slice(0, 1))).toBe(false)
    expect(hasHighlights([])).toBe(false)
  })
})
