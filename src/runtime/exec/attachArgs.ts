// M105 headless attachments: explicit local inputs, with workspace confinement.
// The ACP media binding repeats policy/identity checks before it opens them.
import path from 'node:path'
import { realpath } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import type { ContentBlock } from '@agentclientprotocol/sdk'
import { MAX_ATTACHMENTS_PER_MESSAGE, UI_TEXT } from '../../shared/constants'
import { confineWorkspacePath } from '../../core/workspacePath'
import type { ExecOptions } from './execArgs'

export type ExecAttachmentOptions = ExecOptions & { readonly attachFiles?: readonly string[] }

export function parseAttachArgs(
  value: unknown,
):
  | { readonly ok: true; readonly files: readonly string[] }
  | { readonly ok: false; readonly reason: string } {
  if (value === undefined) return { ok: true, files: [] }
  if (
    !Array.isArray(value) ||
    value.some(
      (file: unknown) => typeof file !== 'string' || file.trim() === '' || file.includes('\0'),
    )
  )
    return { ok: false, reason: UI_TEXT.attachmentUnreadable }
  if (value.length > MAX_ATTACHMENTS_PER_MESSAGE)
    return { ok: false, reason: UI_TEXT.attachmentLimit }
  return {
    ok: true,
    files: value.filter((file: unknown): file is string => typeof file === 'string'),
  }
}

/** Links carry no bytes, canonical paths or upload IDs into exec's event/result stream. */
export async function execAttachmentBlocks(
  files: readonly string[],
  cwd: string,
  signal: AbortSignal,
  platform: NodeJS.Platform = process.platform,
  realPath: (given: string) => Promise<string> = realpath,
): Promise<ContentBlock[]> {
  const parsed = parseAttachArgs(files)
  if (!parsed.ok) throw new Error(parsed.reason)
  const blocks: ContentBlock[] = []
  for (const given of parsed.files) {
    signal.throwIfAborted()
    const confined = await confineWorkspacePath(cwd, given, platform, { realPath })
    signal.throwIfAborted()
    if (!confined.ok) throw new Error(UI_TEXT.textFilePrivate)
    const uri = pathToFileURL(confined.absolute, { windows: platform === 'win32' }).href
    blocks.push({
      type: 'resource_link',
      uri,
      name: path.posix.basename(confined.relative.replaceAll('\\', '/')),
    })
  }
  return blocks
}
