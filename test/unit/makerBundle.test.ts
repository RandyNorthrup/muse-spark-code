// RLF-DEVICES: the maker bundle loader (src/host/devices/makerBundle.ts).
// The executors load on the first maker execution through the product's
// own require: a missing bundle fails with the fixed unavailable words,
// a wrong-shaped module fails the same way, and the real entry loads
// once and assembles over the caller's live surface.
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAKER_MODEL_TEXT } from '../../src/shared/constants'
import { isMakerBundle, makerLoader } from '../../src/host/devices/makerBundle'
import * as MakerEntry from '../../src/host/devices/makerEntry'
import { PanelMakerSurface } from '../../src/host/devices/makerSurface'
import { errorLogger } from './helpers/collectingLogger'
import { usingTempDir } from './helpers/temporaryFolders'

function loadError(load: () => unknown): Error {
  let failure: unknown
  try {
    load()
  } catch (error: unknown) {
    failure = error
  }
  expect(failure).toBeInstanceOf(Error)
  const error = failure as Error
  expect(error.message).toBe(MAKER_MODEL_TEXT.makerBundleUnavailable)
  return error
}

describe('maker bundle loader', () => {
  it('fails with the fixed words when the bundle is missing', async () => {
    await usingTempDir('maker-bundle-', (root) => {
      const errors: string[] = []
      const load = makerLoader({
        bundlePath: path.join(root, 'missing-bundle.cjs'),
        log: errorLogger(errors),
      })
      expect(loadError(load).cause).toBeDefined()
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('maker bundle')
    })
  })

  it('fails with the fixed words when the module has the wrong shape', async () => {
    await usingTempDir('maker-bundle-', (root) => {
      const errors: string[] = []
      const load = makerLoader({
        bundlePath: path.join(root, 'wrong-shape.cjs'),
        log: errorLogger(errors),
        loadBundle: () => ({ createMakerService: 'not-a-function' }),
      })
      loadError(load)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('does not export')
    })
  })

  it('loads the real entry once and assembles over the live surface', () => {
    const errors: string[] = []
    let loads = 0
    const load = makerLoader({
      bundlePath: 'unused: the test hands in the module',
      log: errorLogger(errors),
      loadBundle: () => {
        loads += 1
        return MakerEntry
      },
    })
    const bundle = load()
    expect(isMakerBundle(bundle)).toBe(true)
    expect(load()).toBe(bundle)
    expect(loads).toBe(1)
    const surface = new PanelMakerSurface({ publish: () => undefined, reveal: () => undefined })
    try {
      const service = bundle.createMakerService({ surface })
      expect(service.surface).toBe(surface)
      expect(service.approvals).toBeDefined()
      expect(service.printer).toBeDefined()
      expect(service.simulators.printer).toBeDefined()
    } finally {
      surface.dispose()
    }
    expect(errors).toEqual([])
  })
})
