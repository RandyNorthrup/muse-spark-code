// The keybindings report's sections from static editor, panel and ACP facts.
// Pure: no file reads, no host calls, so VS Code, ACP and the CLI share the
// mapping and report the same numbers from the same inputs.
import type { ReportLabelKey, ReportRow, ReportSection } from '../../../shared/reportSchema'
import { compare, list, row, section as boundedSection, text } from './common'

export interface EditorKeybindingFact {
  readonly command: string
  readonly key: string
  readonly linux?: string | undefined
  readonly mac?: string | undefined
  readonly win?: string | undefined
  readonly when?: string | undefined
}
export interface PanelKeybindingFact {
  readonly context: string
  readonly key: string
  readonly when?: string | undefined
}
export interface AcpCommandFact {
  readonly name: string
  readonly when?: string | undefined
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
  { platform: 'linux', chord: (fact: EditorKeybindingFact) => fact.linux ?? fact.key },
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

function bindingRows(facts: KeybindingsFacts): { rows: ReportRow[]; omitted: number } {
  const rows: ReportRow[] = []
  let omitted = 0
  for (const fact of facts.editor) {
    for (const { platform, chord } of EDITOR_PLATFORMS) {
      const gesture = chord(fact).trim()
      // A blank chord names no gesture, so it is omitted and counted: the
      // section's omittedRows and the source's partial status name the gap.
      if (gesture === '') {
        omitted += 1
        continue
      }
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
        ['panel', fact.context, fact.key, fact.when ?? ''],
        {
          shortcut: text(fact.key),
          command: text(fact.context),
          scope: text(scopeFor(fact.when, 'panel')),
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
          scope: text(scopeFor(fact.when, 'acp')),
        },
        ['keybindings'],
      ),
    )
  }
  return { rows, omitted }
}

/**
 * A conflict is two editor bindings for the same platform chord whose `when`
 * clauses are equal (both empty counts): both fire together and the winner is
 * registration order. Different `when` clauses are shadowing by design — the
 * narrower context wins there — so they are not conflicts. The group key
 * carries the `when` clause, and the row shows the shared clause in its
 * scope, so a clash under one clause never reads as an editor-wide clash.
 */
interface ChordGroup {
  readonly chord: string
  readonly platform: string
  readonly when: string | undefined
  readonly facts: EditorKeybindingFact[]
}

/**
 * A conflict group key: the JSON of the tuple (platform, normalised chord,
 * `when` clause). Structured, never concatenated, so `ctrl+k` under
 * `when: 'ab'` can never share a key with `ctrl+kab` ungated, and a chord
 * sequence can never collide with a chord plus a clause either. JSON over a
 * fixed tuple of strings is injective, so equal keys mean equal groups.
 */
function conflictGroupKey(platform: string, gesture: string, when: string | undefined): string {
  return JSON.stringify([platform, normalizeChord(gesture), when ?? ''])
}

function conflictRows(facts: KeybindingsFacts): { rows: ReportRow[]; omitted: number } {
  const groups = new Map<string, ChordGroup>()
  for (const fact of facts.editor) {
    for (const { platform, chord } of EDITOR_PLATFORMS) {
      const gesture = chord(fact).trim()
      // A blank chord names no gesture, so it cannot clash: the bindings
      // section counts the skip and the source reports partial, and this
      // section stays silent about it.
      if (gesture === '') continue
      const identity = conflictGroupKey(platform, gesture, fact.when)
      const group = groups.get(identity)
      // The cell keeps the normalized chord, so the same bindings render
      // the same bytes no matter which fact arrived first.
      if (group === undefined)
        groups.set(identity, {
          chord: normalizeChord(gesture),
          platform,
          when: fact.when,
          facts: [fact],
        })
      else group.facts.push(fact)
    }
  }
  // Emission order is input order; the section builder sorts rows by their
  // content-digest keys, so output never depends on fact order.
  const rows: ReportRow[] = []
  for (const group of groups.values()) {
    // The row is built from the group's members in a sorted, stated order
    // (by command, duplicates dropped), so its bytes never depend on which
    // fact arrived first either.
    const members = group.facts.toSorted((left, right) => compare(left.command, right.command))
    const commands = [...new Set(members.map((fact) => fact.command))]
    if (commands.length < 2) continue
    rows.push(
      row(
        'keybindingConflict',
        [group.platform, group.chord, group.when ?? '', ...commands],
        {
          shortcut: text(group.chord),
          command: list(commands),
          scope: text(scopeFor(group.when, `editor/${group.platform}`)),
        },
        ['keybindings'],
      ),
    )
  }
  return { rows, omitted: 0 }
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
 * Both facets pass through the engine's final row admission before validation. A skipped blank chord
 * counts on the bindings section only, so the gap stays visible either way.
 */
export function collectKeybindingSections(facts: KeybindingsFacts): readonly ReportSection[] {
  const section = (
    id: string,
    label: ReportLabelKey,
    rows: ReportRow[],
    omittedRows: number,
  ): ReportSection => {
    const admitted = boundedSection(id, label, KEYBINDINGS_COLUMNS, deduplicate(rows), {
      full: true,
    })
    return { ...admitted, omittedRows: admitted.omittedRows + omittedRows }
  }
  const bindings = bindingRows(facts)
  const conflicts = conflictRows(facts)
  return [
    section('keybindings/keybindings', 'keybindings', bindings.rows, bindings.omitted),
    section('keybindings/conflicts', 'conflicts', conflicts.rows, conflicts.omitted),
  ]
}
