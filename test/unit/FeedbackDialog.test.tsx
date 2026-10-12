// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  FeedbackDialog,
  type FeedbackDialogProps,
} from '../../src/webview/components/FeedbackDialog'
import { FEEDBACK_NOTE_MAX_CHARS, REDACTED_MARK, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { redactSecrets } from '../../src/shared/redact'

function setup(overrides: Partial<FeedbackDialogProps> = {}) {
  const submit = vi.fn().mockResolvedValue(UI_TEXT.feedbackUploaded)
  const props: FeedbackDialogProps = {
    sessionId: 's',
    port: { submit },
    onClose: vi.fn(),
    ...overrides,
  }
  return { submit, props, ...render(<FeedbackDialog {...props} />) }
}

function classificationSelect() {
  return screen.getByLabelText(UI_TEXT.feedbackClassification)
}

function noteBox() {
  return screen.getByLabelText(UI_TEXT.feedbackNote)
}

async function preview() {
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.reportPreviewLabel }))
  await screen.findByRole('button', { name: UI_TEXT.feedbackSend })
}

async function send() {
  if (screen.queryByRole('button', { name: UI_TEXT.reportPreviewLabel })) await preview()
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.feedbackSend }))
}

async function sentRequest(submit: ReturnType<typeof setup>['submit']): Promise<unknown> {
  await send()
  await waitFor(() => {
    expect(submit).toHaveBeenCalledTimes(1)
  })
  return submit.mock.calls[0]?.[0]
}

