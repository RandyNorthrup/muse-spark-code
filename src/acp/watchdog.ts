// ACP's local /watchdog: no turn, tool, backend request or model charge.
// Parsing and running load with the watchdog bundle on first use; a
// missing bundle answers unavailable rather than starting a model turn.
// The port answers list, status, pause, resume, poll, evidence, apply,
// decide and resolve over the bound store and sign-in; a missing port
// answers unavailable rather than starting a model turn. The record keeps
// a failure's kind; the person gets the fixed sentence.
import type { ContentBlock } from '@agentclientprotocol/sdk'
import { wireWordForLog, type CoreLogger } from '../core/logging'
import { UI_TEXT } from '../shared/constants'
import type { WatchdogCommand, WatchdogSurfacePort } from '../runtime/watchdog/command'

/** The watchdog bundle's slice the agent needs, installed with the
runtime's table. The runtime adapts the loaded bundle; tests hand in the
entry. */
export interface AcpWatchdogBundle {
  parseWatchdogCommand(argv: readonly string[]): WatchdogCommand | undefined
  requiresWatchdogGitHub(command: WatchdogCommand): boolean
  runWatchdogCommand(
    command: WatchdogCommand,
    port: WatchdogSurfacePort | undefined,
  ): Promise<{ readonly ok: boolean; readonly text: string }>
}

/** Only a lone text block is a local command. Attachments/extra blocks
are rejected for /watchdog rather than silently dropping their contents. */
export async function acpWatchdog(
  blocks: readonly ContentBlock[],
  port: (isGitHubCalled: boolean) => Promise<WatchdogSurfacePort | undefined>,
  loadBundle: () => AcpWatchdogBundle,
  log: CoreLogger,
): Promise<{ readonly ok: boolean; readonly text: string } | undefined> {
  const first = blocks[0]
  if (first?.type !== 'text' || !/^\s*\/watchdog(?:\s|$)/u.test(first.text)) return undefined
  if (blocks.length !== 1) return { ok: false, text: UI_TEXT.watchdog.cli.usage }
  // Only a bundle or a store that cannot be bound is unavailable (binding
  // the surface reads the store). A watchdog that loaded but whose command
  // fails carries the command's own failure.
  let bound: {
    readonly bundle: AcpWatchdogBundle
    readonly command: WatchdogCommand
    readonly surfacePort: WatchdogSurfacePort | undefined
  }
  try {
    const bundle = loadBundle()
    const text = first.text.trim().replace(/^\/watchdog\s*/u, '')
    const command = bundle.parseWatchdogCommand(text === '' ? [] : text.split(/\s+/u))
    if (command === undefined) return { ok: false, text: UI_TEXT.watchdog.cli.usage }
    bound = { bundle, command, surfacePort: await port(bundle.requiresWatchdogGitHub(command)) }
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error
    log.warn(`The watchdog surface is unavailable: ${wireWordForLog(error.name)}`)
    return { ok: false, text: UI_TEXT.watchdog.cli.unavailable }
  }
  try {
    return await bound.bundle.runWatchdogCommand(bound.command, bound.surfacePort)
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error
    log.warn(`The watchdog command failed: ${wireWordForLog(error.name)}`)
    return { ok: false, text: UI_TEXT.watchdog.cli.commandFailed }
  }
}
