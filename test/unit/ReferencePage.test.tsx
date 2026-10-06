// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { referenceModel } from '../../src/shared/reference/reference.generated'
import { createElement, Fragment, useEffect, useMemo, useState } from 'react'
import { UI_TEXT } from '../../src/shared/constants'
import { fill, formatNumber } from '../../src/shared/l10n/text'
import { Modal } from '../../src/webview/components/Modal'
import { createReferencePage } from '../../src/webview/components/ReferencePage'
import { createReference } from '../../src/shared/reference/referenceEntry'
import { App } from '../../src/webview/App'
import { initialUiState } from '../../src/webview/state/uiState'
import { createUiStore } from '../../src/webview/state/store'
import { testSettings } from './helpers/fakes'
import type { HostToWebviewMessage } from '../../src/shared/protocol'

const deliver = (data: HostToWebviewMessage) => {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data }))
  })
}
const ReferencePage = createReferencePage({
  react: { createElement, Fragment, useEffect, useMemo, useState },
  text: UI_TEXT,
  fill,
  formatNumber,
  Modal,
})
const values = {
  model: JSON.stringify(referenceModel()),
  values: { 'museSpark.modelApiTab': 'false' },
  nls: {},
}
afterEach(() => {
  setUiText(EN, 'en')
})
function page() {
  const postMessage = vi.fn()
  const onClose = vi.fn()
  render(
    <ReferencePage
      postMessage={postMessage}
      values={values}
      settings={testSettings}
      onClose={onClose}
    />,
  )
  return { postMessage, onClose }
}
describe('shared Help & Reference page', () => {
  it('shows all five searchable sections and current/default values', () => {
    const { postMessage } = page()
    expect(postMessage).toHaveBeenCalledWith({ type: 'readReference' })
    for (const name of [
      EN.referenceFeatures,
      EN.groupSlashCommands,
      EN.referenceCommands,
      EN.referenceSettings,
      EN.referenceShortcuts,
    ])
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'museSpark.modelApiTab' } })
    const section = screen.getByRole('region', { name: EN.referenceSettings })
    expect(within(section).getByText('false')).toBeInTheDocument()
    expect(within(section).getByText('true')).toBeInTheDocument()
    fireEvent.click(
      within(section).getByRole('button', { name: 'Open setting: museSpark.modelApiTab' }),
    )
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'openReferenceSetting',
      key: 'museSpark.modelApiTab',
    })
  })
  it('states when a host has no current configuration values and still shows defaults', () => {
    render(
      <ReferencePage
        postMessage={vi.fn()}
        onClose={vi.fn()}
        settings={testSettings}
        values={{ ...values, values: {} }}
      />,
    )
    expect(screen.getByText(EN.referenceUnavailable)).toBeInTheDocument()
    const settings = screen.getByRole('region', { name: EN.referenceSettings })
    expect(within(settings).getAllByText('—').length).toBeGreaterThan(0)
    expect(within(settings).getAllByText('true').length).toBeGreaterThan(0)
  })
  it('offers Run only for safe commands and routes documentation through the host', () => {
    const { postMessage } = page()
    expect(screen.queryByRole('button', { name: 'Run: Sign Out' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Run: Show Logs' }))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'runReferenceCommand',
      command: 'museSpark.showLogs',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Documentation: Code intelligence' }))
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'openExternal' }))
  })
  it('uses installed control, command and setting translations', () => {
    setUiText(
      { ...EN, helpReferenceTitle: 'Aide et référence', referenceSearch: 'Rechercher' },
      'fr',
    )
    render(
      <ReferencePage
        postMessage={vi.fn()}
        onClose={vi.fn()}
        settings={testSettings}
        values={{
          ...values,
          nls: {
            'command.openHelp.title': 'Ouvrir la référence',
            'config.modelApiTab.description': 'Complétions dans l’éditeur',
          },
        }}
      />,
    )
    expect(screen.getByRole('dialog', { name: 'Aide et référence' })).toBeInTheDocument()
    expect(screen.getByLabelText('Rechercher')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run: Ouvrir la référence' })).toBeInTheDocument()
    expect(screen.getAllByText('Complétions dans l’éditeur').length).toBeGreaterThan(0)
  })
  it('announces empty search results and closes with Escape', () => {
    const { onClose } = page()
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'no-such-reference-entry' },
    })
    expect(screen.getByRole('status')).toHaveTextContent(EN.referenceNoMatches)
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('opens panel /help locally without sending a model turn', async () => {
    const postMessage = vi.fn()
    const store = createUiStore({
      ...initialUiState,
      settings: testSettings,
      auth: { ...initialUiState.auth, status: 'signedIn' },
    })
    render(<App postMessage={postMessage} store={store} />)
    const composer = screen.getByRole('textbox')
    fireEvent.focus(composer)
    fireEvent.change(composer, { target: { value: '/help' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    await screen.findByRole('dialog', { name: EN.helpReferenceTitle })
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'sendMessage' }))
  })
  it('keeps chat startup free of reference requests and opens from the host entry point', async () => {
    const postMessage = vi.fn()
    render(<App postMessage={postMessage} />)

    deliver({ type: 'authState', status: 'signedIn' })
    deliver({ type: 'init', settings: testSettings, emptyStateHint: '', composerPlaceholder: '' })
    expect(postMessage).not.toHaveBeenCalledWith({ type: 'readReference' })
    deliver({ type: 'openHelp' })
    await screen.findByRole('dialog', { name: EN.helpReferenceTitle })
    expect(postMessage).toHaveBeenCalledWith({ type: 'readReference' })
    deliver({ type: 'referenceValues', ...values })
    await screen.findByRole('searchbox')
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'sendMessage' }))
  })
})

