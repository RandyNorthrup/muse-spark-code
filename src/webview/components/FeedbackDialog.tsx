import { useRef, useState, type SubmitEvent } from 'react'
import {
  feedbackClassificationSchema,
  submitMuseFeedback,
  type FeedbackClassification,
  type FeedbackSubmitPort,
} from '../../core/backends/musecode/feedback'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { Modal } from './Modal'

export interface FeedbackDialogProps {
  readonly sessionId: string
  /** Labels are read from the caller's installed-language table when rendered. */
  readonly classifications: readonly {
    readonly classification: FeedbackClassification
    readonly label: string
  }[]
  readonly port: FeedbackSubmitPort
  readonly onClose: () => void
}

function FeedbackForm({ sessionId, classifications, port, onClose }: FeedbackDialogProps) {
  const [classification, setClassification] = useState<FeedbackClassification>(
    classifications[0]?.classification ?? 'other',
  )
  const [note, setNote] = useState('')
  const [withFiles, setWithFiles] = useState(false)
  const [attachSessionRecord, setAttachSessionRecord] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [result, setResult] = useState<string>()
  const [failed, setFailed] = useState(false)
  const sending = useRef(false)
  const canAttachRecord = withFiles && (classification === 'bug' || classification === 'badResult')
  const canSend =
    classifications.some((choice) => choice.classification === classification) &&
    (classification !== 'bug' || note.trim().length > 0)
  let statusText = result === undefined ? '' : fill(UI_TEXT.feedbackResult, { result })
  if (failed) statusText = UI_TEXT.feedbackFailed

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSend || sending.current) return
    sending.current = true
    setIsSending(true)
    setResult(undefined)
    setFailed(false)
    try {
      setResult(
        await submitMuseFeedback(
          { sessionId, classification, note, withFiles, attachSessionRecord },
          port,
        ),
      )
    } catch {
      setFailed(true)
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
                setAttachSessionRecord(false)
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
              required={classification === 'bug'}
              onChange={(event) => {
                setNote(event.target.value)
              }}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={withFiles}
              onChange={(event) => {
                setWithFiles(event.target.checked)
                setAttachSessionRecord(false)
              }}
            />
            {UI_TEXT.feedbackWithFiles}
          </label>
          <label>
            <input
              type="checkbox"
              checked={attachSessionRecord}
              disabled={!canAttachRecord}
              onChange={(event) => {
                setAttachSessionRecord(event.target.checked)
              }}
            />
            {UI_TEXT.feedbackAttachSessionRecord}
          </label>
        </fieldset>
        <button type="submit" disabled={isSending || !canSend}>
          {isSending ? UI_TEXT.feedbackSending : UI_TEXT.feedbackSend}
        </button>
        <p role="status">{statusText}</p>
      </form>
    </Modal>
  )
}

/** Lane W imports this component lazily from the turn menu. Session changes reset consent. */
export function FeedbackDialog(props: FeedbackDialogProps) {
  return <FeedbackForm key={props.sessionId} {...props} />
}
