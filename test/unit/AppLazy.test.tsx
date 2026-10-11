// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { UI_TEXT } from '../../src/shared/constants'
import { setUiText } from '../../src/shared/l10n/text'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { App } from '../../src/webview/App'
import { testSettings } from './helpers/fakes'

const held = vi.hoisted(() => ({
  git: Promise.withResolvers<undefined>(),
  usage: Promise.withResolvers<undefined>(),
  gitLoads: 0,
  usageLoads: 0,
  share: Promise.withResolvers<undefined>(),
  shareLoads: 0,
  handoffLoads: 0,
  secretLoads: 0,
  boardLoads: 0,
  legal: Promise.withResolvers<undefined>(),
  legalLoads: 0,
  prompts: Promise.withResolvers<undefined>(),
  promptsLoads: 0,
  chat: Promise.withResolvers<undefined>(),
  chatLoads: 0,
  diffLoads: 0,
  todoLoads: 0,
}))

vi.mock('../../src/webview/components/GitPanel', async (original) => {
  held.gitLoads += 1
  await held.git.promise
  return await original()
})
vi.mock('../../src/webview/components/UsageDialog', async (original) => {
  held.usageLoads += 1
  await held.usage.promise
  return await original()
})

vi.mock('../../src/webview/components/ShareView', async (original) => {
  held.shareLoads += 1
  await held.share.promise
  return await original()
})
vi.mock('../../src/webview/components/HandoffDialog', async (original) => {
  held.handoffLoads += 1
  return await original()
})
vi.mock('../../src/webview/components/SecretPromptDialog', async (original) => {
  held.secretLoads += 1
  return await original()
})
vi.mock('../../src/webview/components/SessionBoardDialog', async (original) => {
  held.boardLoads += 1
  return await original()
})
vi.mock('../../src/webview/components/LegalReport', async (original) => {
  held.legalLoads += 1
  await held.legal.promise
  return await original()
})

vi.mock('../../src/webview/prompts/PromptLibraryBridge', async (original) => {
  held.promptsLoads += 1
  await held.prompts.promise
  return await original()
})
vi.mock('../../src/webview/sharing/ChatShareBridge', async (original) => {
  held.chatLoads += 1
  await held.chat.promise
  return await original()
})
vi.mock('../../src/webview/components/DiffTally', async (original) => {
  held.diffLoads += 1
  return await original()
})
vi.mock('../../src/webview/components/TodoPanel', async (original) => {
  held.todoLoads += 1
  return await original()
})

function deliver(message: HostToWebviewMessage): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: message }))
  })
}

function initializedApp() {
  const postMessage = vi.fn()
  render(<App postMessage={postMessage} />)
  deliver({ type: 'init', settings: testSettings, emptyStateHint: '', composerPlaceholder: '' })
  deliver({ type: 'authState', status: 'signedIn' })
  expect(screen.getByLabelText('Message Muse')).toBeInTheDocument()
  return postMessage
}