describe('RVHELPREF page parity and errors', () => {
  it('R16 searches CLI options, slash grammar and structural bounds', () => {
    page()
    expect(screen.getByRole('region', { name: 'ACP / CLI' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '--max-budget-usd' } })
    expect(
      within(screen.getByRole('region', { name: 'ACP / CLI' })).getByText(
        'exec: --max-budget-usd <value>',
      ),
    ).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '/goal pause' } })
    expect(screen.getByText('/goal pause')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'timeoutSeconds' } })
    expect(
      within(screen.getByRole('region', { name: EN.referenceSettings })).getByRole('heading', {
        name: 'museSpark.checkCommands',
      }),
    ).toBeInTheDocument()
  })
  it('R20 shows the unavailable notice for the actual unsupported-host response', async () => {
    let reply: Extract<HostToWebviewMessage, { type: 'referenceValues' }> | undefined
    await createReference(EN, 'en').handle(
      { type: 'readReference' },
      {
        readNls: () => Promise.resolve({}),
        currentValue: () => undefined,
        openSetting: () => Promise.resolve(),
        runCommand: () => Promise.resolve(),
        post: (message) => {
          if (message.type === 'referenceValues') reply = message
        },
      },
    )
    if (reply === undefined) throw new Error('reference did not reply')
    render(
      <ReferencePage
        postMessage={vi.fn()}
        onClose={vi.fn()}
        settings={testSettings}
        values={reply}
      />,
    )
    expect(screen.getByText(EN.referenceUnavailable)).toBeInTheDocument()
  })
  it('R21 renders a retryable failure and recovers after a new valid response', () => {
    const postMessage = vi.fn()
    const props = { postMessage, onClose: vi.fn(), settings: testSettings }
    const { rerender } = render(
      <ReferencePage {...props} values={{ ...values, model: '', error: true }} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(EN.actionFailed)
    expect(screen.queryByText(EN.loadingOutput)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: EN.retryAction }))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'readReference' })
    expect(screen.getByRole('status')).toHaveTextContent(EN.loadingOutput)
    rerender(<ReferencePage {...props} values={values} />)
    expect(screen.getByRole('searchbox')).toBeInTheDocument()
  })
  it('R21 turns malformed lazy model data into a visible error', () => {
    render(
      <ReferencePage
        postMessage={vi.fn()}
        onClose={vi.fn()}
        settings={testSettings}
        values={{ ...values, model: '{' }}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(EN.actionFailed)
    expect(screen.getByRole('button', { name: EN.retryAction })).toBeInTheDocument()
  })
})
