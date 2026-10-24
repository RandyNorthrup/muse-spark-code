// Workspace snapshots (M110b W2, D90.6 §6 B7): a git bundle, a worktree
// patch of tracked modifications, plus an archive of untracked,
// non-ignored files — or a file-system snapshot where btrfs or ZFS
// backs the volume — taken before an upgrade, a restore and any
// destructive cleanup. The bundle alone would lose dirty tracked
// files (it holds refs, not worktree dirt), hence the patch. Restore
// reproduces tracked files at the snapshot's head plus patch and
// archive; ignored files (regenerable caches, but also precious
// `.env` files) are kept, never cleaned. A restore takes its own
// pre-snapshot first, so no restore can destroy uncommitted work. Pure
// builders below; the bundle path is drill-proven on real git, the
// file-system path runs wherever its volume exists.
import { Buffer } from 'node:buffer'
import { mkdtempSync, readFileSync, rmSync, statfsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import { isCodedFailure } from '../../../core/fs/errno'
import { isGovernedCommandUnavailable } from '../../../core/resources/launch'
import { execResourceFile } from '../../../core/resources/launcher'
import { runWorkspaceGit } from './git'

export const SNAPSHOT_VERSION = 1

/** The digits in a `\ooo` octal escape; with the backslash it spans one more. */
const OCTAL_ESCAPE_DIGITS = 3
/** The `?? ` prefix an untracked porcelain line starts with. */
const PORCELAIN_UNTRACKED_PREFIX = '?? '

const snapshotManifestSchema = z.strictObject({
  version: z.literal(SNAPSHOT_VERSION),
  takenAt: z.string(),
  head: z.string(),
  method: z.union([z.literal('bundle'), z.literal('btrfs'), z.literal('zfs')]),
  bundle: z.optional(z.string()),
  patch: z.optional(z.string()),
  archive: z.union([z.string(), z.null()]),
  fsFallback: z.optional(z.string()),
})
export type SnapshotManifest = z.infer<typeof snapshotManifestSchema>

/**
Unquote one porcelain path: git C-quotes only when it must, and its
octal escapes are UTF-8 bytes, not code points — decode runs over the
collected bytes.
*/
export function unquotePorcelainPath(quoted: string): string {
  if (!quoted.startsWith('"') || !quoted.endsWith('"') || quoted.length < 2) return quoted
  const inner = quoted.slice(1, -1)
  const chunks: Buffer[] = []
  let literal = ''
  const flush = (): void => {
    if (literal === '') {
      return
    }

    chunks.push(Buffer.from(literal, 'utf8'))
    literal = ''
  }
  let index = 0
  while (index < inner.length) {
    const char = inner.charAt(index)
    if (char !== '\\') {
      literal += char
      index += 1
      continue
    }
    const next = inner.charAt(index + 1)
    if (next >= '0' && next <= '7') {
      const octal = inner.slice(index + 1, index + 1 + OCTAL_ESCAPE_DIGITS)
      if (/^[0-7]{3}$/.test(octal)) {
        flush()
        chunks.push(Buffer.from([Number.parseInt(octal, 8)]))
        index += 1 + OCTAL_ESCAPE_DIGITS
        continue
      }
    }
    const singles: Record<string, string> = { n: '\n', t: '\t', '\\': '\\', '"': '"' }
    flush()
    chunks.push(Buffer.from(singles[next] ?? next, 'utf8'))
    index += 2
  }
  flush()
  return Buffer.concat(chunks).toString('utf8')
}

/** The untracked paths from `git status --porcelain -uall`, repo-relative. */
export function parseUntracked(porcelain: string): readonly string[] {
  const untracked: string[] = []
  for (const line of porcelain.split('\n')) {
    if (!line.startsWith(PORCELAIN_UNTRACKED_PREFIX)) continue
    untracked.push(unquotePorcelainPath(line.slice(PORCELAIN_UNTRACKED_PREFIX.length)))
  }
  return untracked
}

/** A tar member is safe to extract when relative and inside the tree. */
export function isSafeArchiveMember(member: string): boolean {
  if (member === '' || member.startsWith('/') || member.startsWith('\\')) return false
  const parts = member.replaceAll('\\', '/').split('/')
  let depth = 0
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (depth === 0) return false
      depth -= 1
      continue
    }
    depth += 1
  }
  return true
}

