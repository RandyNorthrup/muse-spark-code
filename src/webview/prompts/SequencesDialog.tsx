import './Sequences.css'
import { useState } from 'react'
import { UI_TEXT, type PermissionMode } from '../../shared/constants'
import { fill, plural } from '../../shared/l10n/text'
import type { BackendKind } from '../../shared/protocol'
import type { SavedSequence } from '../../shared/sequences'
import { Modal } from '../components/Modal'
import { SequenceStartDialog } from './SequenceStartDialog'

/** The dialog's host: the controller's sequence messages answer through these. */
export interface SequencesPort {
  save(sequence: SavedSequence): void
  remove(sequence: SavedSequence): void
  start(sequence: SavedSequence): void
}

export interface SequencesDialogProps {
  readonly sequences: readonly SavedSequence[]
  readonly hasWorkspace: boolean
  readonly conversationTitle: string
  readonly permissionMode: PermissionMode
  readonly backend: BackendKind | undefined
  readonly port: SequencesPort
  readonly onClose: () => void
}

interface Edit {
  readonly previous?: SavedSequence
  readonly name: string
  readonly scope: SavedSequence['scope']
  readonly steps: readonly string[]
}

/** The prompt sequence library (M88, PLAN.md D67): kept, edited and run from the panel. */
export function SequencesDialog(props: SequencesDialogProps) {
  const [edit, setEdit] = useState<Edit>()
  const [deleting, setDeleting] = useState<SavedSequence>()
  const [starting, setStarting] = useState<SavedSequence>()
  if (starting !== undefined) {
    return (
      <SequenceStartDialog
        sequence={starting}
        conversationTitle={props.conversationTitle}
        permissionMode={props.permissionMode}
        backend={props.backend}
        onStart={(sequence) => {
          props.port.start(sequence)
          setStarting(undefined)
        }}
        onCancel={() => {
          setStarting(undefined)
        }}
      />
    )
  }

  const startEdit = (previous?: SavedSequence): void => {
    setEdit({
      ...(previous !== undefined && { previous }),
      name: previous?.name ?? '',
      scope: previous?.scope ?? 'user',
      steps: previous === undefined ? [''] : [...previous.steps],
    })
  }

  const saveEdit = (draft: Edit): void => {
    const now = new Date().toISOString()
    props.port.save({
      schemaVersion: 1,
      id: draft.previous?.id ?? crypto.randomUUID(),
      name: draft.name,
      steps: [...draft.steps],
      scope: draft.scope,
      createdAt: draft.previous?.createdAt ?? now,
      updatedAt: now,
    })
    setEdit(undefined)
  }

  return (
    <Modal title={UI_TEXT.sequenceLibrary} titleId="sequences-title" onClose={props.onClose}>
      <div className="sequences">
        <div className="sequences-actions">
          <button
            type="button"
            onClick={() => {
              startEdit()
            }}
          >
            {UI_TEXT.sequenceNew}
          </button>
        </div>
        {edit === undefined ? null : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              saveEdit(edit)
            }}
          >
            <h3>{edit.previous === undefined ? UI_TEXT.sequenceNew : UI_TEXT.sequenceEdit}</h3>
            <label>
              {UI_TEXT.promptTitle}
              <input
                required
                value={edit.name}
                onChange={(event) => {
                  setEdit({ ...edit, name: event.target.value })
                }}
              />
            </label>
            {edit.previous === undefined && props.hasWorkspace ? (
              <label>
                {UI_TEXT.sequenceScope}
                <select
                  value={edit.scope}
                  onChange={(event) => {
                    setEdit({
                      ...edit,
                      scope: event.target.value === 'user' ? 'user' : 'workspace',
                    })
                  }}
                >
                  <option value="user">{UI_TEXT.promptScopeUser}</option>
                  <option value="workspace">{UI_TEXT.promptScopeWorkspace}</option>
                </select>
              </label>
            ) : null}
            <fieldset>
              <legend>{UI_TEXT.sequenceSteps}</legend>
              <ol>
                {edit.steps.map((step, index) => (
                  <li key={index}>
                    <label>
                      {fill(UI_TEXT.sequenceStep, { index: index + 1 })}
                      <textarea
                        required
                        value={step}
                        onChange={(event) => {
                          setEdit({
                            ...edit,
                            steps: edit.steps.map((candidate, at) =>
                              at === index ? event.target.value : candidate,
                            ),
                          })
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={edit.steps.length <= 1}
                      onClick={() => {
                        setEdit({ ...edit, steps: edit.steps.filter((_, at) => at !== index) })
                      }}
                    >
                      {UI_TEXT.sequenceRemoveStep}
                    </button>
                  </li>
                ))}
              </ol>
              <button
                type="button"
                onClick={() => {
                  setEdit({ ...edit, steps: [...edit.steps, ''] })
                }}
              >
                {UI_TEXT.sequenceAddStep}
              </button>
            </fieldset>
            <button type="submit">{UI_TEXT.sequenceSave}</button>
            <button
              type="button"
              onClick={() => {
                setEdit(undefined)
              }}
            >
              {UI_TEXT.goalEditCancel}
            </button>
          </form>
        )}
        {deleting === undefined ? null : (
          <section aria-label={UI_TEXT.sequenceDeleteConfirm}>
            <p>
              {UI_TEXT.sequenceDeleteConfirm} {deleting.name}
            </p>
            <button
              type="button"
              onClick={() => {
                props.port.remove(deleting)
                setDeleting(undefined)
              }}
            >
              {UI_TEXT.sequenceDelete}
            </button>
            <button
              type="button"
              onClick={() => {
                setDeleting(undefined)
              }}
            >
              {UI_TEXT.goalEditCancel}
            </button>
          </section>
        )}
        {props.sequences.length === 0 ? (
          <p>{UI_TEXT.sequenceEmpty}</p>
        ) : (
          <ul className="sequences-list" aria-label={UI_TEXT.sequenceLibrary}>
            {props.sequences.map((sequence) => (
              <li key={`${sequence.scope}:${sequence.id}`}>
                <h3>{sequence.name}</h3>
                <p>
                  {sequence.scope === 'user'
                    ? UI_TEXT.promptScopeUser
                    : UI_TEXT.promptScopeWorkspace}{' '}
                  · {plural(UI_TEXT.sequenceStepCount, sequence.steps.length)}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setStarting(sequence)
                  }}
                >
                  {UI_TEXT.sequenceRun}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    startEdit(sequence)
                  }}
                >
                  {UI_TEXT.sequenceEdit}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDeleting(sequence)
                  }}
                >
                  {UI_TEXT.sequenceDelete}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
