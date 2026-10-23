// ACP's local /watchdog: no turn, tool, backend request or model
// charge. The port answers list, status, pause, resume, poll, evidence,
// apply, decide and resolve over the bound store and sign-in; a missing
// port answers unavailable rather than starting a model turn. The record
// keeps a failure's kind; the person gets the fixed sentence.
import type { ContentBlock } from '@agentclientprotocol/sdk'
import { wireWordForLog, type CoreLogger } from '../core/logging'
import { UI_TEXT } from '../shared/constants'
import {
  parseWatchdogCommand,
  runWatchdogCommand,
  type WatchdogSurfacePort,
} from '../runtime/watchdog/command'

/** Only a lone text block is a local command. Attachments/extra blocks
are rejected for /watchdog rather than silently dropping their contents. */
export async function acpWatchdog(
  blocks: readonly ContentBlock[],
  port: () => Promise<WatchdogSurfacePort | undefined>,
  log: CoreLogger,
): Promise<{ readonly ok: boolean; readonly text: string } | undefined> {
  const first = blocks[0]
  if (first?.type !== 'text' || !/^\s*\/watchdog(?:\s|$)/u.test(first.text)) return undefined
  if (blocks.length !== 1) return { ok: false, text: UI_TEXT.watchdog.cli.usage }
  // Binding the surface reads the store: a store that cannot be bound
  // is a missing surface, not a command failing.
  let surfacePort: WatchdogSurfacePort | undefined
  try {
    surfacePort = await port()
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error
    log.warn(`The watchdog surface is unavailable: ${wireWordForLog(error.name)}`)
    return { ok: false, text: UI_TEXT.watchdog.cli.unavailable }
  }
  const text = first.text.trim().replace(/^\/watchdog\s*/u, '')
  const command = parseWatchdogCommand(text === '' ? [] : text.split(/\s+/u))
  if (command === undefined) return { ok: false, text: UI_TEXT.watchdog.cli.usage }
  try {
    return await runWatchdogCommand(command, surfacePort)
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error
    log.warn(`The watchdog command failed: ${wireWordForLog(error.name)}`)
    return { ok: false, text: UI_TEXT.watchdog.cli.commandFailed }
  }
}
