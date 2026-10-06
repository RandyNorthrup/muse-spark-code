// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  FeedbackDialog,
  type FeedbackDialogProps,
} from '../../src/webview/components/FeedbackDialog'
import { REDACTED_MARK, UI_TEXT } from '../../src/shared/constants'
import { redactSecrets } from '../../src/shared/redact'
import { fill } from '../../src/shared/l10n/text'

function setup(overrides: Partial<FeedbackDialogProps> = {}) {
  const submit = vi.fn().mockResolvedValue('trackingUncertain')
  const props: FeedbackDialogProps = {
    sessionId: 's',
    classifications: [
      { classification: 'badResult', label: 'Bad result' },
      { classification: 'goodResult', label: 'Good result' },
      { classification: 'bug', label: 'Bug' },
      { classification: 'other', label: 'Other' },
    ],
    port: { submit },
    onClose: vi.fn(),
    ...overrides,
  }
  return { submit, props, ...render(<FeedbackDialog {...props} />) }
}

function files() {
  return screen.getByRole('checkbox', { name: UI_TEXT.feedbackWithFiles })
}
function record() {
  return screen.getByRole('checkbox', { name: UI_TEXT.feedbackAttachSessionRecord })
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

async function requestWithoutRecord(submit: ReturnType<typeof setup>['submit']): Promise<unknown> {
  expect(record()).not.toBeChecked()
  expect(record()).toBeDisabled()
  return await sentRequest(submit)
}

describe('FeedbackDialog: disclosure consent', () => {
  it('shows the scrubbed registered secret and M84 pattern before consent and sends that exact preview', async () => {
    const literal = 'feedback-dialog-literal'
    const submit = vi.fn().mockResolvedValue('uploaded')
    setup({
      port: { submit, scrubNote: (note) => Promise.resolve(redactSecrets(note, [literal])) },
    })
    fireEvent.change(screen.getByLabelText(UI_TEXT.feedbackNote), {
      target: { value: `${literal} / ghp_${'x'.repeat(36)}` },
    })
    await preview()
    const approved = `${REDACTED_MARK} / ${REDACTED_MARK}`
    expect(screen.getByLabelText(UI_TEXT.feedbackNote)).toHaveValue(approved)
    expect(screen.getByLabelText(UI_TEXT.feedbackNote)).toHaveAttribute('readonly')
    expect(submit).not.toHaveBeenCalled()
    expect(await sentRequest(submit)).toMatchObject({ note: approved })
  })

  it('requires a new scrubbed preview after editing the approved note', async () => {
    const { submit } = setup()
    await preview()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.queuedEdit }))
    fireEvent.change(screen.getByLabelText(UI_TEXT.feedbackNote), { target: { value: 'Changed' } })
    await preview()
    expect(submit).not.toHaveBeenCalled()
    expect(await sentRequest(submit)).toMatchObject({ note: 'Changed' })
  })
  it('starts with both disclosures off, sends once, and displays the exact returned outcome', async () => {
    const { submit } = setup()
    expect(submit).not.toHaveBeenCalled()
    expect(files()).not.toBeChecked()
    expect(record()).not.toBeChecked()
    expect(record()).toBeDisabled()
    expect(screen.getByText(UI_TEXT.feedbackPrivacy)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(UI_TEXT.feedbackNote), { target: { value: 'A note' } })
    await send()
    await screen.findByText(fill(UI_TEXT.feedbackResult, { result: 'trackingUncertain' }))
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      sessionId: 's',
      classification: 'badResult',
      note: 'A note',
      withFiles: false,
      attachSessionRecord: false,
    })
    expect(screen.queryByText(UI_TEXT.feedbackSubmitted)).not.toBeInTheDocument()
  })

  it('includes files and the record only after their separate checkboxes are selected', async () => {
    const { submit } = setup()
    fireEvent.click(files())
    fireEvent.click(record())
    await send()
    await waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(1)
    })
    expect(submit.mock.calls[0]?.[0]).toMatchObject({ withFiles: true, attachSessionRecord: true })
  })

  it('revokes record consent when files are unchecked', async () => {
    const { submit } = setup()
    fireEvent.click(files())
    fireEvent.click(record())
    fireEvent.click(files())
    expect(await requestWithoutRecord(submit)).toMatchObject({
      withFiles: false,
      attachSessionRecord: false,
    })
  })

  it('revokes record consent when the classification changes', async () => {
    const { submit } = setup()
    fireEvent.click(files())
    fireEvent.click(record())
    fireEvent.change(screen.getByLabelText(UI_TEXT.feedbackClassification), {
      target: { value: 'goodResult' },
    })
    expect(await requestWithoutRecord(submit)).toMatchObject({
      classification: 'goodResult',
      attachSessionRecord: false,
    })
  })

  it('does not submit twice while a receipt is pending', async () => {
    const receipt = Promise.withResolvers<string>()
    const submit = vi.fn(() => receipt.promise)
    setup({ port: { submit } })
    await preview()
    const form = screen.getByLabelText(UI_TEXT.feedbackNote).closest('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form!)
    fireEvent.submit(form!)
    await waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByRole('button', { name: UI_TEXT.feedbackSending })).toBeDisabled()
    receipt.resolve('futureOutcome')
    await screen.findByText(fill(UI_TEXT.feedbackResult, { result: 'futureOutcome' }))
  })

  it('requires a nonblank note for a bug', () => {
    const { submit } = setup()
    fireEvent.change(screen.getByLabelText(UI_TEXT.feedbackClassification), {
      target: { value: 'bug' },
    })
    fireEvent.change(screen.getByLabelText(UI_TEXT.feedbackNote), { target: { value: '  ' } })
    expect(screen.getByRole('button', { name: UI_TEXT.reportPreviewLabel })).toBeDisabled()
    expect(submit).not.toHaveBeenCalled()
  })

  it('refuses dispatch without an offered classification', () => {
    const { submit } = setup({ classifications: [] })
    expect(screen.getByRole('button', { name: UI_TEXT.reportPreviewLabel })).toBeDisabled()
    const form = screen.getByLabelText(UI_TEXT.feedbackNote).closest('form')
    fireEvent.submit(form!)
    expect(submit).not.toHaveBeenCalled()
  })

  it('ignores an unsupported classification change', () => {
    setup()
    const choice = screen.getByLabelText(UI_TEXT.feedbackClassification)
    fireEvent.change(choice, { target: { value: 'futureClassification' } })
    expect(choice).toHaveValue('badResult')
  })

  it('shows a fixed failure without displaying raw receipt or error details', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('/private/session-record'))
    setup({ port: { submit } })
    await send()
    await screen.findByText(UI_TEXT.feedbackFailed)
    expect(screen.queryByText('/private/session-record')).not.toBeInTheDocument()
  })

  it('resets both consents and the note when the session changes', () => {
    const { props, rerender } = setup()
    fireEvent.click(files())
    fireEvent.click(record())
    fireEvent.change(screen.getByLabelText(UI_TEXT.feedbackNote), {
      target: { value: 'old session' },
    })
    rerender(<FeedbackDialog {...props} sessionId="other-session" />)
    expect(files()).not.toBeChecked()
    expect(record()).not.toBeChecked()
    expect(screen.getByLabelText(UI_TEXT.feedbackNote)).toHaveValue('')
  })

  it('closes with Escape without dispatching', () => {
    const { props, submit } = setup()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledTimes(1)
    expect(submit).not.toHaveBeenCalled()
  })
})
