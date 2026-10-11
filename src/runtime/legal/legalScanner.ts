import { fill, uiLocale } from '../../shared/l10n/text'
// Shared production scanner contract, required lazily beside the running ACP bundle.
// A missing or malformed scanner reports incomplete coverage, never empty success.

import path from 'node:path'
import { requireFile } from '../../host/lazyBundle'
import {
  UI_TEXT,
  LEGAL_SCAN_BUNDLE_FILE,
  SETTING_DEFAULTS,
  type LegalHeaderPolicy,
} from '../../shared/constants'
import { legalScanResultSchema, type LegalScanResult } from '../../shared/legal'
import { isRegistryTarget, type LegalRegistryTarget } from './legalRegistry'

import {
  isLegalScanBundle,
  type LegalScanBundle,
  type LegalScanRequest,
  type LegalScanHandle,
} from '../../shared/legalScanEntry'
export type { LegalScanHandle } from '../../shared/legalScanEntry'

export interface LegalScanner {
  scan(request: LegalScanRequest): Promise<LegalScanHandle>
}

/** A load or shape failure's fixed technical reason; the command wraps it for the user. */
function failed(reason: string): Error {
  return new Error(reason)
}

/**
 * The scanner from the bundle beside the running one (`distDir`), loaded on
 * the first scan and kept after. Tests hand in `loadBundle`; production uses
 * Node's own require, like the host's lazy bundles.
 */
export function loadLegalScanner(input: {
  readonly distDir: string
  readonly loadBundle?: ((file: string) => unknown) | undefined
}): LegalScanner {
  const load = input.loadBundle ?? requireFile
  const bundleFile = path.join(input.distDir, LEGAL_SCAN_BUNDLE_FILE)
  let bundle: LegalScanBundle | undefined
  return {
    async scan(request) {
      request.signal?.throwIfAborted()
      if (bundle === undefined) {
        let loaded: unknown
        try {
          loaded = load(bundleFile)
        } catch {
          throw failed(fill(UI_TEXT.legalScanner.bundleLoad, { file: LEGAL_SCAN_BUNDLE_FILE }))
        }
        if (!isLegalScanBundle(loaded)) {
          throw failed(fill(UI_TEXT.legalScanner.bundleShape, { file: LEGAL_SCAN_BUNDLE_FILE }))
        }
        bundle = loaded
      }
      bundle.setLanguage?.(UI_TEXT, uiLocale())
      const produced: unknown = await bundle.runLegalScan(request)
      if (typeof produced !== 'object' || produced === null || !('result' in produced)) {
        throw failed(UI_TEXT.legalScanner.invalidResult)
      }
      let result: LegalScanResult
      try {
        result = legalScanResultSchema.parse(produced.result)
      } catch {
        throw failed(UI_TEXT.legalScanner.invalidResult)
      }
      const registryTargets: LegalRegistryTarget[] = []
      if ('registryTargets' in produced && Array.isArray(produced.registryTargets)) {
        for (const candidate of produced.registryTargets) {
          if (isRegistryTarget(candidate)) registryTargets.push(candidate)
        }
      }
      return { result, registryTargets }
    },
  }
}

/** The workspace default the headless scan runs under (lane 0's setting default). */
export function defaultScanPolicy(): LegalHeaderPolicy {
  return SETTING_DEFAULTS.legalHeaderPolicy
}
