// Process-level end-to-end tests for the Muse Code backend (PLAN.md D16):
// the real backend manager resolves and spawns a real child process (the
// fake CLI of fake-muse/serve.mjs), speaks MSP over its stdio through the
// SDK, and the events reach a session listener exactly as the panel's
// controller receives them. Every path the panel has is driven: a reply, a
// gated tool call approved and rejected, refusal by mode, bypass, cancel,
// history and usage, plus the drills: a host that dies mid-turn, a
// malformed frame, a binary that will not start, and no binary at all.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EXPECTED_SCHEMA_FINGERPRINT } from '@muse-code/sdk'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import type { AgentSession, HostExit } from '../../src/core/agent/agentBackend'
import type { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import { MuseCodeBackendManager } from '../../src/host/backend/museCodeBackendManager'
import { DEFAULT_MODEL_ID, MSP_CLIENT_NAME } from '../../src/shared/constants'
import { FakeLogOutputChannel } from '../unit/helpers/fakes'
import { installFakeCredential, installFakeMuse } from './fakeMuse'

const TURN_TIMEOUT_MS = 10_000
const TEST_TIMEOUT_MS = 30_000
const POLL_MS = 10
const ALLOW = 'allow_once'
const REJECT = 'abort'
/** Everything the resolver's discovery reads from the environment. */
const DISCOVERY_VARIABLES = ['PATH', 'Path', 'LOCALAPPDATA', 'HOME', 'USERPROFILE'] as const

// Built once per file: the fake install (a compiled stub on Windows), an
// empty workspace and a config home holding the CLI's credential file.
const fake = installFakeMuse()
const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'fake-muse-ws-'))
const configHome = installFakeCredential()
process.env['XDG_CONFIG_HOME'] = configHome
const managers: MuseCodeBackendManager[] = []

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function until(isMet: () => boolean): Promise<void> {
  const deadline = Date.now() + TURN_TIMEOUT_MS
  while (!isMet()) {
    if (Date.now() > deadline) {
      throw new Error(`condition not met within ${String(TURN_TIMEOUT_MS)} ms`)
    }
    await sleep(POLL_MS)
  }
}

function manager(
  options: { binaryPath?: string; start?: string; handshakeTimeoutMs?: number } = {},
) {
  const log = new FakeLogOutputChannel()
  const created = new MuseCodeBackendManager({
    log,
    extensionVersion: '0.0.0-e2e',
    getConfiguredBinaryPath: () => options.binaryPath ?? fake.binaryPath,
    // The documented way to hand the CLI environment: the fake needs the
    // Node it should run under and the SDK's pinned schema fingerprint.
    getEnvironmentVariables: () => [
      { name: 'MUSE_FAKE_NODE', value: process.execPath },
      { name: 'MUSE_FAKE_FINGERPRINT', value: EXPECTED_SCHEMA_FINGERPRINT },
      ...(options.start === undefined ? [] : [{ name: 'MUSE_FAKE_START', value: options.start }]),
    ],
    workspaceRoot,
    getShellSandbox: () => 'off',
    userProfileDir: undefined,
    isWorkspaceTrusted: () => true,
    getProxySettings: () => ({ proxy: '', noProxy: [] }),
    ...(options.handshakeTimeoutMs !== undefined && {
      handshakeTimeoutMs: options.handshakeTimeoutMs,
    }),
  })
  managers.push(created)
  return { manager: created, log }
}

/** Collects a session's events and resolves on the next terminal event. */
function watch(session: AgentSession) {
  const events: AgentEvent[] = []
  let completed = 0
  session.onEvent((event) => {
    events.push(event)
    if (event.type === 'turnCompleted') {
      completed += 1
    }
  })
  /**
   * A wait for the next terminal event, with its baseline taken now: taken
   * later, a completion that lands in the same stdio chunk as the command's
   * response would already be counted and the wait would never end.
   */
  const nextCompletion = () => {
    const seen = completed
    return async () => {
      await until(() => completed > seen)
      return events.findLast((event) => event.type === 'turnCompleted')
    }
  }
  return {
    events,
    /** Sends a text turn; `done` resolves on that turn's terminal event. */
    start: (text: string) => {
      const done = nextCompletion()
      return { submission: session.sendTurn([{ type: 'text', text }]), done }
    },
    kinds: () => events.map((event) => event.type),
    text: () =>
      events.flatMap((event) => (event.type === 'textDelta' ? [event.delta] : [])).join(''),
    approval: () => events.find((event) => event.type === 'approvalRequested'),
    completedItems: () =>
      events.flatMap((event) => (event.type === 'itemCompleted' ? [event.item] : [])),
  }
}

