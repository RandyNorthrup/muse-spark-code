// M125 lane F2: the owner's baseline over real git repositories —
// attribution, establishment and closure comparison, with the git
// reads answered by the real command line and file answers by the
// real object store or filesystem.
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import {
  B2Baselines,
  b2CheckKey,
  compareB2Closures,
  isClosureClean,
  type B2GitReads,
} from '../../src/core/judge/fast/baseline'
import {
  collectB2Closure,
  parseB2Command,
  parseB2PackageJson,
  type B2DefinitionClosure,
  type B2FileAnswers,
} from '../../src/core/judge/fast/b2Closure'

function gitEnv(): Record<string, string | undefined> {
  return { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull }
}

function git(repo: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: gitEnv() })
}

function gitBytes(repo: string, args: readonly string[]): Uint8Array | undefined {
  try {
    return execFileSync('git', ['-C', repo, ...args], {
      encoding: 'buffer',
      maxBuffer: 16 * 1024 * 1024,
      env: gitEnv(),
    })
  } catch {
    return undefined
  }
}

const reads: B2GitReads = {
  readHead: (repo) => {
    try {
      return Promise.resolve(git(repo, ['rev-parse', 'HEAD']).trim())
    } catch {
      return Promise.resolve(undefined)
    }
  },
  readBlob: (repo, rev, name) =>
    Promise.resolve(gitBytes(repo, ['cat-file', '-p', `${rev}:${name}`])),
  uncommittedPaths: (repo) => {
    try {
      const out = git(repo, [
        '-c',
        'core.quotePath=false',
        'status',
        '--porcelain=v1',
        '-uall',
        '--no-renames',
      ])
      return Promise.resolve(
        out
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => line.slice(3)),
      )
    } catch {
      return Promise.resolve(undefined)
    }
  },
}

/** File answers over one revision's blobs, through `ls-tree` and `cat-file`. */
function blobAnswers(repo: string, rev: string): B2FileAnswers {
  const kindOf = (relative: string): 'file' | 'link' | 'other' => {
    try {
      const out = git(repo, ['ls-tree', rev, '--', relative])
      if (out.startsWith('120000')) return 'link'
      return out.startsWith('100') ? 'file' : 'other'
    } catch {
      return 'other'
    }
  }
  return {
    statEntry: kindOf,
    readEntryBytes: (relative) => {
      return kindOf(relative) === 'file'
        ? gitBytes(repo, ['cat-file', '-p', `${rev}:${relative}`])
        : undefined
    },
    readEntryLink: (relative) => {
      if (kindOf(relative) !== 'link') return undefined
      const bytes = gitBytes(repo, ['cat-file', '-p', `${rev}:${relative}`])
      return bytes === undefined ? undefined : Buffer.from(bytes).toString('utf8')
    },
  }
}

/** File answers over the live filesystem, never following links. */
function liveAnswers(root: string): B2FileAnswers {
  const kindOf = (relative: string): 'file' | 'link' | 'other' => {
    try {
      const stat = lstatSync(path.join(root, relative))
      if (stat.isSymbolicLink()) return 'link'
      return stat.isFile() ? 'file' : 'other'
    } catch {
      return 'other'
    }
  }
  return {
    statEntry: kindOf,
    readEntryBytes: (relative) => {
      if (kindOf(relative) !== 'file') return undefined
      try {
        return readFileSync(path.join(root, relative))
      } catch {
        return undefined
      }
    },
    readEntryLink: (relative) => {
      if (kindOf(relative) !== 'link') return undefined
      try {
        return readlinkSync(path.join(root, relative))
      } catch {
        return undefined
      }
    },
  }
}

async function initRepo(files: Readonly<Record<string, string>>): Promise<string> {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'b2-baseline-'))
  git(repo, ['init', '-b', 'main'])
  git(repo, ['config', 'user.email', 'b2-drill@example.invalid'])
  git(repo, ['config', 'user.name', 'B2 Drill'])
  git(repo, ['config', 'commit.gpgsign', 'false'])
  git(repo, ['config', 'core.autocrlf', 'false'])
  git(repo, ['config', 'core.eol', 'lf'])
  for (const [name, body] of Object.entries(files)) {
    await writeFile(path.join(repo, name), body)
  }
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-m', 'owner version', '--no-gpg-sign'])
  return repo
}

function commitAll(repo: string, message: string): void {
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-m', message, '--no-gpg-sign'])
}

