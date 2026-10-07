import { mountPromptHarness } from './helpers/promptHarness'
/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PromptLibrary, type PromptLibraryPort } from '../../src/webview/prompts/PromptLibrary'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { savedPromptFixture as fixture } from './helpers/sharingFixtures'

function rig() {
  const port: PromptLibraryPort = {
    save: vi.fn(() => Promise.resolve(fixture)),
    remove: vi.fn(),
    duplicate: vi.fn(),
    insert: vi.fn(),
    run: vi.fn(),
    share: vi.fn(),
    importPrompt: vi.fn(),
    acceptImport: vi.fn(),
    confirmShare: vi.fn(),
  }
  const onClose = vi.fn()
  const prompts = [fixture, { ...fixture, scope: 'workspace' as const, untrusted: true }]
  return { port, onClose, prompts }
}
afterEach(cleanup)

describe('shared prompt library', () => {
  it('associates a created draft with its saved id so the next save edits it', async () => {
    const { port, onClose } = rig()
    const saved = {
      ...fixture,
      id: 'created-id',
      title: 'New',
      body: 'First',
      tags: [],
      variables: [],
    }
    vi.mocked(port.save).mockResolvedValue(saved)
    const view = render(
      <PromptLibrary prompts={[]} port={port} onClose={onClose} hasWorkspace canImportLinks />,
    )
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.promptSave }))
    fireEvent.change(screen.getByLabelText(UI_TEXT.promptTitle), { target: { value: 'New' } })
    fireEvent.change(screen.getByLabelText(UI_TEXT.promptBody), { target: { value: 'First' } })
    fireEvent.submit(screen.getByLabelText(UI_TEXT.promptTitle).closest('form')!)
    await waitFor(() => {
      expect(screen.queryByRole('combobox', { name: UI_TEXT.promptScopeWorkspace })).toBeNull()
    })
    view.rerender(
      <PromptLibrary prompts={[saved]} port={port} onClose={onClose} hasWorkspace canImportLinks />,
    )
    fireEvent.change(screen.getByLabelText(UI_TEXT.promptBody), { target: { value: 'Second' } })
    await act(async () => {
      fireEvent.submit(screen.getByLabelText(UI_TEXT.promptTitle).closest('form')!)
      await Promise.resolve()
    })
    expect(port.save).toHaveBeenNthCalledWith(2, expect.objectContaining({ body: 'Second' }), saved)
  })
  it('retains a failed draft for retry and blocks duplicate in-flight saves', async () => {
    const { port, onClose } = rig()
    const saveResult = Promise.withResolvers<typeof fixture>()
    vi.mocked(port.save).mockReturnValueOnce(saveResult.promise)
    render(<PromptLibrary prompts={[]} port={port} onClose={onClose} hasWorkspace canImportLinks />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.promptSave }))
    fireEvent.change(screen.getByLabelText(UI_TEXT.promptTitle), { target: { value: 'Keep me' } })
    fireEvent.change(screen.getByLabelText(UI_TEXT.promptBody), {
      target: { value: 'Exact draft' },
    })
    const form = screen.getByLabelText(UI_TEXT.promptTitle).closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(port.save).toHaveBeenCalledOnce()
    await act(async () => {
      saveResult.reject(new Error('/private/path'))
      await Promise.resolve()
    })
    expect(screen.getByRole('alert').textContent).toBe(UI_TEXT.promptFileInvalid)
    expect(screen.getByLabelText(UI_TEXT.promptBody)).toHaveProperty('value', 'Exact draft')
    await act(async () => {
      fireEvent.submit(form)
      await Promise.resolve()
    })
    expect(port.save).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ title: 'Keep me', body: 'Exact draft' }),
      undefined,
    )
  })
  it('mounts the screenshot harness over the shared component', () => {
    const element = document.createElement('div')
    document.body.append(element)
    let unmount = () => {
      element.remove()
    }
    act(() => {
      unmount = mountPromptHarness(element, 'import')
    })
    expect(screen.getByRole('dialog', { name: UI_TEXT.promptLibrary })).toBeDefined()
    act(() => {
      unmount()
    })
    element.remove()
  })
  it('labels both scopes and duplicates; filters by search and tag', () => {
    const { port, prompts, onClose } = rig()
    render(
      <PromptLibrary prompts={prompts} port={port} onClose={onClose} hasWorkspace canImportLinks />,
    )
    expect(screen.getAllByRole('heading', { name: fixture.title })).toHaveLength(2)
    expect(screen.getByText(/All workspaces/)).toBeDefined()
    expect(screen.getByText(/This workspace/)).toBeDefined()
    fireEvent.change(screen.getByLabelText(UI_TEXT.promptSearch), {
      target: { value: '日本語 selection' },
    })
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    fireEvent.change(screen.getByLabelText(UI_TEXT.promptSearch), { target: { value: 'missing' } })
    expect(screen.getByText(UI_TEXT.promptEmpty)).toBeDefined()
    fireEvent.change(screen.getByLabelText(UI_TEXT.promptSearch), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText(UI_TEXT.promptTags), { target: { value: 'review' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
  it('edits exact text, confirms delete, copies to user and routes insert/run/share explicitly', () => {
    const { port, prompts, onClose } = rig()
    render(
      <PromptLibrary prompts={prompts} port={port} onClose={onClose} hasWorkspace canImportLinks />,
    )
    const workspace = within(screen.getAllByRole('listitem')[1]!)
    fireEvent.click(workspace.getByRole('button', { name: UI_TEXT.promptCopyToUser }))
    expect(port.duplicate).toHaveBeenCalledWith(prompts[1], 'user')
    fireEvent.click(workspace.getByRole('button', { name: UI_TEXT.promptInsert }))
    expect(port.insert).toHaveBeenCalledWith(prompts[1])
    expect(port.run).not.toHaveBeenCalled()
    fireEvent.click(workspace.getByRole('button', { name: UI_TEXT.promptRun }))
    expect(port.run).toHaveBeenCalledWith(prompts[1])
    fireEvent.click(workspace.getByRole('button', { name: UI_TEXT.sharePrompt }))
    expect(port.share).toHaveBeenCalledWith(prompts[1])
    fireEvent.click(workspace.getByRole('button', { name: UI_TEXT.promptDuplicate }))
    expect(port.duplicate).toHaveBeenCalledWith(prompts[1], 'workspace')
    fireEvent.click(workspace.getByRole('button', { name: UI_TEXT.promptEdit }))
    const body = screen.getByLabelText(UI_TEXT.promptBody)
    expect(body).toBeInstanceOf(HTMLTextAreaElement)
    if (!(body instanceof HTMLTextAreaElement)) throw new Error('Expected a prompt textarea')
    expect(body.value).toBe(fixture.body)
    fireEvent.change(screen.getByLabelText(UI_TEXT.promptTitle), { target: { value: 'Changed' } })
    fireEvent.click(
      within(screen.getByLabelText(UI_TEXT.promptTitle).closest('form')!).getByRole('button', {
        name: UI_TEXT.promptSave,
      }),
    )
    expect(port.save).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Changed', body: fixture.body, scope: 'workspace' }),
      prompts[1],
    )
    fireEvent.click(workspace.getByRole('button', { name: UI_TEXT.promptDelete }))
    expect(port.remove).not.toHaveBeenCalled()
    fireEvent.click(
      within(screen.getByRole('region', { name: UI_TEXT.promptDeleteConfirm })).getByRole(
        'button',
        { name: UI_TEXT.promptDelete },
      ),
    )
    expect(port.remove).toHaveBeenCalledWith(prompts[1])
  })
  it('keeps imports idle until accepted and shares idle until confirmed', () => {
    const { port, onClose } = rig()
    const imported = {
      id: 'preview',
      prompt: { ...fixture, untrusted: true },
      variables: fixture.variables,
    }
    render(
      <PromptLibrary
        prompts={[]}
        port={port}
        onClose={onClose}
        hasWorkspace
        canImportLinks
        importPreview={imported}
        sharePreview={{ id: 'share', text: 'safe [redacted]' }}
        error="damaged"
      />,
    )
    expect(
      screen.getByText(
        (_text, element) => element?.tagName === 'PRE' && element.textContent === fixture.body,
      ),
    ).toBeDefined()
    expect(screen.getByText(/selection, file, clipboard, audience/)).toBeDefined()
    expect(screen.getByRole('alert').textContent).toBe('damaged')
    const redaction = screen.getByText('[redacted]', { selector: 'mark' })
    expect(redaction.closest('pre')?.textContent).toBe('safe [redacted]')
    expect(port.insert).not.toHaveBeenCalled()
    expect(port.run).not.toHaveBeenCalled()
    expect(port.acceptImport).not.toHaveBeenCalled()
    expect(port.confirmShare).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole('button', {
        name: fill(UI_TEXT.promptImportConfirmScope, {
          scope: fixture.scope === 'user' ? UI_TEXT.promptScopeUser : UI_TEXT.promptScopeWorkspace,
        }),
      }),
    )
    expect(port.acceptImport).toHaveBeenCalledWith('preview')
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.shareConfirm }))
    expect(port.confirmShare).toHaveBeenCalledWith('share')
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.promptFromFile }))
    expect(port.importPrompt).toHaveBeenCalledWith('file')
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.promptLink }))
    expect(port.importPrompt).toHaveBeenCalledWith('link')
  })
  it('supports a user-only library, creates drafts, and traps focus', () => {
    const { port, onClose } = rig()
    render(
      <PromptLibrary
        prompts={[]}
        port={port}
        onClose={onClose}
        hasWorkspace={false}
        canImportLinks={false}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.promptSave }))
    expect(screen.queryByRole('combobox', { name: UI_TEXT.promptScopeWorkspace })).toBeNull()
    expect(screen.queryByRole('button', { name: UI_TEXT.promptLink })).toBeNull()
    fireEvent.change(screen.getByLabelText(UI_TEXT.promptTitle), { target: { value: 'New' } })
    fireEvent.change(screen.getByLabelText(UI_TEXT.promptBody), {
      target: { value: 'Exact\r\nbody' },
    })
    fireEvent.change(screen.getAllByLabelText(UI_TEXT.promptTags)[1]!, {
      target: { value: 'one, two' },
    })
    fireEvent.submit(screen.getByLabelText(UI_TEXT.promptTitle).closest('form')!)
    expect(port.save).toHaveBeenCalledWith(
      { title: 'New', body: 'Exact\nbody', tags: ['one', 'two'], scope: 'user' },
      undefined,
    )
    const close = screen.getByRole('button', { name: UI_TEXT.usageClose })
    close.focus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: UI_TEXT.goalEditCancel }),
    )
  })
})
