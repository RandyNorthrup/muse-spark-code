export interface CrossBundleReport {
  readonly problems: readonly string[]
  /** Members compared with each sibling's export list; a sibling with none is absent. */
  readonly verified: ReadonlyMap<string, number>
  readonly unverified: readonly string[]
  /** Uses of a loaded sibling the check could not follow to the members read. */
  readonly unfollowed: readonly string[]
  /** Loads whose file is worked out at run time: which bundle they read is not in the text. */
  readonly computed: readonly { readonly reader: string; readonly text: string }[]
}

export function siblingExportProblems(files: ReadonlyMap<string, string>): CrossBundleReport

export function crossBundleFailures(
  report: CrossBundleReport,
  targets: readonly string[],
  expectedComputed?: readonly { readonly reader: string; readonly fragment: string }[],
): string[]

export const CROSS_BUNDLE_TARGETS: readonly string[]

export const COMPUTED_LOADS: readonly { readonly reader: string; readonly fragment: string }[]
