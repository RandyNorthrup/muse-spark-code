import { describe, expect, it, vi } from 'vitest'
import {
  invokeNativePromptMenu,
  nativePromptMenus,
  type NativePromptPorts,
} from '../../src/runtime/sharing/bridge'
import { PROMPT_COMMAND_IDS, UI_TEXT } from '../../src/shared/constants'
import { until } from './helpers/acpWaits'

const MESSAGE = {
  contextId: 'row-1',
  source: 'userMessage',
  sessionId: 's1',
  messageId: 'u1',
  role: 'user',
  own: true,
  text: 'Exact\r\ntext',
}
const COMPOSER = {
  contextId: 'composer-1',
  source: 'composer',
  text: 'Composer text',
  chatAvailable: true,
}
const SELECTION = { contextId: 'selection-1', source: 'editorSelection', text: 'Selected\ntext' }
const LOAD = { promptId: 'p1', scope: 'user', chat: 'active', action: 'insert', send: false }

function bridgeHarness(context: unknown = COMPOSER) {
  let current = context
  let isActive = true
  const abort = new AbortController()
  const ports: NativePromptPorts = {
    snapshot: () => current,
    isActive: () => isActive,
    signal: abort.signal,
    savePrompt: vi.fn(() => Promise.resolve()),
    choosePrompt: vi.fn(() => Promise.resolve(LOAD)),
    loadPrompt: vi.fn(() => Promise.resolve()),
  }
  return {
    ports,
    setContext: (value: unknown) => {
      current = value
    },
    setActive: (isCurrent: boolean) => {
      isActive = isCurrent
    },
    abort: () => {
      abort.abort()
    },
  }
}

