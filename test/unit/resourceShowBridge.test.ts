// M107 RVM107W1D: Show resources through the production chat surfaces. Each
// document comes from configureWebview (its host-issued id in the HTML, its
// parsed message handler), behind the real editor-tab and sidebar adapters
// and the surface registry, routed to the window adapter as activateWindow
// (extension.ts) routes it. The test plays only the webview: it echoes the id
// the HTML names, as the chip does.
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  createResourceWindow,
  type ResourceWindowDeps,
} from '../../src/host/resources/resourceWindow'
import { openChatPanel } from '../../src/host/views/chatPanel'
import type { ChatSurface } from '../../src/host/views/chatSurface'
import { ChatViewProvider, SIDEBAR_SURFACE_ID } from '../../src/host/views/ChatViewProvider'
import { SurfaceRegistry } from '../../src/host/views/surfaceRegistry'
import { UI_TEXT, VSCODE_COMMANDS, WEBVIEW_DOCUMENT_ATTRIBUTE } from '../../src/shared/constants'
import { parseHostToWebviewMessage } from '../../src/shared/protocol'
import type { ResourceStatus } from '../../src/shared/resources'
import {
  type FakeWebview,
  FakeWebviewPanel,
  FakeWebviewView,
  fakeHostContext,
} from './helpers/fakes'
import {
  fakeAdmission,
  fakeResourceVscode,
  fakeStatus,
  fakeWindowHost,
} from './helpers/resourceWindowFakes'
// The module the production code receives through the `vscode` alias.
import { window as fakeWindow } from './mocks/vscode'

const DOCUMENT_PATTERN = new RegExp(`${WEBVIEW_DOCUMENT_ATTRIBUTE}="([^"]+)"`)

/** The id the host wrote into the webview's current HTML. */
function documentOf(webview: FakeWebview): string {
  const id = DOCUMENT_PATTERN.exec(webview.html)?.[1]
  if (id === undefined) throw new Error('the HTML names no document')
  return id
}

/** The window adapter over production surfaces, wired as activateWindow wires it. */
function bridge(initial: ResourceStatus = fakeStatus('pause')) {
  const registry = new SurfaceRegistry()
  const host = fakeWindowHost(initial)
  const { vscode } = fakeResourceVscode()
  const admission = fakeAdmission(host.window)
  const context = fakeHostContext()
  // startConversation's sidebar path: the focus command resolves the view later.
  const openConversation = vi.fn<ResourceWindowDeps<unknown>['openConversation']>(() => ({
    surfaceId: SIDEBAR_SURFACE_ID,
    opened: Promise.resolve(),
  }))
  const resources = createResourceWindow({
    vscode,
    onLoad: admission.onLoad,
    load: admission.load,
    surfaces: registry,
    openConversation,
    conversationId: () => undefined,
    warn: vi.fn(),
  })
  context.onSurfaceReady.mockImplementation((surface) => {
    resources.surfaceReady(surface)
  })
  context.onConversationMessage.mockImplementation((surface, message) => {
    if (message.type === 'resourcePull') resources.pull(surface, message.nonce)
    else if (message.type === 'resourceOpenAck')
      resources.acknowledge(surface, message.seq, message.nonce)
  })
  const active = (): ChatSurface => {
    const surface = registry.active
    if (surface === undefined) throw new Error('no chat surface')
    return surface
  }
  return {
    registry,
    port: host.port,
    vscode,
    resources,
    openConversation,
    /** A new editor tab (chatPanel.ts), and its surface. */
    tab: () => {
      const panel = openChatPanel(context, registry)
      if (!(panel instanceof FakeWebviewPanel)) throw new TypeError('expected the fake panel')
      return { panel, webview: panel.webview, surface: active() }
    },
    /** The sidebar view resolving (ChatViewProvider.ts). */
    sidebar: () => {
      const view = new FakeWebviewView()
      new ChatViewProvider(context, registry).resolveWebviewView(view)
      return view
    },
  }
}

