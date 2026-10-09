import type * as vscode from 'vscode'
import type * as MockVscode from '../../unit/mocks/vscode'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVscodeHostServices } from '../../../src/host/vscode/hostServices'
import { Uri, workspace } from '../../unit/mocks/vscode'

const native = vi.hoisted(() => ({
  create: vi.fn<typeof vscode.window.createTerminal>(),
  closed: vi.fn<typeof vscode.window.onDidCloseTerminal>(),
}))
vi.mock('vscode', async () => {
  const base = await vi.importActual<typeof MockVscode>('vscode')
  return {
    ...base,
    window: { ...base.window, createTerminal: native.create, onDidCloseTerminal: native.closed },
  }
})

function fixture() {
  const terminal = {
    name: 'fixture',
    processId: Promise.resolve(undefined),
    creationOptions: {},
    exitStatus: undefined,
    state: { isInteractedWith: false, shell: undefined },
    shellIntegration: undefined,
    sendText: vi.fn<vscode.Terminal['sendText']>(),
    show: vi.fn<vscode.Terminal['show']>(),
    hide: vi.fn<vscode.Terminal['hide']>(),
    dispose: vi.fn<vscode.Terminal['dispose']>(),
  } satisfies vscode.Terminal
  let closed: ((terminal: vscode.Terminal) => unknown) | undefined
  const unsubscribe = vi.fn()
  native.create.mockReturnValue(terminal)
  native.closed.mockImplementation((listener) => {
    closed = listener
    return { dispose: unsubscribe }
  })
  const subscriptions: vscode.Disposable[] = []
  const state = { get: () => undefined, update: () => Promise.resolve() }
  const host = createVscodeHostServices({
    globalState: state,
    workspaceState: state,
    subscriptions,
  })
  workspace.isTrusted = true
  return { host, terminal, subscriptions, unsubscribe, close: () => closed?.(terminal) }
}
const launch = {
  cwd: 'file:///C:/fixture/',
  executable: 'cmd.exe',
  args: ['/d'],
  env: { LANG: 'en_US.UTF-8' },
}
afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  workspace.isTrusted = true
  vi.unstubAllEnvs()
})

