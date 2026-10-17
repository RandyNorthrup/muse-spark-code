// M116-U. No process, filesystem, backend or credential access. The trusted
// adapter scopes this port to a team/workspace and persists through P's journal.
import * as z from 'zod/mini'
import {
  PLAYBOOK_CONFIGURABLE_RULES,
  PLAYBOOK_ID_MAX_CHARS,
  PLAYBOOK_PATCH_ROUNDS_MAX,
  PLAYBOOK_RECORD_MAX,
  REVIEW_FINDING_TEXT_MAX_CHARS,
  UI_TEXT,
} from '../../shared/constants'
import {
  playbookRecordSchema,
  playbookSettingsSchema,
  type PlaybookSettings,
} from '../../shared/playbook'
import { playbookText } from './text'

export const playbookSnapshotSchema = z.strictObject({
  settings: playbookSettingsSchema,
  records: z.array(playbookRecordSchema).check(z.maxLength(PLAYBOOK_RECORD_MAX)),
})
export type PlaybookSnapshot = z.infer<typeof playbookSnapshotSchema>

const reason = z
  .string()
  .check(z.trim(), z.minLength(1), z.maxLength(REVIEW_FINDING_TEXT_MAX_CHARS))
const reviewerId = z.string().check(z.trim(), z.minLength(1), z.maxLength(PLAYBOOK_ID_MAX_CHARS))
export const playbookChangeSchema = z.union([
  z.strictObject({ rule: z.enum(PLAYBOOK_CONFIGURABLE_RULES), enabled: z.literal(true) }),
  z.strictObject({ rule: z.enum(PLAYBOOK_CONFIGURABLE_RULES), enabled: z.literal(false), reason }),
  z.strictObject({ patchRoundsMax: z.int().check(z.gte(1), z.lte(PLAYBOOK_PATCH_ROUNDS_MAX)) }),
  z.strictObject({ fallbackReviewer: reviewerId, reason }),
  z.strictObject({ fallbackReviewer: z.literal('off') }),
])
export type PlaybookChange = z.infer<typeof playbookChangeSchema>

export interface PlaybookSurfacePort {
  /** Return scrubbed, bounded journal data. A read failure must reject. */
  read(): Promise<unknown>
  /** Authorize, stamp actor/time from trusted context, scrub, and persist
   * atomically before answering. Never accept actor/time from a UI request.
   * Must reject if unavailable, unauthorized or persistence fails. */
  change(change: PlaybookChange): Promise<unknown>
}

/** The adapter supplies identity and clock, not the model or editor request.
 * P owns authorization, second scrubbing, durable writes and concurrent updates. */
export function changedPlaybookSettings(
  current: PlaybookSettings,
  request: unknown,
  actor: string,
  at: number,
): PlaybookSettings {
  const settings = playbookSettingsSchema.parse(current)
  const change = playbookChangeSchema.parse(request)
  if ('patchRoundsMax' in change)
    return playbookSettingsSchema.parse({ ...settings, patchRoundsMax: change.patchRoundsMax })
  if ('fallbackReviewer' in change) {
    if (!('reason' in change))
      return playbookSettingsSchema.parse({ ...settings, fallbackReviewer: undefined })
    return playbookSettingsSchema.parse({
      ...settings,
      fallbackReviewer: {
        reviewerId: change.fallbackReviewer,
        actor,
        reason: change.reason,
        at,
      },
    })
  }
  const setting = change.enabled
    ? { enabled: true }
    : { enabled: false, reason: change.reason, actor, at }
  return playbookSettingsSchema.parse({
    ...settings,
    rules: { ...settings.rules, [change.rule]: setting },
  })
}

export type PlaybookCommand =
  | { readonly view: 'status' | 'record' | 'settings' }
  | { readonly view: 'settings'; readonly change: PlaybookChange }

/** Shared CLI and ACP grammar. Technical rule ids are stable across locales.
 * settings <rule> on|off [<reason...>]; settings patchRoundsMax 1|2;
 * settings fallbackReviewer <reviewer-id> [<reason...>]; settings fallbackReviewer off. */
export function parsePlaybookCommand(argv: readonly string[]): PlaybookCommand | undefined {
  const [view = 'status', rule, value, ...words] = argv
  if (view !== 'status' && view !== 'record' && view !== 'settings') return undefined
  if (rule === undefined) return { view }
  if (view !== 'settings') return undefined
  let candidate: unknown
  if (rule === 'patchRoundsMax') candidate = { patchRoundsMax: Number(value) }
  else if (rule === 'fallbackReviewer' && value !== undefined && value !== 'on')
    candidate =
      value === 'off'
        ? { fallbackReviewer: 'off' }
        : { fallbackReviewer: value, reason: words.join(' ') }
  else if (value === 'on') candidate = { rule, enabled: true }
  else if (value === 'off') candidate = { rule, enabled: false, reason: words.join(' ') }
  if ((rule === 'patchRoundsMax' || value === 'on') && words.length > 0) return undefined
  if (rule === 'fallbackReviewer' && value === 'off' && words.length > 0) return undefined
  const parsed = playbookChangeSchema.safeParse(candidate)
  return parsed.success ? { view, change: parsed.data } : undefined
}

/** Exit failure is explicit; no empty result stands in for an unavailable
 * policy/journal. Output contains validated data only, never exception text. */
export async function runPlaybookCommand(
  command: PlaybookCommand,
  port: PlaybookSurfacePort | undefined,
): Promise<{ readonly ok: boolean; readonly text: string }> {
  if (port === undefined) return { ok: false, text: UI_TEXT.playbookUnavailable }
  try {
    const raw =
      'change' in command
        ? await port.change(playbookChangeSchema.parse(command.change))
        : await port.read()
    const snapshot = playbookSnapshotSchema.parse(raw)
    return { ok: true, text: playbookText(command.view, snapshot) }
  } catch {
    return { ok: false, text: UI_TEXT.playbookUnavailable }
  }
}

/** The standalone CLI entry binds a trusted local port and its output streams.
 * A failed read/write reports failure on stderr and exits 1; bad syntax exits 2. */
export async function runPlaybookCli(
  argv: readonly string[],
  deps: {
    readonly port: PlaybookSurfacePort | undefined
    readonly writeStdout: (text: string) => void
    readonly printError: (text: string) => void
  },
): Promise<number> {
  const command = parsePlaybookCommand(argv)
  if (command === undefined) {
    deps.printError(UI_TEXT.playbookCommandUsage)
    return 2
  }
  const result = await runPlaybookCommand(command, deps.port)
  if (result.ok) {
    deps.writeStdout(result.text)
    return 0
  }
  deps.printError(result.text)
  return 1
}
