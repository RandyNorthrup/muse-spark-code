import { useState } from 'react'
import { UI_TEXT, type PermissionMode } from '../../shared/constants'
import { fill, plural } from '../../shared/l10n/text'
import type { BackendKind } from '../../shared/protocol'
import type { SavedSequence } from '../../shared/sequences'
import { Modal } from '../components/Modal'

export interface SequenceStartDialogProps {
  readonly sequence: SavedSequence
  readonly conversationTitle: string
  readonly permissionMode: PermissionMode
  readonly backend: BackendKind | undefined
  readonly onStart: (sequence: SavedSequence) => void
  readonly onCancel: () => void
}

/** The run's confirmation (M88, PLAN.md D67): the steps, the conversation and its mode. */
export function SequenceStartDialog(props: SequenceStartDialogProps) {
  const [isStarting, setStarting] = useState(false)
  const modeLabel = UI_TEXT.permissionModes[props.permissionMode]
  const isModeWarningShown =
    props.permissionMode === 'auto' || props.permissionMode === 'bypassPermissions'
  return (
    <Modal
      title={fill(UI_TEXT.sequenceStartTitle, { name: props.sequence.name })}
      titleId="sequence-start-title"
      onClose={props.onCancel}
    >
      <div className="prompt-library sequences-start">
        <p>{plural(UI_TEXT.sequenceStartDetail, props.sequence.steps.length)}</p>
        <dl>
          <dt>{UI_TEXT.sequenceStartConversation}</dt>
          <dd>{props.conversationTitle}</dd>
          <dt>{UI_TEXT.permissionModeTitle}</dt>
          <dd>{modeLabel}</dd>
        </dl>
        {props.backend === 'modelApi' ? <p>{UI_TEXT.sequenceStartBilled}</p> : null}
        {isModeWarningShown ? (
          <p role="note">{fill(UI_TEXT.sequenceModeWarning, { mode: modeLabel })}</p>
        ) : null}
        <ol aria-label={UI_TEXT.sequenceSteps}>
          {props.sequence.steps.map((step, index) => (
            <li key={index}>
              <h3>{fill(UI_TEXT.sequenceStep, { index: index + 1 })}</h3>
              <p>{step}</p>
            </li>
          ))}
        </ol>
        <div className="prompt-library-actions">
          <button
            type="button"
            disabled={isStarting}
            onClick={() => {
              setStarting(true)
              props.onStart(props.sequence)
            }}
          >
            {UI_TEXT.sequenceRun}
          </button>
          <button
            type="button"
            onClick={() => {
              props.onCancel()
            }}
          >
            {UI_TEXT.goalEditCancel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
