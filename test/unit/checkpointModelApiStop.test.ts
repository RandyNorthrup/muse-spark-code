// Real native writes through M72's checkpoint wrapper and the production Host.
// The Model API, editor provider and command output are offline test transports.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import {
  CHECKPOINT_ACTIVITY_PREFIX,
  type CheckCommandSetting,
  MODEL_TEXT,
} from '../../src/shared/constants'
import {
  type ConditionalWrite,
  shellToolFor,
  type ToolIo,
} from '../../src/core/backends/modelapi/tools'
import { ModelApiSession, type ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import type { VerifyHooks } from '../../src/core/backends/modelapi/verifyLoop'
import type { FileDiagnostics } from '../../src/core/verify/diagnosticsReport'
import type { RenameEdits } from '../../src/core/codeIntel/languageService'
import { fileContextIo } from '../../src/host/backend/contextIo'
import { MemoryStore } from '../../src/core/memory/memoryStore'
import { createMemoryIo, systemPath } from '../../src/host/backend/memoryIo'
import { ModelApiBackendManager } from '../../src/host/backend/modelApiBackendManager'
import * as modelApiEntry from '../../src/host/backend/modelApiEntry'
import { createToolIo } from '../../src/host/backend/toolIo'
import {
  createCheckpointPort,
  prepareCheckpointTurn,
  withCheckpointCopies,
} from '../../src/host/checkpoints/checkpointHost'
import { turnKey } from '../../src/host/checkpoints/checkpointStore'
import { fakeManagerDeps } from './helpers/modelApiManager'
import { fakeEditProviders } from './helpers/fakes'
import { fakeModelApi } from './helpers/fakeModelApi'
import { fakeLanguageService, KIND, sym } from './helpers/fakeLanguageService'
import { enteringShell } from './helpers/fakeToolIo'
import { harness, removeCheckpointFolders, REAL_GIT_TIMEOUT_MS } from './helpers/checkpointHarness'

const hosts: ModelApiHost[] = []
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()))
  await removeCheckpointFolders()
})

