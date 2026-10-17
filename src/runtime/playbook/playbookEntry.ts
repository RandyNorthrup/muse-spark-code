// /playbook's journal-backed surface as its own ACP-side bundle
// (dist/acpPlaybook.js): the engine (dist/acp.js) loads this on the first
// /playbook command or `playbook` CLI run, so the policy, journal and
// rendering stay out of the engine's startup. Each factory installs the
// caller's table before use; bundles keep their own language state.
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import {
  parsePlaybookCommand as parse,
  runPlaybookCli as runCli,
  runPlaybookCommand as runCommand,
  type PlaybookCommand,
  type PlaybookSurfacePort,
} from './command'
import { createPlaybookSurface as createSurface, type PlaybookSurfaceDeps } from './surface'

export function parsePlaybookCommand(argv: readonly string[]): PlaybookCommand | undefined {
  return parse(argv)
}

export function createPlaybookSurface(
  deps: PlaybookSurfaceDeps,
  table: UiText,
  locale: string,
): PlaybookSurfacePort {
  setUiText(table, locale)
  return createSurface(deps)
}

export function runPlaybookCommand(
  command: PlaybookCommand,
  port: PlaybookSurfacePort | undefined,
  table: UiText,
  locale: string,
): Promise<{ readonly ok: boolean; readonly text: string }> {
  setUiText(table, locale)
  return runCommand(command, port)
}

export function runPlaybookCli(
  argv: readonly string[],
  deps: {
    readonly port: PlaybookSurfacePort | undefined
    readonly writeStdout: (text: string) => void
    readonly printError: (text: string) => void
  },
  table: UiText,
  locale: string,
): Promise<number> {
  setUiText(table, locale)
  return runCli(argv, deps)
}
