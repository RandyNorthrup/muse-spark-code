// The picture a tool row shows (M43, PLAN.md D36): the image a read tool
// looked at, or the one `generate_image` saved. Muse Code tells the client
// only the path (the image the model saw is not on the live stream, captured
// 2026-09-25), so the host reads the file itself: an image type by name,
// inside the workspace (links that lead out are refused, D24), and no larger
// than an attachment may be.

import { Buffer } from 'node:buffer'
import { IMAGE_EXTENSIONS, type ImageMediaType, MAX_IMAGE_BYTES } from '../shared/constants'
import { pathModule } from './workspaceRoot'
import { confineWorkspacePath } from './backends/modelapi/tools'

export type ToolImageResult =
  { readonly ok: true; readonly dataUri: string } | { readonly ok: false; readonly reason: string }

export interface ToolImageIo {
  readonly realPath: (fsPath: string) => Promise<string>
  readonly fileSize: (fsPath: string) => Promise<number>
  readonly readFile: (fsPath: string) => Promise<Uint8Array>
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
  const size = await io.fileSize(resolved.absolute)
  if (size > MAX_IMAGE_BYTES) {
    return { ok: false, reason: `${given} is larger than ${String(MAX_IMAGE_BYTES)} bytes` }
  }
  const bytes = await io.readFile(resolved.absolute)
  return { ok: true, dataUri: `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}` }
}
