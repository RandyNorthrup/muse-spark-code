import type { UiText } from './l10n/en'
// One lazy scanner contract for the extension and ACP package (M97, D76).
// Function signatures are trusted within the same build; callers validate results.
import type { LegalFinding, LegalScanInput, LegalScanResult } from './legal'
import type { LegalFixPatch } from './legalFix'
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

export interface LegalPreparedPatch {
  readonly evidence: readonly { readonly path: string; readonly hash: string }[]
  readonly patch: LegalFixPatch
  readonly before: string
  readonly after: string
}

export interface LegalScanBundle {
  readonly renderLegalMarkdown?: (result: LegalScanResult) => string
  readonly setLanguage?: (table: UiText, locale: string) => void
  readonly prepareLegalFixes?: (
    workspaceRoot: string,
    findings: readonly LegalFinding[],
  ) => Promise<readonly LegalPreparedPatch[]>

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
