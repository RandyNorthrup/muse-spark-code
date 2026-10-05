// The headless `legal` command's seam to the scanner (M97 lanes R+S, PLAN.md
// D76): what lane S's scanner provides, and how the command loads it. Lane S
// owns `src/core/legal/**`; this file owns only the interface and the lazy
// load of the `dist/legalScan.js` bundle beside the running one, validated
// before use. Until that bundle ships, the load fails with fixed words and
// the command reports incomplete coverage (exit 2), never an empty success.

import path from 'node:path'
import { requireFile } from '../../host/lazyBundle'
import {
  LEGAL_SCAN_BUNDLE_FILE,
  SETTING_DEFAULTS,
  type LegalHeaderPolicy,
} from '../../shared/constants'
import {
  legalScanResultSchema,
  type LegalScanInput,
  type LegalScanResult,
} from '../../shared/legal'
import { isRegistryTarget, type LegalRegistryTarget } from './legalRegistry'

/** What one scan yields: the contract result plus the scanner's own enrichment targets. */
export interface LegalScanHandle {
  readonly result: LegalScanResult
  /** Packages whose license the scanner could not see; the registry reader's input. */
  readonly registryTargets: readonly LegalRegistryTarget[]
}

/** Lane S's scanner behind the interface lane R calls (never the module). */
export interface LegalScanner {
  scan(request: {
    readonly workspaceRoot: string
    readonly input: LegalScanInput
    readonly signal?: AbortSignal
  }): Promise<LegalScanHandle>
}

/** The bundle's one export; signatures are taken on trust, results are not. */
interface LegalScanBundle {
  runLegalScan: (request: {
    readonly workspaceRoot: string
    readonly input: LegalScanInput
    readonly signal?: AbortSignal
  }) => Promise<unknown>
}

function isLegalScanBundle(value: unknown): value is LegalScanBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runLegalScan' in value &&
    typeof value.runLegalScan === 'function'
  )
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
          throw failed(`${LEGAL_SCAN_BUNDLE_FILE} could not be loaded`)
        }
        if (!isLegalScanBundle(loaded)) {
          throw failed(`${LEGAL_SCAN_BUNDLE_FILE} has an unexpected shape`)
        }
        bundle = loaded
      }
      const produced: unknown = await bundle.runLegalScan(request)
      if (typeof produced !== 'object' || produced === null || !('result' in produced)) {
        throw failed('the scanner returned an invalid result')
      }
      let result: LegalScanResult
      try {
        result = legalScanResultSchema.parse(produced.result)
      } catch {
        throw failed('the scanner returned an invalid result')
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
