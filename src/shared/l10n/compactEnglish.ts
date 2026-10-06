import LZString from 'lz-string'
import { L10N_COMPACT_TOKEN_FIRST, L10N_COMPACT_TOKEN_LAST } from '../constants'

interface EnglishTree {
  readonly [key: string]: string | EnglishTree
}

/** Build-only lossless encoding; the complete browser fallback stays inline. */
export function compactEnglishSource(english: EnglishTree): string {
  const tokenPattern = new RegExp(
    `[${String.fromCodePoint(L10N_COMPACT_TOKEN_FIRST)}-${String.fromCodePoint(L10N_COMPACT_TOKEN_LAST)}]`,
  )
  const json = JSON.stringify(english)
  if (tokenPattern.test(json)) {
    throw new Error('English fallback contains a reserved dictionary token')
  }
  const packed = LZString.compressToBase64(json)
  if (LZString.decompressFromBase64(packed) !== json) {
    throw new Error('English fallback compression changed the table')
  }
  // Canonical build-time data only: no user input reaches the decoder.
  return `import LZString from 'lz-string';export const EN=JSON.parse(LZString.decompressFromBase64(${JSON.stringify(packed)}));`
}
