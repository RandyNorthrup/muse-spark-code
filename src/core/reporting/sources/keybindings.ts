// The keybindings report source: the installed manifest's editor bindings
// plus the panel's gestures and ACP's static local commands. The manifest is
// the only host-varying input (VS Code, ACP and the CLI each pass their own
// install's file); panel and ACP facts are static code, identical in every
// host, so the three report the same numbers. Desktop and TUI bindings are
// phase c (M111a, M110a0) and stay out until those lanes land.
import * as z from 'zod/mini'
import { REPORT_MAX_TEXT_CHARS } from '../../../shared/constants'
import { referenceKeyboardActions } from '../../../shared/keybindings'
import { localSource, LocalSourceError } from './local'
import {
  collectKeybindingSections,
  type AcpCommandFact,
  type KeybindingsFacts,
} from '../collect/keybindings'

const textField = z.string().check(z.minLength(1), z.maxLength(REPORT_MAX_TEXT_CHARS))
const optionalTextField = z.optional(
  z.string().check(z.minLength(1), z.maxLength(REPORT_MAX_TEXT_CHARS)),
)

const manifestSchema = z.object({
  contributes: z.object({
    commands: z.array(
      z.object({
        command: textField,
      }),
    ),
    keybindings: z.array(
      z.object({
        command: textField,
        key: textField,
        mac: optionalTextField,
        win: optionalTextField,
        when: optionalTextField,
      }),
    ),
  }),
})

/**
 * ACP's static local slash commands, as `/help` lists them (UI_TEXT
 * `referenceAcp`): panel slash commands, settings and editor dialogs in the
 * linked reference are extension workflows, not ACP commands, and installed
 * skills add dynamic commands per session, so neither is listed. The parity
 * test pins this table to that sentence.
 */
export const ACP_COMMAND_NAMES = [
  'help',
  'report',
  'playbook',
  'compact',
  'legal',
  'usage',
  'resources',
  'resources resume',
  'usage resources',
  'questions',
  'answer',
  'prompt',
  'share',
  'agents',
] as const

/** The installed manifest, read by the host; failures keep their local code. */
export type KeybindingsManifestReader = () => unknown

function acpFacts(): readonly AcpCommandFact[] {
  return ACP_COMMAND_NAMES.map((name) => ({ name }))
}

/** Static panel gestures beside the host's manifest; one input, every host. */
export function keybindingsFacts(manifest: unknown): KeybindingsFacts {
  let parsed: z.infer<typeof manifestSchema>
  try {
    parsed = manifestSchema.parse(manifest)
  } catch {
    throw new LocalSourceError('invalid')
  }
  // Every declared binding is listed, including bindings for built-in
  // commands (the manifest rebinds `editor.action.inlineSuggest.trigger`):
  // the editor resolves those itself, and shape validation above is the
  // corruption guard, not command identity.
  const editor = parsed.contributes.keybindings.map((entry) => ({
    command: entry.command,
    key: entry.key,
    ...(entry.mac !== undefined && { mac: entry.mac }),
    ...(entry.win !== undefined && { win: entry.win }),
    ...(entry.when !== undefined && { when: entry.when }),
  }))
  return {
    editor,
    panel: referenceKeyboardActions().map((entry) => ({ context: entry.command, key: entry.key })),
    acp: acpFacts(),
  }
}

/** One lazy pipeline per host shares this kind; missing input stays unbound. */
export function keybindingsSource(readManifest: KeybindingsManifestReader) {
  // Section labels stay identifier keys; renderers resolve UI_TEXT at use
  // time, so no display text is read here at all.
  return localSource('keybindings', async () => {
    return { data: collectKeybindingSections(keybindingsFacts(await readManifest())) }
  })
}