/** The document in `webview` as its chip speaks: every message names the HTML's id. */
function page(webview: FakeWebview) {
  const fire = (message: unknown) => {
    webview.messages.fire(message)
  }
  return {
    ready: () => {
      fire({ type: 'ready' })
    },
    pull: (nonce = documentOf(webview)) => {
      fire({ type: 'resourcePull', nonce })
    },
    ack: (seq: number, nonce = documentOf(webview)) => {
      fire({ type: 'resourceOpenAck', seq, nonce })
    },
    /** The opens this webview was sent, as `seq@id`, through the strict wire. */
    opens: () =>
      webview.postMessage.mock.calls.flatMap(([raw]) => {
        const parsed = parseHostToWebviewMessage(raw)
        return parsed.ok && parsed.message.type === 'resourceOpen'
          ? [`${String(parsed.message.seq)}@${parsed.message.nonce}`]
          : []
      }),
  }
}

/** A chat the user opened: its webview, its adapter's reveal, and closing it. */
function openChat(b: ReturnType<typeof bridge>, kind: 'editor tab' | 'sidebar') {
  if (kind === 'editor tab') {
    const { panel } = b.tab()
    return {
      webview: panel.webview,
      reveal: panel.reveal,
      close: () => {
        panel.dispose()
      },
    }
  }
  const view = b.sidebar()
  return {
    webview: view.webview,
    reveal: view.show,
    close: () => {
      view.disposed.fire()
    },
  }
}

/** A Show whose governor reading waits until the test resolves it. */
function waitingReading(port: ReturnType<typeof bridge>['port']) {
  const reading = Promise.withResolvers<ResourceStatus>()
  port.refreshStatus.mockImplementationOnce(() => reading.promise)
  return {
    started: () =>
      vi.waitFor(() => {
        expect(port.refreshStatus).toHaveBeenCalled()
      }),
    resolve: () => {
      reading.resolve(fakeStatus('pause'))
    },
  }
}

/** startConversation's next sidebar focus, held until the test settles it. */
function heldFocus(b: ReturnType<typeof bridge>) {
  const focus = Promise.withResolvers<unknown>()
  b.openConversation.mockReturnValueOnce({ surfaceId: SIDEBAR_SURFACE_ID, opened: focus.promise })
  return {
    resolve: focus.resolve,
    reject: focus.reject,
    /** Show has started opening the conversation. */
    started: () =>
      vi.waitFor(() => {
        expect(b.openConversation).toHaveBeenCalled()
      }),
  }
}

/** Rejections nobody handled while the test ran. */
function unhandledRejections() {
  const seen = vi.fn()
  process.on('unhandledRejection', seen)
  onTestFinished(() => {
    process.off('unhandledRejection', seen)
  })
  return seen
}

/** One macrotask: long enough for Node to report an unhandled rejection. */
const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0)
  })

beforeEach(() => {
  fakeWindow.createWebviewPanel.mockReset()
  fakeWindow.createWebviewPanel.mockImplementation(
    (viewType, title) => new FakeWebviewPanel(viewType, title),
  )
})