export function tarCreateArgv(archive: string, dir: string, listFile: string): readonly string[] {
  return ['-czf', archive, '-C', dir, '--null', '-T', listFile]
}

export function tarExtractArgv(archive: string, dir: string): readonly string[] {
  return ['-xzf', archive, '-C', dir]
}

export function tarListArgv(archive: string): readonly string[] {
  return ['-tzf', archive]
}

/** statfs magic numbers: the volume's file system, without parsing mounts. */
const STATFS_BTRFS = 0x91_23_68_3e
const STATFS_ZFS = 0x2f_c1_2f_c1

export type SnapshotVolumeFs = 'btrfs' | 'zfs' | 'other'

/** What backs the workspace: btrfs and ZFS snapshot natively, the rest bundles. */
export function detectVolumeFs(dir: string): SnapshotVolumeFs {
  let magic: number
  try {
    magic = statfsSync(dir).type
  } catch (error: unknown) {
    if (isCodedFailure(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return 'other'
    }
    throw error
  }
  if (magic === STATFS_BTRFS) return 'btrfs'
  return magic === STATFS_ZFS ? 'zfs' : 'other'
}

export function btrfsSnapshotArgv(dir: string, snapPath: string): readonly string[] {
  return ['subvolume', 'snapshot', '-r', dir, snapPath]
}

export function btrfsIsSubvolumeArgv(dir: string): readonly string[] {
  return ['subvolume', 'show', dir]
}

export function zfsSnapshotArgv(dataset: string, name: string): readonly string[] {
  return ['snapshot', `${dataset}@${name}`]
}

export function zfsListArgv(): readonly string[] {
  return ['list', '-H', '-o', 'name,mountpoint']
}

export function btrfsDeleteArgv(dir: string): readonly string[] {
  return ['subvolume', 'delete', dir]
}

export function btrfsRestoreArgv(snapPath: string, dir: string): readonly string[] {
  return ['subvolume', 'snapshot', snapPath, dir]
}

export function zfsRollbackArgv(dataset: string, name: string): readonly string[] {
  return ['rollback', `${dataset}@${name}`]
}

/** The dataset mounted exactly at the workspace, from `zfs list -H -o name,mountpoint`. */
export function zfsDatasetAt(tabular: string, dir: string): string | undefined {
  for (const line of tabular.split('\n')) {
    const [dataset, mountpoint] = line.split('\t', 2)
    if (dataset !== undefined && dataset !== '' && mountpoint === dir) return dataset
  }
  return undefined
}

export class SnapshotError extends Error {}

/**
One snapshot tool run through the governed boundary, in this process's
environment: `probe` for a read (a listing, a subvolume check),
`contained` for anything that writes. A non-zero exit rejects with its
numeric `code`; a tool the boundary cannot run outside the workspace
rejects coded `unavailable`, so the file-system paths still fall back to
the bundle on a coded failure, as on execFile's ENOENT.
*/
async function runFile(
  profile: 'contained' | 'probe',
  tool: string,
  argv: readonly string[],
  cwd: string,
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  try {
    return await execResourceFile(profile, tool, argv, { cwd, env: process.env, encoding: 'utf8' })
  } catch (error: unknown) {
    // NARROW: only the boundary's refusal is recoded; every other failure keeps its own code.
    if (isGovernedCommandUnavailable(error))
      throw Object.assign(
        new SnapshotError(`${path.basename(tool)} is unavailable`, { cause: error }),
        {
          code: 'unavailable',
        },
      )
    throw error
  }
}

export interface SnapshotTools {
  readonly gitPath: string
  readonly tarPath: string
  readonly btrfsPath?: string
  readonly zfsPath?: string
  readonly platform: NodeJS.Platform
  readonly baseEnv: NodeJS.ProcessEnv
  /** The workspace's own remote: the kind of bare network verbs. */
  readonly remote: string
}

async function gitHead(tools: SnapshotTools, dir: string): Promise<string> {
  const run = await runWorkspaceGit(tools.gitPath, ['rev-parse', 'HEAD'], {
    cwd: dir,
    platform: tools.platform,
    baseEnv: tools.baseEnv,
    remote: tools.remote,
    provisions: {},
  })
  return run.stdout.trim()
}

/**
Take the snapshot: bundle plus untracked archive (the proven path), or
a file-system snapshot where the volume offers one. Returns the
manifest as written; `fsFallback` names why a detected volume still
bundled.
*/
export async function createWorkspaceSnapshot(
  tools: SnapshotTools,
  dir: string,
  destDir: string,
  takenAt: string,
): Promise<SnapshotManifest> {
  const head = await gitHead(tools, dir)
  const fs = detectVolumeFs(dir)
  if (fs === 'btrfs' && tools.btrfsPath !== undefined) {
    const snapPath = path.join(destDir, 'subvolume')
    try {
      await runFile('probe', tools.btrfsPath, btrfsIsSubvolumeArgv(dir), dir)
      await runFile('contained', tools.btrfsPath, btrfsSnapshotArgv(dir, snapPath), dir)
      return writeManifest(destDir, {
        version: SNAPSHOT_VERSION,
        takenAt,
        head,
        method: 'btrfs',
        archive: null,
      })
    } catch (error: unknown) {
      if (!isCodedFailure(error)) throw error
      return await bundleSnapshot(tools, dir, destDir, takenAt, head, `btrfs: ${errorCode(error)}`)
    }
  }
  if (fs === 'zfs' && tools.zfsPath !== undefined) {
    try {
      const listed = await runFile('probe', tools.zfsPath, zfsListArgv(), dir)
      const dataset = zfsDatasetAt(listed.stdout, dir)
      if (dataset === undefined) {
        return await bundleSnapshot(
          tools,
          dir,
          destDir,
          takenAt,
          head,
          'zfs: no dataset at workspace',
        )
      }
      await runFile(
        'contained',
        tools.zfsPath,
        zfsSnapshotArgv(dataset, snapshotName(takenAt)),
        dir,
      )
      return writeManifest(destDir, {
        version: SNAPSHOT_VERSION,
        takenAt,
        head,
        method: 'zfs',
        archive: null,
      })
    } catch (error: unknown) {
      if (!isCodedFailure(error)) throw error
      return await bundleSnapshot(tools, dir, destDir, takenAt, head, `zfs: ${errorCode(error)}`)
    }
  }
  return await bundleSnapshot(tools, dir, destDir, takenAt, head)
}

function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error ? String(error.code) : 'error'
}

