// ACP's local /playbook: no turn, tool, backend request or model charge.
// Parsing and rendering load with the journal bundle on first use; a
// missing bundle answers unavailable rather than starting a model turn.
import type { ContentBlock } from '@agentclientprotocol/sdk'
import { UI_TEXT } from '../shared/constants'
import type { PlaybookCommand, PlaybookSurfacePort } from '../runtime/playbook/command'

/** The journal bundle's slice the agent needs, installed with the runtime's
 * table. The runtime adapts the loaded bundle; tests hand in the entry. */
export interface AcpPlaybookBundle {
  parsePlaybookCommand(argv: readonly string[]): PlaybookCommand | undefined
  runPlaybookCommand(
    command: PlaybookCommand,
    port: PlaybookSurfacePort | undefined,
  ): Promise<{ readonly ok: boolean; readonly text: string }>
}

/** Only a lone text block is a local command. Attachments/extra blocks are
 * rejected for /playbook rather than silently dropping their contents. */
export async function acpPlaybook(
  blocks: readonly ContentBlock[],
  port: () => PlaybookSurfacePort | undefined,
  loadBundle: () => AcpPlaybookBundle,
): Promise<{ readonly ok: boolean; readonly text: string } | undefined> {
  const first = blocks[0]
  if (first?.type !== 'text' || !/^\s*\/playbook(?:\s|$)/u.test(first.text)) return undefined
  if (blocks.length !== 1) return { ok: false, text: UI_TEXT.playbookCommandUsage }
  try {
    const bundle = loadBundle()
    const text = first.text.trim().replace(/^\/playbook\s*/u, '')
    const command = bundle.parsePlaybookCommand(text === '' ? [] : text.split(/\s+/u))
    return command === undefined
      ? { ok: false, text: UI_TEXT.playbookCommandUsage }
      : await bundle.runPlaybookCommand(command, port())
  } catch {
    return { ok: false, text: UI_TEXT.playbookUnavailable }
  }
}
