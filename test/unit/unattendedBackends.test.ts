import * as ts from 'typescript'
import { parseHookConfig } from '../../src/core/backends/modelapi/hooks'
import type { EditedFile, FileDiagnostics } from '../../src/core/verify/diagnosticsReport'
import { describeEnvironment } from '../../src/host/backend/environment'
import { ProvenanceLedger, contentHash } from '../../src/core/schedules/provenance'
import { diagnosticsTool } from '../../src/core/diagnostics'
import { pdfFixture } from './helpers/pdfFixture'
import { describe, expect, it, vi } from 'vitest'
import { MuseCodeHost, MuseSession } from '../../src/core/backends/musecode/MuseCodeHost'
import { ModelApiHost, type ModelApiHostDeps } from '../../src/core/backends/modelapi/ModelApiHost'
import { ModelApiClient, type ModelApiClientDeps } from '../../src/core/backends/modelapi/client'
import {
  MODEL_API_TOOLS,
  MODEL_API_MODEL_TEXT,
  RULES_FILE_MAX_BYTES,
  SUBAGENT_CAPACITY,
} from '../../src/shared/constants'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { fakeMspHost, settle } from './helpers/fakeMsp'
import { raceRequested, RACE_APPROVAL_ID } from './helpers/stageRaceCapture'
import {
  fakeModelApi,
  fakeModelApiClientSettings,
  FAKE_MODEL_API_ACCOUNT_ID,
  TINY_PNG_BASE64,
} from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { fakeLanguageService, renamed, sym, KIND } from './helpers/fakeLanguageService'
import { memoryStoreOver } from './helpers/fakeMemoryIo'
import { memoryContextIo } from './helpers/fakeContextIo'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel } from './helpers/fakes'
import { startWatchedSession } from './helpers/sessionTurns'
import type { ScheduleRunDeps, UnattendedRun } from '../../src/core/schedules/unattended'
import { fakeMcpSource } from './helpers/fakeMcpSource'
import { unattendedRun } from './helpers/schedules/unattended'
import { fakeRunContext } from './helpers/schedules/fixtures'

function paidReservation(claimId: string, spentUsd = 0) {
  return vi.fn().mockResolvedValue({
    claimId,
    reservedUsd: 1,
    check: () => ({ spentUsd, hasUnknownHistoricalFees: false }),
    settle: () => Promise.resolve({ spentUsd: 0, hasUnknownHistoricalFees: false }),
  })
}

async function modelBackend(
  overrides: Partial<ModelApiHostDeps> = {},
  clientOverrides: Partial<ModelApiClientDeps> = {},
  shouldWarmContext = true,
) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({ 'src/read.txt': 'inside workspace' }, '/workspace')
  const popup = vi.fn().mockResolvedValue(false)
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({
      client: new ModelApiClient({
        ...fakeModelApiClientSettings(log),
        fetch: api.fetch,
        ...clientOverrides,
      }),
      workspaceRoot: '/workspace',
      io,
      log,
    }),
    isPaidFeatureOn: () => true,
    allowsPaidUse: popup,
    ...overrides,
  })
  const watched = await startWatchedSession(host, '/workspace', 'promptUnmatched')
  if (shouldWarmContext) await watched.session.listSkills()
  watched.session.onEvent((event) => {
    if (['approvalRequested', 'elicitationRequested', 'questionRequested'].includes(event.type))
      void watched.session.cancel()
  })
  const reserve = paidReservation('paid-claim', 1)
  const run = (context = fakeRunContext(), overrides: Partial<ScheduleRunDeps> = {}) =>
    unattendedRun({
      context: { ...context, grant: { ...context.grant, paidCapUsd: 1 } },
      io,
      paid: {
        modelId: 'muse-spark-1.3',
        accountId: FAKE_MODEL_API_ACCOUNT_ID,
        allows: (feature) => feature === 'scheduledPrompts',
        reserve,
      },
      ...overrides,
    })
  return { api, io, popup, host, log, ...watched, run, reserve }
}

const PROTECTED_ATTACHMENT = {
  type: 'textFile',
  name: '.muse/private.txt',
  mediaType: 'text/plain',
  text: 'private bytes',
  sizeBytes: 13,
} as const

function heldReply() {
  const entered = Promise.withResolvers<undefined>()
  const held = Promise.withResolvers<undefined>()
  return {
    entered,
    held,
    reply: {
      hold: held.promise,
      onRequest: () => {
        entered.resolve(undefined)
      },
    },
  }
}

function heldAttachmentPath() {
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  return {
    entered,
    release,
    io: {
      realPath: async (path: string) => {
        if (path.replaceAll('\\', '/').endsWith('/src/held.txt')) {
          entered.resolve(undefined)
          await release.promise
        }
        return path
      },
    },
  }
}

function scriptImage(
  api: ReturnType<typeof fakeModelApi>,
  name: string,
  images: readonly string[],
) {
  api.script(
    {
      calls: [
        { name, arguments: JSON.stringify({ path: 'assets/out.png', prompt: 'test', images }) },
      ],
    },
    { text: 'done' },
  )
}

function commandContext() {
  const context = fakeRunContext()
  context.grant.rules = [{ id: 'npm', kind: 'command', prefix: 'npm test' }]
  return context
}

function scriptShell(api: ReturnType<typeof fakeModelApi>) {
  api.script({ calls: [{ name: 'bash', arguments: '{"command":"npm test"}' }] }, { text: 'done' })
}

const ack = (params: Record<string, unknown>) => ({
  commandId: params['commandId'],
  status: 'accepted',
})
const DEFAULT_SUBJECT = { kind: 'shell', command: 'npm test' }

function museEvents(session: MuseSession) {
  const events: AgentEvent[] = []
  session.onEvent((event) => {
    events.push(event)
  })
  return events
}

async function museBackend(approvalMode = 'promptUnmatched') {
  const wire = fakeMspHost()
  wire.server.handle('session/start', () => ({
    session: { sessionId: 'schedule-session', modelId: 'muse-spark-1.3', status: 'idle' },
    viewCursor: '',
  }))
  wire.server.handle('session/setApprovalMode', (params) => ({
    ...ack(params),
    applyOutcome: 'completed',
    effectiveMode: { mode: params['mode'], source: 'approvalReconfigure' },
  }))
  wire.server.handle('turn/start', (params) => ({
    ...ack(params),
    turnId: 'schedule-turn',
    disposition: 'started',
    startedNewTurn: true,
  }))
  wire.server.handle('turn/steer', (params) => ({ ...ack(params), turnId: 'schedule-turn' }))
  wire.server.handle('turn/cancel', ack)
  wire.server.handle('approval/decide', (params) => ({ ...ack(params), terminal: true }))
  wire.server.handle('userInput/clarify', ack)
  const host = new MuseCodeHost(wire.host, new FakeLogOutputChannel())
  const session = await host.startSession({
    approvalMode,
    modelId: 'muse-spark-1.3',
    workspaceRoot: '/workspace',
  })
  if (!(session instanceof MuseSession)) throw new Error('Expected Muse session')
  const events = museEvents(session)
  const notifyApproval = (
    tool = 'powershell',
    subject: { kind: string; command: string } = DEFAULT_SUBJECT,
    id = RACE_APPROVAL_ID,
  ) => {
    wire.server.notify('approval/requested', {
      ...raceRequested(session.sessionId),
      approvalId: id,
      currentRequirementId: { approvalId: id, sourceIndex: 0 },
      toolName: tool,
      turnId: 'schedule-turn',
      subject,
    })
  }
  return { ...wire, host, session, events, notifyApproval }
}

async function museDecided(fixture: Awaited<ReturnType<typeof museBackend>>, count = 1) {
  await vi.waitFor(() => {
    expect(fixture.server.requestsFor('approval/decide')).toHaveLength(count)
  })
}

async function completeMuseTurn(fixture: Awaited<ReturnType<typeof museBackend>>) {
  fixture.server.notify('turn/completed', {
    sessionId: fixture.session.sessionId,
    turnId: 'schedule-turn',
    terminal: 'completed',
  })
  await settle()
}

async function cancelBeforeDispatch(
  fixture: Awaited<ReturnType<typeof modelBackend>>,
  entered: Promise<undefined>,
  held: PromiseWithResolvers<undefined>,
) {
  const done = fixture.turnDone()
  await fixture.session.sendTurn([{ type: 'text', text: 'Ordinary' }])
  await entered
  await fixture.session.cancel()
  held.resolve(undefined)
  await done
}

function readCall(file: string) {
  return { name: MODEL_API_TOOLS.readFile, arguments: JSON.stringify({ path: file }) }
}

function writeCall(file: string, content: string) {
  return { name: MODEL_API_TOOLS.writeFile, arguments: JSON.stringify({ path: file, content }) }
}

async function completeModelPrompt(
  fixture: Awaited<ReturnType<typeof modelBackend>>,
  run: UnattendedRun,
  text: string,
) {
  const done = fixture.turnDone()
  await fixture.session.sendScheduledTurn([{ type: 'text', text }], run)
  await done
}

function diagnosticsOnly(
  diagnostics: NonNullable<ModelApiHostDeps['verify']>['diagnosticsAfterEdit'],
): NonNullable<ModelApiHostDeps['verify']> {
  return {
    isDiagnosticsOn: () => true,
    checkCommands: () => [],
    isFormatOnEdit: () => false,
    diagnosticsAfterEdit: diagnostics,
    formatAfterEdit: () => Promise.resolve(undefined),
  }
}

async function sendScheduledEdit(
  fixture: Awaited<ReturnType<typeof modelBackend>>,
  run: UnattendedRun,
) {
  await completeModelPrompt(fixture, run, 'Edit')
  expect(fixture.io.files.get('/workspace/src/new.txt')).toBe('change')
}

function expectCompletedFire(
  fixture: Awaited<ReturnType<typeof modelBackend>>,
  run: UnattendedRun,
) {
  expect(fixture.api.responseBodies()).toHaveLength(2)
  expect(run.refusedActions.filter((action) => action.tool === 'replay')).toEqual([])
  expect(fixture.events.filter((event) => event.type === 'turnCompleted')).toMatchObject([
    { terminal: 'completed' },
  ])
}

async function expectSettledModel(fixture: Awaited<ReturnType<typeof modelBackend>>) {
  await vi.waitFor(() => {
    expect({
      errors: fixture.log.error.mock.calls,
      completions: fixture.events.filter((event) => event.type === 'turnCompleted').length,
      status: fixture.session.status,
    }).toMatchObject({ errors: [], completions: 2 })
  })
}

function modeResult(params: Record<string, unknown>) {
  return {
    ...ack(params),
    applyOutcome: 'completed',
    effectiveMode: { mode: params['mode'], source: 'approvalReconfigure' },
  }
}

function answerNative(
  fixture: Awaited<ReturnType<typeof museBackend>>,
  method: string,
  index: number,
  result: (params: Record<string, unknown>) => Record<string, unknown>,
) {
  const request = fixture.server.requestsFor(method)[index]
  if (request?.params === undefined) throw new Error('Expected held native request')
  fixture.server.incoming.push(
    JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: { ...ack(request.params), ...result(request.params) },
    }) + '\n',
  )
}

async function heldOrdinaryStart(fixture: Awaited<ReturnType<typeof museBackend>>) {
  fixture.server.silence('turn/start')
  const ordinary = fixture.session.sendTurn([{ type: 'text', text: 'Ordinary' }])
  await vi.waitFor(() => {
    expect(fixture.server.requestsFor('turn/start')).toHaveLength(1)
  })
  return { ordinary }
}