function dismissLoadingModal() {
  const loading = screen.getByRole('dialog', { name: EN.loadingOutput })
  expect(screen.getByRole('main')).toHaveAttribute('inert')
  fireEvent.keyDown(within(loading).getByLabelText('Close'), { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('main')).not.toHaveAttribute('inert')
  expect(document.activeElement).toBe(screen.getByLabelText('Message Muse'))
}

afterEach(() => {
  setUiText(EN, 'en')
})

describe('App while its deferred panels load', () => {
  it('waits for use, keeps new form state and language, and lets a loading modal close', async () => {
    const postMessage = initializedApp()
    expect(held.gitLoads).toBe(0)
    expect(held.usageLoads).toBe(0)
    expect(held.shareLoads).toBe(0)
    expect(held.handoffLoads).toBe(0)
    expect(held.secretLoads).toBe(0)
    expect(held.boardLoads).toBe(0)
    expect(held.legalLoads).toBe(0)

    const legal: Extract<HostToWebviewMessage, { type: 'legalScanReport' }> = {
      type: 'legalScanReport',
      requestId: 'legal-first',
      result: {
        version: 1,
        ruleVersion: '1',
        dataVersion: '2026-10-04',
        scope: '',
        distribution: 'source checkout, undistributed',
        exclusions: [],
        incompleteChecks: [],
        findings: [],
      },
    }
    const composer = screen.getByLabelText('Message Muse')
    composer.focus()
    deliver(legal)
    expect(screen.getByRole('dialog', { name: EN.loadingOutput })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('inert')
    await waitFor(() => {
      expect(held.legalLoads).toBe(1)
    })
    deliver({ ...legal, requestId: 'legal-latest', result: { ...legal.result, scope: 'src' } })
    const legalLoading = screen.getByRole('dialog', { name: EN.loadingOutput })
    fireEvent.keyDown(within(legalLoading).getByLabelText('Close'), { key: 'Escape' })
    expect(document.activeElement).toBe(composer)
    await act(async () => {
      held.legal.resolve(undefined)
      await held.legal.promise
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    deliver({ ...legal, requestId: 'legal-latest', result: { ...legal.result, scope: 'src' } })
    const legalReport = await screen.findByRole('dialog', { name: EN.legalScanTitle })
    expect(legalReport).toHaveTextContent('src')
    fireEvent.click(within(legalReport).getByLabelText('Close'))
    expect(document.activeElement).toBe(composer)

    deliver({
      type: 'gitCommitForm',
      form: { staged: 1, unstaged: 0, files: [], moreFiles: 0 },
    })
    await waitFor(() => {
      expect(held.gitLoads).toBe(1)
    })
    expect(screen.queryByRole('form', { name: 'Commit' })).toBeNull()
    // Messages keep arriving while the panel's code is unavailable.
    deliver({ type: 'gitDraft', draft: { kind: 'commitMessage', message: 'Latest draft' } })
    setUiText({ ...EN, gitMessageLabel: 'Installed message label' }, 'en')
    await act(async () => {
      held.git.resolve(undefined)
      await held.git.promise
    })
    const message = await screen.findByLabelText('Installed message label')
    expect(message).toHaveValue('Latest draft')
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'gitCommit',
      message: 'Latest draft',
      includeUnstaged: false,
    })

    fireEvent.click(screen.getByLabelText('Commands'))
    const filter = await screen.findByRole('combobox')
    fireEvent.change(filter, { target: { value: '/usage' } })
    fireEvent.keyDown(filter, { key: 'Enter' })
    const loading = screen.getByRole('dialog', { name: EN.loadingOutput })
    expect(within(loading).getByRole('status')).toHaveTextContent(EN.loadingOutput)
    expect(screen.getByRole('main')).toHaveAttribute('inert')
    await waitFor(() => {
      expect(held.usageLoads).toBe(1)
    })
    dismissLoadingModal()
    await act(async () => {
      held.usage.resolve(undefined)
      await held.usage.promise
    })
    expect(screen.queryByRole('dialog')).toBeNull()

    const share: Extract<HostToWebviewMessage, { type: 'sharePreview' }> = {
      type: 'sharePreview',
      title: 'Old share',
      exportedAt: '2026-09-28T12:00:00.000Z',
      sourceBackend: 'modelApi',
      modelId: 'muse-spark-1.3',
      redacted: false,
      items: [{ itemId: 'u', kind: 'userMessage', status: 'completed', text: 'Old text' }],
    }
    deliver(share)
    await waitFor(() => {
      expect(held.shareLoads).toBe(1)
    })
    expect(screen.getByRole('main')).toHaveAttribute('inert')
    const latest: typeof share = {
      ...share,
      title: 'Latest share',
      items: [{ itemId: 'u', kind: 'userMessage', status: 'completed', text: 'Latest text' }],
    }
    deliver(latest)
    dismissLoadingModal()
    setUiText({ ...EN, shareReadOnly: 'Installed read-only label' }, 'en')
    await act(async () => {
      held.share.resolve(undefined)
      await held.share.promise
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    deliver(latest)
    const loaded = await screen.findByRole('dialog', { name: 'Latest share' })
    expect(loaded).toHaveTextContent('Latest text')
    expect(loaded).toHaveTextContent('Installed read-only label')
    expect(loaded).not.toHaveTextContent('Old text')
    expect(held.shareLoads).toBe(1)
  })
  it.each(['prompts', 'chat'] as const)(
    'keeps a cold M118 %s surface modal and cancels its late import on Escape',
    async (surface) => {
      const postMessage = initializedApp()
      const loads = () => (surface === 'prompts' ? held.promptsLoads : held.chatLoads)
      expect(loads()).toBe(0)
      deliver({ type: 'openSharing', surface })
      await waitFor(() => {
        expect(loads()).toBe(1)
      })
      dismissLoadingModal()
      await act(async () => {
        held[surface].resolve(undefined)
        await held[surface].promise
      })
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(postMessage.mock.calls.flat()).not.toContainEqual(
        expect.objectContaining({ type: 'sharingAction' }),
      )
    },
  )

  it('loads the edit totals and task list only once there is something to show', async () => {
    // RVF116I P2: mounting the deferred surfaces unconditionally requests
    // their chunks for an empty conversation. The mounts below stay gated
    // until the first edit and the first task.
    held.diffLoads = 0
    held.todoLoads = 0
    render(<App postMessage={vi.fn()} />)
    deliver({ type: 'init', settings: testSettings, emptyStateHint: '', composerPlaceholder: '' })
    deliver({ type: 'authState', status: 'signedIn' })
    deliver({ type: 'sessionInfo', modelId: 'muse-spark-1.3', sessionId: 's1' })
    // Let any immediate chunk request run: an empty conversation asks for neither.
    await act(async () => {
      await Promise.resolve()
    })
    expect(held.diffLoads).toBe(0)
    expect(held.todoLoads).toBe(0)
    expect(screen.queryByRole('group', { name: UI_TEXT.diffTallyLabel })).toBeNull()
    expect(screen.queryByRole('region', { name: UI_TEXT.todoTitle })).toBeNull()
    // The first edit loads the tally chunk on first use and totals render.
    deliver({
      type: 'agentEvent',
      event: {
        type: 'itemCompleted',
        item: {
          itemId: 'e1',
          kind: 'toolCall',
          status: 'completed',
          tool: 'edit_file',
          args: JSON.stringify({ path: 'src/a.ts' }),
          patchSummary: { files: 1, added: 3, removed: 1 },
          patchRef: { id: 'patch-e1', byteLen: 10 },
        },
      },
    })
    await waitFor(() => {
      expect(held.diffLoads).toBe(1)
    })
    expect(held.todoLoads).toBe(0)
    expect(await screen.findByRole('group', { name: UI_TEXT.diffTallyLabel })).toBeInTheDocument()
    // The first task loads the task chunk on first use and the list renders.
    deliver({
      type: 'agentEvent',
      event: { type: 'todoChanged', items: [{ text: 'Write tests', status: 'pending' }] },
    })
    await waitFor(() => {
      expect(held.todoLoads).toBe(1)
    })
    expect(await screen.findByRole('region', { name: UI_TEXT.todoTitle })).toBeInTheDocument()
  })
})
