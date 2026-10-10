// RVCM963 finding 1: an engine worker's file tools admit every path against
// the retained root grant and the resolved role policy. Real folders, real
// identities; the base I/O is a plain file-system adapter.

import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import { fenceWorkerToolIo } from '../../src/core/team/workers/workerToolIo'
import { WORKER_NATIVE_IO, assertWorkerRoot } from '../../src/core/team/workers/workerFence'
import type { WorkerRolePolicy } from '../../src/core/team/workers/workerTypes'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function refuse(): never {
  throw new Error('not used here')
}

function plainIo(): ToolIo & { readonly writes: string[] } {
  const writes: string[] = []
  return {
    writes,
    readFile: async (absolute) => {
      try {
        return await readFile(absolute, 'utf8')
      } catch {
        return undefined
      }
    },
    readBytes: () => refuse(),
    writeFile: async (absolute, content) => {
      writes.push(absolute)
      await mkdir(path.dirname(absolute), { recursive: true })
      await writeFile(absolute, content)
    },
    writeFileIfUnchanged: () => refuse(),
    pathExists: () => Promise.resolve(true),
    reserveFile: () => refuse(),
    hasUnsavedChanges: () => false,
    unsavedFiles: () => [],
    listFiles: () => Promise.resolve([]),
    searchFiles: () => refuse(),
    runShell: () => refuse(),
    realPath: (absolute) => realpath(absolute),
  }
}

const WRITER: WorkerRolePolicy = {
  roleId: 'engineering',
  workspaceMode: 'own-branch',
  toolGroups: ['read', 'write'],
  reportShape: 'summary',
}

async function setup(role: WorkerRolePolicy = WRITER, admit: () => void = () => undefined) {
  const temp = await realpath(await mkdtemp(path.join(tmpdir(), 'muse-fence-')))
  roots.push(temp)
  const user = path.join(temp, 'user')
  const copy = path.join(temp, 'store', 'copy')
  await mkdir(path.join(copy, '.git'), { recursive: true })
  await mkdir(path.join(copy, 'src'), { recursive: true })
  await mkdir(user, { recursive: true })
  await writeFile(path.join(copy, '.git', 'config'), '[core]\n')
  await writeFile(path.join(copy, 'src', 'a.ts'), 'a\n')
  const input = {
    folder: copy,
    platform: process.platform,
    io: WORKER_NATIVE_IO,
    workspaceRoot: user,
  }
  const grant = await assertWorkerRoot(input)
  const base = plainIo()
  const io = fenceWorkerToolIo(base, { input: { ...input, grant }, role, admit })
  return { temp, user, copy, base, io, input: { ...input, grant } }
}

describe("an engine worker's fenced file tools", () => {
  it('writes existing files through a handle and refuses path-based creation', async () => {
    const { copy, io } = await setup()
    await io.writeFile(path.join(copy, 'src', 'a.ts'), 'changed\n')
    await expect(io.writeFile(path.join(copy, 'src', 'deep', 'new.ts'), 'new\n')).rejects.toThrow()
    expect(await io.readFile(path.join(copy, 'src', 'a.ts'))).toBe('changed\n')
  })

  it('refuse a protected path such as .git/config', async () => {
    const { copy, base, io } = await setup()
    await expect(io.writeFile(path.join(copy, '.git', 'config'), 'x')).rejects.toThrow()
    expect(base.writes).toEqual([])
  })

  it("refuse a write outside the role's write-paths", async () => {
    const { copy, base, io } = await setup({ ...WRITER, writePaths: ['docs/**'] })
    await expect(io.writeFile(path.join(copy, 'src', 'a.ts'), 'x')).rejects.toThrow()
    await mkdir(path.join(copy, 'docs'))
    await writeFile(path.join(copy, 'docs', 'guide.md'), 'before')
    await io.writeFile(path.join(copy, 'docs', 'guide.md'), 'ok\n')
    expect(await readFile(path.join(copy, 'docs', 'guide.md'), 'utf8')).toBe('ok\n')
    expect(base.writes).toEqual([])
  })

  it('let a read-only role read and write nothing', async () => {
    const { copy, base, io } = await setup({
      ...WRITER,
      roleId: 'research',
      workspaceMode: 'read-only',
      toolGroups: ['read'],
    })
    expect(await io.readFile(path.join(copy, 'src', 'a.ts'))).toBe('a\n')
    await expect(io.writeFile(path.join(copy, 'src', 'b.ts'), 'x')).rejects.toThrow()
    expect(base.writes).toEqual([])
  })

  it('refuse every path outside the copy, read or write', async () => {
    const { user, copy, base, io } = await setup()
    await writeFile(path.join(user, 'secret.txt'), 'secret\n')
    await expect(io.readFile(path.join(user, 'secret.txt'))).rejects.toThrow()
    await expect(
      io.writeFile(path.join(copy, '..', '..', 'user', 'escaped.txt'), 'x'),
    ).rejects.toThrow()
    await expect(io.writeFile(path.join(user, 'escaped.txt'), 'x')).rejects.toThrow()
    expect(base.writes).toEqual([])
  })

  it('refuse every call once the copy is replaced at its path', async () => {
    const { copy, base, io } = await setup()
    await rename(copy, `${copy}-old`)
    await mkdir(path.join(copy, 'src'), { recursive: true })
    await expect(io.writeFile(path.join(copy, 'src', 'a.ts'), 'x')).rejects.toThrow()
    await expect(io.readFile(path.join(copy, 'src', 'a.ts'))).rejects.toThrow()
    expect(base.writes).toEqual([])
  })

  it("stop at the next file call when the task's admission refuses", async () => {
    let isTrusted = true
    const { copy, base, io } = await setup(WRITER, () => {
      if (!isTrusted) throw new Error('untrusted')
    })
    await io.writeFile(path.join(copy, 'src', 'a.ts'), 'first\n')
    isTrusted = false
    await expect(io.writeFile(path.join(copy, 'src', 'after-revoke.ts'), 'x')).rejects.toThrow(
      'untrusted',
    )
    expect(base.writes).toEqual([])
    expect(await readFile(path.join(copy, 'src', 'a.ts'), 'utf8')).toBe('first\n')
  })
})

