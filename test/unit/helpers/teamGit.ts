// Real-git helpers for M96 lane I tests: disposable repositories under the
// OS temp directory (never under the checkout), a binary-safe git runner
// that surfaces exit codes as `TeamGitError`, and fixture programs owned
// here, never inherited from a developer's global git configuration.

import { execFile } from 'node:child_process'
import { appendFile, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { cpSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { TeamGitError, type TeamGit } from '../../../src/core/team/teamWorkspaces'

const roots: string[] = []

/** Fixture programs/configuration are owned here, never inherited. */
export const teamGitEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
}

export function trackTeamRoot(root: string): void {
  roots.push(root)
}

export function cleanupTeamRoots(): void {
  beforeAll(async () => {
    seed.value ??= createSeedRepo()
    await seed.value
  })
  let firstTestRoot = 0
  beforeEach(() => {
    firstTestRoot = roots.length
  })
  afterAll(async () => {
    for (const root of roots.splice(0)) {
      await rm(root, { recursive: true, force: true })
    }
    if (seed.value === undefined) {
      return
    }
    const template = await seed.value
    await rm(template.root, { recursive: true, force: true })
  })
  afterEach(async () => {
    for (const root of roots.splice(firstTestRoot)) {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
    }
  })
}

/** Binary-safe `git`: stdout as bytes, non-zero exits as `TeamGitError`. */
/** execFile's exit code, or 1 when it ended without one. */
function exitCodeOf(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = Number(error.code)
    if (Number.isSafeInteger(code)) {
      return code
    }
  }
  return 1
}

/** Git's batch stream is length-framed, including binary blobs and tree objects. */
export function fixtureBlobs(bytes: Uint8Array): Map<string, Uint8Array> {
  const output = Buffer.from(bytes)
  const blobs = new Map<string, Uint8Array>()
  let offset = 0
  while (offset < output.length) {
    const newline = output.indexOf(0x0a, offset)
    const [sha, type, length] = output.subarray(offset, newline).toString('ascii').split(' ', 3)
    const size = Number(length)
    const end = newline + 1 + size
    if (
      sha === undefined ||
      size < 0 ||
      newline < offset ||
      !Number.isSafeInteger(size) ||
      output[end] !== 0x0a
    ) {
      throw new TeamGitError(1, 'Invalid fixture object batch', 'cat-file')
    }
    if (type === 'blob') {
      blobs.set(sha, new Uint8Array(output.subarray(newline + 1, end)))
    }
    offset = end + 1
  }
  return blobs
}

/** Binary-safe `git`: stdout as bytes, non-zero exits as `TeamGitError`. */
export function teamGitRunner(env: NodeJS.ProcessEnv = teamGitEnv): TeamGit {
  // Repeated reads of immutable object IDs still come from real Git. Keep
  // their bytes so preview + derivation do not respawn identical Git reads.
  const objects = new Map<string, Promise<Uint8Array>>()
  const batches = new Map<string, Promise<Map<string, Uint8Array>>>()
  const runGit: TeamGit = async (args, cwd, input, isolatedEnv) => {
    const isImmutable =
      (args[0] === 'ls-tree' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(args[2] ?? '')) ||
      (args[0] === 'cat-file' &&
        args[1] === 'blob' &&
        /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(args[2] ?? ''))
    const key = JSON.stringify([cwd, args])
    const cached = isImmutable ? objects.get(key) : undefined
    if (cached !== undefined) {
      return new Uint8Array(await cached)
    }
    if (isImmutable && args[0] === 'cat-file' && args[1] === 'blob') {
      let batch = batches.get(cwd)
      if (batch === undefined) {
        batch = (async () =>
          fixtureBlobs(
            await runGit(
              ['cat-file', '--batch-all-objects', '--batch'],
              cwd,
              undefined,
              isolatedEnv,
            ),
          ))()
        batches.set(cwd, batch)
        void batch.catch(() => batches.delete(cwd))
      }
      const collected = await batch
      const blob = collected.get(args[2] ?? '')
      if (blob !== undefined) {
        return new Uint8Array(blob)
      }
      // Objects written after this fixture snapshot still come from live Git.
    }
    const result = new Promise<Uint8Array>((resolve, reject) => {
      const child = execFile(
        'git',
        [...args],
        {
          cwd,
          env: isolatedEnv ?? env,
          timeout: 30_000,
          maxBuffer: 64 * 1024 * 1024,
          encoding: 'buffer',
        },
        (error, stdout, stderr) => {
          if (error !== null) {
            reject(
              new TeamGitError(
                exitCodeOf(error),
                Buffer.from(stderr).toString('utf8'),
                args[0] ?? 'git',
              ),
            )
            return
          }
          resolve(new Uint8Array(stdout))
        },
      )
      if (input !== undefined) {
        child.stdin?.write(input)
      }
      child.stdin?.end()
    })
    if (isImmutable) {
      objects.set(key, result)
      void result.catch(() => objects.delete(key))
    }
    return await result
  }
  return runGit
}

