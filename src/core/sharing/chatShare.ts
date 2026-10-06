import { fromMarkdown } from 'mdast-util-from-markdown'
import { isConversationShareItem, type ItemSnapshot } from '../../shared/agentEvents'
import {
  SESSION_EXPORT_MAX_BYTES,
  SESSION_EXPORT_MAX_ITEMS,
  SHARE_SCHEMA_VERSION,
  UI_TEXT,
} from '../../shared/constants'
import {
  shareJsonSchema,
  shareRequestSchema,
  scrubShareText,
  type ShareJson,
  type SharePrivacyPort,
  type ShareRequest,
} from '../../shared/share'
import { renderTranscriptMarkdown } from '../export/transcriptMarkdown'
import { renderChatShareHtml } from './html'

export type ChatShareRequest = Extract<ShareRequest, { target: 'chat' }>
export type ChatShareDocument = Extract<ShareJson, { target: 'chat' }>
type ShareItem = ChatShareDocument['items'][number]

/** Display material from the existing snapshot/store, never a new wire shape. */
export interface ChatShareSource {
  readonly sessionId: string
  readonly title: string
  readonly exportedAt: string
  readonly items: readonly ItemSnapshot[]
  /** Stable ids supplied by the attachment store; metadata-only history has generated ids. */
  readonly attachments?: readonly {
    readonly messageId: string
    readonly id: string
    readonly name?: string
    readonly content?: string
  }[]
  /** Already resolved, shown diffs, keyed by snapshot item id. No patch handles. */
  readonly diffs?: ReadonlyMap<string, string>
  /** Already shown approval/decision text from the transcript, not a new history wire field. */
  readonly decisions?: ReadonlyMap<string, string>
}

/** Inclusive message endpoints; activity between them remains in full mode. */
function selectedItems(
  source: ChatShareSource,
  request: ChatShareRequest,
): readonly ItemSnapshot[] {
  if (request.sessionId !== source.sessionId) throw new Error(UI_TEXT.shareRangeInvalid)
  const ids = new Set(source.items.map((item) => item.itemId))
  if (ids.size !== source.items.length) throw new Error(UI_TEXT.shareRangeInvalid)
  if (request.range === undefined) return source.items
  const { from, to } = request.range
  const first = source.items.findIndex(
    (item) => item.itemId === from && isConversationShareItem(item),
  )
  const last = source.items.findIndex((item) => item.itemId === to && isConversationShareItem(item))
  if (first === -1 || last < first) throw new Error(UI_TEXT.shareRangeInvalid)
  return source.items.slice(first, last + 1)
}

/** Remove parser-identified fenced/indented blocks, preserving other Markdown byte for byte. */
function withoutCodeBlocks(text: string): string {
  const spans: { start: number; end: number }[] = []
  const visit = (
    node: ReturnType<typeof fromMarkdown> | ReturnType<typeof fromMarkdown>['children'][number],
  ): void => {
    if (node.type === 'code') {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start !== undefined && end !== undefined) spans.push({ start, end })
    } else if ('children' in node) {
      for (const child of node.children) visit(child)
    }
  }
  visit(fromMarkdown(text))
  let clean = text
  const orderedSpans = spans.toSorted((a, b) => b.start - a.start)
  for (const { start, end } of orderedSpans) {
    clean = clean.slice(0, start) + clean.slice(end)
  }
  return clean
}

function fullText(item: ItemSnapshot, shouldIncludeDiffs: boolean): string | undefined {
  if (!shouldIncludeDiffs && item.kind === 'diff') return undefined
  const parts = [
    item.text,
    item.fallbackText,
    item.objective,
    item.result?.text ?? item.result?.summary,
    item.message,
    item.failureReason,
  ].filter((text) => text !== undefined)
  return parts.length === 0 ? undefined : parts.join('\n\n')
}