async function setup(hasMemory = false) {
  const h = await harness()
  const source = path.join(h.root, 'source.ts')
  const other = path.join(h.root, 'other.ts')
  const ignored = path.join(h.root, '.env')
  await writeFile(source, 'const answer = 1;\n')
  await writeFile(other, 'const answer = 1;\n')
  await writeFile(ignored, 'const answer = 1;\n')
  await writeFile(path.join(h.root, '.gitignore'), '.env\n')
  const settings: {
    isTrusted: boolean
    diagnostics: boolean
    format: boolean
    checks: boolean
    commands: readonly CheckCommandSetting[]
  } = {
    isTrusted: true,
    diagnostics: false,
    format: false,
    checks: false,
    commands: [{ name: 'lint', command: 'npm test' }],
  }
  const port = createCheckpointPort({
    store: h.store,
    isNamespaceKnown: () => true,
    isEnabled: () => true,
    isWorkspaceTrusted: () => settings.isTrusted,
    hasGit: () => true,
  })
  let atomicBoundary: (() => void) | undefined
  let assembly: (() => Promise<string | undefined>) | undefined
  const native = createToolIo({
    platform: process.platform,
    systemRoot: process.env['SystemRoot'],
    env: () => ({}),
    listFiles: () => Promise.resolve(['source.ts', 'other.ts', '.env']),
    searchWorkerPath: 'unused',
    log: () => undefined,
    unsavedFiles: () => [],
    assertWorkspaceCurrent: () => {
      atomicBoundary?.()
    },
    shellJobAssembly: async () => await assembly?.(),
  })
  // The native adapter's own entry check stays: a refusal there launches nothing.
  const shell = vi.spyOn(native, 'runShell').mockImplementation(
    enteringShell(() =>
      Promise.resolve({
        stdout: 'passed',
        stderr: '',
        exitCode: 0,
        isTimedOut: false,
        isCancelled: false,
        isWorkspaceShutdownProven: true,
      }),
    ),
  )
  const io = withCheckpointCopies(native, port)
  let memoryStage: (() => Promise<void>) | undefined
  const memoryIo = createMemoryIo(io, {
    warn: (message) => {
      h.log.warn(message)
    },
    staged: async () => {
      await memoryStage?.()
    },
  })
  const memoryCreates: Promise<void>[] = []
  const createMemoryNote = memoryIo.createFile.bind(memoryIo)
  vi.spyOn(memoryIo, 'createFile').mockImplementation((...args) => {
    const pending = createMemoryNote(...args)
    memoryCreates.push(pending)
    return pending
  })
  const memory = new MemoryStore({
    io: memoryIo,
    platform: process.platform,
    workspaceRoot: h.root,
    dataRoot: () => undefined,
    systemPath,
    warn: (message) => {
      h.log.warn(message)
    },
  })
  const underlyingWrite = io.writeFile.bind(io)
  const writeCompletions: Promise<void>[] = []
  const originalWrite = (...args: Parameters<ToolIo['writeFile']>) => {
    const pending = underlyingWrite(...args)
    writeCompletions.push(pending)
    return pending
  }
  vi.spyOn(io, 'writeFile').mockImplementation(originalWrite)
  const underlyingFormatWrite = io.writeFileIfUnchanged.bind(io)
  const conditionalCompletions: Promise<ConditionalWrite>[] = []
  vi.spyOn(io, 'writeFileIfUnchanged').mockImplementation((...args) => {
    const pending = underlyingFormatWrite(...args)
    conditionalCompletions.push(pending)
    return pending
  })
  const { format, diagnostics } = fakeEditProviders()
  const verify: VerifyHooks = {
    isDiagnosticsOn: () => settings.diagnostics,
    isFormatOnEdit: () => settings.format,
    checkCommands: () => (settings.checks ? settings.commands : []),
    formatAfterEdit: format,
    diagnosticsAfterEdit: diagnostics,
  }
  const api = fakeModelApi()
  let ids = 0
  const files = new Map([
    [source, 'const answer = 1;\n'],
    [other, 'const answer = 1;\n'],
  ])
  const codeIntel = fakeLanguageService({
    files,
    symbols: Object.fromEntries(
      Array.from(files.keys(), (file) => [file, [sym('answer', KIND.constant, file, 0, 6)]]),
    ),
    rename: (_file, _at, name): Promise<RenameEdits> =>
      Promise.resolve({
        fileOperations: 'none',
        files: Array.from(files.keys(), (file) => ({
          path: file,
          edits: [
            {
              range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
              newText: name,
            },
          ],
        })),
      }),
  })
  const manager = new ModelApiBackendManager(
    fakeManagerDeps(api, h.log, {
      workspaceRoot: h.root,
      io,
      ...(hasMemory && { memory }),
      contextIo: fileContextIo,
      newId: () => `checkpoint-stop-${String(++ids)}`,
      isWorkspaceTrusted: () => settings.isTrusted,
      codeIntel,
      verify,
      beforeTurnRuns: (sessionId, turnId) => prepareCheckpointTurn(port, sessionId, turnId, h.log),
      afterTurnRuns: async (sessionId, turnId) => {
        await port.endTurn(sessionId, turnId)
        await port.markTurn(turnKey(sessionId, turnId), false)
      },
      bundlePath: 'src/host/backend/modelApiEntry.ts',
      loadBundle: () => modelApiEntry,
    }),
  )
  const host = await manager.ensureHost()
  hosts.push(host)
  const session = await host.startSession({
    workspaceRoot: h.root,
    modelId: 'muse-spark-1.3',
    approvalMode: 'allowAll',
  })
  const events: AgentEvent[] = []
  const completion = Promise.withResolvers<Extract<AgentEvent, { type: 'turnCompleted' }>>()
  session.onEvent((event) => {
    events.push(event)
    if (event.type === 'turnCompleted') completion.resolve(event)
    else if (event.type === 'approvalRequested')
      void session.decideApproval({
        approvalId: event.approvalId,
        requirementId: event.requirementId,
        choiceId: 'allow_once',
      })
  })
  const scriptWrite = (file = 'source.ts') => {
    api.script(
      { calls: [{ name: 'read_file', arguments: JSON.stringify({ path: file }) }] },
      {
        calls: [
          {
            name: 'write_file',
            arguments: JSON.stringify({ path: file, content: 'const answer = 2;\n' }),
          },
        ],
      },
      { text: 'done' },
    )
  }
  const scriptRename = () => {
    api.script(
      {
        calls: [
          {
            name: 'rename_symbol',
            arguments: JSON.stringify({ path: 'source.ts', symbol: 'answer', new_name: 'result' }),
          },
        ],
      },
      { text: 'done' },
    )
  }
  const scriptShell = () => {
    api.script(
      {
        calls: [
          {
            name: shellToolFor(process.platform).name,
            arguments: JSON.stringify({ command: 'printf admitted' }),
          },
        ],
      },
      { text: 'done' },
    )
  }
  return {
    h,
    source,
    other,
    ignored,
    port,
    native,
    io,
    memory,
    memoryIo,
    memoryCreates,
    host,
    session,
    events,
    completion,
    settings,
    api,
    format,
    diagnostics,
    shell,
    writeCompletions,
    originalWrite,
    conditionalCompletions,
    scriptWrite,
    scriptRename,
    scriptShell,
    setAtomicBoundary: (callback: () => void) => {
      atomicBoundary = callback
    },
    setAssembly: (callback: () => Promise<string | undefined>) => {
      assembly = callback
    },
    setMemoryStage: (callback: () => Promise<void>) => {
      memoryStage = callback
    },
  }
}

