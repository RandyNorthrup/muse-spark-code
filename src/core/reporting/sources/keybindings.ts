// The keybindings report source: the installed manifest's editor bindings
// plus the panel's gestures and ACP's static local commands. The manifest is
// the only host-varying input (VS Code, ACP and the CLI each pass their own
// install's file); panel and ACP facts are static code, identical in every
// host, so the three report the same numbers. Desktop and TUI bindings are
// phase c (M111a, M110a0) and stay out until those lanes land.
import * as z from 'zod/mini'
import {
  ACP_COMPACT_COMMAND,
  REPORT_MAX_TEXT_CHARS,
  SLASH_COMMAND_NAMES,
} from '../../../shared/constants'
import type { UiText } from '../../../shared/l10n/en'
import { referenceKeyboardActions } from '../../../shared/keybindings'
import { readReportRows, type ReportProblem } from './boundary'
import { localSource, LocalSourceError, sourceReason } from './local'
import {
  collectKeybindingSections,
  type AcpCommandFact,
  type KeybindingsFacts,
} from '../collect/keybindings'

const textField = z.string().check(z.minLength(1), z.maxLength(REPORT_MAX_TEXT_CHARS))
const optionalTextField = z.optional(
  z.string().check(z.minLength(1), z.maxLength(REPORT_MAX_TEXT_CHARS)),
)

const manifestCommandSchema = z.object({
  command: textField,
})
const manifestBindingSchema = z.object({
  command: textField,
  key: textField,
  linux: optionalTextField,
  mac: optionalTextField,
  win: optionalTextField,
  when: optionalTextField,
})
const manifestSchema = z.object({
  contributes: z.object({
    commands: z.unknown(),
    keybindings: z.unknown(),
  }),
})

export interface AcpCommandEntry {
  readonly name: string
  /** The port that gates the announcement; absent means always announced. */
  readonly when?: string | undefined
}

/**
 * ACP's static local slash commands: the names `refreshCommands`
 * (`src/acp/agent.ts`) announces, with the port that gates each one.
 * Shared names come from the same constants the agent reads; the rest
 * match that table's own entries, and the parity test reads that table
 * back, so a new registrar entry fails there until the report lists it.
 * Installed skills add dynamic commands per session, so they are not
 * listed. `/resources resume` and `/usage resources` are argument forms
 * of `resources` and `usage`, not commands of their own.
 */
export const ACP_COMMAND_FACTS: readonly AcpCommandEntry[] = [
  { name: 'help' },
  { name: 'share', when: 'sharing' },
  { name: 'prompt', when: 'sharing' },
  { name: 'vault', when: 'vault' },
  { name: 'accounts', when: 'accounts' },
  { name: ACP_COMPACT_COMMAND },
  { name: SLASH_COMMAND_NAMES.report },
  { name: 'legal', when: 'legalScan' },
  { name: 'usage', when: 'usage|resources' },
  { name: 'resources', when: 'resources' },
  { name: 'agents' },
  { name: 'playbook', when: 'playbook' },
  { name: 'schedule', when: 'schedules' },
  { name: 'attach', when: 'media, not headless' },
  { name: 'record', when: 'media, not headless' },
  { name: SLASH_COMMAND_NAMES.estimate, when: 'estimate' },
  { name: 'answer', when: 'questions' },
  { name: 'questions', when: 'questions' },
]

/** The installed manifest, read by the host; failures keep their local code. */
export type KeybindingsManifestReader = () => unknown

function acpFacts(): readonly AcpCommandFact[] {
  return ACP_COMMAND_FACTS.map((entry) =>
    entry.when === undefined ? { name: entry.name } : { name: entry.name, when: entry.when },
  )
}

/** Static panel gestures beside the host's manifest; one input, every host. */
export function keybindingsFacts(
  reportText: UiText,
  manifest: unknown,
): { readonly facts: KeybindingsFacts; readonly problems: readonly ReportProblem[] } {
  let contributes: z.infer<typeof manifestSchema>['contributes']
  try {
    contributes = manifestSchema.parse(manifest).contributes
  } catch {
    throw new LocalSourceError('invalid')
  }
  // Every declared binding is listed, including bindings for built-in
  // commands (the manifest rebinds `editor.action.inlineSuggest.trigger`):
  // the editor resolves those itself, and per-record validation below is
  // the corruption guard, not command identity. One damaged declaration is
  // a named problem beside the good rows, never a lost source (RVREPORTJOIN
  // P2-1).
  const bindings = readReportRows(
    reportText,
    'keybindings',
    'keybindings/bindings',
    contributes.keybindings,
    manifestBindingSchema,
  )
  const commands = readReportRows(
    reportText,
    'keybindings',
    'keybindings/commands',
    contributes.commands,
    manifestCommandSchema,
  )
  // Declared commands carry no facts, but their damage is still named.
  const problems = [...bindings.problems, ...commands.problems]
  const editor = bindings.rows.map((entry) => ({
    command: entry.command,
    key: entry.key,
    ...(entry.linux !== undefined && { linux: entry.linux }),
    ...(entry.mac !== undefined && { mac: entry.mac }),
    ...(entry.win !== undefined && { win: entry.win }),
    ...(entry.when !== undefined && { when: entry.when }),
  }))
  return {
    facts: {
      editor,
      // `referenceKeyboardActions` falls back to the context name when no
      // gesture in that context carries a setting gate, so only a different
      // `when` is a real gate to report on the panel row.
      panel: referenceKeyboardActions().map((entry) => ({
        context: entry.command,
        key: entry.key,
        ...(entry.when !== entry.command && { when: entry.when }),
      })),
      acp: acpFacts(),
    },
    problems,
  }
}

/** One lazy pipeline per host shares this kind; missing input stays unbound. */
export function keybindingsSource(readManifest: KeybindingsManifestReader) {
  // Section labels stay identifier keys; renderers resolve UI_TEXT at use
  // time, so no display text is read here at all.
  return localSource('keybindings', async (context) => {
    const recovered = keybindingsFacts(context.reportText, await readManifest())
    const sections = collectKeybindingSections(recovered.facts)
    const omitted = sections.reduce((total, section) => total + section.omittedRows, 0)
    const partial = [
      ...recovered.problems.map((problem) => problem.reason),
      ...(omitted > 0 ? [sourceReason('invalid', context.reportText)] : []),
    ].join(' ')
    // A skipped blank chord is invalid data, not a full read: the section
    // counts it and the source reports partial with that reason.
    return {
      data: sections,
      ...(partial !== '' && { partial }),
    }
  })
}
