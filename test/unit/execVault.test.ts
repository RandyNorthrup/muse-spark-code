import type { VaultApprovalResult } from '../../src/shared/vaultProtocol'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HeadlessVaultSession, type ExecVaultContext } from '../../src/runtime/vault/execVault'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { runExec, type ExecDeps } from '../../src/runtime/exec/runExec'
import { createLifecycle } from '../../src/runtime/exec/execLimits'
import { execEventSchema } from '../../src/runtime/exec/execProtocol'
import { EXEC_EXIT, UI_TEXT } from '../../src/shared/constants'
import type { VaultBrokerPort, VaultAuthorizationResult } from '../../src/shared/vaultProtocol'
import { vaultUseDigest } from '../../src/core/vault/useDigest'
import { approval, requester, ticket, use, panel } from './helpers/vault/fixtures'
import { outputWriter } from './helpers/execContract'
import { memorySecrets } from './helpers/fakes'
import { until } from './helpers/acpWaits'
import { FakeAgentHost } from './helpers/fakeAgent'
import * as backends from '../../src/runtime/backends'

function authorization() {
  return {
    kind: 'ticket',
    ticket: { ...ticket(), digest: vaultUseDigest(use()) },
    authority: { kind: 'grant', grantId: 'f'.repeat(32) },
  } satisfies VaultAuthorizationResult
}
function policyHarness() {
  const identity = {
    ...requester(),
    source: 'headless' as const,
    unattended: true,
    role: { kind: 'headless' as const },
  }
  const controller = new AbortController()
  const context: ExecVaultContext = {
    cwd: process.cwd(),
    sessionId: identity.conversationId ?? '',
    signal: controller.signal,
    source: 'headless',
    unattended: true,
    onDenied: vi.fn(),
  }
  const request = vi.fn<VaultBrokerPort['request']>(() => Promise.resolve(authorization()))
  const broker: VaultBrokerPort = {
    clock: { now: () => 1 },
    status: () => Promise.resolve(panel().status),
    list: () => Promise.resolve([]),
    request,
    answer: () => Promise.resolve({ kind: 'denied', reason: 'policy' }),
    lock: () => Promise.resolve(),
  }
  const end = vi.fn(() => Promise.resolve())
  const session = new HeadlessVaultSession(identity, broker, context, end)
  return { session, request, context, identity, broker, end, controller }
}
function kindOf(result: VaultApprovalResult): VaultApprovalResult['kind'] {
  return result.kind
}

const clean = { tainted: false, reasons: [] }

describe('M109 H headless authorization', () => {
  it.each(['tainted', 'presence', 'locked', 'policy', 'unattended'] as const)(
    'W-H1 preserves the %s denial and only recommends a grant when it can help',
    async (reason) => {
      const h = policyHarness()
      h.request.mockResolvedValue({ kind: 'denied', reason })
      const result = await h.session.request('secret://test-secret', use(), clean)
      expect(result).toEqual({ kind: 'denied', reason })
      const message = vi.mocked(h.context.onDenied).mock.calls[0]?.[0]
      expect(message).toContain('secret://test-secret')
      if (reason === 'unattended') expect(message).toContain('unattended grant')
      else expect(message).not.toContain('unattended grant')
    },
  )

  it('H50 accepts only bound, unexpired grant tickets for headless registration', async () => {
    const h = policyHarness()
    expect(kindOf(await h.session.request('secret://test-secret', use(), clean))).toBe('ticket')
    expect(h.request.mock.calls[0]?.[0]).toMatchObject({
      role: { kind: 'headless' },
      source: 'headless',
      unattended: true,
    })
    expect(h.context.onDenied).not.toHaveBeenCalled()
    await h.session.close()
    await h.session.close()
    expect(h.end).toHaveBeenCalledOnce()
    expect(kindOf(await h.session.request('secret://test-secret', use(), clean))).toBe('denied')
    expect(h.request).toHaveBeenCalledOnce()
  })
  it.each(['approval', 'mode', 'denied', 'peer', 'digest', 'expired'])(
    'H51 %s fails closed without prompting',
    async (kind) => {
      const h = policyHarness()
      const result = authorization()
      switch (kind) {
        case 'approval': {
          h.request.mockResolvedValue({ kind: 'approval', request: approval() })
          break
        }
        case 'denied': {
          h.request.mockResolvedValue({ kind: 'denied', reason: 'presence' })
          break
        }
        case 'mode': {
          h.request.mockResolvedValue({ ...result, authority: { kind: 'mode' } })
          break
        }
        case 'peer': {
          h.request.mockResolvedValue({
            ...result,
            ticket: { ...result.ticket, requesterId: '0'.repeat(32) },
          })
          break
        }
        case 'digest': {
          h.request.mockResolvedValue({
            ...result,
            ticket: { ...result.ticket, digest: '0'.repeat(64) },
          })
          break
        }
        case 'expired': {
          {
            h.broker.clock.now = () => result.ticket.expiresAt
            // No default
          }
          break
        }
      }
      expect(kindOf(await h.session.request('secret://test-secret', use(), clean))).toBe('denied')
      expect(h.context.onDenied).toHaveBeenCalledOnce()
      expect(h.context.onDenied).toHaveBeenCalledWith(
        expect.stringContaining('secret://test-secret'),
      )
    },
  )
  it('H52 tainted, aborted and malformed requests never reach broker', async () => {
    const h = policyHarness()
    expect(
      kindOf(
        await h.session.request('secret://test-secret', use(), {
          tainted: true,
          reasons: [{ source: 'web', label: 'page' }],
        }),
      ),
    ).toBe('denied')
    expect(kindOf(await h.session.request('private-canary', use(), clean))).toBe('denied')
    h.controller.abort()
    expect(kindOf(await h.session.request('secret://test-secret', use(), clean))).toBe('denied')
    expect(h.request).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(h.context.onDenied).mock.calls)).not.toContain('private-canary')
  })
  it.each(['close', 'abort'] as const)(
    'H53 %s during authorization cannot release late ticket',
    async (boundary) => {
      const h = policyHarness()
      const held = Promise.withResolvers<VaultAuthorizationResult>()
      h.request.mockImplementation(() => held.promise)
      const waiting = h.session.request('secret://test-secret', use(), clean)
      if (boundary === 'close') await h.session.close()
      else h.controller.abort()
      held.resolve(authorization())
      expect(kindOf(await waiting)).toBe('denied')
    },
  )
  it('H54 requester cannot claim interactive role, missing workspace or another conversation', () => {
    const h = policyHarness()
    for (const identity of [
      { ...h.identity, role: { kind: 'orchestrator' as const } },
      { ...h.identity, workspaceId: null },
      { ...h.identity, conversationId: 'foreign' },
      requester(),
    ])
      expect(() => new HeadlessVaultSession(identity, h.broker, h.context, h.end)).toThrow(
        UI_TEXT.vault.noAccess,
      )
  })
})

