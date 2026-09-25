// The image tools the `ide` session server offers Muse Code (M44, PLAN.md
// D37): Muse Code's own image tool is switched off in `muse serve`, so on
// the Muse Code backend the extension makes images itself, with Meta's image
// model and the stored Model API key. The key stays in this process and is
// never handed to `muse serve` (D1); the subscription never pays for an
// image. They are offered only while paid image generation is on (D30) and
// a key is stored, and every call is confirmed in a modal naming the price,
// whatever permission mode Muse Code runs in: its own approval covers using
// the tool, this one covers buying the image.

import { IMAGE_REQUEST_TIMEOUT_MS, IDE_IMAGE_TOOLS, MODEL_TEXT } from '../../shared/constants'
import type { McpTool } from '../../core/mcp'
import type { ModelApiClient } from '../../core/backends/modelapi/client'
import {
  type ImagePlan,
  type ImageWorkspace,
  prepareImageCall,
  runImageCall,
} from '../../core/backends/modelapi/imageGeneration'
import {
  EDIT_IMAGE_DESCRIPTION,
  EDIT_IMAGE_PARAMETERS,
  GENERATE_IMAGE_DESCRIPTION,
  GENERATE_IMAGE_PARAMETERS,
} from '../../core/backends/modelapi/imageToolDefinitions'
import type { Logger } from '../logger'

export interface IdeImageToolsDeps {
  /** Whether the tools are offered now: image generation on and a key stored. */
  readonly isOffered: () => boolean
  /** The workspace the images go into; undefined with no folder open. */
  readonly workspace: ImageWorkspace | undefined
  /** A Model API client that reads the stored key (never the subscription). */
  readonly client: ModelApiClient
  /** The modal before every purchase; true only when the user chose to buy. */
  readonly confirm: (plan: ImagePlan) => Promise<boolean>
  /** Called once an image was returned: the window's tally. */
  readonly onBilled: () => void
  readonly log: Logger
}

interface ImageToolShape {
  readonly kind: ImagePlan['kind']
  readonly name: string
  readonly description: string
  readonly parameters: Readonly<Record<string, unknown>>
  readonly required: readonly string[]
}

const SHAPES: readonly ImageToolShape[] = [
  {
    kind: 'generate',
    name: IDE_IMAGE_TOOLS.generateImage,
    description: GENERATE_IMAGE_DESCRIPTION,
    parameters: GENERATE_IMAGE_PARAMETERS,
    required: ['prompt', 'path'],
  },
  {
    kind: 'edit',
    name: IDE_IMAGE_TOOLS.editImage,
    description: EDIT_IMAGE_DESCRIPTION,
    parameters: EDIT_IMAGE_PARAMETERS,
    required: ['prompt', 'images', 'path'],
  },
]

/** One call: checked, confirmed, bought and written, or refused with the reason. */
async function callImageTool(
  shape: ImageToolShape,
  args: Readonly<Record<string, unknown>>,
  workspace: ImageWorkspace,
  deps: IdeImageToolsDeps,
): Promise<string> {
  const prepared = await prepareImageCall(shape.kind, args, workspace)
  if (!prepared.ok) {
    throw new Error(prepared.reason)
  }
  if (!(await deps.confirm(prepared.plan))) {
    deps.log.info(`Image ${prepared.plan.target.relative} declined in the price confirmation`)
    throw new Error(MODEL_TEXT.imageDeclined)
  }
  const outcome = await runImageCall(prepared.plan, {
    client: deps.client,
    io: workspace.io,
    // No turn to stop it from here: the request's own deadline ends the wait.
    signal: AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS),
    isStillOn: deps.isOffered,
    onBilled: deps.onBilled,
  })
  if (outcome.failureReason !== undefined) {
    throw new Error(outcome.failureReason)
  }
  deps.log.info(`Image ${prepared.plan.target.relative} made for Muse Code (billed to the key)`)
  return outcome.output
}

/** The tools as they stand now: none while image generation is off or no key is stored. */
export function ideImageTools(deps: IdeImageToolsDeps): readonly McpTool[] {
  const { workspace } = deps
  if (workspace === undefined || !deps.isOffered()) {
    return []
  }
  return SHAPES.map((shape) => ({
    name: shape.name,
    description: shape.description,
    inputSchema: {
      type: 'object',
      properties: shape.parameters,
      required: shape.required,
      additionalProperties: false,
    },
    call: async (args) => await callImageTool(shape, args, workspace, deps),
  }))
}