async function done(t: Awaited<ReturnType<typeof setup>>): Promise<void> {
  const event = await t.completion.promise
  expect(event.type).toBe('turnCompleted')
}

async function send(t: Awaited<ReturnType<typeof setup>>): Promise<void> {
  await t.session.sendTurn([{ type: 'text', text: 'edit owned files' }])
}

async function expectSources(
  t: Awaited<ReturnType<typeof setup>>,
  source: string,
  other = 'const answer = 1;\n',
): Promise<void> {
  expect(await readFile(t.source, 'utf8')).toBe(source)
  expect(await readFile(t.other, 'utf8')).toBe(other)
}

function holdActivity(t: Awaited<ReturnType<typeof setup>>) {
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const mark = t.port.markTurn.bind(t.port)
  vi.spyOn(t.port, 'markTurn').mockImplementation(async (key, running) => {
    await mark(key, running)
    if (!running || !key.startsWith(CHECKPOINT_ACTIVITY_PREFIX)) return
    entered.resolve(undefined)
    await release.promise
  })
  return { entered, release }
}

type OwnerChange = 'stop' | 'mode' | 'trust'

async function revokeOwner(
  t: Awaited<ReturnType<typeof setup>>,
  change: OwnerChange,
): Promise<void> {
  if (change === 'stop') await t.session.cancel()
  else if (change === 'mode') await t.session.setApprovalMode('denyUnmatched')
  else t.settings.isTrusted = false
}

async function enterHeld(
  t: Awaited<ReturnType<typeof setup>>,
  arrival: Promise<unknown>,
): Promise<void> {
  await send(t)
  await arrival
}

function holdPreimage(t: Awaited<ReturnType<typeof setup>>) {
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const before = t.port.beforeToolWrite.bind(t.port)
  vi.spyOn(t.port, 'beforeToolWrite').mockImplementation(async (file) => {
    await before(file)
    entered.resolve(undefined)
    await release.promise
  })
  return { entered, release }
}

async function memoryNote(
  t: Awaited<ReturnType<typeof setup>>,
  content = 'original memory\n',
): Promise<string> {
  const note = path.join(t.h.root, '.agents', 'memory', 'owned.md')
  await mkdir(path.dirname(note), { recursive: true })
  await writeFile(note, content)
  return note
}

function scriptMemoryEdit(t: Awaited<ReturnType<typeof setup>>): void {
  t.api.script(
    {
      calls: [
        {
          name: 'edit_memory',
          arguments: JSON.stringify({
            scope: 'project',
            path: 'owned.md',
            old_str: 'original memory',
            new_str: 'late memory',
          }),
        },
      ],
    },
    { text: 'done' },
  )
}

async function refuseHeldCommand(
  t: Awaited<ReturnType<typeof setup>>,
  change: OwnerChange,
): Promise<void> {
  const { entered, release } = holdActivity(t)
  try {
    await enterHeld(t, entered.promise)
    await revokeOwner(t, change)
    release.resolve(undefined)
    await done(t)
    expect(t.shell).not.toHaveBeenCalled()
    expect(t.port.isNativeUnsafe()).toBe(false)
    if (change !== 'stop' && t.settings.checks) {
      const row = t.events.find(
        (event) => event.type === 'itemCompleted' && event.item.tool === 'verify_edits',
      )
      if (row?.type !== 'itemCompleted') throw new Error('Expected actual refused check summary')
      expect(row.item.verifySummary?.checks).toEqual([
        { name: 'lint', outcome: 'notRun', skip: 'refused' },
      ])
    }
  } finally {
    release.resolve(undefined)
  }
}

