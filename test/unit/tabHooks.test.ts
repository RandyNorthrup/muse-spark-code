import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import {
  createTabHooks,
  type TabHookContext,
  type TabHookEdit,
  type TabHookRun,
  type TabHookState,
  type TabHooksDeps,
} from '../../src/core/tab/tabHooks'
import type { ShellResult } from '../../src/core/shellResult'
import {
  HOOK_OUTPUT_MAX_BYTES,
  HOOK_STDIN_MAX_BYTES,
  HOOK_TOOL_VALUE_PREVIEW_CHARS,
  TAB_EDIT_HOOK_QUEUE,
  TAB_HOOK_TIMEOUT_MS,
  TAB_HOOK_VERDICT_CACHE,
} from '../../src/shared/constants'

const CONTEXT: TabHookContext = {
  workspaceRoots: ['/workspace', '/second'],
  model: 'muse-spark-1.3',
  generationId: 'generation-1',
}
const EDIT: TabHookEdit = {
  filePath: '/workspace/a.ts',
  oldString: '',
  newString: 'value()',
  oldLine: 'const result = ',
  newLine: 'const result = value()',
  range: { startLineNumber: 10, startColumn: 16, endLineNumber: 10, endColumn: 16 },
  acceptance: 'full',
}

function result(overrides: Partial<ShellResult> = {}): ShellResult {
  return {
    stdout: '{"permission":"allow"}',
    stderr: '',
    exitCode: 0,
    isTimedOut: false,
    isCancelled: false,
    ...overrides,
  }
}

function harness(options: Partial<TabHooksDeps> = {}) {
  const run = vi.fn<TabHooksDeps['run']>().mockResolvedValue([result()])
  const log = vi.fn<(message: string) => void>()
  const configurationVersion = vi.fn(() => 'config-1')
  const isWorkspaceTrusted = vi.fn(() => true)
  const isHooksEnabled = vi.fn(() => true)
  const hooks = createTabHooks({
    run,
    log,
    configurationVersion,
    isWorkspaceTrusted,
    isHooksEnabled,
    ...options,
  })
  return { hooks, run, log, configurationVersion, isWorkspaceTrusted, isHooksEnabled }
}

function payloadOf(request: TabHookRun | undefined): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).parse(JSON.parse(request?.stdin ?? 'null'))
}

