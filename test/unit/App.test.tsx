// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebviewToHostMessage } from '../../src/shared/protocol'
import { App } from '../../src/webview/App'
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
}

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

describe('App shell', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('announces ready to the host on mount', () => {
    const postMessage = vi.fn()
    render(<App postMessage={postMessage} />)
    expect(postMessage).toHaveBeenCalledWith({ type: 'ready' })
  })

  it('shows a connecting status until init arrives', () => {
    render(<App postMessage={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('Connecting to the extension host')
    expect(screen.queryByLabelText('Message Muse')).toBeNull()
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
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'clearConversation' })
    expect(screen.queryByText('hello')).toBeNull()
    expect(screen.getByText(init.emptyStateHint)).toBeInTheDocument()
  })

  it('keeps the shown session in the webview state for the reload serializer (M12)', () => {
    const persistState = vi.fn()
    render(<App postMessage={vi.fn()} persistState={persistState} />)
    expect(persistState).toHaveBeenLastCalledWith({})
    deliver(init)
    deliver({ type: 'authState', status: 'signedIn' })
    deliver({ type: 'sessionInfo', modelId: 'muse-spark-1.3', sessionId: 's1' })
    expect(persistState).toHaveBeenLastCalledWith({ sessionId: 's1' })
    deliver({ type: 'sessionInfo', modelId: 'muse-spark-1.3' })
    expect(persistState).toHaveBeenLastCalledWith({})
  })

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

  it('shows the waiting state while the browser sign-in runs', () => {
    renderReady('signedOut')
    deliver({ type: 'authState', status: 'signingIn', detail: 'Waiting for the browser…' })
    expect(screen.getByText('Waiting for the browser…')).toBeInTheDocument()
    expect(screen.queryByText('Sign in with your Meta account')).toBeNull()
  })
})

describe('App conversation', () => {
  it('sends the draft with attachment ids, echoes it, and streams the reply', () => {
    const postMessage = renderReady()
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
    expect(screen.getByRole('alert')).toHaveTextContent('Open a folder first')
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
      'ManualMuse will ask for approval before making each editCurrent',
      'Edit automaticallyMuse will edit files without asking and ask for everything else',
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

describe('App palette', () => {
  it('opens from the "/" key, asks for skills once, and closes back to the composer', () => {
    const postMessage = renderReady()
    fireEvent.keyDown(textarea(), { key: '/' })
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
    expect(postMessage).toHaveBeenCalledWith({ type: 'clearConversation' })
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
    expect(screen.getByRole('status')).toHaveTextContent('Reasoning effort could not be applied')
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
          patchRef: { id: 'tool_patch-1', byteLen: 300 },
        },
      },
    })
    fireEvent.click(screen.getByText('Open diff'))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'openEditDiff',
      itemId: 'ed',
      outputRef: 'tool_patch-1',
    })
    fireEvent.click(screen.getByText('Revert'))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'revertEdit',
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
    fireEvent.click(screen.getByLabelText('Archive: Old prompt'))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'setSessionArchived',
      sessionId: 'old',
      isArchived: true,
    })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(postMessage).toHaveBeenCalledWith({ type: 'resumeSession', sessionId: 'old' })
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
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'forkSession', lastTurnId: 't1' })
    expect(screen.queryByRole('menu')).toBeNull()
    // Before the first message there is nothing to keep: a new conversation.
    fireEvent.click(menus[0]!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fork conversation from here' }))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'clearConversation' })
    expect(screen.queryByText('first')).toBeNull()
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
    expect(postMessage.mock.calls.slice(-2).map(([message]) => message)).toEqual([
      { type: 'rewindCode', edits: [{ itemId: 'e2', outputRef: 'p2' }] },
      { type: 'forkSession', lastTurnId: 't1' },
    ])
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
    expect(screen.getByRole('alert')).toHaveTextContent('Unsupported file type: audio.node')
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(screen.queryByRole('alert')).toBeNull()
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
    const filter = openPalette()
    fireEvent.change(filter, { target: { value: '/usage' } })
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'readUsage' })
    const dialog = screen.getByRole('dialog', { name: 'Account & usage' })
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
    fireEvent.click(screen.getByText('List files').closest('button') as HTMLElement)
    fireEvent.click(screen.getByTitle('Click to open the output in an editor'))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'openOutput',
      itemId: 'sh-000001',
      label: 'PowerShell',
      text: 'a.ts\nb.ts',
    })
  })
})
