// M118: our local share boundary, independent of backend/editor.
import * as z from 'zod/mini'
import { isConversationShareItem } from './agentEvents'
import {
  SHARE_DESTINATIONS,
  SHARE_LOCAL_DESTINATIONS,
  SHARE_SCHEMA_VERSION,
  UI_TEXT,
} from './constants'
import { savedPromptSchema } from './prompts'
import { redactSecrets } from './redact'

const idSchema = z.string().check(z.minLength(1))
const LOCAL_DESTINATIONS: ReadonlySet<string> = new Set(SHARE_LOCAL_DESTINATIONS)
const rangeSchema = z.strictObject({ from: idSchema, to: idSchema })
const optionsSchema = z.strictObject({
  codeBlocks: z._default(z.boolean(), true),
  attachmentNames: z._default(z.boolean(), true),
  diffs: z._default(z.boolean(), false),
  /** Explicit attachment ids; omitted means no contents, including full mode. */
  attachmentContents: z._default(z.array(idSchema), []),
})
const requestFields = {
  mode: z.enum(['full', 'conversation']),
  options: z._default(optionsSchema, {
    codeBlocks: true,
    attachmentNames: true,
    diffs: false,
    attachmentContents: [],
  }),
  format: z.enum(['md', 'html', 'json']),
  destination: z.enum(SHARE_DESTINATIONS),
}
export const shareRequestSchema = z.discriminatedUnion('target', [
  z.strictObject({
    ...requestFields,
    target: z.literal('chat'),
    sessionId: idSchema,
    range: z.optional(rangeSchema),
  }),
  z.strictObject({
    ...requestFields,
    target: z.literal('prompt'),
    source: z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('saved'),
        promptId: idSchema,
        scope: z.enum(['user', 'workspace']),
      }),
      z.strictObject({ kind: z.literal('message'), sessionId: idSchema, messageId: idSchema }),
      z.strictObject({ kind: z.literal('composer') }),
      z.strictObject({ kind: z.literal('editorSelection') }),
    ]),
  }),
])
export type ShareRequest = z.infer<typeof shareRequestSchema>

const attachmentSchema = z.strictObject({
  id: idSchema,
  name: z.optional(z.string()),
  content: z.optional(z.string()),
})
const shareItemSchema = z.strictObject({
  id: idSchema,
  kind: idSchema,
  text: z.optional(z.string()),
  attachments: z.optional(z.array(attachmentSchema)),
  tool: z.optional(z.string()),
  args: z.optional(z.string()),
  output: z.optional(z.string()),
  command: z.optional(z.string()),
  decision: z.optional(z.string()),
  diff: z.optional(z.string()),
  reasoning: z.optional(z.string()),
})
const exportFields = {
  schemaVersion: z.literal(SHARE_SCHEMA_VERSION),
  title: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  /** A producer must scrub every string, including title, ids and attachments. */
  scrubbed: z.literal(true),
  mode: requestFields.mode,
  options: optionsSchema,
}
/** Versioned share JSON, distinct from resumable M84 session exports. */
export const shareJsonSchema = z
  .discriminatedUnion('target', [
    z.strictObject({
      ...exportFields,
      target: z.literal('chat'),
      range: z.optional(rangeSchema),
      items: z.array(shareItemSchema),
    }),
    z.strictObject({ ...exportFields, target: z.literal('prompt'), prompt: savedPromptSchema }),
  ])
  .check(
    z.refine(
      (doc) =>
        doc.target === 'prompt' ||
        doc.items.every(
          (item) =>
            (doc.mode !== 'conversation' ||
              (isConversationShareItem(item) &&
                [
                  item.tool,
                  item.args,
                  item.output,
                  item.command,
                  item.decision,
                  item.diff,
                  item.reasoning,
                ].every((v) => v === undefined))) &&
            (doc.options.diffs || item.diff === undefined) &&
            (item.attachments ?? []).every(
              (a) =>
                (doc.options.attachmentNames || a.name === undefined) &&
                (a.content === undefined || doc.options.attachmentContents.includes(a.id)),
            ),
        ),
    ),
  )
export type ShareJson = z.infer<typeof shareJsonSchema>

/** Preview token binds the final button to the exact scrubbed bytes/options. */
export const confirmedShareSchema = z
  .strictObject({
    step: z.literal('confirmed'),
    previewId: idSchema,
    request: shareRequestSchema,
  })
  .check(z.refine((release) => LOCAL_DESTINATIONS.has(release.request.destination)))

/**
 * Reuse ConversationDeps.isConfidentialWorkspace/the native host's same
 * setting. Read at preview and again immediately before the outbound sink.
 * Unknown/unavailable policy must refuse. A preview is in memory only.
 */
export function admitShareRelease(
  input: unknown,
  isConfidentialWorkspace: () => boolean | undefined,
) {
  if (isConfidentialWorkspace() !== false) throw new Error(UI_TEXT.shareConfidential)
  return confirmedShareSchema.parse(input)
}

export interface SharePrivacyPort {
  /** Current registered values, applied in memory; never persisted/logged. */
  redactRegisteredSecrets(text: string): string
  /**
   * Absolute workspace paths -> forward-slash workspace-relative paths;
   * home/user prefixes -> [home]/[user]; other absolutes -> [path]. Handle
   * POSIX, drive/UNC, file URIs, escaped separators and roots with spaces.
   */
  normalisePaths(text: string): string
}

/** No privacy bypass in full mode; apply existing shared redaction last too. */
export function scrubShareText(text: string, privacy: SharePrivacyPort): string {
  return redactSecrets(privacy.normalisePaths(redactSecrets(privacy.redactRegisteredSecrets(text))))
}