describe('beforeTabFileRead', () => {
  it.each(['dispose', 'trust revoked'])(
    'refuses %s while loading an empty hook snapshot',
    async (change) => {
      const loading = Promise.withResolvers<TabHookState>()
      const h = harness({ hookState: () => loading.promise })
      const pending = h.hooks.beforeRead(EDIT.filePath, 'text', CONTEXT)
      if (change === 'dispose') h.hooks.dispose()
      else h.isWorkspaceTrusted.mockReturnValue(false)
      loading.resolve('absent')
      expect(await pending).toBe(false)
      expect(h.run).not.toHaveBeenCalled()
    },
  )

  it('refuses every read while a configured hook file did not load whole (RVM94KR 1)', async () => {
    const h = harness({ hookState: () => Promise.resolve('invalid') })
    expect(await h.hooks.beforeRead(EDIT.filePath, 'text', CONTEXT)).toBe(false)
    expect(await h.hooks.beforeRead('/workspace/other.ts', '', CONTEXT)).toBe(false)
    expect(h.run).not.toHaveBeenCalled()
    expect(h.log).toHaveBeenCalledWith(
      'beforeTabFileRead: hook configuration invalid; read refused',
    )
    expect(await h.hooks.bindPolicy()).toMatchObject({ isConfigurationInvalid: true })
  })

  it('reads unguarded only with no Tab hook configured, and refuses without a dispatcher', async () => {
    const state = vi.fn<NonNullable<TabHooksDeps['hookState']>>().mockResolvedValue('absent')
    const h = harness({ hookState: state })
    expect(await h.hooks.beforeRead(EDIT.filePath, 'text', CONTEXT)).toBe(true)
    expect(h.run).not.toHaveBeenCalled()
    state.mockResolvedValue('present')
    h.run.mockResolvedValue([result({ stdout: '{"permission":"deny"}' })])
    expect(await h.hooks.beforeRead(EDIT.filePath, 'text', CONTEXT)).toBe(false)
    expect(h.run).toHaveBeenCalledOnce()
    state.mockRejectedValue(new Error('/private/bundle/path'))
    expect(await h.hooks.beforeRead(EDIT.filePath, 'other', CONTEXT)).toBe(false)
    expect(await h.hooks.bindPolicy()).toMatchObject({ isConfigurationInvalid: false })
    expect(h.log.mock.calls.flat().join(' ')).not.toContain('/private/bundle/path')
  })

  it('binds a request to the settled configuration, trust and opt-in (RVM94KR 2)', async () => {
    const loading = Promise.withResolvers<TabHookState>()
    const h = harness({ hookState: () => loading.promise })
    const settled = vi.fn()
    const binding = (async () => {
      const policy = await h.hooks.bindPolicy()
      settled()
      return policy
    })()
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    loading.resolve('present')
    const { key, isConfigurationInvalid } = await binding
    expect(isConfigurationInvalid).toBe(false)
    expect(h.hooks.policyKey()).toBe(key)
    h.configurationVersion.mockReturnValue('config-2')
    expect(h.hooks.policyKey()).not.toBe(key)
    h.configurationVersion.mockReturnValue('config-1')
    h.isHooksEnabled.mockReturnValue(false)
    expect(h.hooks.policyKey()).not.toBe(key)
    h.isHooksEnabled.mockReturnValue(true)
    h.isWorkspaceTrusted.mockReturnValue(false)
    expect(h.hooks.policyKey()).not.toBe(key)
    h.isWorkspaceTrusted.mockReturnValue(true)
    expect(h.hooks.policyKey()).toBe(key)
    h.hooks.dispose()
    expect(h.hooks.policyKey()).not.toBe(key)
  })

  it('binds without loading hooks while they are off', async () => {
    const state = vi.fn<NonNullable<TabHooksDeps['hookState']>>().mockResolvedValue('invalid')
    const h = harness({ hookState: state, isHooksEnabled: () => false })
    expect(await h.hooks.bindPolicy()).toMatchObject({ isConfigurationInvalid: false })
    expect(state).not.toHaveBeenCalled()
  })

  it('sends full unredacted local text and the request envelope with TabRead and a timeout cap', async () => {
    const h = harness()
    const content = 'const account = "local text";\n// λ\n'
    expect(await h.hooks.beforeRead(EDIT.filePath, content, CONTEXT)).toBe(true)
    expect(payloadOf(h.run.mock.calls[0]?.[0])).toEqual({
      hook_event_name: 'beforeTabFileRead',
      file_path: EDIT.filePath,
      content,
      workspace_roots: CONTEXT.workspaceRoots,
      model: CONTEXT.model,
      generation_id: CONTEXT.generationId,
    })
    expect(h.run.mock.calls[0]?.[0]).toMatchObject({
      matcherValue: 'TabRead',
      maxTimeoutMs: TAB_HOOK_TIMEOUT_MS,
    })
  })

  it.each([
    ['deny', { stdout: '{"permission":"deny"}' }],
    ['exit 2', { exitCode: 2 }],
    ['nonzero exit', { exitCode: 1 }],
    ['crash', { exitCode: null }],
    ['timeout', { isTimedOut: true }],
    ['cancelled', { isCancelled: true }],
    ['invalid JSON', { stdout: '{' }],
    ['schema mismatch', { stdout: '{"permission":"ask"}' }],
    ['grant with extra field', { stdout: '{"permission":"allow","updated_input":{}}' }],
    ['no answer', { stdout: '' }],
    ['output exceeded', { isOutputTooLarge: true }],
    [
      'stdout bytes exceeded',
      { stdout: ' '.repeat(HOOK_OUTPUT_MAX_BYTES) + '{"permission":"allow"}' },
    ],
    ['stderr bytes exceeded', { stderr: 'é'.repeat(HOOK_OUTPUT_MAX_BYTES) }],
  ] satisfies readonly (readonly [string, Partial<ShellResult>])[])(
    'fails closed on %s',
    async (_name, ending) => {
      const h = harness()
      h.run.mockResolvedValue([result(ending)])
      expect(await h.hooks.beforeRead(EDIT.filePath, 'text', CONTEXT)).toBe(false)
    },
  )

  it('fails closed on a missing dispatcher or its exception; an empty selection allows', async () => {
    const h = harness()
    h.run
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('/private/path code'))
      .mockResolvedValueOnce([])
    expect(await h.hooks.beforeRead(EDIT.filePath, 'a', CONTEXT)).toBe(false)
    expect(await h.hooks.beforeRead(EDIT.filePath, 'b', CONTEXT)).toBe(false)
    expect(await h.hooks.beforeRead(EDIT.filePath, 'c', CONTEXT)).toBe(true)
    expect(h.log.mock.calls.flat().join(' ')).not.toContain('/private/path')
  })

  it('requires every selected guard to allow', async () => {
    const h = harness()
    h.run.mockResolvedValue([result(), result({ stdout: '{"permission":"deny"}' })])
    expect(await h.hooks.beforeRead(EDIT.filePath, 'text', CONTEXT)).toBe(false)
  })

  it('refuses an oversize UTF-8 payload without running it, including its envelope', async () => {
    const h = harness()
    expect(
      await h.hooks.beforeRead(EDIT.filePath, 'é'.repeat(HOOK_STDIN_MAX_BYTES / 2), CONTEXT),
    ).toBe(false)
    expect(h.run).not.toHaveBeenCalled()
    const probe = harness()
    await probe.hooks.beforeRead(EDIT.filePath, '', CONTEXT)
    const overhead = Buffer.byteLength(probe.run.mock.calls[0]?.[0].stdin ?? '')
    expect(
      await h.hooks.beforeRead(EDIT.filePath, 'x'.repeat(HOOK_STDIN_MAX_BYTES - overhead), CONTEXT),
    ).toBe(true)
    expect(
      await h.hooks.beforeRead(
        EDIT.filePath,
        'x'.repeat(HOOK_STDIN_MAX_BYTES - overhead + 1),
        CONTEXT,
      ),
    ).toBe(false)
    expect(h.run).toHaveBeenCalledOnce()
  })

  it('caches allow and deny by path and content digest with no age-based expiry', async () => {
    const h = harness()
    h.run.mockResolvedValueOnce([result({ stdout: '{"permission":"deny"}' })])
    for (const _attempt of [0, 1])
      expect(await h.hooks.beforeRead(EDIT.filePath, 'a', CONTEXT)).toBe(false)
    expect(await h.hooks.beforeRead(EDIT.filePath, 'b', CONTEXT)).toBe(true)
    expect(
      await h.hooks.beforeRead(EDIT.filePath, 'b', { ...CONTEXT, generationId: 'later' }),
    ).toBe(true)
    expect(await h.hooks.beforeRead('/workspace/b.ts', 'b', CONTEXT)).toBe(true)
    expect(h.run).toHaveBeenCalledTimes(3)
  })

  it('clears verdicts on a configuration change', async () => {
    const h = harness()
    await h.hooks.beforeRead(EDIT.filePath, 'text', CONTEXT)
    h.configurationVersion.mockReturnValue('config-2')
    h.run.mockResolvedValue([result({ stdout: '{"permission":"deny"}' })])
    expect(await h.hooks.beforeRead(EDIT.filePath, 'text', CONTEXT)).toBe(false)
    expect(h.run).toHaveBeenCalledTimes(2)
    h.configurationVersion.mockReturnValue('config-3')
    h.run.mockResolvedValue([result()])
    expect(await h.hooks.beforeRead(EDIT.filePath, 'text', CONTEXT)).toBe(true)
  })

  it('coalesces concurrent reads and refuses stale in-flight verdicts', async () => {
    const h = harness()
    const ending = Promise.withResolvers<readonly ShellResult[]>()
    h.run.mockReturnValueOnce(ending.promise)
    const first = h.hooks.beforeRead(EDIT.filePath, 'text', CONTEXT)
    const same = h.hooks.beforeRead(EDIT.filePath, 'text', CONTEXT)
    expect(h.run).toHaveBeenCalledOnce()
    h.configurationVersion.mockReturnValue('config-2')
    const fresh = h.hooks.beforeRead(EDIT.filePath, 'text', CONTEXT)
    expect(h.run).toHaveBeenCalledTimes(2)
    ending.resolve([result()])
    expect(await fresh).toBe(true)
    expect(await first).toBe(false)
    expect(await same).toBe(false)
    expect(await h.hooks.beforeRead(EDIT.filePath, 'text', CONTEXT)).toBe(true)
    expect(h.run).toHaveBeenCalledTimes(2)
  })

  it('bounds the LRU and refreshes a hit before evicting the oldest verdict', async () => {
    const h = harness()
    for (let index = 0; index < TAB_HOOK_VERDICT_CACHE; index += 1) {
      await h.hooks.beforeRead(EDIT.filePath, String(index), CONTEXT)
    }
    await h.hooks.beforeRead(EDIT.filePath, '0', CONTEXT)
    await h.hooks.beforeRead(EDIT.filePath, 'extra', CONTEXT)
    await h.hooks.beforeRead(EDIT.filePath, '0', CONTEXT)
    expect(h.run).toHaveBeenCalledTimes(TAB_HOOK_VERDICT_CACHE + 1)
    await h.hooks.beforeRead(EDIT.filePath, '1', CONTEXT)
    expect(h.run).toHaveBeenCalledTimes(TAB_HOOK_VERDICT_CACHE + 2)
  })

  it('rechecks trust and enablement before cached verdicts and after an in-flight read', async () => {
    const h = harness()
    await h.hooks.beforeRead(EDIT.filePath, 'text', CONTEXT)
    h.isWorkspaceTrusted.mockReturnValue(false)
    expect(await h.hooks.beforeRead(EDIT.filePath, 'text', CONTEXT)).toBe(false)
    h.isWorkspaceTrusted.mockReturnValue(true)
    h.isHooksEnabled.mockReturnValue(false)
    expect(await h.hooks.beforeRead(EDIT.filePath, 'text', CONTEXT)).toBe(true)
    expect(h.run).toHaveBeenCalledOnce()
    h.isHooksEnabled.mockReturnValue(true)
    const ending = Promise.withResolvers<readonly ShellResult[]>()
    h.run.mockReturnValueOnce(ending.promise)
    const pending = h.hooks.beforeRead(EDIT.filePath, 'changed', CONTEXT)
    h.isWorkspaceTrusted.mockReturnValue(false)
    ending.resolve([result()])
    expect(await pending).toBe(false)
  })
})

