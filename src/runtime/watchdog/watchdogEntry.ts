// /watchdog's issue surface as its own ACP-side bundle
// (dist/acpWatchdog.js): the engine (dist/acp.js) loads this on the first
// /watchdog command or `watchdog` CLI run, so the GitHub client, the
// schedule store and the triage charter stay out of the engine's startup.
// Each factory installs the caller's table before use; bundles keep their
// own language state.
import type { CoreLogger } from '../../core/logging'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import {
  parseWatchdogCommand as parse,
  runWatchdogCli as runCli,
  runWatchdogCommand as runCommand,
  requiresWatchdogGitHub as requiresGitHub,
  type WatchdogCommand,
  type WatchdogSurfacePort,
} from './command'
import { createWatchdogSurface as createSurface, type WatchdogSurfaceDeps } from './surface'

export function parseWatchdogCommand(argv: readonly string[]): WatchdogCommand | undefined {
  return parse(argv)
}

export function requiresWatchdogGitHub(command: WatchdogCommand): boolean {
  return requiresGitHub(command)
}

export function createWatchdogSurface(
  deps: WatchdogSurfaceDeps,
  table: UiText,
  locale: string,
): Promise<WatchdogSurfacePort> {
  setUiText(table, locale)
  return createSurface(deps)
}

export function runWatchdogCommand(
  command: WatchdogCommand,
  port: WatchdogSurfacePort | undefined,
  table: UiText,
  locale: string,
): Promise<{ readonly ok: boolean; readonly text: string }> {
  setUiText(table, locale)
  return runCommand(command, port)
}

export function runWatchdogCli(
  argv: readonly string[],
  deps: {
    readonly port: WatchdogSurfacePort | undefined
    readonly writeStdout: (text: string) => void
    readonly printError: (text: string) => void
    readonly log: CoreLogger
  },
  table: UiText,
  locale: string,
): Promise<number> {
  setUiText(table, locale)
  return runCli(argv, deps)
}
