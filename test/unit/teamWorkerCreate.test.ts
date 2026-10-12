import { link, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  WORKER_NATIVE_IO,
  assertWorkerRoot,
  workerPathIdentity,
} from '../../src/core/team/workers/workerFence'
import type { WorkerCreateProof } from '../../src/core/team/workers/workerCreateEntry'
import type { WorkerFenceIo } from '../../src/core/team/workers/workerFence'
import type { WorkerRolePolicy } from '../../src/core/team/workers/workerTypes'
import { fenceWorkerToolIo } from '../../src/core/team/workers/workerToolIo'
import { acpFsWrite } from '../../src/core/team/workers/acpWorker'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import {
  compileCreatedVariant,
  nativeCreated,
  nativeScratch,
  useCreatedNative,
} from './helpers/createdNative'
import { configureResources } from '../../src/core/resources/admission'
import { UI_TEXT } from '../../src/shared/constants'

useCreatedNative()
const resources: { dispose: (() => void) | undefined } = { dispose: undefined }
beforeAll(() => {
  // The macOS fd-name probe runs through admission; other platforms ignore it.
  resources.dispose = configureResources({ inspect: () => undefined, onError: () => undefined })
})
afterAll(() => {
  resources.dispose?.()
})
const variants: {
  device?: Awaited<ReturnType<typeof compileCreatedVariant>>
  mount?: Awaited<ReturnType<typeof compileCreatedVariant>>
  race?: Awaited<ReturnType<typeof compileCreatedVariant>>
} = {}
beforeAll(async () => {
  variants.device = await compileCreatedVariant('test/unit/helpers/createdNativeDevice.c')
  if (process.platform !== 'win32')
    variants.race = await compileCreatedVariant('test/unit/helpers/workerCreateNativeRace.c')
  if (process.platform === 'linux')
    variants.mount = await compileCreatedVariant('test/unit/helpers/createdNativeMount.c')
}, 30_000) // Build each native interleaving fixture once, including the Windows job assembly.
const nativeReceipt = z.strictObject({ identity: z.string(), createdFolders: z.number() })
const WRITER: WorkerRolePolicy = {
  roleId: 'engineering',
  workspaceMode: 'own-branch',
  toolGroups: ['read', 'write'],
  reportShape: 'summary',
}
const refuseBase = () => Promise.reject(new Error('base pathname I/O must not run'))
const base: ToolIo = {
  readFile: refuseBase,
  readBytes: refuseBase,
  writeFile: refuseBase,
  writeFileIfUnchanged: refuseBase,
  reserveFile: refuseBase,
  pathExists: refuseBase,
  hasUnsavedChanges: () => false,
  unsavedFiles: () => [],
  listFiles: () => Promise.resolve([]),
  searchFiles: refuseBase,
  runShell: refuseBase,
  realPath: refuseBase,
}
async function runNative(proof: WorkerCreateProof, op: string, id = '') {
  const raw: unknown = JSON.parse(
    await nativeCreated([
      op,
      proof.root,
      proof.rootIdentity,
      proof.ancestor,
      proof.ancestorIdentity,
      proof.remaining,
      id,
    ]),
  )
  return nativeReceipt.parse(raw)
}

const state = { ordinal: 0 }
async function setup(role = WRITER, admit: () => void = () => undefined) {
  const fixture = path.join(nativeScratch(), `worker-${String(++state.ordinal)}`)
  const copy = path.join(fixture, 'copy')
  const user = path.join(fixture, 'user')
  await mkdir(path.join(copy, 'src'), { recursive: true })
  await mkdir(path.join(copy, '.git'))
  await mkdir(user)
  const native = vi.fn(runNative)
  const io = { ...WORKER_NATIVE_IO, workerNativeOperation: native }
  const initial = { folder: copy, workspaceRoot: user, platform: process.platform, io }
  const input = { ...initial, grant: await assertWorkerRoot(initial) }
  const withNative = (operation: NonNullable<WorkerFenceIo['workerNativeOperation']> = native) =>
    fenceWorkerToolIo(base, {
      input: { ...input, io: { ...io, workerNativeOperation: operation } },
      role,
      admit,
    })
  return {
    copy,
    user,
    native,
    input,
    role,
    tool: withNative(),
    withNative,
  }
}

