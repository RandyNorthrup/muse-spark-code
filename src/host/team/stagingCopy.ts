import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readlink, rm, rmdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  CHECKPOINT_STORAGE_MODE,
  GIT_METADATA_OPTIONS,
  MCP_STDIO_ENV_ALLOWLIST,
  UI_TEXT,
} from '../../shared/constants'
import type { MergeVersion } from '../../core/team/mergeRoutine'
import { canonicalPath, isMissingPath } from '../canonicalPath'
import { isTeamGitError } from '../../core/team/teamGit'
import { parseBlobBatch } from '../../core/team/teamMerge'
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

/** Git's modes for one landing: taken once under its lock, for the guards to judge a mode by. */
export interface LandingFacts {
  readonly head: string
  readonly modes: ReadonlyMap<string, MergeVersion['mode']>
  readonly usesFilesystemMode: boolean
}
/** What the tree holds now, and the facts it was read with. Nothing was written to read it. */
export interface TeamTreeReading {
  readonly head: string
  readonly blobs: ReadonlyMap<string, SnapshotBlob>
  readonly facts: LandingFacts
}

const MERGE_FILE_ERROR_EXIT = 128
const EXECUTABLE_BITS = 0o111
const SHA256_HEX_CHARS = 64
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
/** A second pass drops what went away during the first; after that they are read one at a time. */
const BLOB_LIST_PASSES = 2

/**
The id git gives these raw bytes as a blob, in a repository whose commits look like `head`: the
same answer as `git hash-object --stdin`, with no process, so a guard costs a read of the file.
*/
export function blobId(bytes: Uint8Array, head: string): string {
  // nosemgrep: javascript.lang.security.audit.crypto.use-of-sha1.use-of-sha1 -- git's own object name, compared with git's, never a security boundary of ours.
  return createHash(head.length === SHA256_HEX_CHARS ? 'sha256' : 'sha1')
    .update(`blob ${String(bytes.length)}\0`)
    .update(bytes)
    .digest('hex')
}

/**
A file's mode as a guard judges it, with git's facts from the start of this landing. Where execute
bits are real it is what the disk says now, so a chmod between two guards reads as a change, by
name. Where they are not, git's retained mode stands, and nothing in the landing moves that: its
index is locked, and a moved HEAD is refused by the reading after the batch.
*/
export function guardMode(
  file: string,
  filesystemMode: number,
  facts: LandingFacts,
): '100644' | '100755' {
  if (facts.usesFilesystemMode)
    return (filesystemMode & EXECUTABLE_BITS) === 0 ? '100644' : '100755'
  const gitMode = facts.modes.get(file)
  return gitMode === '100755' ? gitMode : '100644'
}

