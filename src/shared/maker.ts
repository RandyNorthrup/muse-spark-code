// D83/D215 (RLF-DEVICES): the exact-payload approval shapes the maker
// engine and every surface share. The engine mints each request (D83.16:
// an id, the payload's SHA-256, the target's identity, an expiry) and
// accepts only an answer that echoes the id and digest before the expiry,
// so no surface can widen, reuse or extend an approval. Surfaces only
// display: user sentences stay keys the document resolves, never engine
// text, and machine words (commands, digests) stay spliced detail.
import * as z from 'zod/mini'

/** The three physical targets D215 names: printer, CNC, microcontroller. */
export const makerTargetKindSchema = z.enum(['printer', 'cnc', 'mcu'])
export type MakerTargetKind = z.infer<typeof makerTargetKindSchema>

/**
D83.3's target identity: the port, VID:PID and USB serial for serial
targets, or the machine's name and address and what it reports itself
as. `simulated` says the target is a simulator: simulator receipts
never qualify real hardware (D215).
*/
export const makerTargetSchema = z.strictObject({
  kind: makerTargetKindSchema,
  name: z.string().check(z.minLength(1)),
  endpoint: z.string().check(z.minLength(1)),
  vidPid: z.optional(z.string().check(z.minLength(1))),
  usbSerial: z.optional(z.string().check(z.minLength(1))),
  reportedAs: z.optional(z.string().check(z.minLength(1))),
  simulated: z.boolean(),
})
export type MakerTarget = z.infer<typeof makerTargetSchema>

/** The classes that ask every time (D83.3). Stop never prompts (D83.5). */
export const makerOperationSchema = z.enum(['connect', 'program', 'actuate'])
export type MakerOperation = z.infer<typeof makerOperationSchema>

/**
One rendered payload line: printable bytes as text, anything else as
hex (D83.3). The engine renders every byte; D121 keeps no count of
ours, so any number of lines binds and displays.
*/
export const makerPreviewLineSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), text: z.string() }),
  z.strictObject({ kind: z.literal('hex'), hex: z.string().check(z.minLength(1)) }),
])
export type MakerPreviewLine = z.infer<typeof makerPreviewLineSchema>

const makerAxisSchema = z.strictObject({
  x: z.optional(z.number()),
  y: z.optional(z.number()),
  z: z.optional(z.number()),
})

/**
D83.3's analysis: bounds, maximum temperature and feed against the
limits, and the commands the analyser does not know. Bounds and maxima
are absent when the payload carries none.
*/
export const makerAnalysisSchema = z.strictObject({
  bounds: z.optional(z.strictObject({ min: makerAxisSchema, max: makerAxisSchema })),
  maxTempC: z.optional(z.number()),
  maxFeedMmMin: z.optional(z.number()),
  unknownCommands: z.array(z.string().check(z.minLength(1))),
})
export type MakerAnalysis = z.infer<typeof makerAnalysisSchema>

/** Warnings the document resolves to its own sentence; never engine text. */
export const makerWarningSchema = z.enum(['portReset'])
export type MakerWarning = z.infer<typeof makerWarningSchema>

const makerRequestId = z.string().check(z.regex(/^[a-f0-9]{32}$(?![\s\S])/))
const makerDigest = z.string().check(z.regex(/^[a-f0-9]{64}$(?![\s\S])/))

/**
The approval request the engine mints. `expiresAt` is the calling
authority's own deadline (a grant, a session), never a maker duration
(D121 keeps no timeout of ours): absent where the caller's signal
governs the wait instead.
*/
export const makerApprovalPromptSchema = z.strictObject({
  requestId: makerRequestId,
  digest: makerDigest,
  target: makerTargetSchema,
  operation: makerOperationSchema,
  preview: z.array(makerPreviewLineSchema),
  analysis: z.optional(makerAnalysisSchema),
  warning: z.optional(makerWarningSchema),
  expiresAt: z.optional(z.int().check(z.gte(0))),
})
export type MakerApprovalPrompt = z.infer<typeof makerApprovalPromptSchema>

/**
The person's answer. It echoes the request id and the payload digest;
anything else is a reject. Closing the surface answers `reject`.
*/
export const makerApprovalAnswerSchema = z.strictObject({
  requestId: makerRequestId,
  decision: z.enum(['send', 'reject']),
  digest: makerDigest,
})
export type MakerApprovalAnswer = z.infer<typeof makerApprovalAnswerSchema>
