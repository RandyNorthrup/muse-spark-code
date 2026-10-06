import { describe, expect, it, vi } from 'vitest'
import { MuseCodeHost, MuseSession } from '../../src/core/backends/musecode/MuseCodeHost'
import { ModelApiHost, type ModelApiHostDeps } from '../../src/core/backends/modelapi/ModelApiHost'
import { MODEL_API_TOOLS } from '../../src/shared/constants'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { fakeMspHost, settle } from './helpers/fakeMsp'
import { raceRequested, RACE_APPROVAL_ID } from './helpers/stageRaceCapture'
import { fakeModelApi, fakeModelApiClient, FAKE_MODEL_API_ACCOUNT_ID } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { fakeLanguageService, renamed } from './helpers/fakeLanguageService'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel } from './helpers/fakes'
import { startWatchedSession } from './helpers/sessionTurns'
import type { ScheduleRunDeps, UnattendedRun } from '../../src/core/schedules/unattended'
import { fakeMcpSource } from './helpers/fakeMcpSource'
import { unattendedRun } from './helpers/schedules/unattended'
import { fakeRunContext } from './helpers/schedules/fixtures'

async function modelBackend(overrides: Partial<ModelApiHostDeps> = {}) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({ 'src/read.txt': 'inside workspace' }, '/workspace')
  const popup = vi.fn().mockResolvedValue(false)
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({
      client: fakeModelApiClient(api, log),
      workspaceRoot: '/workspace',
      io,
      log,
    }),
    isPaidFeatureOn: () => true,
    allowsPaidUse: popup,
    ...overrides,
  })
  const watched = await startWatchedSession(host, '/workspace', 'promptUnmatched')
  watched.session.onEvent((event) => {
    if (['approvalRequested', 'elicitationRequested', 'questionRequested'].includes(event.type))
      void watched.session.cancel()
  })
  const reserve = vi.fn().mockResolvedValue({
    claimId: 'paid-claim',
    reservedUsd: 1,
    check: () => ({ spentUsd: 1, hasUnknownHistoricalFees: false }),
    settle: () => Promise.resolve({ spentUsd: 0, hasUnknownHistoricalFees: false }),
  })
  const run = (context = fakeRunContext(), overrides: Partial<ScheduleRunDeps> = {}) =>
    unattendedRun({
      context,
      io,
      paid: {
        modelId: 'muse-spark-1.3',
        accountId: FAKE_MODEL_API_ACCOUNT_ID,
        allows: (feature) => feature === 'scheduledPrompts',
        reserve,
      },
      ...overrides,
    })
  return { api, io, popup, host, ...watched, run, reserve }
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

describe('scheduled Model API dispatch', () => {
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
    expect(row).toHaveBeenCalledTimes(2)
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
    fixture.api.script(
      { calls: [{ name: MODEL_API_TOOLS.readFile, arguments: '{"path":"src/read.txt"}' }] },
      { text: 'done' },
    )
    const done = fixture.turnDone()
    await fixture.session.sendScheduledTurn([{ type: 'text', text: 'Read' }], run)
    await done
    expect(row).toHaveBeenCalledTimes(1)
    expect(run.refusedActions).toHaveLength(1)
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
      expect(row).toHaveBeenCalledTimes(isAllowed ? 0 : 1)
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
      const entered = Promise.withResolvers<undefined>()
      const held = Promise.withResolvers<undefined>()
      fixture.api.script(
        {
          hold: held.promise,
          onRequest: () => {
            entered.resolve(undefined)
          },
          ...(kind === 'steer'
            ? { calls: [{ name: MODEL_API_TOOLS.readFile, arguments: '{"path":"src/read.txt"}' }] }
            : { text: 'ordinary done' }),
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
      expect(fixture.session.getScheduledRun()).toBeUndefined()
      held.resolve(undefined)
      await vi.waitFor(() => {
        expect(fixture.events.filter((event) => event.type === 'turnCompleted')).toHaveLength(
          kind === 'queue' ? 2 : 1,
        )
      })
      expect(fixture.io.shellCalls).toHaveLength(0)
      expect(row).toHaveBeenCalledTimes(1)
      expect(fixture.events.some((event) => event.type === 'approvalRequested')).toBe(false)
      const bodies = fixture.api.responseBodies()
      expect(JSON.stringify(bodies[0]?.['input'])).not.toContain(run.modelText.unattendedNote)
      expect(JSON.stringify(bodies[1]?.['input'])).toContain(run.modelText.unattendedNote)
      expect(fixture.session.getScheduledRun()).toBeUndefined()
      await fixture.host.close()
    },
  )
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
  it('defers a question at once through the registry, then clarifies the captured tool without a form', async () => {
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
    await vi.waitFor(() => {
      expect(fixture.server.requestsFor('userInput/clarify')).toHaveLength(1)
    })
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
