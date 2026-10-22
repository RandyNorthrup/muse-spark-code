// ACP's local /playbook: no turn, tool, backend request or model charge.
// Parsing and rendering load with the journal bundle on first use; a
// missing bundle answers unavailable rather than starting a model turn.
import type { ContentBlock } from '@agentclientprotocol/sdk/unstable'
import { UI_TEXT } from '../shared/constants'
import type { PlaybookCommand, PlaybookSurfacePort } from '../runtime/playbook/command'

/** The journal bundle's slice the agent needs, installed with the runtime's
table. The runtime adapts the loaded bundle; tests hand in the entry. */
export interface AcpPlaybookBundle {
  parsePlaybookCommand(argv: readonly string[]): PlaybookCommand | undefined
  runPlaybookCommand(
    command: PlaybookCommand,
    port: PlaybookSurfacePort | undefined,
  ): Promise<{ readonly ok: boolean; readonly text: string }>
}

/** Only a lone text block is a local command. Attachments/extra blocks are
rejected for /playbook rather than silently dropping their contents. */
export async function acpPlaybook(
  blocks: readonly ContentBlock[],
  port: () => PlaybookSurfacePort | undefined,
  loadBundle: () => AcpPlaybookBundle,
): Promise<{ readonly ok: boolean; readonly text: string } | undefined> {
  const first = blocks[0]
  if (first?.type !== 'text' || !/^\s*\/playbook(?:\s|$)/u.test(first.text)) return undefined
  if (blocks.length !== 1) return { ok: false, text: UI_TEXT.playbookCommandUsage }
  // Only a bundle that cannot be loaded is unavailable. A playbook that
  // loaded but whose command fails carries the command's own failure.
  let bundle: AcpPlaybookBundle
  try {
    bundle = loadBundle()
  } catch {
    return { ok: false, text: UI_TEXT.playbookUnavailable }
  }
  const text = first.text.trim().replace(/^\/playbook\s*/u, '')
  const command = bundle.parsePlaybookCommand(text === '' ? [] : text.split(/\s+/u))
  if (command === undefined) return { ok: false, text: UI_TEXT.playbookCommandUsage }
  // Binding the surface reads the journal: a corrupt journal or an
  // unresolvable workspace throws here, and that is a missing surface, not
  // a loaded playbook's command failing.
  let surfacePort: PlaybookSurfacePort | undefined
  try {
    surfacePort = port()
  } catch {
    return { ok: false, text: UI_TEXT.playbookUnavailable }
  }
  return await bundle.runPlaybookCommand(command, surfacePort)
}
