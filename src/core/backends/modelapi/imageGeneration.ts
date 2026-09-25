// The `generate_image` tool (M34, PLAN.md D30): one PNG from Meta's image
// model, written into the workspace as a new file. It is offered only while
// paid image generation is on, and the host asks before every call, naming
// the price, in every permission mode (Bypass included); Plan refuses it,
// since it writes a file. The path is confined like any write, refused
// before the card when something is already there (so nothing is billed for
// an image that could not be saved), and the reply is checked to be a PNG
// before it is written.

import { Buffer } from 'node:buffer'
import * as z from 'zod/mini'
import {
  IMAGE_ASPECT_SIZES,
  IMAGE_FILE_EXTENSION,
  IMAGE_OUTPUT_FORMAT,
  type ImageAspect,
  IMAGE_PROMPT_MAX_CHARS,
  MODEL_API_IMAGE_MODEL,
  MODEL_TEXT,
  PNG_SIGNATURE,
} from '../../../shared/constants'
import type { ModelApiClient } from './client'
import type { FileReservation, ToolIo, ToolOutcome } from './tools'

const ASPECTS = Object.keys(IMAGE_ASPECT_SIZES) as [ImageAspect, ...ImageAspect[]]
const DEFAULT_ASPECT: ImageAspect = 'square'
const BYTES_PER_KIB = 1024

export const generateImageArgs = z.object({
  prompt: z.string().check(z.minLength(1), z.maxLength(IMAGE_PROMPT_MAX_CHARS)),
  path: z.string(),
  aspect: z.optional(z.enum(ASPECTS)),
})
export type GenerateImageArgs = z.infer<typeof generateImageArgs>

/** The tool's parameters, as the model is offered them. */
export const GENERATE_IMAGE_PARAMETERS = {
  prompt: {
    type: 'string',
    description: `What the image shows, in detail (at most ${String(IMAGE_PROMPT_MAX_CHARS)} characters)`,
  },
  path: {
    type: 'string',
    description: `Workspace-relative path of the new file, ending in ${IMAGE_FILE_EXTENSION}; it must not exist yet`,
  },
  aspect: { type: 'string', enum: ASPECTS, description: 'The shape; square when absent' },
} as const

export const GENERATE_IMAGE_DESCRIPTION = `Create one PNG image from a text prompt and save it as a new file in the workspace. Each image is billed to the user, who is asked before every call, so use it only when the user asked for an image.`

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

export interface ImageRunDeps {
  readonly client: ModelApiClient
  readonly io: ToolIo
  readonly signal: AbortSignal
  /** Whether the feature is still on: checked after the card, before anything is bought. */
  readonly isStillOn: () => boolean
  /** Called once an image was returned: Meta bills it whether or not it can be saved. */
  readonly onBilled: () => void
}

function failure(reason: string): ToolOutcome {
  return { output: `Error: ${reason}`, visibleOutput: reason, failureReason: reason }
}

/** Asks Meta for the image and writes it as a new file at `absolute`. May throw (an API error). */
export async function runImageGeneration(
  args: GenerateImageArgs,
  target: { readonly absolute: string; readonly relative: string },
  deps: ImageRunDeps,
): Promise<ToolOutcome> {
  // Turned off while the card was open (the review of PR #27): nothing is bought.
  if (!deps.isStillOn()) {
    return failure(MODEL_TEXT.imageGenerationOff)
  }
  // The file is taken first, so a path taken while the card was open costs nothing.
  let reservation: FileReservation
  try {
    reservation = await deps.io.reserveFile(target.absolute)
  } catch {
    return failure(MODEL_TEXT.imagePathTaken)
  }
  try {
    return await buy(args, target, reservation, deps)
  } catch (error: unknown) {
    await reservation.release()
    throw error
  }
}

/** The purchase itself, into a file already reserved; releases it when no image comes. */
async function buy(
  args: GenerateImageArgs,
  target: { readonly absolute: string; readonly relative: string },
  reservation: FileReservation,
  deps: ImageRunDeps,
): Promise<ToolOutcome> {
  const aspect = args.aspect ?? DEFAULT_ASPECT
  const response = await deps.client.createImage(
    {
      model: MODEL_API_IMAGE_MODEL,
      prompt: args.prompt,
      n: 1,
      size: IMAGE_ASPECT_SIZES[aspect],
      response_format: 'b64_json',
      output_format: IMAGE_OUTPUT_FORMAT,
    },
    deps.signal,
  )
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
  return {
    output: `Created ${target.relative} (PNG, ${aspect}, ${size}).${revised === undefined ? '' : ` The service revised the prompt to: ${revised}`}`,
    visibleOutput: `Created ${target.relative} (${aspect}, ${size})`,
  }
}
