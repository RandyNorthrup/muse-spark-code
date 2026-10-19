import type { enrichInteractiveLegalScan } from '../runtime/legal/legalRegistry'
import type { UiText } from './l10n/en'
// One lazy scanner contract for the extension and ACP package (M97, D76).
// Function signatures are trusted within the same build; callers validate results.
import type { LegalFinding, LegalScanInput, LegalScanResult } from './legal'
import type {
  ConfirmLegalFixMessage,
  LegalFixFailure,
  LegalFixPatch,
  LegalFixPreviewMessage,
  LegalFixResultMessage,
  RequestLegalFixMessage,
} from './legalFix'
import type { LegalRegistryEcosystem, PermissionMode } from './constants'

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

/**
The selected-fix preview store's surface (M97 lane W), as the conversation
host builds it on: the class itself rides the scanner's bundle, so only this
structural surface crosses here (signatures taken on trust, PLAN.md §8).
`state` narrows the host state to exactly what a preview and a confirm read.
*/
export interface LegalFixPreviewFiles {
  resolveRelativePath(relativePath: string): Promise<string | undefined>
  readBytes(absolutePath: string, maxBytes: number): Promise<Uint8Array | undefined>
}
export interface LegalFixPreviewApplier {
  prepare?(
    findings: readonly LegalFinding[],
    paths: readonly string[],
  ): Promise<readonly LegalFixPatch[]>
  apply(
    findings: readonly LegalFinding[],
    paths: readonly string[],
    patches: readonly LegalFixPatch[],
    isCurrent: () => boolean,
  ): Promise<{
    readonly applied: readonly string[]
    readonly failed: readonly LegalFixFailure[]
  }>
}
export interface LegalFixPreviewHostState {
  readonly permissionMode: PermissionMode
  readonly workspacePath: string
  readonly isTrusted: boolean
  readonly files: LegalFixPreviewFiles
  readonly applier: LegalFixPreviewApplier | undefined
}
export interface LegalFixPreviewStore {
  setScan(id: string, result: LegalScanResult, workspacePath: string): void
  invalidate(): void
  dispose(): void
  readonly report: LegalScanResult | undefined
  preview(
    message: RequestLegalFixMessage,
    state: LegalFixPreviewHostState,
  ): Promise<LegalFixPreviewMessage>
  confirm(
    message: ConfirmLegalFixMessage,
    state: LegalFixPreviewHostState,
  ): Promise<LegalFixResultMessage>
}

export interface LegalScanBundle {
  readonly enrichInteractiveLegalScan?: typeof enrichInteractiveLegalScan

  readonly renderLegalMarkdown?: (result: LegalScanResult) => string
  readonly setLanguage?: (table: UiText, locale: string) => void
  readonly prepareLegalFixes?: (
    workspaceRoot: string,
    findings: readonly LegalFinding[],
  ) => Promise<readonly LegalPreparedPatch[]>
  /** The selected-fix preview store, built on the first legal command. */
  readonly LegalFixPreviews?: new () => LegalFixPreviewStore

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
