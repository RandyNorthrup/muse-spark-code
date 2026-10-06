import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PortableWhatsNew,
  type PortableWhatsNewDeps,
} from '../../../src/host/whatsNew/portableWhatsNew'
import { COMMAND_IDS } from '../../../src/shared/constants'
import { whatsNewFixtureContent } from './whatsNewContent'
import type { MhpPanelBinding } from '../../../src/shared/hostApi/panel'
import { EN } from '../../../src/shared/l10n/en'
import { setUiText } from '../../../src/shared/l10n/text'
import { fakeServices } from './services'

afterEach(() => {
  setUiText(EN, 'en')
})

function fixture() {
  const f = fakeServices()
  let session = 'session'
  let nonce = 0
  const present = vi.fn<PortableWhatsNewDeps['present']>(() => Promise.resolve())
  const executeCommand = vi.fn(() => Promise.resolve())
  const openSetting = vi.fn(() => Promise.resolve())
  const setShownOnUpdate = vi.fn(() => Promise.resolve())
  const readContent = vi.fn(() => Promise.resolve(whatsNewFixtureContent))
  const pages = new PortableWhatsNew({
    host: f.host,
    log: f.log,
    sessionId: () => session,
    readContent,
    current: '0.14.3',
    assets: () => ({
      cspSource: 'https://assets.invalid',
      nonce: `nonce-${String(++nonce)}`,
      scriptUri: 'https://assets.invalid/whatsNew.js',
      styleUri: 'https://assets.invalid/whatsNew.css',
      locale: 'en',
    }),
    present,
    executeCommand,
    openSetting,
    isShownOnUpdate: () => true,
    setShownOnUpdate,
  })
  const binding = (surface = 'surface-1'): MhpPanelBinding => ({
    surface,
    sessionId: session,
    surfaceKind: 'whatsNew',
  })
  return {
    ...f,
    pages,
    binding,
    present,
    executeCommand,
    openSetting,
    setShownOnUpdate,
    readContent,
    setSession: (id: string) => {
      session = id
    },
  }
}

