// The file access behind "Import from other agents" (M83, PLAN.md D49).
// Reads bind a bounded handle to its checked inode before reading bytes.
// Project targets refuse every link beneath the workspace root, dangling
// links included, and the root itself must still be the folder the preview
// was made for (its canonical path and file number, compared at every
// step): the approval wait is long enough for a link to be retargeted. The
// user's own source links may still be followed. New files publish whole
// through a never-replace hard link. Rules updates use the existing atomic
// writer and recheck the prior text before rename. Node has no
// handle-relative publication, so the checks narrow the window between
// native operations and do not close it against an arbitrary writer.

import { randomUUID } from 'node:crypto'
import { type BigIntStats, constants, type Dirent } from 'node:fs'
import { link, lstat, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  fileIdentityKey,
  handleIdentity,
  lstatIdentity,
  sameFile,
  statIdentity,
} from '../core/fs/fileIdentity'
import type {
  ImportDirEntry,
  ImportIo,
  ImportProjectRoot,
  ImportRead,
  ImportRootIdentity,
  ImportWriter,
} from '../core/import/agentImport'
import { decodeContextText } from '../core/context/contextFiles'
import { isSamePath } from '../core/paths'
import type { RealPathIo } from '../core/workspacePath'
import { resolveWorkspacePath } from '../core/workspacePath'
import {
  AGENT_IMPORT_ROOT_CHANGED_CODE,
  ATOMIC_TEMPORARY_SUFFIX,
  GIT_METADATA_OPTIONS,
  AGENT_IMPORT_GIT_NOT_REPOSITORY_EXIT,
  GIT_TIMEOUT_MS,
  RULES_FILE_MAX_BYTES,
} from '../shared/constants'
import { canonicalPath, isMissingPath } from './canonicalPath'
import { writeFileAtomically } from './fsAtomic'
import { isGitExitError, processGitProcess } from './git'
import { withoutCredentials } from '../runtime/credentialVariables'

const importGit = processGitProcess()

