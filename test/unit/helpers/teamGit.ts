// Real-git helpers for M96 lane I tests: disposable repositories under the
// OS temp directory (never under the checkout), a binary-safe git runner
// that surfaces exit codes as `TeamGitError`, and fixture programs owned
// here, never inherited from a developer's global git configuration.

import { execFile } from 'node:child_process'
import { appendFile, mkdir, mkdtemp, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { copyFileSync, cpSync, linkSync, mkdirSync, readdirSync, realpathSync } from 'node:fs'
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

/** Hard-link immutable Git objects; copy all mutable repository and worktree files. */
export function copyTeamFixture(source: string, target: string, objectSource = source): void {
  const objects = path.join(source, '.git', 'objects')
  cpSync(source, target, { recursive: true, filter: (file) => file !== objects })
  const copyObjects = (from: string, to: string): void => {
    const entries = readdirSync(from, { withFileTypes: true })
    if (entries.length === 0) return
    mkdirSync(to, { recursive: true })
    for (const entry of entries) {
      const input = path.join(from, entry.name)
      const output = path.join(to, entry.name)
      if (entry.isDirectory()) copyObjects(input, output)
      else if (path.basename(from) === 'info') copyFileSync(input, output)
      else linkSync(input, output)
    }
  }
  copyObjects(path.join(objectSource, '.git', 'objects'), path.join(target, '.git', 'objects'))
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
  const runGit: TeamGit = async (args, cwd, input, isolatedEnv) => {
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
  modes: Readonly<Record<string, string>> = {},
): Promise<string> {
  const cached = preparedCommits.get(fixtureCommitKey(parent, files, modes))
  if (cached !== undefined) {
    const target = path.join(root, '.git', ref)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, cached + '\n')
    return cached
  }
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
            `M ${modes[name] ?? '100644'} inline ${JSON.stringify(name)}`,
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

const preparedCommits = new Map<string, string>()
const preparedCopies = new Map<string, string>()

/** Mutable files are copied; each test gets its own index, config and refs. */
export function copyPreparedTeamTask(head: string, folder: string): string | undefined {
  const template = preparedCopies.get(head)
  if (template === undefined) return undefined
  copyTeamFixture(template, folder, seed.objectSource ?? template)
  return folder
}

function fixtureCommitKey(
  parent: string | undefined,
  files: Readonly<Record<string, string | undefined>>,
  modes: Readonly<Record<string, string>> = {},
): string {
  return JSON.stringify([
    parent,
    Object.entries(files).toSorted(([left], [right]) => left.localeCompare(right)),
    Object.entries(modes).toSorted(([left], [right]) => left.localeCompare(right)),
  ])
}

/** Build real immutable task objects once; tests only copy them and write their own refs. */
export function prepareTeamFixtureCommits(
  changes: readonly {
    readonly files: Readonly<Record<string, string | undefined>>
    readonly parentFiles?: Readonly<Record<string, string | undefined>>
    readonly modes?: Readonly<Record<string, string>>
  }[],
): void {
  for (const { files, parentFiles, modes } of changes) {
    beforeAll(async () => {
      seed.value ??= createSeedRepo()
      const template = await seed.value
      const parent =
        parentFiles === undefined
          ? template.head
          : preparedCommits.get(fixtureCommitKey(template.head, parentFiles))
      if (parent === undefined) throw new Error('Fixture parent was not prepared')
      const key = fixtureCommitKey(parent, files, modes)
      if (preparedCommits.has(key)) return
      const head = await teamFixtureCommit(
        teamGitRunner(),
        template.root,
        parent,
        files,
        'refs/heads/prepared',
        modes,
      )
      preparedCommits.set(key, head)
      await unlink(path.join(template.root, '.git', 'refs', 'heads', 'prepared'))
      if (Object.values(modes ?? {}).includes('120000')) return
      const folder = await mkdtemp(path.join(tmpdir(), 'muse-team-task-seed-'))
      trackTeamRoot(folder)
      copyTeamFixture(template.root, folder)
      await writeFile(path.join(folder, '.git', 'HEAD'), head + '\n')
      await teamGitRunner()(['read-tree', '--reset', '-u', head], folder)
      preparedCopies.set(head, folder)
    })
  }
  beforeAll(async () => {
    seed.value ??= createSeedRepo()
    const template = await seed.value
    await teamGitRunner()(['repack', '-a', '-d'], template.root)
    seed.objectSource = template.root
  })
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

const seed: { value?: Promise<TeamFixtureRepo>; objectSource?: string } = {}

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
  if (tracked === 'before\n' && shared === 'one\ntwo\nthree\n') {
    copyTeamFixture(template.root, root)
    return { root, head: template.head }
  }
  const cached = preparedCommits.get(
    fixtureCommitKey(template.head, { 'tracked.txt': tracked, 'shared.txt': shared }),
  )
  const copy = cached === undefined ? undefined : preparedCopies.get(cached)
  if (cached !== undefined && copy !== undefined) {
    copyTeamFixture(copy, root, template.root)
    await writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    await writeFile(path.join(root, '.git', 'refs', 'heads', 'main'), cached + '\n')
    return { root, head: cached }
  }
  copyTeamFixture(template.root, root)
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
