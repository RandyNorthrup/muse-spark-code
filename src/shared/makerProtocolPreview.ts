// The makerProtocol.ts geometry projection, shared by its full host schema
// and the independent STL page. No URL, path, key or hardware action exists.
import * as z from 'zod/mini'
import {
  MAKER_PROTOCOL_VERSION,
  MAKER_PREVIEW_MAX_COORDINATE,
  MAKER_PREVIEW_MAX_TRIANGLES,
  MAKER_TRIANGLE_COMPONENTS,
} from './makerPreviewConstants'

export const makerMeshMessageSchema = z.strictObject({
  v: z.literal(MAKER_PROTOCOL_VERSION),
  type: z.literal('makerMesh'),
  artifactId: z.uuid(),
  positions: z
    .array(
      z.number().check(z.gte(-MAKER_PREVIEW_MAX_COORDINATE), z.lte(MAKER_PREVIEW_MAX_COORDINATE)),
    )
    .check(
      z.minLength(MAKER_TRIANGLE_COMPONENTS),
      z.maxLength(MAKER_PREVIEW_MAX_TRIANGLES * MAKER_TRIANGLE_COMPONENTS),
      z.refine((positions) => positions.length % MAKER_TRIANGLE_COMPONENTS === 0),
    ),
})
