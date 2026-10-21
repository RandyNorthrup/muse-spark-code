// The header-fix bundle loader (D6): the preview store resolves from
// dist/legalFix.js, and a module without the planner is refused as
// unavailable instead of loading halfway.
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { legalFixLoader } from '../../src/host/ide/legalScanBundle'
import { LegalFixPreviews } from '../../src/core/legal/fixPreviews'
import { collectingLogger } from './helpers/collectingLogger'

describe('legal fix bundle loader', () => {
  it('hands the preview store from the fix bundle', () => {
    const load = legalFixLoader({
      bundlePath: 'nowhere/legalFix.js',
      log: collectingLogger([]),
      loadBundle: () => ({ prepareLegalHeaderPatches: () => [], LegalFixPreviews }),
    })
    const bundle = load()
    expect(bundle.LegalFixPreviews).toBe(LegalFixPreviews)
    expect(new bundle.LegalFixPreviews!() instanceof LegalFixPreviews).toBe(true)
  })

  it('refuses a module without the planner as unavailable', () => {
    const load = legalFixLoader({
      bundlePath: 'nowhere/legalFix.js',
      log: collectingLogger([]),
      loadBundle: () => ({}),
    })
    let failure: unknown
    try {
      load()
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(UI_TEXT.legalFixRefusedUnavailable)
  })
})