function snapshotName(takenAt: string): string {
  return `muse-${takenAt.replaceAll(/[^0-9A-Za-z]/g, '-')}`
}

function writeManifest(destDir: string, manifest: SnapshotManifest): SnapshotManifest {
  writeFileSync(path.join(destDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

async function bundleSnapshot(
  tools: SnapshotTools,
  dir: string,
  destDir: string,
  takenAt: string,
  head: string,
  fsFallback?: string,
): Promise<SnapshotManifest> {
  const bundle = 'repo.bundle'
  const patch = 'worktree.patch'
  await runWorkspaceGit(tools.gitPath, ['bundle', 'create', path.join(destDir, bundle), '--all'], {
    cwd: dir,
    platform: tools.platform,
    baseEnv: tools.baseEnv,
    remote: tools.remote,
    provisions: {},
  })
  const dirt = await runWorkspaceGit(tools.gitPath, ['diff', 'HEAD', '--binary'], {
    cwd: dir,
    platform: tools.platform,
    baseEnv: tools.baseEnv,
    remote: tools.remote,
    provisions: {},
    okCodes: [0, 1],
  })
  writeFileSync(path.join(destDir, patch), dirt.stdout)
  const status = await runWorkspaceGit(tools.gitPath, ['status', '--porcelain=v1', '-uall'], {
    cwd: dir,
    platform: tools.platform,
    baseEnv: tools.baseEnv,
    remote: tools.remote,
    provisions: {},
  })
  const untracked = parseUntracked(status.stdout)
  let archive: string | null = null
  if (untracked.length > 0) {
    archive = 'untracked.tar.gz'
    const listDir = mkdtempSync(path.join(tmpdir(), 'muse-snapshot-'))
    try {
      const listFile = path.join(listDir, 'files')
      writeFileSync(listFile, `${untracked.join('\0')}\0`)
      await runFile(
        'contained',
        tools.tarPath,
        tarCreateArgv(path.join(destDir, archive), dir, listFile),
        dir,
      )
    } finally {
      rmSync(listDir, { recursive: true, force: true })
    }
  }
  return writeManifest(destDir, {
    version: SNAPSHOT_VERSION,
    takenAt,
    head,
    method: 'bundle',
    bundle,
    patch,
    archive,
    ...(fsFallback !== undefined && { fsFallback }),
  })
}

/**
Restore the snapshot: its own pre-snapshot first (a restore never
destroys uncommitted work), then tracked files to the snapshot's head,
its untracked archive overlaid, ignored files kept. Answers the
restored head and where the pre-snapshot went.
*/
export async function restoreWorkspaceSnapshot(
  tools: SnapshotTools,
  dir: string,
  snapshotDir: string,
  preSnapshotDir: string,
  takenAt: string,
): Promise<{ readonly head: string; readonly preSnapshotDir: string }> {
  const manifest = snapshotManifestSchema.parse(
    JSON.parse(readFileSync(path.join(snapshotDir, 'manifest.json'), 'utf8')),
  )
  await createWorkspaceSnapshot(tools, dir, preSnapshotDir, takenAt)
  if (manifest.method === 'btrfs') {
    await restoreBtrfs(tools, dir, snapshotDir)
    return { head: manifest.head, preSnapshotDir }
  }
  if (manifest.method === 'zfs') {
    await restoreZfs(tools, dir, manifest)
    return { head: manifest.head, preSnapshotDir }
  }
  if (manifest.bundle === undefined) {
    throw new SnapshotError('bundle snapshot without its bundle')
  }
  const bundlePath = path.join(snapshotDir, manifest.bundle)
  await runWorkspaceGit(
    tools.gitPath,
    ['fetch', bundlePath, manifest.head, '+refs/tags/*:refs/tags/*'],
    {
      cwd: dir,
      platform: tools.platform,
      baseEnv: tools.baseEnv,
      remote: tools.remote,
      provisions: {},
    },
  )
  await runWorkspaceGit(tools.gitPath, ['reset', '--hard', manifest.head], {
    cwd: dir,
    platform: tools.platform,
    baseEnv: tools.baseEnv,
    remote: tools.remote,
    provisions: {},
  })
  if (manifest.patch !== undefined) {
    const patchPath = path.join(snapshotDir, manifest.patch)
    if (readFileSync(patchPath, 'utf8') !== '') {
      await runWorkspaceGit(tools.gitPath, ['apply', patchPath], {
        cwd: dir,
        platform: tools.platform,
        baseEnv: tools.baseEnv,
        remote: tools.remote,
        provisions: {},
      })
    }
  }
  await runWorkspaceGit(tools.gitPath, ['clean', '-fd'], {
    cwd: dir,
    platform: tools.platform,
    baseEnv: tools.baseEnv,
    remote: tools.remote,
    provisions: {},
  })
  if (manifest.archive !== null) {
    const archivePath = path.join(snapshotDir, manifest.archive)
    const listed = await runFile('probe', tools.tarPath, tarListArgv(archivePath), dir)
    const members = listed.stdout.split('\n').filter((member) => member !== '')
    if (members.some((member) => !isSafeArchiveMember(member))) {
      throw new SnapshotError('snapshot archive escapes the workspace')
    }
    await runFile('contained', tools.tarPath, tarExtractArgv(archivePath, dir), dir)
  }
  return { head: manifest.head, preSnapshotDir }
}

async function restoreBtrfs(tools: SnapshotTools, dir: string, snapshotDir: string): Promise<void> {
  if (tools.btrfsPath === undefined) throw new SnapshotError('btrfs restore without btrfs')
  await runFile('contained', tools.btrfsPath, btrfsDeleteArgv(dir), dir)
  await runFile(
    'contained',
    tools.btrfsPath,
    btrfsRestoreArgv(path.join(snapshotDir, 'subvolume'), dir),
    dir,
  )
}

async function restoreZfs(
  tools: SnapshotTools,
  dir: string,
  manifest: SnapshotManifest,
): Promise<void> {
  if (tools.zfsPath === undefined) throw new SnapshotError('zfs restore without zfs')
  const listed = await runFile('probe', tools.zfsPath, zfsListArgv(), dir)
  const dataset = zfsDatasetAt(listed.stdout, dir)
  if (dataset === undefined) throw new SnapshotError('zfs restore without its dataset')
  await runFile(
    'contained',
    tools.zfsPath,
    zfsRollbackArgv(dataset, snapshotName(manifest.takenAt)),
    dir,
  )
}
