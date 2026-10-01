// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import type { HostToWebviewMessage, WebviewToHostMessage } from '../../src/shared/protocol'
import { App } from '../../src/webview/App'
import { restoredUiState, webviewStateOf } from '../../src/webview/state/snapshot'
import { createUiStore } from '../../src/webview/state/store'
import { initialUiState } from '../../src/webview/state/uiState'
import { testSettings } from './helpers/fakes'

function deliver(data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data }))
  })
}

/** A reply item starting and streaming one delta, as the host relays them. */
function streamReply(itemId: string, delta: string) {
  deliver({
    type: 'agentEvent',
    event: { type: 'itemStarted', item: { itemId, kind: 'agentMessage', status: 'inProgress' } },
  })
  deliver({ type: 'agentEvent', event: { type: 'textDelta', itemId, field: 'text', delta } })
}

function silenceConsoleWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {
    // The tests assert on the call, not on the output.
  })
}

const init = {
  type: 'init',
  emptyStateHint: 'Type /model to pick the right tool for the job.',
  composerPlaceholder: 'ctrl esc to focus or unfocus Muse',
  settings: testSettings,
} satisfies HostToWebviewMessage

const models = [
  {
    modelId: 'muse-spark-1.3',
    displayLabel: 'Muse Spark 1.3',
    contextLimit: 1_007_997,
    isDefault: false,
  },
  {
    modelId: 'muse-spark-1.2',
    displayLabel: 'Muse Spark 1.2',
    contextLimit: 128_000,
    isDefault: false,
  },
]

/** A completed edit item as `historyLoaded` replays it (a rewind candidate). */
function historyEdit(itemId: string, turnId: string, patch: string) {
  return {
    itemId,
    kind: 'toolCall',
    status: 'completed',
    turnId,
    tool: 'edit_file',
    args: '{}',
    patchRef: { id: patch, byteLen: 10 },
  }
}

function historyUser(itemId: string, turnId: string, text: string) {
  return { itemId, kind: 'userMessage', status: 'completed', turnId, text }
}

function loadHistory(items: readonly Record<string, unknown>[]) {
  deliver({ type: 'historyLoaded', sessionId: 'old', todos: [], items })
}

function addTestImage() {
  deliver({
    type: 'attachmentAdded',
    attachment: {
      id: 'att-1',
      name: 'shot.png',
      mediaType: 'image/png',
      width: 2,
      height: 3,
      sizeBytes: 9,
    },
  })
}

function holdPastedPdf() {
  const pdf = new File([Uint8Array.from([1])], 'stale.pdf', { type: 'application/pdf' })
  const heldRead = Promise.withResolvers<ArrayBuffer>()
  vi.spyOn(pdf, 'arrayBuffer').mockImplementation(() => heldRead.promise)
  fireEvent.paste(textarea(), { clipboardData: { files: [pdf] } })
  return async () => {
    heldRead.resolve(Uint8Array.from([1]).buffer)
    await act(async () => {
      await heldRead.promise
      await Promise.resolve()
    })
  }
}

function chooseConversationRewind(cardIndex: number) {
  fireEvent.click(screen.getAllByLabelText('Fork or rewind')[cardIndex]!)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Rewind conversation to here' }))
}

function expectRewindRequest(
  postMessage: ReturnType<typeof renderReady>,
  expected: Omit<
    Extract<WebviewToHostMessage, { type: 'rewindConversation' }>,
    'type' | 'sourceSessionId'
  >,
) {
  expect(postMessage).toHaveBeenLastCalledWith({
    type: 'rewindConversation',
    sourceSessionId: 'old',
    attachmentEpoch: 2,
    ...expected,
  })
}

/** The agent asks one single-choice question and the user picks Red. */
function askColour() {
  deliver({
    type: 'agentEvent',
    event: {
      type: 'questionRequested',
      userInputId: 'q1',
      itemId: 'c2',
      questions: [
        {
          id: 'colour',
          header: 'Colour',
          question: 'Which?',
          selection: { mode: 'single' },
          options: [{ label: 'Red' }],
        },
      ],
    },
  })
  fireEvent.click(screen.getByRole('radio', { name: 'Red' }))
}

function renderReady(status: 'signedIn' | 'signedOut' = 'signedIn') {
  const postMessage = vi.fn<(message: WebviewToHostMessage) => void>()
  render(<App postMessage={postMessage} newLocalId={() => 'local-1'} />)
  deliver(init)
  deliver({ type: 'authState', status })
  return postMessage
}

function textarea() {
  return screen.getByLabelText<HTMLTextAreaElement>('Message Muse')
}

function storeWithSavedConversation(sessionId: string | undefined, title: string, answer: string) {
  const saved = webviewStateOf(
    {
      ...initialUiState,
      sessionId,
      title,
      sequence: 1,
      goal: { objective: `${title} goal`, status: 'active', percentComplete: 0 },
      todos: [{ text: `${title} todo`, status: 'pending' }],
      transcript: [
        {
          kind: 'user',
          id: 'u1',
          seq: 1,
          text: answer,
          status: 'sent',
          attachments: [],
        },
      ],
    },
    true,
  )
  return createUiStore(restoredUiState(saved))
}

