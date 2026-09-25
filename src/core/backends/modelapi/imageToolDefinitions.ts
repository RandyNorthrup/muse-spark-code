// How the image tools are offered to the model (M34, M44): their parameters
// and descriptions, apart from the code that runs them so the tool list can
// name them without importing it.

import {
  IMAGE_ASPECT_SIZES,
  IMAGE_EDIT_MAX_SOURCES,
  IMAGE_FILE_EXTENSION,
  type ImageAspect,
  IMAGE_PROMPT_MAX_CHARS,
} from '../../../shared/constants'

export const IMAGE_ASPECTS = Object.keys(IMAGE_ASPECT_SIZES) as [ImageAspect, ...ImageAspect[]]

const PATH_PARAMETER = {
  type: 'string',
  description: `Workspace-relative path of the new file, ending in ${IMAGE_FILE_EXTENSION}; it must not exist yet`,
} as const
const ASPECT_PARAMETER = {
  type: 'string',
  enum: IMAGE_ASPECTS,
  description: 'The shape; square when absent',
} as const

export const GENERATE_IMAGE_PARAMETERS = {
  prompt: {
    type: 'string',
    description: `What the image shows, in detail (at most ${String(IMAGE_PROMPT_MAX_CHARS)} characters)`,
  },
  path: PATH_PARAMETER,
  aspect: ASPECT_PARAMETER,
} as const

export const EDIT_IMAGE_PARAMETERS = {
  prompt: {
    type: 'string',
    description: `The change to make, or how to combine the images, in detail (at most ${String(IMAGE_PROMPT_MAX_CHARS)} characters)`,
  },
  images: {
    type: 'array',
    items: { type: 'string' },
    description: `Workspace-relative paths of 1 to ${String(IMAGE_EDIT_MAX_SOURCES)} existing PNG, JPEG or WebP images to start from`,
  },
  path: PATH_PARAMETER,
  aspect: ASPECT_PARAMETER,
} as const

const BILLING_NOTE =
  'Each image is billed to the user, who is asked before every call, so use it only when the user asked for an image.'

export const GENERATE_IMAGE_DESCRIPTION = `Create one PNG image from a text prompt and save it as a new file in the workspace. ${BILLING_NOTE}`

export const EDIT_IMAGE_DESCRIPTION = `Change one existing workspace image, or combine several, by a text prompt, and save the result as a new PNG file in the workspace (the sources are left as they are). ${BILLING_NOTE}`
