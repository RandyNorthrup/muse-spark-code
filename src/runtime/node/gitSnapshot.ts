// Import only Git data, never a repository's config, hooks or executable paths.
// The private snapshot cannot be changed by muse-tools during credentialed Git.
import { constants } from 'node:fs'
import { mkdir, open, opendir, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { handleIdentity, lstatIdentity, sameFile } from '../../core/fs/fileIdentity'
import {
  NODE_DIRECTORY_MODE,
  NODE_FILE_MODE,
  NODE_GIT_IMPORT_FILE_BYTES,
  NODE_GIT_IMPORT_MAX_BYTES,
  NODE_GIT_IMPORT_MAX_FILES,
  NODE_GIT_SNAPSHOT_CONFIG,
  NODE_SINGLE_LINK,
  NODE_PROC_FD_ROOT,
  UI_TEXT,
} from '../../shared/constants'
import { nodeGitRepositoryConfigSchema, nodeRelativePathSchema } from '../../shared/node'
import { isMissingFile, type NodePrivateFiles } from './privateFiles'

export interface NodeGitSnapshot {
  readonly gitDir: string
  readonly workTree: string
  readonly headBytes: string
  dispose(): Promise<void>
}

function isWithin(root: string, file: string): boolean {
  const normalizedRoot = root.replaceAll('\\', '/')
  const normalized = file.replaceAll('\\', '/')
  return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`)
}

/** Copy through a held no-follow FD; a rename/symlink swap cannot substitute bytes. */
async function copyData(
  source: string,
  target: string,
  remaining: number,
  signal: AbortSignal,
): Promise<number> {
  signal.throwIfAborted()
  const before = await lstatIdentity(source)
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== NODE_SINGLE_LINK)
    throw new Error(UI_TEXT.nodeErrors.forbidden)
  if (before.size > BigInt(Math.min(remaining, NODE_GIT_IMPORT_FILE_BYTES)))
    throw new Error(UI_TEXT.nodeErrors.tooLarge)
  const handle = await open(
    source,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    const held = await handleIdentity(handle)
    if (!sameFile(before, held) || held.size !== before.size)
      throw new Error(UI_TEXT.nodeErrors.conflict)
    const size = Number(held.size)
    const bytes = Buffer.alloc(size + 1)
    let length = 0
    for (;;) {
      signal.throwIfAborted()
      const part = await handle.read(bytes, length, bytes.length - length, null)
      length += part.bytesRead
      if (length > size) throw new Error(UI_TEXT.nodeErrors.conflict)
      if (part.bytesRead === 0) break
    }
    const after = await handleIdentity(handle)
    if (length !== size || after.size !== held.size || after.mtimeNs !== held.mtimeNs)
      throw new Error(UI_TEXT.nodeErrors.conflict)
    await writeFile(target, bytes.subarray(0, length), { mode: NODE_FILE_MODE, flag: 'wx' })
    return length
  } finally {
    await handle.close()
  }
}

export async function createNodeGitSnapshot(
  files: NodePrivateFiles,
  workspaceRoot: string,
  workspacePath: string,
  signal: AbortSignal,
): Promise<NodeGitSnapshot> {
  signal.throwIfAborted()
  if (process.platform !== 'linux') throw new Error(UI_TEXT.nodeErrors.unsupported)
  await files.prepare()
  nodeRelativePathSchema.parse(workspacePath)
  const root = await realpath(workspaceRoot)
  const workTree = await realpath(path.join(root, workspacePath))
  if (!isWithin(root, workTree) || isWithin(workTree, files.root))
    throw new Error(UI_TEXT.nodeErrors.forbidden)
  const source = path.join(workTree, '.git')
  const sourceInfo = await lstatIdentity(source)
  const resolvedSource = await realpath(source)
  if (
    !sourceInfo.isDirectory() ||
    sourceInfo.isSymbolicLink() ||
    resolvedSource.replaceAll('\\', '/') !== source.replaceAll('\\', '/')
  )
    throw new Error(UI_TEXT.nodeErrors.unsupported)
  const sourceHandle = await open(
    source,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  )
  if (!sameFile(sourceInfo, await handleIdentity(sourceHandle))) {
    await sourceHandle.close()
    throw new Error(UI_TEXT.nodeErrors.conflict)
  }
  const sourcePath = `${NODE_PROC_FD_ROOT}/${String(sourceHandle.fd)}`
  const gitDir = files.file(`git-${randomUUID()}`)
  let bytes = 0
  let count = 0
  const importFile = async (from: string, to: string) => {
    count += 1
    if (count > NODE_GIT_IMPORT_MAX_FILES) throw new Error(UI_TEXT.nodeErrors.tooLarge)
    bytes += await copyData(from, to, NODE_GIT_IMPORT_MAX_BYTES - bytes, signal)
  }
  const importTree = async (relative: string, from: string): Promise<void> => {
    signal.throwIfAborted()
    count += 1
    if (count > NODE_GIT_IMPORT_MAX_FILES) throw new Error(UI_TEXT.nodeErrors.tooLarge)
    const info = await lstatIdentity(from)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(UI_TEXT.nodeErrors.forbidden)
    const directory = await open(
      from,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    try {
      if (!sameFile(info, await handleIdentity(directory)))
        throw new Error(UI_TEXT.nodeErrors.conflict)
      const heldPath = `${NODE_PROC_FD_ROOT}/${String(directory.fd)}`
      await mkdir(path.join(gitDir, relative), { mode: NODE_DIRECTORY_MODE })
      const entries = await opendir(heldPath, { bufferSize: 1 })
      for await (const entry of entries) {
        const child = `${relative}/${entry.name}`
        nodeRelativePathSchema.parse(child)
        if (
          child === 'objects/info/alternates' ||
          child === 'objects/info/http-alternates' ||
          child.startsWith('refs/replace/')
        )
          throw new Error(UI_TEXT.nodeErrors.forbidden)
        if (entry.isDirectory()) await importTree(child, `${heldPath}/${entry.name}`)
        else await importFile(`${heldPath}/${entry.name}`, path.join(gitDir, child))
      }
    } finally {
      await directory.close()
    }
  }
  try {
    await mkdir(gitDir, { mode: NODE_DIRECTORY_MODE })
    // The fixed inert config is constructed here, not parsed from .git/config.
    nodeGitRepositoryConfigSchema.parse({
      'core.repositoryformatversion': '0',
      'core.filemode': 'true',
      'core.bare': 'false',
    })
    await writeFile(path.join(gitDir, 'config'), NODE_GIT_SNAPSHOT_CONFIG, {
      mode: NODE_FILE_MODE,
      flag: 'wx',
    })
    await importFile(`${sourcePath}/HEAD`, path.join(gitDir, 'HEAD'))
    for (const directory of ['objects', 'refs'])
      await importTree(directory, `${sourcePath}/${directory}`)
    for (const name of ['index', 'packed-refs', 'shallow']) {
      try {
        await importFile(`${sourcePath}/${name}`, path.join(gitDir, name))
      } catch (error: unknown) {
        if (!isMissingFile(error)) throw error
      }
    }
    // Only the private imported HEAD is inspected, so another tools process
    // cannot change the command's Git configuration between checking and use.
    const head = await open(path.join(gitDir, 'HEAD'), 'r')
    let headBytes: string
    try {
      headBytes = await head.readFile('utf8')
    } finally {
      await head.close()
    }
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64}|ref: refs\/heads\/[^\p{Cc}\\ ]+)\n?$/u.test(headBytes))
      throw new Error(UI_TEXT.nodeErrors.invalidRequest)
    return {
      gitDir,
      workTree,
      headBytes,
      dispose: async () => {
        await rm(gitDir, { recursive: true, force: true })
      },
    }
  } catch (error: unknown) {
    await rm(gitDir, { recursive: true, force: true })
    throw error
  } finally {
    await sourceHandle.close()
  }
}
