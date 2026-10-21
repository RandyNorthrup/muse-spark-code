import * as z from 'zod/mini'
import path from 'node:path'
import {
  GIT_METADATA_OPTIONS,
  REPORT_GIT_MAX_COMMITS,
  REPORT_MAX_TEXT_CHARS,
  XCODE_STUB_GIT_EXIT_CODE,
} from '../../../shared/constants'
import {
  codeUnitCompare,
  localSource,
  LocalSourceError,
  sourceReason,
  type SourceScrub,
} from './local'
import type { GitFacts } from './types'

export interface ReportGitIo {
  run(args: readonly string[], signal: AbortSignal): Promise<{ stdout: string; code: number }>
}

/**
The resolved git is Apple's Xcode stub whose developer tools cannot start:
the file exists on PATH, but no git command can run. A boolean brand, not
`instanceof`: the report IO runs in the runtime bundle while this source
reads in the lazy inputs bundle, and each carries its own copy of this
class (as with LocalSourceError, C-M113-2).
*/
export class XcodeStubGitError extends Error {
  readonly isXcodeStubGitError = true
  public constructor() {
    super('xcode-stub-git')
    this.name = 'XcodeStubGitError'
  }
}

export function isXcodeStubGitError(value: unknown): value is XcodeStubGitError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'isXcodeStubGitError' in value &&
    value.isXcodeStubGitError === true
  )
}

/**
Whether a failed git call is the Xcode stub refusing to run: on a Mac, the
stub's exit code together with its xcodebuild/xcode-select complaint. The
recorded shape (2026-10-18, `/usr/bin/git --version` on a Mac whose
developer directory points at a missing Xcode): exit 71 with "couldn't
spawn '.../xcodebuild'", "unable to locate xcodebuild" and the
`xcode-select -switch` hint on stderr. A bare code match would misdiagnose
a genuine git failure, so the complaint is required.
*/
export function isXcodeStubGitFailure(
  platform: NodeJS.Platform,
  code: number | undefined,
  stderr: string,
): boolean {
  return (
    platform === 'darwin' &&
    code === XCODE_STUB_GIT_EXIT_CODE &&
    /xcode(?:build|-select)/iu.test(stderr)
  )
}
const shaSchema = z.string().check(z.regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u))
const atSchema = z.iso.datetime({ offset: true })
const textSchema = z.string().check(z.maxLength(REPORT_MAX_TEXT_CHARS))
function sha(value: string | undefined): string {
  return shaSchema.parse(value)
}
function at(value: string | undefined): string {
  return atSchema.parse(value)
}

function platformPath(base: string) {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/\/)/u.test(base) ? path.win32 : path.posix
}