describe('App shell', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('announces ready to the host on mount', () => {
    const postMessage = vi.fn()
    render(<App postMessage={postMessage} />)
    expect(postMessage).toHaveBeenCalledWith({ type: 'ready', attachmentEpoch: 0 })
  })

  it('shows a connecting status until init arrives', () => {
    render(<App postMessage={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('Connecting to the extension host')
    expect(screen.queryByLabelText('Message Muse')).toBeNull()
  })

  it.each([undefined, 'old'])(
    'hides persisted account A data until auth confirms it (session %s)',
    (sessionId) => {
      const store = storeWithSavedConversation(sessionId, 'Private A title', 'Private A answer')
      const expectPrivateContentHidden = () => {
        expect(screen.queryByText('Private A title')).toBeNull()
        expect(screen.queryByText('Private A answer')).toBeNull()
        expect(screen.queryByText('Private A title goal')).toBeNull()
        expect(screen.queryByText('Private A title todo')).toBeNull()
      }
      render(<App postMessage={vi.fn()} store={store} />)
      expectPrivateContentHidden()
      act(() => {
        store.dispatch({ type: 'hostMessage', message: init, at: 1 })
      })
      expectPrivateContentHidden()
      act(() => {
        store.dispatch({
          type: 'hostMessage',
          message: { type: 'surfaceState', ...(sessionId !== undefined && { sessionId }) },
          at: 2,
        })
      })
      expectPrivateContentHidden()
      act(() => {
        store.dispatch({
          type: 'hostMessage',
          message: { type: 'authState', status: 'signedOut', backend: 'modelApi' },
          at: 3,
        })
      })
      expectPrivateContentHidden()
      expect(store.getState().title).toBeUndefined()
      expect(store.getState().transcript).toEqual([])
      expect(store.getState().goal).toBeUndefined()
      expect(store.getState().todos).toEqual([])
      expect(store.getState().pendingRestore).toBeUndefined()
      expect(webviewStateOf(store.getState(), true).snapshot).toMatchObject({
        transcript: [],
      })
    },
  )

  it('reveals a saved conversation only after both sign-in and same-session confirmation', () => {
    const store = storeWithSavedConversation('old', 'Restored title', 'Restored answer')
    render(<App postMessage={vi.fn()} store={store} />)
    act(() => {
      store.dispatch({ type: 'hostMessage', message: init, at: 1 })
      store.dispatch({
        type: 'hostMessage',
        message: { type: 'authState', status: 'signedIn', backend: 'modelApi' },
        at: 2,
      })
    })
    expect(screen.queryByText('Restored title')).toBeNull()
    expect(screen.queryByText('Restored answer')).toBeNull()
    act(() => {
      store.dispatch({
        type: 'hostMessage',
        message: { type: 'surfaceState', sessionId: 'old' },
        at: 3,
      })
    })
    expect(screen.getByText('Restored title')).toBeInTheDocument()
    expect(screen.getByText('Restored answer')).toBeInTheDocument()
    expect(screen.getByText('Restored title goal')).toBeInTheDocument()
    expect(screen.getByText('Restored title todo')).toBeInTheDocument()
  })

  it('renders the empty state once signed in and focuses the composer', () => {
    renderReady()
    expect(screen.getByText(init.emptyStateHint)).toBeInTheDocument()
    expect(textarea()).toHaveAttribute('placeholder', init.composerPlaceholder)
    expect(document.activeElement).toBe(textarea())
    expect(screen.getByLabelText('Model')).toHaveTextContent('Starting Muse Code')
  })

  it('reports composer focus changes and starts a new conversation in place', () => {
    const postMessage = renderReady()
    fireEvent.blur(textarea())
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'inputFocusChanged', focused: false })
    fireEvent.change(textarea(), { target: { value: 'hello' } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    expect(screen.getByText('hello')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('New conversation'))
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'clearConversation' }),
    )
    expect(screen.queryByText('hello')).toBeNull()
    expect(screen.getByText(init.emptyStateHint)).toBeInTheDocument()
  })

  it('does not attach a deferred pasted PDF after New Conversation clears its source', async () => {
    const postMessage = renderReady()
    const releasePdf = holdPastedPdf()
    fireEvent.click(screen.getByLabelText('New conversation'))
    await releasePdf()
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'attachImageData', name: 'stale.pdf' }),
    )
  })

  it.each(['resume', 'fork'] as const)(
    'drops a deferred PDF when %s begins, preserving the draft and accepted chip',
    async (action) => {
      const postMessage = renderReady()
      loadHistory([historyUser('u1', 't1', 'first'), historyUser('u2', 't2', 'second')])
      addTestImage()
      fireEvent.change(textarea(), { target: { value: 'keep draft' } })
      const releasePdf = holdPastedPdf()
      if (action === 'resume') {
        fireEvent.click(screen.getByLabelText('Session history'))
        deliver({
          type: 'sessionList',
          sessions: [
            {
              sessionId: 'other',
              title: 'Other session',
              isNamed: false,
              createdAt: '2026-09-22T10:00:00Z',
              updatedAt: new Date().toISOString(),
              status: 'notLoaded',
              turnCount: 1,
              isFork: false,
            },
          ],
          archivedIds: [],
        })
        fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
      } else {
        fireEvent.click(screen.getAllByLabelText('Fork or rewind')[1]!)
        fireEvent.click(screen.getByRole('menuitem', { name: 'Fork conversation from here' }))
      }
      expect(textarea()).toHaveValue('keep draft')
      expect(screen.getByLabelText('Remove shot.png')).toBeInTheDocument()
      await releasePdf()
      expect(postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'attachImageData', name: 'stale.pdf' }),
      )
    },
  )

  it('inserts host-provided text at the caret', () => {
    renderReady()
    fireEvent.change(textarea(), { target: { value: 'look at ' } })
    textarea().setSelectionRange(8, 8)
    deliver({ type: 'insertText', text: '@src/app.ts#5-10 ' })
    expect(textarea()).toHaveValue('look at @src/app.ts#5-10 ')
  })

  it('shows the Focus view badge when the setting changes', () => {
    renderReady()
    expect(screen.queryByText('Focus view')).toBeNull()
    deliver({ type: 'settingsChanged', settings: { ...testSettings, focusView: true } })
    expect(screen.getByText('Focus view')).toBeInTheDocument()
  })

  it('ignores malformed host messages', () => {
    const warn = silenceConsoleWarn()
    render(<App postMessage={vi.fn()} />)
    deliver({ type: 'init', settings: 1 })
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('stops listening after unmount', () => {
    const { unmount } = render(<App postMessage={vi.fn()} />)
    unmount()
    const warn = silenceConsoleWarn()
    deliver({ type: 'bogus' })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('App sign-in gate', () => {
  it('offers both sign-in paths when signed out and forwards the choice', () => {
    const postMessage = renderReady('signedOut')
    expect(screen.getByRole('heading', { name: 'Sign in to Muse Spark' })).toBeInTheDocument()
    expect(screen.getByLabelText('Model')).toHaveTextContent('Not signed in')
    fireEvent.click(screen.getByText('Sign in with your Meta account'))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'signIn', method: 'browser' })
    fireEvent.click(screen.getByText('Use a Model API key'))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'signIn', method: 'apiKey' })
  })

  it('shows install instructions when the CLI is missing', () => {
    const postMessage = renderReady()
    deliver({ type: 'authState', status: 'noCli', detail: 'Searched: C:/nowhere' })
    expect(screen.getByRole('heading', { name: 'Muse Code is not installed' })).toBeInTheDocument()
    expect(screen.getByText('Searched: C:/nowhere')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Open install instructions'))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'openExternal',
      url: 'https://dev.meta.ai/products/muse-code/',
    })
    fireEvent.click(screen.getByText('Check again'))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'retryBackend' })
  })

  it('requires an in-panel confirmation before asking the host to install', () => {
    const postMessage = renderReady()
    deliver({
      type: 'authState',
      status: 'noCli',
      installCommand: 'irm https://dev.meta.ai/install.ps1 | iex',
    })
    fireEvent.click(screen.getByText('Install Muse Code'))
    expect(screen.getByRole('dialog', { name: 'Install Muse Code' })).toHaveAttribute(
      'aria-modal',
      'true',
    )
    expect(document.querySelector('main')).toHaveAttribute('inert')
    expect(screen.getByText('irm https://dev.meta.ai/install.ps1 | iex')).toBeInTheDocument()
    expect(postMessage).not.toHaveBeenCalledWith({ type: 'installMuseCode' })
    fireEvent.click(screen.getByText('Run installer'))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'installMuseCode' })
    expect(document.querySelector('main')).not.toHaveAttribute('inert')
  })

  it('dismisses installer confirmation when CLI state changes outside the dialog', () => {
    renderReady()
    deliver({
      type: 'authState',
      status: 'noCli',
      installCommand: 'irm https://dev.meta.ai/install.ps1 | iex',
    })
    fireEvent.click(screen.getByText('Install Muse Code'))
    expect(screen.getByRole('dialog', { name: 'Install Muse Code' })).toBeInTheDocument()
    deliver({ type: 'authState', status: 'installing' })
    expect(screen.queryByRole('dialog', { name: 'Install Muse Code' })).toBeNull()
    expect(document.querySelector('main')).not.toHaveAttribute('inert')
    deliver({
      type: 'authState',
      status: 'noCli',
      installCommand: 'irm https://dev.meta.ai/install.ps1 | iex',
    })
    expect(screen.queryByRole('dialog', { name: 'Install Muse Code' })).toBeNull()
  })

  it('shows the waiting state while the browser sign-in runs', () => {
    renderReady('signedOut')
    deliver({ type: 'authState', status: 'signingIn', detail: 'Waiting for the browser…' })
    expect(screen.getByText('Waiting for the browser…')).toBeInTheDocument()
    expect(screen.queryByText('Sign in with your Meta account')).toBeNull()
  })

  it('clears prior-account history on sign-out while keeping sign-in and device code visible', () => {
    renderReady()
    fireEvent.change(textarea(), { target: { value: 'Remember this answer' } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    deliver({ type: 'authState', status: 'signedOut', backend: 'museCode', methods: ['browser'] })
    expect(screen.queryByText('Remember this answer')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Sign in with your Meta account' }),
    ).toBeInTheDocument()
    deliver({
      type: 'authState',
      status: 'signingIn',
      backend: 'museCode',
      verificationUrl: 'https://auth.meta.com/oauth/device/?code=example',
      userCode: 'ABCD-EFGH',
    })
    expect(screen.queryByText('Remember this answer')).toBeNull()
    expect(screen.getByText('ABCD-EFGH')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open sign-in page' })).toBeInTheDocument()
  })

  it('offers CLI install while a Model API key keeps the backend signed in', () => {
    const postMessage = renderReady()
    deliver({
      type: 'authState',
      status: 'signedIn',
      backend: 'modelApi',
      hasCli: false,
      installCommand: 'irm https://dev.meta.ai/install.ps1 | iex',
    })
    openUsageDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Install Muse Code' }))
    expect(screen.getByText('irm https://dev.meta.ai/install.ps1 | iex')).toBeInTheDocument()
    expect(postMessage).not.toHaveBeenCalledWith({ type: 'installMuseCode' })
    fireEvent.click(screen.getByRole('button', { name: 'Run installer' }))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'installMuseCode' })
    deliver({
      type: 'authState',
      status: 'signedIn',
      backend: 'modelApi',
      hasCli: false,
      installState: 'running',
    })
    expect(screen.getByRole('dialog', { name: 'Account & usage' })).toHaveTextContent(
      'Installing Muse Code',
    )
    deliver({
      type: 'authState',
      status: 'signedIn',
      backend: 'modelApi',
      hasCli: true,
      hasCliSession: false,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with your Meta account' }))
    expect(postMessage).toHaveBeenCalledWith({ type: 'signIn', method: 'browser' })
  })

  it('offers an extra Model API key while Muse Code remains signed in', () => {
    const postMessage = renderReady()
    deliver({
      type: 'authState',
      status: 'signedIn',
      backend: 'museCode',
      hasCli: true,
      hasCliSession: true,
    })
    openUsageDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Add Model API key' }))
    expect(postMessage).toHaveBeenCalledWith({ type: 'signIn', method: 'apiKey' })
  })
})

describe('App conversation', () => {
  it('sends the draft with attachment ids, echoes it, and streams the reply', () => {
    const postMessage = renderReady()
    addTestImage()
    fireEvent.change(textarea(), { target: { value: 'hello muse' } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'sendMessage',
      localId: 'local-1',
      text: 'hello muse',
      attachmentIds: ['att-1'],
      includeEditorContext: false,
    })
    expect(textarea()).toHaveValue('')
    // The chip leaves the composer and rides along in the user card.
    expect(screen.queryByLabelText('Remove shot.png')).toBeNull()
    expect(screen.getByText('shot.png').closest('.message-user')).not.toBeNull()
    expect(screen.getByText('hello muse')).toBeInTheDocument()

    deliver({ type: 'turnAccepted', localId: 'local-1', turnId: 't1' })
    expect(screen.getByLabelText('Stop')).toBeInTheDocument()
    streamReply('m1', 'hi there')
    expect(screen.getByText('hi there')).toBeInTheDocument()
    deliver({
      type: 'agentEvent',
      event: { type: 'turnCompleted', turnId: 't1', terminal: 'completed' },
    })
    expect(screen.getByLabelText('Send')).toBeInTheDocument()
  })

  it('runs a `!` prompt as a shell command: no message, the row comes from the host (M46)', () => {
    const postMessage = renderReady()
    fireEvent.change(textarea(), { target: { value: '!' } })
    expect(screen.getByLabelText('Run command')).toBeDisabled()
    fireEvent.change(textarea(), { target: { value: "!Write-Output 'hello-m46'" } })
    expect(textarea()).toHaveClass('composer-input-shell')
    expect(screen.getByTitle(UI_TEXT.composerShellModeTitle)).toHaveTextContent('Shell')
    expect(screen.getByLabelText('Run command')).toHaveAttribute('title', 'Run command')
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'runUserShell',
      command: "Write-Output 'hello-m46'",
    })
    expect(textarea()).toHaveValue('')
    expect(screen.queryByText("!Write-Output 'hello-m46'")).toBeNull()
    // Refused, it comes back to the prompt with the reason.
    deliver({ type: 'userShellRefused', command: 'ls', reason: UI_TEXT.userShellRestricted })
    expect(textarea()).toHaveValue('!ls')
    expect(
      screen.getByText(UI_TEXT.userShellRestricted, { selector: '.notice' }),
    ).toBeInTheDocument()
  })

  it('moves a running command to the background and stops it from its row (M46)', () => {
    const postMessage = renderReady()
    deliver({ type: 'agentEvent', event: { type: 'turnStarted', turnId: 't1' } })
    const call = {
      itemId: 'c1',
      kind: 'toolCall',
      status: 'inProgress',
      turnId: 't1',
      tool: 'powershell',
      args: '{"command":"npm run dev"}',
    }
    deliver({ type: 'agentEvent', event: { type: 'itemStarted', item: call } })
    fireEvent.click(screen.getByRole('button', { name: /^Move to background/ }))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'moveToBackground', itemId: 'c1' })
    expect(screen.getByRole('button', { name: /^Move to background/ })).toBeDisabled()
    deliver({
      type: 'agentEvent',
      event: {
        type: 'itemUpdated',
        item: { ...call, background: true, backgroundInitiator: 'user' },
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Stop: PowerShell/ }))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'stopTask', itemId: 'c1' })
    // The header pill counts it, and the map's Stop all reaches the host.
    fireEvent.click(screen.getByRole('button', { name: '1 background task' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop all' }))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'stopAllTasks' })
  })

  it('stops the running turn from the Stop button and still lets Enter steer', () => {
    const postMessage = renderReady()
    deliver({ type: 'agentEvent', event: { type: 'turnStarted', turnId: 't1' } })
    fireEvent.click(screen.getByLabelText('Stop'))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'cancelTurn' })
    fireEvent.change(textarea(), { target: { value: 'and also' } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'sendMessage',
      localId: 'local-1',
      text: 'and also',
      attachmentIds: [],
      includeEditorContext: false,
    })
  })

  it('shows the send failure reason on the echoed message', () => {
    renderReady()
    fireEvent.change(textarea(), { target: { value: 'hello' } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    deliver({ type: 'sendFailed', localId: 'local-1', reason: 'Open a folder first' })
    expect(document.querySelector('.message-error')).toHaveTextContent('Open a folder first')
    // Read out once, by the live region, not by an alert on the card (M25).
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.querySelector('[aria-live]')).toHaveTextContent('Open a folder first')
  })

  it('labels the model pill with model and effort, like the Claude Code pill', () => {
    renderReady()
    deliver({ type: 'sessionInfo', modelId: 'muse-spark-1.3', contextLimit: 1_007_997 })
    expect(screen.getByLabelText('Model')).toHaveTextContent('muse-spark-1.3 High')
    expect(screen.getByLabelText('Model')).not.toHaveTextContent('1M')
    deliver({
      type: 'composerState',
      effort: 'xhigh',
      isThinkingEnabled: false,
      permissionMode: 'manual',
    })
    expect(screen.getByLabelText('Model')).toHaveTextContent('muse-spark-1.3 No thinking')
  })

  it('opens the Modes menu from the button, selects a mode, and cycles on Shift+Tab', () => {
    const postMessage = renderReady()
    fireEvent.click(screen.getByLabelText('Permission mode: Manual'))
    const menu = screen.getByRole('menu', { name: 'Permission modes' })
    expect(document.activeElement).toBe(menu)
    expect(screen.getByText('Modes')).toBeInTheDocument()
    expect(screen.getByText('⇧ + tab')).toBeInTheDocument()
    expect(screen.getAllByRole('menuitemradio').map((node) => node.textContent)).toEqual([
      // Muse Code's wording (D24): its Manual applies in-workspace edits unasked.
      'ManualMuse will ask before running commands; Muse Code edits workspace files without askingCurrent',
      'Edit automaticallyMuse will edit files without asking and ask before running commands',
      'PlanMuse will explore the code and present a plan before editing',
      'AutoMuse will approve actions that pass a safety check and pause for anything risky',
    ])
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Edit automatically/ }))
    expect(postMessage).toHaveBeenCalledWith({
      type: 'setPermissionMode',
      mode: 'acceptEdits',
    })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(textarea())
    deliver({
      type: 'composerState',
      effort: 'high',
      isThinkingEnabled: true,
      permissionMode: 'auto',
    })
    expect(screen.getByLabelText('Permission mode: Auto')).toBeInTheDocument()
    // Bypass is not allowed, so the cycle wraps from Auto to Manual.
    fireEvent.keyDown(textarea(), { key: 'Tab', shiftKey: true })
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'setPermissionMode', mode: 'manual' })
    // A second click on the button closes the menu again.
    fireEvent.click(screen.getByLabelText('Permission mode: Auto'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Permission mode: Auto'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('lists Bypass permissions only while the setting allows it', () => {
    const postMessage = renderReady()
    deliver({
      type: 'settingsChanged',
      settings: { ...testSettings, allowDangerouslySkipPermissions: true },
    })
    fireEvent.click(screen.getByLabelText('Permission mode: Manual'))
    expect(screen.getByRole('menuitemradio', { name: /Bypass permissions/ })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' })
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Enter' })
    expect(postMessage).toHaveBeenCalledWith({
      type: 'setPermissionMode',
      mode: 'bypassPermissions',
    })
    deliver({
      type: 'composerState',
      effort: 'high',
      isThinkingEnabled: true,
      permissionMode: 'auto',
    })
    fireEvent.keyDown(textarea(), { key: 'Tab', shiftKey: true })
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'setPermissionMode',
      mode: 'bypassPermissions',
    })
  })

  it('steps the effort from the Modes menu footer with the dots and the arrows', () => {
    const postMessage = renderReady()
    deliver({ type: 'sessionInfo', modelId: 'muse-spark-1.3', contextLimit: 1_007_997 })
    fireEvent.click(screen.getByLabelText('Permission mode: Manual'))
    expect(screen.getByText('Effort (High)')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Max'))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'setEffort', effort: 'max' })
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowRight' })
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'setEffort', effort: 'xhigh' })
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowLeft' })
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'setEffort', effort: 'medium' })
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('opens the Modes menu from the palette row', () => {
    renderReady()
    const filter = openPalette()
    fireEvent.change(filter, { target: { value: 'Permission mode' } })
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(screen.getByRole('menu', { name: 'Permission modes' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('offers upload and add-context from the "+" menu', async () => {
    const postMessage = renderReady()
    fireEvent.click(screen.getByLabelText('Attach'))
    expect(screen.getAllByRole('menuitem').map((node) => node.textContent)).toEqual([
      'Upload from computer',
      'Add context',
    ])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Upload from computer' }))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'pickFile' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.change(textarea(), { target: { value: 'look at' } })
    fireEvent.click(screen.getByLabelText('Attach'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add context' }))
    expect(textarea()).toHaveValue('look at @')
    // The caret lands after the `@` once the insert has committed.
    await act(async () => {
      await Promise.resolve()
    })
    expect(postMessage).toHaveBeenCalledWith({ type: 'searchMentions', requestId: 1, query: '' })
    expect(screen.getByText('No matching files')).toBeInTheDocument()
    deliver({
      type: 'mentionResults',
      requestId: 1,
      items: [{ path: 'src/app.ts', isFolder: false }],
    })
    expect(screen.getByRole('option', { name: 'src/app.ts' })).toBeInTheDocument()
  })

  it('routes mention searches and attachment removal', () => {
    const postMessage = renderReady()
    fireEvent.change(textarea(), { target: { value: '@ap', selectionStart: 3 } })
    fireEvent.keyUp(textarea(), { key: 'p' })
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'searchMentions',
      requestId: 1,
      query: 'ap',
    })
    deliver({
      type: 'attachmentAdded',
      attachment: {
        id: 'a1',
        name: 'x.png',
        mediaType: 'image/png',
        width: 1,
        height: 1,
        sizeBytes: 1,
      },
    })
    fireEvent.click(screen.getByLabelText('Remove x.png'))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'removeAttachment', id: 'a1' })
    expect(screen.queryByText('x.png')).toBeNull()
  })
})

describe('App transcript (M4)', () => {
  it('decides an approval from its card and answers a question from its card', () => {
    const postMessage = renderReady()
    deliver({
      type: 'agentEvent',
      event: {
        type: 'approvalRequested',
        approvalId: 'a1',
        itemId: 'c1',
        toolName: 'powershell',
        rawArgs: '{"command":"ls"}',
        requirementId: { approvalId: 'a1', sourceIndex: 0 },
        subject: { kind: 'shell', command: 'ls' },
        availableChoices: [
          { choiceId: 'allow_once', label: 'Allow once', decision: 'approved', scope: 'once' },
          {
            choiceId: 'abort',
            label: 'Reject',
            decision: 'abort',
            scope: 'once',
            acceptsFeedback: true,
          },
        ],
        isJudgeEscalated: false,
        isProtectedWrite: false,
      },
    })
    fireEvent.change(screen.getByPlaceholderText(/what to do instead/), {
      target: { value: 'no' },
    })
    fireEvent.click(screen.getByText('Reject'))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'decideApproval',
      approvalId: 'a1',
      choiceId: 'abort',
      requirementId: { approvalId: 'a1', sourceIndex: 0 },
      feedback: 'no',
    })
    // The stage locks on the first decision; a repeated update for the same
    // stage keeps it locked and the next stage unlocks it.
    const sentSoFar = postMessage.mock.calls.length
    expect(screen.getByText('Allow once')).toBeDisabled()
    fireEvent.click(screen.getByText('Allow once'))
    expect(postMessage).toHaveBeenCalledTimes(sentSoFar)
    const stageUpdate = (sourceIndex: number) => {
      deliver({
        type: 'agentEvent',
        event: {
          type: 'approvalUpdated',
          approvalId: 'a1',
          requirementId: { approvalId: 'a1', sourceIndex },
          subject: { kind: 'shell', command: 'ls; pwd' },
          availableChoices: [
            { choiceId: 'allow_once', label: 'Allow once', decision: 'approved', scope: 'once' },
          ],
        },
      })
    }
    stageUpdate(0)
    expect(screen.getByText('Allow once')).toBeDisabled()
    stageUpdate(1)
    expect(screen.getByText('Allow once')).toBeEnabled()
    askColour()

    fireEvent.click(screen.getByText('Submit'))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'answerQuestion',
      userInputId: 'q1',
      answers: [{ questionId: 'colour', selectedLabel: 'Red' }],
    })
  })

  it('routes code block actions, links and patch fetches to the host', () => {
    const postMessage = renderReady()
    deliver({
      type: 'agentEvent',
      event: {
        type: 'itemCompleted',
        item: {
          itemId: 'm',
          kind: 'agentMessage',
          status: 'completed',
          text: 'See [docs](https://dev.meta.ai/)\n\n```js\nlet a = 1\n```',
        },
      },
    })
    fireEvent.click(screen.getByRole('link', { name: 'docs' }))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'openExternal',
      url: 'https://dev.meta.ai/',
    })
    fireEvent.click(screen.getByText('Copy'))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'copyText', text: 'let a = 1' })
    fireEvent.click(screen.getByText('Insert at cursor'))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'insertCode', text: 'let a = 1' })
    deliver({
      type: 'agentEvent',
      event: {
        type: 'itemCompleted',
        item: {
          itemId: 'e',
          kind: 'toolCall',
          status: 'completed',
          tool: 'edit_file',
          args: '{"path":"a.ts"}',
          patchRef: { id: 'tool_patch-1', byteLen: 20 },
        },
      },
    })
    fireEvent.click(screen.getByText('Edit'))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'readOutput',
      itemId: 'e',
      outputRef: 'tool_patch-1',
      offsetBytes: 0,
    })
  })

  it('shows the session name, the context indicator and the todo panel', () => {
    renderReady()
    deliver({ type: 'agentEvent', event: { type: 'sessionNamed', name: 'Muse setup' } })
    expect(screen.getByRole('heading', { name: 'Muse setup' })).toBeInTheDocument()
    deliver({
      type: 'agentEvent',
      event: {
        type: 'contextUsage',
        usedTokens: 120_000,
        windowTokens: 1_000_000,
        pressure: 'normal',
      },
    })
    expect(screen.getByText('12% context')).toHaveAttribute(
      'title',
      '120K of 1M tokens · pressure normal · Click to compact now',
    )
    deliver({
      type: 'agentEvent',
      event: { type: 'todoChanged', items: [{ text: 'Write tests', status: 'pending' }] },
    })
    expect(screen.getByRole('region', { name: 'Tasks' })).toHaveTextContent('Write tests')
  })
})

