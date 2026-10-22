import { writeFileSync } from 'node:fs'
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
import { pathModule } from '../../src/core/workspaceRoot'
import {
  compileCreatedVariant,
  nativeCreated,
  nativeScratch,
  useCreatedNative,
} from './helpers/createdNative'
import { configureResources } from '../../src/core/resources/admission'
import { immediateResourceSettings } from './helpers/resources/fixtureAdmission'
import {
  CREATE_ERRNOS,
  WORKER_HELPER_FAILED_PREFIX,
  WORKER_REFUSAL_PREFIX,
  WORKER_REFUSALS,
  countMissingFolders,
  mapNativeError,
  recordCreated,
  sweepAbandonedReservations,
  typedCreateError,
  workerWindowsCommand,
} from '../../src/core/team/workers/workerOps'
import { powerShellQuoted } from '../../src/core/shellQuote'
import { fill } from '../../src/shared/l10n/text'
import { shellJobAssembly } from '../../src/host/backend/shellJob'
import { runProgram } from '../../src/host/processTree'
import { readJobSource } from './helpers/jobSource'
import { fixtureJobLifecycle } from './helpers/jobLifecycle'
import { removeFolder } from './helpers/temporaryFolders'
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

// A file link needs a privilege the account may lack on Windows; the link
// setup below skips with its reason printed instead of failing there.
function shouldSkipLinkWithoutPrivilege(error: unknown, skip: (note?: string) => void): boolean {
  if (
    process.platform === 'win32' &&
    error instanceof Error &&
    'code' in error &&
    error.code === 'EPERM'
  ) {
    console.warn('teamWorkerCreate: file links need the create-link privilege; skipping')
    skip('file links need the create-link privilege on this account')
    return true
  }
  return false
}
async function compileWorkerShellAssembly(): Promise<{ folder: string; assembly: string }> {
  const folder = await mkdtemp(path.join(tmpdir(), 'm96-create-shell-'))
  const assembly = await shellJobAssembly({
    storageDir: folder,
    systemRoot: process.env['SystemRoot']!,
    readJobSource,
    run: runProgram,
    log: () => undefined,
  })()
  if (assembly === undefined) throw new Error('Native shell helper unavailable')
  return { folder, assembly }
}
type SweepRun = NonNullable<WorkerFenceIo['workerNativeOperation']>

/** The decoded `-EncodedCommand` script at the end of a worker launcher argv. */
function decodeWorkerScript(command: readonly string[]): string {
  const encoded = command.at(-1)
  expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/)
  return Buffer.from(encoded ?? '', 'base64').toString('utf16le')
}

/**
Every single-quoted span of a PowerShell script, in order, kept exactly as
written (doubled quotes included): the script this lane builds quotes each
value with powerShellQuoted, so the spans must equal those literals
character for character. An unterminated span fails the test instead of
silently dropping the tail.
*/
function quotedSpans(script: string): string[] {
  const spans: string[] = []
  let isOpen = false
  let current = ''
  let index = 0
  while (index < script.length) {
    const char = script[index]!
    if (!isOpen) {
      if (char === "'") {
        isOpen = true
        current = ''
      }
    } else if (char === "'") {
      if (script[index + 1] === "'") {
        current += "''"
        index += 1
      } else {
        isOpen = false
        spans.push(current)
      }
    } else current += char
    index += 1
  }
  expect(isOpen).toBe(false)
  return spans
}

/** The rejection of a native attempt, or undefined when it unexpectedly succeeds. */
async function refusalOf(attempt: Promise<unknown>): Promise<unknown> {
  try {
    await attempt
  } catch (error: unknown) {
    return error
  }
  return undefined
}

async function seedReservation(
  relative: string,
  identity: string,
): Promise<{ folder: string; root: string }> {
  const folder = await mkdtemp(path.join(nativeScratch(), 'sweep-'))
  const root = path.join(folder, 'copy')
  await mkdir(path.join(root, 'src'), { recursive: true })
  await recordCreated(folder, relative, identity)
  return { folder, root }
}

async function sweepOnce(folder: string, root: string, run: SweepRun): Promise<void> {
  await sweepAbandonedReservations(
    folder,
    root,
    '1:1',
    pathModule(process.platform),
    {
      pathIdentity: () => Promise.resolve('2:2'),
    },
    run,
  )
}

