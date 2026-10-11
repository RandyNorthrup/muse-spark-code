import { createHash } from 'node:crypto'
import {
  FONT_WOFF2_HEADER_BYTES,
  FONT_WOFF2_MAGIC,
  FONT_WOFF2_LENGTH_OFFSET,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { fontPackSchema, type FontPack } from './manifest'

export interface FontAsset {
  readonly file: string
  readonly bytes: number
  readonly sha256: string
  readonly url: string
}

/** Sources must bound the read to asset.bytes and obey the signal; images inject local seeds. */
export interface FontInstallPort {
  read(asset: FontAsset, signal: AbortSignal): Promise<Uint8Array>
  /** All assets are verified before the single atomic directory publication. */
  publish(id: string, assets: ReadonlyMap<string, Uint8Array>): Promise<string>
}

export function verifyFontAsset(asset: FontAsset, bytes: Uint8Array): void {
  if (
    bytes.byteLength !== asset.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== asset.sha256
  )
    throw new Error(fill(UI_TEXT.acpFontIntegrity, { file: asset.file }))
  if (asset.file.endsWith('.woff2')) {
    if (
      bytes.byteLength < FONT_WOFF2_HEADER_BYTES ||
      Buffer.from(bytes.subarray(0, FONT_WOFF2_MAGIC.length)).toString('ascii') !==
        FONT_WOFF2_MAGIC ||
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
        FONT_WOFF2_LENGTH_OFFSET,
      ) !== bytes.byteLength
    )
      throw new Error(fill(UI_TEXT.acpFontIntegrity, { file: asset.file }))
  } else if (!Buffer.from(bytes).toString('utf8').includes('SIL OPEN FONT LICENSE Version 1.1')) {
    throw new Error(fill(UI_TEXT.acpFontIntegrity, { file: asset.file }))
  }
}

/** Called only by an explicit install command or an image builder. Never by activation/rendering. */
export async function installFontPack(
  manifest: unknown,
  port: FontInstallPort,
  signal: AbortSignal,
): Promise<string> {
  const pack: FontPack = fontPackSchema.parse(manifest)
  const verified = new Map<string, Uint8Array>()
  for (const font of pack.fonts) {
    for (const asset of [font.font, font.notice]) {
      signal.throwIfAborted()
      const bytes = await port.read(asset, signal)
      verifyFontAsset(asset, bytes)
      verified.set(asset.file, bytes)
    }
  }
  signal.throwIfAborted()
  const css = pack.fonts
    .map(
      (font) =>
        `@font-face{font-family:"${font.cssFamily}";src:url("${font.font.file}") format("woff2");font-style:normal;font-weight:${font.weight};font-display:swap;unicode-range:${font.unicodeRange};}`,
    )
    .join('\n')
  verified.set('fonts.css', Buffer.from(`${css}\n`))
  verified.set('manifest.json', Buffer.from(`${JSON.stringify(pack)}\n`))
  // The identity is the entire pinned manifest, so a different release never overwrites a reader.
  const digest = createHash('sha256').update(JSON.stringify(pack)).digest('hex')
  return await port.publish(`${pack.id}-${digest}`, verified)
}
