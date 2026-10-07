import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseCommandLine, type UsageCommand } from '../../src/runtime/cliArgs'
import { lazyUsageAdapter, usageCompanionUrl } from '../../src/runtime/usage/usageAdapter'
import { runUsageCommand } from '../../src/runtime/usage/usageCli'
import { EN } from '../../src/shared/l10n/en'
import { buildPalette } from '../../src/shared/palette'
import { slashCommandsOf } from '../../src/shared/slashCommands'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeUsageAccess, usageState } from './helpers/usageAdapters'

function command(argv: string[]): UsageCommand {
  const parsed = parseCommandLine(['usage', ...argv])
  if (parsed.command !== 'usage') throw new Error('expected usage command')
  return parsed.options
}
async function* lines(items: unknown[]) {
  await new Promise<void>((resolve) => {
    queueMicrotask(resolve)
  })
  for (const item of items) yield typeof item === 'string' ? item : JSON.stringify(item)
}
function fixture() {
  const fake = fakeUsageAccess()
  return {
    ...fake,
    openPage: vi.fn().mockResolvedValue(`http://127.0.0.1:1234/#${'a'.repeat(64)}`),
    openBrowser: vi.fn().mockResolvedValue(undefined),
    print: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    input: lines([]),
  }
}

describe('usage command line', () => {
  it('uses checked JSON for root --usage and validates the standalone history flag', () => {
    expect(parseCommandLine(['--usage'])).toEqual({
      command: 'usage',
      options: command(['--json']),
    })
    expect(parseCommandLine(['--usage-history=off'])).toMatchObject({
      command: 'serve',
      options: { usageHistory: false },
    })
    expect(parseCommandLine(['--usage-history=on'])).toMatchObject({
      command: 'serve',
      options: { usageHistory: true },
    })
    expect(parseCommandLine(['--usage-history=maybe'])).toMatchObject({ command: 'invalid' })
  })
  it('parses all editor routes and keeps the existing default launch', () => {
    expect(parseCommandLine([])).toMatchObject({ command: 'serve' })
    expect(command([])).toEqual({
      action: 'summary',
      query: { range: '30d', groupBy: 'provider', metric: 'cost' },
      format: 'text',
    })
    for (const action of ['summary', 'daily', 'models', 'limits', 'export']) {
      expect(
        command([action, '--range', '7d', '--by', 'client', '--json', '--out', '/report.json']),
      ).toEqual({
        action,
        query: { range: '7d', groupBy: 'client', metric: 'cost' },
        format: 'json',
        out: '/report.json',
      })
    }
    expect(command(['--from', '2026-10-01', '--to', '2026-10-05', '--csv'])).toMatchObject({
      query: { range: 'custom', from: '2026-10-01', to: '2026-10-05' },
      format: 'csv',
    })
    expect(command(['open'])).toEqual({ action: 'open' })
    expect(command(['serve', '--stdio'])).toEqual({ action: 'stdio' })
  })

  it('offers the usage page and /usage page without changing the existing usage modal action', () => {
    const groups = buildPalette({
      currentModel: undefined,
      models: [],
      effort: 'medium',
      isThinkingEnabled: false,
      permissionMode: 'manual',
      isFocusView: false,
      useCtrlEnterToSend: false,
      usage: undefined,
      skills: [],
      backend: 'museCode',
      paidFeatures: [],
      isKeyStored: false,
    })
    expect(
      groups.flatMap((group) => group.items).find((item) => item.id === 'usagePage'),
    ).toMatchObject({
      label: EN.usagePageTitle,
      detail: EN.paletteUsagePage,
      action: { type: 'openUsagePage' },
    })
    expect(slashCommandsOf(groups).find((item) => item.name === 'usage page')?.action).toEqual({
      type: 'openUsagePage',
    })
    expect(slashCommandsOf(groups).find((item) => item.name === 'usage')?.action).toEqual({
      type: 'openUsage',
    })
  })

  it('rejects malformed ranges, conflicting output, extra arguments and mode-specific options', () => {
    for (const args of [
      ['--range', 'week'],
      ['--by', 'workspace'],
      ['--json', '--csv'],
      ['--from', '2026-10-05'],
      ['--to', '2026-10-05'],
      ['--range', 'custom'],
      ['--from', '2026-10-05', '--to', '2026-10-04'],
      ['--from', '2026-02-30', '--to', '2026-03-05'],
      ['--range', 'today', '--from', '2026-10-01', '--to', '2026-10-05'],
      ['--out', ''],
      ['serve'],
      ['serve', '--stdio', '--json'],
      ['open', '--stdio'],
      ['open', '--out', '/file'],
      ['daily', 'extra'],
      ['--bad'],
      ['--stdio'],
      ['--backend', 'modelApi'],
    ])
      expect(parseCommandLine(['usage', ...args]), args.join(' ')).toMatchObject({
        command: 'invalid',
        exitCode: 2,
      })
  })

  it('uses the shared text renderer and export without inventing unknown counters or prices', async () => {
    const ports = fixture()
    expect(await runUsageCommand(command(['models']), ports)).toBe(0)
    expect(ports.usage.usageText).toHaveBeenCalledWith(usageState(), 'plain', 'models')
    expect(ports.print).toHaveBeenCalledWith('Unpriced: unknown; reported: $0.42\n')
    expect(ports.writeFile).not.toHaveBeenCalled()
    await runUsageCommand(command(['--json']), ports)
    expect(ports.usage.export).toHaveBeenLastCalledWith(expect.anything(), 'json')
    await runUsageCommand(command(['--csv', '--out', '/chosen.csv']), ports)
    expect(ports.usage.export).toHaveBeenLastCalledWith(expect.anything(), 'summaryCsv')
    expect(ports.writeFile).toHaveBeenCalledExactlyOnceWith('/chosen.csv', 'versioned export')
    await runUsageCommand(command(['export']), ports)
    expect(ports.usage.export).toHaveBeenLastCalledWith(expect.anything(), 'callsCsv')
    ports.writeFile.mockRejectedValueOnce(new Error('write failed'))
    await expect(runUsageCommand(command(['--out', '/denied']), ports)).rejects.toThrow(
      'write failed',
    )
  })

  it('opens the companion once and validates both directions of the native stdio bridge', async () => {
    const ports = fixture()
    await runUsageCommand(command(['open']), ports)
    expect(ports.openBrowser).toHaveBeenCalledExactlyOnceWith(await ports.openPage())
    const input = [
      '{broken',
      { type: 'usage/ready', extra: true },
      { type: 'usage/ready' },
      { type: 'usage/refresh' },
      { type: 'usage/deleteHistory', requestId: 'delete', approved: true },
    ]
    ports.receive.mockImplementation(() => {
      ports.connections[0]?.post({ type: 'usage/state', state: usageState() })
      return Promise.resolve()
    })
    await runUsageCommand(command(['serve', '--stdio']), { ...ports, input: lines(input) })
    expect(ports.receive.mock.calls).toEqual([
      [{ type: 'usage/ready' }],
      [{ type: 'usage/refresh' }],
    ])
    expect(ports.print).toHaveBeenCalledWith(
      `${JSON.stringify({ type: 'usage/error', code: 'invalidMessage' })}\n`,
    )
    expect(ports.dispose).toHaveBeenCalledOnce()
    expect(ports.print).toHaveBeenCalledWith(
      `${JSON.stringify({ type: 'usage/state', state: usageState() })}\n`,
    )
  })

  it('refuses invalid outbound stdio messages and unsupported host actions; always disposes', async () => {
    const ports = fixture()
    ports.receive.mockImplementation(() => {
      ports.connections[0]?.post({
        type: 'usage/state',
        state: Object.assign(usageState(), { v: 2 }),
      })
      return Promise.resolve()
    })
    await runUsageCommand(
      { action: 'stdio' },
      { ...ports, input: lines([{ type: 'usage/ready' }]) },
    )
    expect(ports.print).toHaveBeenCalledExactlyOnceWith(
      `${JSON.stringify({ type: 'usage/error', code: 'invalidMessage' })}\n`,
    )
    expect(ports.connections[0]?.confirmDelete).toBeUndefined()
    ports.print.mockRejectedValueOnce(new Error('pipe closed'))
    let hasReadNext = false
    async function* failingInput() {
      await Promise.resolve()
      yield 'bad'
      hasReadNext = true
      yield JSON.stringify({ type: 'usage/ready' })
    }
    await expect(
      runUsageCommand({ action: 'stdio' }, { ...ports, input: failingInput() }),
    ).rejects.toThrow('pipe closed')
    expect(hasReadNext).toBe(false)
    expect(ports.dispose).toHaveBeenCalledTimes(2)
    ports.usage.connect.mockImplementationOnce((page) => {
      page.post({ type: 'usage/state', state: usageState() })
      return { receive: ports.receive, dispose: ports.dispose }
    })
    ports.print.mockRejectedValueOnce(new Error('pipe closed at EOF'))
    await expect(runUsageCommand({ action: 'stdio' }, ports)).rejects.toThrow('pipe closed at EOF')
    expect(ports.dispose).toHaveBeenCalledTimes(3)
  })

  it('preserves stdio message order while the first output write is pending', async () => {
    const ports = fixture()
    const firstWrite = Promise.withResolvers<undefined>()
    ports.print.mockReturnValueOnce(firstWrite.promise)
    ports.receive.mockImplementation(() => {
      ports.connections[0]?.post({ type: 'usage/state', state: usageState() })
      ports.connections[0]?.post({ type: 'usage/error', code: 'readFailed' })
      return Promise.resolve()
    })
    const run = runUsageCommand(
      { action: 'stdio' },
      { ...ports, input: lines([{ type: 'usage/ready' }]) },
    )
    try {
      await vi.waitFor(() => {
        expect(ports.receive).toHaveBeenCalledOnce()
      })
      expect(ports.print).toHaveBeenCalledOnce()
    } finally {
      firstWrite.resolve(undefined)
      await run
    }
    expect(ports.print.mock.calls).toEqual([
      [`${JSON.stringify({ type: 'usage/state', state: usageState() })}\n`],
      [`${JSON.stringify({ type: 'usage/error', code: 'readFailed' })}\n`],
    ])
  })
})

