/** The existing native Git API subset, independent of an editor's module or credentials. */
export type GitChange = Readonly<{
  uri: Readonly<{ fsPath: string }>
  status?: number
}>

/** Methods are immutable callbacks; push has no force argument or option. */
export type GitRepository = Readonly<{
  rootUri: Readonly<{ fsPath: string }>
  state: Readonly<{
    HEAD:
      | Readonly<{
          name?: string
          commit?: string
          upstream?: Readonly<{ remote: string; name: string }>
          ahead?: number
          behind?: number
        }>
      | undefined
    remotes: readonly Readonly<{ name: string; fetchUrl?: string; pushUrl?: string }>[]
    indexChanges: readonly GitChange[]
    workingTreeChanges: readonly GitChange[]
    untrackedChanges: readonly GitChange[]
  }>
  status: () => Promise<void>
  diff: (isCached?: boolean) => Promise<string>
  commit: (
    message: string,
    options: Readonly<{ all?: boolean; postCommitCommand: null }>,
  ) => Promise<void>
  push: (remoteName: string, refspec: string, isSettingUpstream: boolean) => Promise<void>
  fetch: (options: Readonly<{ remote: string; ref: string }>) => Promise<void>
  log: (
    options: Readonly<{ range: string }>,
  ) => Promise<readonly Readonly<{ hash: string; message: string }>[]>
  diffBetween: (ref1: string, ref2: string) => Promise<readonly GitChange[]>
}>

/** The native capture owns physical identity; loss never rebinds to a later directory. */
export type CaptureGitOwner = (
  root: string,
  check: () => void,
) => Promise<
  Readonly<{
    cwd: string
    isCurrent: () => boolean
  }>
>
