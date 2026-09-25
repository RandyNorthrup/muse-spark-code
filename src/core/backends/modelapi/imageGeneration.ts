// Meta's image model in the workspace (M34, M44, PLAN.md D30): `generate_image`
// makes one PNG from a prompt, `edit_image` changes or combines workspace
// images by a prompt, and either writes a new file. Both are offered only
// while paid image generation is on, and the caller asks before every call,
// naming the price, in every permission mode (Bypass included). Everything
// that can be checked is checked before that question (`prepareImageCall`),
// so nothing is asked or billed for an image that could not be made or
// saved: the arguments, the output path (confined like any write, a `.png`,
// not taken), and each source (inside the workspace, an image, not too
// large). The reply is checked to be a PNG before it is written.
//
// The Model API backend runs them as its own tools; the Muse Code backend
// reaches them through the extension's `ide` session server (M44), billed
// to the Model API key, never to the subscription.

import { Buffer } from 'node:buffer'
import * as z from 'zod/mini'
import {
  IMAGE_ASPECT_SIZES,
  IMAGE_EDIT_MAX_SOURCES,
  IMAGE_EDIT_SOURCE_TYPES,
  IMAGE_EXTENSIONS,
  IMAGE_FILE_EXTENSION,
  IMAGE_OUTPUT_FORMAT,
  type ImageAspect,
  IMAGE_PROMPT_MAX_CHARS,
  MAX_IMAGE_BYTES,
  MODEL_API_IMAGE_MODEL,
  MODEL_TEXT,
  PNG_SIGNATURE,
} from '../../../shared/constants'
import { pathModule } from '../../workspaceRoot'
import type { ModelApiClient } from './client'
import { IMAGE_ASPECTS } from './imageToolDefinitions'
import type { ImagesResponse } from './schemas'
import { confineWorkspacePath, type FileReservation, type ToolIo, type ToolOutcome } from './tools'

const DEFAULT_ASPECT: ImageAspect = 'square'
const BYTES_PER_KIB = 1024

const promptSchema = z.string().check(z.minLength(1), z.maxLength(IMAGE_PROMPT_MAX_CHARS))

export const generateImageArgs = z.object({
  prompt: promptSchema,
  path: z.string(),
  aspect: z.optional(z.enum(IMAGE_ASPECTS)),
})

export const editImageArgs = z.object({
  prompt: promptSchema,
  images: z.array(z.string()).check(z.minLength(1), z.maxLength(IMAGE_EDIT_MAX_SOURCES)),
  path: z.string(),
  aspect: z.optional(z.enum(IMAGE_ASPECTS)),
})

/** Why a path cannot take a generated image, before anything is asked or billed. */
export function imagePathProblem(relativePath: string): string | undefined {
  return relativePath.toLowerCase().endsWith(IMAGE_FILE_EXTENSION)
    ? undefined
    : `the path must end in ${IMAGE_FILE_EXTENSION}`
}

/** Whether the bytes start with the PNG signature. */
export function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

interface WorkspaceFile {
  readonly absolute: string
  readonly relative: string
}

/** A source image an edit sends, read and checked before the question. */
interface SourceImage extends WorkspaceFile {
  readonly mediaType: string
  readonly bytes: Uint8Array
}

/** A call that can be made: what is asked for, where it goes, what it starts from. */
export interface ImagePlan {
  readonly kind: 'generate' | 'edit'
  readonly prompt: string
  readonly aspect: ImageAspect
  readonly target: WorkspaceFile
  readonly sources: readonly SourceImage[]
}

export type ImagePlanResult =
  { readonly ok: true; readonly plan: ImagePlan } | { readonly ok: false; readonly reason: string }

export interface ImageWorkspace {
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly io: ToolIo
}

function refused(reason: string): ImagePlanResult {
  return { ok: false, reason }
}

/** The output file: confined, a `.png`, and not taken. */
async function targetOf(
  given: string,
  workspace: ImageWorkspace,
): Promise<WorkspaceFile | { readonly reason: string }> {
  const resolved = await confineWorkspacePath(
    workspace.workspaceRoot,
    given,
    workspace.platform,
    workspace.io,
  )
  if (!resolved.ok) {
    return { reason: resolved.reason }
  }
  const problem =
    imagePathProblem(resolved.relative) ??
    ((await workspace.io.pathExists(resolved.absolute)) ? MODEL_TEXT.imagePathTaken : undefined)
  return problem === undefined ? resolved : { reason: problem }
}

/** One source of an edit: confined, an image type Meta takes, there, and not too large. */
async function sourceOf(
  given: string,
  workspace: ImageWorkspace,
): Promise<SourceImage | { readonly reason: string }> {
  const resolved = await confineWorkspacePath(
    workspace.workspaceRoot,
    given,
    workspace.platform,
    workspace.io,
  )
  if (!resolved.ok) {
    return { reason: resolved.reason }
  }
  const extension = pathModule(workspace.platform).extname(resolved.relative).toLowerCase()
  const mediaType = Object.hasOwn(IMAGE_EXTENSIONS, extension)
    ? IMAGE_EXTENSIONS[extension]
    : undefined
  if (mediaType === undefined || !IMAGE_EDIT_SOURCE_TYPES.has(mediaType)) {
    return { reason: `${given} is not a PNG, JPEG or WebP image` }
  }
  let bytes: Uint8Array | undefined
  try {
    bytes = await workspace.io.readBytes(resolved.absolute, MAX_IMAGE_BYTES)
  } catch (error: unknown) {
    return { reason: error instanceof Error ? error.message : String(error) }
  }
  return bytes === undefined
    ? { reason: `${given} does not exist` }
    : { ...resolved, mediaType, bytes }
}

