import { browserReport } from './networkFixtures'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeWebFetch } from '../../../src/runtime/features/webFetch'
import { createRuntimeBrowser } from '../../../src/runtime/features/browser'
import type {
  BrowserCheckRequest,
  BrowserCheckResult,
  BrowserChecker,
} from '../../../src/core/browser/browserRun'
import type { WebFetcher, WebFetchResult } from '../../../src/core/web/webFetch'
import { FakeLogOutputChannel } from '../../unit/helpers/fakes'

const owners: { dispose(): Promise<void> }[] = []
afterEach(async () => {
  await Promise.all(owners.splice(0).map((owner) => owner.dispose()))
})
const page: WebFetchResult = {
  kind: 'page',
  page: {
    url: 'https://example.invalid/',
    finalUrl: 'https://example.invalid/',
    status: 200,
    type: 'text/plain',
    bytes: 1,
  },
  text: 'untrusted fixture page',
}
function web() {
  const state = { isCurrent: true, isOffered: true }
  const fetchPage = vi.fn<WebFetcher>(() => Promise.resolve(page))
  const owner = createRuntimeWebFetch({
    fetchPage,
    isOffered: () => state.isOffered,
    assertCurrent: () => {
      if (!state.isCurrent) throw new Error('replaced')
    },
  })
  owners.push(owner)
  return { owner, state, fetchPage, signal: new AbortController().signal }
}
const report = browserReport(true)
function browser() {
  const state = { isCurrent: true, isAllowed: true, canReadScreenshots: true }
  const listeners = new Set<() => void>()
  const loads: string[] = []
  const run = vi.fn<BrowserChecker>(() => Promise.resolve(report))
  const admit = vi.fn<(signal: AbortSignal) => Promise<void>>(() => Promise.resolve())
  const owner = createRuntimeBrowser({
    checkBundlePath: '/fixture/browserCheck.js',
    runtimeBundlePath: '/fixture/browserRuntime.js',
    storageDir: '/fixture/storage',
    log: new FakeLogOutputChannel(),
    runtimeMode: () => 'ask',
    askConsent: () => Promise.resolve('decline'),
    onAdmissionChange: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    loadBundle: (file) => {
      loads.push(file)
      return { runBrowserCheck: (request: BrowserCheckRequest) => run(request, () => 'ok') }
    },
    assertCurrent: () => {
      if (!state.isCurrent) throw new Error('replaced')
    },
    isAllowed: () => state.isAllowed,
    canReadScreenshots: () => state.canReadScreenshots,
    extraHosts: () => [],
    beforeWorkspaceProcessStart: admit,
  })
  owners.push(owner)
  const request: BrowserCheckRequest = {
    url: 'http://localhost/',
    actions: [],
    allowedHosts: [],
    approvalKey: 'fixture',
    includeScreenshot: true,
    signal: new AbortController().signal,
  }
  return { owner, state, run, admit, request, loads, listeners }
}
describe('portable network tool admission', () => {
  it('passes the real fetch port its combined cancellation and live redirect admission', async () => {
    const { owner, fetchPage, signal, state } = web()
    expect(await owner.fetchPage('https://example.invalid/', signal)).toBe(page)
    const admitted = fetchPage.mock.calls[0]?.[2]
    expect(admitted?.()).toBe(true)
    state.isOffered = false
    expect(admitted?.()).toBe(false)
  })
  it.each(['isCurrent', 'isOffered'] as const)(
    'fetches nothing when %s is withdrawn',
    async (field) => {
      const { owner, fetchPage, signal, state } = web()
      state[field] = false
      await expect(owner.fetchPage('https://example.invalid/', signal)).rejects.toThrow(
        'MHP_WEB_FETCH_UNAVAILABLE',
      )
      expect(fetchPage).not.toHaveBeenCalled()
    },
  )
  it('preserves a caller denial and discards a page after late owner replacement', async () => {
    const { owner, fetchPage, signal, state } = web()
    await expect(owner.fetchPage('https://example.invalid/', signal, () => false)).rejects.toThrow()
    expect(fetchPage).not.toHaveBeenCalled()
    fetchPage.mockImplementationOnce(() => {
      state.isCurrent = false
      return Promise.resolve(page)
    })
    await expect(owner.fetchPage('https://example.invalid/', signal)).rejects.toThrow()
  })
  it('starts no fetch for an already cancelled caller', async () => {
    const { owner, fetchPage } = web()
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(owner.fetchPage('https://example.invalid/', cancelled.signal)).rejects.toThrow()
    expect(fetchPage).not.toHaveBeenCalled()
  })
  it('aborts and drains an admitted fetch during release', async () => {
    const { owner, fetchPage, signal } = web()
    const pending = Promise.withResolvers<WebFetchResult>()
    fetchPage.mockReturnValue(pending.promise)
    const fetching = owner.fetchPage('https://example.invalid/', signal)
    const closing = owner.dispose()
    expect(owner.dispose()).toBe(closing)
    try {
      expect(fetchPage.mock.calls[0]?.[1].aborted).toBe(true)
    } finally {
      pending.resolve(page)
    }
    await expect(fetching).rejects.toThrow()
    await closing
  })
  it('uses the existing lazy browser bundle only after process admission and returns its report', async () => {
    const { owner, request, run, admit, loads } = browser()
    expect(await owner.host.check(request, () => 'ok')).toEqual(report)
    expect(admit).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledOnce()
    expect(loads).toEqual(['/fixture/browserCheck.js'])
  })
  it('retains text checks on models without vision and withholds screenshots on capability withdrawal', async () => {
    const { owner, request, run, state } = browser()
    state.canReadScreenshots = false
    expect(await owner.host.check(request, () => 'ok')).toMatchObject({
      ok: true,
      report: { screenshot: undefined },
    })
    expect(run.mock.calls[0]?.[0].includeScreenshot).toBe(false)
    state.canReadScreenshots = true
    run.mockImplementationOnce(() => {
      state.canReadScreenshots = false
      return Promise.resolve(report)
    })
    expect(await owner.host.check(request, () => 'ok')).toMatchObject({
      ok: true,
      report: { screenshot: undefined },
    })
  })
  it.each(['isCurrent', 'isAllowed'] as const)(
    'starts no browser or bundle after %s is withdrawn',
    async (field) => {
      const { owner, request, state, run, admit, loads } = browser()
      state[field] = false
      expect(owner.host.isOffered()).toBe(false)
      expect(await owner.host.check(request, () => 'ok')).toEqual({
        ok: false,
        failure: { kind: 'notOffered' },
      })
      expect(run).not.toHaveBeenCalled()
      expect(admit).not.toHaveBeenCalled()
      expect(loads).toEqual([])
    },
  )
  it('starts nothing after the user-approved scope changes during process admission', async () => {
    const { owner, request, run, admit, loads } = browser()
    let isCurrent = true
    admit.mockImplementationOnce(() => {
      isCurrent = false
      return Promise.resolve()
    })
    expect(
      await owner.host.check(request, () => (isCurrent ? 'ok' : 'scopeChanged')),
    ).toMatchObject({ ok: false })
    expect(run).not.toHaveBeenCalled()
    expect(loads).toEqual([])
  })
  it.each(['isCurrent', 'isAllowed'] as const)(
    'withholds a browser report when %s changes during its run',
    async (field) => {
      const { owner, request, state, run } = browser()
      run.mockImplementationOnce(() => {
        state[field] = false
        return Promise.resolve(report)
      })
      expect(await owner.host.check(request, () => 'ok')).toMatchObject({ ok: false })
    },
  )
  it('loads no browser bundle after checkpoint process admission fails', async () => {
    const { owner, request, admit, run, loads } = browser()
    admit.mockRejectedValueOnce(new Error('checkpoint unavailable'))
    await expect(owner.host.check(request, () => 'ok')).rejects.toThrow('checkpoint unavailable')
    expect(run).not.toHaveBeenCalled()
    expect(loads).toEqual([])
  })
  it('aborts and drains a running browser and releases admission listeners', async () => {
    const { owner, request, run, listeners } = browser()
    const pending = Promise.withResolvers<BrowserCheckResult>()
    run.mockReturnValue(pending.promise)
    const checking = owner.host.check(request, () => 'ok')
    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledOnce()
    })
    const closing = owner.dispose()
    try {
      expect(run.mock.calls[0]?.[0].signal.aborted).toBe(true)
    } finally {
      pending.resolve(report)
    }
    await expect(checking).rejects.toThrow()
    await closing
    expect(listeners.size).toBe(0)
    expect(owner.host.isOffered()).toBe(false)
  })
})