export function gitSource(io: ReportGitIo, scrub: SourceScrub, roots: readonly string[] = []) {
  function displayWorktreePath(root: string, canonicalTop: string | undefined): string {
    const workspace = roots[0]
    if (workspace === undefined) return scrub(root.replaceAll('\\', '/'))
    const bases = [workspace]
    if (canonicalTop !== undefined && canonicalTop !== workspace) bases.push(canonicalTop)
    const shaped = platformPath
    for (const base of bases) {
      const p = shaped(base)
      const inside = p.relative(base, root)
      if (inside !== '..' && !inside.startsWith(`..${p.sep}`) && !p.isAbsolute(inside))
        return scrub((inside === '' ? '.' : inside).replaceAll('\\', '/'))
    }
    // Nearby paths (the parent itself, a sibling) stay relative; anything
    // past the grandparent, or absolute after resolving, stays absolute.
    const near = (base: string): string | undefined => {
      const p = shaped(base)
      const relative = p.relative(base, root)
      if (relative.startsWith(`..${p.sep}..${p.sep}`) || p.isAbsolute(relative)) return undefined
      return (relative === '' ? '.' : relative).replaceAll('\\', '/')
    }
    const home = roots[1]
    if (home !== undefined) {
      const p = shaped(workspace)
      const fromHome = p.relative(home, root)
      if (fromHome !== '..' && !fromHome.startsWith(`..${p.sep}`) && !p.isAbsolute(fromHome))
        return scrub(`~/${fromHome.replaceAll('\\', '/')}`)
    }
    for (const base of bases) {
      const relative = near(base)
      if (relative !== undefined) return scrub(relative)
    }
    return scrub(root.replaceAll('\\', '/'))
  }
  return localSource('git', async ({ signal, reportText }) => {
    const run = async (args: readonly string[]) => {
      signal.throwIfAborted()
      try {
        return await io.run([...GIT_METADATA_OPTIONS, ...args], signal)
      } catch (error) {
        // The stub diagnosis owns its wording: the record names the cause
        // and the fix instead of a raw exit code.
        if (isXcodeStubGitError(error))
          throw new LocalSourceError('failed', reportText.reportUi.gitXcodeStub)
        throw error
      }
    }
    const required = async (args: readonly string[]) => {
      const result = await run(args)
      if (result.code !== 0) throw new LocalSourceError('failed')
      return result.stdout
    }
    // Refuse an enclosing repository: a project without .git stays unavailable.
    const inside = await run(['rev-parse', '--show-prefix'])
    if (inside.code !== 0 || inside.stdout.trim() !== '') throw new LocalSourceError('missing')
    // Git reports canonical worktree paths while the workspace may arrive
    // through an alias (a symlinked temporary root, a mounted volume), so
    // its own toplevel joins the configured roots for display. A failure
    // here keeps the configured roots; it never fails the source.
    const top = await run(['rev-parse', '--show-toplevel'])
    const canonicalTop =
      top.code === 0 && top.stdout.trim() !== ''
        ? top.stdout.trim().replaceAll('\\', '/')
        : undefined
    const headText = await required(['rev-parse', '--verify', 'HEAD'])
    const head = sha(headText.trim())
    const refs = await required([
      'for-each-ref',
      `--count=${String(REPORT_GIT_MAX_COMMITS + 1)}`,
      '--format=%(refname)%00%(objectname)',
      'refs/heads/',
      'refs/remotes/',
    ])
    const rawBranches = refs
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, commit] = line.split('\0', 2)
        if (!name?.startsWith('refs/')) throw new LocalSourceError('invalid')
        return {
          ref: name,
          name: name.replace(/^refs\/(?:heads|remotes)\//u, ''),
          commit: sha(commit),
        }
      })
    const remoteHead = await run(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])
    const defaultRef =
      remoteHead.code === 0 && rawBranches.some((branch) => branch.ref === remoteHead.stdout.trim())
        ? remoteHead.stdout.trim()
        : (rawBranches.find((branch) => branch.ref === 'refs/heads/main')?.ref ??
          rawBranches.find((branch) => branch.ref === 'refs/heads/master')?.ref)
    const merged =
      defaultRef === undefined
        ? ''
        : await required([
            'for-each-ref',
            `--merged=${defaultRef}`,
            '--format=%(refname)',
            'refs/heads/',
            'refs/remotes/',
          ])
    const mergedRefs = new Set(merged.split('\n'))
    const branches = rawBranches.slice(0, REPORT_GIT_MAX_COMMITS).map((branch) => ({
      name: scrub(branch.name),
      commit: scrub(branch.commit),
      merged: mergedRefs.has(branch.ref),
    }))
    const log = await required([
      'log',
      `--max-count=${String(REPORT_GIT_MAX_COMMITS + 1)}`,
      '--format=%x00%H%x00%cI%x00%s',
      '--name-only',
      '-z',
      '--no-renames',
      '--diff-merges=first-parent',
      '--root',
      head,
      '--',
    ])
    const commits: GitFacts['commits'][number][] = []
    const fields = log.split('\0')
    let cursor = 0
    while (cursor < fields.length - 1) {
      if (fields[cursor] !== '') throw new LocalSourceError('invalid')
      cursor += 1
      const commit = fields[cursor++]
      const date = fields[cursor++]
      const subject = fields[cursor++]
      const names: string[] = []
      while (cursor < fields.length && fields[cursor] !== '') {
        names.push(fields[cursor] ?? '')
        cursor += 1
      }
      const files = names
        .join('\0')
        .replace(/^\n/u, '')
        .split('\0')
        .filter(Boolean)
        .map((file) => scrub(file.replaceAll('\\', '/')))
        .toSorted(codeUnitCompare)
      commits.push({
        sha: scrub(sha(commit)),
        at: scrub(at(date)),
        subject: scrub(textSchema.parse(subject)),
        files,
      })
    }
    const tagText = await required([
      'for-each-ref',
      `--count=${String(REPORT_GIT_MAX_COMMITS + 1)}`,
      '--format=%(refname:strip=2)%00%(objectname)%00%(*objectname)%00%(creatordate:iso-strict)',
      'refs/tags/',
    ])
    const tags = tagText
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const fields = line.split('\0')
        const [name, object, peeled, date] = fields
        if (fields.length > 2 + 2) throw new LocalSourceError('invalid')
        return {
          name: scrub(textSchema.parse(name)),
          commit: scrub(sha(peeled === '' ? object : peeled)),
          at: scrub(at(date)),
        }
      })
    const treeText = await required(['worktree', 'list', '--porcelain', '-z'])
    const worktrees: GitFacts['worktrees'][number][] = []
    for (const block of treeText.split('\0\0')) {
      if (block === '') continue
      const fields = block.split('\0')
      if (fields.includes('bare')) continue
      const root = fields.find((field) => field.startsWith('worktree '))?.slice('worktree '.length)
      if (root === undefined) throw new LocalSourceError('invalid')
      const commit = fields.find((field) => field.startsWith('HEAD '))?.slice('HEAD '.length)
      const branch =
        fields.find((field) => field.startsWith('branch '))?.slice('branch refs/heads/'.length) ??
        ''
      worktrees.push({
        path: displayWorktreePath(root, canonicalTop),
        branch: scrub(branch),
        commit: scrub(sha(commit)),
      })
    }
    const isBounded =
      commits.length > REPORT_GIT_MAX_COMMITS ||
      tags.length > REPORT_GIT_MAX_COMMITS ||
      rawBranches.length > REPORT_GIT_MAX_COMMITS ||
      worktrees.length > REPORT_GIT_MAX_COMMITS
    return {
      data: {
        head: scrub(head),
        defaultBranch: scrub(defaultRef?.replace(/^refs\/(?:heads|remotes)\//u, '') ?? ''),
        commits: commits
          .slice(0, REPORT_GIT_MAX_COMMITS)
          .toSorted(
            (a, b) =>
              codeUnitCompare(a.sha, b.sha) ||
              codeUnitCompare(JSON.stringify(a), JSON.stringify(b)),
          ),
        tags: tags
          .slice(0, REPORT_GIT_MAX_COMMITS)
          .toSorted(
            (a, b) =>
              codeUnitCompare(a.name, b.name) ||
              codeUnitCompare(JSON.stringify(a), JSON.stringify(b)),
          ),
        branches: branches.toSorted(
          (a, b) =>
            codeUnitCompare(a.name, b.name) ||
            codeUnitCompare(JSON.stringify(a), JSON.stringify(b)),
        ),
        worktrees: worktrees
          .slice(0, REPORT_GIT_MAX_COMMITS)
          .toSorted(
            (a, b) =>
              codeUnitCompare(a.path, b.path) ||
              codeUnitCompare(JSON.stringify(a), JSON.stringify(b)),
          ),
      },
      ...((isBounded || defaultRef === undefined) && {
        partial: sourceReason(isBounded ? 'limit' : 'unbound', reportText),
      }),
    }
  })
}
