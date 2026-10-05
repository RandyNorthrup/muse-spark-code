// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { App } from '../../src/webview/App'
import { testSettings } from './helpers/fakes'

const held = vi.hoisted(() => ({
  git: Promise.withResolvers<undefined>(),
  usage: Promise.withResolvers<undefined>(),
  gitLoads: 0,
  usageLoads: 0,
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

function deliver(message: HostToWebviewMessage): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: message }))
  })
}

afterEach(() => {
  setUiText(EN, 'en')
})

describe('App while its deferred panels load', () => {
  it('waits for use, keeps new form state and language, and lets a loading modal close', async () => {
    const postMessage = vi.fn()
    render(<App postMessage={postMessage} />)
    deliver({ type: 'init', settings: testSettings, emptyStateHint: '', composerPlaceholder: '' })
    deliver({ type: 'authState', status: 'signedIn' })
    expect(screen.getByLabelText('Message Muse')).toBeInTheDocument()
    expect(held.gitLoads).toBe(0)
    expect(held.usageLoads).toBe(0)

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
    const filter = screen.getByRole('combobox')
    fireEvent.change(filter, { target: { value: '/usage' } })
    fireEvent.keyDown(filter, { key: 'Enter' })
    const loading = screen.getByRole('dialog', { name: 'Account & usage' })
    expect(within(loading).getByRole('status')).toHaveTextContent(EN.connecting)
    expect(screen.getByRole('main')).toHaveAttribute('inert')
    await waitFor(() => {
      expect(held.usageLoads).toBe(1)
    })
    fireEvent.keyDown(within(loading).getByLabelText('Close'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('main')).not.toHaveAttribute('inert')
    expect(document.activeElement).toBe(screen.getByLabelText('Message Muse'))
    await act(async () => {
      held.usage.resolve(undefined)
      await held.usage.promise
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
