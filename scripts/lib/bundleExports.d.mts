export function siblingExportProblems(files: ReadonlyMap<string, string>): {
  readonly problems: readonly string[]
  readonly verified: ReadonlyMap<string, number>
  readonly unverified: readonly string[]
}