describe('Show resources through configureWebview and the real chat adapters', () => {
  it('ignores the late first pull of a replaced document; the current one gets the open', async () => {
    // RVM107W1D P2-1: the old document pulled, Reload ran before delivery, the
    // replacement pulled, then the old pull arrived.
    const b = bridge()
    const { webview, surface } = b.tab()
    const chip = page(webview)
    const old = documentOf(webview)
    surface.reload()
    const current = documentOf(webview)
    expect(current).not.toBe(old)
    chip.ready()
    chip.pull()
    chip.pull(old)
    await b.resources.show()
    expect(chip.opens()).toEqual([`1@${current}`])
  })

  it('spends an open only on the ack of the document it was offered to', async () => {
    // RVM107W1D P2-2: an ack never registers its own id.
    const b = bridge()
    const { webview } = b.tab()
    const chip = page(webview)
    chip.ready()
    chip.pull()
    await b.resources.show()
    const offered = `1@${documentOf(webview)}`
    expect(chip.opens()).toEqual([offered])
    chip.ack(1, 'never-offered')
    chip.pull()
    expect(chip.opens()).toEqual([offered, offered])
    // The right document, a seq it was never offered.
    chip.ack(2)
    chip.pull()
    expect(chip.opens()).toEqual([offered, offered, offered])
    chip.ack(1)
    chip.pull()
    expect(chip.opens()).toHaveLength(3)
  })

  it('never abandons a conversation opening when a newer Show supersedes it', async () => {
    // RVM107W1D P2-3: no chat; the first Show waits in its reading while a
    // second starts; the second's sidebar focus then fails.
    const b = bridge()
    const unhandled = unhandledRejections()
    const reading = waitingReading(b.port)
    const focus = heldFocus(b)
    const first = b.resources.show()
    await reading.started()
    const second = b.resources.show()
    reading.resolve()
    await first
    await focus.started()
    focus.reject(new Error('focus failed'))
    // The failure reaches the latest Show's caller (the command's log).
    await expect(second).rejects.toThrow('focus failed')
    await settle()
    expect(unhandled).not.toHaveBeenCalled()
    expect(b.openConversation).toHaveBeenCalledTimes(1)
  })

  it('reports a failed opening to its Show even after the window is disposed', async () => {
    // RVM107W1D P2-3: disposal while the conversation opens.
    const b = bridge()
    const unhandled = unhandledRejections()
    const focus = heldFocus(b)
    const showing = b.resources.show()
    await focus.started()
    b.resources.dispose()
    focus.reject(new Error('focus failed'))
    await expect(showing).rejects.toThrow('focus failed')
    await settle()
    expect(unhandled).not.toHaveBeenCalled()
  })

  it.each(['editor tab', 'sidebar'] as const)(
    'stops a Show whose %s closes during its reading: no reveal, no open',
    async (kind) => {
      // RVM107W1D P2-4: the real panel and view adapters would call a disposed host object.
      const b = bridge()
      const opened = openChat(b, kind)
      const chip = page(opened.webview)
      chip.ready()
      chip.pull()
      const reading = waitingReading(b.port)
      const showing = b.resources.show()
      await reading.started()
      opened.close()
      expect(b.registry.size).toBe(0)
      reading.resolve()
      await showing
      expect(opened.reveal).not.toHaveBeenCalled()
      expect(chip.opens()).toEqual([])
      expect(b.openConversation).not.toHaveBeenCalled()
    },
  )

  it('opens no conversation when the governor is off; it says so and offers settings', async () => {
    // RVM107W1D P2-5: the status is read before anything opens or takes focus.
    const b = bridge(fakeStatus('normal', false))
    b.vscode.window.showInformationMessage.mockResolvedValueOnce(UI_TEXT.openSettings)
    await b.resources.show()
    expect(b.openConversation).not.toHaveBeenCalled()
    expect(b.registry.size).toBe(0)
    expect(b.vscode.window.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
      UI_TEXT.resourceGovernorOff,
      UI_TEXT.openSettings,
    )
    expect(b.vscode.commands.executeCommand).toHaveBeenCalledWith(
      VSCODE_COMMANDS.openSettings,
      'museSpark.resource',
    )
  })

  it('opens the popover in the sidebar a new conversation opens, once its chip pulls', async () => {
    const b = bridge()
    const focus = heldFocus(b)
    const showing = b.resources.show()
    await focus.started()
    expect(b.openConversation).toHaveBeenCalledTimes(1)
    const view = b.sidebar()
    focus.resolve(undefined)
    await showing
    const chip = page(view.webview)
    expect(chip.opens()).toEqual([])
    chip.ready()
    chip.pull()
    expect(chip.opens()).toEqual([`1@${documentOf(view.webview)}`])
    chip.ack(1)
    chip.pull()
    expect(chip.opens()).toHaveLength(1)
  })

  it('offers the open to a sidebar whose chip pulled while Show read the governor', async () => {
    // No chat when Show ran; the sidebar resolved and pulled during the reading.
    // Its document never pulls again, so the focused Show offers it.
    const b = bridge()
    const reading = waitingReading(b.port)
    const showing = b.resources.show()
    await reading.started()
    const view = b.sidebar()
    const chip = page(view.webview)
    chip.ready()
    chip.pull()
    reading.resolve()
    await showing
    expect(b.openConversation).toHaveBeenCalledTimes(1)
    expect(chip.opens()).toEqual([`1@${documentOf(view.webview)}`])
  })
})
