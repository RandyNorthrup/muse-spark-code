// One lazy scanner contract for the extension and ACP package (M97, D76).
// Function signatures are trusted within the same build; callers validate results.
import type { LegalScanInput, LegalScanResult } from './legal'
import type { LegalRegistryEcosystem } from './constants'

export interface LegalRegistryTarget {
  readonly ecosystem: LegalRegistryEcosystem
  readonly name: string
  readonly version: string
}

export interface LegalScanRequest {
  readonly workspaceRoot: string
  readonly input: LegalScanInput
  readonly signal?: AbortSignal
}

export interface LegalScanHandle {
  readonly result: LegalScanResult
  readonly registryTargets: readonly LegalRegistryTarget[]
}

export interface LegalScanBundle {
  readonly runLegalScan: (request: LegalScanRequest) => Promise<LegalScanHandle>
}

export function isLegalScanBundle(value: unknown): value is LegalScanBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runLegalScan' in value &&
    typeof value.runLegalScan === 'function'
  )
}