/** Ignore metadata only: no workspace executable, inherited git override or configured monitor. */
async function isImportIgnored(absolutePath: string, workspaceRoot: string): Promise<boolean> {
  // Git uses the file's nearest repository, including a nested repository.
  // Missing target directories are walked up to their first existing parent.
  let cwd = path.dirname(absolutePath)
  for (;;) {
    if (
      !isSamePath(cwd, workspaceRoot, process.platform) &&
      !resolveWorkspacePath(workspaceRoot, cwd, process.platform).ok
    )
      throw refused('EPERM')
    try {
      const info = await stat(cwd)
      if (info.isDirectory()) break
    } catch (error: unknown) {
      if (!isMissingPath(error)) throw error
    }
    if (isSamePath(cwd, workspaceRoot, process.platform)) throw refused('ENOTDIR')
    cwd = path.dirname(cwd)
  }
  const env = Object.fromEntries(
    Object.entries(withoutCredentials(process.env)).filter(([name]) => !/^GIT_/i.test(name)),
  )
  const options = {
    cwd,
    env: { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    timeoutMs: GIT_TIMEOUT_MS,
  }
  try {
    await importGit([...GIT_METADATA_OPTIONS, 'rev-parse', '--is-inside-work-tree'], options)
  } catch (error: unknown) {
    if (
      isGitExitError(error) &&
      error.exitCode === AGENT_IMPORT_GIT_NOT_REPOSITORY_EXIT &&
      error.stderr.includes('not a git repository')
    )
      return false
    throw error
  }
  try {
    await importGit([...GIT_METADATA_OPTIONS, 'check-ignore', '--quiet', '-z', '--stdin'], {
      ...options,
      input: `${path.relative(cwd, absolutePath)}\0`,
    })
    return true
  } catch (error: unknown) {
    if (isGitExitError(error) && error.exitCode === 1) return false
    throw error
  }
}

const EXISTS = 'EEXIST'
const LINK_REFUSED = 'ELOOP'
const CHANGED = 'ESTALE'
const TOO_LARGE = 'EFBIG'
const EXCLUSIVE_CREATE = 'wx'

function refused(code: string): Error {
  return Object.assign(new Error('Import path cannot be used safely'), { code })
}

/** The canonical form the import confines by: broken links followed to where they lead. */
export const importRealPath: RealPathIo['realPath'] = async (absolutePath) =>
  await canonicalPath(absolutePath, { followsBrokenLinks: true })

/** A folder's canonical path and file number, for comparing it with itself later. */
async function identifyRoot(absolutePath: string): Promise<ImportRootIdentity> {
  const canonical = await importRealPath(absolutePath)
  const info = await statIdentity(canonical)
  if (!info.isDirectory()) {
    throw refused('ENOTDIR')
  }
  return {
    canonical,
    fileId: fileIdentityKey(info) ?? '',
  }
}

/** Refuses a root that is not the folder the plan saw: retargeted, replaced, or gone. */
async function assertRoot(project: ImportProjectRoot): Promise<void> {
  let now: ImportRootIdentity
  try {
    now = await identifyRoot(project.path)
  } catch {
    throw refused(AGENT_IMPORT_ROOT_CHANGED_CODE)
  }
  if (
    !isSamePath(now.canonical, project.identity.canonical, process.platform) ||
    now.fileId !== project.identity.fileId
  ) {
    throw refused(AGENT_IMPORT_ROOT_CHANGED_CODE)
  }
}

/** Reject every component beneath `root` that is a link, including a broken one. */
async function assertNoLinks(absolutePath: string, root: string): Promise<void> {
  const resolved = resolveWorkspacePath(root, absolutePath, process.platform)
  if (!resolved.ok) {
    throw refused('EPERM')
  }
  let current = root
  for (const segment of resolved.relative.split('/')) {
    current = path.join(current, segment)
    let info: BigIntStats
    try {
      info = await lstatIdentity(current)
    } catch (error: unknown) {
      if (isMissingPath(error)) {
        return
      }
      throw error
    }
    if (info.isSymbolicLink()) {
      throw refused(LINK_REFUSED)
    }
  }
}

/** A project target: the root is the planned folder, and no link lies beneath it. */
export async function assertImportTarget(
  absolutePath: string,
  project: ImportProjectRoot,
): Promise<void> {
  await assertRoot(project)
  await assertNoLinks(absolutePath, project.path)
}

/** A target under the planned project root, or a bare file (a user's own). */
async function checkTarget(absolutePath: string, project?: ImportProjectRoot): Promise<void> {
  if (project === undefined) {
    await assertNoLinks(absolutePath, path.dirname(absolutePath))
  } else {
    await assertImportTarget(absolutePath, project)
  }
}

async function isDirectoryLink(absolutePath: string): Promise<boolean> {
  try {
    const info = await stat(absolutePath)
    return info.isDirectory()
  } catch (error: unknown) {
    if (isMissingPath(error)) {
      // A broken link reads as a file, which the scan then reports missing.
      return false
    }
    throw error
  }
}

/**
 * Read through one verified handle, at most maxBytes plus one sentinel
 * byte. A scan's project read is bound to the workspace root by path; a
 * plan-bound read (`project`) also compares the root's identity.
 */
async function readImportFile(
  absolutePath: string,
  maxBytes: number,
  projectRoot?: string,
  project?: ImportProjectRoot,
): Promise<ImportRead> {
  const check = async (): Promise<void> => {
    if (project !== undefined) {
      await assertImportTarget(absolutePath, project)
    } else if (projectRoot !== undefined) {
      await assertNoLinks(absolutePath, projectRoot)
    }
  }
  const isBound = project !== undefined || projectRoot !== undefined
  await check()
  let info: BigIntStats
  try {
    info = await statIdentity(absolutePath)
  } catch (error: unknown) {
    if (isMissingPath(error)) {
      return { status: 'missing' }
    }
    throw error
  }
  if (!info.isFile()) {
    return { status: 'notFile' }
  }
  if (info.size > BigInt(maxBytes)) {
    return { status: 'tooLarge' }
  }
  const flags = constants.O_RDONLY | (isBound ? constants.O_NOFOLLOW : 0)
  const handle = await open(absolutePath, flags)
  try {
    if (!sameFile(info, await handleIdentity(handle))) {
      throw refused(CHANGED)
    }
    await check()
    if (!sameFile(info, await statIdentity(absolutePath))) {
      throw refused(CHANGED)
    }
    const bytes = Buffer.alloc(maxBytes + 1)
    let length = 0
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length)
      if (read.bytesRead === 0) {
        break
      }
      length += read.bytesRead
    }
    await check()
    return length > maxBytes
      ? { status: 'tooLarge' }
      : { status: 'read', bytes: bytes.subarray(0, length) }
  } finally {
    await handle.close()
  }
}

export const fileImportIo: ImportIo = {
  readFile: async (absolutePath, maxBytes, projectRoot) =>
    await readImportFile(absolutePath, maxBytes, projectRoot),
  async listDirectory(absolutePath) {
    let entries: Dirent[]
    try {
      entries = await readdir(absolutePath, { withFileTypes: true })
    } catch (error: unknown) {
      if (isMissingPath(error)) {
        return
      }
      throw error
    }
    return await Promise.all(
      entries.map(async (entry): Promise<ImportDirEntry> => ({
        name: entry.name,
        isDirectory:
          entry.isDirectory() ||
          (entry.isSymbolicLink() && (await isDirectoryLink(path.join(absolutePath, entry.name)))),
      })),
    )
  },
  realPath: importRealPath,
  isIgnored: isImportIgnored,
}

