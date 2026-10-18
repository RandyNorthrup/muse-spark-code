// "Open a Pull Request in a Conversation…" where VS Code's Git extension is
// missing (M123, PLAN.md D104 §1): the repository the checkout reads, from
// the user's own `git` on PATH instead of the extension. The checkout itself
// (pullRequestCheckout.ts) is the same one VS Code runs: the extension's own
// git for the worktree, the held checkout's writer for someone else's pull
// request, VS Code's worktree records and the hold by location.
//
// - Its root is git's own toplevel; its remotes and the branch's upstream
//   come from `git status --porcelain=v2` and the remote reads the native
//   route makes (core/git/status.ts), in the quiet environment.
// - The pull request's fetch (`git fetch <remote> pull/<n>/head`) is D104's
//   named exception: the user's own Git environment (their credential
//   helpers, SSH agent and Git token routes, as a terminal would), never
//   anything of ours, and no prompt. Only a plain remote name and that one
//   ref shape are fetched.
// - No deadline of ours: Cancel and the window's closing stop the git.

import path from 'node:path'
import { withoutCredentials } from '../../core/credentialEnvironment'
import { isPlainRefName } from '../../core/git/pushPlan'
import { readNativeStatus, toPushHead } from '../../core/git/status'
import { GIT_PUSH_CREDENTIAL_VARIABLES, UI_TEXT } from '../../shared/constants'
import { quietGitEnvironment, type GitProcess } from '../git'
import { GitUnavailableError, type CheckoutRepository } from './gitExtension'

export interface NativeRepositoryDeps {
  /** git with binary stdout, through the governed runner (git.ts `createGitProcess`). */
  readonly gitProcess: GitProcess
  /** The window's environment: the reads get it without credentials, the fetch with git's routes only. */
  readonly env: NodeJS.ProcessEnv
  /** Aborts with the window. */
  readonly signal: AbortSignal
}

// GitHub keeps every pull request's head at this ref of the base repository.
const PULL_HEAD_REF = /^pull\/\d+\/head$/

/** The repository at `root` through the user's own git, or `GitUnavailableError`. */
export function nativeCheckoutRepository(
  deps: NativeRepositoryDeps,
): (root: string) => Promise<CheckoutRepository> {
  // No deadline of ours on any of it, whatever a reader asks for.
  const run: GitProcess = (args, options) =>
    deps.gitProcess(args, { ...options, timeoutMs: undefined, signal: deps.signal })
  return async (root) => {
    const quiet = { cwd: root, env: quietGitEnvironment(deps.env), signal: deps.signal }
    let toplevel: string
    try {
      const shown = await run(['rev-parse', '--show-toplevel'], { ...quiet, timeoutMs: undefined })
      toplevel = path.resolve(shown.toString('utf8').trim())
    } catch {
      throw new GitUnavailableError(UI_TEXT.gitUnavailable)
    }
    const read = async (): Promise<CheckoutRepository['state']> => {
      const { snapshot, remotes } = await readNativeStatus(run, {
        cwd: toplevel,
        env: quiet.env,
        signal: deps.signal,
      })
      const head = toPushHead(snapshot, remotes)
      return {
        HEAD: {
          ...(snapshot.branch !== undefined && { name: snapshot.branch }),
          ...(snapshot.headOid !== undefined && { commit: snapshot.headOid }),
          ...(head.ok && head.head.upstream !== undefined && { upstream: head.head.upstream }),
        },
        remotes: remotes.map((remote) => ({
          name: remote.name,
          ...(remote.fetchUrl !== undefined && { fetchUrl: remote.fetchUrl }),
          ...(remote.pushUrl !== undefined && { pushUrl: remote.pushUrl }),
        })),
      }
    }
    let state = await read()
    return {
      rootUri: { fsPath: toplevel },
      get state() {
        return state
      },
      async status() {
        state = await read()
      },
      async fetch({ remote, ref }) {
        if (!isPlainRefName(remote) || !PULL_HEAD_REF.test(ref)) {
          throw new GitUnavailableError(UI_TEXT.gitUnavailable)
        }
        await run(['fetch', remote, ref], {
          cwd: toplevel,
          env: {
            ...withoutCredentials(deps.env, GIT_PUSH_CREDENTIAL_VARIABLES),
            GIT_TERMINAL_PROMPT: '0',
          },
          credentialRoutes: GIT_PUSH_CREDENTIAL_VARIABLES,
          timeoutMs: undefined,
          signal: deps.signal,
        })
      },
    }
  }
}