describe('FeedbackDialog: the captured disclosure only', () => {
  it('offers a note with its classification and no attachable disclosure', () => {
    setup()
    expect(screen.getByText(UI_TEXT.feedbackPrivacy)).toBeDefined()
    const options = [...classificationSelect().querySelectorAll('option')].map(
      (option) => option.textContent,
    )
    expect(options).toEqual([
      UI_TEXT.feedbackClassificationBadResult,
      UI_TEXT.feedbackClassificationGoodResult,
      UI_TEXT.feedbackClassificationBug,
      UI_TEXT.feedbackClassificationOther,
    ])
    // Files and the session record are never offered: no captured frame
    // certifies them, and a record-attached receipt refuses.
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('shows the scrubbed secret and pattern before consent and sends that exact preview', async () => {
    const literal = 'feedback-dialog-literal'
    const submit = vi.fn().mockResolvedValue('uploaded')
    setup({
      port: { submit, scrubNote: (note) => Promise.resolve(redactSecrets(note, [literal])) },
    })
    fireEvent.change(noteBox(), { target: { value: `${literal} / ghp_${'x'.repeat(36)}` } })
    await preview()
    const approved = `${REDACTED_MARK} / ${REDACTED_MARK}`
    expect(noteBox()).toHaveValue(approved)
    expect(noteBox()).toHaveAttribute('readonly')
    expect(submit).not.toHaveBeenCalled()
    expect(await sentRequest(submit)).toMatchObject({ note: approved })
  })

  it('requires a new scrubbed preview after editing the approved note', async () => {
    const { submit } = setup()
    await preview()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.queuedEdit }))
    fireEvent.change(noteBox(), { target: { value: 'Changed' } })
    await preview()
    expect(submit).not.toHaveBeenCalled()
    expect(await sentRequest(submit)).toMatchObject({ note: 'Changed' })
  })

  it('shows a refreshed preview after the host refuses a literal registered during submission', async () => {
    const literals: string[] = []
    const literal = 'async-gap-dialog-literal'
    const receipt = Promise.withResolvers<string>()
    const submit = vi.fn().mockReturnValueOnce(receipt.promise).mockResolvedValue('uploaded')
    setup({
      port: { submit, scrubNote: (note) => Promise.resolve(redactSecrets(note, literals)) },
    })
    fireEvent.change(noteBox(), { target: { value: literal } })
    await preview()
    expect(noteBox()).toHaveValue(literal)
    await send()
    await waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(1)
    })
    literals.push(literal)
    receipt.reject(new Error(UI_TEXT.feedbackFailed))
    await screen.findByText(UI_TEXT.feedbackFailed)
    await waitFor(() => {
      expect(noteBox()).toHaveValue(REDACTED_MARK)
    })
    expect(noteBox()).toHaveAttribute('readonly')
    expect(submit).toHaveBeenCalledTimes(1)
    await send()
    await screen.findByText('uploaded')
    expect(submit).toHaveBeenCalledTimes(2)
    expect(submit).toHaveBeenLastCalledWith({
      sessionId: 's',
      classification: 'badResult',
      note: REDACTED_MARK,
      withFiles: false,
      attachSessionRecord: false,
    })
  })

  it('requires a note for a bug and ignores an unknown classification', async () => {
    const { submit } = setup()
    fireEvent.change(classificationSelect(), { target: { value: 'bug' } })
    expect(screen.getByRole('button', { name: UI_TEXT.reportPreviewLabel })).toBeDisabled()
    fireEvent.change(noteBox(), { target: { value: '  ' } })
    expect(screen.getByRole('button', { name: UI_TEXT.reportPreviewLabel })).toBeDisabled()
    fireEvent.change(noteBox(), { target: { value: 'Steps to reproduce' } })
    expect(screen.getByRole('button', { name: UI_TEXT.reportPreviewLabel })).not.toBeDisabled()
    fireEvent.change(classificationSelect(), { target: { value: 'futureClassification' } })
    expect(classificationSelect()).toHaveValue('bug')
    expect(await sentRequest(submit)).toMatchObject({ classification: 'bug' })
  })

  it.each(['feedbackFailed', 'notSignedInReason', 'feedbackRateLimited'] as const)(
    'shows the actual %s refusal sentence',
    async (key) => {
      const reason = UI_TEXT[key]
      const submit = vi.fn().mockRejectedValue(new Error(reason))
      setup({ port: { submit } })
      fireEvent.change(noteBox(), { target: { value: 'A wrong answer' } })
      await send()
      await screen.findByText(reason)
      expect(screen.getByRole('status').textContent).toBe(reason)
    },
  )

  it('shows the generic failure for a refusal carrying no reason', async () => {
    const submit = vi.fn().mockRejectedValue('gone')
    setup({ port: { submit } })
    fireEvent.change(noteBox(), { target: { value: 'A wrong answer' } })
    await send()
    await screen.findByText(UI_TEXT.feedbackFailed)
    expect(screen.getByRole('status').textContent).toBe(UI_TEXT.feedbackFailed)
  })

  it('stops the note at the protocol maximum and counts down to it', () => {
    setup()
    const box = noteBox()
    expect(box).toHaveAttribute('maxLength', String(FEEDBACK_NOTE_MAX_CHARS))
    expect(
      screen.getByText(fill(UI_TEXT.feedbackNoteCounter, { used: 0, max: 2000 })),
    ).toBeDefined()
    fireEvent.change(box, { target: { value: 'hello' } })
    expect(
      screen.getByText(fill(UI_TEXT.feedbackNoteCounter, { used: 5, max: 2000 })),
    ).toBeDefined()
  })

  it('settles a refused preview with its reason instead of waiting', async () => {
    const reason = fill(UI_TEXT.feedbackNoteTooLong, { max: FEEDBACK_NOTE_MAX_CHARS })
    setup({ port: { submit: vi.fn(), scrubNote: () => Promise.reject(new Error(reason)) } })
    fireEvent.change(noteBox(), { target: { value: 'A wrong answer' } })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.reportPreviewLabel }))
    await screen.findByText(reason)
    expect(screen.getByRole('button', { name: UI_TEXT.reportPreviewLabel })).not.toBeDisabled()
  })

  it('shows the upload line on success, the only success the reader resolves', async () => {
    const submit = vi.fn().mockResolvedValue(UI_TEXT.feedbackUploaded)
    setup({ port: { submit } })
    fireEvent.change(noteBox(), { target: { value: 'A wrong answer' } })
    await send()
    await screen.findByText(UI_TEXT.feedbackUploaded)
    expect(screen.getByRole('status').textContent).toBe(UI_TEXT.feedbackUploaded)
  })

  it('returns focus inside the dialog after a busy preview, so Escape closes (RVCM1063D #4)', async () => {
    const gate = Promise.withResolvers<string>()
    const submit = vi.fn().mockResolvedValue(UI_TEXT.feedbackUploaded)
    const { props } = setup({ port: { submit, scrubNote: () => gate.promise } })
    fireEvent.change(noteBox(), { target: { value: 'A wrong answer' } })
    const previewButton = screen.getByRole('button', { name: UI_TEXT.reportPreviewLabel })
    if (!(previewButton instanceof HTMLButtonElement)) throw new Error('Expected a button')
    previewButton.focus()
    fireEvent.click(previewButton)
    // The browser drops focus to the page when the focused button disables;
    // jsdom keeps it (and refuses blur on a disabled node), so simulate the
    // drop around the assertion the fix must satisfy.
    previewButton.disabled = false
    previewButton.blur()
    previewButton.disabled = true
    expect(document.activeElement).toBe(document.body)
    gate.resolve('A wrong answer')
    await screen.findByRole('button', { name: UI_TEXT.feedbackSend })
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
    // Keyboard ownership is restored: Escape reaches the dialog and closes it.
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })
})