async function expectRecordDrained(folder: string, root: string, identity: string): Promise<void> {
  const againCalls: unknown[][] = []
  const again = (...args: unknown[]): Promise<{ identity: string; createdFolders: number }> => {
    againCalls.push(args)
    return Promise.resolve({ identity, createdFolders: 0 })
  }
  await sweepOnce(folder, root, again)
  expect(againCalls).toEqual([])
}
async function refusesLink(kind: 'parent' | 'file', skip: (note?: string) => void): Promise<void> {
  const { copy } = await setup()
  const src = path.join(copy, 'src')
  const proof = {
    root: copy,
    rootIdentity: await workerPathIdentity(copy),
    ancestor: kind === 'parent' ? 'alias' : 'src',
    ancestorIdentity: await workerPathIdentity(src),
    remaining: 'new',
    relative: kind === 'parent' ? 'alias/new' : 'src/new',
  }
  try {
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
  } catch (error: unknown) {
    if (shouldSkipLinkWithoutPrivilege(error, skip)) return
    throw error
  }
  const refusal = runNative(
    proof,
    kind === 'parent' ? 'worker-create' : 'worker-check',
    kind === 'parent' ? '' : await workerPathIdentity(path.join(src, 'owner')),
  )
  const reason = kind === 'parent' ? 'parent unavailable or linked' : 'file unavailable or linked'
  await expect(refusal).rejects.toThrow(process.platform === 'win32' ? undefined : reason)
  // The refusal reaches the caller as its own typed sentence on every platform.
  const failure = await refusalOf(refusal)
  if (failure !== undefined)
    expect(mapNativeError(failure, 'src/new').message).toBe(UI_TEXT.teamFileLinked)
  if (kind === 'file') expect(await readFile(path.join(src, 'owner'), 'utf8')).toBe('owner')
}
async function setup(role = WRITER, admit: () => void = () => undefined) {
  const fixture = path.join(nativeScratch(), `worker-${String(++state.ordinal)}`)
  const copy = path.join(fixture, 'copy')
  const user = path.join(fixture, 'user')
  await mkdir(path.join(copy, 'src'), { recursive: true })
  await mkdir(path.join(copy, '.git'))
  await mkdir(user)
  const nativeCalls: Parameters<typeof runNative>[] = []
  const native: typeof runNative = (...args) => {
    nativeCalls.push(args)
    return runNative(...args)
  }
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
    nativeCalls,
    input,
    role,
    tool: withNative(),
    withNative,
  }
}

async function fillFailingTool(
  failure: { write: () => Promise<never> } | { writeBytes: () => Promise<never> },
): Promise<{
  tool: ReturnType<typeof fenceWorkerToolIo>
  copy: string
}> {
  const { copy, input, role } = await setup()
  await mkdir(path.join(copy, 'docs'))
  const nativeOpen = WORKER_NATIVE_IO.openFile
  if (nativeOpen === undefined) throw new Error('native existing-file opener missing')
  const openFile: NonNullable<WorkerFenceIo['openFile']> = async (absolute, isWrite) => {
    const handle = await nativeOpen(absolute, isWrite)
    return { ...handle, ...failure }
  }
  const tool = fenceWorkerToolIo(base, {
    input: { ...input, io: { ...input.io, openFile } },
    role,
    admit: () => undefined,
  })
  return { tool, copy }
}