describe('scheduled Model API dispatch', () => {
  it('RVM115U6 P2-3: a claimed steer refuses automatic verification before adoption', async () => {
    const marker = 'ProtectedPendingDiagnosticMarker'
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const diagnostics = vi.fn().mockResolvedValue([
      {
        file: { absolute: '/workspace/src/new.ts', relative: 'src/new.ts' },
        entries: [{ severity: 'error', line: 1, column: 1, message: marker, path: 'src/new.ts' }],
      },
    ])
    const io = memoryToolIo({}, '/workspace')
    io.runHook = async () => {
      entered.resolve(undefined)
      await release.promise
      return { stdout: '{}', stderr: '', exitCode: 0, isTimedOut: false, isCancelled: false }
    }
    const fixture = await modelBackend({
      io,
      verify: diagnosticsOnly(diagnostics),
      loadHooks: () =>
        Promise.resolve(
          parseHookConfig(
            JSON.stringify({
              hooks: {
                PostToolBatch: [{ hooks: [{ type: 'command', command: 'hold-verification' }] }],
              },
            }),
            'project',
            'linux',
          ).hooks,
        ),
    })
    await fixture.session.setApprovalMode('allowAll')
    fixture.api.script(
      { calls: [writeCall('src/new.ts', 'export const value = 1;')] },
      { text: 'done' },
    )
    const done = fixture.turnDone()
    const ordinary = await fixture.session.sendTurn([{ type: 'text', text: 'Edit' }])
    await entered.promise
    const { run } = fixture.run({ ...fakeRunContext(), mode: 'acceptEdits' })
    try {
      await fixture.session.steerScheduledTurn(
        ordinary.turnId,
        [{ type: 'text', text: 'Fire' }],
        run,
      )
      expect(fixture.session.getScheduledRun()).toBe(run)
      release.resolve(undefined)
      await done
      expect(diagnostics).not.toHaveBeenCalled()
      expect(JSON.stringify(fixture.session.snapshot().replay)).not.toContain(marker)
      expect(JSON.stringify(fixture.session.snapshot().replay)).toContain(
        MODEL_API_MODEL_TEXT.verifyAccessRefused,
      )
    } finally {
      release.resolve(undefined)
      await fixture.host.close()
    }
  })

  it.each([false, true])(
    'RVM115U5 P1-2: undelivered cached Git subjects refuse (recorded=%s)',
    async (recorded) => {
      const marker = 'UndeliveredGitCommitMarker'
      const entered = Promise.withResolvers<undefined>()
      const held = Promise.withResolvers<undefined>()
      const log = new FakeLogOutputChannel()
      const beforeTurnRuns = vi
        .fn()
        .mockResolvedValue(undefined)
        .mockImplementationOnce(async () => {
          entered.resolve(undefined)
          await held.promise
        })
      const fixture = await modelBackend({
        beforeTurnRuns,
        describeEnvironment: recorded
          ? () =>
              describeEnvironment({
                runGit: (args) => {
                  if (args.includes('log')) return Promise.resolve(`abcdef ${marker}`)
                  if (args.includes('--abbrev-ref')) return Promise.resolve('main')
                  return Promise.resolve(args.includes('--show-toplevel') ? '/workspace' : '')
                },
                workspaceRoot: '/workspace',
                isWorkspaceTrusted: () => true,
                log,
                now: () => 0,
              })
          : () =>
              Promise.resolve({
                git: { branch: 'main', changedFiles: 0, recentCommits: [marker] },
              }),
      })
      await cancelBeforeDispatch(fixture, entered.promise, held)
      expect(fixture.api.responseBodies()).toHaveLength(0)
      const { run } = fixture.run()
      const sources = vi.spyOn(run, 'decideSource')
      fixture.api.script({ text: 'fire' })
      await completeModelPrompt(fixture, run, 'Fire')
      expect(fixture.api.responseBodies()).toHaveLength(0)
      expect(JSON.stringify(fixture.api.responseBodies())).not.toContain(marker)
      expect(run.refusedActions.length).toBeGreaterThan(0)
      if (recorded) expect(sources.mock.calls.some(([source]) => source.kind === 'git')).toBe(true)
      await fixture.host.close()
    },
  )

  it('RVM115U5 P1-3: protected dependency diagnostics never enter a verification note', async () => {
    const marker = 'ProtectedDiagnosticMarker'
    const files = new Map([
      ['/workspace/.muse/private.ts', `export interface Secret { ${marker}: string }`],
      [
        '/workspace/src/new.ts',
        'import type { Secret } from "../.muse/private"; const value: Secret = {};',
      ],
    ])
    const compiler = () => {
      const host = ts.createCompilerHost({ noLib: true })
      host.readFile = (path) => files.get(path.replaceAll('\\', '/'))
      host.fileExists = (path) => files.has(path.replaceAll('\\', '/'))
      host.directoryExists = () => true
      const program = ts.createProgram(['/workspace/src/new.ts'], { noLib: true }, host)
      return program
        .getSemanticDiagnostics()
        .map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, '\n'))
        .join('\n')
    }
    expect(compiler()).toContain(marker)
    const diagnostics = vi.fn(
      (edited: readonly EditedFile[]): Promise<readonly FileDiagnostics[]> =>
        Promise.resolve(
          edited.map((file) => ({
            file,
            entries: [
              {
                severity: 'error',
                line: 1,
                column: 1,
                message: compiler(),
                path: file.relative,
                source: 'typescript',
              },
            ],
          })),
        ),
    )
    const fixture = await modelBackend({
      verify: diagnosticsOnly(diagnostics),
    })
    fixture.api.script(
      { calls: [writeCall('src/new.ts', files.get('/workspace/src/new.ts')!)] },
      { text: 'done' },
    )
    const { run } = fixture.run({ ...fakeRunContext(), mode: 'acceptEdits' })
    await completeModelPrompt(fixture, run, 'Edit')
    expect(diagnostics).not.toHaveBeenCalled()
    expect(fixture.api.responseBodies()).toHaveLength(2)
    expect(JSON.stringify(fixture.api.responseBodies())).not.toContain(marker)
    expect(JSON.stringify(fixture.api.responseBodies()[1]?.['input'])).toContain(
      MODEL_API_MODEL_TEXT.verifyAccessRefused,
    )
    await fixture.host.close()
  })

  it.each([true, false])(
    'RVM115U4 P1: an unsent cached repo map registers every input (protected=%s)',
    async (isProtected) => {
      const definition = isProtected ? '.muse/private.ts' : 'src/definition.ts'
      const marker = 'ProtectedRepoMapMarker'
      const io = memoryToolIo(
        {
          [definition]: `export function ${marker}() {}`,
          'src/use.ts': `${marker}()`,
        },
        '/workspace',
      )
      const codeIntel = fakeLanguageService({
        files: io.files,
        workspace: (query) =>
          Promise.resolve(
            query === marker ? [sym(marker, KIND.function, `/workspace/${definition}`, 0, 16)] : [],
          ),
      })
      const entered = Promise.withResolvers<undefined>()
      const held = Promise.withResolvers<undefined>()
      const beforeTurnRuns = vi
        .fn()
        .mockResolvedValue(undefined)
        .mockImplementationOnce(async () => {
          entered.resolve(undefined)
          await held.promise
        })
      const fixture = await modelBackend({
        io,
        codeIntel,
        isRepoMapInPrompt: () => true,
        now: () => 0,
        beforeTurnRuns,
      })
      await cancelBeforeDispatch(fixture, entered.promise, held)
      expect(fixture.api.responseBodies()).toHaveLength(0)
      fixture.api.script({ text: 'fire' })
      const { run } = fixture.run(undefined, { io })
      const sources = vi.spyOn(run, 'decideSource')
      const derivations = vi.spyOn(ProvenanceLedger.prototype, 'derive')
      try {
        await completeModelPrompt(fixture, run, 'Fire')
        expect(fixture.api.responseBodies()).toHaveLength(isProtected ? 0 : 1)
        expect(
          sources.mock.calls.some(([source]) =>
            source.kind === 'directory'
              ? source.paths.includes(`/workspace/${definition}`)
              : source.kind === 'file' && source.file.path === `/workspace/${definition}`,
          ),
        ).toBe(true)
        if (!isProtected) {
          const map = derivations.mock.calls.find((recipe) => recipe[2] === 'cached-repo-map')
          expect(map?.[1]?.inventory()).toHaveLength(7)
          expect(fixture.api.responseBodies()[0]?.['instructions']).toContain(marker)
        }
        expect(fixture.session.getScheduledRun()).toBeUndefined()
      } finally {
        sources.mockRestore()
        derivations.mockRestore()
        await fixture.host.close()
      }
    },
  )

  it('RVM115U4 P1: an ordinary request cannot mark truncated rule bytes as fully delivered', async () => {
    const files = new Map([['/workspace/AGENTS.md', 'root rule']])
    for (const directory of ['a', 'a/b', 'a/b/c', 'a/b/c/d', 'a/b/c/d/e']) {
      files.set(
        `/workspace/${directory}/AGENTS.md`,
        directory.repeat(Math.floor(RULES_FILE_MAX_BYTES / directory.length)),
      )
    }
    const io = memoryToolIo({ 'a/b/c/d/e/read.txt': 'readable' }, '/workspace')
    const fixture = await modelBackend({ io, contextIo: memoryContextIo(files) })
    fixture.api.script(
      { calls: [readCall('a/b/c/d/e/read.txt')] },
      { text: 'ordinary' },
      { text: 'fire' },
    )
    const ordinary = fixture.turnDone()
    await fixture.session.sendTurn([{ type: 'text', text: 'Ordinary' }])
    await ordinary
    expect(fixture.api.responseBodies()).toHaveLength(2)
    const { run } = fixture.run(undefined, { io })
    await completeModelPrompt(fixture, run, 'Fire')
    expect(fixture.api.responseBodies()).toHaveLength(2)
    expect(run.refusedActions).toContainEqual(expect.objectContaining({ tool: 'cached-context' }))
    await fixture.host.close()
  })

  it('RVM115U4 P1: a reviewer request cannot mark its omitted skill catalogue as delivered', async () => {
    const files = new Map([
      [
        '/workspace/.muse/private.md',
        '---\nname: private\ndescription: hidden catalogue marker\n---\nprivate body',
      ],
      ['/workspace/personal/private/SKILL.md', 'alias'],
    ])
    const fixture = await modelBackend({
      contextIo: memoryContextIo(files, {
        '/workspace/personal/private/SKILL.md': '/workspace/.muse/private.md',
      }),
      personalSkillsRoot: '/workspace/personal',
    })
    fixture.api.script({ text: 'reviewed' }, { text: 'fire' })
    const reviewed = fixture.turnDone()
    await fixture.session.review([{ type: 'text', text: 'Review' }], 'Review')
    await reviewed
    expect(JSON.stringify(fixture.api.responseBodies()[0]?.['instructions'])).not.toContain(
      'hidden catalogue marker',
    )
    const { run } = fixture.run()
    await completeModelPrompt(fixture, run, 'Fire')
    expect(fixture.api.responseBodies()).toHaveLength(1)
    expect(run.refusedActions).toContainEqual(expect.objectContaining({ tool: 'cached-context' }))
    await fixture.host.close()
  })

  it('RVM115U4 P1: a repo map whose symbol source is absent from its read inventory refuses', async () => {
    const marker = 'UncapturedRepoMapMarker'
    const io = memoryToolIo(
      { 'src/one.ts': `${marker}()`, 'src/two.ts': `${marker}()` },
      '/workspace',
    )
    const codeIntel = fakeLanguageService({
      files: io.files,
      workspace: (query) =>
        Promise.resolve(
          query === marker ? [sym(marker, KIND.function, '/workspace/src/unread.ts', 0, 0)] : [],
        ),
    })
    const entered = Promise.withResolvers<undefined>()
    const held = Promise.withResolvers<undefined>()
    const fixture = await modelBackend({
      io,
      codeIntel,
      isRepoMapInPrompt: () => true,
      now: () => 0,
      beforeTurnRuns: vi
        .fn()
        .mockResolvedValue(undefined)
        .mockImplementationOnce(async () => {
          entered.resolve(undefined)
          await held.promise
        }),
    })
    await cancelBeforeDispatch(fixture, entered.promise, held)
    const { run } = fixture.run(undefined, { io })
    await completeModelPrompt(fixture, run, 'Fire')
    expect(fixture.api.responseBodies()).toHaveLength(0)
    expect(run.refusedActions).toContainEqual(expect.objectContaining({ tool: 'replay' }))
    await fixture.host.close()
  })

  it('RVM115U4 P2-5: a fire can use cached skill metadata and body through an aliased workspace root', async () => {
    const io = memoryToolIo(
      {
        'personal/safe/SKILL.md':
          '---\nname: safe\ndescription: safe catalogue\n---\nsafe cached body',
      },
      '/real/workspace',
    )
    const contextIo = memoryContextIo(io.files, { '/workspace': '/real/workspace' })
    io.realPath = contextIo.realPath
    const fixture = await modelBackend({ io, contextIo, personalSkillsRoot: '/workspace/personal' })
    fixture.api.script(
      { calls: [{ name: MODEL_API_TOOLS.readSkill, arguments: '{"id":"safe"}' }] },
      { text: 'done' },
    )
    const { run } = fixture.run(undefined, { io })
    await completeModelPrompt(fixture, run, 'Use safe skill')
    expect(fixture.api.responseBodies()).toHaveLength(2)
    expect(JSON.stringify(fixture.api.responseBodies()[0]?.['instructions'])).toContain(
      'safe catalogue',
    )
    expect(JSON.stringify(fixture.api.responseBodies()[1]?.['input'])).toContain('safe cached body')
    expect(run.refusedActions).toEqual([])
    await fixture.host.close()
  })

  it('RVM115U4 P2-4: later steer validation failure releases its claim before checkpoint finalization', async () => {
    const finalizing = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<undefined>()
    const io = memoryToolIo({}, '/workspace')
    let isRetargeted = false
    io.realPath = (path) =>
      Promise.resolve(
        isRetargeted && path.endsWith('/src/steer.txt') ? '/outside/private.txt' : path,
      )
    const fixture = await modelBackend({
      io,
      afterTurnRuns: async () => {
        finalizing.resolve(undefined)
        await finish.promise
      },
    })
    const held = heldReply()
    fixture.api.script(held.reply)
    const done = fixture.turnDone()
    const ordinary = await fixture.session.sendTurn([{ type: 'text', text: 'Ordinary' }])
    await held.entered.promise
    const { run } = fixture.run(undefined, { io })
    await fixture.session.steerScheduledTurn(
      ordinary.turnId,
      [
        {
          type: 'textFile',
          name: 'src/steer.txt',
          text: 'accepted bytes',
          mediaType: 'text/plain',
          sizeBytes: 14,
        },
      ],
      run,
    )
    isRetargeted = true
    held.held.resolve(undefined)
    try {
      await finalizing.promise
      expect(fixture.session.getScheduledRun()).toBeUndefined()
      expect(fixture.api.responseBodies()).toHaveLength(1)
    } finally {
      finish.resolve(undefined)
      await done
      await fixture.host.close()
    }
  })

  it('RVM115U4 P2-3: an inactive queued fire settles refused and advances the ordinary queue', async () => {
    const fixture = await modelBackend()
    const held = heldReply()
    fixture.api.script(held.reply, { text: 'next ordinary' })
    const ordinaryDone = fixture.turnDone()
    await fixture.session.sendTurn([{ type: 'text', text: 'Ordinary' }])
    await held.entered.promise
    let isActive = true
    const { run } = fixture.run(undefined, { isActive: () => isActive })
    const fire = await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Fire' }], run)
    const next = await fixture.session.sendTurn([{ type: 'text', text: 'Next ordinary' }])
    isActive = false
    held.held.resolve(undefined)
    await ordinaryDone
    await settle()
    expect(fixture.events).toContainEqual(
      expect.objectContaining({
        type: 'turnCompleted',
        turnId: fire.turnId,
        terminal: 'failed',
        reason: run.modelText.approvalRefused,
      }),
    )
    await vi.waitFor(() => {
      expect(fixture.events).toContainEqual(
        expect.objectContaining({
          type: 'turnStarted',
          turnId: next.turnId,
        }),
      )
    })
    expect(run.refusedActions).toContainEqual(expect.objectContaining({ tool: 'admission' }))
    expect(fixture.api.responseBodies()).toHaveLength(2)
    await fixture.host.close()
  })

  it.each(['media refused', 'withdrawn', 'stopped'] as const)(
    'RVM115U4 P2-4: a %s steer releases its unadopted fire claim',
    async (scenario) => {
      const fixture = await modelBackend()
      const held = heldReply()
      fixture.api.script(held.reply, { text: 'next' })
      const ordinaryDone = fixture.turnDone()
      const ordinary = await fixture.session.sendTurn([{ type: 'text', text: 'Ordinary' }])
      await held.entered.promise
      const { run } = fixture.run()
      if (scenario === 'media refused') {
        const bytes = pdfFixture(1)
        const parts = Array.from({ length: 51 }, (_, index) => ({
          type: 'file' as const,
          name: `docs/file-${String(index)}.pdf`,
          mediaType: 'application/pdf',
          base64Data: Buffer.from(bytes).toString('base64'),
          sizeBytes: bytes.length,
          pageCount: 1,
        }))
        await expect(
          fixture.session.steerScheduledTurn(ordinary.turnId, parts, run),
        ).rejects.toThrow()
      } else {
        const steer = await fixture.session.steerScheduledTurn(
          ordinary.turnId,
          [{ type: 'text', text: 'Fire' }],
          run,
        )
        expect(fixture.session.getScheduledRun()).toBe(run)
        if (scenario === 'withdrawn') {
          expect(
            await fixture.session.withdrawQueued({ ...steer, userMessageId: steer.userMessageId }),
          ).toMatchObject({ status: 'withdrawn' })
        } else {
          const cancelled = fixture.session.cancel()
          expect(fixture.session.getScheduledRun()).toBeUndefined()
          await cancelled
        }
      }
      expect(fixture.session.getScheduledRun()).toBeUndefined()
      held.held.resolve(undefined)
      await ordinaryDone
      await settle()
      expect(fixture.session.getScheduledRun()).toBeUndefined()
      const done = fixture.turnDone()
      await fixture.session.sendTurn([{ type: 'text', text: 'Next' }])
      await done
      expect(fixture.events.at(-2)).toMatchObject({ type: 'turnCompleted', terminal: 'completed' })
      await fixture.host.close()
    },
  )

  it('REDM115U: a scheduled steer before the ordinary first dispatch refuses before acceptance and queues honestly', async () => {
    const fixture = await modelBackend()
    const entered = Promise.withResolvers<undefined>()
    const held = Promise.withResolvers<undefined>()
    const original = ModelApiClient.prototype.streamResponse
    const stream = vi.spyOn(ModelApiClient.prototype, 'streamResponse')
    stream.mockImplementationOnce(async function* (
      this: ModelApiClient,
      ...args: Parameters<typeof original>
    ) {
      entered.resolve(undefined)
      await held.promise
      yield* original.call(this, ...args)
    })
    fixture.api.script({ text: 'ordinary' }, { text: 'fire' })
    const ordinary = await fixture.session.sendTurn([{ type: 'text', text: 'Ordinary' }])
    await entered.promise
    const { run } = fixture.run()
    try {
      await expect(
        fixture.session.steerScheduledTurn(ordinary.turnId, [{ type: 'text', text: 'Fire' }], run),
      ).rejects.toThrow()
      expect(fixture.session.getScheduledRun()).toBeUndefined()
      const queued = await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Fire' }], run)
      expect(queued.disposition).toBe('queued')
      held.resolve(undefined)
      await expectSettledModel(fixture)
      expect(fixture.api.responseBodies()).toHaveLength(2)
      expect(JSON.stringify(fixture.api.responseBodies()[1]?.['input'])).toContain('Fire')
    } finally {
      held.resolve(undefined)
      stream.mockRestore()
      await fixture.host.close()
    }
  })

  it.each(['HTTP', 'stream'] as const)(
    'REDM115U: a generation-invalidated ordinary %s retry hands an accepted steer to its fire',
    async (kind) => {
      const entered = Promise.withResolvers<undefined>()
      const held = Promise.withResolvers<undefined>()
      const fixture = await modelBackend(
        {},
        {
          sleep: async () => {
            entered.resolve(undefined)
            await held.promise
          },
        },
      )
      fixture.api.script(
        kind === 'HTTP'
          ? { httpError: { status: 503 } }
          : { text: 'partial', streamError: { code: 'server_shutting_down', message: 'draining' } },
        { text: 'fire' },
      )
      const done = fixture.turnDone()
      const ordinary = await fixture.session.sendTurn([{ type: 'text', text: 'Ordinary' }])
      await entered.promise
      const { run } = fixture.run()
      try {
        const steer = await fixture.session.steerScheduledTurn(
          ordinary.turnId,
          [{ type: 'text', text: 'Fire' }],
          run,
        )
        expect(steer.disposition).toBe('steered')
        held.resolve(undefined)
        await done
        expectCompletedFire(fixture, run)
        expect(JSON.stringify(fixture.api.responseBodies()[1]?.['input'])).toContain('Fire')
        expect(fixture.session.getScheduledRun()).toBeUndefined()
      } finally {
        held.resolve(undefined)
        await fixture.host.close()
      }
    },
  )

  it('REDM115U: a known-source tool receipt names the exact fire decision id', async () => {
    const fixture = await modelBackend()
    const { run } = fixture.run()
    const decisions = vi.spyOn(run, 'decide')
    const proofs = vi.spyOn(ProvenanceLedger.prototype, 'decided')
    fixture.api.script({ calls: [readCall('src/read.txt')] }, { text: 'done' })
    await completeModelPrompt(fixture, run, 'Read')
    const decision = decisions.mock.calls.find(
      ([action]) => action.tool === MODEL_API_TOOLS.readFile && action.paths[0] === 'src/read.txt',
    )
    const proof = proofs.mock.calls.find(
      ([bytes, source]) =>
        source.kind === 'tool' &&
        typeof bytes === 'string' &&
        bytes.includes('"type":"function_call_output"'),
    )
    expect(decision).toBeDefined()
    expect(proof?.[2]).toBe(decision?.[0].id)
    proofs.mockRestore()
    await fixture.host.close()
  })

  it.each(['user alias swap', 'vendored path mismatch'])(
    'RVM115U3 P1-3/4: %s authorizes the cached source, never a current alias or invented path',
    async (variant) => {
      const marker = `protected cached ${variant}`
      const vendor = '/workspace/vendor/package'
      const skillPath =
        variant === 'user alias swap'
          ? '/workspace/personal/private/SKILL.md'
          : `${vendor}/skills/private/SKILL.md`
      const protectedPath =
        variant === 'user alias swap'
          ? '/workspace/.muse/private.txt'
          : `${vendor}/.muse/private.txt`
      const files = new Map([
        [protectedPath, `---\nname: private\ndescription: cached description\n---\n${marker}`],
        ['/workspace/src/benign.txt', 'benign bytes'],
        [skillPath, 'alias listing entry'],
      ])
      const links: Record<string, string> = { [skillPath]: protectedPath }
      const fixture = await modelBackend({
        contextIo: memoryContextIo(files, links),
        ...(variant === 'user alias swap'
          ? { personalSkillsRoot: '/workspace/personal' }
          : {
              bundledSkills: {
                packageRoot: vendor,
                firstPartyRoot: '/workspace/first-party',
                isEnabled: () => true,
              },
            }),
      })
      fixture.api.script({ text: 'ordinary' })
      const ordinary = fixture.turnDone()
      await fixture.session.sendTurn([{ type: 'text', text: 'Describe skills' }])
      await ordinary
      expect(JSON.stringify(fixture.api.responseBodies())).not.toContain(marker)
      if (variant === 'user alias swap') links[skillPath] = '/workspace/src/benign.txt'
      const { run } = fixture.run()
      const cached = vi.spyOn(run, 'decideSource')
      fixture.api.script(
        { calls: [{ name: MODEL_API_TOOLS.readSkill, arguments: '{"id":"private"}' }] },
        { text: 'done' },
      )
      const done = fixture.turnDone()
      await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Load private' }], run)
      await done
      expect(fixture.api.responseBodies()).toHaveLength(3)
      expect(JSON.stringify(fixture.api.responseBodies())).not.toContain(marker)
      expect(run.refusedActions.length).toBeGreaterThan(0)
      expect(
        cached.mock.calls.some(
          ([source]) => source.kind === 'skill' && source.file.path === protectedPath,
        ),
      ).toBe(true)
      expect(
        cached.mock.calls.some(
          ([source]) => source.kind === 'skill' && source.file.path === '/workspace/src/benign.txt',
        ),
      ).toBe(false)
      await fixture.host.close()
    },
  )

  it.each([false, true])(
    'RVM115U3 P1-2: opaque diagnostics require a fire tool decision (grant=%s)',
    async (hasGrant) => {
      const marker = 'opaque protected diagnostic marker'
      const tool = diagnosticsTool({
        workspaceRoot: '/workspace',
        platform: 'linux',
        relativeInRoot: () => undefined,
        getDiagnostics: () => [
          {
            path: '.muse/private.ts',
            severity: 'error',
            line: 1,
            column: 1,
            message: marker,
            source: undefined,
          },
        ],
      })
      const call = vi.spyOn(tool, 'call')
      const fixture = await modelBackend({ ideTools: [tool] })
      const context = fakeRunContext()
      if (hasGrant)
        context.grant.rules = [
          { id: 'diagnostics', kind: 'tool', name: 'mcp__ide__getDiagnostics' },
        ]
      const { run, audit } = fixture.run(context)
      fixture.api.script(
        { calls: [{ name: 'mcp__ide__getDiagnostics', arguments: '{}' }] },
        { text: 'done' },
      )
      const done = fixture.turnDone()
      await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Check' }], run)
      await done
      expect(fixture.api.responseBodies()).toHaveLength(2)
      expect(call).toHaveBeenCalledTimes(hasGrant ? 1 : 0)
      expect(JSON.stringify(fixture.api.responseBodies()).includes(marker)).toBe(hasGrant)
      expect(audit).toHaveBeenCalledTimes(hasGrant ? 1 : 0)
      if (!hasGrant) expect(run.refusedActions.length).toBeGreaterThan(0)
      await fixture.host.close()
    },
  )

  it('RVM115U5 P1-3: a fire returns explicit verification refusal before reading opaque dependencies', async () => {
    const diagnostics = vi.fn().mockResolvedValue([])
    const fixture = await modelBackend({
      verify: diagnosticsOnly(diagnostics),
    })
    const { run } = fixture.run({ ...fakeRunContext(), mode: 'acceptEdits' })
    fixture.api.script(
      {
        calls: [writeCall('src/new.txt', 'change')],
      },
      { text: 'done' },
    )
    await sendScheduledEdit(fixture, run)
    expect(diagnostics).not.toHaveBeenCalled()
    expectCompletedFire(fixture, run)
    await fixture.host.close()
  })

  it('RVM115U3 P2-7: fitted PDF replay bytes retain the fire proof across object replacement', async () => {
    const fixture = await modelBackend()
    const bytes = pdfFixture(50)
    const parts = ['docs/older.pdf', 'docs/newer.pdf'].map(
      (name) =>
        ({
          type: 'file',
          name,
          mediaType: 'application/pdf',
          base64Data: Buffer.from(bytes).toString('base64'),
          sizeBytes: bytes.length,
          pageCount: 50,
        }) as const,
    )
    const { run } = fixture.run()
    fixture.api.script({ calls: [readCall('src/read.txt')] }, { text: 'done' })
    const done = fixture.turnDone()
    await fixture.session.sendScheduledTurn(parts, run)
    await done
    expect(fixture.api.responseBodies()).toHaveLength(2)
    const fitted = JSON.stringify(fixture.api.responseBodies()[0]?.['input'])
    expect(fitted).toContain('older.pdf')
    expect(fitted).not.toContain('"filename":"docs/older.pdf"')
    expect(fitted).toContain('"filename":"docs/newer.pdf"')
    expectCompletedFire(fixture, run)
    await fixture.host.close()
  })

  it('REDM115U: a cached compaction summary derives from the exact delivered input bytes', async () => {
    const recipes = vi.spyOn(ProvenanceLedger.prototype, 'derive')
    const fixture = await modelBackend()
    fixture.api.script({ text: 'ordinary' }, { text: 'trusted summary' }, { text: 'fire' })
    const ordinary = fixture.turnDone()
    await fixture.session.sendTurn([{ type: 'text', text: 'Ordinary' }])
    await ordinary
    await expect(fixture.session.compact()).resolves.toMatchObject({ status: 'accepted' })
    const { run } = fixture.run()
    const done = fixture.turnDone()
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Fire' }], run)
    await done
    expect(fixture.api.responseBodies()).toHaveLength(3)
    expect(JSON.stringify(fixture.api.responseBodies()[2]?.['input'])).toContain('trusted summary')
    const recipe = recipes.mock.calls.find((recipe) => recipe[2] === 'cached-compaction')
    expect(recipe?.[1]?.hashes()).toContain(
      contentHash(String(fixture.api.responseBodies()[1]?.['instructions'])),
    )
    recipes.mockRestore()
    expect(run.refusedActions.filter((action) => action.tool === 'replay')).toEqual([])
    await fixture.host.close()
  })

  it('RVM115U3 P2-8: a new date derives instructions from unchanged already-delivered rules', async () => {
    const files = new Map([['/workspace/AGENTS.md', 'unchanged project rules']])
    let now = new Date(2026, 9, 6).getTime()
    const fixture = await modelBackend({ contextIo: memoryContextIo(files), now: () => now })
    fixture.api.script({ text: 'ordinary' }, { text: 'fire' })
    const ordinary = fixture.turnDone()
    await fixture.session.sendTurn([{ type: 'text', text: 'Ordinary' }])
    await ordinary
    now = new Date(2026, 9, 7).getTime()
    const { run } = fixture.run()
    const source = vi.spyOn(run, 'decideSource')
    const done = fixture.turnDone()
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Fire' }], run)
    await done
    expect(fixture.api.responseBodies()).toHaveLength(2)
    expect(fixture.api.responseBodies()[1]?.['instructions']).toContain('2026-10-07')
    expect(fixture.api.responseBodies()[1]?.['instructions']).toContain('unchanged project rules')
    expect(source).not.toHaveBeenCalled()
    expect(run.refusedActions).toEqual([])
    await fixture.host.close()
  })
  it('refuses the real shell/edit dispatchers, defers questions and allows a confined read without pending cards or popups', async () => {
    const fixture = await modelBackend()
    const { run, deferQuestions, row } = fixture.run()
    fixture.api.script(
      {
        calls: [
          {
            name: 'bash',
            arguments: JSON.stringify({ command: 'npm test', description: 'check' }),
          },
          {
            name: MODEL_API_TOOLS.writeFile,
            arguments: JSON.stringify({ path: 'src/new.txt', content: 'change' }),
          },
          {
            name: MODEL_API_TOOLS.askUser,
            arguments: JSON.stringify({
              questions: [
                {
                  id: 'colour',
                  header: 'Colour',
                  question: 'Which colour?',
                  selection: { mode: 'single' },
                  options: [{ label: 'Red' }],
                },
              ],
            }),
          },
          { name: MODEL_API_TOOLS.readFile, arguments: JSON.stringify({ path: 'src/read.txt' }) },
        ],
      },
      { text: 'done' },
    )
    const done = fixture.turnDone()
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Check the project' }], run)
    await done
    expect(fixture.io.shellCalls).toHaveLength(0)
    expect(fixture.io.files.has('/workspace/src/new.txt')).toBe(false)
    expect(deferQuestions).toHaveBeenCalledTimes(1)
    expect(
      run.refusedActions.filter(
        (action) => action.actionClass === 'shell' || action.actionClass === 'edit',
      ),
    ).toHaveLength(2)
    expect(row.mock.calls).toHaveLength(run.refusedActions.length)
    expect(
      fixture.events.filter(
        (event) => event.type === 'approvalRequested' || event.type === 'questionRequested',
      ),
    ).toHaveLength(0)
    expect(fixture.popup).not.toHaveBeenCalled()
    expect(fixture.reserve).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(fixture.api.requests)).toContain('inside workspace')
    await fixture.host.close()
  })
  it('checks requester safety even for a mode-permitted read before dispatch', async () => {
    const fixture = await modelBackend()
    const { run, row } = fixture.run(fakeRunContext(), { safety: () => 'Physical refused.' })
    fixture.api.script({ calls: [readCall('src/read.txt')] }, { text: 'done' })
    await completeModelPrompt(fixture, run, 'Read')
    expect(run.refusedActions.some((action) => action.tool === MODEL_API_TOOLS.readFile)).toBe(true)
    expect(row.mock.calls).toHaveLength(run.refusedActions.length)
    expect(JSON.stringify(fixture.api.responseBodies())).not.toContain('inside workspace')
    await fixture.host.close()
  })
  it('declines MCP elicitation immediately and exposes its actual run to the host-owned tool', async () => {
    const outcomes: unknown[] = []
    let observed: UnattendedRun | undefined
    const source = fakeMcpSource([{ server: 'srv', tool: 'ask' }])
    source.call = async (_name, _args, signal, onElicitation) => {
      if (onElicitation === undefined) throw new Error('Missing elicitation port')
      observed = fixture.session.getScheduledRun()
      outcomes.push(
        await onElicitation({
          server: 'srv',
          signal,
          params: {
            message: 'Name?',
            requestedSchema: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name'],
            },
          },
        }),
      )
      return { output: 'done', visibleOutput: 'done' }
    }
    const fixture = await modelBackend({ mcpServers: source })
    const context = fakeRunContext()
    context.grant.rules = [{ id: 'mcp', kind: 'tool', name: 'mcp__srv__ask' }]
    const { run, row } = fixture.run(context)
    fixture.api.script({ calls: [{ name: 'mcp__srv__ask', arguments: '{}' }] }, { text: 'done' })
    const done = fixture.turnDone()
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Ask' }], run)
    await done
    expect(observed).toBe(run)
    expect(outcomes).toEqual([{ action: 'decline' }])
    expect(row).toHaveBeenCalledTimes(1)
    expect(fixture.events.some((event) => event.type === 'elicitationRequested')).toBe(false)
    await fixture.host.close()
  })
  it.each([
    ['src/a.ts', false, false],
    ['src/**', true, false],
    ['src/**', false, true],
  ] as const)(
    'matches the entire native rename plan against the path grant %s (allowed %s, physical %s)',
    async (glob, isAllowed, isPhysical) => {
      const a = '/workspace/src/a.ts'
      const b = '/workspace/src/b.ts'
      const files = new Map([
        [a, 'export function greet() {}\n'],
        [b, 'greet()\n'],
      ])
      const service = fakeLanguageService({
        files,
        rename: () =>
          Promise.resolve({ files: [renamed(a, 0, 16), renamed(b, 0, 0)], fileOperations: 'none' }),
      })
      const fixture = await modelBackend({ codeIntel: service })
      for (const [path, text] of files) fixture.io.files.set(path, text)
      const context = fakeRunContext()
      context.grant.rules = [{ id: 'rename', kind: 'path', glob, access: 'edit' }]
      if (isPhysical) context.mode = 'acceptEdits'
      const { run, row } = fixture.run(context, {
        safety: (action) =>
          isPhysical && action.paths.includes('src/b.ts') ? 'Physical refused.' : undefined,
      })
      fixture.api.script(
        {
          calls: [
            {
              name: 'rename_symbol',
              arguments: '{"path":"src/a.ts","line":1,"column":17,"new_name":"welcome"}',
            },
          ],
        },
        { text: 'done' },
      )
      const done = fixture.turnDone()
      await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Rename' }], run)
      await done
      expect(service.asked.some((call) => call.startsWith('rename'))).toBe(true)
      expect(fixture.io.files.get(a)).toBe(
        isAllowed ? 'export function welcome() {}\n' : files.get(a),
      )
      expect(fixture.io.files.get(b)).toBe(isAllowed ? 'welcome()\n' : files.get(b))
      expect(
        run.refusedActions.filter((action) => action.reason !== run.modelText.protectedRefused),
      ).toHaveLength(isAllowed ? 0 : 1)
      expect(row.mock.calls).toHaveLength(run.refusedActions.length)
      await fixture.host.close()
    },
  )
  it('rechecks revocation at the native shell entry after an adapter await', async () => {
    const fixture = await modelBackend()
    let hasEntered = false
    const held = Promise.withResolvers<undefined>()
    const execute = fixture.io.runShell
    fixture.io.runShell = async (...args) => {
      hasEntered = true
      await held.promise
      return await execute(...args)
    }
    let isActive = true
    const context = commandContext()
    const { run } = fixture.run(context, { isActive: () => isActive })
    scriptShell(fixture.api)
    const done = fixture.turnDone()
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Check' }], run)
    await vi.waitFor(() => {
      expect(hasEntered).toBe(true)
    })
    isActive = false
    held.resolve(undefined)
    await done
    expect(fixture.io.shellCalls).toHaveLength(0)
    await fixture.host.close()
  })
  it('uses the schedule mode/grant rather than the interactive mode or session rules, and restores ordinary turn behavior', async () => {
    const fixture = await modelBackend()
    await fixture.session.setApprovalMode('allowAll')
    const context = commandContext()
    const { run, audit } = fixture.run(context)
    scriptShell(fixture.api)
    const done = fixture.turnDone()
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Check' }], run)
    await done
    expect(fixture.io.shellCalls).toHaveLength(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ actionClass: 'shell', ruleId: 'npm' }),
    )
    expect(fixture.session.approvalMode).toBe('allowAll')
    await fixture.host.close()
  })
  it.each(['queue', 'steer'] as const)(
    'carries the context through %s admission without changing the first ordinary request',
    async (kind) => {
      const fixture = await modelBackend()
      await fixture.session.setApprovalMode('allowAll')
      const { entered, held, reply } = heldReply()
      fixture.api.script(
        {
          ...reply,
          ...(kind === 'steer' ? { calls: [readCall('src/read.txt')] } : { text: 'ordinary done' }),
        },
        { calls: [{ name: 'bash', arguments: '{"command":"npm test"}' }] },
        { text: 'done' },
      )
      const ordinary = await fixture.session.sendTurn([{ type: 'text', text: 'Ordinary' }])
      await entered.promise
      const { run, row } = fixture.run()
      if (kind === 'queue')
        await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Scheduled' }], run)
      else
        await fixture.session.steerScheduledTurn(
          ordinary.turnId,
          [{ type: 'text', text: 'Scheduled' }],
          run,
        )
      expect(fixture.session.getScheduledRun()).toBe(kind === 'steer' ? run : undefined)
      held.resolve(undefined)
      await vi.waitFor(() => {
        expect(fixture.events.filter((event) => event.type === 'turnCompleted')).toHaveLength(
          kind === 'queue' ? 2 : 1,
        )
      })
      expect(fixture.io.shellCalls).toHaveLength(0)
      expect(row).toHaveBeenCalledTimes(kind === 'steer' ? 2 : 1)
      expect(fixture.events.some((event) => event.type === 'approvalRequested')).toBe(false)
      const bodies = fixture.api.responseBodies()
      expect(JSON.stringify(bodies[0]?.['input'])).not.toContain(run.modelText.unattendedNote)
      expect(JSON.stringify(bodies[1]?.['input'])).toContain(run.modelText.unattendedNote)
      expect(fixture.session.getScheduledRun()).toBeUndefined()
      await fixture.host.close()
    },
  )
  it.each(['generate_image', 'edit_image'])(
    'reserves %s only through the fire and refuses an over-cap image before HTTP',
    async (tool) => {
      const interactive = vi.fn().mockRejectedValue(new Error('Interactive ledger reached'))
      const fixture = await modelBackend({}, { reservePaidRequest: interactive })
      fixture.io.binaries.set('/workspace/assets/in.png', Buffer.from(TINY_PNG_BASE64, 'base64'))
      const claim = await fixture.reserve()
      fixture.reserve.mockClear()
      fixture.reserve.mockImplementation((body) =>
        'input' in body ? Promise.resolve(claim) : Promise.reject(new Error('Schedule image cap')),
      )
      const { run } = fixture.run(fakeRunContext(), {
        paid: {
          modelId: 'muse-spark-1.3',
          accountId: FAKE_MODEL_API_ACCOUNT_ID,
          allows: () => true,
          reserve: fixture.reserve,
        },
      })
      scriptImage(fixture.api, tool, ['assets/in.png'])
      const done = fixture.turnDone()
      await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Image' }], run)
      await done
      expect(fixture.reserve.mock.calls.filter(([body]) => !('input' in body))).toHaveLength(1)
      expect(fixture.api.imageBodies()).toHaveLength(0)
      expect(fixture.api.editBodies()).toHaveLength(0)
      expect(interactive).not.toHaveBeenCalled()
      expect(fixture.popup).not.toHaveBeenCalled()
      expect(run.refusedActions.some((action) => action.actionClass === 'paidExtra')).toBe(true)
      await fixture.host.close()
    },
  )
  it.each([false, true])(
    'checks protected or physical image sources before reading or sending them (physical %s)',
    async (isPhysical) => {
      const source = isPhysical ? 'assets/private.png' : '.muse/private.png'
      const fixture = await modelBackend()
      fixture.io.binaries.set(`/workspace/${source}`, Buffer.from(TINY_PNG_BASE64, 'base64'))
      const read = vi.spyOn(fixture.io, 'readBytes')
      const safety = vi
        .fn<ScheduleRunDeps['safety']>()
        .mockImplementation((action) =>
          isPhysical && action.class === 'paidExtra' && action.paths.includes(source)
            ? 'Physical refused.'
            : undefined,
        )
      const { run } = fixture.run(fakeRunContext(), {
        safety,
        paid: {
          modelId: 'muse-spark-1.3',
          accountId: FAKE_MODEL_API_ACCOUNT_ID,
          allows: () => true,
          reserve: fixture.reserve,
        },
      })
      scriptImage(fixture.api, 'edit_image', [source])
      const done = fixture.turnDone()
      await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Image' }], run)
      await done
      expect(read).not.toHaveBeenCalled()
      expect(fixture.api.editBodies()).toHaveLength(0)
      expect(run.refusedActions.length).toBeGreaterThan(0)
      expect(fixture.io.binaries.has('/workspace/assets/out.png')).toBe(false)
      await fixture.host.close()
    },
  )
  it('rechecks the canonical image destination before filling returned bytes', async () => {
    const fixture = await modelBackend()
    const held = Promise.withResolvers<undefined>()
    let hasChanged = false
    const realPath = fixture.io.realPath
    fixture.io.realPath = (path) =>
      hasChanged && path.endsWith('out.png')
        ? Promise.resolve('/workspace/.muse/out.png')
        : realPath(path)
    const { run } = fixture.run(fakeRunContext(), {
      paid: {
        modelId: 'muse-spark-1.3',
        accountId: FAKE_MODEL_API_ACCOUNT_ID,
        allows: () => true,
        reserve: fixture.reserve,
      },
    })
    fixture.api.images.push({ hold: held.promise })
    fixture.api.script(
      {
        calls: [{ name: 'generate_image', arguments: '{"path":"assets/out.png","prompt":"test"}' }],
      },
      { text: 'done' },
    )
    const done = fixture.turnDone()
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Image' }], run)
    await vi.waitFor(() => {
      expect(fixture.api.imageBodies()).toHaveLength(1)
    })
    hasChanged = true
    held.resolve(undefined)
    await done
    expect(fixture.io.binaries.has('/workspace/assets/out.png')).toBe(false)
    expect(fixture.io.binaries.has('/workspace/.muse/out.png')).toBe(false)
    expect(run.refusedActions.length).toBeGreaterThan(0)
    await fixture.host.close()
  })
  it('checks actual read paths again after a canonical alias changes before native I/O', async () => {
    const fixture = await modelBackend()
    fixture.io.files.set('/workspace/.muse/private.txt', 'protected source bytes')
    let hasChanged = false
    const realPath = fixture.io.realPath
    fixture.io.realPath = (path) =>
      hasChanged && path.endsWith('alias.txt')
        ? Promise.resolve('/workspace/.muse/private.txt')
        : realPath(path)
    const { run } = fixture.run()
    const decide = run.decide.bind(run)
    vi.spyOn(run, 'decide').mockImplementation(async (...args) => {
      const outcome = await decide(...args)
      hasChanged = true
      return outcome
    })
    const read = vi.spyOn(fixture.io, 'readFile')
    fixture.api.script({ calls: [readCall('src/alias.txt')] }, { text: 'done' })
    await completeModelPrompt(fixture, run, 'Read')
    expect(read).not.toHaveBeenCalled()
    expect(JSON.stringify(fixture.api.responseBodies())).not.toContain('protected source bytes')
    expect(run.refusedActions.length).toBeGreaterThan(0)
    await fixture.host.close()
  })
  it('refuses an existing completed explorer follow-up inside a fire with zero interactive reservations', async () => {
    const interactive = paidReservation('interactive')
    const fixture = await modelBackend(
      { allowsPaidUse: () => Promise.resolve(true) },
      { reservePaidRequest: interactive },
    )
    fixture.api.script(
      {
        calls: [
          { name: 'subagent_spawn', arguments: '{"role":"explorer","objective":"Map files"}' },
        ],
      },
      { text: 'Explorer done' },
      { text: 'Parent done' },
    )
    await fixture.session.sendTurn([{ type: 'text', text: 'Explore' }])
    await vi.waitFor(() => {
      expect(
        fixture.session.history().items.find((item) => item.kind === 'subagent')?.controlStatus,
      ).toBe('resultReady')
      expect(fixture.session.status).toBe('idle')
    })
    interactive.mockClear()
    const done = fixture.turnDone()
    const { run } = fixture.run(fakeRunContext(), {
      paid: {
        modelId: 'muse-spark-1.3',
        accountId: FAKE_MODEL_API_ACCOUNT_ID,
        allows: () => true,
        reserve: fixture.reserve,
      },
    })
    fixture.api.script(
      {
        calls: [
          {
            name: 'subagent_send_message',
            arguments: '{"subagent_id":"subagent-1","message":"Follow-up task"}',
          },
        ],
      },
      { text: 'Fire done' },
      { text: 'Unexpected child' },
    )
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Scheduled follow-up' }], run)
    await done
    expect(interactive).not.toHaveBeenCalled()
    expect(fixture.reserve).toHaveBeenCalledTimes(2)
    expect(run.refusedActions.some((action) => action.actionClass === 'paidExtra')).toBe(true)
    await fixture.host.close()
  })
  it('refuses a queued child message during a fire before it contaminates a later interactive task', async () => {
    const interactive = paidReservation('interactive')
    const fixture = await modelBackend(
      { allowsPaidUse: () => Promise.resolve(true) },
      { reservePaidRequest: interactive },
    )
    const held = Array.from({ length: SUBAGENT_CAPACITY + 1 }, () =>
      Promise.withResolvers<undefined>(),
    )
    fixture.api.script(
      {
        calls: held.map((_entry, index) => ({
          name: 'subagent_spawn',
          arguments: JSON.stringify({
            role: 'worker',
            objective: `Original task ${String(index + 1)}`,
          }),
        })),
      },
      ...held.map((entry) => ({
        text: 'Original done',
        hold: entry.promise,
        onRequest: () => {
          // Only the parent's continuation can finish; every worker holds its slot.
          if (
            JSON.stringify(fixture.api.responseBodies().at(-1)?.['input']).includes(
              '"name":"subagent_spawn"',
            )
          )
            entry.resolve(undefined)
        },
      })),
    )
    const ordinaryDone = fixture.turnDone()
    await fixture.session.sendTurn([{ type: 'text', text: 'Queue workers' }])
    await ordinaryDone
    const target = `subagent-${String(SUBAGENT_CAPACITY + 1)}`
    expect(
      fixture.session.history().items.find((item) => item.subagentId === target)?.controlStatus,
    ).toBe('queued')
    interactive.mockClear()
    const marker = 'Queued scheduled injection'
    fixture.api.script(
      {
        calls: [
          {
            name: 'subagent_send_message',
            arguments: JSON.stringify({ subagent_id: target, message: marker }),
          },
        ],
      },
      { text: 'Fire done' },
      { text: 'Queued child done' },
    )
    const { run } = fixture.run(fakeRunContext(), {
      paid: {
        modelId: 'muse-spark-1.3',
        accountId: FAKE_MODEL_API_ACCOUNT_ID,
        allows: () => true,
        reserve: fixture.reserve,
      },
    })
    const done = fixture.turnDone()
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Fire' }], run)
    await done
    expect(interactive).not.toHaveBeenCalled()
    const beforeRelease = fixture.api.responseBodies().length
    for (const entry of held) entry.resolve(undefined)
    await vi.waitFor(() => {
      expect(fixture.api.responseBodies()).toHaveLength(beforeRelease + 1)
    })
    expect(JSON.stringify(fixture.api.responseBodies().at(-1)?.['input'])).not.toContain(marker)
    expect(interactive).toHaveBeenCalledTimes(1)
    await fixture.host.close()
  })
  it('refuses an unsent child result retrieved during a fire without workspace provenance', async () => {
    const fixture = await modelBackend(
      { allowsPaidUse: () => Promise.resolve(true) },
      {
        reservePaidRequest: paidReservation('interactive'),
      },
    )
    const child = heldReply()
    const marker = 'unsent child workspace marker'
    fixture.api.script(
      {
        calls: [
          { name: 'subagent_spawn', arguments: '{"role":"explorer","objective":"Map files"}' },
        ],
      },
      { text: 'Parent done' },
      { ...child.reply, text: marker },
    )
    const ordinaryDone = fixture.turnDone()
    await fixture.session.sendTurn([{ type: 'text', text: 'Explore' }])
    await ordinaryDone
    await child.entered.promise
    const previousRequests = fixture.api.responseBodies().length
    const fire = heldReply()
    fixture.api.script(
      {
        ...fire.reply,
        calls: [{ name: 'subagent_read_result', arguments: '{"subagent_id":"subagent-1"}' }],
      },
      { text: 'Fire done' },
    )
    const { run } = fixture.run(fakeRunContext(), {
      paid: {
        modelId: 'muse-spark-1.3',
        accountId: FAKE_MODEL_API_ACCOUNT_ID,
        allows: () => true,
        reserve: fixture.reserve,
      },
    })
    const submission = await fixture.session.sendScheduledTurn(
      [{ type: 'text', text: 'Fire' }],
      run,
    )
    await fire.entered.promise
    child.held.resolve(undefined)
    await vi.waitFor(() => {
      expect(
        fixture.session.history().items.find((item) => item.kind === 'subagent')?.controlStatus,
      ).toBe('resultReady')
    })
    fire.held.resolve(undefined)
    await vi.waitFor(() => {
      expect(
        fixture.events.some(
          (event) => event.type === 'turnCompleted' && event.turnId === submission.turnId,
        ),
      ).toBe(true)
    })
    expect(fixture.api.responseBodies()).toHaveLength(previousRequests + 2)
    expect(fixture.reserve).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(fixture.api.responseBodies().slice(previousRequests))).not.toContain(
      marker,
    )
    expect(
      run.refusedActions.some(
        (action) =>
          action.tool === 'subagent_read_result' &&
          action.reason === run.modelText.requiresAskingRefused,
      ),
    ).toBe(true)
    await fixture.host.close()
  })
  it.each([MODEL_API_TOOLS.readMemory, MODEL_API_TOOLS.addMemory])(
    'refuses actual protected memory paths for %s before reading or writing the note and index',
    async (name) => {
      const marker = 'protected memory marker'
      const files = new Map([['/workspace/.agents/memory/private.md', marker]])
      const read = vi.fn()
      const write = vi.fn()
      const { store } = memoryStoreOver(files, {
        workspaceRoot: '/workspace',
        dataRoot: undefined,
        beforeRead: (path) => {
          read(path)
          return Promise.resolve()
        },
        beforeWrite: (path) => {
          write(path)
          return Promise.resolve()
        },
        afterWrite: (path) => {
          write(path)
          return Promise.resolve()
        },
      })
      const fixture = await modelBackend({ memory: store })
      const done = fixture.turnDone()
      const { run } = fixture.run({ ...fakeRunContext(), mode: 'acceptEdits' })
      fixture.api.script(
        {
          calls: [
            {
              name,
              arguments: JSON.stringify({
                scope: 'project',
                path: 'private.md',
                content: 'new content',
              }),
            },
          ],
        },
        { text: 'done' },
      )
      await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Memory task' }], run)
      await done
      expect(read.mock.calls.flat()).not.toContain('/workspace/.agents/memory/private.md')
      expect(write).not.toHaveBeenCalled()
      expect(files.get('/workspace/.agents/memory/private.md')).toBe(marker)
      expect(files.has('/workspace/.agents/memory/MEMORY.md')).toBe(false)
      expect(JSON.stringify(fixture.api.responseBodies())).not.toContain(marker)
      expect(run.refusedActions.length).toBeGreaterThan(0)
      await fixture.host.close()
    },
  )
  it('refuses a cached project skill body during a fire before it reaches the provider', async () => {
    const marker = 'protected project skill marker'
    const contextIo = memoryContextIo(
      new Map([
        [
          '/workspace/.agents/skills/private/SKILL.md',
          `---\nname: private\ndescription: private skill\n---\n${marker}`,
        ],
      ]),
    )
    const fixture = await modelBackend({ contextIo })
    fixture.api.script({ text: 'ordinary done' })
    const ordinaryDone = fixture.turnDone()
    await fixture.session.sendTurn([{ type: 'text', text: 'Ordinary' }])
    await ordinaryDone
    fixture.api.script(
      { calls: [{ name: MODEL_API_TOOLS.readSkill, arguments: '{"id":"private"}' }] },
      { text: 'done' },
    )
    const done = fixture.turnDone()
    const { run } = fixture.run()
    const decide = vi.spyOn(run, 'decideSource')
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Read skill' }], run)
    await done
    expect(JSON.stringify(fixture.api.responseBodies())).not.toContain(marker)
    expect(run.refusedActions.length).toBeGreaterThan(0)
    expect(
      decide.mock.calls.some(
        ([source]) =>
          source.kind === 'skill' &&
          source.file.path === '/workspace/.agents/skills/private/SKILL.md',
      ),
    ).toBe(true)
    await fixture.host.close()
  })
  it.each(['file tool', 'named attachment'] as const)(
    'replays %s content sent before the fire began under the same conversation',
    async (source) => {
      const marker = 'person authorized pre-fire marker'
      const fixture = await modelBackend()
      fixture.io.files.set('/workspace/.muse/private.txt', marker)
      fixture.api.script(
        ...(source === 'file tool'
          ? [
              {
                calls: [readCall('.muse/private.txt')],
              },
            ]
          : []),
        { text: 'ordinary done' },
        { text: 'fire done' },
      )
      const ordinaryDone = fixture.turnDone()
      await fixture.session.sendTurn([
        source === 'file tool'
          ? { type: 'text', text: 'Read my file' }
          : { ...PROTECTED_ATTACHMENT, text: marker, sizeBytes: marker.length },
      ])
      await ordinaryDone
      const previousRequests = fixture.api.responseBodies().length
      const decided = vi.fn(() => undefined)
      const { run } = fixture.run(fakeRunContext(), { safety: decided })
      const done = fixture.turnDone()
      await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Fire plain text' }], run)
      await done
      expect(fixture.api.responseBodies()).toHaveLength(previousRequests + 1)
      expect(fixture.reserve).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(fixture.api.responseBodies().at(-1))).toContain(marker)
      expect(
        decided.mock.calls
          .flat()
          .some((value) => JSON.stringify(value).includes('.muse/private.txt')),
      ).toBe(false)
      await fixture.host.close()
    },
  )
  it('refuses content arriving during a fire without a path-decision provenance before another request', async () => {
    const fixture = await modelBackend()
    const marker = 'un-decided during-fire marker'
    const shellEntered = Promise.withResolvers<undefined>()
    const shellRelease = Promise.withResolvers<undefined>()
    fixture.io.runShell = async () => {
      shellEntered.resolve(undefined)
      await shellRelease.promise
      return { stdout: marker, stderr: '', exitCode: 0, isTimedOut: false, isCancelled: false }
    }
    const shell = fixture.session.runUserShell('read synthetic protected source')
    await shellEntered.promise
    const { reply, entered, held } = heldReply()
    fixture.api.script(
      {
        ...reply,
        calls: [readCall('src/read.txt')],
      },
      { text: 'done' },
    )
    const { run } = fixture.run()
    const done = fixture.turnDone()
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Fire' }], run)
    await entered.promise
    shellRelease.resolve(undefined)
    await shell
    held.resolve(undefined)
    await done
    expect(fixture.api.responseBodies()).toHaveLength(1)
    expect(JSON.stringify(fixture.api.responseBodies())).not.toContain(marker)
    expect(run.refusedActions.some((action) => action.actionClass === 'requiresAsking')).toBe(true)
    await fixture.host.close()
  })
  it('refuses cached skill metadata never sent before the fire instead of trusting an unsent prefix', async () => {
    const marker = 'unsent protected skill description'
    const files = new Map([
      [
        '/workspace/.agents/skills/private/SKILL.md',
        `---\nname: private\ndescription: ${marker}\n---\nbody`,
      ],
    ])
    const fixture = await modelBackend({ contextIo: memoryContextIo(files) })
    const { run } = fixture.run()
    fixture.api.script({ text: 'unexpected egress' })
    const done = fixture.turnDone()
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Fire' }], run)
    await done
    expect(fixture.api.responseBodies()).toHaveLength(0)
    expect(run.refusedActions.length).toBeGreaterThan(0)
    await fixture.host.close()
  })
  it('guards fresh context memory and skill reads before protected bytes reach instructions', async () => {
    const marker = 'fresh protected context marker'
    const files = new Map([
      ['/workspace/.agents/memory/MEMORY.md', marker],
      [
        '/workspace/.agents/skills/private/SKILL.md',
        `---\nname: private\ndescription: ${marker}\n---\nbody`,
      ],
    ])
    const { store } = memoryStoreOver(files, { workspaceRoot: '/workspace', dataRoot: undefined })
    const contextIo = memoryContextIo(files)
    const read = vi.spyOn(contextIo, 'readFile')
    const fixture = await modelBackend({ memory: store, contextIo }, {}, false)
    const { run } = fixture.run()
    fixture.api.script({ text: 'done' })
    const done = fixture.turnDone()
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Fire' }], run)
    await done
    expect(read).not.toHaveBeenCalled()
    expect(JSON.stringify(fixture.api.responseBodies())).not.toContain(marker)
    expect(run.refusedActions.length).toBeGreaterThan(0)
    await fixture.host.close()
  })
  it('refuses a protected named attachment before backend request admission', async () => {
    const fixture = await modelBackend()
    const { run } = fixture.run()
    await expect(fixture.session.sendScheduledTurn([PROTECTED_ATTACHMENT], run)).rejects.toThrow()
    expect(fixture.api.requests).toHaveLength(0)
    await fixture.host.close()
  })
  it.each(['pending', 'active'])(
    'isolates a second scheduled steer from a %s owner in its own turn, grant and audit',
    async (owner) => {
      const fixture = await modelBackend()
      const { entered, held, reply } = heldReply()
      const activeReply = heldReply()
      fixture.api.script(
        {
          ...reply,
          calls: [readCall('src/read.txt')],
        },
        {
          ...(owner === 'active' && activeReply.reply),
          calls: [{ name: 'bash', arguments: '{"command":"npm test"}' }],
        },
        { text: 'A done' },
        { calls: [{ name: 'bash', arguments: '{"command":"npm test"}' }] },
        { text: 'B done' },
      )
      const ordinary = await fixture.session.sendTurn([{ type: 'text', text: 'Ordinary' }])
      await entered.promise
      const a = fixture.run()
      const context = { ...commandContext(), scheduleId: 'schedule-B', runId: 'run-B' }
      const b = fixture.run(context)
      const first = await fixture.session.steerScheduledTurn(
        ordinary.turnId,
        [{ type: 'text', text: 'Fire A' }],
        a.run,
      )
      if (owner === 'active') {
        held.resolve(undefined)
        await activeReply.entered.promise
      }
      const second = await fixture.session.steerScheduledTurn(
        ordinary.turnId,
        [{ type: 'text', text: 'Fire B' }],
        b.run,
      )
      held.resolve(undefined)
      activeReply.held.resolve(undefined)
      await vi.waitFor(() => {
        expect(fixture.api.responseBodies().length).toBeGreaterThanOrEqual(2)
      })
      const bodies = fixture.api.responseBodies()
      expect(JSON.stringify(bodies[1]?.['input'])).toContain('Fire A')
      expect(JSON.stringify(bodies[1]?.['input'])).not.toContain('Fire B')
      expect(first.disposition).toBe('steered')
      expect(second.disposition).toBe('queued')
      expect(second.turnId).not.toBe(first.turnId)
      await expectSettledModel(fixture)
      expect(fixture.io.shellCalls).toHaveLength(1)
      expect(a.audit).not.toHaveBeenCalled()
      expect(a.run.refusedActions).toHaveLength(2)
      expect(a.run.refusedActions.filter((action) => action.actionClass === 'shell')).toHaveLength(
        1,
      )
      expect(b.audit).toHaveBeenCalledTimes(1)
      await fixture.host.close()
    },
  )
  it('refuses scheduled steering during checkpoint finalization and delivers a retry as its own turn', async () => {
    const finalizing = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const fixture = await modelBackend({
      afterTurnRuns: async () => {
        finalizing.resolve(undefined)
        await release.promise
      },
    })
    fixture.api.script({ text: 'ordinary done' }, { text: 'fire done' })
    const ordinary = await fixture.session.sendTurn([{ type: 'text', text: 'Ordinary' }])
    await finalizing.promise
    const { run } = fixture.run()
    await expect(
      fixture.session.steerScheduledTurn(
        ordinary.turnId,
        [{ type: 'text', text: 'Finalization fire' }],
        run,
      ),
    ).rejects.toThrow()
    const retry = await fixture.session.sendScheduledTurn(
      [{ type: 'text', text: 'Finalization fire' }],
      run,
    )
    expect(retry.disposition).toBe('queued')
    release.resolve(undefined)
    await expectSettledModel(fixture)
    expect(JSON.stringify(fixture.api.responseBodies()[1])).toContain('Finalization fire')
    expect(fixture.reserve).toHaveBeenCalledTimes(1)
    await fixture.host.close()
  })
  it('RVM115U5 lazy admission: an accepted fire is active before immediate Stop', async () => {
    const held = Promise.withResolvers<undefined>()
    const fixture = await modelBackend({
      beforeTurnRuns: async () => {
        await held.promise
        return { kind: 'off' }
      },
    })
    const { run } = fixture.run()
    const done = fixture.turnDone()
    const submission = await fixture.session.sendScheduledTurn(
      [{ type: 'text', text: 'Fire' }],
      run,
    )
    expect(fixture.events).toContainEqual({ type: 'turnStarted', turnId: submission.turnId })
    await fixture.session.cancel()
    held.resolve(undefined)
    await done
    expect(fixture.api.responseBodies()).toHaveLength(0)
    expect(fixture.session.getScheduledRun()).toBeUndefined()
    await fixture.host.close()
  })

  it('Stop settles a scheduled turn while deferred-question persistence remains pending', async () => {
    const fixture = await modelBackend()
    const held = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    const deferQuestions = vi.fn(() => {
      entered.resolve(undefined)
      return held.promise
    })
    const { run } = fixture.run(fakeRunContext(), { deferQuestions })
    fixture.api.script(
      {
        calls: [
          {
            name: MODEL_API_TOOLS.askUser,
            arguments:
              '{"questions":[{"id":"colour","header":"Colour","question":"Which colour?","selection":{"mode":"single"},"options":[{"label":"Red"}]}]}',
          },
        ],
      },
      { text: 'next turn' },
    )
    const done = fixture.turnDone()
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Ask' }], run)
    await entered.promise
    await fixture.session.cancel()
    try {
      await vi.waitFor(() => {
        expect(fixture.events.some((event) => event.type === 'turnCompleted')).toBe(true)
      })
      await done
      const next = fixture.turnDone()
      await fixture.session.sendTurn([{ type: 'text', text: 'Next' }])
      await next
      expect(deferQuestions).toHaveBeenCalledTimes(1)
    } finally {
      held.resolve(undefined)
      await fixture.host.close()
    }
  })
  it('Accept edits schedules write unprotected files with an empty grant and still refuse protected edits', async () => {
    const fixture = await modelBackend()
    const context = { ...fakeRunContext(), mode: 'acceptEdits' as const }
    const { run } = fixture.run(context)
    fixture.api.script(
      {
        calls: [writeCall('src/new.txt', 'change'), writeCall('.muse/private.txt', 'protected')],
      },
      { text: 'done' },
    )
    await sendScheduledEdit(fixture, run)
    expect(fixture.io.files.has('/workspace/.muse/private.txt')).toBe(false)
    expect(
      run.refusedActions.filter((action) => action.tool === MODEL_API_TOOLS.writeFile),
    ).toHaveLength(1)
    await fixture.host.close()
  })
  it('keeps the ordinary instructions/tools byte-identical and puts the fixed note only in user input', async () => {
    const ordinary = await modelBackend()
    const scheduled = await modelBackend()
    ordinary.api.script({ text: 'done' })
    scheduled.api.script({ text: 'done' })
    const ordinaryDone = ordinary.turnDone()
    await ordinary.session.sendTurn([{ type: 'text', text: 'Check' }])
    await ordinaryDone
    const scheduledDone = scheduled.turnDone()
    const { run } = scheduled.run()
    await scheduled.session.sendScheduledTurn([{ type: 'text', text: 'Check' }], run)
    await scheduledDone
    const normal = ordinary.api.requests.find((request) => request.path === '/responses')?.body
    const unattended = scheduled.api.requests.find((request) => request.path === '/responses')?.body
    if (
      typeof normal !== 'object' ||
      normal === null ||
      typeof unattended !== 'object' ||
      unattended === null ||
      !('instructions' in normal) ||
      !('tools' in normal) ||
      !('instructions' in unattended) ||
      !('tools' in unattended) ||
      !('input' in unattended)
    )
      throw new Error('Expected recorded request bodies')
    expect(unattended.instructions).toEqual(normal.instructions)
    expect(unattended.tools).toEqual(normal.tools)
    expect(JSON.stringify(unattended.input)).toContain(run.modelText.unattendedNote)
    expect(JSON.stringify(unattended.instructions)).not.toContain(run.modelText.unattendedNote)
    await ordinary.host.close()
    await scheduled.host.close()
  })
})