function openPalette() {
  fireEvent.click(screen.getByLabelText('Commands'))
  return screen.getByRole('combobox')
}

/** Opens the account modal through the same palette action a user selects. */
function openUsageDialog() {
  const filter = openPalette()
  fireEvent.change(filter, { target: { value: '/usage' } })
  fireEvent.keyDown(filter, { key: 'Enter' })
  return screen.getByRole('dialog', { name: 'Account & usage' })
}

describe('App palette', () => {
  it('opens from the Commands button, asks for skills once, and closes back to the composer', () => {
    const postMessage = renderReady()
    fireEvent.click(screen.getByLabelText('Commands'))
    expect(screen.getByRole('dialog', { name: 'Actions' })).toBeInTheDocument()
    expect(postMessage).toHaveBeenCalledWith({ type: 'listSkills' })
    deliver({ type: 'skillList', skills: [] })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(textarea())
    fireEvent.click(screen.getByLabelText('Commands'))
    expect(postMessage.mock.calls.filter(([m]) => m.type === 'listSkills')).toHaveLength(1)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(fireEvent.mouseDown(screen.getByLabelText('Commands'))).toBe(false)
    fireEvent.click(screen.getByLabelText('Commands'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // M38: `/` alone shows the palette attached to the prompt; a character
  // more, the slash commands. The prompt keeps the focus and the text.
  it('shows the palette for a typed "/" and the slash commands after a character more', () => {
    const postMessage = renderReady()
    deliver({ type: 'modelList', models })
    const box = textarea()
    box.focus()
    fireEvent.change(box, { target: { value: '/' } })
    const palette = screen.getByRole('dialog', { name: 'Actions' })
    expect(within(palette).queryByRole('combobox')).toBeNull()
    expect(document.activeElement).toBe(box)
    expect(postMessage).toHaveBeenCalledWith({ type: 'listSkills' })
    deliver({
      type: 'skillList',
      skills: [{ selector: 'fix-bug', displayName: 'Fix bug', description: 'Fixes a bug' }],
    })
    // The prompt's arrows move the palette's rows.
    const first = box.getAttribute('aria-activedescendant')
    expect(first).toMatch(/^palette-row-/)
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(box.getAttribute('aria-activedescendant')).not.toBe(first)
    // A row that changes a value in place keeps the `/` and the palette.
    fireEvent.click(screen.getByRole('option', { name: /Thinking/ }))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'setThinking', enabled: false })
    expect(box.value).toBe('/')
    expect(screen.getByRole('dialog', { name: 'Actions' })).toBeInTheDocument()
    // Escape closes it and keeps the text.
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(box.value).toBe('/')
    // A character more: the slash commands, the skill among them.
    fireEvent.change(box, { target: { value: '/fi' } })
    expect(screen.queryByRole('dialog')).toBeNull()
    const list = screen.getByRole('listbox', { name: 'Slash commands' })
    expect(within(list).getAllByRole('option')[0]).toHaveTextContent('/fix-bug')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(box.value).toBe('/fix-bug ')
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'sendMessage' }))
    // A command runs, and the prompt is left empty.
    fireEvent.change(box, { target: { value: '/compact' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'compact' })
    expect(box.value).toBe('')
    // A row that opens something else takes the `/` with it.
    fireEvent.change(box, { target: { value: '/' } })
    fireEvent.click(screen.getByRole('option', { name: /Switch model/ }))
    expect(screen.getByRole('listbox', { name: 'Models' })).toBeInTheDocument()
    expect(box.value).toBe('')
    expect(postMessage.mock.calls.filter(([m]) => m.type === 'listSkills')).toHaveLength(1)
  })

  it('toggles the model list from the pill', () => {
    renderReady()
    deliver({ type: 'modelList', models })
    fireEvent.click(screen.getByLabelText('Model'))
    expect(screen.getByRole('listbox', { name: 'Models' })).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Model'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(textarea())
    fireEvent.click(screen.getByLabelText('Commands'))
    fireEvent.click(screen.getByLabelText('Model'))
    expect(screen.getByRole('listbox', { name: 'Models' })).toBeInTheDocument()
  })

  it('routes every palette action to the host or the local state', () => {
    const postMessage = renderReady()
    deliver({ type: 'sessionInfo', modelId: 'muse-spark-1.3', contextLimit: 1_007_997 })
    deliver({ type: 'modelList', models })
    deliver({
      type: 'skillList',
      skills: [{ selector: 'fix-bug', displayName: 'Fix bug', description: 'd' }],
    })
    const run = (filterText: string) => {
      const filter = openPalette()
      fireEvent.change(filter, { target: { value: filterText } })
      fireEvent.keyDown(filter, { key: 'Enter' })
    }
    run('Attach file')
    expect(postMessage).toHaveBeenCalledWith({ type: 'pickFile' })
    run('Mention file')
    expect(postMessage).toHaveBeenCalledWith({ type: 'pickMentionFile' })
    run('Thinking')
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'setThinking', enabled: false })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    run('Effort')
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'setEffort', effort: 'xhigh' })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    run('Focus view')
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'hostAction', action: 'toggleFocusView' })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    run('Ctrl+Enter')
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'hostAction',
      action: 'toggleCtrlEnterToSend',
    })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    run('Open settings')
    expect(postMessage).toHaveBeenCalledWith({ type: 'hostAction', action: 'openSettings' })
    run('Keyboard shortcuts')
    expect(postMessage).toHaveBeenCalledWith({ type: 'hostAction', action: 'openKeybindings' })
    run('Output log')
    expect(postMessage).toHaveBeenCalledWith({ type: 'hostAction', action: 'openLog' })
    run('Sign out')
    expect(postMessage).toHaveBeenCalledWith({ type: 'signOut' })
    run('/compact')
    expect(postMessage).toHaveBeenCalledWith({ type: 'compact' })
    run('/export')
    expect(postMessage).toHaveBeenCalledWith({ type: 'exportConversation', format: 'markdown' })
    // The CLI's own rows (M30) need the Muse Code backend.
    deliver({ type: 'authState', status: 'signedIn', backend: 'museCode' })
    deliver({
      type: 'skillList',
      skills: [{ selector: 'fix-bug', displayName: 'Fix bug', description: 'd' }],
    })
    run('Export session log')
    expect(postMessage).toHaveBeenCalledWith({ type: 'exportConversation', format: 'sessionLog' })
    run('Manage skills')
    expect(postMessage).toHaveBeenCalledWith({ type: 'hostAction', action: 'manageSkills' })
    run('Import skills')
    expect(postMessage).toHaveBeenCalledWith({ type: 'hostAction', action: 'importSkills' })
    run('MCP servers')
    expect(postMessage).toHaveBeenCalledWith({ type: 'hostAction', action: 'showMcpServers' })
    run('Hooks…')
    expect(postMessage).toHaveBeenCalledWith({ type: 'hostAction', action: 'showHooks' })
    run('Memory…')
    expect(postMessage).toHaveBeenCalledWith({ type: 'hostAction', action: 'showMemory' })
    run('New worktree')
    expect(postMessage).toHaveBeenCalledWith({ type: 'hostAction', action: 'newWorktree' })
    run('Remove a worktree')
    expect(postMessage).toHaveBeenCalledWith({ type: 'hostAction', action: 'removeWorktree' })
    run('Report an issue')
    expect(postMessage).toHaveBeenCalledWith({
      type: 'openExternal',
      url: 'https://github.com/RandyNorthrup/muse-spark-code/issues',
    })
    run('/fix-bug')
    expect(textarea()).toHaveValue('/fix-bug ')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('clears the conversation locally and tells the host', () => {
    const postMessage = renderReady()
    fireEvent.change(textarea(), { target: { value: 'hello' } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    expect(screen.getByText('hello')).toBeInTheDocument()
    const filter = openPalette()
    fireEvent.change(filter, { target: { value: 'Clear conversation' } })
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'clearConversation' }))
    expect(screen.queryByText('hello')).toBeNull()
    expect(screen.getByText(init.emptyStateHint)).toBeInTheDocument()
  })

  it('switches models from the pill and from the palette, and can go back', () => {
    const postMessage = renderReady()
    deliver({ type: 'sessionInfo', modelId: 'muse-spark-1.3', contextLimit: 1_007_997 })
    deliver({ type: 'modelList', models })
    fireEvent.click(screen.getByLabelText('Model'))
    expect(screen.getByRole('listbox', { name: 'Models' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(postMessage).toHaveBeenCalledWith({ type: 'setModel', modelId: 'muse-spark-1.2' })
    expect(screen.queryByRole('dialog')).toBeNull()
    deliver({ type: 'agentEvent', event: { type: 'modelChanged', modelId: 'muse-spark-1.2' } })
    expect(screen.getByLabelText('Model')).toHaveTextContent('muse-spark-1.2 High')

    const filter = openPalette()
    fireEvent.change(filter, { target: { value: 'Switch model' } })
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(screen.getByRole('listbox', { name: 'Models' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    expect(screen.getByRole('listbox', { name: 'Actions' })).toBeInTheDocument()
  })

  it('shows notices from the host in the transcript', () => {
    renderReady()
    deliver({ type: 'notice', level: 'warning', text: 'Reasoning effort could not be applied' })
    expect(screen.getByRole('list', { name: 'Conversation' })).toHaveTextContent(
      'Reasoning effort could not be applied',
    )
  })
})

describe('App editor integration (M5)', () => {
  const context = { relativePath: 'src/App.tsx', startLine: 5, endLine: 10, isEmpty: false }

  it('sends the open-file chip with the message and shows it on the user card', () => {
    const postMessage = renderReady()
    deliver({ type: 'editorContext', context })
    expect(screen.getByText('App.tsx L5-10')).toBeInTheDocument()
    fireEvent.change(textarea(), { target: { value: 'explain' } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'sendMessage',
      localId: 'local-1',
      text: 'explain',
      attachmentIds: [],
      includeEditorContext: true,
    })
    // The chip stays in the composer and is echoed on the card.
    expect(screen.getAllByText('App.tsx L5-10')).toHaveLength(2)
  })

  it('leaves the context out once dismissed, until another file is active', () => {
    const postMessage = renderReady()
    deliver({ type: 'editorContext', context })
    fireEvent.click(screen.getByLabelText('Leave the open file out: App.tsx L5-10'))
    expect(screen.queryByText('App.tsx L5-10')).toBeNull()
    fireEvent.change(textarea(), { target: { value: 'hi' } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'sendMessage', includeEditorContext: false }),
    )
    deliver({ type: 'editorContext', context: { ...context, relativePath: 'src/b.ts' } })
    expect(screen.getByText('b.ts L5-10')).toBeInTheDocument()
  })

  it('hides the chip while attachOpenFile is off', () => {
    renderReady()
    deliver({ type: 'settingsChanged', settings: { ...testSettings, attachOpenFile: false } })
    deliver({ type: 'editorContext', context })
    expect(screen.queryByText('App.tsx L5-10')).toBeNull()
  })

  it('routes Apply and the edit review actions to the host', () => {
    const postMessage = renderReady()
    deliver({
      type: 'agentEvent',
      event: {
        type: 'itemCompleted',
        item: {
          itemId: 'ed',
          kind: 'toolCall',
          status: 'completed',
          tool: 'edit_file',
          args: '{"find":"a","path":"notes.md","replace":"b"}',
          visibleOutput: '--- a/notes.md\n+++ b/notes.md\n@@ -1,1 +1,1 @@\n-a\n+b',
          patchRef: { id: 'tool_patch-1', byteLen: 300 },
        },
      },
    })
    // The edit row opens from the start and fetches its patch; its path opens the file (M16).
    expect(postMessage).toHaveBeenCalledWith({
      type: 'readOutput',
      itemId: 'ed',
      outputRef: 'tool_patch-1',
      offsetBytes: 0,
    })
    fireEvent.click(screen.getByRole('button', { name: 'notes.md' }))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'openFile', path: 'notes.md' })
    fireEvent.click(screen.getByText('Click to expand'))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'openEditDiff',
      itemId: 'ed',
      outputRef: 'tool_patch-1',
    })
    deliver({
      type: 'agentEvent',
      event: {
        type: 'itemCompleted',
        item: {
          itemId: 'm',
          kind: 'agentMessage',
          status: 'completed',
          text: '```js\nlet a = 1\n```',
        },
      },
    })
    fireEvent.click(screen.getByText('Apply'))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'applyCode', text: 'let a = 1' })
  })
})

