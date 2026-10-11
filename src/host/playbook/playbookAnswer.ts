// `/playbook` answered in the VS Code composer without a model turn (M116,
// M126 F9): the same journal-backed parse and run the ACP agent and the CLI
// use. This module loads with the conversation bundle; the journal bundle
// (dist/acpPlaybook.js) loads on the first command, so activation carries
// none of the policy and the journal file is the one the other editors read.
// Whatever the bundle cannot do answers with the unavailable words, never
// with a model turn.
import type { CoreLogger } from '../../core/logging'
import type { UiText } from '../../shared/l10n/en'
import { isPlaybookBundle } from '../../runtime/playbook/playbookBundle'
import type * as PlaybookBundle from '../../runtime/playbook/playbookEntry'
import { UI_TEXT } from '../../shared/l10n/text'

/** What the composer shows for a `/playbook` command: the journal's answer. */
export interface PlaybookAnswer {
  readonly ok: boolean
  readonly text: string
}

/**
 * Everything the answer needs from the host window. The bundle loads through
 * `loadBundle` so tests hand in the journal bundle's slice; production
 * requires `dist/acpPlaybook.js`, whose shape `isPlaybookBundle` checks
 * (PLAN.md §8: same-build signatures are trusted after checking).
 */
export interface PlaybookSource {
  readonly loadBundle: () => unknown
  /** The machine's agent data folder; the journal file lives under it. */
  readonly agentDataFolder: string
  /** No open folder means no journal in this window: the unavailable words answer. */
  readonly workspaceRoot: string | undefined
  readonly table: UiText
  readonly locale: string
  readonly log: CoreLogger
}

/** Only a `/playbook` command is answered; anything else is not a command. */
export async function answerPlaybookCommand(
  source: PlaybookSource | undefined,
  text: string,
): Promise<PlaybookAnswer | undefined> {
  if (!/^\s*\/playbook(?:\s|$)/u.test(text)) return undefined
  if (source === undefined) return { ok: false, text: UI_TEXT.playbookUnavailable }
  let bundle: typeof PlaybookBundle
  try {
    const loaded = source.loadBundle()
    if (!isPlaybookBundle(loaded)) throw new Error('no playbook bundle')
    bundle = loaded
  } catch {
    // Fixed words only: a bundle path or load failure must never reach the log.
    source.log.warn('The playbook bundle is unavailable')
    return { ok: false, text: source.table.playbookUnavailable }
  }
  // The ACP agent's grammar: the bare command shows status (acp/playbook.ts).
  const words = text.trim().replace(/^\/playbook\s*/u, '')
  const command = bundle.parsePlaybookCommand(words === '' ? [] : words.split(/\s+/u))
  if (command === undefined) return { ok: false, text: source.table.playbookCommandUsage }
  try {
    const port =
      source.workspaceRoot === undefined
        ? undefined
        : bundle.createPlaybookSurface(
            {
              agentDataFolder: source.agentDataFolder,
              workspaceFolder: source.workspaceRoot,
              teamId: 'panel',
              laneId: 'surface',
            },
            source.table,
            source.locale,
          )
    return await bundle.runPlaybookCommand(command, port, source.table, source.locale)
  } catch {
    source.log.warn('The playbook journal is unavailable')
    return { ok: false, text: source.table.playbookUnavailable }
  }
}
