// M118-X-MHP: native/companion adapters snapshot their current menu context.
// These are local bridge DTOs; transport owners keep their existing zod envelope.
import * as z from 'zod/mini'
import { UI_TEXT } from '../../shared/constants'
import { promptLoadSchema, promptMenuEntries } from '../../shared/prompts'

const id = z.string().check(z.minLength(1))
const contextSchema = z.discriminatedUnion('source', [
  z.strictObject({
    contextId: id,
    source: z.literal('userMessage'),
    text: z.string(),
    sessionId: id,
    messageId: id,
    role: z.string(),
    own: z.boolean(),
  }),
  z.strictObject({
    contextId: id,
    source: z.literal('composer'),
    text: z.string(),
    chatAvailable: z.boolean(),
  }),
  z.strictObject({ contextId: id, source: z.literal('editorSelection'), text: z.string() }),
])
type PromptContext = z.infer<typeof contextSchema>
const invocationSchema = z.strictObject({
  menuId: z.enum([
    'prompt.save.message',
    'prompt.save.composer',
    'prompt.save.selection',
    'prompt.use.composer',
  ]),
  contextId: id,
})

function menuEntries(context: PromptContext) {
  return promptMenuEntries
    .filter((entry) => {
      return entry.source === 'library'
        ? context.source === 'composer' && context.chatAvailable
        : entry.source === context.source &&
            context.text.trim() !== '' &&
            (context.source !== 'userMessage' || (context.role === 'user' && context.own))
    })
    .map((entry) => ({
      ...entry,
      label: entry.source === 'library' ? UI_TEXT.promptUseSaved : UI_TEXT.promptSave,
    }))
}

/** UI labels are resolved in the installed language when a native menu opens. */
export function nativePromptMenus(input: unknown) {
  return menuEntries(contextSchema.parse(input))
}

export interface NativePromptPorts {
  /** Trusted adapter-owned current text and row/selection identity, never a webview claim. */
  readonly snapshot: () => unknown
  readonly savePrompt: (source: PromptContext) => Promise<void>
  /** The shared personal/current-workspace picker; cancellation returns undefined. */
  readonly choosePrompt: () => Promise<unknown>
  /** Must insert/create a chat in this workspace, never send. */
  readonly loadPrompt: (request: z.infer<typeof promptLoadSchema>) => Promise<void>
  /** False when the originating view has closed or changed while its picker is pending. */
  readonly isActive: () => boolean
}

export async function invokeNativePromptMenu(
  input: unknown,
  ports: NativePromptPorts,
): Promise<void> {
  const invocation = invocationSchema.parse(input)
  const context = contextSchema.parse(ports.snapshot())
  if (
    !ports.isActive() ||
    invocation.contextId !== context.contextId ||
    menuEntries(context).every((entry) => entry.id !== invocation.menuId)
  ) {
    throw new Error(UI_TEXT.promptFileInvalid)
  }
  if (invocation.menuId !== 'prompt.use.composer') {
    await ports.savePrompt(context)
    return
  }
  const selected = await ports.choosePrompt()
  if (selected === undefined) return
  const load = promptLoadSchema.parse(selected)
  const current = contextSchema.parse(ports.snapshot())
  if (
    !ports.isActive() ||
    current.source !== 'composer' ||
    current.contextId !== context.contextId ||
    !current.chatAvailable
  ) {
    throw new Error(UI_TEXT.promptFileInvalid)
  }
  await ports.loadPrompt(load)
}
