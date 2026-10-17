import type { ItemSnapshot } from '../../shared/agentEvents'
import { AGENT_RECEIPT_MAX_CHARS, AGENT_RECEIPT_MAX_ROWS } from '../../shared/constants'
import { agentFilesFromPatch } from '../../shared/agentReceipt'
import type { AgentSession } from './agentBackend'

/** Lazy, local inspection of captured patch refs. Missing/oversized pages stay unavailable. */
export async function agentReceiptFiles(
  items: readonly ItemSnapshot[],
  readOutput: AgentSession['readOutput'],
): Promise<readonly ItemSnapshot[]> {
  let remaining = AGENT_RECEIPT_MAX_CHARS
  const result: ItemSnapshot[] = []
  const selected = items.slice(-AGENT_RECEIPT_MAX_ROWS)
  for (const item of selected) {
    if (remaining === 0 || item.changedFiles !== undefined || item.patchRef === undefined) {
      result.push(item)
      continue
    }
    try {
      const page = await readOutput({
        itemId: item.itemId,
        outputRef: item.patchRef.id,
        offsetBytes: 0,
        lengthBytes: remaining,
      })
      remaining = Math.max(0, remaining - Math.max(page.byteLen, page.content.length))
      result.push(page.eof ? { ...item, changedFiles: agentFilesFromPatch(page.content) } : item)
    } catch {
      // A failed local output read is represented by absent file evidence, never success.
      result.push(item)
    }
  }
  return [...items.slice(0, -AGENT_RECEIPT_MAX_ROWS), ...result]
}