describe('afterTabFileEdit', () => {
  it.each(['full', 'partial'] as const)(
    'sends the saved shape for a %s accept, with line text and 1-based range',
    async (acceptance) => {
      const h = harness()
      h.hooks.afterEdit({ ...EDIT, acceptance }, CONTEXT)
      await vi.waitFor(() => {
        expect(h.log).toHaveBeenCalled()
      })
      expect(payloadOf(h.run.mock.calls[0]?.[0])).toEqual({
        hook_event_name: 'afterTabFileEdit',
        file_path: EDIT.filePath,
        workspace_roots: CONTEXT.workspaceRoots,
        model: CONTEXT.model,
        generation_id: CONTEXT.generationId,
        edits: [
          {
            old_string: EDIT.oldString,
            new_string: EDIT.newString,
            old_line: EDIT.oldLine,
            new_line: EDIT.newLine,
            range: { start_line_number: 10, start_column: 16, end_line_number: 10, end_column: 16 },
            ...(acceptance === 'partial' && { inferred: true }),
          },
        ],
      })
      expect(h.run.mock.calls[0]?.[0]).toMatchObject({ matcherValue: 'TabWrite' })
    },
  )

  it('never fires afterTabFileEdit on ordinary typing', () => {
    const h = harness()
    h.hooks.afterEdit({ ...EDIT, acceptance: 'typing' }, CONTEXT)
    expect(h.run).not.toHaveBeenCalled()
  })

  it('caps all four strings and counts the omitted characters', async () => {
    const h = harness()
    const text = 'x'.repeat(HOOK_TOOL_VALUE_PREVIEW_CHARS + 1)
    h.hooks.afterEdit(
      { ...EDIT, oldString: text, newString: text, oldLine: text, newLine: text },
      CONTEXT,
    )
    await vi.waitFor(() => {
      expect(h.log).toHaveBeenCalledTimes(2)
    })
    const edits = z
      .array(z.record(z.string(), z.unknown()))
      .parse(payloadOf(h.run.mock.calls[0]?.[0])['edits'])
    for (const key of ['old_string', 'new_string', 'old_line', 'new_line']) {
      expect(edits[0]?.[key]).toBe('x'.repeat(HOOK_TOOL_VALUE_PREVIEW_CHARS))
    }
    expect(h.log).toHaveBeenCalledWith('afterTabFileEdit: preview omitted 4 characters')
  })

  it('never blocks on hook output or exceptions and logs only status and counts', async () => {
    const h = harness()
    const raw = '/private/source.ts: secret code'
    h.run
      .mockResolvedValueOnce([result({ exitCode: 2, stdout: raw, stderr: raw })])
      .mockRejectedValueOnce(new Error(raw))
    h.hooks.afterEdit(EDIT, CONTEXT)
    h.hooks.afterEdit(EDIT, CONTEXT)
    await vi.waitFor(() => {
      expect(h.log).toHaveBeenCalledTimes(2)
    })
    expect(h.run).toHaveBeenCalledTimes(2)
    expect(h.log.mock.calls.flat().join(' ')).not.toContain(raw)
    expect(h.log).toHaveBeenCalledWith('afterTabFileEdit: hook failed')
  })

  it('bounds waiting edits, drops the oldest and keeps the running edit', async () => {
    const h = harness()
    const ending = Promise.withResolvers<readonly ShellResult[]>()
    h.run.mockReturnValueOnce(ending.promise)
    for (let index = 0; index < TAB_EDIT_HOOK_QUEUE + 2; index += 1) {
      h.hooks.afterEdit(EDIT, { ...CONTEXT, generationId: String(index) })
    }
    expect(h.run).toHaveBeenCalledOnce()
    expect(h.log).toHaveBeenCalledWith('afterTabFileEdit: oldest waiting edit dropped')
    ending.resolve([result()])
    await vi.waitFor(() => {
      expect(h.run).toHaveBeenCalledTimes(TAB_EDIT_HOOK_QUEUE + 1)
    })
    const ids = h.run.mock.calls.map(([request]) => payloadOf(request)['generation_id'])
    expect(ids).toEqual([
      '0',
      ...Array.from({ length: TAB_EDIT_HOOK_QUEUE }, (_, index) => String(index + 2)),
    ])
  })

  it('drops waiting observations on configuration change and resumes with the new snapshot', async () => {
    const h = harness()
    const ending = Promise.withResolvers<readonly ShellResult[]>()
    h.run.mockReturnValueOnce(ending.promise)
    h.hooks.afterEdit(EDIT, CONTEXT)
    h.hooks.afterEdit(EDIT, { ...CONTEXT, generationId: 'stale' })
    h.configurationVersion.mockReturnValue('config-2')
    h.hooks.afterEdit(EDIT, { ...CONTEXT, generationId: 'fresh' })
    ending.resolve([result()])
    await vi.waitFor(() => {
      expect(h.run).toHaveBeenCalledTimes(2)
    })
    expect(payloadOf(h.run.mock.calls[1]?.[0])['generation_id']).toBe('fresh')
  })

  it('refuses waiting edits when trust is revoked or the snapshot changes without a new event', async () => {
    for (const change of ['trust', 'config'] as const) {
      const h = harness()
      const ending = Promise.withResolvers<readonly ShellResult[]>()
      h.run.mockReturnValueOnce(ending.promise)
      h.hooks.afterEdit(EDIT, CONTEXT)
      h.hooks.afterEdit(EDIT, CONTEXT)
      if (change === 'trust') h.isWorkspaceTrusted.mockReturnValue(false)
      else h.configurationVersion.mockReturnValue('config-2')
      ending.resolve([result()])
      await vi.waitFor(() => {
        expect(h.log).toHaveBeenCalledOnce()
      })
      expect(h.run).toHaveBeenCalledOnce()
    }
  })

  it('does not dispatch an oversize edit envelope', () => {
    const h = harness()
    h.hooks.afterEdit(EDIT, { ...CONTEXT, generationId: 'x'.repeat(HOOK_STDIN_MAX_BYTES) })
    expect(h.run).not.toHaveBeenCalled()
  })

  it('does not run while untrusted or disabled, and disposal clears waiting work', async () => {
    const h = harness()
    h.isWorkspaceTrusted.mockReturnValue(false)
    h.hooks.afterEdit(EDIT, CONTEXT)
    h.isWorkspaceTrusted.mockReturnValue(true)
    h.isHooksEnabled.mockReturnValue(false)
    h.hooks.afterEdit(EDIT, CONTEXT)
    expect(h.run).not.toHaveBeenCalled()
    h.isHooksEnabled.mockReturnValue(true)
    const ending = Promise.withResolvers<readonly ShellResult[]>()
    h.run.mockReturnValueOnce(ending.promise)
    h.hooks.afterEdit(EDIT, CONTEXT)
    h.hooks.afterEdit(EDIT, CONTEXT)
    h.hooks.dispose()
    ending.resolve([result()])
    await vi.waitFor(() => {
      expect(h.log).toHaveBeenCalledOnce()
    })
    h.hooks.afterEdit(EDIT, CONTEXT)
    expect(await h.hooks.beforeRead(EDIT.filePath, 'text', CONTEXT)).toBe(false)
    expect(h.run).toHaveBeenCalledOnce()
  })
})