describe('App session history (M6)', () => {
  const sessionRow = {
    sessionId: 'old',
    title: 'Old prompt',
    isNamed: false,
    createdAt: '2026-09-22T10:00:00Z',
    updatedAt: new Date().toISOString(),
    status: 'notLoaded',
    turnCount: 2,
    isFork: false,
  }

  it('opens the History dialog from the header, lists, resumes and archives', () => {
    const postMessage = renderReady()
    fireEvent.click(screen.getByLabelText('Session history'))
    expect(postMessage).toHaveBeenCalledWith({ type: 'listSessions' })
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    deliver({ type: 'sessionList', sessions: [sessionRow], archivedIds: [] })
    fireEvent.click(
      within(screen.getByRole('option', { name: /Old prompt/ })).getByTitle('Archive (Delete)'),
    )
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'setSessionArchived',
      sessionId: 'old',
      isArchived: true,
    })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(postMessage).toHaveBeenCalledWith({
      type: 'resumeSession',
      sessionId: 'old',
      attachmentEpoch: 1,
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(textarea())
  })

  it('toggles the History dialog closed from the same button, hanging from the header', () => {
    renderReady()
    const button = screen.getByLabelText('Session history')
    fireEvent.click(button)
    const dialog = screen.getByRole('dialog', { name: 'History' })
    expect(dialog.parentElement).toHaveClass('header-area')
    expect(dialog.parentElement?.querySelector('.header')).not.toBeNull()
    // The mousedown is swallowed so the search box keeps focus and the
    // click toggles instead of blur-closing and reopening.
    expect(fireEvent.mouseDown(button)).toBe(false)
    fireEvent.click(button)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(textarea())
  })

  it('opens the History dialog from the palette Resume row', () => {
    const postMessage = renderReady()
    const filter = openPalette()
    fireEvent.change(filter, { target: { value: 'Resume' } })
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'listSessions' })
    expect(screen.getByRole('dialog', { name: 'History' })).toBeInTheDocument()
  })

  it('rebuilds the transcript from loaded history and offers the fork/rewind menu', () => {
    const postMessage = renderReady()
    deliver({
      type: 'historyLoaded',
      sessionId: 'old',
      name: 'Resumed one',
      todos: [],
      items: [
        { itemId: 'u1', kind: 'userMessage', status: 'completed', turnId: 't1', text: 'first' },
        { itemId: 'm1', kind: 'agentMessage', status: 'completed', text: 'reply' },
        { itemId: 'u2', kind: 'userMessage', status: 'completed', turnId: 't2', text: 'second' },
      ],
    })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Resumed one')
    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.getByText('reply')).toBeInTheDocument()
    const menus = screen.getAllByLabelText('Fork or rewind')
    expect(menus).toHaveLength(2)
    fireEvent.click(menus[1]!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fork conversation from here' }))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'forkSession',
      lastTurnId: 't1',
      attachmentEpoch: 2,
    })
    expect(screen.queryByRole('menu')).toBeNull()
    // Before the first message there is nothing to keep: a new conversation.
    fireEvent.click(menus[0]!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fork conversation from here' }))
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'clearConversation' }),
    )
    expect(screen.queryByText('first')).toBeNull()
  })

  it('rewinds a conversation at the preceding turn and restores its prompt only after host success (M53)', () => {
    const postMessage = renderReady()
    loadHistory([historyUser('u1', 't1', 'first'), historyUser('u2', 't2', 'second')])
    chooseConversationRewind(1)
    expectRewindRequest(postMessage, {
      itemId: 'u2',
      turnId: 't2',
      lastTurnId: 't1',
      text: 'second',
      imageCount: 0,
    })
    expect(textarea()).toHaveValue('')
    deliver({ type: 'restoreDraft', text: 'second' })
    expect(textarea()).toHaveValue('second')
  })

  it.each([
    { name: 'report.pdf', mediaType: 'application/pdf' },
    { name: 'notes.txt', mediaType: 'text/plain' },
  ])('hides conversation rewind for fresh and History file cards: $name', ({ name, mediaType }) => {
    const postMessage = renderReady()
    deliver({ type: 'sessionInfo', modelId: 'muse-spark-1.3', sessionId: 'old' })
    deliver({
      type: 'attachmentAdded',
      attachment: { id: 'file-1', name, mediaType, sizeBytes: 9 },
    })
    fireEvent.change(textarea(), { target: { value: 'Read this file' } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    deliver({ type: 'turnAccepted', localId: 'local-1', turnId: 't1', userMessageId: 'backend-u1' })
    deliver({
      type: 'agentEvent',
      event: { type: 'turnCompleted', turnId: 't1', terminal: 'completed' },
    })
    fireEvent.click(screen.getAllByLabelText('Fork or rewind')[0]!)
    expect(screen.queryByRole('menuitem', { name: 'Rewind conversation to here' })).toBeNull()

    loadHistory([
      {
        ...historyUser('backend-u1', 't1', 'Read this file'),
        attachments: [{ type: 'file', mediaType, name, sizeBytes: 9 }],
      },
    ])
    fireEvent.click(screen.getAllByLabelText('Fork or rewind')[0]!)
    expect(screen.queryByRole('menuitem', { name: 'Rewind conversation to here' })).toBeNull()
    expect(postMessage).not.toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'rewindConversation' }),
    )
  })

  it('keeps rewind on an earlier text card when a later file card shares its turn', () => {
    renderReady()
    loadHistory([
      historyUser('plain-card', 't1', 'First'),
      {
        ...historyUser('file-card', 't1', 'Then this file'),
        attachments: [{ type: 'file', mediaType: 'text/plain', name: 'notes.txt', sizeBytes: 9 }],
      },
    ])
    const menus = screen.getAllByLabelText('Fork or rewind')
    fireEvent.click(menus[0]!)
    expect(
      screen.getByRole('menuitem', { name: 'Rewind conversation to here' }),
    ).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    fireEvent.click(menus[1]!)
    expect(screen.queryByRole('menuitem', { name: 'Rewind conversation to here' })).toBeNull()
  })

  it('uses the backend replay ID for an image card rewound before History reload (M53)', () => {
    const postMessage = renderReady()
    loadHistory([historyUser('u1', 't1', 'first')])
    addTestImage()
    fireEvent.change(textarea(), { target: { value: 'describe this' } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    deliver({
      type: 'turnAccepted',
      localId: 'local-1',
      turnId: 't2',
      userMessageId: 'backend-u2',
    })
    deliver({
      type: 'agentEvent',
      event: { type: 'turnCompleted', turnId: 't2', terminal: 'completed' },
    })
    chooseConversationRewind(1)
    expectRewindRequest(postMessage, {
      itemId: 'backend-u2',
      turnId: 't2',
      lastTurnId: 't1',
      text: 'describe this',
      imageCount: 1,
    })
  })

  it('cuts a steered card before its distinct prior turn and names the exact card (M53)', () => {
    const postMessage = renderReady()
    loadHistory([
      historyUser('u1', 't1', 'first'),
      historyUser('u2', 't2', 'second'),
      historyUser('u3', 't2', 'steered'),
    ])
    chooseConversationRewind(2)
    expectRewindRequest(postMessage, {
      itemId: 'u3',
      turnId: 't2',
      lastTurnId: 't1',
      text: 'steered',
      imageCount: 0,
    })
  })

  it('hides unsafe conversation rewind on a steered first turn (M53)', () => {
    renderReady()
    loadHistory([historyUser('u1', 't1', 'first'), historyUser('u2', 't1', 'steered')])
    fireEvent.click(screen.getAllByLabelText('Fork or rewind')[1]!)
    expect(screen.queryByRole('menuitem', { name: 'Rewind conversation to here' })).toBeNull()
  })

  it('hides conversation rewind for an active steered turn before its image reaches replay (M53)', () => {
    renderReady()
    loadHistory([
      historyUser('u1', 't1', 'completed'),
      historyUser('u2', 't2', 'running'),
      historyUser('u3', 't2', 'steered with image'),
    ])
    deliver({ type: 'agentEvent', event: { type: 'turnStarted', turnId: 't2' } })
    fireEvent.click(screen.getAllByLabelText('Fork or rewind')[2]!)
    expect(screen.queryByRole('menuitem', { name: 'Rewind conversation to here' })).toBeNull()
  })

  it('offers a side chat on a fork-capable session and labels the Plan-mode tab (M53)', () => {
    const postMessage = renderReady()
    deliver({ type: 'sessionInfo', modelId: 'muse-spark-1.3', sessionId: 'old' })
    deliver({
      type: 'historyLoaded',
      sessionId: 'old',
      todos: [],
      items: [
        { itemId: 'u1', kind: 'userMessage', status: 'completed', turnId: 't1', text: 'first' },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Side chat' }))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'openSideChat', sourceSessionId: 'old' })
    deliver({
      ...init,
      sideChat: true,
      settings: { ...testSettings, initialPermissionMode: 'plan' },
    })
    expect(screen.getByText('Side chat')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Side chat' })).toBeNull()
  })

  it('labels a side session resumed through ordinary History and locks its mode (M53)', () => {
    renderReady()
    deliver({
      type: 'historyLoaded',
      sessionId: 'side',
      sideChat: true,
      todos: [],
      items: [{ itemId: 'u1', kind: 'userMessage', status: 'completed', turnId: 't1', text: 'hi' }],
    })
    deliver({ type: 'sessionInfo', modelId: 'muse-spark-1.3', sessionId: 'side', sideChat: true })
    deliver({
      type: 'composerState',
      effort: 'high',
      isThinkingEnabled: true,
      permissionMode: 'plan',
    })
    expect(screen.getByText('Side chat')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: UI_TEXT.sideChatPlanOnly })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Side chat' })).toBeNull()
  })

  it('rewinds code to a message, forks after rewinding, and closes the menu on Escape (M13)', () => {
    const postMessage = renderReady()
    deliver({
      type: 'historyLoaded',
      sessionId: 'old',
      name: 'Resumed',
      todos: [],
      items: [
        { itemId: 'u1', kind: 'userMessage', status: 'completed', turnId: 't1', text: 'first' },
        historyEdit('e1', 't1', 'p1'),
        { itemId: 'u2', kind: 'userMessage', status: 'completed', turnId: 't2', text: 'second' },
        historyEdit('e2', 't2', 'p2'),
      ],
    })
    const menus = screen.getAllByLabelText('Fork or rewind')
    fireEvent.click(menus[0]!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rewind code to here' }))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'rewindCode',
      edits: [
        { itemId: 'e2', outputRef: 'p2' },
        { itemId: 'e1', outputRef: 'p1' },
      ],
    })
    fireEvent.click(menus[1]!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fork conversation and rewind code' }))
    // One host action: the rewind, then the fork (M72), never two racing messages.
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'rewindCode',
      edits: [{ itemId: 'e2', outputRef: 'p2' }],
      fork: { lastTurnId: 't1', attachmentEpoch: 2 },
    })
    fireEvent.click(menus[0]!)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('shows the agents pill once a subagent runs and opens the Agent map from it (M14)', () => {
    const postMessage = renderReady()
    deliver({ type: 'sessionInfo', modelId: 'muse-spark-1.3', sessionId: 's1' })
    deliver({
      type: 'usageReport',
      backend: 'museCode',
      account: { signInMethod: 'cli', delegationMode: 'auto' },
    })
    expect(screen.queryByTitle('Show the agent map')).toBeNull()
    deliver({
      type: 'agentEvent',
      event: {
        type: 'itemStarted',
        item: {
          itemId: 'sa1',
          kind: 'subagent',
          status: 'inProgress',
          role: 'explorer',
          objective: 'Map the workspace',
          childSessionId: 'child-1',
        },
      },
    })
    const pill = screen.getByTitle('Show the agent map')
    expect(pill).toHaveTextContent('1 agent')
    fireEvent.click(pill)
    const map = screen.getByRole('dialog', { name: 'Agent map' })
    expect(map).toHaveTextContent('1 agent · click an agent for details')
    fireEvent.click(screen.getByRole('button', { name: /Map the workspace/ }))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'readChildSession', sessionId: 'child-1' })
    expect(map).toHaveTextContent('Reading the agent’s transcript…')
    deliver({
      type: 'childTranscript',
      sessionId: 'child-1',
      items: [{ itemId: 'a', kind: 'agentMessage', status: 'completed', text: 'Mapped 12 files' }],
    })
    expect(screen.getByRole('list', { name: 'Agent transcript' })).toHaveTextContent(
      'Mapped 12 files',
    )
    fireEvent.click(screen.getByText('Back to the map'))
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Agent map' }), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each(['museCode', 'modelApi'] as const)(
    'shows only verified %s agent result controls through the real App',
    (backend) => {
      const postMessage = renderReady()
      deliver({ type: 'authState', status: 'signedIn', backend })
      deliver({ type: 'sessionInfo', modelId: 'muse-spark-1.3', sessionId: 's1' })
      const started = {
        itemId: 'sa-controls',
        kind: 'subagent',
        status: 'inProgress',
        subagentId: 'sub-controls',
        childSessionId: 'child-controls',
        objective: 'Check controls',
      }
      deliver({ type: 'agentEvent', event: { type: 'itemStarted', item: started } })
      deliver({
        type: 'agentEvent',
        event: {
          type: 'itemCompleted',
          item: {
            ...started,
            status: 'completed',
            controlStatus: 'resultReady',
            result: { summary: 'Done' },
          },
        },
      })
      fireEvent.click(screen.getByTitle('Show the agent map'))
      fireEvent.click(screen.getByRole('button', { name: /Check controls/ }))
      if (backend === 'modelApi') {
        fireEvent.click(screen.getByRole('button', { name: 'Mark result read' }))
        expect(postMessage).toHaveBeenCalledWith({
          type: 'subagentControl',
          subagentId: 'sub-controls',
          action: 'readResult',
        })
      } else {
        expect(screen.queryByRole('button', { name: 'Mark result read' })).toBeNull()
      }
      fireEvent.click(screen.getByRole('button', { name: 'Close agent' }))
      expect(postMessage).toHaveBeenCalledWith({
        type: 'subagentControl',
        subagentId: 'sub-controls',
        action: 'close',
      })
      deliver({
        type: 'agentEvent',
        event: {
          type: 'itemUpdated',
          item: { ...started, status: 'completed', controlStatus: 'closed' },
        },
      })
      expect(screen.queryByRole('button', { name: 'Reopen agent' }) !== null).toBe(
        backend === 'modelApi',
      )
    },
  )

  it('counts a workflow’s agents in the pill and notes the trigger mode (M47)', () => {
    const postMessage = renderReady()
    deliver({ type: 'sessionInfo', modelId: 'muse-spark-1.3', sessionId: 's1' })
    deliver({
      type: 'agentEvent',
      event: {
        type: 'itemStarted',
        item: {
          itemId: 'w1',
          kind: 'workflow',
          status: 'inProgress',
          workflowRunId: 'run-1',
          entryId: 'generated.model-chosen',
          children: [
            { childId: 'c1', attempt: 1, status: 'started', label: 'ping' },
            { childId: 'c2', attempt: 1, status: 'scheduled' },
          ],
        },
      },
    })
    expect(screen.queryByRole('button', { name: 'Cancel workflow' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Skip ping|Retry ping/ })).toBeNull()
    const pill = screen.getByTitle('Show the agent map')
    expect(pill).toHaveTextContent('2 agents')
    fireEvent.click(pill)
    // The map reads the account facts fresh, as the usage dialog does.
    expect(postMessage).toHaveBeenCalledWith({ type: 'readUsage' })
    deliver({
      type: 'usageReport',
      backend: 'museCode',
      account: { signInMethod: 'cli', delegationMode: 'auto', workflowTriggerMode: 'explicit' },
    })
    const map = screen.getByRole('dialog', { name: 'Agent map' })
    expect(within(map).getByRole('list', { name: 'Workflows' })).toHaveTextContent('ping')
    expect(within(map).getByRole('note')).toHaveTextContent('workflows are on explicit')
  })

  it('explains delegation being off in the Agent map and opens the Muse settings file (M14)', () => {
    const postMessage = renderReady()
    deliver({
      type: 'usageReport',
      backend: 'museCode',
      account: { signInMethod: 'cli', delegationMode: 'off' },
    })
    const filter = openPalette()
    fireEvent.change(filter, { target: { value: '/agents' } })
    fireEvent.keyDown(filter, { key: 'Enter' })
    const map = screen.getByRole('dialog', { name: 'Agent map' })
    expect(map).toHaveTextContent('No subagents in this conversation.')
    expect(map).toHaveTextContent('subagent delegation is off')
    fireEvent.click(screen.getByText('Open the Muse Code settings file'))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'hostAction', action: 'openMuseSettings' })
  })

  it('compacts from the context indicator and shows the unsupported-file banner (M14)', () => {
    const postMessage = renderReady()
    deliver({
      type: 'agentEvent',
      event: {
        type: 'contextUsage',
        usedTokens: 120_000,
        windowTokens: 1_000_000,
        pressure: 'normal',
      },
    })
    fireEvent.click(screen.getByRole('button', { name: '12% context' }))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'compact' })
    deliver({ type: 'attachmentRejected', name: 'audio.node', reason: 'not an image' })
    expect(screen.getByText(/Unsupported file type: audio\.node/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(screen.queryByText(/Unsupported file type/)).toBeNull()
  })

  it('renames from the title once a session exists, and not before', () => {
    const postMessage = renderReady()
    expect(screen.queryByTitle('Rename this conversation')).toBeNull()
    deliver({ type: 'sessionInfo', modelId: 'muse-spark-1.3', sessionId: 's1' })
    fireEvent.click(screen.getByTitle('Rename this conversation'))
    const input = screen.getByLabelText<HTMLInputElement>('Rename this conversation')
    expect(input.value).toBe('')
    fireEvent.change(input, { target: { value: 'Parser work' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'renameSession', name: 'Parser work' })
    deliver({ type: 'agentEvent', event: { type: 'sessionNamed', name: 'Parser work' } })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Parser work')
    // Escape and an unchanged name send nothing.
    fireEvent.click(screen.getByTitle('Rename this conversation'))
    fireEvent.keyDown(screen.getByLabelText('Rename this conversation'), { key: 'Escape' })
    fireEvent.click(screen.getByTitle('Rename this conversation'))
    fireEvent.blur(screen.getByLabelText('Rename this conversation'))
    const renames = postMessage.mock.calls.filter(([message]) => message.type === 'renameSession')
    expect(renames).toHaveLength(1)
  })
})

describe('App account & usage, onboarding and announcements (M8)', () => {
  const subscription = {
    observedAtMs: Date.now(),
    tier: 'muse-pro',
    window: { usedPercent: 42, resetsAtMs: Date.now() + 3_600_000, windowDurationMins: 300 },
    weekly: { usedPercent: 7, resetsAtMs: Date.now() + 86_400_000 },
  }

  it('opens Account & usage from /usage, asks the host, renders the report, closes on Escape', () => {
    const postMessage = renderReady()
    const dialog = openUsageDialog()
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'readUsage' })
    expect(dialog.parentElement).toHaveClass('modal-backdrop')
    expect(dialog).toHaveTextContent('Reading usage…')
    deliver({ type: 'usageReport', backend: 'museCode', subscription })
    expect(
      screen.getByRole('progressbar', { name: 'Current window: 42% used' }),
    ).toBeInTheDocument()
    expect(dialog).toHaveTextContent('muse-pro')
    fireEvent.keyDown(screen.getByLabelText('Close'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(textarea())
  })

  it('hides old account usage immediately on the boundary clear before auth replies', () => {
    renderReady()
    const dialog = openUsageDialog()
    deliver({ type: 'usageReport', backend: 'museCode', subscription })
    expect(dialog).toHaveTextContent('muse-pro')
    deliver({ type: 'conversationCleared', accountBoundary: true })
    expect(screen.queryByText('muse-pro')).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Account & usage' })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Connecting to the extension host')
  })

  it('opens the dialog from the Account & usage row and from /cost', () => {
    const postMessage = renderReady()
    let filter = openPalette()
    fireEvent.change(filter, { target: { value: 'Account & usage' } })
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(screen.getByRole('dialog', { name: 'Account & usage' })).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Close'))
    filter = openPalette()
    fireEvent.change(filter, { target: { value: '/cost' } })
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(screen.getByRole('dialog', { name: 'Account & usage' })).toBeInTheDocument()
    expect(postMessage.mock.calls.filter(([m]) => m.type === 'readUsage')).toHaveLength(2)
  })

  it('shows the getting-started tips until the user hides them', () => {
    const postMessage = renderReady()
    expect(screen.getByRole('region', { name: 'Getting started' })).toHaveTextContent('Ctrl+Esc')
    fireEvent.click(screen.getByText('Hide these tips'))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'hostAction', action: 'hideOnboarding' })
    deliver({ type: 'settingsChanged', settings: { ...testSettings, hideOnboarding: true } })
    expect(screen.queryByRole('region', { name: 'Getting started' })).toBeNull()
    expect(screen.getByText(init.emptyStateHint)).toBeInTheDocument()
  })

  it('reads turn ends through a polite live region', () => {
    renderReady()
    deliver({
      type: 'agentEvent',
      event: { type: 'turnCompleted', turnId: 't1', terminal: 'completed' },
    })
    const sentence = screen.getByText('Muse finished responding')
    expect(sentence.parentElement).toHaveAttribute('aria-live', 'polite')
    expect(sentence.parentElement).toHaveClass('sr-only')
  })
})

