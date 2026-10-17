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
  orderedPlaybookRecords,
} from '../../runtime/playbook/text'

export function PlaybookNoteRows({ notes }: { readonly notes: readonly PlaybookWhyNote[] }) {
  const parsed = notes.map((note) => playbookWhyNoteSchema.parse(note))
  return (
    <ul className="playbook-notes" aria-label={UI_TEXT.playbookTitle}>
      {orderedPlaybookRecords(parsed.map((value) => ({ kind: 'note' as const, value }))).map(
        ({ value: note }, index) => (
          <li key={`${String(note.at)}:${note.code}:${String(index)}`}>
            <div role="note" className="playbook-note" data-needs-user={note.needsUser}>
              {playbookNoteText(note)}
            </div>
          </li>
        ),
      )}
    </ul>
  )
}

function PlaybookBadges({
  records,
  includeNotes,
}: {
  readonly records: readonly PlaybookRecord[]
  readonly includeNotes: boolean
}) {
  const parsed = records.map((record) => playbookRecordSchema.parse(record))
  const entries = orderedPlaybookRecords([
    ...playbookCounters(parsed).map((value) => ({ kind: 'counter' as const, value })),
    ...playbookDesigns(parsed),
    ...parsed.filter((record) => includeNotes && record.kind === 'note'),
  ])
  return (
    <span className="playbook-badges">
      {entries.map((record, index) => {
        if (record.kind === 'design')
          return (
            <span className="playbook-badge" key={`design:${record.value.id}`}>
              {record.value.module.key} · {UI_TEXT.playbookOutcomeLabel}:{' '}
              {record.value.outcome === 'pending'
                ? UI_TEXT.playbookDesignPending
                : UI_TEXT.playbookResolutions[record.value.outcome]}
            </span>
          )
        if (record.kind === 'counter')
          return (
            <span
              className="playbook-badge"
              key={`counter:${record.value.moduleId}:${record.value.class ?? ''}`}
            >
              {playbookCounterText(record.value)}
            </span>
          )
        if (record.kind === 'note')
          return (
            <span
              key={`note:${String(index)}`}
              role="note"
              className="playbook-note"
              data-needs-user={record.value.needsUser}
            >
              {playbookNoteText(record.value)}
            </span>
          )
        return null
      })}
    </span>
  )
}

export function PlaybookStrikeBadge({ records }: { readonly records: readonly PlaybookRecord[] }) {
  return <PlaybookBadges records={records} includeNotes={false} />
}

export function PlaybookAgentDetails({ records }: { readonly records: readonly PlaybookRecord[] }) {
  return <PlaybookBadges records={records} includeNotes />
}
