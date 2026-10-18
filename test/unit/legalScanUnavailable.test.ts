// The legal-scanner-missing refusal (D119): only the bundle loader's own
// refusal says the scanner could not load; any other failure keeps its kind.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isLegalScanUnavailable } from '../../src/acp/agent'
import { UI_TEXT } from '../../src/shared/constants'
import { legalScanLoader } from '../../src/host/ide/legalScanBundle'
import type { LegalScanBundle } from '../../src/shared/legalScanEntry'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function missingBundleLoad(): () => LegalScanBundle {
  const root = mkdtempSync(path.join(tmpdir(), 'muse-legal-scan-'))
  roots.push(root)
  const lines: string[] = []
  const load = legalScanLoader({
    bundlePath: path.join(root, 'legalScan.js'),
    log: {
      trace: (message) => {
        lines.push(message)
      },
      info: (message) => {
        lines.push(message)
      },
      warn: (message) => {
        lines.push(message)
      },
      error: (message) => {
        lines.push(message)
      },
    },
  })
  return load
}

describe('legal scanner missing refusal', () => {
  it('names the real loader refusal', () => {
    const load = missingBundleLoad()
    let failure: unknown
    try {
      load()
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(UI_TEXT.legalScanUnavailable)
    expect(isLegalScanUnavailable(failure)).toBe(true)
  })

  it('refuses nothing else as a missing scanner', () => {
    expect(isLegalScanUnavailable(new Error('something else'))).toBe(false)
    expect(isLegalScanUnavailable('legalScanUnavailable')).toBe(false)
    expect(isLegalScanUnavailable(undefined)).toBe(false)
  })
})
