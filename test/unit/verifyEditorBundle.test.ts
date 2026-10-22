import { describe, expect, it, vi } from 'vitest'
import { createDeferredVerifyEditor } from '../../src/host/editor/verifyEditorBundle'
import { UI_TEXT } from '../../src/shared/constants'
import { uiLocale } from '../../src/shared/l10n/text'
import { redactSecrets } from '../../src/core/redact'
import { createLogger } from '../../src/host/logger'
import { FakeLogOutputChannel } from './helpers/fakes'

const deps = {
  platform: 'darwin' as const,
  log: createLogger(new FakeLogOutputChannel()),
  workspaceRoot: '/ws',
  realPath: (file: string) => Promise.resolve(file),
}

describe('lazy editor verification', () => {
  it('loads only on first use, installs the table, reuses its adapter and disposes it', async () => {
    const adapter = {
      diagnosticsAfterEdit: vi.fn(() => Promise.resolve([])),
      settleFile: vi.fn(() => Promise.resolve([])),
      formatAfterEdit: vi.fn(() => Promise.resolve('formatted')),
      dispose: vi.fn(),
    }
    const createVerifyEditor = vi.fn(() => adapter)
    const load = vi.fn(() => ({ createVerifyEditor }))
    const editor = createDeferredVerifyEditor(deps, '/dist', load)
    expect(load).not.toHaveBeenCalled()
    await editor.settleFile('/ws/a.json')
    await editor.diagnosticsAfterEdit([], new AbortController().signal)
    expect(await editor.formatAfterEdit('/ws/a.json', '{}')).toBe('formatted')
    expect(load).toHaveBeenCalledExactlyOnceWith('/dist/verifyEditor.js')
    expect(createVerifyEditor).toHaveBeenCalledWith(
      { ...deps, redact: redactSecrets },
      UI_TEXT,
      uiLocale(),
    )
    editor.dispose()
    expect(adapter.dispose).toHaveBeenCalledOnce()
    await expect(editor.settleFile('/ws/a.json')).rejects.toThrow(
      UI_TEXT.jsonVerificationUnavailable,
    )
  })
  it('disposal without a request loads nothing', () => {
    const load = vi.fn()
    createDeferredVerifyEditor(deps, '/dist', load).dispose()
    expect(load).not.toHaveBeenCalled()
  })
  it('rejects missing or corrupt factories and retries a repaired module', async () => {
    const load = vi
      .fn<() => unknown>()
      .mockImplementationOnce(() => {
        throw new Error('missing')
      })
      .mockReturnValueOnce({ createVerifyEditor: 'bad' })
      .mockReturnValueOnce(null)
      .mockReturnValue({ createVerifyEditor: () => ({ settleFile: () => Promise.resolve([]) }) })
    const editor = createDeferredVerifyEditor(deps, '/dist', load)
    for (let i = 0; i < 3; i += 1)
      await expect(editor.settleFile('/ws/a.json')).rejects.toThrow(
        UI_TEXT.jsonVerificationUnavailable,
      )
    expect(await editor.settleFile('/ws/a.json')).toEqual([])
  })
})