/** One call-recording native runner: the sweep tests share it. */
function recordRun(
  calls: unknown[][],
  behavior: () => Promise<{ identity: string; createdFolders: number }>,
): (...args: unknown[]) => Promise<{ identity: string; createdFolders: number }> {
  return (...args: unknown[]) => {
    calls.push(args)
    return behavior()
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
      relative: 'src/new',
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
        relative: 'src/new',
      }
      const created = await runNative(proof, 'worker-create')
      if (kind === 'hard-link') await link(target, path.join(user, 'owner-link'))
      else await writeFile(target, 'owner')
      await expect(runNative(proof, 'worker-release', created.identity)).rejects.toThrow()
      expect(await readFile(target, 'utf8')).toBe(kind === 'hard-link' ? '' : 'owner')
    },
  )
  it('NF native no-follow refuses a parent link directly', async (context) => {
    await refusesLink('parent', (note) => context.skip(note))
  })
  it('NF native no-follow refuses a file link directly', async (context) => {
    await refusesLink('file', (note) => context.skip(note))
  })
  // The Windows helper refuses these names itself, in addition to the
  // TypeScript spelling fence. runNative reaches the real C# on Windows, so
  // each case proves the helper's own refusal there; POSIX treats these as
  // ordinary names, so the block runs on Windows only.
  describe.runIf(process.platform === 'win32')('windows helper name refusals', () => {
    it.each([
      'NUL',
      'CON',
      'PRN',
      'AUX',
      'COM1',
      'COM9',
      'LPT1',
      'LPT9',
      'nul',
      'com1',
      'NUL.txt',
      'COM1.log',
      'aux.c',
      'LPT9.dat',
      'trailing.',
      'trailing ',
      'stream:ads',
      'star*.ts',
      'query?.ts',
      'less<.ts',
      'greater>.ts',
      'pipe|.ts',
      'quote".ts',
      'bell\u{7}.ts',
      'line\nbreak.ts',
    ])('NF windows helper refuses %s', async (name) => {
      const { copy } = await setup()
      const proof = {
        root: copy,
        rootIdentity: await workerPathIdentity(copy),
        ancestor: 'src',
        ancestorIdentity: await workerPathIdentity(path.join(copy, 'src')),
        remaining: name,
        relative: `src/${name}`,
      }
      const attempt = runNative(proof, 'worker-create')
      await expect(attempt).rejects.toThrow()
      // The refusal reaches the caller as its own typed sentence, not the
      // generic native failure.
      const failure = await refusalOf(attempt)
      if (failure !== undefined)
        expect(mapNativeError(failure, name).message).toBe(
          fill(UI_TEXT.teamFileCannotCreate, { path: name }),
        )
      expect(await readdir(path.join(copy, 'src'))).not.toContain(name)
    })
    it('NF windows helper refusals arrive typed exactly as on POSIX', async () => {
      const { copy } = await setup()
      const rootIdentity = await workerPathIdentity(copy)
      const ancestorIdentity = await workerPathIdentity(path.join(copy, 'src'))
      const proofFor = (remaining: string) => ({
        root: copy,
        rootIdentity,
        ancestor: 'src',
        ancestorIdentity,
        remaining,
        relative: `src/${remaining}`,
      })
      // An occupied target is its own typed sentence.
      await runNative(proofFor('occupied'), 'worker-create')
      const occupied = runNative(proofFor('occupied'), 'worker-create')
      await expect(occupied).rejects.toThrow()
      const occupiedFailure = await refusalOf(occupied)
      if (occupiedFailure !== undefined)
        expect(mapNativeError(occupiedFailure, 'src/occupied').message).toBe(UI_TEXT.teamFileExists)
      // A changed identity is its own typed sentence: 'occupied' exists
      // (created above), so the bogus identity mismatches an existing file
      // and both helpers report identity changed. Checking a never-created
      // name would probe absence instead, which both helpers truthfully
      // report as unavailable-or-linked (POSIX measured on Kubuntu).
      const changed = runNative(proofFor('occupied'), 'worker-check', '0:0')
      await expect(changed).rejects.toThrow()
      const changedFailure = await refusalOf(changed)
      if (changedFailure !== undefined)
        expect(mapNativeError(changedFailure, 'src/occupied').message).toBe(UI_TEXT.teamFileChanged)
      // An absent name is unavailable, not changed, on both helpers.
      const absent = runNative(proofFor('absent'), 'worker-check', '0:0')
      await expect(absent).rejects.toThrow()
      const absentFailure = await refusalOf(absent)
      if (absentFailure !== undefined)
        expect(mapNativeError(absentFailure, 'src/absent').message).toBe(UI_TEXT.teamFileLinked)
    })
  })
  // The production Windows launcher runs for real here: the tool I/O below
  // keeps no fixture override, so the create falls back to the packaged
  // nativeOperation (PowerShell plus the sealed job assembly through the
  // governed contained profile). verify is a resolved stub; the attested
  // verify path is covered by jobBuild and resourceWindowsLaunch.
  describe.runIf(process.platform === 'win32')(
    'windows production launcher',
    { timeout: 60_000 }, // One C# compile plus a cold PowerShell start is genuinely long.
    () => {
      const shell: { folder: string; assembly: string | undefined } = {
        folder: '',
        assembly: undefined,
      }
      const job = fixtureJobLifecycle()
      beforeAll(async () => {
        await job.setup()
        const compiled = await compileWorkerShellAssembly()
        shell.folder = compiled.folder
        shell.assembly = compiled.assembly
      }, 60_000) // Compiling the C# job assembly once is a genuinely long operation.
      afterAll(async () => {
        await job.dispose()
        if (shell.folder !== '') await removeFolder(shell.folder)
      })
      async function productionTool(): Promise<{
        tool: ReturnType<typeof fenceWorkerToolIo>
        copy: string
        dispose: () => void
      }> {
        const assembly = shell.assembly
        const executable = job.path
        if (assembly === undefined || executable === undefined)
          throw new Error('Native launch unavailable')
        const { copy, input, role } = await setup()
        resources.dispose = configureResources(
          immediateResourceSettings({
            inspect: () => undefined,
            onError: () => undefined,
            windowsJob: () =>
              Promise.resolve({
                assemblyPath: assembly,
                executablePath: executable,
                verify: () => Promise.resolve(),
              }),
          }),
        )
        // No fixture override: the create falls back to the packaged
        // production launcher under test here.
        const productionIo: WorkerFenceIo = {
          realPath: input.io.realPath,
          pathIdentity: input.io.pathIdentity,
          ...(input.io.openFile !== undefined && { openFile: input.io.openFile }),
        }
        const tool = fenceWorkerToolIo(base, {
          input: { ...input, io: productionIo },
          role,
          admit: () => undefined,
        })
        return { tool, copy, dispose: resources.dispose }
      }
      it('NF windows production launcher creates through PowerShell and the job assembly', async () => {
        const { tool, copy, dispose } = await productionTool()
        try {
          const target = path.join(copy, 'src', 'launched.ts')
          await tool.writeFile(target, 'launched\n')
          expect(await readFile(target, 'utf8')).toBe('launched\n')
          // A target occupied after preflight refuses through the PowerShell
          // forwarding wrapper as the typed sentence, not the generic failure.
          const raced = path.join(copy, 'src', 'raced.ts')
          await expect(
            tool.writeFile(raced, 'late\n', undefined, () => {
              writeFileSync(raced, 'owner')
            }),
          ).rejects.toThrow(UI_TEXT.teamFileExists)
          expect(await readFile(raced, 'utf8')).toBe('owner')
        } finally {
          dispose()
          resources.dispose = configureResources({
            inspect: () => undefined,
            onError: () => undefined,
          })
        }
      })
      it('NF windows production launcher reports a nested file parent copy-relative', async () => {
        // No fixture override: the refusal below travels through the
        // packaged nativeOperation, which must print the copy-relative
        // path, not the ancestor-relative suffix.
        const { tool, copy, dispose } = await productionTool()
        try {
          await writeFile(path.join(copy, 'src', 'plain'), 'owner')
          await expect(
            tool.writeFile(path.join(copy, 'src', 'plain', 'deep', 'new'), 'blocked\n'),
          ).rejects.toThrow(fill(UI_TEXT.teamFileCannotCreate, { path: 'src/plain/deep/new' }))
        } finally {
          dispose()
          resources.dispose = configureResources({
            inspect: () => undefined,
            onError: () => undefined,
          })
        }
      })
    },
  )
  it.each(['../new', '..'])('NF native rejects dot components in %s', async (remaining) => {
    const { copy } = await setup()
    const proof = {
      root: copy,
      rootIdentity: await workerPathIdentity(copy),
      ancestor: 'src',
      ancestorIdentity: await workerPathIdentity(path.join(copy, 'src')),
      remaining,
      relative: `src/${remaining}`,
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
    const beforeCreateCalls: unknown[][] = []
    const beforeCreate = (...args: unknown[]): Promise<void> => {
      beforeCreateCalls.push(args)
      return Promise.resolve()
    }
    const target = path.join(copy, 'src', 'images', 'new.bin')
    const reserved = await tool.reserveFile(target, target, beforeCreate)
    expect(beforeCreateCalls).toEqual([[1]])
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
    const { copy, nativeCalls, tool } = await setup()
    const target = path.join(copy, 'src', 'occupied')
    await writeFile(target, 'owner')
    await expect(tool.reserveFile(target)).rejects.toThrow(UI_TEXT.teamFileExists)
    expect(nativeCalls).toEqual([])
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
    const { copy, nativeCalls, tool } = await setup()
    await symlink(
      path.join(copy, 'src'),
      path.join(copy, 'alias'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(tool.writeFile(path.join(copy, 'alias', 'new'), 'attack')).rejects.toThrow(
      UI_TEXT.teamFileLinked,
    )
    expect(nativeCalls).toEqual([])
    await expect(readFile(path.join(copy, 'src', 'new'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('NF failed conditional writes and revoked write guards create nothing', async () => {
    const { copy, nativeCalls, tool } = await setup()
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
    expect(nativeCalls).toEqual([])
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
      const { copy, input, nativeCalls, tool } = await setup(role)
      await mkdir(path.dirname(path.join(copy, given)), { recursive: true })
      await expect(tool.writeFile(path.join(copy, given), 'attack')).rejects.toThrow()
      await expect(acpFsWrite({ ...input, role }, given, 'attack')).resolves.toHaveProperty('error')
      expect(nativeCalls).toEqual([])
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
    const { copy, nativeCalls, tool } = await setup(WRITER, () => {
      if (!isAllowed) throw new Error('revoked')
    })
    await expect(
      tool.reserveFile(path.join(copy, 'src', 'new'), path.join(copy, 'src', 'new'), () => {
        isAllowed = false
        return Promise.resolve()
      }),
    ).rejects.toThrow('revoked')
    expect(nativeCalls).toEqual([])
  })
  it('NF missing helper and malformed receipt fail with their true reason', async () => {
    const { copy, input, role } = await setup()
    const missing = await acpFsWrite({ ...input, io: WORKER_NATIVE_IO, role }, 'src/new', 'attack')
    expect(missing).toHaveProperty('error', UI_TEXT.teamFileHelperMissing)
    const nativeOpen = WORKER_NATIVE_IO.openFile
    if (nativeOpen === undefined) throw new Error('native existing-file opener missing')
    let openFileCalls = 0
    const openFile: typeof nativeOpen = (...args) => {
      openFileCalls += 1
      return nativeOpen(...args)
    }
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
    expect(openFileCalls).toBe(0)
    await expect(readFile(path.join(copy, 'src', 'new'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('NF a refused write guard creates no folders', async () => {
    const { copy, nativeCalls, tool } = await setup()
    const target = path.join(copy, 'src', 'deep', 'a', 'new.ts')
    await expect(
      tool.writeFile(target, 'guarded\n', undefined, () => {
        throw new Error('guard says no')
      }),
    ).rejects.toThrow('guard says no')
    expect(nativeCalls).toEqual([])
    await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(path.join(copy, 'src'))).not.toContain('deep')
  })
  it('NF a failed reopen removes the empty file and its new folders', async () => {
    const { copy, input, role } = await setup()
    const tool = fenceWorkerToolIo(base, {
      input: {
        ...input,
        io: {
          ...input.io,
          openFile: () =>
            Promise.reject(
              Object.assign(new Error(`EIO: i/o error, open '${target}'`), { code: 'EIO' }),
            ),
        },
      },
      role,
      admit: () => undefined,
    })
    const target = path.join(copy, 'src', 'deep', 'b', 'new.ts')
    await expect(tool.writeFile(target, 'lost\n')).rejects.toThrow(
      fill(UI_TEXT.teamFileCannotCreate, { path: 'src/deep/b/new.ts' }),
    )
    await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(path.join(copy, 'src'))).not.toContain('deep')
  })
  it('NF a failed first write keeps a pre-existing empty folder', async () => {
    const { tool, copy } = await fillFailingTool({
      write: () => Promise.reject(new Error('first write lost')),
    })
    const target = path.join(copy, 'docs', 'a', 'b.txt')
    await expect(tool.writeFile(target, 'lost\n')).rejects.toThrow('first write lost')
    await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readdir(path.join(copy, 'docs', 'a'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(await readdir(path.join(copy, 'docs'))).toEqual([])
  })
  it('NF cleanup removes only the folders this operation created', async () => {
    const { tool, copy } = await fillFailingTool({
      writeBytes: () => Promise.reject(new Error('fill lost')),
    })
    const target = path.join(copy, 'docs', 'a', 'b.bin')
    // A concurrent creator makes docs/a after preflight, so the helper
    // reports zero created folders; the failed fill must not take them.
    const reserved = await tool.reserveFile(target, target, async () => {
      await mkdir(path.join(copy, 'docs', 'a'), { recursive: true })
    })
    await expect(reserved.fill(Uint8Array.of(1))).rejects.toThrow('fill lost')
    await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(path.join(copy, 'docs'))).toContain('a')
  })
  it.skipIf(process.platform === 'win32')(
    'NF the helper honors the process umask for files and folders',
    async () => {
      const { copy } = await setup()
      const proof = {
        root: copy,
        rootIdentity: await workerPathIdentity(copy),
        ancestor: 'src',
        ancestorIdentity: await workerPathIdentity(path.join(copy, 'src')),
        remaining: 'permdir/permfile',
        relative: 'src/permdir/permfile',
      }
      const previous = process.umask(0o022)
      try {
        await runNative(proof, 'worker-create')
      } finally {
        process.umask(previous)
      }
      const file = await stat(path.join(copy, 'src', 'permdir', 'permfile'))
      const dir = await stat(path.join(copy, 'src', 'permdir'))
      expect(file.mode & 0o777).toBe(0o644)
      expect(dir.mode & 0o777).toBe(0o755)
    },
  )
  it('NF every create errno is the typed copy-relative sentence', () => {
    const absolute = `${path.sep}host${path.sep}absolute${path.sep}copy${path.sep}src${path.sep}plain`
    const expected = fill(UI_TEXT.teamFileCannotCreate, { path: 'src/plain/new' })
    expect(CREATE_ERRNOS.has('ENOTDIR')).toBe(true)
    expect(CREATE_ERRNOS.has('ENAMETOOLONG')).toBe(true)
    for (const code of CREATE_ERRNOS) {
      const failure = Object.assign(new Error(`${code}: not a directory, lstat '${absolute}'`), {
        code,
      })
      const typed = typedCreateError(failure, 'src/plain/new')
      expect(typed.message).toBe(expected)
      expect(typed.message).not.toContain(absolute)
    }
    const occupied = Object.assign(new Error(`EEXIST: file exists, open '${absolute}'`), {
      code: 'EEXIST',
    })
    expect(typedCreateError(occupied, 'src/plain/new').message).toBe(UI_TEXT.teamFileExists)
    const exotic = Object.assign(new Error(`ESTALE: stale handle, open '${absolute}'`), {
      code: 'ESTALE',
    })
    const backstop = typedCreateError(exotic, 'src/plain/new')
    expect(backstop.message).toBe(expected)
    expect(backstop.message).not.toContain(absolute)
    expect(typedCreateError('gone', 'src/plain/new').message).toBe(UI_TEXT.teamFileNativeFailed)
  })
  describe('worker refusal vocabulary', () => {
    const remaining = 'src/plain/new'
    const sentenceMessage = (sentence: string): string => {
      switch (sentence) {
        case 'exists': {
          return UI_TEXT.teamFileExists
        }
        case 'linked': {
          return UI_TEXT.teamFileLinked
        }
        case 'outside': {
          return UI_TEXT.teamFileOutside
        }
        case 'changed': {
          return UI_TEXT.teamFileChanged
        }
        case 'cannotCreate': {
          return fill(UI_TEXT.teamFileCannotCreate, { path: remaining })
        }
        default: {
          return UI_TEXT.teamFileNativeFailed
        }
      }
    }
    it.each(WORKER_REFUSALS.map((row) => [row.reason, row.sentence] as const))(
      'NF refusal %s maps to its typed sentence',
      (reason, sentence) => {
        const failure = Object.assign(new Error('Command failed'), {
          stderr: `${WORKER_REFUSAL_PREFIX}${reason}`,
        })
        expect(mapNativeError(failure, remaining).message).toBe(sentenceMessage(sentence))
      },
    )
    it('NF an unknown refusal maps to the named backstop with its code', () => {
      const failure = Object.assign(new Error('Command failed'), {
        stderr: `${WORKER_REFUSAL_PREFIX}frobnicate`,
      })
      const mapped = mapNativeError(failure, remaining)
      expect(mapped.message).toBe(UI_TEXT.teamFileNativeFailed)
      expect(String(mapped.cause)).toContain(`${WORKER_REFUSAL_PREFIX}frobnicate`)
    })
    it('NF the refusal table matches the helpers it types', async () => {
      const root = process.cwd()
      const cSource = await readFile(
        path.join(root, 'native', 'darwin', 'MuseSparkWorkerFile.c'),
        'utf8',
      )
      const csSource = await readFile(
        path.join(root, 'native', 'windows', 'MuseSparkJob.cs'),
        'utf8',
      )
      const cReasons: string[] = []
      for (const line of cSource.split('\n')) {
        if (!line.includes('worker_refuse(')) continue
        for (const match of line.matchAll(/"([^"]+)"/g)) cReasons.push(match[1]!)
      }
      // Every pattern below has only required groups, and every worker-path
      // emission site keeps its reason a string literal, so each match holds
      // exactly the codes the helper can emit. The lookbehind skips the
      // unrelated Regex.Match call in the marker reader.
      const csPatterns = [
        /RefuseReason\("([^"]+)"\)/g,
        /RefuseReason\([^()"]*\?\s*"([^"]+)"\s*:\s*"([^"]+)"\)/g,
        /(?<![\w.])Match\(.*,\s*"([^"]+)"\)/g,
        /(?<![\w.])Sample\(.*,\s*"([^"]+)"\)/g,
        /WorkerDirectory\(.*,\s*"([^"]+)"\)/g,
        /DisposeEntry\(.*,\s*"([^"]+)"\)/g,
        /WorkerName\(.*\?\s*"([^"]+)"\s*:\s*"([^"]+)"\)/g,
        /throw new IOException\("worker file helper refused: ([^"]+)"\)/g,
      ]
      const csReasons: string[] = []
      for (const pattern of csPatterns)
        for (const match of csSource.matchAll(pattern)) csReasons.push(...match.slice(1))
      const table = WORKER_REFUSALS.map((row) => row.reason)
      expect(new Set(table).size).toBe(table.length)
      expect(cReasons.length).toBeGreaterThan(0)
      expect(csReasons.length).toBeGreaterThan(0)
      for (const reason of [...cReasons, ...csReasons]) expect(table).toContain(reason)
      for (const reason of table) expect([...cReasons, ...csReasons]).toContain(reason)
    })
    it('NF the Windows wrapper forwards every refusal in the table', () => {
      const script = decodeWorkerScript(
        workerWindowsCommand(String.raw`C:\assembly.dll`, ['worker-create', 'root']),
      )
      for (const row of WORKER_REFUSALS)
        expect(script).toContain(`${WORKER_REFUSAL_PREFIX}${row.reason}`)
      for (const sentence of [
        UI_TEXT.teamFileExists,
        UI_TEXT.teamFileLinked,
        UI_TEXT.teamFileOutside,
        UI_TEXT.teamFileChanged,
        UI_TEXT.teamFileNativeFailed,
      ])
        expect(script).not.toContain(sentence)
    })
    it('NF the Windows launcher passes one encoded script and nothing after it', () => {
      const command = workerWindowsCommand(String.raw`C:\assembly.dll`, [
        'worker-create',
        String.raw`C:\copy`,
        '1:2',
        'src',
        '3:4',
        'new',
        '',
      ])
      // The script is the last element: no value follows it on the command
      // line, so PowerShell cannot join a file name onto the command text.
      expect(command.slice(0, -1)).toEqual([
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
      ])
      expect(command).toHaveLength(6)
      const script = decodeWorkerScript(command)
      expect(script).toContain('[MuseSparkCreated]::Execute([string[]]@(')
      expect(script).not.toContain('$args')
    })
    it.each([
      ["single quote: o'brien.ts", "o'brien.ts"],
      ['double quote: say "hi".ts', 'say "hi".ts'],
      ['semicolon: a;exit.ts', 'a;exit.ts'],
      ['subexpression: $(Get-Date).ts', '$(Get-Date).ts'],
      ['backtick: a`b.ts', 'a`b.ts'],
      ['ampersand: a&b.ts', 'a&b.ts'],
      ['pipe: a|b.ts', 'a|b.ts'],
      ['newline: line\nbreak.ts', 'line\nbreak.ts'],
      ['percent: %VAR%.ts', '%VAR%.ts'],
      ['trailing backslash: dir\\', 'dir\\'],
      ['typographic quote U+2019: o’brien.ts', 'o’brien.ts'],
      ['typographic quote U+2018: o‘brien.ts', 'o‘brien.ts'],
      ['typographic quote U+201A: o‚brien.ts', 'o‚brien.ts'],
      ['typographic quote U+201B: o‛brien.ts', 'o‛brien.ts'],
    ])('NF the Windows launcher keeps a hostile name %s inside its literal', (_label, name) => {
      const assembly = String.raw`C:\as sembly'dir\job.dll`
      const args = ['worker-create', String.raw`C:\copy`, '1:2', 'src', '3:4', name, '']
      const script = decodeWorkerScript(workerWindowsCommand(assembly, args))
      // Every single-quoted span of the decoded script, in order: any value
      // that broke out of its literal would change this exact sequence.
      const expected = [
        'Stop',
        assembly,
        ...args,
        ...WORKER_REFUSALS.map((row) => `${WORKER_REFUSAL_PREFIX}${row.reason}`),
        WORKER_HELPER_FAILED_PREFIX,
      ].map((literal) => powerShellQuoted(literal).slice(1, -1))
      expect(quotedSpans(script)).toEqual(expected)
    })
    it('NF a helper failure maps to the helper-failed sentence with its kind', () => {
      const failure = Object.assign(new Error('Command failed'), {
        stderr: `${WORKER_HELPER_FAILED_PREFIX}IOException`,
      })
      const mapped = mapNativeError(failure, remaining)
      expect(mapped.message).toBe(fill(UI_TEXT.teamFileHelperFailed, { kind: 'IOException' }))
      expect(mapped.message).not.toBe(UI_TEXT.teamFileNativeFailed)
      expect(String(mapped.cause)).toContain('Command failed')
      expect(mapNativeError(mapped, remaining)).toBe(mapped)
    })
    it.each(['FileNotFoundException', 'FileLoadException', 'BadImageFormatException'])(
      'NF a Windows assembly-load failure %s maps to helper-unavailable',
      (kind) => {
        const failure = Object.assign(new Error('Command failed'), {
          stderr: `${WORKER_HELPER_FAILED_PREFIX}${kind}`,
        })
        const mapped = mapNativeError(failure, remaining)
        expect(mapped.message).toBe(UI_TEXT.teamFileHelperMissing)
        expect(mapped.message).not.toBe(UI_TEXT.teamFileNativeFailed)
        expect(String(mapped.cause)).toContain('Command failed')
        expect(mapNativeError(mapped, remaining)).toBe(mapped)
      },
    )
    it('NF a helper ArgumentException stays helper-failed for diagnosis', () => {
      const failure = Object.assign(new Error('Command failed'), {
        stderr: `${WORKER_HELPER_FAILED_PREFIX}ArgumentException`,
      })
      expect(mapNativeError(failure, remaining).message).toBe(
        fill(UI_TEXT.teamFileHelperFailed, { kind: 'ArgumentException' }),
      )
    })
    it('NF a refusal wins over a helper-failed marker in the same output', () => {
      const failure = Object.assign(new Error('Command failed'), {
        stderr: `${WORKER_HELPER_FAILED_PREFIX}IOException\n${WORKER_REFUSAL_PREFIX}target exists`,
      })
      expect(mapNativeError(failure, remaining).message).toBe(UI_TEXT.teamFileExists)
    })
    it.each([WORKER_HELPER_FAILED_PREFIX, String.raw`${WORKER_HELPER_FAILED_PREFIX}C:\evil path!`])(
      'NF an untrusted helper-failed kind %s falls back to the generic failure',
      (line) => {
        const failure = Object.assign(new Error('Command failed'), { stderr: line })
        expect(mapNativeError(failure, remaining).message).toBe(UI_TEXT.teamFileNativeFailed)
      },
    )
  })
  it('NF a file parent reaches ACP as the typed copy-relative sentence', async () => {
    const { copy, input, role } = await setup()
    const parent = path.join(copy, 'src', 'plain')
    await writeFile(parent, 'owner')
    const result = await acpFsWrite({ ...input, role }, 'src/plain/new', 'blocked\n')
    expect(result).toEqual({
      error: fill(UI_TEXT.teamFileCannotCreate, { path: 'src/plain/new' }),
    })
    if (!('error' in result)) throw new Error('Expected the typed create refusal')
    expect(result.error).not.toContain(copy)
    // Nothing was created: the would-be path still resolves through the file.
    // A path below a regular file is "not a directory" on POSIX and "not
    // found" on Windows (measured on Windows 11); either way no entry exists.
    await expect(lstat(path.join(copy, 'src', 'plain', 'new'))).rejects.toMatchObject({
      code: process.platform === 'win32' ? 'ENOENT' : 'ENOTDIR',
    })
  })
  it('NF nested helper refusals report the copy-relative path', async () => {
    // The target sits two components below its ancestor (remaining
    // 'deep/nested-new'), so an ancestor-relative sentence would print the
    // partial path: every family below must print the copy-relative one.
    const { input, role } = await setup()
    const given = 'src/deep/nested-new'
    const rows: readonly (readonly [string, string])[] = [
      ['target exists', UI_TEXT.teamFileExists],
      ['parent unavailable or linked', UI_TEXT.teamFileLinked],
      ['parent is not a directory', fill(UI_TEXT.teamFileCannotCreate, { path: given })],
      ['invalid filename', fill(UI_TEXT.teamFileCannotCreate, { path: given })],
      ['identity changed', UI_TEXT.teamFileChanged],
      ['outside root', UI_TEXT.teamFileOutside],
      ['unknown operation', UI_TEXT.teamFileNativeFailed],
    ]
    for (const [reason, expected] of rows) {
      const refusal = Object.assign(new Error('Command failed'), {
        stderr: `${WORKER_REFUSAL_PREFIX}${reason}`,
      })
      const run: SweepRun = () => Promise.reject(refusal)
      const result = await acpFsWrite(
        { ...input, io: { ...input.io, workerNativeOperation: run }, role },
        given,
        'blocked\n',
      )
      expect(result).toEqual({ error: expected })
    }
  })
  it('NF a nested file parent reaches ACP as the typed copy-relative sentence', async () => {
    const { copy, input, role } = await setup()
    await writeFile(path.join(copy, 'src', 'plain'), 'owner')
    const result = await acpFsWrite({ ...input, role }, 'src/plain/deep/new', 'blocked\n')
    expect(result).toEqual({
      error: fill(UI_TEXT.teamFileCannotCreate, { path: 'src/plain/deep/new' }),
    })
    if (!('error' in result)) throw new Error('Expected the typed create refusal')
    expect(result.error).not.toContain(copy)
  })
  it.skipIf(process.platform === 'win32')(
    'NF folder-preflight refusals report the copy-relative path',
    async () => {
      const { copy } = await setup()
      // A self-loop link as an intermediate folder: probing below it fails
      // with ELOOP, not ENOENT, so the missing-folder preflight itself
      // refuses instead of counting.
      await symlink('loop', path.join(copy, 'src', 'loop'))
      const display = 'src/loop/sub/new'
      await expect(
        countMissingFolders(
          pathModule(process.platform),
          path.join(copy, 'src'),
          'loop/sub/new',
          display,
        ),
      ).rejects.toThrow(fill(UI_TEXT.teamFileCannotCreate, { path: display }))
    },
  )
  it('NF an abandoned reservation is released at the next start', async () => {
    const { folder, root } = await seedReservation('src/stale', '7:7')
    const runCalls: unknown[][] = []
    const run = recordRun(runCalls, () => Promise.resolve({ identity: '7:7', createdFolders: 0 }))
    await sweepOnce(folder, root, run)
    expect(runCalls).toHaveLength(1)
    expect(runCalls[0]?.[0]).toBeDefined()
    expect(runCalls[0]?.slice(1)).toEqual(['worker-release', '7:7'])
    await expectRecordDrained(folder, root, '7:7')
  })
  it('NF a changed reservation drops its record but keeps its bytes', async () => {
    const { folder, root } = await seedReservation('src/changed', '9:9')
    await writeFile(path.join(root, 'src', 'changed'), 'owner bytes')
    const refusal = Object.assign(new Error('worker file helper refused: changed'), {
      stderr: 'worker file helper refused: changed',
    })
    const runCalls: unknown[][] = []
    const run = recordRun(runCalls, () => Promise.reject(refusal))
    await sweepOnce(folder, root, run)
    expect(runCalls).toHaveLength(1)
    expect(runCalls[0]?.[0]).toBeDefined()
    expect(runCalls[0]?.slice(1)).toEqual(['worker-release', '9:9'])
    expect(await readFile(path.join(root, 'src', 'changed'), 'utf8')).toBe('owner bytes')
    await expectRecordDrained(folder, root, '9:9')
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
        relative: 'src/new',
      }
      if (kind === 'file') {
        await runNative(proof, 'worker-create')
        const release = runNative(proof, 'worker-release', '0:0')
        await expect(release).rejects.toThrow()
        const releaseFailure = await refusalOf(release)
        if (releaseFailure !== undefined)
          expect(mapNativeError(releaseFailure, 'src/new').message).toBe(UI_TEXT.teamFileChanged)
        expect(await readFile(path.join(copy, 'src', 'new'))).toHaveLength(0)
      } else {
        const create = runNative(
          {
            ...proof,
            ...(kind === 'root' ? { rootIdentity: '0:0' } : { ancestorIdentity: '0:0' }),
          },
          'worker-create',
        )
        await expect(create).rejects.toThrow()
        const createFailure = await refusalOf(create)
        if (createFailure !== undefined)
          expect(mapNativeError(createFailure, 'src/new').message).toBe(UI_TEXT.teamFileChanged)
      }
    },
  )
})