/** Whether anything is at the path: a file, a folder, or a link, even a broken one. */
export async function isPathPresent(absolutePath: string): Promise<boolean> {
  try {
    await lstat(absolutePath)
    return true
  } catch (error: unknown) {
    if (isMissingPath(error)) {
      return false
    }
    throw error
  }
}

/** Publish one complete new file with an atomic, never-replace hard link. */
async function createImportFile(
  absolutePath: string,
  content: string,
  project?: ImportProjectRoot,
  beforePublish?: () => void | Promise<void>,
): Promise<'created' | 'exists'> {
  if (await isPathPresent(absolutePath)) {
    return 'exists'
  }
  await checkTarget(absolutePath, project)
  await beforePublish?.()
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await checkTarget(absolutePath, project)
  const temporary = `${absolutePath}.${randomUUID()}${ATOMIC_TEMPORARY_SUFFIX}`
  await beforePublish?.()
  const handle = await open(temporary, EXCLUSIVE_CREATE)
  let identity: BigIntStats | undefined
  let createdPath: string | undefined
  try {
    identity = await handleIdentity(handle)
    createdPath = await importRealPath(temporary)
    await checkTarget(temporary, project)
    if (!sameFile(identity, await lstatIdentity(temporary))) {
      throw refused(CHANGED)
    }
    await beforePublish?.()
    await handle.writeFile(content, 'utf8')
    await handle.close()
    await checkTarget(temporary, project)
    await checkTarget(absolutePath, project)
    if (!sameFile(identity, await lstatIdentity(temporary))) {
      throw refused(CHANGED)
    }
    await beforePublish?.()
    await link(temporary, absolutePath)
    return 'created'
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === EXISTS) {
      return 'exists'
    }
    throw error
  } finally {
    await handle.close()
    // A retargeted folder must not make cleanup remove someone else's file.
    try {
      if (
        identity !== undefined &&
        createdPath !== undefined &&
        sameFile(identity, await lstatIdentity(createdPath))
      ) {
        await rm(createdPath)
      }
    } catch {
      // Preserve the write result; an unverified temporary path is left alone.
    }
  }
}

async function readImportText(
  absolutePath: string,
  project?: ImportProjectRoot,
): Promise<string | undefined> {
  const read = await readImportFile(absolutePath, RULES_FILE_MAX_BYTES, project?.path, project)
  if (read.status === 'missing') {
    return undefined
  }
  if (read.status !== 'read') {
    throw refused(read.status === 'tooLarge' ? TOO_LARGE : 'EISDIR')
  }
  const decoded = decodeContextText(read.bytes)
  if (!decoded.ok) {
    throw refused('EILSEQ')
  }
  return decoded.text
}

export const fileImportWriter: ImportWriter = {
  identifyRoot,
  assertSafePath: assertImportTarget,
  createFile: createImportFile,
  readText: readImportText,
  async appendText(absolutePath, content, options) {
    const project = options?.project
    await checkTarget(absolutePath, project)
    const current = (await readImportText(absolutePath, project)) ?? ''
    if (options?.expectedText !== undefined && options.expectedText !== current) {
      throw refused(CHANGED)
    }
    const after = `${current}${content}`
    if (Buffer.byteLength(after, 'utf8') > RULES_FILE_MAX_BYTES) {
      throw refused(TOO_LARGE)
    }
    const expectedCanonicalPath = await importRealPath(absolutePath)
    // The rename names where the file really is (its canonical path), so its
    // links are walked from the planned root's canonical form.
    const canonicalProject: ImportProjectRoot | undefined =
      project === undefined
        ? undefined
        : { path: project.identity.canonical, identity: project.identity }
    await options?.beforePublish?.()
    await writeFileAtomically(absolutePath, after, {
      expectedCanonicalPath,
      ...(options?.assertCanWrite !== undefined && { assertCanWrite: options.assertCanWrite }),

      sleep: async (ms) => {
        await new Promise((resolve) => setTimeout(resolve, ms))
      },
      rename: async (from, to) => {
        // The atomic writer names the canonical target; retain the original
        // request path too, so a retargeted workspace link still revokes it.
        await checkTarget(absolutePath, project)
        await checkTarget(to, canonicalProject)
        if (((await readImportText(to, canonicalProject)) ?? '') !== current) {
          throw refused(CHANGED)
        }
        await checkTarget(to, canonicalProject)
        await checkTarget(absolutePath, project)
        await options?.beforePublish?.()
        await rename(from, to)
      },
    })
  },
  realPath: importRealPath,
  isIgnored: isImportIgnored,
}