/** One projection for every format; full mode has exactly the same privacy policy. */
export function buildChatShare(
  source: ChatShareSource,
  input: unknown,
  privacy: SharePrivacyPort,
): ChatShareDocument {
  const request = shareRequestSchema.parse(input)
  if (request.target !== 'chat') throw new Error(UI_TEXT.shareRangeInvalid)
  if (source.items.length > SESSION_EXPORT_MAX_ITEMS) throw new Error(UI_TEXT.shareTooLarge)
  const selected = selectedItems(source, request)
  const scrub = (text: string) => scrubShareText(text, privacy)
  const idMap = new Map<string, string>()
  const usedIds = new Set<string>()
  const portableId = (raw: string): string => {
    const existing = idMap.get(raw)
    if (existing !== undefined) return existing
    const clean = scrub(raw) || '[redacted]'
    let id = clean
    let suffix = 1
    while (usedIds.has(id)) {
      id = `${clean}~${String(suffix)}`
      suffix += 1
    }
    usedIds.add(id)
    idMap.set(raw, id)
    return id
  }
  const contentIds = new Set(request.options.attachmentContents)
  const availableIds = new Set<string>()
  const items: ShareItem[] = []
  for (const item of selected) {
    if (request.mode === 'conversation' && !isConversationShareItem(item)) continue
    const shared: ShareItem = { id: portableId(item.itemId), kind: scrub(item.kind) }
    const text = request.mode === 'conversation' ? item.text : fullText(item, request.options.diffs)
    if (text !== undefined)
      shared.text = scrub(request.options.codeBlocks ? text : withoutCodeBlocks(text))
    const stored = source.attachments?.filter((attachment) => attachment.messageId === item.itemId)
    const attachments: readonly { id: string; name?: string; content?: string }[] =
      stored !== undefined && stored.length > 0
        ? stored
        : (item.attachments ?? []).map((attachment, index) => ({
            id: `${item.itemId}:attachment:${String(index)}`,
            ...(attachment.name !== undefined && { name: attachment.name }),
          }))
    if (attachments.length > 0) {
      shared.attachments = attachments.map((attachment) => {
        availableIds.add(attachment.id)
        if (contentIds.has(attachment.id) && attachment.content === undefined)
          throw new Error(UI_TEXT.shareAttachmentUnavailable)
        return {
          id: portableId(attachment.id),
          ...(request.options.attachmentNames &&
            attachment.name !== undefined && { name: scrub(attachment.name) }),
          ...(contentIds.has(attachment.id) &&
            attachment.content !== undefined && { content: scrub(attachment.content) }),
        }
      })
    }
    if (request.mode === 'full') {
      const fields = {
        tool: item.tool,
        args: item.args,
        output: item.visibleOutput,
        command: item.commandText,
        decision: source.decisions?.get(item.itemId),
        reasoning: item.kind === 'reasoning' ? item.summary?.join('\n\n') : undefined,
        diff: request.options.diffs
          ? (source.diffs?.get(item.itemId) ?? (item.kind === 'diff' ? item.text : undefined))
          : undefined,
      }
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) Object.assign(shared, { [key]: scrub(value) })
      }
    }
    items.push(shared)
  }
  if (items.length === 0) throw new Error(UI_TEXT.exportNothing)
  for (const id of contentIds) {
    if (!availableIds.has(id)) throw new Error(UI_TEXT.shareAttachmentUnavailable)
  }
  const doc = shareJsonSchema.parse({
    schemaVersion: SHARE_SCHEMA_VERSION,
    target: 'chat',
    title: scrub(source.title),
    createdAt: scrub(source.exportedAt),
    scrubbed: true,
    mode: request.mode,
    options: {
      ...request.options,
      attachmentContents: [...contentIds].map((id) => portableId(id)),
    },
    ...(request.range !== undefined && {
      range: { from: portableId(request.range.from), to: portableId(request.range.to) },
    }),
    items,
  })
  if (doc.target !== 'chat') throw new Error(UI_TEXT.shareRangeInvalid)
  return doc
}

/** JSON remains M118 share v1, separate from M84's resumable session JSON. */
export function renderChatShare(
  doc: ChatShareDocument,
  format: ChatShareRequest['format'],
): string {
  let content: string
  switch (format) {
    case 'json': {
      content = `${JSON.stringify(doc, undefined, 2)}\n`
      break
    }
    case 'html': {
      content = renderChatShareHtml(doc)
      break
    }
    case 'md': {
      content = renderTranscriptMarkdown(doc)
      break
    }
  }
  if (new TextEncoder().encode(content).byteLength > SESSION_EXPORT_MAX_BYTES)
    throw new Error(UI_TEXT.shareTooLarge)
  return content
}
