import { createHash } from 'node:crypto'
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  rm,
  symlink,
  link,
  truncate,
  rename,
} from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as identity from '../../src/core/fs/fileIdentity'
import * as filesystem from 'node:fs/promises'
import { createNodeFileMethods, type NodeFileWorkspacePort } from '../../src/runtime/node/web/files'
import { NodeListenerError } from '../../src/runtime/node/listenerGuard'
import {
  NODE_HTTP_STATUS,
  NODE_MAX_FILE_BYTES,
  NODE_MAX_PAGE_ITEMS,
  UI_TEXT,
} from '../../src/shared/constants'
import { nodeErrorCode } from './helpers/nodeErrorCode'

vi.mock('node:fs/promises', { spy: true })

const directories: string[] = []
const signal = () => new AbortController().signal
const digest = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')
function atSecondIdentity(
  update: (sample: Awaited<ReturnType<typeof identity.handleIdentity>>) => Promise<void> | void,
) {
  const actual = identity.handleIdentity
  let samples = 0
  vi.spyOn(identity, 'handleIdentity').mockImplementation(async (handle) => {
    const result = await actual(handle)
    samples += 1
    if (samples === 2) await update(result)
    return result
  })
}
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'm110-u1-files-')))
  directories.push(root)
  await mkdir(path.join(root, 'src'))
  await writeFile(path.join(root, 'src', 'example.txt'), 'hello\n')
  const replace = vi.fn<NodeFileWorkspacePort['replace']>(async (input, abort) => {
    abort.throwIfAborted()
    const file = path.join(root, input.path)
    let previous: string | null = null
    try {
      previous = digest(await readFile(file))
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    // N's publisher refuses a stale digest with the typed catalog code,
    // never a raw error (U3 guards every handler): the refusal is
    // `conflict`, and the competing bytes stay.
    if (previous !== input.expectedDigest) throw new NodeListenerError('conflict')
    await writeFile(file, input.data)
    return { digest: digest(input.data) }
  })
  const port = {
    root: vi.fn((workspaceId: string) => {
      return workspaceId === 'repo'
        ? Promise.resolve(root)
        : Promise.reject(new Error('unknown workspace'))
    }),
    replace,
  }
  return {
    root,
    port,
    methods: createNodeFileMethods(port),
    file: { workspaceId: 'repo', path: 'src/example.txt' },
  }
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

describe('M110-U1 files runtime boundary', () => {
  it('H10 binds returned bytes to the parsed path even when the caller mutates its object', async () => {
    const { methods, file, root, port } = await fixture()
    port.root.mockImplementationOnce(() => {
      file.path = 'src/other.txt'
      return Promise.resolve(root)
    })
    expect(await methods.read(file, signal())).toEqual({
      path: 'src/example.txt',
      text: 'hello\n',
      digest: digest('hello\n'),
    })
  })
  it('browses, searches, reads, saves and transfers exact bytes with digest preconditions', async () => {
    const { methods, file, port } = await fixture()
    const listed = await methods.list(
      { workspaceId: 'repo', directory: null, cursor: null },
      signal(),
    )
    expect(listed.entries).toEqual([{ path: 'src', kind: 'directory', sizeBytes: 0 }])
    const found = await methods.search(
      { workspaceId: 'repo', query: 'EXAMPLE', cursor: null },
      signal(),
    )
    expect(found.entries[0]?.path).toBe(file.path)
    expect(await methods.read(file, signal())).toEqual({
      path: file.path,
      text: 'hello\n',
      digest: digest('hello\n'),
    })
    await methods.write({ ...file, expectedDigest: digest('hello\n'), text: 'saved\n' }, signal())
    expect(port.replace.mock.calls[0]?.[0].expectedDigest).toBe(digest('hello\n'))
    expect(await methods.download(file, signal())).toEqual({
      data: Buffer.from('saved\n').toString('base64'),
      digest: digest('saved\n'),
    })
    const bytes = Buffer.from([0, 255, 12, 3])
    await methods.upload(
      {
        workspaceId: 'repo',
        path: 'binary.dat',
        expectedDigest: null,
        data: bytes.toString('base64'),
        digest: digest(bytes),
      },
      signal(),
    )
    expect(await methods.download({ workspaceId: 'repo', path: 'binary.dat' }, signal())).toEqual({
      data: bytes.toString('base64'),
      digest: digest(bytes),
    })
  })
  it('H10 preserves a competing edit instead of widening the expected digest', async () => {
    const { methods, root, file } = await fixture()
    const original = await methods.read(file, signal())
    await writeFile(path.join(root, file.path), 'concurrent edit')
    await expect(
      methods.write({ ...file, expectedDigest: original.digest, text: 'overwrite' }, signal()),
    ).rejects.toThrow(UI_TEXT.nodeErrors.conflict)
    expect(await readFile(path.join(root, file.path), 'utf8')).toBe('concurrent edit')
  })
  it.each([
    '../outside',
    '/absolute',
    String.raw`src\example.txt`,
    'src/../example.txt',
    'bad\0path',
  ])('H10 refuses path %s before any filesystem or publication access', async (badPath) => {
    const { methods, port } = await fixture()
    await expect(methods.read({ workspaceId: 'repo', path: badPath }, signal())).rejects.toThrow()
    await expect(
      methods.write(
        { workspaceId: 'repo', path: badPath, expectedDigest: null, text: 'bad' },
        signal(),
      ),
    ).rejects.toThrow()
    expect(port.root).not.toHaveBeenCalled()
    expect(port.replace).not.toHaveBeenCalled()
  })
  it('H10 refuses leaf/ancestor symlinks and hard-linked files', async () => {
    const { root, methods, file } = await fixture()
    await symlink(path.join(root, 'src'), path.join(root, 'linked'))
    await symlink(path.join(root, file.path), path.join(root, 'leaf.txt'))
    await expect(
      methods.read({ workspaceId: 'repo', path: 'linked/example.txt' }, signal()),
    ).rejects.toThrow()
    await link(path.join(root, file.path), path.join(root, 'hard.txt'))
    const opening = vi.spyOn(filesystem, 'open')
    for (const name of ['linked/example.txt', 'leaf.txt', 'hard.txt'])
      await expect(methods.read({ workspaceId: 'repo', path: name }, signal())).rejects.toThrow()
    expect(opening).not.toHaveBeenCalled()
  })
  it('H10 refuses a workspace root reached through a symlink above that root', async () => {
    const { root, port, file } = await fixture()
    await symlink(root, path.join(root, 'alias'))
    port.root.mockResolvedValueOnce(path.join(root, 'alias', 'src'))
    await expect(
      createNodeFileMethods(port).read({ ...file, path: 'example.txt' }, signal()),
    ).rejects.toThrow()
  })
  it('H10 refuses an ancestor swap during a held-file read before returning bytes', async () => {
    const { root, methods, file } = await fixture()
    atSecondIdentity(async () => {
      await rename(path.join(root, 'src'), path.join(root, 'moved'))
      await mkdir(path.join(root, 'src'))
      await writeFile(path.join(root, file.path), 'substitute')
    })
    await expect(methods.read(file, signal())).rejects.toThrow()
  })
  it('H10 refuses a hard link created after preflight and before the opened sample', async () => {
    const { root, methods, file } = await fixture()
    const actual = filesystem.open
    vi.spyOn(filesystem, 'open').mockImplementationOnce(async (...args) => {
      const handle = await actual(...args)
      await link(path.join(root, file.path), path.join(root, 'late-hard.txt'))
      return handle
    })
    await expect(methods.read(file, signal())).rejects.toThrow()
  })
  it.each(['inode', 'size'] as const)(
    'H10 refuses a changed opened %s before reading any bytes',
    async (kind) => {
      const { root, methods, file } = await fixture()
      const actual = filesystem.open
      const reads: (() => number)[] = []
      vi.spyOn(filesystem, 'open').mockImplementationOnce(async (...args) => {
        if (kind === 'inode')
          await rename(path.join(root, file.path), path.join(root, 'previous.txt'))
        await writeFile(path.join(root, file.path), kind === 'inode' ? 'other\n' : 'larger\n')
        const handle = await actual(...args)
        const reading = vi.spyOn(handle, 'read')
        reads.push(() => reading.mock.calls.length)
        return handle
      })
      await expect(methods.read(file, signal())).rejects.toThrow(UI_TEXT.nodeErrors.conflict)
      expect(reads.map((count) => count())).toEqual([0])
    },
  )
  it.each(['size', 'mtimeNs', 'ctimeNs'] as const)(
    'H10 refuses a changed opened-file %s before returning bytes',
    async (field) => {
      const { methods, file } = await fixture()
      atSecondIdentity((sample) => {
        Object.defineProperty(sample, field, { value: sample[field] + 1n })
      })
      await expect(methods.read(file, signal())).rejects.toThrow(UI_TEXT.nodeErrors.conflict)
    },
  )
  it('H10 refuses a short held read instead of returning an empty success', async () => {
    const { methods, file } = await fixture()
    const actual = filesystem.open
    vi.spyOn(filesystem, 'open').mockImplementationOnce(async (...args) => {
      const handle = await actual(...args)
      vi.spyOn(handle, 'read').mockResolvedValue({ bytesRead: 0, buffer: Buffer.alloc(0) })
      return handle
    })
    await expect(methods.read(file, signal())).rejects.toThrow(UI_TEXT.nodeErrors.conflict)
  })
  it('H10 refuses a non-file leaf before opening it', async () => {
    const { methods, root } = await fixture()
    const actual = identity.lstatIdentity
    // A filesystem can report one link for a directory. Its kind must
    // independently refuse admission rather than relying on link count.
    vi.spyOn(identity, 'lstatIdentity').mockImplementation(async (name) => {
      const result = await actual(name)
      if (name === path.join(root, 'src')) Object.defineProperty(result, 'nlink', { value: 1n })
      return result
    })
    const opening = vi.spyOn(filesystem, 'open')
    await expect(methods.read({ workspaceId: 'repo', path: 'src' }, signal())).rejects.toThrow()
    expect(opening).not.toHaveBeenCalled()
  })
  it('H09 stops a file that grows during its bounded read before a final sample', async () => {
    const { root, methods, file } = await fixture()
    const actual = identity.handleIdentity
    const samples = vi.spyOn(identity, 'handleIdentity').mockImplementationOnce(async (handle) => {
      const result = await actual(handle)
      await truncate(path.join(root, file.path), NODE_MAX_FILE_BYTES + 1)
      return result
    })
    await expect(methods.read(file, signal())).rejects.toThrow(UI_TEXT.nodeErrors.tooLarge)
    expect(samples).toHaveBeenCalledOnce()
  })
  it('H08 refuses cancelled reads and listings before workspace lookup', async () => {
    const { methods, file, port } = await fixture()
    const controller = new AbortController()
    controller.abort()
    await expect(methods.read(file, controller.signal)).rejects.toThrow()
    await expect(
      methods.list({ workspaceId: 'repo', directory: null, cursor: null }, controller.signal),
    ).rejects.toThrow()
    expect(port.root).not.toHaveBeenCalled()
  })
  it('H08 refuses lookup delivered after cancellation before path resolution', async () => {
    const { methods, file, port, root } = await fixture()
    const controller = new AbortController()
    const resolving = vi.spyOn(filesystem, 'realpath').mockClear()
    port.root.mockImplementationOnce(() => {
      controller.abort()
      return Promise.resolve(root)
    })
    await expect(methods.read(file, controller.signal)).rejects.toThrow()
    expect(resolving).not.toHaveBeenCalled()
  })
  it('H09 rejects oversized files, multibyte writes and uploads before publication', async () => {
    const { root, methods, file, port } = await fixture()
    await truncate(path.join(root, file.path), NODE_MAX_FILE_BYTES + 1)
    const opening = vi.spyOn(filesystem, 'open')
    await expect(methods.read(file, signal())).rejects.toThrow()
    expect(opening).not.toHaveBeenCalled()
    await expect(
      methods.write(
        { ...file, expectedDigest: null, text: 'é'.repeat(NODE_MAX_FILE_BYTES) },
        signal(),
      ),
    ).rejects.toThrow()
    const bytes = Buffer.alloc(NODE_MAX_FILE_BYTES + 1)
    await expect(
      methods.upload(
        { ...file, expectedDigest: null, data: bytes.toString('base64'), digest: digest(bytes) },
        signal(),
      ),
    ).rejects.toThrow()
    expect(port.replace).not.toHaveBeenCalled()
  })
  it('H10 rejects wrong upload digest and wrong publisher receipt', async () => {
    const { methods, file, port } = await fixture()
    await expect(
      methods.upload(
        { ...file, expectedDigest: null, data: 'aGk=', digest: digest('wrong') },
        signal(),
      ),
    ).rejects.toThrow()
    expect(port.replace).not.toHaveBeenCalled()
    port.replace.mockResolvedValueOnce({ digest: digest('wrong') })
    await expect(
      methods.write({ ...file, expectedDigest: digest('hello\n'), text: 'new' }, signal()),
    ).rejects.toThrow()
  })
  it('throws typed listener errors so refusals map to their catalog code, not unavailable', async () => {
    const { root, methods, file, port } = await fixture()
    // A publisher receipt that does not describe the uploaded bytes.
    port.replace.mockResolvedValueOnce({ digest: digest('wrong') })
    expect(
      await nodeErrorCode(
        methods.write({ ...file, expectedDigest: digest('hello\n'), text: 'new' }, signal()),
      ),
    ).toBe('conflict')
    // A file grown past the byte bound.
    await truncate(path.join(root, file.path), NODE_MAX_FILE_BYTES + 1)
    expect(await nodeErrorCode(methods.read(file, signal()))).toBe('tooLarge')
    // An over-bound page cursor, refused before filesystem access.
    // (A cursor outside the identifier shape is refused earlier by the
    // catalog parse, which the listener already maps to invalidRequest.)
    port.root.mockClear()
    expect(
      await nodeErrorCode(
        methods.list({ workspaceId: 'repo', directory: null, cursor: 'page-10001' }, signal()),
      ),
    ).toBe('invalidRequest')
    expect(port.root).not.toHaveBeenCalled()
    // A symlinked leaf, refused before opening.
    await symlink(path.join(root, file.path), path.join(root, 'leaf.txt'))
    expect(
      await nodeErrorCode(methods.read({ workspaceId: 'repo', path: 'leaf.txt' }, signal())),
    ).toBe('forbidden')
    // The listener maps the typed code to its HTTP status; a plain
    // Error would have become unavailable (503) instead.
    expect(NODE_HTTP_STATUS.conflict).toBe(409)
    expect(NODE_HTTP_STATUS.tooLarge).toBe(413)
  })
  it('H09 paginates a directory and refuses forged cursors', async () => {
    const { root, methods } = await fixture()
    await Promise.all(
      Array.from({ length: NODE_MAX_PAGE_ITEMS }, (_, index) =>
        writeFile(path.join(root, `file-${String(index).padStart(4, '0')}`), ''),
      ),
    )
    const first = await methods.list(
      { workspaceId: 'repo', directory: null, cursor: null },
      signal(),
    )
    expect(first.entries).toHaveLength(NODE_MAX_PAGE_ITEMS)
    expect(first.nextCursor).toBe('page-1000')
    const last = await methods.list(
      { workspaceId: 'repo', directory: null, cursor: first.nextCursor },
      signal(),
    )
    expect(last.entries).toHaveLength(1)
    expect(last.nextCursor).toBeNull()
    await expect(
      methods.list({ workspaceId: 'repo', directory: null, cursor: '../secret' }, signal()),
    ).rejects.toThrow()
  })
  it('H09 refuses invalid or over-bound cursors before filesystem access', async () => {
    const { methods, port } = await fixture()
    for (const cursor of ['wrong', 'page-10001', 'page-9007199254740992'])
      await expect(
        methods.list({ workspaceId: 'repo', directory: null, cursor }, signal()),
      ).rejects.toThrow()
    expect(port.root).not.toHaveBeenCalled()
  })
  it('H09 stops a directory flood before inspecting invalid entries', async () => {
    const { root, methods } = await fixture()
    const children = await filesystem.readdir(root, { withFileTypes: true })
    const child = children[0]
    if (child === undefined) throw new Error('fixture has no entry')
    Object.defineProperty(child, 'name', { value: String.raw`invalid\path` })
    const directory = await filesystem.opendir(root)
    vi.spyOn(directory, Symbol.asyncIterator).mockImplementation(async function* () {
      for (let index = 0; index <= 10_000; index += 1) yield child
      await Promise.resolve()
    })
    vi.spyOn(filesystem, 'opendir').mockResolvedValueOnce(directory)
    try {
      await expect(
        methods.list({ workspaceId: 'repo', directory: null, cursor: null }, signal()),
      ).rejects.toThrow()
    } finally {
      await directory.close()
    }
  })
  it('refuses unknown workspace, missing file, invalid UTF-8 and cancellation', async () => {
    const { root, methods, file, port } = await fixture()
    await expect(methods.read({ ...file, workspaceId: 'missing' }, signal())).rejects.toThrow()
    await expect(methods.read({ ...file, path: 'missing' }, signal())).rejects.toThrow()
    await writeFile(path.join(root, file.path), Buffer.from([255]))
    await expect(methods.read(file, signal())).rejects.toThrow()
    const controller = new AbortController()
    controller.abort()
    await expect(
      methods.write({ ...file, text: 'new', expectedDigest: null }, controller.signal),
    ).rejects.toThrow()
    expect(port.replace).not.toHaveBeenCalled()
  })
})
