// PR206 (PLAN.md D6): activation keeps only the loader; the Muse Code
// backend bundle loads on its first start, and a missing or misshapen one
// refuses with an explicit error.

import { describe, expect, it } from 'vitest'
import { isMuseCodeBundle, museCodeBundleLoader } from '../../src/host/backend/museCodeBundle'
import * as museCodeEntry from '../../src/host/backend/museCodeEntry'
import { EN } from '../../src/shared/l10n/en'

function goodBundle() {
  return {
    installMuseCodeUiText: () => undefined,
    MuseCodeHost: () => undefined,
    museCodeEffortPort: {},
    spawnAccountMspConnection: () => ({}),
    spawnMspConnection: () => ({}),
  }
}

describe('isMuseCodeBundle', () => {
  it('accepts the real bundle entry the build ships as dist/museCode.js', () => {
    expect(isMuseCodeBundle(museCodeEntry)).toBe(true)
  })

  it('accepts the host and spawn paths and refuses anything else', () => {
    expect(isMuseCodeBundle(goodBundle())).toBe(true)
    expect(isMuseCodeBundle({ ...goodBundle(), MuseCodeHost: 'x' })).toBe(false)
    for (const bad of [undefined, null, {}, { createModelApiHost: () => ({}) }]) {
      expect(isMuseCodeBundle(bad)).toBe(false)
    }
  })
})

function backendLoader(loadBundle: (file: string) => unknown) {
  return museCodeBundleLoader({
    bundlePath: '/dist/museCode.js',
    log: {
      trace: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    loadBundle,
  })
}

describe('the Muse Code backend loader', () => {
  it('refuses a missing backend bundle with the backend unavailable', () => {
    const load = backendLoader(() => {
      throw new Error('no such file')
    })
    expect(() => load()).toThrow(EN.museCodeBundleUnavailable)
  })

  it('refuses a misshapen bundle and installs the table on a good one', () => {
    let loads = 0
    const load = backendLoader(() => {
      loads += 1
      return { nope: true }
    })
    expect(() => load()).toThrow(EN.museCodeBundleUnavailable)
    let installed = 0
    const good = backendLoader(() => {
      loads += 1
      return { ...goodBundle(), installMuseCodeUiText: () => (installed += 1) }
    })
    expect(good()).toMatchObject({})
    expect(good()).toMatchObject({})
    expect(loads).toBe(2)
    expect(installed).toBe(2)
  })
})
