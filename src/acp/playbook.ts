// ACP's local /playbook: no turn, tool, backend request or model charge.
import type { ContentBlock } from '@agentclientprotocol/sdk'
import { UI_TEXT } from '../shared/constants'
import {
  parsePlaybookCommand,
  runPlaybookCommand,
  type PlaybookSurfacePort,
} from '../runtime/playbook/command'

/** Only a lone text block is a local command. Attachments/extra blocks are
 * rejected for /playbook rather than silently dropping their contents. */
export async function acpPlaybook(
  blocks: readonly ContentBlock[],
  port: () => PlaybookSurfacePort | undefined,
): Promise<{ readonly ok: boolean; readonly text: string } | undefined> {
  const first = blocks[0]
  if (first?.type !== 'text' || !/^\s*\/playbook(?:\s|$)/u.test(first.text)) return undefined
  if (blocks.length !== 1) return { ok: false, text: UI_TEXT.playbookCommandUsage }
  const text = first.text.trim().replace(/^\/playbook\s*/u, '')
  const command = parsePlaybookCommand(text === '' ? [] : text.split(/\s+/u))
  if (command === undefined) return { ok: false, text: UI_TEXT.playbookCommandUsage }
  try {
    return await runPlaybookCommand(command, port())
  } catch {
    return { ok: false, text: UI_TEXT.playbookUnavailable }
  }
}
