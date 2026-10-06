import { UI_TEXT } from '../../shared/constants'
import {
  playbookRecordSchema,
  playbookWhyNoteSchema,
  type PlaybookRecord,
  type PlaybookWhyNote,
} from '../../shared/playbook'
import {
  playbookDesigns,
  playbookCounters,
  playbookCounterText,
  playbookNoteText,
} from '../../runtime/playbook/text'

export function PlaybookNoteRows({ notes }: { readonly notes: readonly PlaybookWhyNote[] }) {
  const parsed = notes.map((note) => playbookWhyNoteSchema.parse(note))
  return (
    <ul className="playbook-notes" aria-label={UI_TEXT.playbookTitle}>
      {parsed
        .toSorted((a, b) => Number(b.needsUser) - Number(a.needsUser))
        .map((note, index) => (
          <li key={`${String(note.at)}:${note.code}:${String(index)}`}>
            <div role="note" className="playbook-note" data-needs-user={note.needsUser}>
              {playbookNoteText(note)}
            </div>
          </li>
        ))}
    </ul>
  )
}

export function PlaybookStrikeBadge({ records }: { readonly records: readonly PlaybookRecord[] }) {
  const parsed = records.map((record) => playbookRecordSchema.parse(record))
  return (
    <span className="playbook-badges">
      {playbookCounters(parsed).map((counter) => (
        <span className="playbook-badge" key={`${counter.moduleId}:${counter.class ?? ''}`}>
          {playbookCounterText(counter)}
        </span>
      ))}
      {playbookDesigns(parsed).map((record) =>
        record.kind === 'design' ? (
          <span className="playbook-badge" key={record.value.id}>
            {record.value.module.key} · {UI_TEXT.playbookOutcomeLabel}:{' '}
            {record.value.outcome === 'pending'
              ? UI_TEXT.playbookDesignPending
              : UI_TEXT.playbookResolutions[record.value.outcome]}
          </span>
        ) : null,
      )}
    </span>
  )
}

export function PlaybookAgentDetails({ records }: { readonly records: readonly PlaybookRecord[] }) {
  return (
    <>
      <PlaybookStrikeBadge records={records} />
      <PlaybookNoteRows
        notes={records.flatMap((record) => (record.kind === 'note' ? [record.value] : []))}
      />
    </>
  )
}
