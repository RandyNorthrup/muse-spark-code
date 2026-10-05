// The legal scanner's lazy bundle (M97, lane B): the structural check, the
// cached load, and the unavailable refusal naming the cause in the log.
// Lane R builds the real dist/legalScan.js; until then a missing file refuses
// with the installed unavailable words.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../../src/host/logger'
import { isLegalScanBundle, legalScanLoader } from '../../src/host/ide/legalScanBundle'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import type { LegalScanRunner } from '../../src/host/ide/legalScanTool'
import { FakeLogOutputChannel } from './helpers/fakes'
import { logLines } from './helpers/logText'

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

function logger() {
  const channel = new FakeLogOutputChannel()
  return { log: createLogger(channel), channel }
}

describe('isLegalScanBundle', () => {
  it('takes the scan export, nothing else', () => {
    const runLegalScan = (() => Promise.reject(new Error('no'))) as LegalScanRunner
    expect(isLegalScanBundle({ runLegalScan })).toBe(true)
    expect(isLegalScanBundle({})).toBe(false)
    expect(isLegalScanBundle({ runLegalScan: 'scan' })).toBe(false)
    expect(isLegalScanBundle(undefined)).toBe(false)
  })
})

describe('legalScanLoader', () => {
  it('loads once and keeps the bundle', () => {
    const runLegalScan = vi.fn() as unknown as LegalScanRunner
    const loadBundle = vi.fn(() => ({ runLegalScan }))
    const { log } = logger()
    const load = legalScanLoader({ bundlePath: '/dist/legalScan.js', log, loadBundle })
    expect(load()).toEqual({ runLegalScan })
    expect(load()).toEqual({ runLegalScan })
    expect(loadBundle).toHaveBeenCalledTimes(1)
  })

  it('refuses a missing bundle with the unavailable words and logs the cause', () => {
    setUiText(EN, BASE_LOCALE)
    const { log, channel } = logger()
    const failure = new Error('ENOENT: no such bundle')
    const load = legalScanLoader({
      bundlePath: '/dist/legalScan.js',
      log,
      loadBundle: () => {
        throw failure
      },
    })
    expect(() => load()).toThrow(UI_TEXT.legalScanUnavailable)
    expect(logLines(channel).join('\n')).toContain('ENOENT')
  })

  it('refuses a module without the scan export', () => {
    const { log } = logger()
    const load = legalScanLoader({
      bundlePath: '/dist/legalScan.js',
      log,
      loadBundle: () => ({ somethingElse: 1 }),
    })
    expect(() => load()).toThrow(UI_TEXT.legalScanUnavailable)
  })
})
