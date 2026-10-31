// The callable production split guard consumed by the real-build unit drills.
import type { Plugin } from 'esbuild'

interface Bundle {
  readonly output: string
  readonly metafile: string
}

interface DeferredBundle extends Bundle {
  readonly files: readonly string[]
  readonly use?: string
}

interface SourceGraph {
  readonly inputs: Readonly<
    Record<
      string,
      {
        readonly imports: readonly {
          readonly path: string
          readonly external?: boolean | undefined
        }[]
      }
    >
  >
}

export const BUNDLES: {
  readonly activation: Bundle
  readonly modelApi: Bundle
  readonly acp: Bundle
  readonly providers: Bundle
}
export const DEFERRED: readonly DeferredBundle[]
export const ON_FIRST_USE: readonly DeferredBundle[]
export const RESOURCE_PROCESS_ONLY: readonly string[]
export const RESOURCE_LAUNCH_SHARED: readonly string[]
export const RESOURCE_PROCESS_SHARED: readonly string[]
export const RESOURCE_PROCESS_BUNDLE: DeferredBundle
export function checkDeferredBundles(
  inputsOf: (bundle: Bundle) => ReadonlyMap<string, number>,
  metafileOf: (bundle: Bundle) => SourceGraph,
): string[]
export function checkResourceBundles(
  inputsOf: (bundle: Bundle) => ReadonlyMap<string, number>,
  bundles: readonly Bundle[],
): string[]
export const sharedUiText: Plugin
export const sharedResourceAdmission: Plugin
export const sharedWire: Plugin
export const sharedValidation: Plugin
export const sharedRedaction: Plugin
export const sharedVaultStore: Plugin
export const sharedMakerContracts: Plugin
export const deferredCohort: Plugin

export const DEFERRED_OUTFILES: ReadonlyMap<string, string>
export const MODEL_API_OPTIONAL_ONLY: readonly string[]
export const sharedStructuredSchema: Plugin
export const sharedModelApiBoundaries: Plugin
export const englishZodLocales: Plugin

export const nodeReferenceData: Plugin