async function openSession(host: MuseCodeHost, approvalMode = 'promptUnmatched') {
  const session = await host.startSession({
    workspaceRoot,
    modelId: DEFAULT_MODEL_ID,
    approvalMode,
  })
  return { session, ...watch(session) }
}

async function approvalOf(t: ReturnType<typeof watch>) {
  await until(() => t.approval() !== undefined)
  const request = t.approval()
  if (request?.type !== 'approvalRequested') {
    throw new Error('expected an approval request')
  }
  return request
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map((created) => created.dispose()))
})

// On Windows the fake CLI's executable can still be held for a moment after
// its process has exited (seen in CI and under a full local run, every test
// green), and removing its folder then fails with EPERM. Node retries the
// removal; if the folder still cannot go, the suite says so and leaves it
// to the OS temp cleanup rather than fail on housekeeping.
const RM_RETRIES = 5
const RM_RETRY_DELAY_MS = 200

afterAll(() => {
  delete process.env['XDG_CONFIG_HOME']
  for (const dir of [fake.installDir, workspaceRoot, configHome]) {
    try {
      rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: RM_RETRIES,
        retryDelay: RM_RETRY_DELAY_MS,
      })
    } catch (error: unknown) {
      process.stderr.write(`e2e teardown left ${dir} behind: ${String(error)}\n`)
    }
  }
})