const finishedPort = (context: ExecVaultContext) =>
  Promise.resolve({
    close: () => {
      context.onDenied('late private-canary')
      return Promise.resolve()
    },
  })

const noSignal = () => undefined
const actualRuntime = backends.createRuntimeBackend
afterEach(() => vi.restoreAllMocks())
function execHarness(flags: readonly string[] = []) {
  const parsed = parseCommandLine(['exec', '--output', 'jsonl', ...flags, 'task'])
  if (parsed.command !== 'exec') throw new Error('args')
  const stdout = outputWriter()
  const stderr = outputWriter()
  const now = Date.now
  const life = createLifecycle({
    processStartMs: now(),
    timeoutMs: parsed.options.timeoutMs,
    now,
    setTimer: (ms, callback) => {
      const timer = setTimeout(callback, ms)
      return () => {
        clearTimeout(timer)
      }
    },
    onSignal: () => noSignal,
    forceFinish: vi.fn(),
    exit: () => {
      throw new Error('exit')
    },
  })
  const deps: ExecDeps = {
    options: parsed.options,
    version: 'test',
    distDir: process.cwd(),
    platform: process.platform,
    env: {},
    homeDir: process.cwd(),
    processCwd: process.cwd(),
    stdin: new PassThrough(),
    stdout,
    stderr,
    storeSecrets: memorySecrets(),
    runGit: vi.fn(() => Promise.resolve('')),
    fetch: vi.fn(() => Promise.reject(new Error('no network'))),
    sleep: () => Promise.resolve(),
    now,
    readFile: vi.fn(() => Promise.reject(new Error('no files'))),
    randomHex: () => 'a'.repeat(32),
    log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
  const host = new FakeAgentHost()
  let onTurn: () => boolean | undefined = () => undefined
  const start = host.startSession.getMockImplementation()
  if (start === undefined) throw new Error('start')
  host.startSession.mockImplementation(async (...args) => {
    const session = await start(...args)
    const fake = host.sessions.at(-1)
    fake?.sendTurn.mockImplementation(() => {
      queueMicrotask(() => {
        if (onTurn() === false) return
        fake.emit({ type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' })
      })
      return Promise.resolve({ turnId: 'turn-1', disposition: 'started' })
    })
    return session
  })
  const close = vi.fn(() => Promise.resolve())
  const factory = vi.spyOn(backends, 'createRuntimeBackend').mockImplementation((input) => ({
    ...actualRuntime(input),
    backend: {
      kind: 'museCode',
      readiness: () => Promise.resolve({ state: 'ready' }),
      hostFor: () => Promise.resolve(host),
    },
    close,
  }))
  return {
    deps,
    life,
    factory,
    host,
    close,
    onTurn: (callback: () => boolean | undefined) => {
      onTurn = callback
    },
    run: async (changes: Partial<ExecDeps> = {}) => {
      try {
        const code = await runExec(life, { ...deps, ...changes })
        const records = stdout.chunks.flatMap((chunk) =>
          chunk
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => execEventSchema.parse(JSON.parse(line))),
        )
        const result = records.find((record) => record.type === 'result')
        if (result?.type !== 'result') throw new Error('no result')
        return { code, result: result.result }
      } finally {
        life.dispose()
      }
    },
  }
}

describe('M109 H local exec vault admission', () => {
  it('H55 flag is explicit and CI stdin-key parser cannot enable vault', () => {
    expect(parseCommandLine(['exec', 'task'])).toMatchObject({
      command: 'exec',
      options: { vault: false },
    })
    expect(parseCommandLine(['exec', '--vault', 'task'])).toMatchObject({
      command: 'exec',
      options: { vault: true },
    })
    expect(
      parseCommandLine([
        'exec',
        '--backend',
        'modelApi',
        '--max-budget-usd',
        '1',
        '--key-stdin',
        '--vault',
        'task',
      ]).command,
    ).toBe('invalid')
    expect(parseCommandLine(['scan-secrets', '--vault', 'file']).command).toBe('invalid')
  })
  it.each(['missing', 'ci'] as const)(
    'H56 %s denies before backend or vault access',
    async (reason) => {
      const h = execHarness(['--vault'])
      if (reason === 'ci') h.deps.env['CI'] = 'true'
      const open = vi.fn(() => Promise.resolve({ close: () => Promise.resolve() }))
      const { code, result } = await h.run(reason === 'ci' ? { vault: { open } } : {})
      expect(open).not.toHaveBeenCalled()
      expect(code).toBe(EXEC_EXIT.denied)
      expect(result.status).toBe('denied')
      expect(h.factory).not.toHaveBeenCalled()
    },
  )
  it('H57 flag off never opens vault and keeps ordinary completion', async () => {
    const h = execHarness()
    const open = vi.fn(() => Promise.reject(new Error('vault must stay closed')))
    const deps = { ...h.deps, vault: { open } }
    const code = await runExec(h.life, deps)
    h.life.dispose()
    expect(code).toBe(0)
    expect(open).not.toHaveBeenCalled()
  })
  it('H58 vault denial always returns denied even with fail-on-denial off and closes session', async () => {
    const h = execHarness(['--vault'])
    const close = vi.fn(() => Promise.resolve())
    const open = vi.fn((context: ExecVaultContext) => {
      expect(context).toMatchObject({ cwd: process.cwd(), source: 'headless', unattended: true })
      h.onTurn(() => {
        context.onDenied('test-secret needs unattended grant')
        return false
      })
      return Promise.resolve({ close })
    })
    const deps = { ...h.deps, vault: { open } }
    try {
      expect(deps.options.failOnDenial).toBe(false)
      expect(await runExec(h.life, deps)).toBe(EXEC_EXIT.denied)
      expect(close).toHaveBeenCalledOnce()
      // Real backend/tree stop is an integration handoff (PLAN §7); this port must always close.
    } finally {
      h.life.dispose()
    }
  })
  it('H59 failed vault setup denies before prompt; late setup closes after cancellation', async () => {
    const h = execHarness(['--vault'])
    try {
      expect(
        await runExec(h.life, {
          ...h.deps,
          vault: { open: () => Promise.reject(new Error('private-canary')) },
        }),
      ).toBe(EXEC_EXIT.denied)
      expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
    } finally {
      h.life.dispose()
    }
  })
  it('H59b setup arriving after cancellation closes its own session and never sends a prompt', async () => {
    const h = execHarness(['--vault'])
    const held = Promise.withResolvers<{ close(): Promise<void> }>()
    const close = vi.fn(() => Promise.resolve())
    const open = vi.fn(() => held.promise)
    const running = runExec(h.life, { ...h.deps, vault: { open } })
    try {
      await until(() => open.mock.calls.length === 1)
      h.life.latch({ kind: 'signal', signal: 'SIGTERM' })
      expect(await running).toBe(EXEC_EXIT.sigterm)
      held.resolve({ close })
      await until(() => close.mock.calls.length === 1)
      expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
    } finally {
      held.resolve({ close })
      h.life.dispose()
    }
  })
  it('H59c cleanup failures expose only fixed words and cannot claim completion', async () => {
    const h = execHarness(['--vault'])
    const close = vi.fn(() => Promise.reject(new Error('private-canary')))
    try {
      expect(
        await runExec(h.life, { ...h.deps, vault: { open: () => Promise.resolve({ close }) } }),
      ).toBe(EXEC_EXIT.internal)
      expect(JSON.stringify(h.deps.stderr)).not.toContain('private-canary')
    } finally {
      h.life.dispose()
    }
  })
  it('H60 denial from a finished port is ignored during final cleanup', async () => {
    const h = execHarness(['--vault'])
    try {
      expect(await runExec(h.life, { ...h.deps, vault: { open: finishedPort } })).toBe(0)
    } finally {
      h.life.dispose()
    }
  })
})
