// Finding a program on PATH without the working directory (PLAN.md D24).
// A bare name handed to `spawn` / `execFile` is looked up by the platform:
// libuv on Windows tries the current directory before PATH, and an empty or
// relative PATH entry means "here" on every platform. With the workspace as
// the working directory, a `git.exe` or `bash` committed to a repository
// would run instead of the real one. This resolver takes only absolute PATH
// entries, and on Windows only the extensions `execFile` can start without a
// shell (a `.cmd` needs one, and a shell string is banned, D4). Pure: the
// file probe is injected.

/**
 * The explicit "no workspace" scope for a capability probe before any folder
 * is known: absolute PATH entries only, links followed. Grep for
 * `NO_WORKSPACE` to review every such probe: each must never execute a
 * program planted in a workspace, so it resolves fixed absolute paths or
 * re-resolves once a workspace is known.
 */
export const NO_WORKSPACE = 'absolute-entries-only-links-followed' as const

/**
 * Where an executable lookup runs: a workspace root with its link resolver
 * (directories inside it are never probed), or the explicit no-workspace
 * scope above. Both carry the realpath function: forgetting either is a
 * type error, so the compiler lists every call site that skipped the guard.
 */
export type ExecutableScope =
  | {
      readonly workspaceRoot: string
      readonly realpath: (filePath: string) => string
    }
  | {
      readonly noWorkspace: typeof NO_WORKSPACE
      readonly realpath: (filePath: string) => string
    }

export interface ExecutableProbe {
  readonly platform: NodeJS.Platform
  /** The PATH value, unsplit. */
  readonly pathVariable: string | undefined
  readonly fileExists: (filePath: string) => boolean
  /** REQUIRED: the workspace the child runs in, or the explicit no-workspace scope. */
  readonly scope: ExecutableScope
}

export interface WorkspacePathSanitizeProbe {
  readonly platform: NodeJS.Platform
  /** The PATH value, unsplit. */
  readonly pathVariable: string | undefined
  /** The workspace the child runs in (its working directory). */
  readonly workspaceRoot: string
  /**
   * Resolves links in an entry or the workspace root; may throw (an entry
   * that cannot be resolved is compared lexically instead). Injected so the
   * Windows, macOS and Linux branches are all unit-tested on any OS.
   */
  readonly realpath: (filePath: string) => string
}

export interface WorkspaceChild {
  /** The workspace the child runs in (its working directory). */
  readonly workspaceRoot: string
  /**
   * Resolves links in an entry or the workspace root; may throw (an entry
   * that cannot be resolved is compared lexically instead). REQUIRED: a
   * lexical-only comparison keeps a symlink into the workspace on PATH.
   */
  readonly realpath: (filePath: string) => string
}

declare const guardedChildEnvBrand: unique symbol

/**
 * A child environment the guard produced: only `workspaceChildEnvironment`
 * (or `noWorkspaceChildEnvironment` for the explicit no-workspace probe)
 * can make one. Every spawn helper for a product-chosen program takes this
 * type, so passing a raw `process.env` is a type error the compiler lists.
 */
export type GuardedChildEnv = NodeJS.ProcessEnv & {
  readonly [guardedChildEnvBrand]: true
}