describe('verified native worker creation', () => {
  it('NF reopened names honor platform separators and directory case', async () => {
    const { copy, tool } = await setup()
    const directory = process.platform === 'win32' ? 'SRC' : 'src'
    await tool.writeFile(path.join(copy, directory, 'case.ts'), 'case\n')
    expect(await readFile(path.join(copy, 'src', 'case.ts'), 'utf8')).toBe('case\n')
  })
  it('NF native check refuses a nonregular file without blocking', async () => {
    const { copy } = await setup()
    const target = path.join(copy, 'src', 'new')
    if (process.platform === 'win32') await mkdir(target)
    else await promisify(execFile)('/usr/bin/mkfifo', [target], { env: { LC_ALL: 'C' } })
    const proof = {
      root: copy,
      rootIdentity: await workerPathIdentity(copy),
      ancestor: 'src',
      ancestorIdentity: await workerPathIdentity(path.join(copy, 'src')),
      remaining: 'new',
    }
    await expect(
      runNative(proof, 'worker-check', await workerPathIdentity(target)),
    ).rejects.toThrow()
  })
  it.each(['hard-link', 'nonempty'])(
    'NF native release refuses an unchanged identity with %s content state',
    async (kind) => {
      const { copy, user } = await setup()
      const target = path.join(copy, 'src', 'new')
      const proof = {
        root: copy,
        rootIdentity: await workerPathIdentity(copy),
        ancestor: 'src',
        ancestorIdentity: await workerPathIdentity(path.join(copy, 'src')),
        remaining: 'new',
      }
      const created = await runNative(proof, 'worker-create')
      if (kind === 'hard-link') await link(target, path.join(user, 'owner-link'))
      else await writeFile(target, 'owner')
      await expect(runNative(proof, 'worker-release', created.identity)).rejects.toThrow()
      expect(await readFile(target, 'utf8')).toBe(kind === 'hard-link' ? '' : 'owner')
    },
  )
  it.each(['parent', 'file'])('NF native no-follow refuses a %s link directly', async (kind) => {
    const { copy } = await setup()
    const src = path.join(copy, 'src')
    const proof = {
      root: copy,
      rootIdentity: await workerPathIdentity(copy),
      ancestor: kind === 'parent' ? 'alias' : 'src',
      ancestorIdentity: await workerPathIdentity(src),
      remaining: 'new',
    }
    if (kind === 'parent')
      await symlink(
        src,
        path.join(copy, 'alias'),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
    else {
      await writeFile(path.join(src, 'owner'), 'owner')
      await symlink(path.join(src, 'owner'), path.join(src, 'new'), 'file')
    }
    const refusal = runNative(
      proof,
      kind === 'parent' ? 'worker-create' : 'worker-check',
      kind === 'parent' ? '' : await workerPathIdentity(path.join(src, 'owner')),
    )
    const reason = kind === 'parent' ? 'parent unavailable or linked' : 'file unavailable or linked'
    await expect(refusal).rejects.toThrow(process.platform === 'win32' ? undefined : reason)
    if (kind === 'file') expect(await readFile(path.join(src, 'owner'), 'utf8')).toBe('owner')
  })
  it.each(['../new', '..'])('NF native rejects dot components in %s', async (remaining) => {
    const { copy } = await setup()
    const proof = {
      root: copy,
      rootIdentity: await workerPathIdentity(copy),
      ancestor: 'src',
      ancestorIdentity: await workerPathIdentity(path.join(copy, 'src')),
      remaining,
    }
    const reason = remaining === '..' ? 'invalid filename' : 'invalid component'
    await expect(runNative(proof, 'worker-create')).rejects.toThrow(
      process.platform === 'win32' ? undefined : reason,
    )
  })
  it('NF a parent moved at native create cannot retain an outside empty file', async () => {
    const { copy, user } = await setup()
    await writeFile(path.join(copy, 'src', '.race-parent'), '')
    const args = [
      'worker-create',
      copy,
      await workerPathIdentity(copy),
      'src',
      await workerPathIdentity(path.join(copy, 'src')),
      'new',
      '',
    ]
    if (variants.race === undefined) {
      // Windows tests the same refusal before launch; its retained handles
      // exclude FILE_SHARE_DELETE during the native operation.
      await rename(path.join(copy, 'src'), path.join(user, 'moved'))
      await expect(nativeCreated(args)).rejects.toThrow()
    } else await expect(variants.race(args)).rejects.toThrow('parent moved')
    await expect(readFile(path.join(user, 'moved', 'new'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
  it('NF native creation refuses a different device or Linux bind mount', async () => {
    const { copy } = await setup()
    await mkdir(path.join(copy, 'src', 'mounted'))
    const args = [
      'worker-create',
      copy,
      await workerPathIdentity(copy),
      'src',
      await workerPathIdentity(path.join(copy, 'src')),
      'mounted/new',
      '',
    ]
    if (variants.device === undefined) throw new Error('device fixture unavailable')
    await expect(variants.device(args)).rejects.toThrow()
    if (variants.mount !== undefined) await expect(variants.mount(args)).rejects.toThrow()
    await expect(readFile(path.join(copy, 'src', 'mounted', 'new'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
  it('NF writes new engine and ACP files, including a missing directory, with real native identities', async () => {
    const { copy, input, role, tool } = await setup()
    await tool.writeFile(path.join(copy, 'src', 'new.ts'), 'engine\n')
    await expect(acpFsWrite({ ...input, role }, 'src/deep/漢字.ts', 'acp\n')).resolves.toEqual({
      ok: true,
    })
    expect(await readFile(path.join(copy, 'src', 'new.ts'), 'utf8')).toBe('engine\n')
    expect(await readFile(path.join(copy, 'src', 'deep', '漢字.ts'), 'utf8')).toBe('acp\n')
  })
  it('NF reservation fills exact binary bytes and releases an empty file', async () => {
    const { copy, tool } = await setup()
    const beforeCreate = vi.fn(() => Promise.resolve())
    const target = path.join(copy, 'src', 'images', 'new.bin')
    const reserved = await tool.reserveFile(target, target, beforeCreate)
    expect(beforeCreate).toHaveBeenCalledExactlyOnceWith(1)
    expect(await readFile(target)).toHaveLength(0)
    const bytes = Uint8Array.from([0, 255, 128, 1])
    expect(await reserved.fill(bytes)).toBe('done')
    expect(await readFile(target)).toEqual(Buffer.from(bytes))
    expect(await reserved.release()).toBe('changed')
    const empty = path.join(copy, 'src', 'empty.bin')
    const emptyReservation = await tool.reserveFile(empty)
    expect(await emptyReservation.release()).toBe('done')
    await expect(readFile(empty)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('NF exclusive creation refuses an occupied file without overwrite', async () => {
    const { copy, native, tool } = await setup()
    const target = path.join(copy, 'src', 'occupied')
    await writeFile(target, 'owner')
    await expect(tool.reserveFile(target)).rejects.toThrow(UI_TEXT.teamFileExists)
    expect(native).not.toHaveBeenCalled()
    expect(await readFile(target, 'utf8')).toBe('owner')
  })
  it('NF native exclusive open refuses a target occupied after preflight', async () => {
    const { copy, withNative } = await setup()
    const target = path.join(copy, 'src', 'new')
    const native = async (proof: WorkerCreateProof, op: string, id?: string) => {
      if (op === 'worker-create') await writeFile(target, 'owner')
      return await runNative(proof, op, id)
    }
    const tool = withNative(native)
    await expect(tool.writeFile(target, 'attack')).rejects.toThrow()
    expect(await readFile(target, 'utf8')).toBe('owner')
  })
  it('NF an inside symlink parent is refused before native creation', async () => {
    const { copy, native, tool } = await setup()
    await symlink(
      path.join(copy, 'src'),
      path.join(copy, 'alias'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(tool.writeFile(path.join(copy, 'alias', 'new'), 'attack')).rejects.toThrow(
      UI_TEXT.teamFileLinked,
    )
    expect(native).not.toHaveBeenCalled()
    await expect(readFile(path.join(copy, 'src', 'new'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('NF failed conditional writes and revoked write guards create nothing', async () => {
    const { copy, native, tool } = await setup()
    const target = path.join(copy, 'src', 'new')
    await expect(
      tool.writeFileIfUnchanged(target, 'old-fingerprint', 'attack', {
        expectedCanonicalPath: target,
        unsavedAt: [],
      }),
    ).rejects.toThrow()
    await expect(
      tool.writeFile(target, 'attack', target, () => {
        throw new Error('revoked')
      }),
    ).rejects.toThrow('revoked')
    expect(native).not.toHaveBeenCalled()
    await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it.each([
    { role: { ...WRITER, workspaceMode: 'read-only' as const }, given: 'src/new.ts' },
    { role: { ...WRITER, toolGroups: [] }, given: 'src/new.ts' },
    { role: { ...WRITER, writePaths: ['docs/**'] }, given: 'src/new.ts' },
    { role: WRITER, given: '.git/new-hook' },
    { role: WRITER, given: '.GiT/new-hook' },
  ])(
    'NF role policy refuses $given before native creation ($role.workspaceMode)',
    async ({ role, given }) => {
      const { copy, input, native, tool } = await setup(role)
      await mkdir(path.dirname(path.join(copy, given)), { recursive: true })
      await expect(tool.writeFile(path.join(copy, given), 'attack')).rejects.toThrow()
      await expect(acpFsWrite({ ...input, role }, given, 'attack')).resolves.toHaveProperty('error')
      expect(native).not.toHaveBeenCalled()
      await expect(readFile(path.join(copy, given))).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )
  it('NF outside paths and symlink parents create nothing', async () => {
    const { copy, user, tool } = await setup()
    await symlink(user, path.join(copy, 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
    for (const given of [path.join(user, 'escaped'), path.join(copy, 'alias', 'escaped')])
      await expect(tool.writeFile(given, 'attack')).rejects.toThrow()
    await expect(readFile(path.join(user, 'escaped'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it.each(['root', 'parent', 'protected'])(
    'NF native create rejects a %s swapped after preflight',
    async (kind) => {
      const { copy, user, withNative } = await setup()
      const native = async (proof: WorkerCreateProof, op: string, id?: string) => {
        const directory = kind === 'root' ? copy : path.join(copy, 'src')
        await rename(directory, `${directory}-old`)
        await symlink(
          kind === 'protected' ? path.join(copy, '.git') : user,
          directory,
          process.platform === 'win32' ? 'junction' : 'dir',
        )
        return await runNative(proof, op, id)
      }
      const tool = withNative(native)
      await expect(tool.writeFile(path.join(copy, 'src', 'escaped'), 'attack')).rejects.toThrow()
      await expect(readFile(path.join(user, 'escaped'))).rejects.toMatchObject({ code: 'ENOENT' })
      if (kind === 'protected')
        await expect(readFile(path.join(copy, '.git', 'escaped'))).rejects.toMatchObject({
          code: 'ENOENT',
        })
    },
  )
  it('NF checks the reopened handle against the exact native-created identity', async () => {
    const { copy, withNative } = await setup()
    const target = path.join(copy, 'src', 'new.ts')
    const native = async (proof: WorkerCreateProof, op: string) => {
      const result = await runNative(proof, op)
      await rename(target, `${target}-held`)
      await writeFile(target, 'replacement')
      return result
    }
    const tool = withNative(native)
    await expect(tool.writeFile(target, 'attack')).rejects.toThrow(UI_TEXT.teamFileChanged)
    expect(await readFile(target, 'utf8')).toBe('replacement')
  })
  it.each(['fill', 'release'] as const)(
    'NF reservation %s preserves a replacement file',
    async (op) => {
      const { copy, tool } = await setup()
      const target = path.join(copy, 'src', 'reserved')
      const reserved = await tool.reserveFile(target)
      await rename(target, `${target}-held`)
      await writeFile(target, 'replacement')
      if (op === 'fill') expect(await reserved.fill(Uint8Array.of(1))).toBe('changed')
      else expect(await reserved.release()).toBe('changed')
      expect(await readFile(target, 'utf8')).toBe('replacement')
    },
  )
  it.each([
    { op: 'fill', kind: 'owner bytes' },
    { op: 'release', kind: 'owner bytes' },
    { op: 'fill', kind: 'hard links' },
    { op: 'release', kind: 'hard links' },
  ])('NF reservation $op preserves $kind', async ({ op, kind }) => {
    const { copy, user, tool } = await setup()
    const target = path.join(copy, 'src', 'reserved')
    const reserved = await tool.reserveFile(target)
    if (kind === 'owner bytes') await writeFile(target, 'owner')
    else await link(target, path.join(user, 'alias'))
    expect(op === 'fill' ? await reserved.fill(Uint8Array.of(1)) : await reserved.release()).toBe(
      'changed',
    )
    expect(await readFile(target, 'utf8')).toBe(kind === 'owner bytes' ? 'owner' : '')
  })
  it('NF revoked admission after the async before-create callback creates nothing', async () => {
    let isAllowed = true
    const { copy, native, tool } = await setup(WRITER, () => {
      if (!isAllowed) throw new Error('revoked')
    })
    await expect(
      tool.reserveFile(path.join(copy, 'src', 'new'), path.join(copy, 'src', 'new'), () => {
        isAllowed = false
        return Promise.resolve()
      }),
    ).rejects.toThrow('revoked')
    expect(native).not.toHaveBeenCalled()
  })
  it('NF missing helper and malformed receipt fail with their true reason', async () => {
    const { copy, input, role } = await setup()
    const missing = await acpFsWrite({ ...input, io: WORKER_NATIVE_IO, role }, 'src/new', 'attack')
    expect(missing).toHaveProperty('error', UI_TEXT.teamFileHelperMissing)
    const nativeOpen = WORKER_NATIVE_IO.openFile
    if (nativeOpen === undefined) throw new Error('native existing-file opener missing')
    const openFile = vi.fn(nativeOpen)
    const tool = fenceWorkerToolIo(base, {
      input: {
        ...input,
        io: {
          ...input.io,
          openFile,
          workerNativeOperation: () =>
            Promise.resolve({ identity: 'not-an-identity', createdFolders: 0 }),
        },
      },
      role,
      admit: () => undefined,
    })
    await expect(tool.writeFile(path.join(copy, 'src', 'new'), 'attack')).rejects.toThrow()
    expect(openFile).not.toHaveBeenCalled()
    await expect(readFile(path.join(copy, 'src', 'new'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it.each(['root', 'parent', 'file'])(
    'NF native %s identity is exact, not a pathname assertion',
    async (kind) => {
      const { copy } = await setup()
      const rootId = await workerPathIdentity(copy)
      const parentId = await workerPathIdentity(path.join(copy, 'src'))
      const proof = {
        root: copy,
        rootIdentity: rootId,
        ancestor: 'src',
        ancestorIdentity: parentId,
        remaining: 'new',
      }
      if (kind === 'file') {
        await runNative(proof, 'worker-create')
        await expect(runNative(proof, 'worker-release', '0:0')).rejects.toThrow()
        expect(await readFile(path.join(copy, 'src', 'new'))).toHaveLength(0)
      } else
        await expect(
          runNative(
            {
              ...proof,
              ...(kind === 'root' ? { rootIdentity: '0:0' } : { ancestorIdentity: '0:0' }),
            },
            'worker-create',
          ),
        ).rejects.toThrow()
    },
  )
})