describe('App: voice dictation (M9)', () => {
  it('posts the microphone press and reflects the host state', () => {
    const postMessage = renderReady()
    fireEvent.pointerDown(screen.getByLabelText('Record voice'))
    expect(postMessage).toHaveBeenCalledWith({ type: 'dictation', action: 'start' })
    deliver({ type: 'dictationState', status: 'listening' })
    expect(screen.getByLabelText('Record voice')).toHaveAttribute('aria-pressed', 'true')
    expect(textarea()).toHaveAttribute('placeholder', 'Listening…')
    deliver({ type: 'insertText', text: 'fix the bug ' })
    expect(textarea()).toHaveValue('fix the bug ')
  })
})

describe('transcript scrolling (M15)', () => {
  it('follows new entries at the end, holds still once scrolled up, and jumps on the button', () => {
    renderReady()
    const main = screen.getByRole('main')
    let top = 0
    const setTop = vi.fn((value: number) => {
      top = value
    })
    Object.defineProperties(main, {
      scrollHeight: { configurable: true, get: () => 1000 },
      clientHeight: { configurable: true, get: () => 400 },
      scrollTop: { configurable: true, get: () => top, set: setTop },
    })

    // The reader's own send always lands at the end.
    fireEvent.change(textarea(), { target: { value: 'hello' } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    expect(setTop).toHaveBeenLastCalledWith(1000)
    expect(screen.queryByRole('button', { name: 'New messages' })).toBeNull()

    // Scrolled up: a new reply holds the view and offers the jump.
    top = 0
    fireEvent.scroll(main)
    setTop.mockClear()
    deliver({ type: 'turnAccepted', localId: 'local-1', turnId: 't1' })
    streamReply('m1', 'hi')
    expect(setTop).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'New messages' }))
    expect(setTop).toHaveBeenLastCalledWith(1000)
    expect(screen.queryByRole('button', { name: 'New messages' })).toBeNull()

    // Pinned to the end again: streaming keeps the view at the end, no button.
    top = 600
    fireEvent.scroll(main)
    setTop.mockClear()
    deliver({
      type: 'agentEvent',
      event: { type: 'textDelta', itemId: 'm1', field: 'text', delta: ' there' },
    })
    expect(setTop).toHaveBeenLastCalledWith(1000)
    expect(screen.queryByRole('button', { name: 'New messages' })).toBeNull()
  })

  it('asks the host to open a tool output in an editor', () => {
    const postMessage = renderReady()
    deliver({ type: 'turnAccepted', localId: 'local-1', turnId: 't1' })
    deliver({
      type: 'agentEvent',
      event: {
        type: 'itemStarted',
        item: {
          itemId: 'sh-000001',
          kind: 'toolCall',
          status: 'inProgress',
          tool: 'powershell',
          args: '{"command":"ls","description":"List files"}',
        },
      },
    })
    deliver({
      type: 'agentEvent',
      event: {
        type: 'itemCompleted',
        item: {
          itemId: 'sh-000001',
          kind: 'toolCall',
          status: 'completed',
          tool: 'powershell',
          args: '{"command":"ls","description":"List files"}',
          visibleOutput: 'a.ts\nb.ts',
        },
      },
    })
    fireEvent.click(screen.getByTitle('Click to open the output in an editor'))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'openOutput',
      itemId: 'sh-000001',
      label: 'PowerShell',
      text: 'a.ts\nb.ts',
    })
  })
})

