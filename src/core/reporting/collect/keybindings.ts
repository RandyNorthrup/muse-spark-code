// The keybindings report's sections from static editor, panel and ACP facts.
// Pure: no file reads, no host calls, so VS Code, ACP and the CLI share the
// mapping and report the same numbers from the same inputs.
import type { ReportLabelKey, ReportRow, ReportSection } from '../../../shared/reportSchema'
import { compare, list, row, text } from './common'

export interface EditorKeybindingFact {
  readonly command: string
  readonly key: string
  readonly mac?: string | undefined
  readonly win?: string | undefined
  readonly when?: string | undefined
}
export interface PanelKeybindingFact {
  readonly context: string
  readonly key: string
}
export interface AcpCommandFact {
  readonly name: string
}
export interface KeybindingsFacts {
  readonly editor: readonly EditorKeybindingFact[]
  readonly panel: readonly PanelKeybindingFact[]
  readonly acp: readonly AcpCommandFact[]
}

const KEYBINDINGS_COLUMNS: { readonly key: string; readonly label: ReportLabelKey }[] = [
  { key: 'shortcut', label: 'shortcut' },
  { key: 'command', label: 'command' },
  { key: 'scope', label: 'scope' },
]

const EDITOR_PLATFORMS = [
  { platform: 'linux', chord: (fact: EditorKeybindingFact) => fact.key },
  { platform: 'macos', chord: (fact: EditorKeybindingFact) => fact.mac ?? fact.key },
  { platform: 'windows', chord: (fact: EditorKeybindingFact) => fact.win ?? fact.key },
] as const

/** Chords compare case-insensitively; VS Code treats `Ctrl` and `ctrl` alike. */
function normalizeChord(chord: string): string {
  return chord.toLowerCase().replaceAll(/\s+/gu, ' ').trim()
}

function scopeFor(when: string | undefined, scope: string): string {
  return when === undefined ? scope : `${scope} (${when})`
}

function bindingRows(facts: KeybindingsFacts): ReportRow[] {
  const rows: ReportRow[] = []
  for (const fact of facts.editor) {
    for (const { platform, chord } of EDITOR_PLATFORMS) {
      const gesture = chord(fact).trim()
      if (gesture === '') continue
      rows.push(
        row(
          'keybindings',
          [platform, gesture, fact.command, fact.when ?? ''],
          {
            shortcut: text(gesture),
            command: text(fact.command),
            scope: text(scopeFor(fact.when, `editor/${platform}`)),
          },
          ['keybindings'],
        ),
      )
    }
  }
  for (const fact of facts.panel) {
    rows.push(
      row(
        'keybindings',
        ['panel', fact.context, fact.key],
        {
          shortcut: text(fact.key),
          command: text(fact.context),
          scope: text('panel'),
        },
        ['keybindings'],
      ),
    )
  }
  for (const fact of facts.acp) {
    rows.push(
      row(
        'keybindings',
        ['acp', fact.name],
        {
          shortcut: text(`/${fact.name}`),
          command: text(fact.name),
          scope: text('acp'),
        },
        ['keybindings'],
      ),
    )
  }
  return rows
}

/**
 * A conflict is two editor bindings for the same platform chord whose `when`
 * clauses are equal (both empty counts): both fire together and the winner is
 * registration order. Different `when` clauses are shadowing by design — the
 * narrower context wins there — so they are not conflicts.
 */
interface ChordGroup {
  readonly chord: string
  readonly platform: string
  readonly facts: EditorKeybindingFact[]
}

function conflictRows(facts: KeybindingsFacts): ReportRow[] {
  const groups = new Map<string, ChordGroup>()
  for (const fact of facts.editor) {
    for (const { platform, chord } of EDITOR_PLATFORMS) {
      const gesture = chord(fact).trim()
      if (gesture === '') continue
      const identity = `${platform}${normalizeChord(gesture)}`
      const group = groups.get(identity)
      if (group === undefined) groups.set(identity, { chord: gesture, platform, facts: [fact] })
      else group.facts.push(fact)
    }
  }
  // Emission order is input order; the section builder sorts rows by their
  // content-digest keys, so output never depends on fact order.
  const rows: ReportRow[] = []
  for (const group of groups.values()) {
    const colliding = group.facts.filter((fact) =>
      group.facts.some(
        (other) =>
          other !== fact &&
          other.command !== fact.command &&
          (other.when ?? '') === (fact.when ?? ''),
      ),
    )
    if (colliding.length === 0) continue
    const commands = [...new Set(colliding.map((fact) => fact.command))].toSorted(compare)
    rows.push(
      row(
        'keybindingConflict',
        [group.platform, normalizeChord(group.chord), ...commands],
        {
          shortcut: text(group.chord),
          command: list(commands),
          scope: text(`editor/${group.platform}`),
        },
        ['keybindings'],
      ),
    )
  }
  return rows
}

function deduplicate(rows: ReportRow[]): ReportRow[] {
  const seen = new Set<string>()
  return rows.filter((entry) => {
    const identity = JSON.stringify([entry.key, entry.cells, entry.sourceIds])
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

/**
 * Both facets uncapped with no omissions: the collector's forward caps rows
 * for display, and `--full` refuses a source that omitted any itself.
 */
export function collectKeybindingSections(facts: KeybindingsFacts): readonly ReportSection[] {
  const section = (id: string, label: ReportLabelKey, rows: ReportRow[]): ReportSection => ({
    id,
    label,
    sortKey: 'key',
    columns: [...KEYBINDINGS_COLUMNS],
    rows: deduplicate(rows).toSorted((left, right) => compare(left.key, right.key)),
    omittedRows: 0,
  })
  return [
    section('keybindings/keybindings', 'keybindings', bindingRows(facts)),
    section('keybindings/conflicts', 'conflicts', conflictRows(facts)),
  ]
}
