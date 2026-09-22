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
    })
    expect(textarea()).toHaveValue('')
    // The chip leaves the composer and rides along in the user card.
    expect(screen.queryByLabelText('Remove shot.png')).toBeNull()
    expect(screen.getByText('shot.png').closest('.message-user')).not.toBeNull()
    expect(screen.getByText('hello muse')).toBeInTheDocument()

    deliver({ type: 'turnAccepted', localId: 'local-1', turnId: 't1' })
    expect(screen.getByLabelText('Stop')).toBeInTheDocument()
    deliver({
      type: 'agentEvent',
      event: {
        type: 'itemStarted',
        item: { itemId: 'm1', kind: 'agentMessage', status: 'inProgress' },
      },
    })
    deliver({
      type: 'agentEvent',
      event: { type: 'textDelta', itemId: 'm1', field: 'text', delta: 'hi there' },
    })
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
    expect(screen.getByText('12% context')).toHaveAttribute('title', '120K of 1M tokens (normal)')
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
