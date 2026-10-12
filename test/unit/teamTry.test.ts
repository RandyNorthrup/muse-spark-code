import { beforeAll, describe, expect, it, vi } from 'vitest'
import { tryTeam, teamTryConfirmation } from '../../src/core/team/teamTry'
import { ModelApiBackendManager } from '../../src/host/backend/modelApiBackendManager'
import * as entry from '../../src/host/backend/modelApiEntry'
import { fakeManagerDeps } from './helpers/modelApiManager'
import { fakeModelApi, type ScriptedReply } from './helpers/fakeModelApi'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memoryToolIo } from './helpers/fakeToolIo'
import { Usd } from '../../src/shared/usd'
import type { TeamEditorDocument } from '../../src/shared/teamPanel'
import {
  TEAM_TRY_MAX_OUTPUT_TOKENS,
  TEAM_TRY_MAX_INPUT_TOKENS,
  TEAM_TRY_MAX_REQUESTS,
  UI_TEXT,
} from '../../src/shared/constants'
import { panelRig } from './helpers/teamPanelRig'

beforeAll(async () => {
  await import('../../src/core/team/teamEntry')
})
const document: TeamEditorDocument = { roles: [], intensity: 'balanced', template: 'custom' }
const workspaceRoot = '/workspace'
function rig(replies: ScriptedReply[] = []) {
  const api = fakeModelApi()
  api.script(...replies)
  const io = memoryToolIo({ 'tracked.txt': 'before' }, workspaceRoot)
  const manager = new ModelApiBackendManager(
    fakeManagerDeps(api, new FakeLogOutputChannel(), {
      workspaceRoot,
      bundlePath: 'unused',
      loadBundle: () => entry,
      io,
    }),
  )
  let isAllowed = true
  const settlements: { actual: string; uncertain?: boolean | undefined }[] = []
  const maxima: string[] = []
  const consent = vi.fn(() => Promise.resolve(true))
  let accountId: string | undefined = 'key-a'
  const keyDigest = vi.fn(() => Promise.resolve(accountId))
  const deps = {
    isAllowed: () => isAllowed,
    noteDispatched: vi.fn(),
    noteUsage: vi.fn(),
    modelId: 'muse-spark-1.3',
    workspaceRoot,
    keyDigest,
    consent,
    reserve: vi.fn((maximum: string) => {
      maxima.push(maximum)
      return Promise.resolve({
        check: () => {
          if (!isAllowed) throw new Error('revoked')
        },
        settle: (actual: string, isUncertain?: boolean) => {
          settlements.push({ actual, uncertain: isUncertain })
          return Promise.resolve()
        },
      })
    }),
    start: (guard: Parameters<ModelApiBackendManager['buildTeamTryHost']>[1]) =>
      manager.buildTeamTryHost(workspaceRoot, guard),
  }
  return {
    api,
    io,
    manager,
    deps,
    consent,
    keyDigest,
    settlements,
    maxima,
    revoke: () => {
      isAllowed = false
    },
    replaceKey: (next: string | undefined) => {
      accountId = next
    },
  }
}

