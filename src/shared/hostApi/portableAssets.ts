import * as z from 'zod/mini'

// The classic loader imports only this module; constants.ts carries the English table.
export const PORTABLE_MODULE_HEX_RADIX = 16

const assetPath = z.string().check(z.regex(/^\/assets\/portable\/(?:chunks\/)?[\w.-]+\.js$/u))
const offset = z.number().check(z.int(), z.gte(0))
export const portableManifestSchema = z.strictObject({
  modules: z.array(
    z.strictObject({
      path: assetPath,
      bytes: offset,
      sha256: z.string().check(z.regex(/^[a-f\d]{64}$/u)),
      imports: z.array(
        z.strictObject({
          start: offset,
          end: offset,
          text: z.string(),
          target: assetPath,
          dynamic: z.boolean(),
        }),
      ),
    }),
  ),
})