/** A finished reply, as the host relays one (M17). */
function reply(itemId: string, text: string) {
  deliver({
    type: 'agentEvent',
    event: {
      type: 'itemCompleted',
      item: { itemId, kind: 'agentMessage', status: 'completed', text },
    },
  })
}

describe('App chat references (M17)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('replies to an output from its actions menu and sends the reference with the message', () => {
    const postMessage = renderReady()
    reply('m1', 'Use pnpm.')
    fireEvent.click(screen.getByRole('button', { name: 'Message actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reply to this output' }))
    expect(screen.getByText('Replying to: Use pnpm.')).toBeInTheDocument()
    fireEvent.change(textarea(), { target: { value: 'why?' } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'sendMessage',
      localId: 'local-1',
      text: 'why?',
      attachmentIds: [],
      includeEditorContext: false,
      reference: { intent: 'reply', role: 'assistant', entryId: 'm1', text: 'Use pnpm.' },
    })
    // The composer chip is gone; the sent card carries the label.
    expect(screen.queryByLabelText('Remove: Replying to: Use pnpm.')).toBeNull()
    expect(screen.getByText('Replying to: Use pnpm.').closest('.message-user')).not.toBeNull()
  })

  it('asks about highlighted text from the right-click menu, and the chip can be removed', () => {
    const postMessage = renderReady()
    reply('m1', 'Use pnpm because it is fast.')
    const passage = screen.getByText('Use pnpm because it is fast.')
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => ' it is fast ',
      anchorNode: passage,
    } as unknown as Selection)
    fireEvent.contextMenu(passage)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ask about this' }))
    expect(screen.getByText('Asking about: it is fast')).toBeInTheDocument()
    fireEvent.change(textarea(), { target: { value: 'how fast?' } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: 'how fast?',
        reference: { intent: 'question', role: 'assistant', entryId: 'm1', text: 'it is fast' },
      }),
    )
    fireEvent.contextMenu(passage)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Comment on this' }))
    fireEvent.click(screen.getByLabelText('Remove: Commenting on: it is fast'))
    expect(screen.queryByText('Commenting on: it is fast')).toBeNull()
  })

  it('leaves the browser menu alone without a selection, and Escape closes ours', () => {
    renderReady()
    reply('m1', 'plain')
    const passage = screen.getByText('plain')
    const empty = vi
      .spyOn(window, 'getSelection')
      .mockReturnValue({ toString: () => '', anchorNode: passage } as unknown as Selection)
    expect(fireEvent.contextMenu(passage)).toBe(true)
    expect(screen.queryByRole('menu')).toBeNull()
    empty.mockReturnValue({ toString: () => 'plain', anchorNode: passage } as unknown as Selection)
    expect(fireEvent.contextMenu(passage)).toBe(false)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('App webview and UI state (M25)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('clears for a keybinding, but a message sent right after its own clear survives the echo', () => {
    const postMessage = renderReady()
    fireEvent.change(textarea(), { target: { value: 'first' } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    fireEvent.click(screen.getByLabelText('New conversation'))
    fireEvent.change(textarea(), { target: { value: 'second' } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'clearConversation' }))
    deliver({ type: 'conversationCleared' })
    expect(screen.getByText('second')).toBeInTheDocument()
    // Ctrl+N from VS Code: only the host's clear arrives.
    deliver({ type: 'conversationCleared' })
    expect(screen.queryByText('second')).toBeNull()
    expect(screen.getByText(init.emptyStateHint)).toBeInTheDocument()
  })

  it('tells the host it has the focus, so the keybindings act on this panel', () => {
    const postMessage = renderReady()
    act(() => {
      window.dispatchEvent(new FocusEvent('focus'))
    })
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'surfaceFocused' })
  })

  it("offers the browser's Copy in the highlighted-text menu", () => {
    const postMessage = renderReady()
    reply('m1', 'Use pnpm because it is fast.')
    const passage = screen.getByText('Use pnpm because it is fast.')
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'it is fast',
      anchorNode: passage,
    } as unknown as Selection)
    fireEvent.contextMenu(passage)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'copyText', text: 'it is fast' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('makes everything behind a modal inert', () => {
    renderReady()
    openUsageDialog()
    expect(screen.getByRole('main')).toHaveAttribute('inert')
    expect(document.querySelector('.composer-area')).toHaveAttribute('inert')
    expect(document.querySelector('.header-area')).toHaveAttribute('inert')
    fireEvent.click(screen.getByLabelText('Close'))
    expect(screen.getByRole('main')).not.toHaveAttribute('inert')
  })

  it('keeps the end in view when the content grows without a new row', () => {
    const observed: { callback: (() => void) | undefined } = { callback: undefined }
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public constructor(callback: () => void) {
          observed.callback = callback
        }
        public observe(): void {
          // The test calls the callback itself.
        }
        public disconnect(): void {
          observed.callback = undefined
        }
      },
    )
    renderReady()
    reply('m1', 'hello')
    const main = screen.getByRole('main')
    let top = 0
    const setTop = vi.fn((value: number) => {
      top = value
    })
    let height = 1000
    Object.defineProperties(main, {
      scrollHeight: { configurable: true, get: () => height },
      clientHeight: { configurable: true, get: () => 400 },
      scrollTop: { configurable: true, get: () => top, set: setTop },
    })
    height = 1500
    observed.callback?.()
    expect(setTop).toHaveBeenLastCalledWith(1500)
    // Scrolled up, a growing row leaves the view alone.
    top = 0
    fireEvent.scroll(main)
    setTop.mockClear()
    height = 1800
    observed.callback?.()
    expect(setTop).not.toHaveBeenCalled()
  })

  it('says so when a reply links to a file outside the workspace', () => {
    const postMessage = renderReady()
    reply('m1', 'See [the key](../../.ssh/id_rsa).')
    fireEvent.click(screen.getByRole('link', { name: 'the key' }))
    expect(screen.getByRole('list', { name: 'Conversation' })).toHaveTextContent(
      UI_TEXT.linkOutsideWorkspace,
    )
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'openFile' }))
  })

  it('posts a question answer once, however often Submit is pressed', () => {
    const postMessage = renderReady()
    askColour()

    fireEvent.click(screen.getByText('Submit'))
    fireEvent.click(screen.getByText('Submit'))
    fireEvent.click(screen.getByText('Cancel'))
    const answers = () =>
      postMessage.mock.calls.filter(
        ([message]) => message.type === 'answerQuestion' || message.type === 'cancelQuestion',
      )
    expect(answers()).toHaveLength(1)
    // The host refused the answer: the card opens again for another try.
    deliver({ type: 'notice', level: 'error', text: 'The answer was not accepted: gone' })
    fireEvent.click(screen.getByText('Submit'))
    expect(answers()).toHaveLength(2)
  })

  it("asks the host to drop a refused message's images when it cannot say it kept them", () => {
    const postMessage = renderReady()
    deliver({
      type: 'attachmentAdded',
      attachment: {
        id: 'a1',
        name: 'x.png',
        mediaType: 'image/png',
        width: 1,
        height: 1,
        sizeBytes: 1,
      },
    })
    fireEvent.change(textarea(), { target: { value: 'see' } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    deliver({ type: 'sendFailed', localId: 'local-1', reason: 'CLI exited' })
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'removeAttachment', id: 'a1' })
    expect(screen.queryByLabelText('Remove x.png')).toBeNull()
  })
})