describe('M72 native common owner guards', () => {
  it.each(['stop', 'mode', 'trust'] as const)(
    'refuses project memory edit after actual checkpoint preimage and %s change',
    async (change) => {
      const t = await setup(true)
      const note = await memoryNote(t)
      await writeFile(path.join(t.h.root, '.gitignore'), '.env\n.agents/memory/\n')
      const { entered, release } = holdPreimage(t)
      scriptMemoryEdit(t)
      try {
        await enterHeld(t, entered.promise)
        await revokeOwner(t, change)
        release.resolve(undefined)
        await done(t)
        await Promise.allSettled(t.writeCompletions)
        expect(await readFile(note, 'utf8')).toBe('original memory\n')
      } finally {
        release.resolve(undefined)
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each(['stop', 'mode', 'trust'] as const)(
    'refuses a new memory note after native stage and %s change without leaving note/index/stage',
    async (change) => {
      const t = await setup(true)
      const folder = path.join(t.h.root, '.agents', 'memory')
      await mkdir(folder, { recursive: true })
      const entered = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      t.setMemoryStage(async () => {
        entered.resolve(undefined)
        await release.promise
      })
      t.api.script(
        {
          calls: [
            {
              name: 'add_memory',
              arguments: JSON.stringify({
                scope: 'project',
                path: 'new.md',
                content: 'new memory\n',
              }),
            },
          ],
        },
        { text: 'done' },
      )
      try {
        await enterHeld(t, entered.promise)
        await revokeOwner(t, change)
        release.resolve(undefined)
        if (change === 'stop') await t.completion.promise
        else await done(t)
        await Promise.allSettled(t.memoryCreates)
        expect(await readdir(folder)).toEqual([])
      } finally {
        release.resolve(undefined)
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps an accepted new note when its later index publication loses the original mode',
    async () => {
      const t = await setup(true)
      const folder = path.join(t.h.root, '.agents', 'memory')
      await mkdir(folder, { recursive: true })
      const index = path.join(folder, 'MEMORY.md')
      await writeFile(index, 'old index\n')
      await writeFile(path.join(t.h.root, '.gitignore'), '.env\n.agents/memory/\n')
      const { entered, release } = holdPreimage(t)
      t.api.script(
        {
          calls: [
            {
              name: 'add_memory',
              arguments: JSON.stringify({
                scope: 'project',
                path: 'new.md',
                content: 'accepted memory\n',
              }),
            },
          ],
        },
        { text: 'done' },
      )
      try {
        await enterHeld(t, entered.promise)
        expect(await readFile(path.join(folder, 'new.md'), 'utf8')).toContain('accepted memory')
        await revokeOwner(t, 'mode')
        release.resolve(undefined)
        await done(t)
        await Promise.allSettled(t.writeCompletions)
        expect(await readFile(path.join(folder, 'new.md'), 'utf8')).toContain('accepted memory')
        expect(await readFile(index, 'utf8')).toBe('old index\n')
        expect(t.h.log.warn).toHaveBeenCalledWith(expect.stringContaining('line was not'))
      } finally {
        release.resolve(undefined)
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'writes an unchanged admitted memory note and its index through native publication',
    async () => {
      const t = await setup(true)
      t.api.script(
        {
          calls: [
            {
              name: 'add_memory',
              arguments: JSON.stringify({
                scope: 'project',
                path: 'new.md',
                content: 'admitted memory\n',
              }),
            },
          ],
        },
        { text: 'done' },
      )
      await send(t)
      await done(t)
      const folder = path.join(t.h.root, '.agents', 'memory')
      expect(await readFile(path.join(folder, 'new.md'), 'utf8')).toContain('admitted memory')
      expect(await readFile(path.join(folder, 'MEMORY.md'), 'utf8')).toContain('(new.md)')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each(['mode', 'trust'] as const)(
    'withholds a memory read returned after its original %s admission ends',
    async (change) => {
      const t = await setup(true)
      const note = await memoryNote(t, 'private fixture memory\n')
      const entered = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      const original = t.memoryIo.readFile.bind(t.memoryIo)
      vi.spyOn(t.memoryIo, 'readFile').mockImplementation(async (file) => {
        if (file === note) {
          entered.resolve(undefined)
          await release.promise
        }
        return await original(file)
      })
      t.api.script(
        {
          calls: [
            {
              name: 'read_memory',
              arguments: JSON.stringify({
                scope: 'project',
                path: 'owned.md',
              }),
            },
          ],
        },
        { text: 'done' },
      )
      try {
        await enterHeld(t, entered.promise)
        await revokeOwner(t, change)
        release.resolve(undefined)
        await done(t)
        expect(JSON.stringify(t.events)).not.toContain('private fixture memory')
        expect(JSON.stringify(t.api.requests)).not.toContain('private fixture memory')
      } finally {
        release.resolve(undefined)
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses memory publication after session disposal while a real preimage is held',
    async () => {
      const t = await setup(true)
      const note = await memoryNote(t)
      const { entered, release } = holdPreimage(t)
      scriptMemoryEdit(t)
      try {
        await enterHeld(t, entered.promise)
        t.session.dispose()
        release.resolve(undefined)
        await Promise.allSettled(t.writeCompletions)
        expect(await readFile(note, 'utf8')).toBe('original memory\n')
      } finally {
        release.resolve(undefined)
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses memory publication when Host close begins before held SessionEnd finishes',
    async () => {
      const t = await setup(true)
      if (!(t.session instanceof ModelApiSession)) throw new Error('Expected Model API session')
      const note = await memoryNote(t)
      const { entered, release } = holdPreimage(t)
      const ending = Promise.withResolvers<undefined>()
      const finishEnd = Promise.withResolvers<undefined>()
      vi.spyOn(t.session, 'endHooks').mockImplementation(async () => {
        ending.resolve(undefined)
        await finishEnd.promise
      })
      scriptMemoryEdit(t)
      let closing: Promise<void> | undefined
      try {
        await enterHeld(t, entered.promise)
        closing = t.host.close()
        await ending.promise
        release.resolve(undefined)
        await Promise.allSettled(t.writeCompletions)
        expect(await readFile(note, 'utf8')).toBe('original memory\n')
      } finally {
        release.resolve(undefined)
        finishEnd.resolve(undefined)
        await closing
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each(['stop', 'mode', 'trust'] as const)(
    'forwards ordinary admission after held checkpoint preimage and %s change',
    async (change) => {
      const t = await setup()
      const { entered, release } = holdPreimage(t)
      t.scriptWrite('.env')
      try {
        await enterHeld(t, entered.promise)
        await revokeOwner(t, change)
        release.resolve(undefined)
        await done(t)
        await Promise.allSettled(t.writeCompletions)
        expect(await readFile(t.ignored, 'utf8')).toBe('const answer = 1;\n')
      } finally {
        release.resolve(undefined)
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each(['stop', 'mode', 'trust'] as const)(
    'refuses ordinary first publication after %s at native atomic stage',
    async (change) => {
      const t = await setup()
      t.scriptWrite()
      let isFired = false
      const changes: Promise<unknown>[] = []
      t.setAtomicBoundary(() => {
        if (isFired) return
        isFired = true
        if (change === 'stop') changes.push(t.session.cancel())
        else if (change === 'mode') changes.push(t.session.setApprovalMode('denyUnmatched'))
        else t.settings.isTrusted = false
      })
      await send(t)
      await done(t)
      await Promise.all(changes)
      expect(isFired).toBe(true)
      await expectSources(t, 'const answer = 1;\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses first rename publication after native stage changes to Plan',
    async () => {
      const t = await setup()
      t.scriptRename()
      let isFired = false
      t.setAtomicBoundary(() => {
        if (isFired) return
        isFired = true
        void t.session.setApprovalMode('denyUnmatched')
      })
      await send(t)
      await done(t)
      expect(isFired).toBe(true)
      await expectSources(t, 'const answer = 1;\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each([false, true])(
    'finishes native rename after first write, Stop=%s',
    async (isStop) => {
      const t = await setup()
      t.scriptRename()
      const original = t.originalWrite
      let writes = 0
      vi.spyOn(t.io, 'writeFile').mockImplementation(async (...args) => {
        await original(...args)
        writes += 1
        if (writes === 1 && isStop) await t.session.cancel()
      })
      await send(t)
      await done(t)
      expect(writes).toBe(2)
      await expectSources(t, 'const result = 1;\n', 'const result = 1;\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'retains completed edit and patch when Plan revokes formatter entry after first write',
    async () => {
      const t = await setup()
      t.settings.format = true
      const original = t.originalWrite
      vi.spyOn(t.io, 'writeFile').mockImplementation(async (...args) => {
        await original(...args)
        await t.session.setApprovalMode('denyUnmatched')
      })
      t.scriptWrite()
      await send(t)
      await done(t)
      await expectSources(t, 'const answer = 2;\n')
      expect(t.format).not.toHaveBeenCalled()
      const row = t.events.find(
        (event) => event.type === 'itemCompleted' && event.item.tool === 'write_file',
      )
      if (row?.type !== 'itemCompleted') throw new Error('Expected completed real ordinary edit')
      expect(row.item.patchRef).toBeDefined()
      expect(row.item.patchSummary?.files).toBe(1)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each(['stop', 'mode', 'trust'] as const)(
    'keeps initial native bytes after held formatter and %s change',
    async (change) => {
      const t = await setup()
      t.settings.format = true
      const entered = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<string>()
      t.format.mockImplementation(async () => {
        entered.resolve(undefined)
        return await release.promise
      })
      t.scriptWrite()
      try {
        await enterHeld(t, entered.promise)
        await revokeOwner(t, change)
        release.resolve('const answer = 3;\n')
        await t.format.mock.results[0]?.value
        await Promise.allSettled(t.conditionalCompletions)
        await done(t)
        await expectSources(t, 'const answer = 2;\n')
      } finally {
        release.resolve('const answer = 3;\n')
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'fences native publication immediately when Host close waits for SessionEnd',
    async () => {
      const t = await setup()
      if (!(t.session instanceof ModelApiSession)) throw new Error('Expected production session')
      const hookEntered = Promise.withResolvers<undefined>()
      const hookRelease = Promise.withResolvers<undefined>()
      vi.spyOn(t.session, 'endHooks').mockImplementation(async () => {
        hookEntered.resolve(undefined)
        await hookRelease.promise
      })
      const { entered, release } = holdPreimage(t)
      t.scriptWrite()
      let closing: Promise<void> | undefined
      try {
        await enterHeld(t, entered.promise)
        closing = t.host.close()
        await hookEntered.promise
        release.resolve(undefined)
        await done(t)
        await expectSources(t, 'const answer = 1;\n')
      } finally {
        release.resolve(undefined)
        hookRelease.resolve(undefined)
        await closing
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each(['mode', 'trust'] as const)(
    'withholds held diagnostics and runs no checks after %s changes',
    async (change) => {
      const t = await setup()
      t.settings.diagnostics = true
      t.settings.checks = true
      const entered = Promise.withResolvers<readonly FileDiagnostics[]>()
      const release = Promise.withResolvers<readonly FileDiagnostics[]>()
      t.diagnostics.mockImplementation(async (files) => {
        entered.resolve(
          files.map((file) => ({
            file,
            entries: [
              {
                path: file.relative,
                severity: 'error',
                line: 1,
                column: 1,
                source: 'offline-test',
                message: 'PRIVATE_DIAGNOSTIC_CANARY',
              },
            ],
          })),
        )
        return await release.promise
      })
      t.scriptWrite()
      try {
        await send(t)
        const report = await entered.promise
        if (change === 'mode') await t.session.setApprovalMode('denyUnmatched')
        else t.settings.isTrusted = false
        release.resolve(report)
        await done(t)
        expect(t.shell).not.toHaveBeenCalled()
        expect(JSON.stringify(t.api.responseBodies())).not.toContain('PRIVATE_DIAGNOSTIC_CANARY')
        expect(JSON.stringify(t.events)).not.toContain('PRIVATE_DIAGNOSTIC_CANARY')
        const row = t.events.find(
          (event) => event.type === 'itemCompleted' && event.item.tool === 'verify_edits',
        )
        if (row?.type !== 'itemCompleted') throw new Error('Expected automatic verification row')
        expect(row.item.visibleOutput).toContain(MODEL_TEXT.verifyAccessRefused)
        expect(row.item.verifySummary).toMatchObject({ unchecked: 1 })
        expect(row.item.verifySummary?.errors).toBeUndefined()
      } finally {
        release.resolve([])
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each(['stop', 'mode', 'trust'] as const)(
    'launches no check after held checkpoint activity mark and %s change',
    async (change) => {
      const t = await setup()
      t.settings.checks = true
      t.scriptWrite()
      await refuseHeldCommand(t, change)
      await expectSources(t, 'const answer = 2;\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'runs an unchanged admitted check and releases its checkpoint activity mark',
    async () => {
      const t = await setup()
      t.settings.checks = true
      t.scriptWrite()
      await send(t)
      await done(t)
      expect(t.shell).toHaveBeenCalledOnce()
      expect(t.port.isNativeUnsafe()).toBe(false)
      await expectSources(t, 'const answer = 2;\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'preserves first check exit status but refuses later checks after original batch mode changes',
    async () => {
      const t = await setup()
      t.settings.checks = true
      t.settings.commands = [
        { name: 'first', command: 'npm first' },
        { name: 'second', command: 'npm second' },
      ]
      t.shell.mockImplementationOnce(async () => {
        await t.session.setApprovalMode('onRequest')
        return {
          stdout: 'OLD_CHECK_DATA',
          stderr: '',
          exitCode: 0,
          isTimedOut: false,
          isCancelled: false,
          isWorkspaceShutdownProven: true,
        }
      })
      t.scriptWrite()
      await send(t)
      await done(t)
      expect(t.shell).toHaveBeenCalledOnce()
      expect(t.events.some((event) => event.type === 'approvalRequested')).toBe(false)
      const row = t.events.find(
        (event) => event.type === 'itemCompleted' && event.item.tool === 'verify_edits',
      )
      if (row?.type !== 'itemCompleted') throw new Error('Expected actual check summary')
      expect(row.item.verifySummary?.checks).toEqual([
        { name: 'first', outcome: 'passed' },
        { name: 'second', outcome: 'notRun', skip: 'refused' },
      ])
      expect(row.item.visibleOutput).not.toContain('OLD_CHECK_DATA')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.runIf(process.platform === 'win32').each(['mode', 'trust'] as const)(
    'reports no-entry native check refusal after actual assembly wait and %s change',
    async (change) => {
      const t = await setup()
      t.shell.mockRestore()
      t.settings.checks = true
      t.settings.commands = [{ name: 'native', command: 'Write-Output CHECK_STARTED' }]
      const entered = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      t.setAssembly(async () => {
        entered.resolve(undefined)
        await release.promise
        return undefined
      })
      t.scriptWrite()
      try {
        await enterHeld(t, entered.promise)
        await revokeOwner(t, change)
        release.resolve(undefined)
        await done(t)
        const row = t.events.find(
          (event) => event.type === 'itemCompleted' && event.item.tool === 'verify_edits',
        )
        if (row?.type !== 'itemCompleted') throw new Error('Expected native check refusal row')
        expect(row.item.verifySummary?.checks).toEqual([
          { name: 'native', outcome: 'notRun', skip: 'refused' },
        ])
        expect(row.item.visibleOutput).not.toContain('CHECK_STARTED')
        expect(t.port.isNativeUnsafe()).toBe(false)
      } finally {
        release.resolve(undefined)
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'retains an already-entered cancelled check outcome after owner mode changes',
    async () => {
      const t = await setup()
      t.settings.checks = true
      t.shell.mockImplementationOnce(async () => {
        await t.session.setApprovalMode('denyUnmatched')
        return {
          stdout: '',
          stderr: '',
          exitCode: null,
          isTimedOut: false,
          isCancelled: true,
          isWorkspaceShutdownProven: true,
        }
      })
      t.scriptWrite()
      await send(t)
      await done(t)
      expect(t.shell).toHaveBeenCalledOnce()
      const row = t.events.find(
        (event) => event.type === 'itemCompleted' && event.item.tool === 'verify_edits',
      )
      if (row?.type !== 'itemCompleted') throw new Error('Expected actually entered check row')
      expect(row.item.verifySummary?.checks).toEqual([{ name: 'lint', outcome: 'cancelled' }])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses explicit checks whose original owner changed during native path preparation',
    async () => {
      const t = await setup()
      t.settings.checks = true
      const entered = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      const original = t.io.realPath.bind(t.io)
      let isHeld = false
      vi.spyOn(t.io, 'realPath').mockImplementation(async (file) => {
        if (!isHeld) {
          isHeld = true
          entered.resolve(undefined)
          await release.promise
        }
        return await original(file)
      })
      t.api.script(
        { calls: [{ name: 'run_checks', arguments: JSON.stringify({ paths: ['source.ts'] }) }] },
        { text: 'done' },
      )
      try {
        await enterHeld(t, entered.promise)
        await t.session.setApprovalMode('onRequest')
        release.resolve(undefined)
        await done(t)
        expect(t.shell).not.toHaveBeenCalled()
        expect(t.events.some((event) => event.type === 'approvalRequested')).toBe(false)
        expect(JSON.stringify(t.api.responseBodies())).toContain(MODEL_TEXT.verifyAccessRefused)
      } finally {
        release.resolve(undefined)
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each(['stop', 'mode', 'trust'] as const)(
    'launches no ordinary shell after held mark and %s change',
    async (change) => {
      const t = await setup()
      t.scriptShell()
      await refuseHeldCommand(t, change)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'runs an unchanged ordinary shell through checkpoint and native admission',
    async () => {
      const t = await setup()
      t.scriptShell()
      await send(t)
      await done(t)
      expect(t.shell).toHaveBeenCalledOnce()
      expect(t.port.isNativeUnsafe()).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'preserves an explicitly moved background shell across the parent turn ending before entry',
    async () => {
      const t = await setup()
      const { entered, release } = holdActivity(t)
      t.scriptShell()
      try {
        await enterHeld(t, entered.promise)
        const row = t.events.find(
          (event) =>
            event.type === 'itemStarted' && event.item.tool === shellToolFor(process.platform).name,
        )
        if (row?.type !== 'itemStarted') throw new Error('Expected actual ordinary shell row')
        await t.session.moveToBackground(row.item.itemId)
        await done(t)
        await t.session.cancel()
        release.resolve(undefined)
        await vi.waitFor(() => {
          expect(t.shell).toHaveBeenCalledOnce()
        })
        expect(t.port.isNativeUnsafe()).toBe(false)
      } finally {
        release.resolve(undefined)
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

// A mode change is not among them: the user's own command is not the model's.
type UserShellChange = Exclude<OwnerChange, 'mode'> | 'dispose' | 'hostClose'

/** The user's own `!` command, held at the real checkpoint activity mark. */
async function heldUserShell(t: Awaited<ReturnType<typeof setup>>) {
  if (!(t.session instanceof ModelApiSession)) throw new Error('Expected Model API session')
  const session = t.session
  const { entered, release } = holdActivity(t)
  await session.runUserShell('printf owned')
  await entered.promise
  const itemId = t.events.find(
    (event) => event.type === 'itemStarted' && event.item.kind === 'userShell',
  )
  if (itemId?.type !== 'itemStarted') throw new Error('Expected the actual user shell row')
  const row = () => session.history().items.find((item) => item.itemId === itemId.item.itemId)
  return { session, release, itemId: itemId.item.itemId, row }
}

describe('M72 native user-owned shell admission', () => {
  it.each(['stop', 'trust', 'dispose', 'hostClose'] as const)(
    'launches no user command after the held checkpoint mark and %s change',
    async (change: UserShellChange) => {
      const t = await setup()
      const held = await heldUserShell(t)
      const hostClosing = Promise.withResolvers<undefined>()
      const hostEnd = Promise.withResolvers<undefined>()
      let closing: Promise<void> | undefined
      try {
        switch (change) {
          case 'stop': {
            await held.session.stopTask(held.itemId)
            break
          }
          case 'trust': {
            t.settings.isTrusted = false
            break
          }
          case 'dispose': {
            held.session.dispose()
            break
          }
          case 'hostClose': {
            vi.spyOn(held.session, 'endHooks').mockImplementation(async () => {
              hostClosing.resolve(undefined)
              await hostEnd.promise
            })
            closing = t.host.close()
            await hostClosing.promise
            break
          }
        }
        held.release.resolve(undefined)
        await vi.waitFor(() => {
          expect(held.row()?.status).not.toBe('inProgress')
        })
        expect(t.shell).not.toHaveBeenCalled()
        expect(t.port.isNativeUnsafe()).toBe(false)
      } finally {
        held.release.resolve(undefined)
        hostEnd.resolve(undefined)
        await closing
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'enters after the held mark when only the Plan mode or the running turn changed',
    async () => {
      const t = await setup()
      const held = await heldUserShell(t)
      try {
        await t.session.setApprovalMode('denyUnmatched')
        await t.session.cancel()
        held.release.resolve(undefined)
        await vi.waitFor(() => {
          expect(held.row()?.status).toBe('completed')
        })
        expect(t.shell).toHaveBeenCalledOnce()
        expect(t.port.isNativeUnsafe()).toBe(false)
      } finally {
        held.release.resolve(undefined)
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'runs an unchanged user command through checkpoint and native admission',
    async () => {
      const t = await setup()
      const held = await heldUserShell(t)
      held.release.resolve(undefined)
      await vi.waitFor(() => {
        expect(held.row()).toMatchObject({ status: 'completed', visibleOutput: 'passed' })
      })
      expect(t.shell).toHaveBeenCalledOnce()
      expect(t.port.isNativeUnsafe()).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