const MANIFEST = JSON.stringify({ scripts: { test: 'vitest --config vitest.config.ts' } })

async function closureAt(repo: string, rev: string): Promise<B2DefinitionClosure> {
  const command = parseB2Command('npm test')
  if (!command.ok) throw new Error('the drill command must parse')
  const manifestBytes =
    rev === 'live'
      ? await readFile(path.join(repo, 'package.json'))
      : await reads.readBlob(repo, rev, 'package.json')
  if (manifestBytes === undefined) throw new Error('the drill manifest must read')
  const packageJson = parseB2PackageJson(Buffer.from(manifestBytes).toString('utf8'))
  if (!packageJson.ok) throw new Error('the drill manifest must parse')
  const collected = collectB2Closure(
    command.command,
    packageJson.packageJson,
    { yarnLock: false, yarnrc: false, yarnrcYml: false, pnpmfile: false },
    [],
    rev === 'live' ? liveAnswers(repo) : blobAnswers(repo, rev),
  )
  if (!collected.ok) throw new Error('the drill closure must collect')
  return collected.closure
}

function manifestOf(scripts: Readonly<Record<string, string>>): string {
  return JSON.stringify({ scripts })
}

function encodeBody(body: string): Uint8Array {
  return new TextEncoder().encode(body)
}

describe('B2 baseline attribution', () => {
  it('establishes on a clean first turn and keeps the baseline', async () => {
    const repo = await initRepo({ 'package.json': MANIFEST, 'vitest.config.ts': 'config\n' })
    const stores = new B2Baselines()
    const key = b2CheckKey('npm', 'test')
    const head = await reads.readHead(repo)
    const uncommitted = await reads.uncommittedPaths(repo)
    expect(uncommitted).toEqual([])
    expect(
      stores.establish(
        key,
        head,
        isClosureClean(['package.json', 'vitest.config.ts'], uncommitted),
      ),
    ).toBe('established')
    expect(stores.get(key)).toBe(head)
    expect(stores.establish(key, head, false)).toBe('present')
  })

  it('refuses a dirty first turn and a missing repository', async () => {
    const repo = await initRepo({ 'package.json': MANIFEST })
    const stores = new B2Baselines()
    const key = b2CheckKey('npm', 'test')
    await writeFile(
      path.join(repo, 'package.json'),
      JSON.stringify({ scripts: { test: 'changed' } }),
    )
    const head = await reads.readHead(repo)
    const uncommitted = await reads.uncommittedPaths(repo)
    expect(uncommitted).toContain('package.json')
    expect(stores.establish(key, head, isClosureClean(['package.json'], uncommitted))).toBe('dirty')
    expect(stores.get(key)).toBeUndefined()
    const bare = await mkdtemp(path.join(os.tmpdir(), 'b2-norepo-'))
    expect(await reads.readHead(bare)).toBeUndefined()
    expect(stores.establish(b2CheckKey('npm', 'lint'), undefined, true)).toBe('noHead')
  })

  it("advances on the owner's moves and never the agent's", async () => {
    const repo = await initRepo({ 'package.json': MANIFEST })
    const stores = new B2Baselines()
    const key = b2CheckKey('npm', 'test')
    const first = await reads.readHead(repo)
    expect(stores.establish(key, first, true)).toBe('established')
    await writeFile(path.join(repo, 'notes.txt'), 'owner note\n')
    commitAll(repo, 'owner move')
    const second = await reads.readHead(repo)
    stores.noteHeadMove(second, false)
    expect(stores.get(key)).toBe(second)
    await writeFile(path.join(repo, 'agent.txt'), 'agent move\n')
    commitAll(repo, 'agent move')
    const third = await reads.readHead(repo)
    stores.noteHeadMove(third, true)
    expect(stores.get(key)).toBe(second)
    expect(third).not.toBe(second)
  })
})