describe('portable release-note ownership', () => {
  it('renders actual notes and routes only indices into that page, including settings', async () => {
    const f = fixture()
    await f.pages.show()
    const html = f.present.mock.calls[0]?.[1]
    expect(html).toContain('&lt;script&gt;escaped&lt;/script&gt;')
    expect(html).not.toContain('forged.command')
    const view = f.pages.view(f.binding())!
    await view.handle({ type: 'openLink', index: 0 })
    expect(f.requests.at(-1)).toEqual({
      method: 'ui/openExternal',
      params: { uri: 'https://example.com/notes' },
    })
    await view.handle({ type: 'tryIt', index: 0 })
    expect(f.executeCommand).toHaveBeenCalledExactlyOnceWith(COMMAND_IDS.openInNewTab)
    await view.handle({ type: 'tryIt', index: 1 })
    expect(f.openSetting).toHaveBeenCalledExactlyOnceWith('museSpark.autosave')
    await view.handle({ type: 'hideOnUpdate', isHidden: true })
    expect(f.setShownOnUpdate).toHaveBeenCalledExactlyOnceWith(false)
    await view.handle(null)
    expect(f.present).toHaveBeenCalledTimes(2)
    expect(f.present.mock.calls[1]?.[1]).toContain('nonce-nonce-2')
    await f.pages.dispose()
  })

  it('does not dispatch a forged index or foreign binding and reports operation errors', async () => {
    const f = fixture()
    await f.pages.show()
    expect(f.pages.view({ ...f.binding(), sessionId: 'foreign' })).toBeUndefined()
    const view = f.pages.view(f.binding())!
    await view.handle({ type: 'tryIt', index: 999 })
    expect(f.executeCommand).not.toHaveBeenCalled()
    expect(f.openSetting).not.toHaveBeenCalled()
    expect(f.log.warn).toHaveBeenCalledWith('MHP_WHATS_NEW_INVALID_INDEX')
    await expect(
      Reflect.apply(view.handle, view, [{ type: 'hideOnUpdate', isHidden: 'yes' }]),
    ).rejects.toThrow()
    f.executeCommand.mockImplementation(() => Promise.reject(new Error('private host path')))
    await view.handle({ type: 'tryIt', index: 0 })
    expect(f.log.warn).toHaveBeenCalledWith('MHP_WHATS_NEW_ACTION_FAILED')
    expect(f.requests.at(-1)?.method).toBe('ui/notify')
    expect(JSON.stringify(f.log.warn.mock.calls)).not.toContain('private host path')
    await f.pages.dispose()
  })

  it('retires the previous page and refuses late messages after replacement or disposal', async () => {
    const f = fixture()
    await f.pages.show()
    const old = f.pages.view(f.binding())!
    await f.pages.show()
    expect(f.pages.view(f.binding())).toBeUndefined()
    await expect(old.handle({ type: 'tryIt', index: 0 })).rejects.toThrow(
      'MHP_PANEL_UNKNOWN_SURFACE',
    )
    const next = f.pages.view(f.binding('surface-2'))!
    f.setSession('next')
    await expect(next.handle({ type: 'tryIt', index: 0 })).rejects.toThrow(
      'MHP_PANEL_UNKNOWN_SURFACE',
    )
    await f.pages.dispose()
    await expect(f.pages.show()).rejects.toThrow('MHP_PRESENTATION_DISPOSED')
  })

  it.each(['older-first', 'newer-first'])(
    'preserves a newer session open when acquisitions finish %s',
    async (order) => {
      const f = fixture()
      const older = Promise.withResolvers<unknown>()
      const newer = Promise.withResolvers<unknown>()
      f.responses.set('surfaces/open', () => older.promise)
      const first = f.pages.show()
      await vi.waitFor(() => {
        expect(f.requests).toHaveLength(1)
      })
      f.setSession('next')
      f.responses.set('surfaces/open', () => newer.promise)
      const second = f.pages.show()
      await vi.waitFor(() => {
        expect(f.requests.filter((request) => request.method === 'surfaces/open')).toEqual([
          {
            method: 'surfaces/open',
            params: { kind: 'whatsNew', placement: 'tab', sessionId: 'session' },
          },
          {
            method: 'surfaces/open',
            params: { kind: 'whatsNew', placement: 'tab', sessionId: 'next' },
          },
        ])
      })
      if (order === 'older-first') {
        older.resolve({ surfaceId: 'older' })
        await first
        expect(f.present).not.toHaveBeenCalled()
        const coalesced = f.pages.show()
        expect(f.requests.filter((request) => request.method === 'surfaces/open')).toHaveLength(2)
        newer.resolve({ surfaceId: 'newer' })
        await coalesced
      } else {
        newer.resolve({ surfaceId: 'newer' })
        await second
        older.resolve({ surfaceId: 'older' })
      }
      await Promise.all([first, second])
      expect(f.requests.filter((request) => request.method === 'surfaces/open')).toHaveLength(2)
      expect(f.present).toHaveBeenCalledOnce()
      expect(f.present.mock.calls[0]?.[0]).toEqual(f.binding('newer'))
      expect(f.pages.view(f.binding('newer'))).toBeDefined()
      await f.pages.dispose()
      expect(f.requests.filter((request) => request.method === 'surfaces/close')).toEqual([
        { method: 'surfaces/close', params: { surfaceId: 'older' } },
        { method: 'surfaces/close', params: { surfaceId: 'newer' } },
      ])
    },
  )

  it('drops a superseded publication without closing the newer page twice', async () => {
    const f = fixture()
    const publication = Promise.withResolvers<undefined>()
    f.present.mockImplementationOnce(() => publication.promise)
    const first = f.pages.show()
    await vi.waitFor(() => {
      expect(f.present).toHaveBeenCalledOnce()
    })
    f.setSession('next')
    await f.pages.show()
    expect(f.pages.view(f.binding('surface-2'))).toBeDefined()
    publication.resolve(undefined)
    await first
    await f.pages.dispose()
    expect(f.requests.filter((request) => request.method === 'surfaces/close')).toEqual([
      { method: 'surfaces/close', params: { surfaceId: 'surface-1' } },
      { method: 'surfaces/close', params: { surfaceId: 'surface-2' } },
    ])
  })

  it('discards superseded opens after returning to the original session and drains them', async () => {
    const f = fixture()
    const older = Promise.withResolvers<unknown>()
    const middle = Promise.withResolvers<unknown>()
    f.responses.set('surfaces/open', () => older.promise)
    const first = f.pages.show()
    await vi.waitFor(() => {
      expect(f.requests).toHaveLength(1)
    })
    f.setSession('middle')
    f.responses.set('surfaces/open', () => middle.promise)
    const second = f.pages.show()
    await vi.waitFor(() => {
      expect(f.requests).toHaveLength(2)
    })
    f.setSession('session')
    f.responses.delete('surfaces/open')
    await f.pages.show()
    older.resolve({ surfaceId: 'superseded' })
    await first
    expect(f.present).toHaveBeenCalledOnce()
    expect(f.pages.view(f.binding())).toBeDefined()
    let hasDisposed = false
    const closing = (async () => {
      await f.pages.dispose()
      hasDisposed = true
    })()
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    expect(hasDisposed).toBe(false)
    middle.resolve({ surfaceId: 'middle' })
    await Promise.all([second, closing])
    expect(f.requests.filter((request) => request.method === 'surfaces/close')).toHaveLength(3)
  })

  it('closes a suspended acquisition during release', async () => {
    const f = fixture()
    const acquired = Promise.withResolvers<unknown>()
    f.responses.set('surfaces/open', () => acquired.promise)
    const showing = f.pages.show()
    await vi.waitFor(() => {
      expect(f.requests.at(-1)?.method).toBe('surfaces/open')
    })
    const closing = f.pages.dispose()
    expect(f.pages.dispose()).toBe(closing)
    acquired.resolve({ surfaceId: 'late' })
    await Promise.all([showing, closing])
    expect(f.present).not.toHaveBeenCalled()
    expect(f.requests.at(-1)).toEqual({ method: 'surfaces/close', params: { surfaceId: 'late' } })
  })

  it('waits for an admitted action before closing and refuses further input', async () => {
    const f = fixture()
    await f.pages.show()
    const held = Promise.withResolvers<undefined>()
    f.executeCommand.mockImplementation(() => held.promise)
    const view = f.pages.view(f.binding())!
    const acting = view.handle({ type: 'tryIt', index: 0 })
    const closing = f.pages.dispose()
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    expect(f.requests.some((request) => request.method === 'surfaces/close')).toBe(false)
    await expect(view.handle({ type: 'tryIt', index: 0 })).rejects.toThrow(
      'MHP_PANEL_UNKNOWN_SURFACE',
    )
    held.resolve(undefined)
    await Promise.all([acting, closing])
    expect(f.requests.at(-1)?.method).toBe('surfaces/close')
  })

  it('cleans up a failed page publication and rejects malformed packaged content', async () => {
    const f = fixture()
    f.present.mockImplementation(() => Promise.reject(new Error('private renderer path')))
    await expect(f.pages.show()).rejects.toThrow('MHP_WHATS_NEW_PRESENT_FAILED')
    expect(f.requests.at(-1)?.method).toBe('surfaces/close')
    f.readContent.mockImplementation(() => Promise.resolve('{"schema":999}'))
    await expect(f.pages.show()).rejects.toThrow()
    expect(f.requests.filter((request) => request.method === 'surfaces/open')).toHaveLength(1)
    await f.pages.dispose()
  })
  it('retires a failed publication and retains failed cleanup until an actual close', async () => {
    const f = fixture()
    f.present.mockImplementation(() => Promise.reject(new Error('private renderer path')))
    f.responses.set('surfaces/close', () => Promise.reject(new Error('private close path')))
    await expect(f.pages.show()).rejects.toThrow('MHP_WHATS_NEW_PRESENT_FAILED')
    expect(f.pages.view(f.binding())).toBeUndefined()
    f.pages.closed('surface-1')
    await expect(f.pages.dispose()).resolves.toBeUndefined()
    expect(JSON.stringify(f.log.warn.mock.calls)).not.toContain('private')
  })
})