export interface TeamFixtureRepo {
  readonly root: string
  readonly head: string
}

/** Import a fixture tree and its commit in one real Git process; no checkout/filter. */
export async function teamFixtureCommit(
  runGit: TeamGit,
  root: string,
  parent: string | undefined,
  files: Readonly<Record<string, string | undefined>>,
  ref = 'refs/heads/agents/engineering/t1',
): Promise<string> {
  const commands = [
    `commit ${ref}`,
    'mark :1',
    'committer Offline test <offline@example.invalid> 1700000000 +0000',
    'data 7',
    'fixture',
    ...(parent === undefined ? [] : [`from ${parent}`]),
  ]
  for (const [name, content] of Object.entries(files)) {
    commands.push(
      ...(content === undefined
        ? [`D ${JSON.stringify(name)}`]
        : [
            `M 100644 inline ${JSON.stringify(name)}`,
            `data ${String(Buffer.byteLength(content))}`,
            content,
          ]),
    )
  }
  commands.push('', 'get-mark :1', 'done', '')
  return Buffer.from(await runGit(['fast-import', '--quiet'], root, commands.join('\n')))
    .toString('utf8')
    .trim()
}

/** A repository with one commit (`tracked.txt`, `shared.txt`), branch `main`. */
async function createSeedRepo(): Promise<TeamFixtureRepo> {
  const runGit = teamGitRunner()
  const root = await mkdtemp(path.join(tmpdir(), 'muse-team-seed-'))
  await runGit(['init', '--template=', '-b', 'main'], root)
  await mkdir(path.join(root, '.git', 'hooks'))
  await mkdir(path.join(root, '.git', 'info'))
  await appendFile(
    path.join(root, '.git', 'config'),
    '[user]\n  name = Offline test\n  email = offline@example.invalid\n',
  )
  const head = await teamFixtureCommit(
    runGit,
    root,
    undefined,
    {
      'tracked.txt': 'before\n',
      'shared.txt': 'one\ntwo\nthree\n',
    },
    'refs/heads/main',
  )
  await runGit(['read-tree', '--reset', '-u', 'main'], root)
  return { root, head }
}

const seed: { value?: Promise<TeamFixtureRepo> } = {}

export async function teamFixtureRepo(
  runGit: TeamGit,
  tracked = 'before\n',
  shared = 'one\ntwo\nthree\n',
): Promise<TeamFixtureRepo> {
  const requested = await mkdtemp(path.join(tmpdir(), 'muse-team-i-'))
  const temp = realpathSync.native(requested)
  trackTeamRoot(temp)
  const root = path.join(temp, 'app')
  seed.value ??= createSeedRepo()
  const template = await seed.value
  cpSync(template.root, root, { recursive: true })
  if (tracked === 'before\n' && shared === 'one\ntwo\nthree\n') {
    return { root, head: template.head }
  }
  const head = await teamFixtureCommit(
    runGit,
    root,
    template.head,
    {
      'tracked.txt': tracked,
      'shared.txt': shared,
    },
    'refs/heads/main',
  )
  await runGit(['read-tree', '--reset', '-u', 'main'], root)
  return { root, head }
}

export async function teamRealPath(candidate: string): Promise<string> {
  return await realpath(candidate)
}

export function teamWindowsPath(root: string, form: string): string {
  if (form === 'case') {
    return root.toUpperCase()
  }
  if (form === 'drive') {
    return root.replace(/^[a-z]:/i, (drive) => drive.toLowerCase())
  }
  if (form === 'namespace') {
    return path.toNamespacedPath(root)
  }
  throw new Error(`Unknown Windows path form: ${form}`)
}

/** Ask the local volume rather than inventing an 8.3 alias. */
export async function teamShortRoot(root: string): Promise<string | undefined> {
  const parent = path.dirname(root)
  const grandparent = path.dirname(parent)
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      'cmd.exe',
      ['/d', '/c', 'dir', '/x', '/ad', path.join(grandparent, `${path.basename(parent)}*`)],
      { env: teamGitEnv },
      (error, stdout) => {
        if (error === null) {
          resolve(stdout)
        } else {
          reject(new Error('Local 8.3 listing failed', { cause: error }))
        }
      },
    )
  })
  const row = output.split(/\r?\n/).find((line) => line.trimEnd().endsWith(path.basename(parent)))
  const shortName = row?.match(/<DIR>\s+(\S+)\s+\S+\s*$/)?.[1]
  return shortName === undefined
    ? undefined
    : path.join(grandparent, shortName, path.basename(root))
}