/**
 * Everything checked before the question (M34, M44): the arguments, the
 * output path and every source. A refusal names why; nothing was bought.
 */
export async function prepareImageCall(
  kind: ImagePlan['kind'],
  rawArgs: unknown,
  workspace: ImageWorkspace,
): Promise<ImagePlanResult> {
  const parsed = parseImageArgs(kind, rawArgs)
  if ('reason' in parsed) {
    return refused(parsed.reason)
  }
  const { args } = parsed
  const target = await targetOf(args.path, workspace)
  if ('reason' in target) {
    return refused(target.reason)
  }
  const sources: SourceImage[] = []
  for (const given of args.images) {
    const source = await sourceOf(given, workspace)
    if ('reason' in source) {
      return refused(source.reason)
    }
    sources.push(source)
  }
  return {
    ok: true,
    plan: { kind, prompt: args.prompt, aspect: args.aspect ?? DEFAULT_ASPECT, target, sources },
  }
}

/** Either tool's arguments in one shape: a generation starts from no image. */
function parseImageArgs(
  kind: ImagePlan['kind'],
  rawArgs: unknown,
): { readonly args: z.infer<typeof editImageArgs> } | { readonly reason: string } {
  if (kind === 'generate') {
    const parsed = generateImageArgs.safeParse(rawArgs)
    return parsed.success
      ? { args: { ...parsed.data, images: [] } }
      : { reason: `invalid arguments: ${z.prettifyError(parsed.error)}` }
  }
  const parsed = editImageArgs.safeParse(rawArgs)
  return parsed.success
    ? { args: parsed.data }
    : { reason: `invalid arguments: ${z.prettifyError(parsed.error)}` }
}

export interface ImageRunDeps {
  readonly client: ModelApiClient
  readonly io: ToolIo
  readonly signal: AbortSignal
  /** Whether the feature is still on: checked after the question, before anything is bought. */
  readonly isStillOn: () => boolean
  /** Called once an image was returned: Meta bills it whether or not it can be saved. */
  readonly onBilled: () => void
}

function failure(reason: string): ToolOutcome {
  return { output: `Error: ${reason}`, visibleOutput: reason, failureReason: reason }
}

/** Asks Meta for the image and writes it as a new file. May throw (an API error). */
export async function runImageCall(plan: ImagePlan, deps: ImageRunDeps): Promise<ToolOutcome> {
  // Turned off while the question was open (the review of PR #27): nothing is bought.
  if (!deps.isStillOn()) {
    return failure(MODEL_TEXT.imageGenerationOff)
  }
  // The file is taken first, so a path taken while the card was open costs nothing.
  let reservation: FileReservation
  try {
    reservation = await deps.io.reserveFile(plan.target.absolute)
  } catch {
    return failure(MODEL_TEXT.imagePathTaken)
  }
  try {
    return await buy(plan, reservation, deps)
  } catch (error: unknown) {
    await reservation.release()
    throw error
  }
}

/** The request for the plan: a generation, or an edit with its sources inline. */
async function request(plan: ImagePlan, deps: ImageRunDeps): Promise<ImagesResponse> {
  const common = {
    model: MODEL_API_IMAGE_MODEL,
    prompt: plan.prompt,
    n: 1,
    size: IMAGE_ASPECT_SIZES[plan.aspect],
    response_format: 'b64_json',
    output_format: IMAGE_OUTPUT_FORMAT,
  } as const
  return plan.kind === 'generate'
    ? await deps.client.createImage(common, deps.signal)
    : await deps.client.editImage(
        {
          ...common,
          images: plan.sources.map((source) => ({
            image_url: `data:${source.mediaType};base64,${Buffer.from(source.bytes).toString('base64')}`,
          })),
        },
        deps.signal,
      )
}

/** The purchase itself, into a file already reserved; releases it when no image comes. */
async function buy(
  plan: ImagePlan,
  reservation: FileReservation,
  deps: ImageRunDeps,
): Promise<ToolOutcome> {
  const response = await request(plan, deps)
  const [image] = response.data
  const encoded = image?.b64_json ?? undefined
  if (encoded === undefined) {
    await reservation.release()
    return failure('the image service returned no image')
  }
  deps.onBilled()
  const bytes = Buffer.from(encoded, 'base64')
  if (!isPng(bytes)) {
    await reservation.release()
    return failure('the image service returned something that is not a PNG image')
  }
  await reservation.fill(bytes)
  const size = `${String(Math.ceil(bytes.length / BYTES_PER_KIB))} KiB`
  const revised = image?.revised_prompt ?? undefined
  const from =
    plan.kind === 'edit' ? ` from ${plan.sources.map((source) => source.relative).join(', ')}` : ''
  return {
    output: `Created ${plan.target.relative}${from} (PNG, ${plan.aspect}, ${size}).${revised === undefined ? '' : ` The service revised the prompt to: ${revised}`}`,
    visibleOutput: `Created ${plan.target.relative} (${plan.aspect}, ${size})`,
  }
}
