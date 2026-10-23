// D107 (M125 lane W): the Set Up Local Judge panel's postMessage
// contract. The host owns the controller: it posts each snapshot and
// the webview posts each validated command. Both sides validate
// before a message crosses; the schemas stay UI-free so every
// editor's bridge speaks them.
import * as z from 'zod/mini'
import { judgeSetupCommandSchema, judgeSetupSnapshotSchema } from './judgeSetupSchema'

/** What the wizard panel posts to the host. */
export const judgeSetupPanelToHostSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('judgeSetup/ready') }),
  z.strictObject({ type: z.literal('judgeSetup/command'), message: judgeSetupCommandSchema }),
  // The licence step's link. The host opens https URLs only, never with
  // credentials in them; anything else fails here or at the host.
  z.strictObject({ type: z.literal('judgeSetup/openExternal'), url: z.string() }),
])
export type JudgeSetupPanelToHost = z.infer<typeof judgeSetupPanelToHostSchema>

/** What the host posts to the wizard panel. */
export const judgeSetupHostToPanelSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('judgeSetup/snapshot'), snapshot: judgeSetupSnapshotSchema }),
  // The controller closed the wizard (cancel, skip, hosted, done).
  // The host disposes the panel; this only stops the webview's wait.
  z.strictObject({ type: z.literal('judgeSetup/closed') }),
])
export type JudgeSetupHostToPanel = z.infer<typeof judgeSetupHostToPanelSchema>

export type JudgeSetupPanelParse<T> =
  { readonly ok: true; readonly message: T } | { readonly ok: false; readonly error: string }

function parseWith<T>(schema: z.ZodMiniType<T>, input: unknown): JudgeSetupPanelParse<T> {
  const result = schema.safeParse(input)
  return result.success
    ? { ok: true, message: result.data }
    : { ok: false, error: z.prettifyError(result.error) }
}

/** Validates a wizard command before the host runs it. */
export function parseJudgeSetupPanelToHost(
  input: unknown,
): JudgeSetupPanelParse<JudgeSetupPanelToHost> {
  return parseWith(judgeSetupPanelToHostSchema, input)
}

/** Validates a wizard snapshot before the panel renders it. */
export function parseJudgeSetupHostToPanel(
  input: unknown,
): JudgeSetupPanelParse<JudgeSetupHostToPanel> {
  return parseWith(judgeSetupHostToPanelSchema, input)
}
