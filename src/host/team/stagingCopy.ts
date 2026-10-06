import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readlink, rm, rmdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  CHECKPOINT_STORAGE_MODE,
  GIT_METADATA_OPTIONS,
  GIT_TIMEOUT_MS,
  MCP_STDIO_ENV_ALLOWLIST,
  UI_TEXT,
} from '../../shared/constants'
import type { MergeVersion } from '../../core/team/mergeRoutine'
import { canonicalPath, isMissingPath } from '../canonicalPath'
import { isGitExitError, type GitProcess } from '../git'

export interface SnapshotBlob {
  readonly oid: string
  readonly mode: MergeVersion['mode']
}
export interface TeamSnapshot {
  readonly head: string
  readonly tree: string
  readonly commit: string
  readonly blobs: ReadonlyMap<string, SnapshotBlob>
}
export interface TeamCheckIdentity {
  readonly commands: readonly {
    readonly name: string
    readonly command: string
    readonly timeoutSeconds: number
  }[]
  readonly platform: string
  readonly setupCommand: string
  readonly cacheKey: string
}

/** Resolved checks and execution environment both invalidate an admission. */
export function checkIdentity(identity: TeamCheckIdentity): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        commands: identity.commands.map(({ name, command, timeoutSeconds }) => ({
          name,
          command,
          timeoutSeconds,
        })),
        platform: identity.platform,
        setupCommand: identity.setupCommand,
        cacheKey: identity.cacheKey,
      }),
    )
    .digest('hex')
}

const MERGE_FILE_ERROR_EXIT = 128
const EXECUTABLE_BITS = 0o111
const fileModeSchema = z.enum(['100644', '100755', '120000'])
const NO_PROGRAMS = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.attributesFile=/dev/null',
  '-c',
  'core.autocrlf=false',
  '-c',
  'credential.helper=',
]
const AUTHOR = ['-c', 'user.name=Muse Spark Code', '-c', 'user.email=team@muse-spark-code.invalid']
const NO_CONVERSION = '* -text -eol -filter -ident -working-tree-encoding -diff -merge\n'

/** Git plumbing only; lifecycle launchers supply the real process via injection. */
export class StagingCopy {
  private readonly env: NodeJS.ProcessEnv

  public constructor(
    private readonly git: GitProcess,
    environment: NodeJS.ProcessEnv,
    private readonly temporaryRoot: string,
  ) {
    // An explicit allowlist keeps credentials and inherited GIT_* out of every child.
    this.env = Object.fromEntries(
      Object.entries(environment).filter(([name]) =>
        MCP_STDIO_ENV_ALLOWLIST.some((allowed) => allowed.toLowerCase() === name.toLowerCase()),
      ),
    )
    this.env['GIT_CONFIG_NOSYSTEM'] = '1'
    this.env['GIT_CONFIG_GLOBAL'] = '/dev/null'
    this.env['GIT_TERMINAL_PROMPT'] = '0'
    this.env['GIT_OPTIONAL_LOCKS'] = '0'
  }

  private async run(
    root: string,
    args: readonly string[],
    input?: Uint8Array,
    index?: string,
  ): Promise<Buffer> {
    return await this.git([...GIT_METADATA_OPTIONS, ...NO_PROGRAMS, ...args], {
      cwd: root,
      env: index === undefined ? this.env : { ...this.env, GIT_INDEX_FILE: index },
      timeoutMs: GIT_TIMEOUT_MS,
      ...(input !== undefined && { input }),
    })
  }

  public async gitDirectory(root: string): Promise<string> {
    const output = await this.run(root, ['rev-parse', '--absolute-git-dir'])
    return output.toString('utf8').trim()
  }

  public async head(root: string): Promise<string> {
    const output = await this.run(root, ['rev-parse', '--verify', 'HEAD'])
    return output.toString('utf8').trim()
  }

  public async blob(root: string, bytes: Uint8Array): Promise<string> {
    // No --path: attributes, filters and line-ending conversion never see these bytes.
    const output = await this.run(root, ['hash-object', '-w', '--stdin'], bytes)
    return output.toString('utf8').trim()
  }

