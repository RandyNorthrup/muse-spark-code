import { useRef, useState, type SubmitEvent } from 'react'
import {
  feedbackClassificationSchema,
  scrubMuseFeedbackNote,
  submitMuseFeedback,
  type FeedbackClassification,
  type FeedbackSubmitPort,
} from '../../core/backends/musecode/feedback'
import { UI_TEXT } from '../../shared/constants'
import { Modal } from './Modal'

export interface FeedbackDialogProps {
  readonly sessionId: string
  readonly port: FeedbackSubmitPort
  readonly onClose: () => void
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
  const [failed, setFailed] = useState(false)
  const sending = useRef(false)
  const canSend =
    classifications.some((choice) => choice.classification === classification) &&
    (classification !== 'bug' || note.trim().length > 0)
  const status = failed ? UI_TEXT.feedbackFailed : (result ?? '')
  let submitText = previewed ? UI_TEXT.feedbackSend : UI_TEXT.reportPreviewLabel
  if (isSending) submitText = previewed ? UI_TEXT.feedbackSending : UI_TEXT.reportUpdating

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSend || sending.current) return
    sending.current = true
    setIsSending(true)
    setResult(undefined)
    setFailed(false)
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
    } catch {
      setFailed(true)
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

  return (
    <Modal title={UI_TEXT.feedbackTitle} titleId="feedback-title" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)}>
        <p>{UI_TEXT.feedbackPrivacy}</p>
        <fieldset disabled={isSending}>
          <label>
            {UI_TEXT.feedbackClassification}
            <select
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
          </label>
          <label>
            {UI_TEXT.feedbackNote}
            <textarea
              value={note}
              readOnly={previewed}
              required={classification === 'bug'}
              onChange={(event) => {
                setNote(event.target.value)
              }}
            />
          </label>
          {previewed && (
            <button
              type="button"
              onClick={() => {
                setPreviewed(false)
              }}
            >
              {UI_TEXT.queuedEdit}
            </button>
          )}
        </fieldset>
        <button type="submit" disabled={isSending || !canSend}>
          {submitText}
        </button>
        <p role="status">{status}</p>
      </form>
    </Modal>
  )
}

/** Lane CM1063R2 imports this component lazily from the turn menu. Session changes reset consent. */
export function FeedbackDialog(props: FeedbackDialogProps) {
  return <FeedbackForm key={props.sessionId} {...props} />
}