describe('RVCM963C operation-bound handles', () => {
  it('R4-1: does not reopen a pathname through admitted base callbacks', async () => {
    const { copy, base, input } = await setup()
    const io = fenceWorkerToolIo(
      {
        ...base,
        readFile: async (absolute) => {
          await rename(copy, `${copy}-old`)
          await mkdir(path.join(copy, 'src'), { recursive: true })
          await writeFile(path.join(copy, 'src', 'a.ts'), 'replacement')
          return await readFile(absolute, 'utf8')
        },
      },
      { input, role: WRITER, admit: () => undefined },
    )
    expect(await io.readFile(path.join(copy, 'src', 'a.ts'))).toBe('a\n')
  })

  it('R4-1: refuses a root replaced between admission and the opened handle', async () => {
    const { copy, base, input } = await setup()
    const nativeOpen = WORKER_NATIVE_IO.openFile
    if (nativeOpen === undefined) throw new Error('native handle port missing')
    const io = fenceWorkerToolIo(base, {
      input: {
        ...input,
        io: {
          ...WORKER_NATIVE_IO,
          openFile: async (absolute, isWrite) => {
            await rename(copy, `${copy}-old`)
            await mkdir(path.join(copy, 'src'), { recursive: true })
            await writeFile(path.join(copy, 'src', 'a.ts'), 'replacement')
            return await nativeOpen(absolute, isWrite)
          },
        },
      },
      role: WRITER,
      admit: () => undefined,
    })
    await expect(io.writeFile(path.join(copy, 'src', 'a.ts'), 'attack')).rejects.toThrow()
    expect(await readFile(path.join(copy, 'src', 'a.ts'), 'utf8')).toBe('replacement')
  })

  it('R4-1: refuses hard links to a file outside the granted copy', async () => {
    const { copy, user, io } = await setup()
    const secret = path.join(user, 'secret.txt')
    await writeFile(secret, 'secret')
    await link(secret, path.join(copy, 'src', 'alias.ts'))
    await expect(io.writeFile(path.join(copy, 'src', 'alias.ts'), 'attack')).rejects.toThrow()
    expect(await readFile(secret, 'utf8')).toBe('secret')
    await expect(io.readFile(path.join(copy, 'src', 'alias.ts'))).rejects.toThrow()
  })

  it('R4-1: refuses a parent symlink or junction swapped before open', async () => {
    const { copy, user, base, input } = await setup()
    await writeFile(path.join(user, 'a.ts'), 'secret')
    const nativeOpen = WORKER_NATIVE_IO.openFile
    if (nativeOpen === undefined) throw new Error('native handle port missing')
    const io = fenceWorkerToolIo(base, {
      input: {
        ...input,
        io: {
          ...WORKER_NATIVE_IO,
          openFile: async (absolute, isWrite) => {
            await rename(path.join(copy, 'src'), path.join(copy, 'src-old'))
            await symlink(
              user,
              path.join(copy, 'src'),
              process.platform === 'win32' ? 'junction' : 'dir',
            )
            return await nativeOpen(absolute, isWrite)
          },
        },
      },
      role: WRITER,
      admit: () => undefined,
    })
    await expect(io.writeFile(path.join(copy, 'src', 'a.ts'), 'attack')).rejects.toThrow()
    expect(await readFile(path.join(user, 'a.ts'), 'utf8')).toBe('secret')
  })
})

it('R4-1: a case alias of a protected directory cannot receive a write', async () => {
  const { copy, io } = await setup()
  const protectedDirectory = path.join(copy, '.GiT')
  await mkdir(protectedDirectory, { recursive: true })
  const protectedFile = path.join(protectedDirectory, 'CONFIG')
  await writeFile(protectedFile, 'before')
  await expect(io.writeFile(protectedFile, 'attack')).rejects.toThrow()
  expect(await readFile(protectedFile, 'utf8')).toBe('before')
})