  public async readBlob(root: string, oid: string): Promise<Buffer> {
    if (!/^[a-f0-9]+$/u.test(oid)) throw new Error(UI_TEXT.checkpointFailed)
    return await this.run(root, ['cat-file', 'blob', oid])
  }

  /** Git's retained mode wins on filesystems where execute bits are not authoritative. */
  public async fileModes(
    root: string,
    head: string,
  ): Promise<{
    readonly modes: ReadonlyMap<string, MergeVersion['mode']>
    readonly usesFilesystemMode: boolean
  }> {
    const modes = new Map<string, MergeVersion['mode']>()
    // These queries only read metadata; retain every result and its precedence
    // without paying four serial process launches at each file guard.
    const [tree, index, difference, configured] = await Promise.all([
      this.run(root, ['ls-tree', '-r', '-z', head]),
      this.run(root, ['ls-files', '--stage', '-z']),
      this.run(root, ['diff-files', '--raw', '-z', '--no-ext-diff', '--no-textconv']),
      this.run(root, ['config', '--type=bool', '--default=false', '--get', 'core.filemode']),
    ])
    for (const entry of [
      ...tree.toString('utf8').split('\0'),
      ...index.toString('utf8').split('\0'),
    ]) {
      const tab = entry.indexOf('\t')
      if (tab === -1) continue
      const mode = fileModeSchema.safeParse(entry.slice(0, entry.indexOf(' ')))
      if (mode.success) modes.set(entry.slice(tab + 1), mode.data)
    }
    const entries = difference.toString('utf8').split('\0')
    for (const [offset, header] of entries.entries()) {
      if (!header.startsWith(':')) continue
      const file = entries[offset + 1]
      const mode = fileModeSchema.safeParse(header.split(' ', 2)[1])
      if (file !== undefined && mode.success) modes.set(file, mode.data)
    }
    return {
      modes,
      usesFilesystemMode:
        process.platform !== 'win32' && configured.toString('utf8').trim() === 'true',
    }
  }

  public regularFileMode(
    file: string,
    filesystemMode: number,
    retained: Awaited<ReturnType<StagingCopy['fileModes']>>,
  ): '100644' | '100755' {
    const gitMode = retained.modes.get(file)
    const observedMode = (filesystemMode & EXECUTABLE_BITS) === 0 ? '100644' : '100755'
    if (gitMode === '100644' || gitMode === '100755') {
      if (observedMode !== gitMode && retained.usesFilesystemMode)
        throw new Error(UI_TEXT.checkpointFailed)
      return gitMode
    }
    // Untracked files have no retained Git mode yet; POSIX supplies their first index entry.
    return retained.usesFilesystemMode ? observedMode : '100644'
  }