describe('paid team planning preview', () => {
  it('carries an output cap into the actual request and rejects an invalid cap', async () => {
    const t = rig([{ text: 'capped answer', usage: { input: 12, output: 3 } }])
    try {
      const host = await t.manager.ensureHost()
      const session = await host.startSession({
        workspaceRoot,
        modelId: 'muse-spark-1.3',
        approvalMode: 'denyUnmatched',
      })
      if (session.setOutputCap === undefined) throw new Error('Missing Model API output cap')
      await expect(session.setOutputCap(0)).rejects.toThrow()
      await session.setOutputCap(128)
      await session.setReasoningEffort('high')
      await session.sendTurn([{ type: 'text', text: 'short answer' }], 'short answer')
      await vi.waitFor(() => {
        expect(t.api.requests.find((row) => row.path.endsWith('/responses'))?.body).toMatchObject({
          max_output_tokens: 128,
          reasoning: { effort: 'high' },
        })
      })
    } finally {
      await t.manager.dispose()
    }
  })
  it('refuses an unserved effort and an above-maximum cap instead of adjusting them', async () => {
    const t = rig()
    try {
      const host = await t.manager.ensureHost()
      const session = await host.startSession({
        workspaceRoot,
        modelId: 'muse-spark-1.2',
        approvalMode: 'denyUnmatched',
      })
      // muse-spark-1.2 serves up to xhigh: max refuses instead of becoming none.
      await expect(session.setReasoningEffort('max')).rejects.toThrow(
        /effort.*max.*muse-spark-1\.2/,
      )
      await session.setReasoningEffort('none')
      if (session.setOutputCap === undefined) throw new Error('Missing Model API output cap')
      await expect(session.setOutputCap(Number.MAX_SAFE_INTEGER)).rejects.toThrow(/outputCap/)
    } finally {
      await t.manager.dispose()
    }
  })
  it('refuses input beyond the quoted token ceiling before billed dispatch', async () => {
    const t = rig([{ text: 'unaffordable', usage: { input: 12, output: 3 } }])
    const oversized: TeamEditorDocument = {
      ...document,
      roles: [
        {
          role: 'custom',
          workspace: 'read-only',
          tools: ['read', 'report'],
          report: 'summary',
          pool: [],
          custom: true,
          purpose: 'Audit',
          guidance: 'x'.repeat(TEAM_TRY_MAX_INPUT_TOKENS * 8),
        },
      ],
    }
    try {
      const result = await tryTeam(t.deps, oversized, 'feature-tests', new AbortController().signal)
      expect(result).toContain('0 attempts')
      expect(t.maxima).toEqual([])
      expect(t.api.requests.filter((row) => row.path.endsWith('/responses'))).toEqual([])
    } finally {
      await t.manager.dispose()
    }
  })
  it('asks once before either retry and settles each exact transport attempt', async () => {
    const t = rig([
      { httpError: { status: 503 } },
      { text: 'Plan engineering, then review.', usage: { input: 12, output: 3 } },
    ])
    try {
      const result = await tryTeam(t.deps, document, 'feature-tests', new AbortController().signal)
      expect(t.consent).toHaveBeenCalledOnce()
      expect(t.maxima).toHaveLength(2)
      expect(t.settlements).toHaveLength(2)
      expect(t.settlements[0]).toEqual({ actual: t.maxima[0], uncertain: true })
      expect(Usd.from(t.settlements[1]?.actual ?? '0').compare(Usd.from(0))).toBe(1)
      expect(result).toContain('2 attempts')
      expect(result).toContain('Plan engineering')
      const requests = t.api.requests.filter((row) => row.path.endsWith('/responses'))
      expect(requests).toHaveLength(2)
      for (const request of requests)
        expect(request.body).toMatchObject({
          tools: [],
          max_output_tokens: TEAM_TRY_MAX_OUTPUT_TOKENS,
        })
    } finally {
      await t.manager.dispose()
    }
  })
  it('never starts or reserves after denied consent', async () => {
    const t = rig()
    t.consent.mockResolvedValue(false)
    try {
      await expect(
        tryTeam(t.deps, document, 'feature-tests', new AbortController().signal),
      ).rejects.toThrow(UI_TEXT.teamTryDenied)
      expect(t.maxima).toEqual([])
      expect(t.api.requests).toEqual([])
    } finally {
      await t.manager.dispose()
    }
  })
  it('voids the approval when the stored key changes during consent', async () => {
    const t = rig([{ text: 'Plan engineering.', usage: { input: 12, output: 3 } }])
    t.consent.mockImplementation(() => {
      // The stored key is replaced while the popup is open: the quoted
      // account no longer pays, so the approval must not spend on the new one.
      t.replaceKey('key-b')
      return Promise.resolve(true)
    })
    try {
      await expect(
        tryTeam(t.deps, document, 'feature-tests', new AbortController().signal),
      ).rejects.toThrow(UI_TEXT.teamTryDenied)
      expect(t.maxima).toEqual([])
      expect(t.api.requests).toEqual([])
      expect(t.deps.noteDispatched).not.toHaveBeenCalled()
    } finally {
      await t.manager.dispose()
    }
  })
  // P2-3: the quoted account travels into final admission. A credential
  // replaced while the preview host initialises sends nothing: no session,
  // no reserve, no dispatch.
  it('voids the approval when the stored key changes while the preview host starts', async () => {
    const t = rig([{ text: 'Plan engineering.', usage: { input: 12, output: 3 } }])
    const realStart = t.deps.start
    t.deps.start = (guard) => {
      // The independent host adopts the replacement account while starting.
      t.replaceKey('key-b')
      return realStart(guard)
    }
    try {
      await expect(
        tryTeam(t.deps, document, 'feature-tests', new AbortController().signal),
      ).rejects.toThrow(UI_TEXT.teamTryDenied)
      expect(t.maxima).toEqual([])
      expect(t.api.requests.filter((row) => row.path.endsWith('/responses'))).toEqual([])
      expect(t.deps.noteDispatched).not.toHaveBeenCalled()
    } finally {
      await t.manager.dispose()
    }
  })
  it('rechecks the gate after the consent popup', async () => {
    const t = rig()
    t.consent.mockImplementation(() => {
      t.revoke()
      return Promise.resolve(true)
    })
    try {
      await expect(
        tryTeam(t.deps, document, 'feature-tests', new AbortController().signal),
      ).rejects.toThrow()
      expect(t.maxima).toEqual([])
      expect(t.api.requests).toEqual([])
    } finally {
      await t.manager.dispose()
    }
  })
  it('keeps ambiguous attempt liability instead of reporting a free success', async () => {
    const t = rig([{ text: 'Partial plan', malformedTerminal: true }])
    try {
      const result = await tryTeam(t.deps, document, 'feature-tests', new AbortController().signal)
      expect(
        t.settlements.some(
          (row) => row.uncertain === true && Usd.from(row.actual).compare(Usd.from(0)) === 1,
        ),
      ).toBe(true)
      expect(result).toContain('retained liability')
    } finally {
      await t.manager.dispose()
    }
  })
  it('refuses the fourth attempt before dispatch under the preview ceiling', async () => {
    const t = rig(
      Array.from({ length: TEAM_TRY_MAX_REQUESTS + 1 }, () => ({ httpError: { status: 503 } })),
    )
    try {
      await tryTeam(t.deps, document, 'feature-tests', new AbortController().signal)
      expect(t.maxima).toHaveLength(TEAM_TRY_MAX_REQUESTS)
      expect(t.api.requests.filter((row) => row.path.endsWith('/responses'))).toHaveLength(
        TEAM_TRY_MAX_REQUESTS,
      )
    } finally {
      await t.manager.dispose()
    }
  })
  it('refuses a model calling an undeclared file tool by name', async () => {
    const t = rig([
      {
        calls: [
          {
            name: 'edit_file',
            arguments: '{"path":"tracked.txt","find":"before","replace":"breach"}',
          },
        ],
      },
      { text: 'Cannot execute work.' },
    ])
    try {
      await tryTeam(t.deps, document, 'feature-tests', new AbortController().signal)
      expect(await t.io.readFile('/workspace/tracked.txt')).toBe('before')
      expect(
        t.api.requests.filter((row) => row.path.endsWith('/responses')).length,
      ).toBeGreaterThan(0)
    } finally {
      await t.manager.dispose()
    }
  })
  it('enforces the host restriction in Bypass, independent of Plan-mode permissions', async () => {
    const t = rig([
      {
        calls: [
          {
            name: 'edit_file',
            arguments: '{"path":"tracked.txt","find":"before","replace":"breach"}',
          },
        ],
      },
      { text: 'Refused.' },
    ])
    const host = await t.manager.buildTeamTryHost(workspaceRoot, () => undefined)
    try {
      const session = await host.startSession({
        workspaceRoot,
        modelId: 'muse-spark-1.3',
        approvalMode: 'allowAll',
      })
      const completed = Promise.withResolvers<undefined>()
      const off = session.onEvent((event) => {
        if (event.type === 'turnCompleted') completed.resolve(undefined)
      })
      await session.sendTurn([{ type: 'text', text: 'Attempt an edit.' }])
      await completed.promise
      off()
      expect(await t.io.readFile('/workspace/tracked.txt')).toBe('before')
    } finally {
      await host.close()
      await t.manager.dispose()
    }
  })
  it('freezes the draft before consent rather than sending later edits', async () => {
    const t = rig([{ text: 'Plan only.' }])
    const draft: TeamEditorDocument = {
      ...document,
      roles: [{ role: 'audit', purpose: 'Original charter', pool: [] }],
    }
    t.consent.mockImplementation(() => {
      const role = draft.roles[0]
      if (role !== undefined) role.purpose = 'Later edit'
      return Promise.resolve(true)
    })
    try {
      await tryTeam(t.deps, draft, 'feature-tests', new AbortController().signal)
      const body = JSON.stringify(
        t.api.requests.find((row) => row.path.endsWith('/responses'))?.body,
      )
      expect(body).toContain('Original charter')
      expect(body).not.toContain('Later edit')
    } finally {
      await t.manager.dispose()
    }
  })
  it('quotes a configured provider tariff and refuses unknown price', () => {
    const base = {
      modelId: 'vendor/model',
      providerId: 'vendor',
      displayLabel: 'Model',
      isActive: false,
      isDefault: false,
      contextLimit: undefined,
    }
    expect(
      teamTryConfirmation({ ...base, inputUsdPerMTokens: 2, outputUsdPerMTokens: 3 }),
    ).toMatchObject({ provider: 'vendor', rates: { input: 2, output: 3 } })
    expect(() => teamTryConfirmation(base)).toThrow()
  })
  it('does not offer Try without a port and aborts an active preview when its panel closes', async () => {
    const absent = panelRig()
    const absentSlice = await absent.read()
    expect(absentSlice.dryRunCost).toBeUndefined()
    let signal: AbortSignal | undefined
    const gate = Promise.withResolvers<undefined>()
    const t = panelRig({
      dryRun: {
        cost: () => 'quoted',
        run: (_doc, _sample, current) => {
          signal = current
          return gate.promise
        },
      },
    })
    await t.read()
    await t.controller.handle({ type: 'roles/template', template: 'pair' })
    const pending = t.controller.handle({ type: 'roles/try' })
    await vi.waitFor(() => {
      expect(signal).toBeDefined()
    })
    t.controller.dispose()
    expect(signal?.aborted).toBe(true)
    gate.resolve(undefined)
    await expect(pending).rejects.toThrow()
  })
})