describe('B2 closure comparison', () => {
  it('matches the live tree to its own commit', async () => {
    const repo = await initRepo({ 'package.json': MANIFEST, 'vitest.config.ts': 'config\n' })
    const head = await reads.readHead(repo)
    if (head === undefined) throw new Error('the drill repository must have a HEAD')
    const baseline = await closureAt(repo, head)
    const current = await closureAt(repo, 'live')
    expect(compareB2Closures(current, baseline)).toEqual({ equal: true })
  })

  it("catches the agent's committed closure change", async () => {
    const repo = await initRepo({ 'package.json': MANIFEST, 'vitest.config.ts': 'config\n' })
    const stores = new B2Baselines()
    const key = b2CheckKey('npm', 'test')
    const head = await reads.readHead(repo)
    expect(stores.establish(key, head, true)).toBe('established')
    const baseline = await closureAt(repo, stores.get(key) ?? '')
    await writeFile(path.join(repo, 'vitest.config.ts'), 'agent config\n')
    commitAll(repo, 'agent change')
    stores.noteHeadMove(await reads.readHead(repo), true)
    expect(stores.get(key)).toBe(head)
    const current = await closureAt(repo, 'live')
    expect(compareB2Closures(current, baseline)).toEqual({
      equal: false,
      at: 'vitest.config.ts',
    })
  })

  it('names a changed script, field and reached set', async () => {
    const repo = await initRepo({ 'package.json': MANIFEST, 'vitest.config.ts': 'config\n' })
    const head = await reads.readHead(repo)
    if (head === undefined) throw new Error('the drill repository must have a HEAD')
    const baseline = await closureAt(repo, head)
    await writeFile(
      path.join(repo, 'package.json'),
      JSON.stringify({
        scripts: { test: 'vitest --config vitest.config.ts', lint: 'eslint .' },
        packageManager: 'npm@11.0.0',
      }),
    )
    const current = await closureAt(repo, 'live')
    const verdict = compareB2Closures(current, baseline)
    expect(verdict).toEqual({ equal: false, at: 'package.json fields' })
    await writeFile(
      path.join(repo, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .' } }),
    )
    const rescripted = await closureAt(repo, 'live')
    expect(compareB2Closures(rescripted, baseline)).toEqual({
      equal: false,
      at: 'script test',
    })
  })

  it('names set, config, file and link differences', () => {
    const command = parseB2Command('npm test')
    if (!command.ok) throw new Error('the drill command must parse')
    const collect = (
      scripts: Readonly<Record<string, string>>,
      files: Readonly<Record<string, string>>,
      configs: readonly { readonly source: string; readonly body: string }[] = [],
      links: Readonly<Record<string, string>> = {},
    ): B2DefinitionClosure => {
      const packageJson = parseB2PackageJson(manifestOf(scripts))
      if (!packageJson.ok) throw new Error('the drill manifest must parse')
      const collected = collectB2Closure(
        command.command,
        packageJson.packageJson,
        { yarnLock: false, yarnrc: false, yarnrcYml: false, pnpmfile: false },
        configs.map((config) => ({
          source: config.source,
          keys: [],
          bytes: encodeBody(config.body),
        })),
        {
          statEntry: (relative) => {
            if (files[relative] !== undefined) return 'file'
            return links[relative] === undefined ? 'other' : 'link'
          },
          readEntryBytes: (relative) => {
            const body = files[relative]
            return body === undefined ? undefined : encodeBody(body)
          },
          readEntryLink: (relative) => links[relative],
        },
      )
      if (!collected.ok) throw new Error('the drill closure must collect')
      return collected.closure
    }
    const nested = collect({ test: 'npm run unit', unit: 'vitest x.js' }, { 'x.js': 'x' })
    const flat = collect({ test: 'vitest x.js' }, { 'x.js': 'x' })
    expect(compareB2Closures(nested, flat)).toEqual({ equal: false, at: 'script unit' })
    const changed = collect({ test: 'vitest x.js' }, { 'x.js': 'y' })
    expect(compareB2Closures(changed, flat)).toEqual({ equal: false, at: 'x.js' })
    const wide = collect({ test: 'vitest x.js y.js' }, { 'x.js': 'x' })
    const added = collect({ test: 'vitest x.js y.js' }, { 'x.js': 'x', 'y.js': 'y' })
    expect(compareB2Closures(added, wide)).toEqual({ equal: false, at: 'y.js' })
    const configured = collect({ test: 'vitest' }, {}, [{ source: '.npmrc', body: 'a=1\n' }])
    const reconfigured = collect({ test: 'vitest' }, {}, [{ source: '.npmrc', body: 'a=2\n' }])
    expect(compareB2Closures(reconfigured, configured)).toEqual({
      equal: false,
      at: 'config .npmrc',
    })
    const linked = collect({ test: 'vitest current' }, {}, [], { current: 'v1' })
    const relinked = collect({ test: 'vitest current' }, {}, [], { current: 'v2' })
    expect(compareB2Closures(relinked, linked)).toEqual({ equal: false, at: 'current' })
  })
})