// Each case spawns a process; CI runners are slower than a workstation.
describe('Muse Code backend against a real child process', { timeout: TEST_TIMEOUT_MS }, () => {
  it('spawns the configured binary with the serve flags, shakes hands as the extension, and sees the credential file', async () => {
    const { manager: backend, log } = manager()
    expect(backend.credentialFileExists()).toBe(true)
    const host = await backend.ensureHost()
    expect(host.info.serverName).toBe('muse')
    expect(host.info.serverVersion).toBe('0.0.0-fake serve --disable-sandbox --trust-workspace')
    expect(host.info.museHome).toBe(`/fake/home/${MSP_CLIENT_NAME}`)
    expect(host.info.grantedCapabilities).toEqual(['sessionMcp', 'sessionListStream'])
    expect(backend.isRunning).toBe(true)
    expect(log.warn).not.toHaveBeenCalled()
    expect(await backend.ensureHost()).toBe(host)
  })

  it('runs a turn end to end: events in order, streamed text, usage after, history listed and resumed', async () => {
    const { manager: backend } = manager()
    const host = await backend.ensureHost()
    expect(await host.readUsage()).toBeUndefined()
    const t = await openSession(host)
    expect(await host.listModels(t.session.sessionId)).toEqual([
      {
        modelId: DEFAULT_MODEL_ID,
        displayLabel: 'Muse Spark 1.3',
        contextLimit: 1_007_997,
        isDefault: true,
        isActive: true,
      },
    ])
    const turn = t.start('hello there')
    const submission = await turn.submission
    expect(submission.disposition).toBe('started')
    expect(await turn.done()).toMatchObject({ type: 'turnCompleted', terminal: 'completed' })
    // The idle status is its own notification after the turn's end; under a
    // loaded machine it can land a moment after `done` resolves (a flake the
    // M43 gate hit once), so it is waited for rather than assumed.
    await vi.waitFor(() => {
      expect(t.kinds().at(-1)).toBe('sessionStatus')
    })
    expect(t.kinds()).toEqual([
      'turnStarted',
      'sessionStatus',
      'itemStarted',
      'itemCompleted',
      'itemStarted',
      'textDelta',
      'textDelta',
      'itemCompleted',
      'tokenUsage',
      'contextUsage',
      'turnCompleted',
      'sessionStatus',
    ])
    expect(t.text()).toBe('echo: hello there')
    const usage = await host.readUsage()
    expect(usage?.window.windowDurationMins).toBe(300)
    const page = await host.listSessions({ workspaceRoot, limit: 10 })
    expect(page.sessions.map((row) => row.sessionId)).toEqual([t.session.sessionId])
    expect(page.sessions[0]?.turnCount).toBe(1)
    t.session.dispose()
    const resumed = await host.resumeSession(t.session.sessionId, DEFAULT_MODEL_ID)
    expect(resumed.history.mode).toBe('inline')
    expect(resumed.history.items.map((item) => item.kind)).toEqual(['userMessage', 'agentMessage'])
    expect(resumed.history.items[1]?.text).toBe('echo: hello there')
    expect(await host.listSessions({ workspaceRoot: '/elsewhere', limit: 10 })).toEqual({
      sessions: [],
      nextCursor: undefined,
    })
  })

  it('gates a tool call on approval: allowed runs it, rejected skips it', async () => {
    const { manager: backend } = manager()
    const host = await backend.ensureHost()
    const t = await openSession(host)
    const first = t.start('tool: Get-ChildItem')
    await first.submission
    const request = await approvalOf(t)
    expect(request).toMatchObject({
      toolName: 'powershell',
      subject: { kind: 'shell', command: 'Get-ChildItem' },
    })
    expect(request.availableChoices.map((choice) => choice.choiceId)).toEqual([ALLOW, REJECT])
    await t.session.decideApproval({
      approvalId: request.approvalId,
      choiceId: ALLOW,
      requirementId: request.requirementId,
    })
    await first.done()
    expect(t.events.find((event) => event.type === 'approvalResolved')).toMatchObject({
      decision: 'approved',
    })
    expect(t.completedItems().find((item) => item.kind === 'toolCall')).toMatchObject({
      status: 'completed',
      visibleOutput: 'ran Get-ChildItem\n',
    })
    expect(t.text()).toBe('ran: Get-ChildItem')

    const second = watch(t.session)
    const turn = second.start('tool: Remove-Item x')
    await turn.submission
    const rejection = await approvalOf(second)
    await t.session.decideApproval({
      approvalId: rejection.approvalId,
      choiceId: REJECT,
      requirementId: rejection.requirementId,
      feedback: 'not that one',
    })
    await turn.done()
    expect(second.completedItems().find((item) => item.kind === 'toolCall')).toMatchObject({
      status: 'failed',
      failureReason: 'rejected by the user',
    })
    expect(second.text()).toBe('skipped: Remove-Item x')
  })

  it('refuses tools without asking in denyUnmatched and runs them without asking in allowAll', async () => {
    const { manager: backend } = manager()
    const host = await backend.ensureHost()
    const plan = await openSession(host, 'denyUnmatched')
    await plan.start('tool: npm test').done()
    expect(plan.approval()).toBeUndefined()
    expect(plan.completedItems().find((item) => item.kind === 'toolCall')).toMatchObject({
      status: 'failed',
      failureReason: 'denied by policy',
    })
    const bypass = await openSession(host, 'allowAll')
    await bypass.start('tool: npm test').done()
    expect(bypass.approval()).toBeUndefined()
    expect(bypass.text()).toBe('ran: npm test')
    await plan.session.setApprovalMode('allowAll')
    await until(() => plan.events.at(-1)?.type === 'approvalModeChanged')
    expect(plan.events.at(-1)).toEqual({ type: 'approvalModeChanged', mode: 'allowAll' })
  })

  it('cancels a running turn', async () => {
    const { manager: backend } = manager()
    const host = await backend.ensureHost()
    const t = await openSession(host)
    const turn = t.start('slow')
    await turn.submission
    await until(() => t.events.some((event) => event.type === 'turnStarted'))
    await t.session.cancel()
    expect(await turn.done()).toMatchObject({ type: 'turnCompleted', terminal: 'cancelled' })
  })

  it('reports subagents with their child sessions and a backgrounded tool call (M14)', async () => {
    const { manager: backend } = manager()
    const host = await backend.ensureHost()
    const t = await openSession(host)
    await t.start('subagents').done()
    const agents = t
      .completedItems()
      .filter((item) => item.kind === 'subagent')
      .map((item) => [item.role, item.objective, item.controlStatus, item.usage?.inputTokens])
    expect(agents).toEqual([
      ['explorer', 'Map the workspace layout', 'closed', 1000],
      ['reviewer', 'Review the change for dead code', 'closed', 2000],
    ])
    const first = t.completedItems().find((item) => item.kind === 'subagent')
    expect(first?.result?.summary).toBe('explorer finished: map the workspace layout')
    expect(first?.childSessionId).toBeDefined()
    const child = await host.readSession(first?.childSessionId ?? '')
    expect(child.items.map((item) => item.kind)).toEqual(['userMessage', 'agentMessage'])
    expect(child.items[1]?.text).toBe('explorer finished: map the workspace layout')
    expect(t.text()).toBe('delegated: 2 agents')
    // Owner controls (M18): the CLI answers each and updates the item.
    const controlled = watch(t.session)
    const subagentId = first?.subagentId ?? ''
    await t.session.controlSubagent(subagentId, 'interrupt')
    await vi.waitFor(() => {
      expect(
        controlled.events.some(
          (event) =>
            event.type === 'itemUpdated' &&
            event.item.subagentId === subagentId &&
            event.item.controlStatus === 'interrupted',
        ),
      ).toBe(true)
    })
    await t.session.messageSubagent(subagentId, 'one more file', true)
    await vi.waitFor(() => {
      expect(
        controlled.events.some(
          (event) =>
            event.type === 'itemUpdated' &&
            event.item.result?.summary === 'followup: one more file',
        ),
      ).toBe(true)
    })
    const second = watch(t.session)
    await second.start('background: npm test').done()
    expect(
      second.events.some((event) => event.type === 'itemUpdated' && event.item.background === true),
    ).toBe(true)
    expect(second.completedItems().find((item) => item.kind === 'toolCall')).toMatchObject({
      background: true,
      backgroundInitiator: 'user',
      status: 'completed',
    })
  })

  it('survives a malformed frame', async () => {
    const { manager: backend, log } = manager()
    const host = await backend.ensureHost()
    const t = await openSession(host)
    await t.start('malformed').done()
    expect(t.text()).toBe('echo: malformed')
    expect(log.error).not.toHaveBeenCalled()
  })

  it('reports a host that dies mid-turn and spawns a fresh one afterwards (drill)', async () => {
    const { manager: backend, log } = manager()
    const host = await backend.ensureHost()
    const exits: HostExit[] = []
    host.onExit((exit) => {
      exits.push(exit)
    })
    const t = await openSession(host)
    await t.start('die').submission
    await until(() => exits.length > 0)
    // A crash, not the extension's own close; restarting can help (D25).
    expect(exits[0]).toEqual({
      description: 'Muse Code failed with an unhandled error (exit code 1)',
      isExpected: false,
      isPersistent: false,
    })
    expect(backend.isRunning).toBe(false)
    expect(log.warn).toHaveBeenCalledWith('muse serve stderr: fake muse: dying on purpose')
    const next = await backend.ensureHost()
    expect(next).not.toBe(host)
    expect(next.info.serverName).toBe('muse')
  })

  it('rejects when the binary will not start (drill)', async () => {
    const crashing = manager({ start: 'crash' })
    await expect(crashing.manager.ensureHost()).rejects.toThrow()
    expect(crashing.manager.isRunning).toBe(false)
    expect(crashing.log.warn).toHaveBeenCalledWith(
      'muse serve stderr: fake muse: refusing to start',
    )
  })

  it('gives up on a host that never answers the handshake, and ends it (drill, D25)', async () => {
    const wedged = manager({ start: 'silent', handshakeTimeoutMs: 500 })
    const started = Date.now()
    await expect(wedged.manager.ensureHost()).rejects.toThrow(
      'Muse Code did not finish starting within 1 s',
    )
    expect(wedged.manager.isRunning).toBe(false)
    expect(Date.now() - started).toBeLessThan(TURN_TIMEOUT_MS)
    // The next call spawns afresh instead of reusing the dead attempt.
    await expect(wedged.manager.ensureHost()).rejects.toThrow('did not finish starting')
  })

  it('rejects when there is no binary anywhere (drill)', async () => {
    // Discovery reads PATH, the profile and the home directory; point them
    // all at the empty workspace so the machine's real CLI is never found.
    const saved = Object.fromEntries(DISCOVERY_VARIABLES.map((name) => [name, process.env[name]]))
    for (const name of DISCOVERY_VARIABLES) {
      process.env[name] = workspaceRoot
    }
    try {
      const missing = manager({ binaryPath: path.join(workspaceRoot, 'nowhere', 'muse.exe') })
      await expect(missing.manager.ensureHost()).rejects.toThrow(/not installed/)
      expect(missing.manager.isRunning).toBe(false)
    } finally {
      for (const name of DISCOVERY_VARIABLES) {
        const value = saved[name]
        if (value === undefined) {
          Reflect.deleteProperty(process.env, name)
        } else {
          process.env[name] = value
        }
      }
    }
  })
})
