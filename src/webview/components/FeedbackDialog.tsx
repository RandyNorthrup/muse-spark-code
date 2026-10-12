import { useEffect, useRef, useState, type FocusEvent, type SubmitEvent } from 'react'
import {
  feedbackClassificationSchema,
  scrubMuseFeedbackNote,
  submitMuseFeedback,
  type FeedbackClassification,
  type FeedbackSubmitPort,
} from '../../core/backends/musecode/feedbackRequest'
import { FEEDBACK_NOTE_MAX_CHARS, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { Modal } from './Modal'

export interface FeedbackDialogProps {
  readonly sessionId: string
  readonly port: FeedbackSubmitPort
  readonly onClose: () => void
}

const NOTE_ROWS = 6

function refusalOf(error: unknown): string {
  return error instanceof Error ? error.message : UI_TEXT.feedbackFailed
}

function FeedbackForm({ sessionId, port, onClose }: FeedbackDialogProps) {
  // Labels are read from the installed-language table on every render, never
  // at module load. The fixed order offers exactly what the 1.4.4 capture
  // certifies: a note with its classification. Files and the session record
  // are never offered: no captured frame certifies them, and a
  // record-attached receipt refuses with the upstream request.
  const classifications: readonly {
    readonly classification: FeedbackClassification
    readonly label: string
  }[] = [
    { classification: 'badResult', label: UI_TEXT.feedbackClassificationBadResult },
    { classification: 'goodResult', label: UI_TEXT.feedbackClassificationGoodResult },
    { classification: 'bug', label: UI_TEXT.feedbackClassificationBug },
    { classification: 'other', label: UI_TEXT.feedbackClassificationOther },
  ]
  const [classification, setClassification] = useState<FeedbackClassification>(
    classifications[0]?.classification ?? 'other',
  )
  const [note, setNote] = useState('')
  const [previewed, setPreviewed] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [result, setResult] = useState<string>()
  const [failure, setFailure] = useState<string>()
  const sending = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const submitButton = useRef<HTMLButtonElement>(null)
  const lastInside = useRef<HTMLElement | null>(null)
  const previousSending = useRef(false)
  // A busy preview/send disables the focused submit button, dropping focus
  // to the page behind the dialog (RVCM1063D #4). When the transition ends,
  // put focus back inside: the control that had it when still usable, else
  // the submit button, so Tab stays trapped and Escape closes.
  useEffect(() => {
    if (!isSending && previousSending.current && !form.current?.contains(document.activeElement)) {
      const remembered = lastInside.current
      if (remembered?.isConnected === true && !remembered.hasAttribute('disabled')) {
        remembered.focus()
      } else {
        submitButton.current?.focus()
      }
    }
    previousSending.current = isSending
  }, [isSending])
  const canSend =
    classifications.some((choice) => choice.classification === classification) &&
    (classification !== 'bug' || note.trim().length > 0)
  // The status names what actually happened: the upload line on success, the
  // refusal's own sentence otherwise (a sign-in request, a rate limit, an
  // unknown outcome), never the generic failure over a real reason.
  const status = failure ?? result ?? ''
  let submitText = previewed ? UI_TEXT.feedbackSend : UI_TEXT.reportPreviewLabel
  if (isSending) submitText = previewed ? UI_TEXT.feedbackSending : UI_TEXT.reportUpdating

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSend || sending.current) return
    sending.current = true
    setIsSending(true)
    setResult(undefined)
    setFailure(undefined)
    try {
      if (!previewed) {
        setNote(await scrubMuseFeedbackNote(note, port))
        setPreviewed(true)
        return
      }
      setResult(
        await submitMuseFeedback(
          { sessionId, classification, note, withFiles: false, attachSessionRecord: false },
          port,
          note,
        ),
      )
    } catch (error: unknown) {
      setFailure(refusalOf(error))
      if (previewed) {
        try {
          setNote(await scrubMuseFeedbackNote(note, port))
        } catch {
          setPreviewed(false)
        }
      }
    } finally {
      sending.current = false
      setIsSending(false)
    }
  }

  const trackInside = (event: FocusEvent<HTMLFormElement>) => {
    if (event.target instanceof HTMLElement) {
      lastInside.current = event.target
    }
  }

  return (
    <Modal title={UI_TEXT.feedbackTitle} titleId="feedback-title" onClose={onClose}>
      <form ref={form} onFocus={trackInside} onSubmit={(event) => void submit(event)}>
        <p>{UI_TEXT.feedbackPrivacy}</p>
        <fieldset disabled={isSending} className="feedback-fields">
          <div>
            <label className="feedback-label" htmlFor="feedback-classification">
              {UI_TEXT.feedbackClassification}
            </label>
            <select
              id="feedback-classification"
              className="question-input feedback-input"
              value={classification}
              onChange={(event) => {
                const selected = feedbackClassificationSchema.safeParse(event.target.value)
                if (!selected.success) return
                setClassification(selected.data)
              }}
            >
              {classifications.map((choice) => (
                <option key={choice.classification} value={choice.classification}>
                  {choice.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="feedback-label" htmlFor="feedback-note">
              {UI_TEXT.feedbackNote}
            </label>
            <textarea
              id="feedback-note"
              className="question-input feedback-input feedback-note"
              rows={NOTE_ROWS}
              maxLength={FEEDBACK_NOTE_MAX_CHARS}
              aria-describedby="feedback-note-counter"
              value={note}
              readOnly={previewed}
              required={classification === 'bug'}
              onChange={(event) => {
                setNote(event.target.value)
              }}
            />
            <span id="feedback-note-counter" className="feedback-counter">
              {fill(UI_TEXT.feedbackNoteCounter, {
                used: note.length,
                max: FEEDBACK_NOTE_MAX_CHARS,
              })}
            </span>
          </div>
          {previewed && (
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                setPreviewed(false)
              }}
            >
              {UI_TEXT.queuedEdit}
            </button>
          )}
        </fieldset>
        <div className="question-actions feedback-actions">
          <button
            ref={submitButton}
            type="submit"
            className="button-primary"
            disabled={isSending || !canSend}
          >
            {submitText}
          </button>
        </div>
        <p role="status">{status}</p>
      </form>
    </Modal>
  )
}

/** Lane CM1063R2 imports this component lazily from the turn menu. Session changes reset consent. */
export function FeedbackDialog(props: FeedbackDialogProps) {
  return <FeedbackForm key={props.sessionId} {...props} />
}
