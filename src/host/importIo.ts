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
  RULES_FILE_MAX_BYTES,
} from '../shared/constants'
import { canonicalPath, isMissingPath } from './canonicalPath'
import { writeFileAtomically } from './fsAtomic'

const EXISTS = 'EEXIST'
const LINK_REFUSED = 'ELOOP'
const CHANGED = 'ESTALE'
const TOO_LARGE = 'EFBIG'
const EXCLUSIVE_CREATE = 'wx'
const NO_FILE_NUMBER = 0n
const FILE_ID_SEPARATOR = ':'

function refused(code: string): Error {
  return Object.assign(new Error('Import path cannot be used safely'), { code })
}

/** Device and file number; bigint so that no 64-bit file number loses its low bits. */
function isSameFile(before: BigIntStats, after: BigIntStats): boolean {
  return before.dev === after.dev && before.ino === after.ino
}

/** The canonical form the import confines by: broken links followed to where they lead. */
export const importRealPath: RealPathIo['realPath'] = async (absolutePath) =>
  await canonicalPath(absolutePath, { followsBrokenLinks: true })

/** A folder's canonical path and file number, for comparing it with itself later. */
async function identifyRoot(absolutePath: string): Promise<ImportRootIdentity> {
  const canonical = await importRealPath(absolutePath)
  const info = await stat(canonical, { bigint: true })
  if (!info.isDirectory()) {
    throw refused('ENOTDIR')
  }
  return {
    canonical,
    fileId:
      info.ino === NO_FILE_NUMBER
        ? ''
        : `${String(info.dev)}${FILE_ID_SEPARATOR}${String(info.ino)}`,
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
      info = await lstat(current, { bigint: true })
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
    info = await stat(absolutePath, { bigint: true })
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
    if (!isSameFile(info, await handle.stat({ bigint: true }))) {
      throw refused(CHANGED)
    }
    await check()
    if (!isSameFile(info, await stat(absolutePath, { bigint: true }))) {
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
  beforePublish?: () => void,
): Promise<'created' | 'exists'> {
  if (await isPathPresent(absolutePath)) {
    return 'exists'
  }
  await checkTarget(absolutePath, project)
  beforePublish?.()
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await checkTarget(absolutePath, project)
  const temporary = `${absolutePath}.${randomUUID()}${ATOMIC_TEMPORARY_SUFFIX}`
  beforePublish?.()
  const handle = await open(temporary, EXCLUSIVE_CREATE)
  let identity: BigIntStats | undefined
  let createdPath: string | undefined
  try {
    identity = await handle.stat({ bigint: true })
    createdPath = await importRealPath(temporary)
    await checkTarget(temporary, project)
    if (!isSameFile(identity, await lstat(temporary, { bigint: true }))) {
      throw refused(CHANGED)
    }
    beforePublish?.()
    await handle.writeFile(content, 'utf8')
    await handle.close()
    await checkTarget(temporary, project)
    await checkTarget(absolutePath, project)
    if (!isSameFile(identity, await lstat(temporary, { bigint: true }))) {
      throw refused(CHANGED)
    }
    beforePublish?.()
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
        isSameFile(identity, await lstat(createdPath, { bigint: true }))
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
    options?.beforePublish?.()
    await writeFileAtomically(absolutePath, after, {
      expectedCanonicalPath,
      ...(options?.beforePublish !== undefined && { assertCanWrite: options.beforePublish }),
      sleep: async (ms) => {
        await new Promise((resolve) => setTimeout(resolve, ms))
      },
      rename: async (from, to) => {
        await checkTarget(to, canonicalProject)
        if (((await readImportText(to, canonicalProject)) ?? '') !== current) {
          throw refused(CHANGED)
        }
        await checkTarget(to, canonicalProject)
        options?.beforePublish?.()
        await rename(from, to)
      },
    })
  },
  realPath: importRealPath,
}
