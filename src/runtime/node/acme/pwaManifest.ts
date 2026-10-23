// The installed web app (M110e lane A3, D90.11): the manifest the node's
// server answers with, built from the person's own names and icons. Pure:
// the server (lane N) serves what this builds.
import * as z from 'zod/mini'

export const pwaIconSchema = z.strictObject({
  src: z.string().check(z.minLength(1)),
  sizes: z.string().check(z.minLength(1)),
  type: z.optional(z.string()),
})

export const pwaManifestSchema = z.strictObject({
  name: z.string().check(z.minLength(1)),
  short_name: z.string().check(z.minLength(1)),
  start_url: z.string().check(z.minLength(1)),
  display: z.enum(['standalone', 'fullscreen', 'minimal-ui', 'browser']),
  background_color: z.string().check(z.minLength(1)),
  theme_color: z.string().check(z.minLength(1)),
  icons: z.array(pwaIconSchema).check(z.minLength(1)),
})
export type PwaManifest = z.infer<typeof pwaManifestSchema>

export function buildPwaManifest(manifest: PwaManifest): string {
  return JSON.stringify(pwaManifestSchema.parse(manifest))
}