/** Git ran and refused, through either of the runners a staging copy is given. */
const isGitFailure = (error: unknown): boolean => isGitExitError(error) || isTeamGitError(error)

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
      ...(input !== undefined && { input }),
    })
  }

  /**
  Each file's blob, of its raw bytes as `blob` takes them, or undefined for one no longer there. One
  git process for the lot: a tree holds thousands of files, and a landing reads it four times. With
  no `shouldStore` the ids are worked out and no object is written.
  */
  private async fileBlobs(
    root: string,
    names: readonly string[],
    head: string,
    shouldStore: boolean,
  ): Promise<ReadonlyMap<string, string>> {
    const oids = new Map<string, string>()
    // A line break cannot be listed; only those files go one at a time.
    const odd = names.filter((name) => /[\r\n]/u.test(name))
    let listed = names.filter((name) => !/[\r\n]/u.test(name))
    const args = ['hash-object', ...(shouldStore ? ['-w'] : []), '--no-filters', '--stdin-paths']
    for (let pass = 0; pass < BLOB_LIST_PASSES && listed.length > 0; pass += 1) {
      try {
        const output = await this.run(
          root,
          args,
          Buffer.from(listed.map((name) => `${path.resolve(root, name)}\n`).join('')),
        )
        const answers = output.toString('utf8').trim().split('\n')
        for (const [at, name] of listed.entries()) {
          const oid = answers[at]
          if (oid !== undefined) oids.set(name, oid)
        }
        listed = []
      } catch (error: unknown) {
        // A file that went away mid-way stops the whole list: once more without those gone.
        if (!isGitFailure(error)) throw error
        listed = await this.stillThere(root, listed)
      }
    }
    for (const name of [...odd, ...listed]) {
      try {
        const bytes = await readFile(path.resolve(root, name))
        oids.set(name, shouldStore ? await this.blob(root, bytes) : blobId(bytes, head))
      } catch (error: unknown) {
        if (!isMissingPath(error)) throw error
      }
    }
    return oids
  }

  private async stillThere(root: string, names: readonly string[]): Promise<string[]> {
    const there: string[] = []
    for (const name of names) {
      try {
        await lstat(path.resolve(root, name))
        there.push(name)
      } catch (error: unknown) {
        if (!isMissingPath(error)) throw error
      }
    }
    return there
  }

  /**
  Each link's blob, of the bytes it points with. To store them they go through one list as files of
  their own, not one process each: a tree can hold many.
  */
  private async linkBlobs(
    root: string,
    links: readonly { readonly name: string; readonly target: Buffer }[],
    head: string,
    shouldStore: boolean,
  ): Promise<ReadonlyMap<string, string>> {
    if (!shouldStore) return new Map(links.map((link) => [link.name, blobId(link.target, head)]))
    if (links.length === 0) return new Map()
    const folder = path.join(this.temporaryRoot, randomUUID())
    await mkdir(folder, { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
    try {
      const files = links.map((_, at) => path.join(folder, String(at)))
      for (const [at, link] of links.entries()) await writeFile(files[at] ?? '', link.target)
      const oids = await this.fileBlobs(root, files, head, true)
      return new Map(links.map((link, at) => [link.name, oids.get(files[at] ?? '') ?? '']))
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  }

  /**
  Every file the tree holds with its blob and mode: tracked, edited and untracked, ignored ones not.
  `gone` names the committed files that are no longer there.
  */
  private async treeFiles(
    root: string,
    facts: Awaited<ReturnType<StagingCopy['fileModes']>>,
    shouldStore: boolean,
  ): Promise<{
    readonly blobs: ReadonlyMap<string, SnapshotBlob>
    readonly gone: readonly string[]
  }> {
    const canonical = await canonicalPath(root)
    const listed = await this.run(root, [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
    ])
    const names = new Set(
      [...listed.toString('utf8').split('\0'), ...facts.committed].filter((name) => name !== ''),
    )
    const gone: string[] = []
    const files: { readonly name: string; readonly mode: MergeVersion['mode'] }[] = []
    const links: { readonly name: string; readonly target: Buffer }[] = []
    for (const name of names) {
      const target = path.resolve(root, name)
      const parent = await canonicalPath(path.dirname(target))
      const relative = path.relative(canonical, parent)
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        throw new Error(UI_TEXT.checkpointFailed)
      try {
        const info = await lstat(target)
        if (info.isSymbolicLink()) {
          links.push({ name, target: Buffer.from(await readlink(target)) })
        } else {
          if (!info.isFile()) throw new Error(UI_TEXT.checkpointFailed)
          files.push({ name, mode: this.regularFileMode(name, info.mode, facts) })
        }
      } catch (error: unknown) {
        if (!isMissingPath(error)) throw error
        gone.push(name)
      }
    }
    const blobs = new Map<string, SnapshotBlob>()
    const linked = await this.linkBlobs(root, links, facts.head, shouldStore)
    for (const [name, oid] of linked) blobs.set(name, { oid, mode: '120000' })
    const oids = await this.fileBlobs(
      root,
      files.map((entry) => entry.name),
      facts.head,
      shouldStore,
    )
    for (const entry of files) {
      const oid = oids.get(entry.name)
      if (oid === undefined) gone.push(entry.name)
      else blobs.set(entry.name, { oid, mode: entry.mode })
    }
    return { blobs, gone }
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

  /** Those blobs' bytes, in one git process however many they are. */
  public async readBlobs(
    root: string,
    oids: readonly string[],
  ): Promise<ReadonlyMap<string, Buffer>> {
    if (oids.some((oid) => !/^[a-f0-9]+$/u.test(oid))) throw new Error(UI_TEXT.checkpointFailed)
    const output = await this.run(
      root,
      ['cat-file', '--batch'],
      Buffer.from(`${oids.join('\n')}\n`),
    )
    return parseBlobBatch(output, oids)
  }

  /** Git's retained mode wins on filesystems where execute bits are not authoritative. */
  public async fileModes(
    root: string,
    head: string,
  ): Promise<LandingFacts & { readonly committed: readonly string[] }> {
    const modes = new Map<string, MergeVersion['mode']>()
    const committed: string[] = []
    // These queries only read metadata; retain every result and its precedence.
    const [tree, index, difference, configured] = await Promise.all([
      this.run(root, ['ls-tree', '-r', '-z', head]),
      this.run(root, ['ls-files', '--stage', '-z']),
      this.run(root, ['diff-files', '--raw', '-z', '--no-ext-diff', '--no-textconv']),
      // Execute bits are never real on Windows, whatever this says.
      process.platform === 'win32'
        ? undefined
        : this.run(root, ['config', '--type=bool', '--default=false', '--get', 'core.filemode']),
    ])
    for (const entry of tree.toString('utf8').split('\0')) {
      const tab = entry.indexOf('\t')
      if (tab !== -1) committed.push(entry.slice(tab + 1))
    }
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
      head,
      modes,
      committed,
      usesFilesystemMode: configured?.toString('utf8').trim() === 'true',
    }
  }

  public regularFileMode(
    file: string,
    filesystemMode: number,
    retained: LandingFacts,
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

  /**
  What the tree holds now, read under a landing's lock: every process only reads, and the file's bytes
  are read fresh by git as `snapshot` reads them. It writes no object and makes no tree, so a tree
  that matches an admission's has its objects from that admission's snapshot.
  */
  public async reading(root: string): Promise<TeamTreeReading> {
    const head = await this.head(root)
    const facts = await this.fileModes(root, head)
    const { blobs } = await this.treeFiles(root, facts, false)
    if ((await this.head(root)) !== head)
      throw new Error(UI_TEXT.teamTrafficNotices.snapshotChanged)
    return { head, blobs, facts }
  }

  /** The Git-visible whole tree: HEAD plus tracked edits/deletions and nonignored untracked files. */
  public async snapshot(root: string): Promise<TeamSnapshot> {
    const head = await this.head(root)
    const facts = await this.fileModes(root, head)
    await mkdir(this.temporaryRoot, { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
    const index = path.join(this.temporaryRoot, `${randomUUID()}.index`)
    try {
      await this.run(root, ['read-tree', head], undefined, index)
      const { blobs, gone } = await this.treeFiles(root, facts, true)
      const updates = [
        ...gone.map((name) => `0 ${'0'.repeat(head.length)}\t${name}\0`),
        ...Array.from(blobs, ([name, blob]) => `${blob.mode} ${blob.oid}\t${name}\0`),
      ]
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