/** Types `text` into the prompt and presses Enter. */
function send(text: string) {
  fireEvent.change(textarea(), { target: { value: text } })
  fireEvent.keyDown(textarea(), { key: 'Enter' })
}

function showGoal() {
  deliver({
    type: 'agentEvent',
    event: {
      type: 'goalChanged',
      goal: { objective: 'Original objective', status: 'active', percentComplete: 10 },
    },
  })
  return screen.getByRole('region', { name: 'Session goal' })
}

describe('App: the session goal (M45)', () => {
  it('keeps the exact inline edit through refusal, then closes on acceptance', () => {
    const postMessage = renderReady()
    const strip = showGoal()
    const edit = within(strip).getByRole('button', { name: 'Edit' })
    fireEvent.click(edit)
    const field = within(strip).getByRole('textbox', { name: 'Goal objective' })
    const rawDraft = `  ${'Long objective '.repeat(60)}  `
    fireEvent.change(field, { target: { value: rawDraft } })
    fireEvent.click(within(strip).getByRole('button', { name: 'Save' }))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'goalCommand',
      requestId: 'goal:local-1:1',
      verb: 'edit',
      objective: rawDraft.trim(),
    })
    expect(field).toHaveValue(rawDraft)
    expect(within(strip).getByRole('button', { name: 'Save' })).toBeDisabled()
    deliver({ type: 'goalCommandResult', requestId: 'goal:local-1:1', accepted: false })
    expect(field).toHaveValue(rawDraft)
    expect(within(strip).getByRole('button', { name: 'Save' })).toBeEnabled()
    fireEvent.change(field, { target: { value: 'Accepted objective' } })
    fireEvent.click(within(strip).getByRole('button', { name: 'Save' }))
    deliver({
      type: 'agentEvent',
      event: {
        type: 'goalChanged',
        goal: { objective: 'Accepted objective', status: 'active', percentComplete: 10 },
      },
    })
    deliver({ type: 'goalCommandResult', requestId: 'goal:local-1:2', accepted: true })
    expect(within(strip).queryByRole('textbox', { name: 'Goal objective' })).toBeNull()
    expect(edit).toHaveFocus()
  })

  it('preserves newer inline typing when the old edit changes the goal before its result', () => {
    const postMessage = renderReady()
    const strip = showGoal()
    fireEvent.click(within(strip).getByRole('button', { name: 'Edit' }))
    const field = within(strip).getByRole('textbox', { name: 'Goal objective' })
    fireEvent.change(field, { target: { value: 'First edit' } })
    fireEvent.click(within(strip).getByRole('button', { name: 'Save' }))
    fireEvent.change(field, { target: { value: 'Newer unsent edit' } })
    deliver({
      type: 'agentEvent',
      event: {
        type: 'goalChanged',
        goal: { objective: 'First edit', status: 'active', percentComplete: 20 },
      },
    })
    expect(field).toHaveValue('Newer unsent edit')
    deliver({ type: 'goalCommandResult', requestId: 'goal:local-1:1', accepted: true })
    expect(field).toHaveValue('Newer unsent edit')
    fireEvent.click(within(strip).getByRole('button', { name: 'Save' }))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'goalCommand',
      requestId: 'goal:local-1:2',
      verb: 'edit',
      objective: 'Newer unsent edit',
    })
  })

  it('updates an open inline editor for external objective changes, but keeps progress typing', () => {
    renderReady()
    const strip = showGoal()
    fireEvent.click(within(strip).getByRole('button', { name: 'Edit' }))
    const field = within(strip).getByRole('textbox', { name: 'Goal objective' })
    fireEvent.change(field, { target: { value: 'My unfinished edit' } })
    deliver({
      type: 'agentEvent',
      event: {
        type: 'goalChanged',
        goal: { objective: 'Original objective', status: 'active', percentComplete: 25 },
      },
    })
    expect(field).toHaveValue('My unfinished edit')
    deliver({
      type: 'agentEvent',
      event: {
        type: 'goalChanged',
        goal: { objective: 'External objective', status: 'active', percentComplete: 25 },
      },
    })
    expect(field).toHaveValue('External objective')
  })

  it('sends /goal as a command to the host, never as a message', () => {
    const postMessage = renderReady()
    send('/goal Make the parser tests pass')
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'goalCommand',
      requestId: 'goal:local-1:1',
      verb: 'set',
      objective: 'Make the parser tests pass',
    })
    expect(textarea()).toHaveValue('/goal Make the parser tests pass')
    deliver({ type: 'goalCommandResult', requestId: 'goal:local-1:1', accepted: true })
    expect(textarea()).toHaveValue('')
    send('/goal pause')
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'goalCommand',
      requestId: 'goal:local-1:2',
      verb: 'pause',
    })
    deliver({ type: 'goalCommandResult', requestId: 'goal:local-1:2', accepted: true })
    send('/goal edit Ship on Friday')
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'goalCommand',
      requestId: 'goal:local-1:3',
      verb: 'edit',
      objective: 'Ship on Friday',
    })
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'sendMessage' }))
    expect(screen.queryByText('/goal pause')).toBeNull()
  })

  it('keeps a refused /goal draft and never clears a newer edit on a late acceptance', () => {
    renderReady()
    send('/goal First objective')
    deliver({ type: 'goalCommandResult', requestId: 'goal:local-1:1', accepted: false })
    expect(textarea()).toHaveValue('/goal First objective')
    send('/goal First objective')
    fireEvent.change(textarea(), { target: { value: '/goal Newer objective' } })
    deliver({ type: 'goalCommandResult', requestId: 'goal:local-1:2', accepted: true })
    expect(textarea()).toHaveValue('/goal Newer objective')
    send('/goal Newer objective')
    deliver({ type: 'goalCommandResult', requestId: 'goal:local-1:2', accepted: true })
    expect(textarea()).toHaveValue('/goal Newer objective')
    deliver({ type: 'goalCommandResult', requestId: 'goal:local-1:3', accepted: true })
    expect(textarea()).toHaveValue('')
  })

  it('does not clear a retyped identical draft after command acceptance', () => {
    renderReady()
    send('/goal Ship it')
    fireEvent.change(textarea(), { target: { value: '/goal Different' } })
    fireEvent.change(textarea(), { target: { value: '/goal Ship it' } })
    deliver({ type: 'goalCommandResult', requestId: 'goal:local-1:1', accepted: true })
    expect(textarea()).toHaveValue('/goal Ship it')
  })

  it('does not submit the same pending command twice', () => {
    const postMessage = renderReady()
    send('/goal Ship it')
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    expect(
      postMessage.mock.calls.filter(([message]) => message.type === 'goalCommand'),
    ).toHaveLength(1)
  })

  it('readies /goal for an objective from the slash list and the palette, and asks for one', () => {
    const postMessage = renderReady()
    const box = textarea()
    box.focus()
    fireEvent.change(box, { target: { value: '/goal' } })
    const list = screen.getByRole('listbox', { name: 'Slash commands' })
    expect(within(list).getAllByRole('option')[0]).toHaveTextContent('/goal')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(box).toHaveValue('/goal ')
    // Enter with no objective: said, and nothing sent.
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.getByRole('list', { name: 'Conversation' })).toHaveTextContent(
      UI_TEXT.goalObjectiveMissing,
    )
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'goalCommand' }))
    expect(box).toHaveValue('/goal ')
    fireEvent.change(box, { target: { value: '' } })
    const filter = openPalette()
    fireEvent.change(filter, { target: { value: '/goal' } })
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(textarea()).toHaveValue('/goal ')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the goal the host reports above the composer, with its verbs', () => {
    const postMessage = renderReady()
    expect(screen.queryByRole('region', { name: 'Session goal' })).toBeNull()
    deliver({
      type: 'agentEvent',
      event: {
        type: 'goalChanged',
        goal: { objective: 'Ship it', status: 'active', percentComplete: 30 },
      },
    })
    const strip = screen.getByRole('region', { name: 'Session goal' })
    expect(strip).toHaveTextContent('Ship it')
    fireEvent.click(within(strip).getByRole('button', { name: 'Pause' }))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'goalCommand',
      requestId: 'goal:local-1:1',
      verb: 'pause',
    })
    deliver({ type: 'agentEvent', event: { type: 'goalChanged', goal: null } })
    expect(screen.queryByRole('region', { name: 'Session goal' })).toBeNull()
  })
})

