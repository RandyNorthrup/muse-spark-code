import * as z from 'zod/mini'
import {
  FONT_MAX_ASSET_BYTES,
  FONT_PACK_FAMILY_COUNT,
  FONT_PACK_BUDGET_BYTES,
} from '../../shared/constants'

const assetSchema = z.strictObject({
  file: z.string().check(z.regex(/^[a-z][a-z\d-]*\.(?:woff2|txt)$/)),
  bytes: z.number().check(z.int(), z.positive(), z.maximum(FONT_MAX_ASSET_BYTES)),
  sha256: z.string().check(z.regex(/^[a-f\d]{64}$/)),
  url: z
    .url()
    .check(z.regex(/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[a-f\d]{40}\//)),
})
export const fontPackSchema = z
  .strictObject({
    version: z.literal(1),
    id: z.string().check(z.regex(/^[a-z\d-]+$/)),
    fonts: z
      .array(
        z.strictObject({
          family: z.enum(['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Inter']),
          cssFamily: z.string().check(z.regex(/^[A-Za-z -]+$/)),
          licence: z.literal('OFL-1.1'),
          source: z.url(),
          sourceVersion: z.string().check(z.minLength(1)),
          weight: z.string().check(z.regex(/^\d+(?: \d+)?$/)),
          unicodeRange: z
            .string()
            .check(z.regex(/^U\+[A-F\d]+(?:-[A-F\d]+)?(?:,U\+[A-F\d]+(?:-[A-F\d]+)?)*$/)),
          font: assetSchema,
          notice: assetSchema,
        }),
      )
      .check(z.minLength(FONT_PACK_FAMILY_COUNT), z.maxLength(FONT_PACK_FAMILY_COUNT)),
  })
  .check(
    z.refine(
      (pack) => {
        const families = new Set(pack.fonts.map((font) => font.family))
        const files = pack.fonts.flatMap((font) => [font.font.file, font.notice.file])
        return (
          pack.fonts.reduce((sum, font) => sum + font.font.bytes + font.notice.bytes, 0) <=
            FONT_PACK_BUDGET_BYTES &&
          families.size === pack.fonts.length &&
          new Set(files).size === files.length &&
          pack.fonts.every(
            (font) => font.font.file.endsWith('.woff2') && font.notice.file.endsWith('.txt'),
          )
        )
      },
      { message: 'Invalid font pack size, families or asset extensions' },
    ),
  )
export type FontPack = z.infer<typeof fontPackSchema>