describe('lazy usage adapters', () => {
  it('loads service and companion on first use, reuses them, closes on release, and retries failed opens', async () => {
    const usage = fakeUsageAccess().usage
    const close = vi.fn().mockResolvedValue(undefined)
    const closed = Promise.withResolvers<undefined>()
    const nextClosed = Promise.withResolvers<undefined>()
    const open = vi
      .fn()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({
        url: `http://127.0.0.1:1234/#${'a'.repeat(64)}`,
        close,
        closed: closed.promise,
      })
      .mockResolvedValue({
        url: `http://127.0.0.1:1234/#${'a'.repeat(64)}`,
        close,
        closed: nextClosed.promise,
      })
    const create = vi.fn().mockReturnValue(usage)
    const loadBundle = vi.fn((file: string) =>
      file.endsWith('usageService.js')
        ? { createUsageAccess: create, runUsageCommand }
        : { openUsageCompanion: open },
    )
    const adapter = lazyUsageAdapter({
      dataFolder: '/data',
      packageRoot: '/package',
      host: 'cli',
      locale: 'en',
      uiText: EN,
      log: new FakeLogOutputChannel(),
      loadBundle,
    })
    expect(loadBundle).not.toHaveBeenCalled()
    expect(adapter.access()).toBe(usage)
    expect(adapter.access()).toBe(usage)
    expect(create).toHaveBeenCalledOnce()
    expect(loadBundle).toHaveBeenCalledExactlyOnceWith(
      path.join('/package', 'dist', 'usageService.js'),
    )
    await expect(adapter.openPage()).rejects.toThrow('unavailable')
    const pages = await Promise.all([adapter.openPage(), adapter.openPage()])
    expect(pages[0]).toBe(pages[1])
    expect(open).toHaveBeenCalledTimes(2)
    closed.resolve(undefined)
    await vi.waitFor(async () => {
      await adapter.openPage()
      expect(open).toHaveBeenCalledTimes(3)
    })
    await adapter.dispose()
    expect(close).toHaveBeenCalledOnce()
  })

  it('rejects a corrupt service bundle and refuses foreign, credentialed or tokenless page URLs', () => {
    const adapter = lazyUsageAdapter({
      dataFolder: '/data',
      packageRoot: '/package',
      host: 'cli',
      locale: 'en',
      uiText: EN,
      log: new FakeLogOutputChannel(),
      loadBundle: () => ({}),
    })
    expect(() => adapter.access()).toThrow(EN.actionFailed)
    const valid = `http://127.0.0.1:1234/#${'a'.repeat(64)}`
    expect(usageCompanionUrl(valid)).toBe(valid)
    for (const override of [
      { protocol: 'https:' },
      { hostname: 'localhost' },
      { hostname: 'example.com' },
      { port: '' },
      { username: 'user' },
      { password: 'pass' },
      { pathname: '/private' },
      { search: '?query=1' },
      { hash: '' },
      { hash: '#short' },
      { hash: `#${'g'.repeat(64)}` },
    ]) {
      const url = new URL(valid)
      Object.assign(url, override)
      expect(() => usageCompanionUrl(url.href), url.href).toThrow()
    }
  })

  it('rejects a corrupt companion bundle and closes an unsafe page before retrying', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const valid = `http://127.0.0.1:1234/#${'a'.repeat(64)}`
    const closed = Promise.withResolvers<undefined>().promise
    const open = vi
      .fn()
      .mockResolvedValueOnce({
        url: 'https://foreign.example/',
        close,
        closed,
      })
      .mockResolvedValue({ url: valid, close, closed })
    let companion: unknown = {}
    const adapter = lazyUsageAdapter({
      dataFolder: '/data',
      packageRoot: '/package',
      host: 'cli',
      locale: 'en',
      uiText: EN,
      log: new FakeLogOutputChannel(),
      loadBundle: (file) =>
        file.endsWith('usageService.js')
          ? { createUsageAccess: () => fakeUsageAccess().usage, runUsageCommand }
          : companion,
    })
    await expect(adapter.openPage()).rejects.toThrow(EN.actionFailed)
    companion = { openUsageCompanion: open }
    await expect(adapter.openPage()).rejects.toThrow(EN.actionFailed)
    expect(close).toHaveBeenCalledOnce()
    expect(await adapter.openPage()).toBe(valid)
    expect(open).toHaveBeenCalledTimes(2)
    await adapter.dispose()
    expect(close).toHaveBeenCalledTimes(2)
  })
})
