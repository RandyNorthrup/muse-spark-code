import { SHARE_SCHEMA_VERSION, UI_TEXT } from '../../shared/constants'
import { savedPromptSchema, type SavedPrompt } from '../../shared/prompts'
import {
  shareJsonSchema,
  scrubShareText,
  type SharePrivacyPort,
  type ShareRequest,
} from '../../shared/share'
import { renderChatShareHtml } from './html'

/** Portable prompt projection shares the chat scrub and static HTML renderer. */
export function buildPromptShare(
  prompt: SavedPrompt,
  request: ShareRequest,
  exportedAt: string,
  privacy: SharePrivacyPort,
) {
  if (request.target !== 'prompt') throw new Error(UI_TEXT.promptFileInvalid)
  const clean = savedPromptSchema.parse(
    JSON.parse(
      JSON.stringify(prompt, (_key, value: unknown) =>
        typeof value === 'string' ? scrubShareText(value, privacy) : value,
      ),
    ),
  )
  const document = shareJsonSchema.parse({
    schemaVersion: SHARE_SCHEMA_VERSION,
    title: clean.title,
    createdAt: exportedAt,
    scrubbed: true,
    mode: request.mode,
    options: request.options,
    target: 'prompt',
    prompt: clean,
  })
  let content: string
  if (request.format === 'json') content = JSON.stringify(document, undefined, 2)
  else if (request.format === 'md') content = `# ${clean.title}\n\n${clean.body}`
  else
    content = renderChatShareHtml({
      schemaVersion: SHARE_SCHEMA_VERSION,
      title: clean.title,
      createdAt: exportedAt,
      scrubbed: true,
      mode: request.mode,
      options: request.options,
      target: 'chat',
      items: [{ id: clean.id, kind: 'userMessage', text: clean.body }],
    })
  return { document, content }
}
