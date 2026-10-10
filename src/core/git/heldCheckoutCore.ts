// The portable middle of a held pull request checkout (M123, PLAN.md
// D104): what VS Code's checkout (src/host/git/heldCheckout.ts,
// src/host/git/pullRequestCheckout.ts) and the runtime's (src/runtime/panel/
// pullRequests/) both run, so every editor refuses the same listing and
// confirms the same words.
//
// - `BlobAnswers`: `git cat-file --batch`'s answers, in the order asked:
//   `<oid> blob <size>`, LF, the bytes and LF for each blob. Anything else
//   (a missing object, another size, a byte past the last answer) refuses
//   the checkout through the host's error.
// - `pullRequestCheckoutConfirmation`: what the confirmation says about
//   where the pull request goes and how it is held.
// - `heldDestination` and `namedHookOverrides`: where a path of the
//   commit may land, and the overrides that switch off every named hook.
//
// Pure: the hosts run git and write the files.

import { Buffer } from 'node:buffer'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { confineWorkspacePath, type RealPathIo } from '../workspacePath'
import type { PullRequest } from './github'
import { foldName, type HeldEntry } from './heldTree'

const LINE_FEED = 0x0a

/** `<oid> blob <size>`, LF: one answer's head, for the bytes that follow. */
export function blobHeaderOf(entry: Pick<HeldEntry, 'oid' | 'size'>): Buffer {
  return Buffer.from(`${entry.oid} blob ${String(entry.size)}\n`)
}

/**
 * `git cat-file --batch`'s answers, in the order asked. Every answer a
 * chunk completes is written before git goes on; a missing object, another
 * size, a byte past the last answer, or anything left over refuses through
 * `unreadable` (the host's error, whose words the user reads).
 */
export class BlobAnswers {
  private chunks: Buffer[] = []
  private length = 0
  private next = 0

  public constructor(
    private readonly blobs: readonly HeldEntry[],
    private readonly write: (entry: HeldEntry, bytes: Buffer) => Promise<void>,
    private readonly unreadable: () => Error,
  ) {}

  /** One chunk of stdout: every answer it completes is written before git goes on. */
  public async take(chunk: Buffer): Promise<void> {
    this.chunks.push(chunk)
    this.length += chunk.length
    const waiting = this.blobs[this.next]
    if (waiting === undefined) {
      throw this.unreadable()
    }
    if (this.length <= blobHeaderOf(waiting).length + waiting.size) {
      return
    }
    const answers = Buffer.concat(this.chunks, this.length)
    let offset = 0
    for (let blob = this.blobs[this.next]; blob !== undefined; blob = this.blobs[this.next]) {
      const header = blobHeaderOf(blob)
      const end = offset + header.length + blob.size
      if (answers.length <= end) {
        break
      }
      if (
        !answers.subarray(offset, offset + header.length).equals(header) ||
        answers[end] !== LINE_FEED
      ) {
        throw this.unreadable()
      }
      await this.write(blob, answers.subarray(offset + header.length, end))
      offset = end + 1
      this.next += 1
    }
    const rest = answers.subarray(offset)
    this.chunks = rest.length === 0 ? [] : [rest]
    this.length = rest.length
    if (this.next === this.blobs.length && this.length > 0) {
      throw this.unreadable()
    }
  }

  /** Every blob was answered, and nothing more came. */
  public finish(): void {
    if (this.next !== this.blobs.length || this.length !== 0) {
      throw this.unreadable()
    }
  }
}

/** What the confirmation says about where the pull request goes and how it is held. */
export function pullRequestCheckoutConfirmation(pullRequest: PullRequest, isOwn: boolean): string {
  const from =
    pullRequest.headRepository === undefined
      ? pullRequest.headRef
      : `${pullRequest.headRepository}:${pullRequest.headRef}`
  return [
    pullRequest.title,
    fill(UI_TEXT.openPullRequestBy, { author: pullRequest.author.login }),
    fill(UI_TEXT.openPullRequestBranches, { head: from, base: pullRequest.baseRef }),
    isOwn ? UI_TEXT.openPullRequestOwnDetail : UI_TEXT.openPullRequestHeldDetail,
    ...(isOwn ? [] : [UI_TEXT.openPullRequestUnfilteredDetail]),
    UI_TEXT.gitCommandConsequences,
  ].join('\n')
}

/**
 * Where a path of the commit lands: inside the worktree, with nothing on the
 * way that leads elsewhere. Every folder on the way was made by this
 * checkout with the commit's spelling, so any other canonical spelling is a
 * link, a junction or a name the volume reads as another (a short name).
 * Undefined then; each host refuses with `unsafePathReason`.
 */
export async function heldDestination(
  platform: NodeJS.Platform,
  folder: string,
  entryPath: string,
  io: RealPathIo,
) {
  const resolution = await confineWorkspacePath(folder, entryPath, platform, io)
  return resolution.ok &&
    foldName(resolution.canonical, platform) === foldName(resolution.relative, platform)
    ? resolution
    : undefined
}

const HOOK_KEY = /^hook\.(.+)\.(?:command|event|enabled)$/iu

/**
 * `fixed`, then every named hook `configuration` (`git config --null
 * --name-only --list`) defines switched off: new Git configures named hooks
 * independently of core.hooksPath. Undefined when a name cannot be spelled
 * as a per-command override (`-c` splits at its first '='): never guess an
 * escape; the host refuses the checkout.
 */
export function namedHookOverrides(
  configuration: string,
  fixed: readonly string[],
): readonly string[] | undefined {
  const hooks = new Set(
    configuration.split('\0').flatMap((name) => {
      const hook = HOOK_KEY.exec(name)?.[1]
      return hook === undefined ? [] : [hook]
    }),
  )
  if ([...hooks].some((name) => name.includes('=') || /\p{Cc}/u.test(name))) {
    return undefined
  }
  return [
    ...fixed,
    ...[...hooks].flatMap((hook) => [
      '-c',
      `hook.${hook}.enabled=false`,
      '-c',
      `hook.${hook}.event=`,
    ]),
  ]
}