  /** The Git-visible whole tree: HEAD plus tracked edits/deletions and nonignored untracked files. */
  public async snapshot(root: string): Promise<TeamSnapshot> {
    const canonical = await canonicalPath(root)
    const head = await this.head(root)
    const retainedModes = await this.fileModes(root, head)
    await mkdir(this.temporaryRoot, { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
    const index = path.join(this.temporaryRoot, `${randomUUID()}.index`)
    const blobs = new Map<string, SnapshotBlob>()
    try {
      await this.run(root, ['read-tree', head], undefined, index)
      const listed = await this.run(root, [
        'ls-files',
        '-z',
        '--cached',
        '--others',
        '--exclude-standard',
      ])
      const base = await this.run(root, ['ls-tree', '-r', '--name-only', '-z', head])
      const names = new Set(
        [...listed.toString('utf8').split('\0'), ...base.toString('utf8').split('\0')].filter(
          (name) => name !== '',
        ),
      )
      const updates: string[] = []
      for (const name of names) {
        const target = path.resolve(root, name)
        const parent = await canonicalPath(path.dirname(target))
        const relative = path.relative(canonical, parent)
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
          throw new Error(UI_TEXT.checkpointFailed)
        let bytes: Buffer
        let mode: MergeVersion['mode']
        try {
          const info = await lstat(target)
          if (info.isSymbolicLink()) {
            bytes = Buffer.from(await readlink(target))
            mode = '120000'
          } else {
            if (!info.isFile()) throw new Error(UI_TEXT.checkpointFailed)
            bytes = await readFile(target)
            mode = this.regularFileMode(name, info.mode, retainedModes)
          }
        } catch (error: unknown) {
          if (!isMissingPath(error)) throw error
          updates.push(`0 ${'0'.repeat(head.length)}\t${name}\0`)
          continue
        }
        const oid = await this.blob(root, bytes)
        blobs.set(name, { oid, mode })
        updates.push(`${mode} ${oid}\t${name}\0`)
      }
      await this.run(
        root,
        ['update-index', '-z', '--index-info'],
        Buffer.from(updates.join('')),
        index,
      )
      const treeOutput = await this.run(root, ['write-tree'], undefined, index)
      const tree = treeOutput.toString('utf8').trim()
      const commitOutput = await this.run(root, [
        ...AUTHOR,
        'commit-tree',
        tree,
        '-p',
        head,
        '-m',
        'team snapshot',
      ])
      if ((await this.head(root)) !== head)
        throw new Error(UI_TEXT.teamTrafficNotices.snapshotChanged)
      const commit = commitOutput.toString('utf8').trim()
      return { head, tree, commit, blobs }
    } finally {
      await rm(index, { force: true })
      await rm(`${index}.lock`, { force: true })
    }
  }

  /** A no-remote shared clone with conversion disabled before any checkout. */
  public async clone(root: string, snapshot: TeamSnapshot, destination: string): Promise<void> {
    await this.run(root, [
      'clone',
      '--shared',
      '--no-checkout',
      '--template=',
      '--',
      root,
      destination,
    ])
    await this.run(destination, ['remote', 'remove', 'origin'])
    const info = path.join(await this.gitDirectory(destination), 'info')
    await mkdir(info, { recursive: true })
    await writeFile(path.join(info, 'attributes'), NO_CONVERSION)
    await this.run(destination, ['checkout', '--detach', snapshot.commit])
  }

  /** A known holder redirects here; update-ref uses Git's own ref lock. */
  public async landingBranch(
    root: string,
    snapshot: TeamSnapshot,
    id: string,
    source = root,
  ): Promise<string> {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(id)) throw new Error(UI_TEXT.checkpointFailed)
    const branch = `refs/heads/agents/landing/${id}`
    if (source !== root)
      await this.run(root, [
        'fetch',
        '--no-tags',
        '--no-write-fetch-head',
        '--',
        source,
        snapshot.commit,
      ])
    await this.run(root, [
      'update-ref',
      branch,
      snapshot.commit,
      '0'.repeat(snapshot.commit.length),
    ])
    return branch
  }

  /** Text merge runs outside the repository; no attribute, driver or hook runs. */
  public async mergeText(
    base: Buffer,
    ours: Buffer,
    theirs: Buffer,
  ): Promise<{ readonly bytes: Buffer; readonly conflicts: boolean }> {
    const folder = path.join(this.temporaryRoot, randomUUID())
    await mkdir(folder, { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
    const files = ['ours', 'base', 'theirs'].map((name) => path.join(folder, name))
    try {
      for (const [index, bytes] of [ours, base, theirs].entries())
        await writeFile(files[index] ?? '', bytes)
      let isConflicts = false
      try {
        await this.run(folder, ['merge-file', '-L', 'ours', '-L', 'base', '-L', 'theirs', ...files])
      } catch (error: unknown) {
        if (
          !isGitExitError(error) ||
          error.exitCode <= 0 ||
          error.exitCode >= MERGE_FILE_ERROR_EXIT
        )
          throw error
        isConflicts = true
      }
      return { bytes: await readFile(files[0] ?? ''), conflicts: isConflicts }
    } finally {
      for (const file of files) await rm(file, { force: true })
      await rmdir(folder)
    }
  }
}

/** Lane C formats merged JSON in staging, then validates both intents again. */
export async function formatStagedTables(
  files: readonly string[],
  deps: {
    readonly formatAfterEdit: (file: string) => Promise<void>
    readonly verifyIntents: (file: string, bytes: Buffer) => Promise<void>
  },
): Promise<void> {
  for (const file of files) {
    await deps.formatAfterEdit(file)
    await deps.verifyIntents(file, await readFile(file))
  }
}
