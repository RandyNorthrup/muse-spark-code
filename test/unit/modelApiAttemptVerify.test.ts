// M77/M68 production-manager construction over native parent/trial files.
// The editor callbacks stand in for VS Code; actual tool writes and formatting publish on disk.
import { mkdtempSync, realpathSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import type { VerifyHooks } from '../../src/core/backends/modelapi/verifyLoop'
import { fingerprint } from '../../src/core/verify/fingerprint'
import type { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import type { FileDiagnostics } from '../../src/core/verify/diagnosticsReport'
import { MODEL_TEXT } from '../../src/shared/constants'
import { fileContextIo } from '../../src/host/backend/contextIo'
import { ModelApiBackendManager } from '../../src/host/backend/modelApiBackendManager'
import * as modelApiEntry from '../../src/host/backend/modelApiEntry'
import { createToolIo } from '../../src/host/backend/toolIo'
import { fakeEditProviders, FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi } from './helpers/fakeModelApi'
import { fakeManagerDeps } from './helpers/modelApiManager'
import { fakeLanguageService, KIND, sym } from './helpers/fakeLanguageService'
import type { RenameEdits } from '../../src/core/codeIntel/languageService'

const roots: string[] = []
const hosts: ModelApiHost[] = []
afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map(async (host) => {
      await host.close()
    }),
  )
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function setup() {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-trial-verify-')))
  roots.push(root)
  const trialRoot = path.join(root, 'trial')
  await mkdir(trialRoot)
  const parentFile = path.join(root, 'source.ts')
  const trialFile = path.join(trialRoot, 'source.ts')
  await writeFile(parentFile, 'const answer = 1;\n')
  await writeFile(trialFile, 'const answer = 1;\n')
  let atAtomicBoundary: (() => void) | undefined
  const io = createToolIo({
    platform: process.platform,
    systemRoot: process.env['SystemRoot'],
    env: () => ({}),
    listFiles: () => Promise.resolve(['source.ts']),
    searchWorkerPath: 'unused',
    log: () => undefined,
    unsavedFiles: () => [],
    assertWorkspaceCurrent: () => {
      atAtomicBoundary?.()
    },
  })
  const shell = vi.spyOn(io, 'runShell').mockResolvedValue({
    stdout: 'passed',
    stderr: '',
    exitCode: 0,
    isTimedOut: false,
    isCancelled: false,
  })
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const dispose = vi.fn<() => void>()
  const { format, diagnostics } = fakeEditProviders()
  const parentFormat = vi.fn<VerifyHooks['formatAfterEdit']>(() => Promise.resolve(undefined))
  const parentDiagnostics = vi.fn<VerifyHooks['diagnosticsAfterEdit']>(() => Promise.resolve([]))
  const settings: {
    diagnostics: boolean
    format: boolean
    checks: boolean
    isTrusted: boolean
    denySource: boolean
    commandRules: readonly unknown[]
  } = {
    diagnostics: true,
    format: true,
    checks: true,
    isTrusted: true,
    denySource: false,
    commandRules: [],
  }
  const verify: VerifyHooks = {
    isDiagnosticsOn: () => settings.diagnostics,
    isFormatOnEdit: () => settings.format,
    checkCommands: () => (settings.checks ? [{ name: 'lint', command: 'npm test' }] : []),
    formatAfterEdit: parentFormat,
    diagnosticsAfterEdit: parentDiagnostics,
  }
  const createAttemptVerify = vi.fn((workspaceRoot: string): VerifyHooks => {
    expect(workspaceRoot).toBe(trialRoot)
    return { ...verify, formatAfterEdit: format, diagnosticsAfterEdit: diagnostics, dispose }
  })
  let ids = 0
  const sourceFiles = new Map([
    [parentFile, 'const answer = 1;\n'],
    [trialFile, 'const answer = 1;\n'],
  ])
  const codeIntel = fakeLanguageService({
    files: sourceFiles,
    symbols: Object.fromEntries(
      Array.from(sourceFiles.keys(), (file) => [file, [sym('answer', KIND.constant, file, 0, 6)]]),
    ),
    rename: (_file, _at, newName): Promise<RenameEdits> =>
      Promise.resolve({
        fileOperations: 'none',
        files: Array.from(sourceFiles.keys(), (file) => ({
          path: file,
          edits: [
            {
              range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
              newText: newName,
            },
          ],
        })),
      }),
  })
  const manager = new ModelApiBackendManager(
    fakeManagerDeps(api, log, {
      workspaceRoot: root,
      sessionWorkspaceRoot: path.join(root, 'parent-display-alias'),
      contextIo: fileContextIo,
      io,
      codeIntel,
      isWorkspaceTrusted: () => settings.isTrusted,
      permissionSettings: () => ({
        commandRules: settings.commandRules,
        profiles: { restricted: { denyRead: ['source.ts'] } },
        profile: settings.denySource ? 'restricted' : '',
        repositoryRules: undefined,
      }),
      newId: () => `trial-${String(++ids)}`,
      verify,
      createAttemptVerify,
      bundlePath: 'src/host/backend/modelApiEntry.ts',
      loadBundle: () => modelApiEntry,
    }),
  )
  return {
    root,
    trialRoot,
    parentFile,
    trialFile,
    api,
    manager,
    createAttemptVerify,
    format,
    diagnostics,
    parentFormat,
    parentDiagnostics,
    dispose,
    shell,
    io,
    settings,
    setAtomicBoundary: (callback: () => void) => {
      atAtomicBoundary = callback
    },
  }
}

async function trial(t: Awaited<ReturnType<typeof setup>>) {
  const host = await t.manager.buildAttemptHost(t.trialRoot, () => undefined)
  hosts.push(host)
  const session = await host.startSession({
    workspaceRoot: t.trialRoot,
    modelId: 'muse-spark-1.3',
    approvalMode: 'onRequest',
  })
  const events: AgentEvent[] = []
  session.onEvent((event) => {
    events.push(event)
    if (event.type === 'approvalRequested')
      void session.decideApproval({
        approvalId: event.approvalId,
        requirementId: event.requirementId,
        choiceId: 'allow_once',
      })
  })
  t.api.script(
    { calls: [{ name: 'read_file', arguments: JSON.stringify({ path: 'source.ts' }) }] },
    {
      calls: [
        {
          name: 'write_file',
          arguments: JSON.stringify({ path: 'source.ts', content: 'const answer = 2;\n' }),
        },
      ],
    },
    { text: 'done' },
  )
  return { host, session, events }
}

async function nativeRename(t: Awaited<ReturnType<typeof setup>>) {
  t.settings.diagnostics = false
  t.settings.format = false
  t.settings.checks = false
  const host = await t.manager.ensureHost()
  hosts.push(host)
  const session = await host.startSession({
    workspaceRoot: t.root,
    modelId: 'muse-spark-1.3',
    approvalMode: 'allowAll',
  })
  const events: AgentEvent[] = []
  session.onEvent((event) => {
    events.push(event)
  })
  t.api.script(
    {
      calls: [
        {
          name: 'rename_symbol',
          arguments: JSON.stringify({
            path: 'source.ts',
            symbol: 'answer',
            new_name: 'result',
          }),
        },
      ],
    },
    { text: 'done' },
  )
  return { host, session, events }
}

function holdFormatter(t: Awaited<ReturnType<typeof setup>>) {
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<string>()
  t.format.mockImplementation(async () => {
    entered.resolve(undefined)
    return await release.promise
  })
  return { entered, release }
}

async function finishedTurn(events: readonly AgentEvent[]): Promise<void> {
  await vi.waitFor(() => {
    expect(events.some((event) => event.type === 'turnCompleted')).toBe(true)
  })
}

async function sendTrial(turn: Awaited<ReturnType<typeof trial>>): Promise<void> {
  await turn.session.sendTurn([{ type: 'text', text: 'fix the trial' }])
  await finishedTurn(turn.events)
}

function afterNativeWrite(
  t: Awaited<ReturnType<typeof setup>>,
  after: () => void | Promise<void>,
): void {
  const original = t.io.writeFile.bind(t.io)
  vi.spyOn(t.io, 'writeFile').mockImplementation(async (...args) => {
    await original(...args)
    await after()
  })
}

async function startHeldFormat(t: Awaited<ReturnType<typeof setup>>) {
  t.settings.diagnostics = false
  t.settings.checks = false
  const held = holdFormatter(t)
  const turn = await trial(t)
  await turn.session.sendTurn([{ type: 'text', text: 'fix the trial' }])
  await held.entered.promise
  return { ...held, ...turn }
}

async function expectNativeFiles(
  t: Awaited<ReturnType<typeof setup>>,
  parent: string,
  child: string,
): Promise<void> {
  expect(await readFile(t.parentFile, 'utf8')).toBe(parent)
  expect(await readFile(t.trialFile, 'utf8')).toBe(child)
}

describe('production trial verification uses its own root (M77/M68)', () => {
  it('keeps the completed ordinary edit and patch when Plan revokes formatter entry', async () => {
    const t = await setup()
    t.settings.diagnostics = false
    t.settings.checks = false
    afterNativeWrite(t, () => r.session.setApprovalMode('denyUnmatched'))
    const r = await trial(t)
    await sendTrial(r)
    expect(await readFile(t.trialFile, 'utf8')).toBe('const answer = 2;\n')
    expect(t.format).not.toHaveBeenCalled()
    const completed = r.events.find(
      (event) => event.type === 'itemCompleted' && event.item.tool === 'write_file',
    )
    if (completed?.type !== 'itemCompleted') throw new Error('Expected actual completed edit row')
    expect(completed.item.patchRef).toBeDefined()
    expect(completed.item.patchSummary?.files).toBe(1)
  })

  it('refuses the first native rename publication after a held stage switches to Plan', async () => {
    const t = await setup()
    const r = await nativeRename(t)
    let isFired = false
    const updates: Promise<unknown>[] = []
    t.setAtomicBoundary(() => {
      if (isFired) return
      isFired = true
      updates.push(r.session.setApprovalMode('denyUnmatched'))
    })
    await r.session.sendTurn([{ type: 'text', text: 'rename answer' }])
    await finishedTurn(r.events)
    await Promise.all(updates)
    expect(isFired).toBe(true)
    await expectNativeFiles(t, 'const answer = 1;\n', 'const answer = 1;\n')
  })

  it('renames both native files under unchanged admission', async () => {
    const t = await setup()
    const r = await nativeRename(t)
    await r.session.sendTurn([{ type: 'text', text: 'rename answer' }])
    await finishedTurn(r.events)
    await expectNativeFiles(t, 'const result = 1;\n', 'const result = 1;\n')
  })

  it('preserves the established finish-after-first-write Stop contract for native rename', async () => {
    const t = await setup()
    const r = await nativeRename(t)
    const original = t.io.writeFile.bind(t.io)
    let writes = 0
    const updates: Promise<unknown>[] = []
    vi.spyOn(t.io, 'writeFile').mockImplementation(async (...args) => {
      await original(...args)
      writes += 1
      if (writes === 1) updates.push(r.session.cancel())
    })
    await r.session.sendTurn([{ type: 'text', text: 'rename answer' }])
    await finishedTurn(r.events)
    await Promise.all(updates)
    expect(writes).toBe(2)
    await expectNativeFiles(t, 'const result = 1;\n', 'const result = 1;\n')
  })

  it.each(['stop', 'trust', 'mode', 'policy'] as const)(
    'refuses an ordinary first write when %s changes at the actual native atomic boundary',
    async (change) => {
      const t = await setup()
      t.settings.format = false
      t.settings.diagnostics = false
      t.settings.checks = false
      const r = await trial(t)
      let isFired = false
      const updates: Promise<unknown>[] = []
      t.setAtomicBoundary(() => {
        if (isFired) return
        isFired = true
        switch (change) {
          case 'stop': {
            updates.push(r.session.cancel())
            break
          }
          case 'mode': {
            updates.push(r.session.setApprovalMode('denyUnmatched'))
            break
          }
          case 'trust': {
            t.settings.isTrusted = false
            break
          }
          default: {
            t.settings.denySource = true
          }
        }
      })
      await sendTrial(r)
      await Promise.all(updates)
      expect(isFired).toBe(true)
      await expectNativeFiles(t, 'const answer = 1;\n', 'const answer = 1;\n')
      expect(t.format).not.toHaveBeenCalled()
    },
  )

  it('formats and checks native trial bytes, reports trial diagnostics and leaves the parent alone', async () => {
    const t = await setup()
    const parentAdded = vi.spyOn(t.manager.workspaceEdits, 'add')
    const r = await trial(t)
    await r.session.sendTurn([{ type: 'text', text: 'fix the trial' }])
    await vi.waitFor(() => {
      expect(r.events).toContainEqual(
        expect.objectContaining({
          type: 'turnCompleted',
          terminal: 'completed',
        }),
      )
    })
    await expectNativeFiles(t, 'const answer = 1;\n', 'const answer = 3;\n')
    expect(t.format).toHaveBeenCalledWith(t.trialFile, 'const answer = 2;\n')
    expect(t.diagnostics.mock.calls[0]?.[0]).toEqual([
      {
        relative: 'source.ts',
        absolute: t.trialFile,
        fingerprint: fingerprint('const answer = 3;\n'),
      },
    ])
    expect(t.shell.mock.calls[0]?.[1]).toBe(t.trialRoot)
    expect(t.parentFormat).not.toHaveBeenCalled()
    expect(t.parentDiagnostics).not.toHaveBeenCalled()
    const listed = await r.host.listSessions({ workspaceRoot: t.trialRoot, limit: 1 })
    expect(listed.sessions[0]?.workspaceRoot).toBe(t.trialRoot)
    expect(parentAdded).not.toHaveBeenCalled()
    await r.host.close()
    await r.host.close()
    expect(t.dispose).toHaveBeenCalledOnce()
    await t.manager.dispose()
  })

  it('reads current machine getters rather than copying an earlier enabled setting', async () => {
    const t = await setup()
    const r = await trial(t)
    t.settings.format = false
    t.settings.diagnostics = false
    t.settings.checks = false
    await sendTrial(r)
    await expectNativeFiles(t, 'const answer = 1;\n', 'const answer = 2;\n')
    expect(t.format).not.toHaveBeenCalled()
    expect(t.diagnostics).not.toHaveBeenCalled()
    expect(t.shell).not.toHaveBeenCalled()
  })

  it('disposes the owned editor on construction failure', async () => {
    const t = await setup()
    const broken = new ModelApiBackendManager(
      fakeManagerDeps(t.api, new FakeLogOutputChannel(), {
        workspaceRoot: t.root,
        createAttemptVerify: t.createAttemptVerify,
        bundlePath: 'invalid-verify-bundle',
        loadBundle: () => ({}),
      }),
    )
    await expect(broken.buildAttemptHost(t.trialRoot, () => undefined)).rejects.toThrow()
    expect(t.dispose).toHaveBeenCalledOnce()
    await broken.dispose()
  })

  it('closes the owned editor on Stop and never publishes a formatter that returns later', async () => {
    const t = await setup()
    const r = await startHeldFormat(t)
    const { release } = r
    try {
      await r.session.cancel()
      const closing = r.host.close()
      release.resolve('const answer = 3;\n')
      await closing
      expect(t.dispose).toHaveBeenCalledOnce()
      await t.format.mock.results[0]?.value
      await expectNativeFiles(t, 'const answer = 1;\n', 'const answer = 2;\n')
    } finally {
      release.resolve('const answer = 3;\n')
    }
  })

  it.each(['trust', 'mode', 'policy'] as const)(
    'retains the native edit but refuses late formatter publication after %s changes',
    async (change) => {
      const t = await setup()
      const r = await startHeldFormat(t)
      const { release } = r
      try {
        if (change === 'trust') t.settings.isTrusted = false
        else if (change === 'policy') t.settings.denySource = true
        else await r.session.setApprovalMode('denyUnmatched')
        release.resolve('const answer = 3;\n')
        await finishedTurn(r.events)
        await expectNativeFiles(t, 'const answer = 1;\n', 'const answer = 2;\n')
      } finally {
        release.resolve('const answer = 3;\n')
      }
    },
  )

  it.each(['trust', 'policy'] as const)(
    'withholds a held diagnostic provider result and all check execution after %s revocation',
    async (change) => {
      const t = await setup()
      t.settings.format = false
      const entered = Promise.withResolvers<readonly FileDiagnostics[]>()
      const release = Promise.withResolvers<readonly FileDiagnostics[]>()
      t.diagnostics.mockImplementation(async (files) => {
        entered.resolve(
          files.map((file): FileDiagnostics => ({
            file,
            entries: [
              {
                path: file.relative,
                severity: 'error',
                line: 1,
                column: 1,
                message: 'PRIVATE_DIAGNOSTIC_CANARY',
                source: 'offline-test',
              },
            ],
          })),
        )
        return await release.promise
      })
      const r = await trial(t)
      try {
        await r.session.sendTurn([{ type: 'text', text: 'fix the trial' }])
        const privateReport = await entered.promise
        if (change === 'trust') t.settings.isTrusted = false
        else t.settings.denySource = true
        release.resolve(privateReport)
        await finishedTurn(r.events)
        expect(t.shell).not.toHaveBeenCalled()
        expect(JSON.stringify(t.api.responseBodies())).not.toContain('PRIVATE_DIAGNOSTIC_CANARY')
        expect(JSON.stringify(r.events)).not.toContain('PRIVATE_DIAGNOSTIC_CANARY')
        const row = r.events.find(
          (event) => event.type === 'itemCompleted' && event.item.tool === 'verify_edits',
        )
        if (row?.type !== 'itemCompleted') throw new Error('Expected actual automatic verify row')
        expect(row.item.visibleOutput).toContain(MODEL_TEXT.verifyAccessRefused)
        expect(row.item.verifySummary).toMatchObject({ unchecked: 1 })
        expect(row.item.verifySummary?.errors).toBeUndefined()
        expect(row.item.verifySummary?.warnings).toBeUndefined()
      } finally {
        release.resolve([])
      }
    },
  )

  it('does not open diagnostics or run checks when file policy changes immediately after the native edit', async () => {
    const t = await setup()
    t.settings.format = false
    // The native edit completes before the owner's machine policy changes.
    afterNativeWrite(t, () => {
      t.settings.denySource = true
    })
    const r = await trial(t)
    await sendTrial(r)
    expect(await readFile(t.trialFile, 'utf8')).toBe('const answer = 2;\n')
    expect(t.diagnostics).not.toHaveBeenCalled()
    expect(t.shell).not.toHaveBeenCalled()
    expect(r.events).toContainEqual(
      expect.objectContaining({
        type: 'itemCompleted',
        item: expect.objectContaining({
          tool: 'verify_edits',
          verifySummary: expect.objectContaining({ unchecked: 1 }),
        }),
      }),
    )
  })

  it('applies configured command forbids to automatic checks before hooks, cards or process entry', async () => {
    const t = await setup()
    t.settings.format = false
    t.settings.diagnostics = false
    t.settings.commandRules = [
      { pattern: ['npm', 'test'], decision: 'forbid', match: ['npm test'] },
    ]
    const r = await trial(t)
    await sendTrial(r)
    expect(t.shell).not.toHaveBeenCalled()
    expect(
      r.events.filter(
        (event) => event.type === 'approvalRequested' && event.subject.kind === 'shell',
      ),
    ).toEqual([])
    expect(r.events).toContainEqual(
      expect.objectContaining({
        type: 'itemCompleted',
        item: expect.objectContaining({
          tool: 'verify_edits',
          verifySummary: expect.objectContaining({
            checks: [{ name: 'lint', outcome: 'notRun', skip: 'refused' }],
          }),
        }),
      }),
    )
  })
})
