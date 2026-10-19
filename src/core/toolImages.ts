// The picture a tool row shows (M43, PLAN.md D36): the image a read tool
// looked at, or the one `generate_image` saved. Muse Code tells the client
// only the path (the image the model saw is not on the live stream, captured
// 2026-09-25), so the host reads the file itself: an image type by name,
// inside the workspace (links that lead out are refused, D24), and within
// the panel preview's own display bound (TOOL_IMAGE_PREVIEW_MAX_BYTES;
// D121 keeps it as display shape, not an attachment limit).

import { Buffer } from 'node:buffer'
import {
  IMAGE_EXTENSIONS,
  type ImageMediaType,
  TOOL_IMAGE_PREVIEW_MAX_BYTES,
} from '../shared/constants'
import { pathModule } from './workspaceRoot'
import { confineWorkspacePath } from './workspacePath'

export type ToolImageResult =
  { readonly ok: true; readonly dataUri: string } | { readonly ok: false; readonly reason: string }

export interface ToolImageIo {
  readonly realPath: (fsPath: string) => Promise<string>
  readonly fileSize: (fsPath: string) => Promise<number>
  /** Reads at most maxBytes plus one from one open file handle. */
  readonly readBytes: (
    fsPath: string,
    maxBytes: number,
    expectedCanonicalPath?: string,
  ) => Promise<Uint8Array | undefined>
}

/** The media type a path's name gives, when it names an image the panel shows. */
export function imageMediaTypeOf(
  filePath: string,
  platform: NodeJS.Platform,
): ImageMediaType | undefined {
  const extension = pathModule(platform).extname(filePath).toLowerCase()
  return Object.hasOwn(IMAGE_EXTENSIONS, extension) ? IMAGE_EXTENSIONS[extension] : undefined
}

export async function loadToolImage(
  given: string,
  workspaceRoot: string | undefined,
  platform: NodeJS.Platform,
  io: ToolImageIo,
): Promise<ToolImageResult> {
  const mediaType = imageMediaTypeOf(given, platform)
  if (mediaType === undefined) {
    return { ok: false, reason: `${given} is not an image the panel shows` }
  }
  if (workspaceRoot === undefined) {
    return { ok: false, reason: 'no folder is open' }
  }
  const resolved = await confineWorkspacePath(workspaceRoot, given, platform, io)
  if (!resolved.ok) {
    return resolved
  }
  // D121: the panel preview keeps its own display bound — the model still
  // reads the image whole through the read tools. Display shape, not an
  // attachment limit: kept and listed for the lead.
  const size = await io.fileSize(resolved.checkedAbsolute)
  if (size > TOOL_IMAGE_PREVIEW_MAX_BYTES) {
    return {
      ok: false,
      reason: `${given} is larger than ${String(TOOL_IMAGE_PREVIEW_MAX_BYTES)} bytes`,
    }
  }
  const bytes = await io.readBytes(
    resolved.checkedAbsolute,
    TOOL_IMAGE_PREVIEW_MAX_BYTES,
    resolved.checkedAbsolute,
  )
  if (bytes === undefined) {
    return { ok: false, reason: `${given} does not exist` }
  }
  return bytes.byteLength > TOOL_IMAGE_PREVIEW_MAX_BYTES
    ? {
        ok: false,
        reason: `${given} is larger than ${String(TOOL_IMAGE_PREVIEW_MAX_BYTES)} bytes`,
      }
    : { ok: true, dataUri: `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}` }
}
