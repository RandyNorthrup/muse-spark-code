import { constants } from 'node:fs'
import { open, opendir, realpath, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { handleIdentity, lstatIdentity, sameFile } from '../../../core/fs/fileIdentity'
import {
  NODE_GIT_IMPORT_MAX_FILES,
  NODE_MAX_FILE_BYTES,
  NODE_MAX_PAGE_ITEMS,
  NODE_SINGLE_LINK,
} from '../../../shared/constants'
import { guardNodeMethod, NodeListenerError } from '../listenerGuard'
import {
  nodeMethods,
  type NodeMethodParams,
  type NodeMethodResult,
} from '../../../shared/hostApi/nodeMethods'
import { nodeRelativePathSchema } from '../../../shared/node'

/** N/C resolve a registered workspace, never a client-supplied absolute path.
Publication must execute as the tools UID with atomic containment, identity
and digest comparison. An unbound publisher refuses; no check/rename race
is presented as an atomic filesystem primitive. M110-U1-N-FILE-PUBLISH. */
export interface NodeFileWorkspacePort {
  root(workspaceId: string, signal: AbortSignal): Promise<string>
  replace(
    input: {
      workspaceId: string
      path: string
      expectedDigest: string | null
      data: Uint8Array
      digest: string
    },
    signal: AbortSignal,
  ): Promise<{ digest: string }>
  /** Files an unexpected method failure with the serve log. The report
  carries the raw error for the record; implementations print a fixed
  sentence, never its text (paths and prompts stay out of the log). */
  report(error: unknown): void
}

function digest(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function isWithin(root: string, file: string): boolean {
  const relative = path.relative(root, file).replaceAll('\\', '/')
  return (
    relative === '' ||
    (!relative.startsWith('../') && relative !== '..' && !path.isAbsolute(relative))
  )
}

/** Each ancestor is sampled without following links. Recheck before returning
bytes: a repository can rename parents while a read holds the final FD. */
async function checkedPath(root: string, relative: string | null) {
  if (relative !== null) nodeRelativePathSchema.parse(relative)
  const resolvedRoot = await realpath(root)
  if (path.resolve(root).replaceAll('\\', '/') !== resolvedRoot.replaceAll('\\', '/'))
    throw new NodeListenerError('forbidden')
  const names = [root]
  const parts = relative?.split('/') ?? []
  for (const part of parts) names.push(path.join(names.at(-1) ?? root, part))
  const identities: Awaited<ReturnType<typeof lstatIdentity>>[] = []
  for (const [index, name] of names.entries()) {
    const info = await lstatIdentity(name)
    if (info.isSymbolicLink() || (index < names.length - 1 && !info.isDirectory()))
      throw new NodeListenerError('forbidden')
    identities.push(info)
  }
  const file = names.at(-1) ?? root
  if (!isWithin(resolvedRoot, await realpath(file))) throw new NodeListenerError('forbidden')
  return {
    file,
    info: identities.at(-1),
    recheck: async () => {
      for (const [index, name] of names.entries()) {
        const previous = identities[index]
        const current = await lstatIdentity(name)
        if (previous === undefined || current.isSymbolicLink() || !sameFile(previous, current))
          throw new NodeListenerError('conflict')
      }
      if (!isWithin(resolvedRoot, await realpath(file))) throw new NodeListenerError('forbidden')
    },
  }
}

async function readBytes(root: string, relative: string, signal: AbortSignal): Promise<Buffer> {
  const checked = await checkedPath(root, relative)
  const before = checked.info
  if (before === undefined || !before.isFile() || before.nlink !== NODE_SINGLE_LINK)
    throw new NodeListenerError('forbidden')
  if (before.size > BigInt(NODE_MAX_FILE_BYTES)) throw new NodeListenerError('tooLarge')
  const handle = await open(
    checked.file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    const held = await handleIdentity(handle)
    if (!sameFile(before, held) || held.size !== before.size || held.nlink !== NODE_SINGLE_LINK)
      throw new NodeListenerError('conflict')
    const bytes = await boundedRead(handle, signal)
    const after = await handleIdentity(handle)
    if (
      after.size !== held.size ||
      after.mtimeNs !== held.mtimeNs ||
      after.ctimeNs !== held.ctimeNs ||
      bytes.length !== Number(held.size)
    )
      throw new NodeListenerError('conflict')
    await checked.recheck()
    signal.throwIfAborted()
    return bytes
  } finally {
    await handle.close()
  }
}

async function boundedRead(handle: FileHandle, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted()
  const bytes = Buffer.alloc(NODE_MAX_FILE_BYTES + 1)
  let length = 0
  for (;;) {
    signal.throwIfAborted()
    const result = await handle.read(bytes, length, bytes.length - length, null)
    length += result.bytesRead
    if (length > NODE_MAX_FILE_BYTES) throw new NodeListenerError('tooLarge')
    if (result.bytesRead === 0) return bytes.subarray(0, length)
  }
}

/** Fatal UTF-8 decoding refuses rather than replacing: a non-text file
is a typed `notText` refusal with its own message, never a raw
TypeError that the listener would report as `unavailable`. */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error: unknown) {
    // Fatal decoding fails only as a TypeError; anything else is a bug
    // the listener must see raw.
    if (error instanceof Error && error.name === 'TypeError') throw new NodeListenerError('notText')
    throw error
  }
}

