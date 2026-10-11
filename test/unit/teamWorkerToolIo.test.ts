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
import {
  WORKER_NATIVE_IO,
  assertWorkerRoot,
  type WorkerPathInput,
} from '../../src/core/team/workers/workerFence'
import type { WorkerRolePolicy } from '../../src/core/team/workers/workerTypes'
import { acpFsWrite } from '../../src/core/team/workers/acpWorker'
import {
  confineWorkerPath,
  MuseWorkerFolderError,
  withWorkerFile,
} from '../../src/host/team/teamHostEntry'

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

async function replaceCopy(copy: string): Promise<void> {
  await rename(copy, `${copy}-old`)
  await mkdir(path.join(copy, 'src'), { recursive: true })
  await writeFile(path.join(copy, 'src', 'a.ts'), 'replacement')
}

function openingFence(
  base: ToolIo,
  input: WorkerPathInput,
  beforeOpen: () => Promise<void>,
): ToolIo {
  const nativeOpen = WORKER_NATIVE_IO.openFile
  if (nativeOpen === undefined) return refuse()
  return fenceWorkerToolIo(base, {
    input: {
      ...input,
      io: {
        ...WORKER_NATIVE_IO,
        openFile: async (absolute, isWrite) => {
          await beforeOpen()
          return await nativeOpen(absolute, isWrite)
        },
      },
    },
    role: WRITER,
    admit: () => undefined,
  })
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
          await replaceCopy(copy)
          return await readFile(absolute, 'utf8')
        },
      },
      { input, role: WRITER, admit: () => undefined },
    )
    expect(await io.readFile(path.join(copy, 'src', 'a.ts'))).toBe('a\n')
  })

  it('R4-1: refuses a root replaced between admission and the opened handle', async () => {
    const { copy, base, input } = await setup()
    const io = openingFence(base, input, () => replaceCopy(copy))
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
    const io = openingFence(base, input, async () => {
      await rename(path.join(copy, 'src'), path.join(copy, 'src-old'))
      await symlink(user, path.join(copy, 'src'), process.platform === 'win32' ? 'junction' : 'dir')
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

describe('RVCM963E write admission', () => {
  it.each(
    [
      {
        name: 'read-only',
        role: { ...WRITER, workspaceMode: 'read-only' as const },
        file: 'src/new.ts',
      },
      { name: 'no write group', role: { ...WRITER, toolGroups: [] }, file: 'src/new.ts' },
      { name: 'write-paths', role: { ...WRITER, writePaths: ['docs/**'] }, file: 'src/new.ts' },
      { name: 'protected path', role: WRITER, file: '.git/new-hook' },
      { name: 'protected case alias', role: WRITER, file: '.GiT/new-hook' },
    ].flatMap((testCase) => [false, true].map((isExisting) => ({ ...testCase, isExisting }))),
  )(
    'R5-3: refused $name write neither opens nor creates its target (existing=$isExisting)',
    async ({ role, file, isExisting }) => {
      const { copy, base, input } = await setup(role)
      await mkdir(path.dirname(path.join(copy, file)), { recursive: true })
      const target = path.join(copy, file)
      if (isExisting) await writeFile(target, 'before')
      let opens = 0
      const checkedInput: typeof input = {
        ...input,
        io: {
          ...WORKER_NATIVE_IO,
          openFile: async (...args) => {
            opens += 1
            return WORKER_NATIVE_IO.openFile === undefined
              ? refuse()
              : await WORKER_NATIVE_IO.openFile(...args)
          },
        },
      }
      const io = fenceWorkerToolIo(base, {
        input: checkedInput,
        role,
        admit: () => undefined,
      })
      await expect(io.writeFile(target, 'attack')).rejects.toThrow()
      expect(opens).toBe(0)
      await expect(acpFsWrite({ ...checkedInput, role }, target, 'attack')).resolves.toHaveProperty(
        'error',
      )
      expect(opens).toBe(0)
      if (isExisting) expect(await readFile(target, 'utf8')).toBe('before')
      else await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )

  it.each([false, true])(
    'R5-3: a new path through an outside parent leaves no file (swap=%s)',
    async (isSwapped) => {
      const { copy, user, base, input } = await setup()
      const nativeOpen = WORKER_NATIVE_IO.openFile
      if (nativeOpen === undefined) return refuse()
      const swap = async () => {
        await rename(path.join(copy, 'src'), path.join(copy, 'src-old'))
        await symlink(
          user,
          path.join(copy, 'src'),
          process.platform === 'win32' ? 'junction' : 'dir',
        )
      }
      if (isSwapped) await writeFile(path.join(copy, 'src', 'planted.ts'), 'before')
      else await swap()
      const io = fenceWorkerToolIo(base, {
        input: {
          ...input,
          io: {
            ...WORKER_NATIVE_IO,
            openFile: async (...args) => {
              if (isSwapped) await swap()
              return await nativeOpen(...args)
            },
          },
        },
        role: WRITER,
        admit: () => undefined,
      })
      await expect(io.writeFile(path.join(copy, 'src', 'planted.ts'), 'attack')).rejects.toThrow()
      await expect(readFile(path.join(user, 'planted.ts'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
      if (isSwapped)
        expect(await readFile(path.join(copy, 'src-old', 'planted.ts'), 'utf8')).toBe('before')
      else
        await expect(readFile(path.join(copy, 'src-old', 'planted.ts'))).rejects.toMatchObject({
          code: 'ENOENT',
        })
    },
  )

  it('R5-3: a parent switched to a protected directory after preflight cannot change its bytes', async () => {
    const { copy, base, input } = await setup()
    const protectedFile = path.join(copy, '.git', 'a.ts')
    await writeFile(protectedFile, 'before')
    const io = openingFence(base, input, async () => {
      await rename(path.join(copy, 'src'), path.join(copy, 'src-old'))
      await symlink(
        path.join(copy, '.git'),
        path.join(copy, 'src'),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
    })
    await expect(io.writeFile(path.join(copy, 'src', 'a.ts'), 'attack')).rejects.toThrow()
    expect(await readFile(protectedFile, 'utf8')).toBe('before')
  })

  it('R5-3: portable native writes never create even an allowed new target', async () => {
    const { copy, io } = await setup()
    const target = path.join(copy, 'src', 'new.ts')
    await expect(io.writeFile(target, 'new')).rejects.toThrow()
    await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' })
    const opening = (async () => {
      const handle = await WORKER_NATIVE_IO.openFile?.(target, true)
      await handle?.close()
    })()
    await expect(opening).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('R5-bundle: the lazy host entry exports the retained grant authority', async () => {
    const { copy, user, input } = await setup()
    expect(await confineWorkerPath(input, path.join(copy, 'src', 'a.ts'))).toMatchObject({
      ok: true,
    })
    expect(await withWorkerFile(input, 'src/a.ts', false, (handle) => handle.read(100))).toBe('a\n')
    const outside = path.join(user, 'outside.ts')
    await writeFile(outside, 'outside')
    await expect(
      withWorkerFile(input, outside, false, (handle) => handle.read(100)),
    ).rejects.toBeInstanceOf(MuseWorkerFolderError)
  })
})
