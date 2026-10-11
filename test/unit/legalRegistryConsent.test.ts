import { describe, expect, it, vi } from 'vitest'
import manifest from '../../package.json'
import { enrichInteractiveLegalScan } from '../../src/runtime/legal/legalRegistry'
import { scanLegal } from '../../src/core/legal/scan'
import { snapshotFrom } from './legal/helpers'
import { UI_TEXT } from '../../src/shared/constants'

function setup() {
  const result = scanLegal(snapshotFrom({ LICENSE: 'MIT License' }), { headerPolicy: 'off' })
  const handle = {
    result,
    registryTargets: [{ ecosystem: 'npm', name: 'example', version: '1' }] as const,
  }
  const noticed = new Set<string>()
  const fetch = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(new Response('{"license":"MIT"}', { status: 200 })),
  )
  const deps = {
    isOn: vi.fn(() => true),
    isNoticed: (host: string) => noticed.has(host),
    notice: vi.fn((_hosts: readonly string[]) => Promise.resolve(true)),
    markNoticed: vi.fn((hosts: readonly string[]) => {
      for (const host of hosts) noticed.add(host)
      return Promise.resolve()
    }),
    fetch,
  }
  return { handle, deps }
}

describe('interactive legal registry disclosure', () => {
  it('is available by default and discloses each host before any request, once per host', async () => {
    expect(
      manifest.contributes.configuration.properties['museSpark.legalRegistryLookups'].default,
    ).toBe(true)
    const { handle, deps } = setup()
    deps.notice.mockImplementation((hosts) => {
      expect(hosts).toEqual(['registry.npmjs.org'])
      expect(deps.fetch).not.toHaveBeenCalled()
      return Promise.resolve(true)
    })
    await enrichInteractiveLegalScan(handle, deps)
    await enrichInteractiveLegalScan(handle, deps)
    expect(deps.notice).toHaveBeenCalledOnce()
    expect(deps.fetch).toHaveBeenCalledTimes(2)
    expect(deps.fetch.mock.calls[0]).toEqual([
      'https://registry.npmjs.org/example/1',
      expect.objectContaining({ redirect: 'error' }),
    ])
    expect(
      deps.fetch.mock.calls.every(
        (call) => call[1]?.body === undefined && call[1]?.headers === undefined,
      ),
    ).toBe(true)
  })
  it('sends nothing when offline or when the first notice is declined, naming unknown findings', async () => {
    const { handle, deps } = setup()
    deps.isOn.mockReturnValue(false)
    const offlineResult = await enrichInteractiveLegalScan(handle, deps)
    expect(offlineResult.incompleteChecks).toContain(UI_TEXT.legalRegistryOfflineUnknown)
    expect(deps.notice).not.toHaveBeenCalled()
    deps.isOn.mockReturnValue(true)
    deps.notice.mockResolvedValue(false)
    const declinedResult = await enrichInteractiveLegalScan(handle, deps)
    expect(declinedResult.incompleteChecks).toContain(UI_TEXT.legalRegistryOfflineUnknown)
    expect(deps.fetch).not.toHaveBeenCalled()
    expect(deps.markNoticed).not.toHaveBeenCalled()
  })
  it('rechecks offline mode after the notice and cancellation before sending', async () => {
    const { handle, deps } = setup()
    deps.notice.mockImplementation(() => {
      deps.isOn.mockReturnValue(false)
      return Promise.resolve(true)
    })
    await enrichInteractiveLegalScan(handle, deps)
    expect(deps.fetch).not.toHaveBeenCalled()
    const next = setup()
    const stop = new AbortController()
    next.deps.notice.mockImplementation(() => {
      stop.abort()
      return Promise.resolve(true)
    })
    await expect(
      enrichInteractiveLegalScan(next.handle, { ...next.deps, signal: stop.signal }),
    ).rejects.toThrow()
    expect(next.deps.fetch).not.toHaveBeenCalled()
  })
  it('keeps registry metadata supplemental and never grants a fix or contacts private configuration', async () => {
    const { handle, deps } = setup()
    const result = await enrichInteractiveLegalScan(handle, deps)
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        id: 'registry/1/1',
        licenseExpression: 'MIT',
        evidenceSource: 'registry.npmjs.org',
        fixable: false,
      }),
    )
    expect(result.incompleteChecks).toContain(UI_TEXT.legalRegistryMetadataOnly)
    const invalid = {
      ...handle,
      registryTargets: [{ ecosystem: 'npm', name: '../private', version: '1' }] as const,
    }
    deps.fetch.mockClear()
    await enrichInteractiveLegalScan(invalid, deps)
    expect(deps.fetch).not.toHaveBeenCalled()
  })
})