function offsetOf(cursor: string | null): number {
  if (cursor === null) return 0
  if (!/^page-[0-9]+$/u.test(cursor)) throw new NodeListenerError('invalidRequest')
  const offset = Number(cursor.slice('page-'.length))
  if (!Number.isSafeInteger(offset) || offset > NODE_GIT_IMPORT_MAX_FILES)
    throw new NodeListenerError('invalidRequest')
  return offset
}

export function createNodeFileMethods(port: NodeFileWorkspacePort) {
  const listing = async (
    input: NodeMethodParams<'node/files/list'> | NodeMethodParams<'node/files/search'>,
    signal: AbortSignal,
  ) => {
    const isSearch = 'query' in input
    const params = isSearch
      ? nodeMethods['node/files/search'].params.parse(input)
      : nodeMethods['node/files/list'].params.parse(input)
    const offset = offsetOf(params.cursor)
    signal.throwIfAborted()
    const root = await port.root(params.workspaceId, signal)
    const directory = 'directory' in params ? params.directory : null
    const entries: NodeMethodResult<'node/files/list'>['entries'] = []
    let visited = 0
    const walk = async (relative: string | null): Promise<void> => {
      signal.throwIfAborted()
      const checked = await checkedPath(root, relative)
      if (checked.info?.isDirectory() !== true) throw new NodeListenerError('notFound')
      const children = await opendir(checked.file, { bufferSize: 1 })
      for await (const child of children) {
        signal.throwIfAborted()
        visited += 1
        if (visited > NODE_GIT_IMPORT_MAX_FILES) throw new NodeListenerError('tooLarge')
        if (child.name === '.git' || child.isSymbolicLink()) continue
        const name = relative === null ? child.name : `${relative}/${child.name}`
        if (!nodeRelativePathSchema.safeParse(name).success) continue
        const item = await checkedPath(root, name)
        const info = item.info
        if (
          info === undefined ||
          (!info.isFile() && !info.isDirectory()) ||
          (info.isFile() && info.nlink !== NODE_SINGLE_LINK)
        )
          continue
        if (
          !('query' in params) ||
          name.toLocaleLowerCase().includes(params.query.toLocaleLowerCase())
        )
          entries.push({
            path: name,
            kind: info.isDirectory() ? 'directory' : 'file',
            sizeBytes: info.isDirectory() ? 0 : Number(info.size),
          })
        if (isSearch && info.isDirectory()) await walk(name)
        await item.recheck()
      }
      await checked.recheck()
    }
    await walk(directory)
    entries.sort((left, right) => (left.path < right.path ? -1 : Number(left.path > right.path)))
    const next = offset + NODE_MAX_PAGE_ITEMS
    return nodeMethods['node/files/list'].result.parse({
      entries: entries.slice(offset, next),
      nextCursor: next < entries.length ? `page-${String(next)}` : null,
    })
  }
  const transfer = async (input: NodeMethodParams<'node/files/read'>, signal: AbortSignal) => {
    const params = nodeMethods['node/files/read'].params.parse(input)
    signal.throwIfAborted()
    const root = await port.root(params.workspaceId, signal)
    signal.throwIfAborted()
    return await readBytes(root, params.path, signal)
  }
  const publish = async (
    input: NodeMethodParams<'node/files/write'> | NodeMethodParams<'node/files/upload'>,
    signal: AbortSignal,
  ) => {
    const params =
      'text' in input
        ? nodeMethods['node/files/write'].params.parse(input)
        : nodeMethods['node/files/upload'].params.parse(input)
    const bytes =
      'text' in params ? Buffer.from(params.text, 'utf8') : Buffer.from(params.data, 'base64')
    const actual = digest(bytes)
    if ('digest' in params && params.digest !== actual)
      throw new NodeListenerError('invalidRequest')
    signal.throwIfAborted()
    const result = nodeMethods['node/files/write'].result.parse(
      await port.replace(
        {
          workspaceId: params.workspaceId,
          path: params.path,
          expectedDigest: params.expectedDigest,
          data: bytes,
          digest: actual,
        },
        signal,
      ),
    )
    if (result.digest !== actual) throw new NodeListenerError('conflict')
    return result
  }
  // Every handler crosses the typed boundary: no raw TypeError or Error
  // from the filesystem, the port or a result parse escapes (RVM110U2 P2 #2).
  // Unexpected failures are reported to the serve log before the typed
  // `unavailable` refusal reaches the person.
  const guard = <I, O>(work: (input: I, signal: AbortSignal) => Promise<O>) =>
    guardNodeMethod(work, (error) => {
      port.report(error)
    })
  return {
    list: guard(listing),
    search: guard(listing),
    read: guard(async (input: NodeMethodParams<'node/files/read'>, signal: AbortSignal) => {
      const params = nodeMethods['node/files/read'].params.parse(input)
      const bytes = await transfer(params, signal)
      return nodeMethods['node/files/read'].result.parse({
        path: params.path,
        text: decodeText(bytes),
        digest: digest(bytes),
      })
    }),
    download: guard(async (input: NodeMethodParams<'node/files/download'>, signal: AbortSignal) => {
      const bytes = await transfer(input, signal)
      return nodeMethods['node/files/download'].result.parse({
        data: bytes.toString('base64'),
        digest: digest(bytes),
      })
    }),
    write: guard(publish),
    upload: guard(publish),
  }
}