describe('M118 native/companion menu adapter handoff', () => {
  it.each(['save', 'choose', 'load'] as const)(
    'aborts a pending native %s UI without resolving its promise',
    async (stage) => {
      const h = bridgeHarness()
      const pending = Promise.withResolvers<undefined>()
      const operation = {
        save: h.ports.savePrompt,
        choose: h.ports.choosePrompt,
        load: h.ports.loadPrompt,
      }[stage]
      const waiting = vi.fn(() => pending.promise)
      const ports = {
        ...h.ports,
        ...(stage === 'save' && { savePrompt: waiting }),
        ...(stage === 'choose' && { choosePrompt: waiting }),
        ...(stage === 'load' && { loadPrompt: waiting }),
      }
      let isSettled = false
      const response = (async () => {
        await invokeNativePromptMenu(
          {
            menuId: stage === 'save' ? 'prompt.save.composer' : 'prompt.use.composer',
            contextId: COMPOSER.contextId,
          },
          ports,
        )
        isSettled = true
      })()
      await until(() => waiting.mock.calls.length === 1)
      h.abort()
      await until(() => isSettled)
      await response
      expect(h.ports.signal.aborted).toBe(true)
      expect(operation).not.toHaveBeenCalled()
      if (stage === 'choose') expect(h.ports.loadPrompt).not.toHaveBeenCalled()
    },
  )
  it.each([
    { ...MESSAGE, sessionId: '' },
    { ...MESSAGE, messageId: '' },
    { ...MESSAGE, contextId: '' },
    { ...MESSAGE, own: 'true' },
    { ...COMPOSER, chatAvailable: 'true' },
    { ...SELECTION, text: 1 },
    { ...SELECTION, extra: 'unexpected' },
  ])('validates a native snapshot before constructing its menus: %j', (context) => {
    expect(() => nativePromptMenus(context)).toThrow()
  })
  it('rejects undeclared fields on the native invocation', async () => {
    const h = bridgeHarness()
    await expect(
      invokeNativePromptMenu(
        { menuId: 'prompt.use.composer', contextId: COMPOSER.contextId, send: true },
        h.ports,
      ),
    ).rejects.toThrow()
    expect(h.ports.choosePrompt).not.toHaveBeenCalled()
    expect(h.ports.loadPrompt).not.toHaveBeenCalled()
  })
  it('keeps the exact lane-0 menu ids, commands, scopes and installed-language labels', () => {
    expect(nativePromptMenus(MESSAGE)).toEqual([
      expect.objectContaining({
        id: 'prompt.save.message',
        command: PROMPT_COMMAND_IDS.save,
        label: UI_TEXT.promptSave,
        source: 'userMessage',
      }),
    ])
    expect(nativePromptMenus(COMPOSER).map((entry) => entry.id)).toEqual([
      'prompt.save.composer',
      'prompt.use.composer',
    ])
    expect(nativePromptMenus(SELECTION).map((entry) => entry.id)).toEqual(['prompt.save.selection'])
    expect(nativePromptMenus({ ...COMPOSER, text: '' }).map((entry) => entry.id)).toEqual([
      'prompt.use.composer',
    ])
  })
  it.each([
    { ...MESSAGE, role: 'assistant' },
    { ...MESSAGE, role: 'tool' },
    { ...MESSAGE, role: 'system' },
    { ...MESSAGE, own: false },
    { ...MESSAGE, text: ' ' },
  ])('hides Save on ineligible transcript sources: %j', (source) => {
    expect(nativePromptMenus(source)).toEqual([])
  })
  it.each([
    ['prompt.save.message', MESSAGE],
    ['prompt.save.composer', COMPOSER],
    ['prompt.save.selection', SELECTION],
  ])('saves the current exact snapshot for %s', async (menuId, context) => {
    const h = bridgeHarness(context)
    await invokeNativePromptMenu({ menuId, contextId: context.contextId }, h.ports)
    expect(h.ports.savePrompt).toHaveBeenCalledWith(context, h.ports.signal)
    expect(h.ports.loadPrompt).not.toHaveBeenCalled()
  })
  it('loads through the shared insert-only native/companion adapter port', async () => {
    const h = bridgeHarness()
    await invokeNativePromptMenu(
      { menuId: 'prompt.use.composer', contextId: COMPOSER.contextId },
      h.ports,
    )
    expect(h.ports.loadPrompt).toHaveBeenCalledWith(LOAD, h.ports.signal)
    expect(h.ports.savePrompt).not.toHaveBeenCalled()
  })
  it.each(['role', 'owner', 'source', 'identity', 'inactive', 'aborted', 'unknown'])(
    'refuses a forged/stale save: %s',
    async (fault) => {
      const contexts: Record<string, unknown> = {
        role: { ...MESSAGE, role: 'assistant' },
        owner: { ...MESSAGE, own: false },
        source: COMPOSER,
      }
      const h = bridgeHarness(contexts[fault] ?? MESSAGE)
      if (fault === 'inactive') h.setActive(false)
      else if (fault === 'aborted') h.abort()
      await expect(
        invokeNativePromptMenu(
          {
            menuId: fault === 'unknown' ? 'execute' : 'prompt.save.message',
            contextId: fault === 'identity' ? 'old-row' : MESSAGE.contextId,
          },
          h.ports,
        ),
      ).rejects.toThrow()
      expect(h.ports.savePrompt).not.toHaveBeenCalled()
    },
  )
  it.each(['send', 'run', 'cancel', 'replacement', 'differentSurface', 'unavailable'])(
    'rejects a stale or executing prompt load: %s',
    async (fault) => {
      const h = bridgeHarness()
      const choosePrompt = vi.fn(() => {
        switch (fault) {
          case 'cancel': {
            h.setActive(false)
            break
          }
          case 'replacement': {
            h.setContext({ ...COMPOSER, contextId: 'new-composer' })
            break
          }
          case 'differentSurface': {
            h.setContext({ ...SELECTION, contextId: COMPOSER.contextId })
            break
          }
          case 'unavailable': {
            {
              h.setContext({ ...COMPOSER, chatAvailable: false })
              // No default
            }
            break
          }
        }
        return Promise.resolve({
          ...LOAD,
          ...(fault === 'send' && { send: true }),
          ...(fault === 'run' && { action: 'run' }),
        })
      })
      await expect(
        invokeNativePromptMenu(
          { menuId: 'prompt.use.composer', contextId: COMPOSER.contextId },
          { ...h.ports, choosePrompt },
        ),
      ).rejects.toThrow()
      expect(h.ports.loadPrompt).not.toHaveBeenCalled()
    },
  )
  it('cancels a picker without inserting or saving', async () => {
    const h = bridgeHarness()
    await invokeNativePromptMenu(
      { menuId: 'prompt.use.composer', contextId: COMPOSER.contextId },
      { ...h.ports, choosePrompt: () => Promise.resolve(undefined) },
    )
    expect(h.ports.loadPrompt).not.toHaveBeenCalled()
    expect(h.ports.savePrompt).not.toHaveBeenCalled()
  })
})
