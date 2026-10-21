// M101 R7: the frozen digest must not move with the dependency layout.
// Round 6 canonicalised line endings, separators and order, yet the lead's
// nested worktree still computed another digest: exactly one frozen
// component differed, the search worker text, whose esbuild `// <path>`
// module comments spelled the dependencies folder relative to that
// checkout (`// ../../../node_modules/…` there, `// node_modules/…`
// here). The freeze therefore builds the worker with whitespace
// minification (no path comments; identifiers and syntax untouched), and
// this file proves the real case: the same sources frozen from the root
// and from three levels below a folder holding node_modules hash to one
// digest, the frozen worker text names no dependency folder, and the
// frozen bytes still run the search.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GLOB_LIMITS } from '../../../src/core/backends/modelapi/globLimits'
import { evalHarnessDigest, freezeEvalHarness } from '../../../src/core/eval/mechanisms'
import { searchOnWorker } from '../../../src/host/backend/toolIo'
import { removeFolder } from '../helpers/temporaryFolders'
import {
  SEARCH_HIT_MAX_CHARS,
  SEARCH_MAX_FILE_BYTES,
  SEARCH_MAX_HITS,
} from '../../../src/shared/constants'

const DIGEST_PATTERN = /^[a-f0-9]{64}$/

const layout: {
  here?: ReturnType<typeof freezeEvalHarness>
  nestedDigest?: string
  stage?: string
} = {}

function repoRoot(): string {
  return process.cwd()
}

function trackedFiles(repo: string): string[] {
  // `git ls-files -z` separates entries with a NUL byte; split on the
  // character itself so no escape spelling is needed.
  return execFileSync('git', ['-C', repo, 'ls-files', '-z'], { encoding: 'utf8' })
    .split(String.fromCodePoint(0))
    .filter((file) => file !== '')
}

function gitNested(nested: string, args: readonly string[]): void {
  execFileSync('git', ['-C', nested, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: path.join(nested, 'no-global-gitconfig'),
      GIT_CONFIG_SYSTEM: path.join(nested, 'no-system-gitconfig'),
    },
  })
}

// Copy exactly the digest-relevant sources: every tracked file under
// `src/` (the family walk covers the whole committed family) plus the
// frozen source list's non-`src` entries (configs, scripts, tests, the
// lockfile, the native helpers). Untracked scratch stays out of both
// trees, so it cannot move either digest (proved in evalFrozen.test.ts);
// anything the freeze reads is present, so an under-copy fails loudly
// instead of passing quietly.
function copyTrackedSources(repo: string, nested: string, sources: readonly string[]): void {
  const keep = new Set(
    trackedFiles(repo)
      .map((file) => file.replaceAll('\\', '/'))
      .filter((file) => file === 'src' || file.startsWith('src/') || sources.includes(file)),
  )
  const keepDir = new Set<string>()
  for (const file of keep) {
    let dir = file.split('/').slice(0, -1).join('/')
    while (dir !== '' && !keepDir.has(dir)) {
      keepDir.add(dir)
      dir = dir.split('/').slice(0, -1).join('/')
    }
  }
  cpSync(repo, nested, {
    recursive: true,
    filter: (entry) => {
      const relative = path.relative(repo, entry).replaceAll('\\', '/')
      if (relative === '') return true
      // The install, the VCS metadata and the build output travel
      // separately (the dependency link below) or not at all.
      const top = relative.split('/', 1)[0] ?? ''
      if (['node_modules', '.git', 'dist'].includes(top)) return false
      return statSync(entry).isDirectory() ? keepDir.has(relative) : keep.has(relative)
    },
  })
}

// The nested freeze genuinely rebuilds the whole harness in a child
// process, so this setup carries a named timeout.
beforeAll(async () => {
  const repo = repoRoot()
  const here = freezeEvalHarness()
  layout.here = here
  const stage = mkdtempSync(path.join(tmpdir(), 'm101-freeze-layout-'))
  try {
    // The lead's layout: repository files three levels below a folder
    // that holds node_modules, as a Git worktree nested under the main
    // checkout resolving its dependencies from the parent.
    const nested = path.join(stage, 'x', 'y', 'z', 'wt')
    copyTrackedSources(repo, nested, here.sources)
    // A junction needs no privilege on Windows; elsewhere it is a symlink.
    symlinkSync(path.join(repo, 'node_modules'), path.join(stage, 'node_modules'), 'junction')
    gitNested(nested, ['init', '-q'])
    gitNested(nested, ['add', '-A'])
    gitNested(nested, [
      '-c',
      'user.email=m101-freeze-layout@test',
      '-c',
      'user.name=m101-freeze-layout',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'm101 freeze layout sources',
    ])
    const printed = execFileSync(
      process.execPath,
      [path.join(nested, 'scripts', 'm101-e.mjs'), '--freeze'],
      {
        cwd: nested,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      },
    ).trim()
    if (!DIGEST_PATTERN.test(printed)) throw new Error('the nested freeze printed no digest')
    layout.nestedDigest = printed
    layout.stage = stage
  } catch (error) {
    await removeFolder(stage)
    throw error
  }
}, 180_000)

// Removing ~1,700 files on a busy shared rig genuinely takes longer
// than the default hook timeout, so the teardown carries a named one.
afterAll(async () => {
  if (layout.stage !== undefined) await removeFolder(layout.stage)
}, 120_000)

function frozenSnapshot(): ReturnType<typeof freezeEvalHarness> {
  if (layout.here === undefined) throw new Error('the layout setup did not run')
  return layout.here
}

describe('the layout-independent frozen harness', () => {
  it('freezes one digest from the root and from three levels below node_modules', () => {
    if (layout.nestedDigest === undefined) throw new Error('the layout setup did not run')
    expect(layout.nestedDigest).toBe(evalHarnessDigest(frozenSnapshot()))
  })

  it('freezes worker bytes that name no dependency folder', () => {
    const frozen = frozenSnapshot()
    expect(frozen.searchWorker.code).not.toContain('node_modules')
    expect(frozen.searchWorker.code).not.toContain('../')
    expect(createHash('sha256').update(frozen.searchWorker.code).digest('hex')).toBe(
      frozen.searchWorker.sha256,
    )
  })

  it('runs the search from the frozen worker bytes', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'm101-frozen-worker-'))
    try {
      const workerPath = path.join(root, 'searchWorker.js')
      writeFileSync(workerPath, frozenSnapshot().searchWorker.code)
      const haystack = path.join(root, 'a.txt')
      writeFileSync(haystack, 'alpha one\nbeta two\nalpha three\n')
      const outcome = await searchOnWorker(
        workerPath,
        {
          pattern: '^alpha',
          root,
          maxFileBytes: SEARCH_MAX_FILE_BYTES,
          maxHits: SEARCH_MAX_HITS,
          maxHitChars: SEARCH_HIT_MAX_CHARS,
          denyRead: [],
          globLimits: GLOB_LIMITS,
          files: [{ relative: 'a.txt', absolute: haystack }],
        },
        10_000,
      )
      expect(outcome).toEqual({
        ok: true,
        hits: [
          { file: 'a.txt', line: 1, text: 'alpha one' },
          { file: 'a.txt', line: 3, text: 'alpha three' },
        ],
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('keeps the arm bundles free of dependency-folder text', () => {
    for (const bundle of frozenSnapshot().bundles.values()) {
      expect(bundle.code).not.toContain('node_modules')
      expect(bundle.code).not.toContain('../')
    }
  })
})