describe('App: Model API scheduled prompts (M52)', () => {
  it('routes /loop create, list and cancel locally, with no sendMessage', () => {
    const postMessage = renderReady()
    deliver({ type: 'authState', status: 'signedIn', backend: 'modelApi' })
    send('/loop 10m Review tests')
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'scheduleCreate',
      cadence: { kind: 'interval', everyMs: 600_000 },
      prompt: 'Review tests',
    })
    send('/loop list')
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'scheduleList' })
    send('/loop cancel job-a')
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'scheduleCancel', id: 'job-a' })
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'sendMessage' }))
  })

  it('shows a due job, opens the paid gate, and only sends Run after it is on', () => {
    const postMessage = renderReady()
    deliver({ type: 'authState', status: 'signedIn', backend: 'modelApi' })
    deliver({
      type: 'agentEvent',
      event: {
        type: 'schedulesChanged',
        jobs: [
          {
            id: 'job-a',
            prompt: 'Review tests',
            cadence: { kind: 'interval', everyMs: 600_000 },
            nextFireAtMs: 0,
            fireCount: 0,
          },
        ],
      },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Enable paid runs for scheduled prompt job-a' }),
    )
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'setPaidFeature',
      feature: 'scheduledPrompts',
      isOn: true,
    })
    deliver({
      type: 'paidState',
      state: {
        features: ['scheduledPrompts'],
        tally: { webSearches: 0, images: 0, voiceSeconds: 0, scheduledRuns: 0 },
        isKeyStored: true,
        alwaysAllowed: [],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run scheduled prompt job-a' }))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'scheduleRun',
      id: 'job-a',
      occurrenceMs: 0,
    })
  })

  it('passes Muse Code /loop text to its model-mediated cron tools', () => {
    const postMessage = renderReady()
    deliver({ type: 'authState', status: 'signedIn', backend: 'museCode' })
    send('/loop 10m Review tests')
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sendMessage', text: '/loop 10m Review tests' }),
    )
  })

  it('renders a share file read-only, code copyable but never applied, and closes it (M84)', () => {
    const postMessage = renderReady()
    deliver({
      type: 'sharePreview',
      title: 'Shared over',
      exportedAt: '2026-09-28T12:00:00.000Z',
      sourceBackend: 'museCode',
      modelId: 'muse-spark-1.3',
      redacted: true,
      items: [
        { itemId: 'dup', kind: 'userMessage', status: 'completed', text: 'Hi there' },
        {
          itemId: 'dup',
          kind: 'toolCall',
          status: 'completed',
          tool: 'read_file',
          args: '{"path":"notes.md"}',
          visibleOutput: 'line one',
        },
        {
          itemId: 'a1',
          kind: 'agentMessage',
          status: 'completed',
          text: 'Run this:\n\n```sh\nrm -rf build\n```',
        },
      ],
    })
    const dialog = screen.getByRole('dialog', { name: 'Shared over' })
    expect(within(dialog).getByText('Hi there')).toBeInTheDocument()
    expect(within(dialog).getByText('Tool: read_file')).toBeInTheDocument()
    expect(
      within(dialog).getByText(`${UI_TEXT.shareReadOnly} ${UI_TEXT.shareRedacted}`),
    ).toBeInTheDocument()
    // Every code block copies (the tool's arguments and output are blocks too),
    // and nothing here can reach the editor or a session.
    const copies = within(dialog).getAllByRole('button', { name: UI_TEXT.copyCode })
    expect(copies).toHaveLength(3)
    expect(within(dialog).queryAllByRole('button', { name: UI_TEXT.insertCode })).toEqual([])
    expect(within(dialog).queryAllByRole('button', { name: UI_TEXT.applyCode })).toEqual([])
    expect(within(dialog).queryByRole('button', { name: 'Send' })).toBeNull()
    fireEvent.click(copies[2]!)
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'copyText', text: 'rm -rf build' })
    fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.usageClose }))
    expect(screen.queryByRole('dialog', { name: 'Shared over' })).toBeNull()
  })
})

/** The host says which turns of conversation `old` have a checkpoint (M72). */
function checkpointed(turnIds: readonly string[], availability = 'on') {
  deliver({
    type: 'checkpointState',
    canRestore: availability === 'on' || availability === 'off',
    legacyTurnIds: [],
    availability,
    sessionId: 'old',
    turnIds,
  })
}

function openMenu(cardIndex: number) {
  fireEvent.click(screen.getAllByLabelText('Fork or rewind')[cardIndex]!)
}

function rowNames() {
  return within(screen.getByRole('menu'))
    .getAllByRole('menuitem')
    .map((row) => row.textContent)
}

describe('App turn checkpoints (M72)', () => {
  it('offers Restore files and Both on a turn with a checkpoint, the old rows on one without', () => {
    renderReady()
    loadHistory([historyUser('u1', 't1', 'first'), historyUser('u2', 't2', 'second')])
    checkpointed(['t2'])
    openMenu(1)
    expect(rowNames()).toEqual([
      'Fork conversation from here',
      'Rewind conversation to here',
      'Restore files to here',
      'Rewind code to here',
      'Rewind conversation and restore files',
    ])
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    openMenu(0)
    expect(rowNames()).toEqual([
      'Fork conversation from here',
      'Rewind conversation to here',
      'Rewind code to here',
      'Fork conversation and rewind code',
    ])
  })

  it('asks the host to restore the files, or the files and the conversation', () => {
    const postMessage = renderReady()
    loadHistory([historyUser('u1', 't1', 'first'), historyUser('u2', 't2', 'second')])
    checkpointed(['t2'])
    openMenu(1)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Restore files to here' }))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'restoreFiles',
      sourceSessionId: 'old',
      turnId: 't2',
    })
    openMenu(1)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rewind conversation and restore files' }))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'restoreFiles',
      sourceSessionId: 'old',
      turnId: 't2',
      rewind: {
        type: 'rewindConversation',
        sourceSessionId: 'old',
        itemId: 'u2',
        turnId: 't2',
        lastTurnId: 't1',
        text: 'second',
        imageCount: 0,
        attachmentEpoch: 2,
      },
    })
  })

  it('offers the restore on the first card of a turn only', () => {
    renderReady()
    loadHistory([historyUser('u1', 't1', 'first'), historyUser('u1b', 't1', 'a steer')])
    checkpointed(['t1'])
    openMenu(1)
    expect(screen.queryByRole('menuitem', { name: 'Restore files to here' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    openMenu(0)
    expect(screen.getByRole('menuitem', { name: 'Restore files to here' })).toBeInTheDocument()
  })

  it('ignores the checkpoints of another conversation', () => {
    renderReady()
    loadHistory([historyUser('u1', 't1', 'first')])
    deliver({
      type: 'checkpointState',
      canRestore: true,
      legacyTurnIds: [],
      availability: 'on',
      sessionId: 'elsewhere',
      turnIds: ['t1'],
    })
    openMenu(0)
    expect(screen.queryByRole('menuitem', { name: 'Restore files to here' })).toBeNull()
  })

  it('says why there is no file restore in Restricted Mode, and no conversation rewind on Windows', () => {
    renderReady()
    loadHistory([historyUser('u1', 't1', 'first'), historyUser('u2', 't2', 'second')])
    checkpointed([], 'restricted')
    deliver({
      type: 'sessionInfo',
      modelId: 'muse-spark-1.3',
      sessionId: 'old',
      canEditSessions: false,
    })
    openMenu(1)
    const note = screen.getByRole('menuitem', { name: UI_TEXT.checkpointsRestricted })
    expect(note).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByRole('menuitem', { name: UI_TEXT.conversationRewindUnavailable }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('menuitem', { name: 'Rewind conversation to here' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Restore files to here' })).toBeNull()
  })

  it('says git is missing where a file restore would be', () => {
    renderReady()
    loadHistory([historyUser('u1', 't1', 'first')])
    checkpointed([], 'noGit')
    openMenu(0)
    expect(screen.getByRole('menuitem', { name: UI_TEXT.checkpointsNoGit })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('offers Restore files but not Both where the conversation cannot rewind', () => {
    renderReady()
    loadHistory([historyUser('u1', 't1', 'first'), historyUser('u2', 't2', 'second')])
    checkpointed(['t2'])
    deliver({
      type: 'sessionInfo',
      modelId: 'muse-spark-1.3',
      sessionId: 'old',
      canEditSessions: false,
    })
    openMenu(1)
    expect(rowNames()).toEqual([
      'Restore files to here',
      'Rewind code to here',
      UI_TEXT.conversationRewindUnavailable,
    ])
  })

  it("puts a Redo on the restore's notice, held while it runs and kept when it could not do everything", () => {
    const postMessage = renderReady()
    loadHistory([historyUser('u1', 't1', 'first')])
    checkpointed(['t1'])
    deliver({
      type: 'notice',
      level: 'info',
      text: 'Restored 2 files to before this message.',
      redoRestoreId: 'r1',
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.redoLabel }))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'redoRestore', restoreId: 'r1' })
    expect(screen.getByRole('button', { name: UI_TEXT.redoLabel })).toBeDisabled()
    deliver({ type: 'restoreRedone', restoreId: 'r1', isSpent: false })
    expect(screen.getByRole('button', { name: UI_TEXT.redoLabel })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.redoLabel }))
    deliver({ type: 'restoreRedone', restoreId: 'r1', isSpent: true })
    expect(screen.queryByRole('button', { name: UI_TEXT.redoLabel })).toBeNull()
    expect(screen.getByText('Restored 2 files to before this message.')).toBeInTheDocument()
  })

  it.each(['modelApiOnly', 'nativeUnsafe'] as const)(
    'keeps stored Restore and Redo read-only for %s',
    (restoreBlocker) => {
      renderReady()
      loadHistory([historyUser('u1', 't1', 'first')])
      deliver({ type: 'notice', level: 'info', text: 'Saved restore', redoRestoreId: 'old-redo' })
      deliver({
        type: 'checkpointState',
        availability: 'on',
        canRestore: false,
        legacyTurnIds: [],
        restoreBlocker,
        sessionId: 'old',
        turnIds: ['t1'],
      })
      expect(screen.queryByRole('button', { name: UI_TEXT.redoLabel })).toBeNull()
      openMenu(0)
      expect(screen.queryByRole('menuitem', { name: UI_TEXT.restoreFilesToHere })).toBeNull()
      expect(screen.queryByRole('menuitem', { name: UI_TEXT.rewindAndRestore })).toBeNull()
      const reason =
        restoreBlocker === 'modelApiOnly'
          ? UI_TEXT.checkpointsModelApiOnly
          : UI_TEXT.checkpointsNativeUnsafe
      expect(screen.getByRole('menuitem', { name: reason })).toHaveAttribute(
        'aria-disabled',
        'true',
      )
      expect(screen.getByText('Saved restore')).toBeInTheDocument()
    },
  )
  it('labels preserved legacy checkpoints read-only without offering destructive restore', () => {
    renderReady()
    loadHistory([historyUser('u1', 't1', 'legacy message')])
    deliver({
      type: 'checkpointState',
      availability: 'on',
      canRestore: true,
      legacyTurnIds: ['t1'],
      sessionId: 'old',
      turnIds: [],
    })
    openMenu(0)
    expect(screen.queryByRole('menuitem', { name: UI_TEXT.restoreFilesToHere })).toBeNull()
    expect(
      screen.getByRole('menuitem', { name: UI_TEXT.checkpointsLegacyReadOnly }),
    ).toHaveAttribute('aria-disabled', 'true')
  })
})