describe('scheduled Muse Code dispatch over captured MSP frames', () => {
  it.each([
    {
      name: 'RVM115U6 P2-2: observed start and idle before acknowledgement allow the next fire',
      hasObservedStart: true,
    },
    {
      name: 'RVM115U5 P1-1: idle before an ordinary ack cannot admit a fire or change mode',
      hasObservedStart: false,
    },
  ])('$name', async ({ hasObservedStart }) => {
    const fixture = await museBackend('denyUnmatched')
    const { ordinary } = await heldOrdinaryStart(fixture)
    if (hasObservedStart)
      fixture.server.notify('turn/started', {
        sessionId: fixture.session.sessionId,
        turnId: 'ordinary',
        viewCursor: '',
      })
    fixture.server.notify('session/statusChanged', {
      sessionId: fixture.session.sessionId,
      status: 'idle',
    })
    await settle()
    answerNative(fixture, 'turn/start', 0, () => ({
      turnId: 'ordinary',
      disposition: 'started',
      startedNewTurn: true,
    }))
    await ordinary
    fixture.server.unsilence('turn/start')
    const { run } = unattendedRun()
    const fire = fixture.session.sendScheduledTurn([{ type: 'text', text: 'Fire' }], run)
    if (hasObservedStart) await expect(fire).resolves.toMatchObject({ disposition: 'started' })
    else {
      await expect(fire).rejects.toThrow()
      expect(fixture.server.requestsFor('turn/start')).toHaveLength(1)
      expect(fixture.server.requestsFor('session/setApprovalMode')).toHaveLength(0)
    }
    await fixture.host.close()
  })

  it('RVM115U4 P2-1: a stale native mode acknowledgement clears only its pending effect', async () => {
    const fixture = await museBackend()
    await fixture.session.sendTurn([{ type: 'text', text: 'Ordinary' }])
    fixture.server.silence('session/setApprovalMode')
    const mode = fixture.session.setApprovalMode('allowAll')
    const refused = expect(mode).rejects.toThrow()
    await vi.waitFor(() => {
      expect(fixture.server.requestsFor('session/setApprovalMode')).toHaveLength(1)
    })
    await completeMuseTurn(fixture)
    answerNative(fixture, 'session/setApprovalMode', 0, modeResult)
    await refused
    await expect(fixture.session.sendTurn([{ type: 'text', text: 'Next' }])).resolves.toMatchObject(
      { disposition: 'started' },
    )
    await fixture.host.close()
  })

  it('RVM115U4 P2-2: native idle evidence releases a failed admission with an unknown dispatched turn', async () => {
    const fixture = await museBackend('denyUnmatched')
    fixture.server.handle('turn/start', () => {
      throw new Error('start refused')
    })
    const { run } = unattendedRun()
    await expect(
      fixture.session.sendScheduledTurn([{ type: 'text', text: 'Fire' }], run),
    ).rejects.toThrow()
    expect(fixture.session.getScheduledRun()).toBe(run)
    fixture.server.notify('session/statusChanged', {
      sessionId: fixture.session.sessionId,
      status: 'idle',
    })
    await settle()
    expect(fixture.session.getScheduledRun()).toBeUndefined()
    expect(fixture.server.requestsFor('session/setApprovalMode').at(-1)?.params?.['mode']).toBe(
      'denyUnmatched',
    )
    await fixture.host.close()
  })

  it('RVM115U4 P2-2: a revoked native fire before dispatch releases and restores its mode', async () => {
    const fixture = await museBackend('denyUnmatched')
    fixture.server.silence('session/setApprovalMode')
    let isActive = true
    const { run } = unattendedRun({ isActive: () => isActive })
    const fire = fixture.session.sendScheduledTurn([{ type: 'text', text: 'Fire' }], run)
    const refused = expect(fire).rejects.toThrow()
    await vi.waitFor(() => {
      expect(fixture.server.requestsFor('session/setApprovalMode')).toHaveLength(1)
    })
    isActive = false
    fixture.server.handle('session/setApprovalMode', modeResult)
    answerNative(fixture, 'session/setApprovalMode', 0, modeResult)
    await refused
    await vi.waitFor(() => {
      expect(fixture.server.requestsFor('session/setApprovalMode')).toHaveLength(2)
    })
    answerNative(fixture, 'session/setApprovalMode', 1, modeResult)
    await settle()
    expect(fixture.session.getScheduledRun()).toBeUndefined()
    expect(fixture.server.requestsFor('turn/start')).toHaveLength(0)
    expect(fixture.server.requestsFor('turn/cancel')).toHaveLength(0)
    expect(fixture.server.requestsFor('session/setApprovalMode').at(-1)?.params?.['mode']).toBe(
      'denyUnmatched',
    )
    await expect(fixture.session.sendTurn([{ type: 'text', text: 'Next' }])).resolves.toMatchObject(
      { disposition: 'started' },
    )
    await fixture.host.close()
  })

  it('RVM115U3 P1-1: a public Bypass waiter cannot mutate the next fire after a held restoration', async () => {
    const fixture = await museBackend()
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'A' }], unattendedRun().run)
    fixture.server.silence('session/setApprovalMode')
    await completeMuseTurn(fixture)
    const { run } = unattendedRun()
    fixture.server.handle('turn/start', (params) => ({
      ...ack(params),
      turnId: 'fire-b',
      disposition: 'started',
    }))
    const fireB = fixture.session.sendScheduledTurn([{ type: 'text', text: 'B' }], run)
    await settle()
    const mode = expect(fixture.session.setApprovalMode('allowAll')).rejects.toThrow()
    fixture.server.handle('session/setApprovalMode', modeResult)
    answerNative(fixture, 'session/setApprovalMode', 1, modeResult)
    await vi.waitFor(() => {
      expect(fixture.server.requestsFor('session/setApprovalMode')).toHaveLength(3)
    })
    answerNative(fixture, 'session/setApprovalMode', 2, modeResult)
    await fireB
    await mode
    expect(fixture.session.getScheduledRun()).toBe(run)
    expect(
      fixture.server.requestsFor('session/setApprovalMode').map((item) => item.params?.['mode']),
    ).toEqual(['promptUnmatched', 'promptUnmatched', 'promptUnmatched'])
    await fixture.host.close()
  })

  it('RVM115U3 P2-5: an unrelated queued withdrawal cannot erase a live ordinary start ack', async () => {
    const fixture = await museBackend('denyUnmatched')
    const { ordinary } = await heldOrdinaryStart(fixture)
    fixture.server.notify('turn/unqueued', {
      sessionId: fixture.session.sessionId,
      turnId: 'unrelated',
      commandId: 'queued-command',
    })
    await settle()
    answerNative(fixture, 'turn/start', 0, () => ({
      turnId: 'ordinary-live',
      disposition: 'started',
      startedNewTurn: true,
    }))
    await ordinary
    await expect(
      fixture.session.sendScheduledTurn(
        [{ type: 'text', text: 'Fire' }],
        unattendedRun({ context: { ...fakeRunContext(), mode: 'acceptEdits' } }).run,
      ),
    ).rejects.toThrow()
    expect(fixture.server.requestsFor('session/setApprovalMode')).toHaveLength(0)
    expect(fixture.server.requestsFor('turn/start')).toHaveLength(1)
    await fixture.host.close()
  })
  it('answers approvals through approval/decide without showing a pending card, and does not use a paid gate', async () => {
    const fixture = await museBackend()
    const { run, row } = unattendedRun()
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Check' }], run)
    expect(fixture.session.getScheduledRun('schedule-turn')).toBe(run)
    fixture.notifyApproval()
    await museDecided(fixture)
    expect(fixture.server.requestsFor('approval/decide')[0]?.params).toMatchObject({
      choiceId: 'abort',
      feedback: run.modelText.approvalRefused,
    })
    expect(fixture.events.some((event) => event.type === 'approvalRequested')).toBe(false)
    expect(row).toHaveBeenCalledTimes(1)
    expect(fixture.server.requestsFor('turn/start')[0]?.params).toMatchObject({
      input: [
        { type: 'text', text: 'Check' },
        { type: 'text', text: run.modelText.unattendedNote },
      ],
    })
    await fixture.host.close()
  })
  it('Accept edits answers only plain unprotected writes with no path grant', async () => {
    const fixture = await museBackend()
    const { run } = unattendedRun({ context: { ...fakeRunContext(), mode: 'acceptEdits' } })
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Edit' }], run)
    for (const [index, path] of ['src/new.txt', '.muse/private.txt'].entries()) {
      const id = `edit-${String(index)}`
      fixture.server.notify('approval/requested', {
        ...raceRequested(fixture.session.sessionId),
        approvalId: id,
        currentRequirementId: { approvalId: id, sourceIndex: 0 },
        toolName: 'write_file',
        turnId: 'schedule-turn',
        subject: { kind: 'fileAccess', access: 'write', path },
      })
    }
    await museDecided(fixture, 2)
    expect(
      fixture.server
        .requestsFor('approval/decide')
        .map((request) => ({
          id: request.params?.['approvalId'],
          choice: request.params?.['choiceId'],
        }))
        .toSorted((a, b) => String(a.id).localeCompare(String(b.id))),
    ).toEqual([
      { id: 'edit-0', choice: 'allow_once' },
      { id: 'edit-1', choice: 'abort' },
    ])
    await fixture.host.close()
  })
  it('refuses a protected named attachment before native turn admission', async () => {
    const fixture = await museBackend()
    const { run } = unattendedRun()
    await expect(fixture.session.sendScheduledTurn([PROTECTED_ATTACHMENT], run)).rejects.toThrow()
    expect(fixture.server.requestsFor('session/setApprovalMode')).toHaveLength(0)
    expect(fixture.server.requestsFor('turn/start')).toHaveLength(0)
    await fixture.host.close()
  })
  it('rechecks native attachment paths after approval-mode admission before sending bytes', async () => {
    const fixture = await museBackend()
    let hasChanged = false
    fixture.server.handle('session/setApprovalMode', (params) => {
      hasChanged = true
      return {
        ...ack(params),
        applyOutcome: 'completed',
        effectiveMode: { mode: params['mode'], source: 'approvalReconfigure' },
      }
    })
    const { run } = unattendedRun({
      io: {
        realPath: (path) => Promise.resolve(hasChanged ? '/workspace/.muse/private.txt' : path),
      },
    })
    await expect(
      fixture.session.sendScheduledTurn([{ ...PROTECTED_ATTACHMENT, name: 'src/alias.txt' }], run),
    ).rejects.toThrow()
    expect(hasChanged).toBe(true)
    expect(fixture.server.requestsFor('turn/start')).toHaveLength(0)
    await fixture.host.close()
  })
  it('claims native ownership after held attachment validation so fire B cannot replace fire A', async () => {
    const fixture = await museBackend()
    await fixture.session.sendTurn([{ type: 'text', text: 'Ordinary' }])
    fixture.server.notify('turn/started', {
      sessionId: fixture.session.sessionId,
      turnId: 'schedule-turn',
      viewCursor: '',
    })
    await settle()
    const { entered, release, io } = heldAttachmentPath()
    const a = unattendedRun()
    const b = unattendedRun({
      context: { ...commandContext(), runId: 'fire-B' },
      io,
    })
    const pending = fixture.session.steerScheduledTurn(
      'schedule-turn',
      [{ ...PROTECTED_ATTACHMENT, name: 'src/held.txt' }],
      b.run,
    )
    const refused = expect(pending).rejects.toThrow()
    await entered.promise
    await fixture.session.steerScheduledTurn(
      'schedule-turn',
      [{ type: 'text', text: 'Fire A' }],
      a.run,
    )
    release.resolve(undefined)
    await refused
    expect(fixture.session.getScheduledRun('schedule-turn')).toBe(a.run)
    expect(fixture.server.requestsFor('turn/steer')).toHaveLength(1)
    fixture.notifyApproval()
    await museDecided(fixture)
    expect(fixture.server.requestsFor('approval/decide')[0]?.params?.['choiceId']).toBe('abort')
    expect(b.audit).not.toHaveBeenCalled()
    await fixture.host.close()
  })
  it('rechecks the native idle boundary after held attachment validation before changing mode', async () => {
    const fixture = await museBackend()
    const { entered, release, io } = heldAttachmentPath()
    const { run } = unattendedRun({
      io,
    })
    const pending = fixture.session.sendScheduledTurn(
      [{ ...PROTECTED_ATTACHMENT, name: 'src/held.txt' }],
      run,
    )
    const refused = expect(pending).rejects.toThrow()
    await entered.promise
    await fixture.session.sendTurn([{ type: 'text', text: 'Ordinary' }])
    release.resolve(undefined)
    await refused
    expect(fixture.server.requestsFor('session/setApprovalMode')).toHaveLength(0)
    expect(fixture.server.requestsFor('turn/start')).toHaveLength(1)
    await fixture.host.close()
  })
  it('refuses native fire admission while an ordinary start acknowledgment is pending', async () => {
    const fixture = await museBackend()
    const { ordinary } = await heldOrdinaryStart(fixture)
    const { run } = unattendedRun()
    await expect(
      fixture.session.sendScheduledTurn([{ type: 'text', text: 'Fire' }], run),
    ).rejects.toThrow()
    expect(fixture.server.requestsFor('session/setApprovalMode')).toHaveLength(0)
    answerNative(fixture, 'turn/start', 0, () => ({
      turnId: 'ordinary-turn',
      disposition: 'started',
      startedNewTurn: true,
    }))
    await ordinary
    await fixture.host.close()
  })
  it('reads live native state through buffered events before scheduled wire dispatch', async () => {
    const fixture = await museBackend()
    fixture.server.silence('session/setApprovalMode')
    const { run } = unattendedRun()
    const pending = fixture.session.sendScheduledTurn([{ type: 'text', text: 'Fire' }], run)
    const refused = expect(pending).rejects.toThrow()
    await vi.waitFor(() => {
      expect(fixture.server.requestsFor('session/setApprovalMode')).toHaveLength(1)
    })
    fixture.server.notify('turn/started', {
      sessionId: fixture.session.sessionId,
      turnId: 'ordinary-turn',
      viewCursor: '',
    })
    await settle()
    answerNative(fixture, 'session/setApprovalMode', 0, modeResult)
    await refused
    expect(fixture.server.requestsFor('turn/start')).toHaveLength(0)
    await fixture.host.close()
  })
  it('checks ordinary steered attachments against the active native fire before wire submission', async () => {
    const fixture = await museBackend()
    const { run } = unattendedRun()
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Check' }], run)
    await expect(fixture.session.steer('schedule-turn', [PROTECTED_ATTACHMENT])).rejects.toThrow()
    expect(fixture.server.requestsFor('turn/steer')).toHaveLength(0)
    await fixture.host.close()
  })
  it('allows only once for a matched rule and audits the run without command arguments', async () => {
    const fixture = await museBackend()
    const context = commandContext()
    const { run, audit } = unattendedRun({ context })
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Check' }], run)
    fixture.notifyApproval()
    await museDecided(fixture)
    expect(fixture.server.requestsFor('approval/decide')[0]?.params).toMatchObject({
      choiceId: 'allow_once',
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ runId: context.runId, ruleId: 'npm' }),
    )
    await fixture.host.close()
  })
  it('defers a question at once through the registry and drops its stale clarification waiter after completion', async () => {
    const fixture = await museBackend()
    const held = Promise.withResolvers<undefined>()
    const deferQuestions = vi.fn(() => held.promise)
    const { run } = unattendedRun({ deferQuestions })
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Check' }], run)
    fixture.server.notify('turn/started', {
      sessionId: fixture.session.sessionId,
      turnId: 'schedule-turn',
      viewCursor: '',
    })
    fixture.server.notify('userInput/requested', {
      sessionId: fixture.session.sessionId,
      turnId: 'schedule-turn',
      userInputId: 'question-1',
      itemId: 'question-item',
      questions: [
        {
          id: 'colour',
          header: 'Colour',
          question: 'Which colour?',
          options: [{ label: 'Red' }],
          selection: { mode: 'single' },
        },
      ],
      toolCallId: 'call-1',
      toolName: 'request_user_input',
      viewCursor: '',
    })
    await vi.waitFor(() => {
      expect(deferQuestions).toHaveBeenCalledTimes(1)
    })
    await completeMuseTurn(fixture)
    const late = museEvents(fixture.session)
    expect(late.some((event) => event.type === 'questionRequested')).toBe(false)
    held.resolve(undefined)
    await settle()
    expect(fixture.server.requestsFor('userInput/clarify')).toHaveLength(0)
    expect(deferQuestions).toHaveBeenCalledTimes(1)
    expect(deferQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ userInputId: 'question-1' }),
      run.context,
    )
    expect(fixture.events.some((event) => event.type === 'questionRequested')).toBe(false)
    await fixture.host.close()
  })
  it('rejects physical and requiresAsking actions even with broad grants and repeated requests settle independently', async () => {
    const fixture = await museBackend()
    const context = fakeRunContext()
    context.grant.rules = [{ id: 'tool', kind: 'tool', name: 'device' }]
    const { run } = unattendedRun({
      context,
      safety: (action) => (action.tool === 'device' ? 'Physical refused.' : undefined),
    })
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Check' }], run)
    fixture.notifyApproval('device', { kind: 'tool', command: '' }, 'physical-1')
    fixture.notifyApproval('device', { kind: 'tool', command: '' }, 'physical-2')
    await museDecided(fixture, 2)
    expect(
      fixture.server.requestsFor('approval/decide').map((request) => request.params?.['choiceId']),
    ).toEqual(['abort', 'abort'])
    await fixture.host.close()
  })
  it('does not replay an unattended approval to a listener joining during the audit', async () => {
    const fixture = await museBackend()
    const held = Promise.withResolvers<undefined>()
    const audit = vi.fn(() => held.promise)
    const context = commandContext()
    const { run } = unattendedRun({
      context,
      audit,
    })
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Check' }], run)
    fixture.notifyApproval()
    await vi.waitFor(() => {
      expect(audit).toHaveBeenCalledTimes(1)
    })
    const late = museEvents(fixture.session)
    held.resolve(undefined)
    await museDecided(fixture)
    expect(late.some((event) => event.type === 'approvalRequested')).toBe(false)
    await fixture.host.close()
  })
  it('never cancels a later ordinary turn when a completed scheduled approval fails late', async () => {
    const fixture = await museBackend()
    const held = Promise.withResolvers<undefined>()
    const audit = vi.fn(() => held.promise)
    let isActive = true
    const { run } = unattendedRun({ context: commandContext(), audit, isActive: () => isActive })
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Check' }], run)
    fixture.notifyApproval()
    await vi.waitFor(() => {
      expect(audit).toHaveBeenCalledTimes(1)
    })
    await completeMuseTurn(fixture)
    const late = museEvents(fixture.session)
    expect(late.some((event) => event.type === 'approvalRequested')).toBe(false)
    isActive = false
    await fixture.session.sendTurn([{ type: 'text', text: 'Ordinary' }])
    fixture.server.handle('approval/decide', () => {
      throw new Error('Old stage closed')
    })
    held.resolve(undefined)
    await museDecided(fixture)
    await settle()
    expect(fixture.server.requestsFor('turn/cancel')).toHaveLength(0)
    const afterFailure = museEvents(fixture.session)
    expect(afterFailure.some((event) => event.type === 'approvalRequested')).toBe(false)
    await fixture.host.close()
  })
  it('rechecks scheduled ownership after a held approval before wire cancellation', async () => {
    const fixture = await museBackend()
    fixture.server.silence('approval/decide')
    const cancel = vi.spyOn(fixture.session, 'cancel')
    const { run } = unattendedRun({ context: commandContext() })
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Check' }], run)
    fixture.notifyApproval('powershell', DEFAULT_SUBJECT, 'held-decision')
    await museDecided(fixture)
    fixture.notifyApproval('powershell', DEFAULT_SUBJECT, 'failed-decision')
    await museDecided(fixture, 2)
    const failed = fixture.server.requestsFor('approval/decide')[1]
    fixture.server.incoming.push(
      JSON.stringify({
        jsonrpc: '2.0',
        id: failed?.id,
        error: {
          code: -32_000,
          message: 'Second decision failed',
          data: { kind: 'commandRejected' },
        },
      }) + '\n',
    )
    await vi.waitFor(() => {
      expect(cancel).toHaveBeenCalledTimes(1)
    })
    await completeMuseTurn(fixture)
    fixture.server.handle('turn/start', (params) => ({
      ...ack(params),
      turnId: 'ordinary-turn',
      disposition: 'started',
      startedNewTurn: true,
    }))
    await fixture.session.sendTurn([{ type: 'text', text: 'Ordinary' }])
    fixture.server.notify('turn/started', {
      sessionId: fixture.session.sessionId,
      turnId: 'ordinary-turn',
      viewCursor: '',
    })
    await settle()
    const held = fixture.server.requestsFor('approval/decide')[0]
    fixture.server.incoming.push(
      JSON.stringify({
        jsonrpc: '2.0',
        id: held?.id,
        result: { commandId: held?.params?.['commandId'], terminal: true, status: 'accepted' },
      }) + '\n',
    )
    await cancel.mock.results[0]?.value
    expect(fixture.server.requestsFor('turn/cancel')).toHaveLength(0)
    await fixture.host.close()
  })
  it('retains unattended ownership when a start ack fails after a captured approval and stops the turn', async () => {
    const fixture = await museBackend()
    fixture.server.handle('turn/start', () => {
      fixture.notifyApproval()
      throw new Error('ack lost')
    })
    const context = commandContext()
    await expect(
      fixture.session.sendScheduledTurn(
        [{ type: 'text', text: 'Check' }],
        unattendedRun({ context }).run,
      ),
    ).rejects.toThrow()
    await museDecided(fixture)
    expect(fixture.server.requestsFor('approval/decide')[0]?.params).toMatchObject({
      choiceId: 'abort',
    })
    expect(fixture.server.requestsFor('turn/cancel')).toHaveLength(1)
    expect(fixture.events.some((event) => event.type === 'approvalRequested')).toBe(false)
    await fixture.host.close()
  })
  it('refuses concurrent native admission and Bypass, then restores the ordinary mode before a new turn', async () => {
    const fixture = await museBackend('allowAll')
    const { run } = unattendedRun()
    const results = await Promise.allSettled([
      fixture.session.sendScheduledTurn([{ type: 'text', text: 'Check' }], run),
      fixture.session.sendScheduledTurn([{ type: 'text', text: 'Other' }], run),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    await expect(fixture.session.setApprovalMode('allowAll')).rejects.toThrow()
    await completeMuseTurn(fixture)
    await fixture.session.sendTurn([{ type: 'text', text: 'Ordinary' }])
    expect(
      fixture.server
        .requestsFor('session/setApprovalMode')
        .map((request) => request.params?.['mode']),
    ).toEqual(['promptUnmatched', 'allowAll'])
    await fixture.host.close()
  })
  it('keeps early approval notifications behind context admission rather than leaking a pending card', async () => {
    const fixture = await museBackend()
    const { run } = unattendedRun()
    fixture.server.handle('turn/start', (params) => {
      fixture.notifyApproval()
      return {
        commandId: params['commandId'],
        status: 'accepted',
        turnId: 'schedule-turn',
        disposition: 'started',
      }
    })
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Check' }], run)
    await settle()
    await museDecided(fixture)
    expect(fixture.events.some((event) => event.type === 'approvalRequested')).toBe(false)
    await fixture.host.close()
  })
})
