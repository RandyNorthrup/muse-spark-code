// RVCM963 finding 1: an engine worker's file tools admit every path against
// the retained root grant and the resolved role policy. Real folders, real
// identities; the base I/O is a plain file-system adapter.

import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
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
  return { temp, user, copy, base, io }
}

describe("an engine worker's fenced file tools", () => {
  it('write new and existing files inside the copy', async () => {
    const { copy, io } = await setup()
    await io.writeFile(path.join(copy, 'src', 'a.ts'), 'changed\n')
    await io.writeFile(path.join(copy, 'src', 'deep', 'new.ts'), 'new\n')
    expect(await readFile(path.join(copy, 'src', 'deep', 'new.ts'), 'utf8')).toBe('new\n')
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
    await io.writeFile(path.join(copy, 'docs', 'guide.md'), 'ok\n')
    expect(base.writes).toEqual([path.join(copy, 'docs', 'guide.md')])
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
    expect(base.writes).toEqual([path.join(copy, 'src', 'a.ts')])
  })
})