describe('Windows terminal HostServices ownership', () => {
  it('uses direct argv and removes inherited credential names without reading their values', async () => {
    const r = fixture()
    vi.stubEnv('M104_FIXTURE_API_KEY', 'fixture-marker')
    const owned = await r.host.request('terminal/create', launch)
    expect(native.create).toHaveBeenCalledOnce()
    expect(native.create.mock.calls[0]?.[0]).toMatchObject({
      cwd: { scheme: 'file', fsPath: expect.stringContaining('fixture') },
      shellPath: 'cmd.exe',
      shellArgs: ['/d'],
      env: { M104_FIXTURE_API_KEY: null, LANG: 'en_US.UTF-8' },
    })
    await r.host.request('terminal/show', owned)
    await r.host.request('terminal/sendText', { ...owned, text: 'fixture', addNewLine: false })
    expect(r.terminal.show).toHaveBeenCalledExactlyOnceWith(true)
    expect(r.terminal.sendText).toHaveBeenCalledExactlyOnceWith('fixture', false)
    r.close()
    await expect(r.host.request('terminal/show', owned)).rejects.toThrow('MHP_TERMINAL_UNAVAILABLE')
    await r.host.request('shutdown', {})
    expect(r.unsubscribe).toHaveBeenCalledOnce()
    expect(r.terminal.dispose).not.toHaveBeenCalled()
  })

  it('refuses distrust, cancellation, credential arguments and non-file cwd before creation', async () => {
    const r = fixture(),
      abort = new AbortController()
    workspace.isTrusted = false
    await expect(r.host.request('terminal/create', launch)).rejects.toThrow(
      'MHP_UNTRUSTED_WORKSPACE',
    )
    workspace.isTrusted = true
    abort.abort()
    await expect(r.host.request('terminal/create', launch, abort.signal)).rejects.toThrow(
      'MHP_CANCELLED',
    )
    await expect(
      r.host.request('terminal/create', { ...launch, args: ['sk-' + 'x'.repeat(40)] }),
    ).rejects.toThrow('MHP_CREDENTIAL_REFUSED')
    // The central mock intentionally treats every URI as a file; this boundary needs HTTPS.
    vi.spyOn(Uri, 'parse').mockImplementationOnce((source) => {
      const parsed = Uri.file(source)
      Object.defineProperty(parsed, 'scheme', { value: 'https' })
      return parsed
    })
    await expect(
      r.host.request('terminal/create', { ...launch, cwd: 'https://example.invalid/' }),
    ).rejects.toThrow('MHP_TERMINAL_CWD')
    expect(native.create).not.toHaveBeenCalled()
  })

  it('rechecks trust/cancellation before native sends and disposes all owned terminals on context close', async () => {
    const r = fixture(),
      abort = new AbortController()
    const owned = await r.host.request('terminal/create', launch)
    workspace.isTrusted = false
    await expect(r.host.request('terminal/show', owned)).rejects.toThrow('MHP_UNTRUSTED_WORKSPACE')
    await expect(
      r.host.request('terminal/sendText', { ...owned, text: 'fixture', addNewLine: true }),
    ).rejects.toThrow('MHP_UNTRUSTED_WORKSPACE')
    workspace.isTrusted = true
    abort.abort()
    await expect(r.host.request('terminal/show', owned, abort.signal)).rejects.toThrow(
      'MHP_CANCELLED',
    )
    await expect(
      r.host.request('terminal/sendText', {
        ...owned,
        text: 'sk-' + 'x'.repeat(40),
        addNewLine: true,
      }),
    ).rejects.toThrow('MHP_CREDENTIAL_REFUSED')
    expect(r.terminal.sendText).not.toHaveBeenCalled()
    expect(r.terminal.show).not.toHaveBeenCalled()
    for (const subscription of r.subscriptions) subscription.dispose()
    expect(r.terminal.dispose).toHaveBeenCalledOnce()
    await expect(r.host.request('terminal/show', owned)).rejects.toThrow('MHP_HOST_CLOSED')
  })

  it.each(['cancel', 'trust', 'close'] as const)(
    'releases a child when %s wins during native terminal creation',
    async (change) => {
      const r = fixture(),
        abort = new AbortController()
      native.create.mockImplementationOnce(() => {
        queueMicrotask(() => {
          switch (change) {
            case 'cancel': {
              abort.abort()
              break
            }
            case 'trust': {
              workspace.isTrusted = false
              break
            }
            case 'close': {
              for (const subscription of r.subscriptions) subscription.dispose()
              break
            }
          }
        })
        return r.terminal
      })
      const code = {
        cancel: 'MHP_CANCELLED',
        trust: 'MHP_UNTRUSTED_WORKSPACE',
        close: 'MHP_HOST_CLOSED',
      }
      await expect(r.host.request('terminal/create', launch, abort.signal)).rejects.toThrow(
        code[change],
      )
      expect(r.terminal.dispose).toHaveBeenCalledOnce()
    },
  )

  it('rejects a handle from another owner and disposes every live owned terminal on shutdown', async () => {
    const r = fixture()
    const second = { ...r.terminal, name: 'second', dispose: vi.fn<vscode.Terminal['dispose']>() }
    native.create.mockReturnValueOnce(r.terminal).mockReturnValueOnce(second)
    const firstId = await r.host.request('terminal/create', launch)
    await r.host.request('terminal/create', launch)
    await expect(r.host.request('terminal/show', { terminalId: 'not-owned' })).rejects.toThrow(
      'MHP_TERMINAL_UNAVAILABLE',
    )
    const state = { get: () => undefined, update: () => Promise.resolve() }
    const foreign = createVscodeHostServices({ globalState: state, workspaceState: state })
    await expect(foreign.request('terminal/show', firstId)).rejects.toThrow(
      'MHP_TERMINAL_UNAVAILABLE',
    )
    expect(r.terminal.show).not.toHaveBeenCalled()
    await r.host.request('shutdown', {})
    expect(r.terminal.dispose).toHaveBeenCalledOnce()
    expect(second.dispose).toHaveBeenCalledOnce()
  })
})
